import {
  classicDeliveryActionContext,
  classicDeliveryRepairForAction,
} from './classic-sdk-delivery-repair-model.js';
import {
  classicForeignChangeRoots as foreignChangeRoots,
  isClassicInputUnderRoot as underRoot,
  collectClassicSdkImplementationInputs,
} from './classic-sdk-implementation-inputs.js';
import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { spawnCommand } from '../../platform/process/spawn-command.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import {
  normalizeWorkflowRelativePath,
  parseWorkflowProjectConfigDocument,
  WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
} from '../workflow-contract/project-config.js';
import {
  createFileRuntimeStore,
  hashRuntimeValue,
  type WorkflowRun,
  type RuntimeValue,
} from '../engine/runtime.js';
import { resolveWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import { archivedClassicDocumentRef } from './classic-archive-annotation.js';
import { assertClassicDeliveryRepairCurrent } from './classic-sdk-delivery-repair.js';
import { assertClassicSdkCheckReceipt } from './classic-sdk-check-record.js';
import { isGitWorkTree } from './classic-branch-binding.js';
import {
  checkManifestHash,
  parseCheckManifest,
  serializeCheckManifest,
  compileCheckPolicyInputPattern,
  compileCheckPolicyPattern,
} from './classic-check-manifest.js';
import type { CheckIdentity } from './classic-check-policy.js';
import { readCheckPolicy } from './classic-check-policy.js';
import { hashGitPaths } from './classic-check-snapshot.js';
import { hashClassicProjectFile, readClassicProjectFile } from './classic-protected-path.js';
import { classicSdkCheckDirectoryRef } from './classic-sdk-check-record.js';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 初始工作区只记录内容身份；既有草稿仍参与检查，但没有变化时不属于本次交付。 */
export async function captureClassicSdkWorkspaceBaseline(root: string) {
  if (!isGitWorkTree(root)) return undefined;
  let tracked: string;
  try {
    git(root, ['rev-parse', '--verify', 'HEAD']);
    tracked = git(root, ['diff', 'HEAD', '--name-only', '--no-renames', '-z']);
  } catch {
    tracked = git(root, ['ls-files', '--cached', '-z']);
  }
  const paths = [
    ...new Set(
      [
        ...tracked.split('\0'),
        ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
      ].filter(Boolean),
    ),
  ];
  const regular: string[] = [];
  const files: Record<string, string> = {};
  for (const ref of paths) {
    try {
      const entry = await inspectProtectedProjectPath(root, ref, {
        label: 'Classic initial workspace input',
        expected: 'file',
      });
      if (entry.exists) regular.push(ref);
      else files[ref] = 'missing';
    } catch {
      // 无法证明身份的路径不能获得交付豁免。
    }
  }
  const first = hashGitPaths(root, regular);
  const second = hashGitPaths(root, regular);
  for (const [ref, hash] of first) if (second.get(ref) === hash) files[ref] = `git:${hash}`;
  return { schema: 'comet.classic.workspace-baseline.v1', files };
}

interface WorkspaceBaselineReceipt {
  runId: string;
  revision: number;
  inputHash: string;
  files: Record<string, string>;
}
async function workspaceBaselineStore(root: string) {
  return createFileRuntimeStore<WorkspaceBaselineReceipt>({
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(root), 'classic-delivery-baselines'),
  });
}

/** 只有 Runtime 的初始捕获能授予豁免；公开 start input 不能自报文件摘要。 */
export async function bindClassicSdkWorkspaceBaseline(
  root: string,
  input: Record<string, RuntimeValue>,
) {
  const baseline = await captureClassicSdkWorkspaceBaseline(root);
  if (!baseline) return input;
  const ref = randomUUID();
  const bound = { ...input, workspaceBaseline: { ref } };
  const receipt = {
    runId: ref,
    revision: 1,
    inputHash: hashRuntimeValue(bound),
    files: baseline.files,
  };
  if (!(await (await workspaceBaselineStore(root)).compareAndSwap(ref, null, receipt)))
    throw new Error('Classic 初始工作区收据已存在，不能替换');
  return bound;
}

async function initialWorkspaceFiles(
  root: string,
  run?: Readonly<WorkflowRun>,
): Promise<Record<string, string>> {
  const input = run?.input as { workspaceBaseline?: { ref?: unknown } } | undefined;
  const ref = input?.workspaceBaseline?.ref;
  if (!run || typeof ref !== 'string' || !/^[a-f0-9-]{36}$/u.test(ref)) return {};
  const first = run.actions[0]?.input as { input?: RuntimeValue } | undefined;
  if (!first?.input) return {};
  const receipt = await (await workspaceBaselineStore(root)).read(ref);
  return receipt?.revision === 1 && receipt.inputHash === hashRuntimeValue(first.input)
    ? receipt.files
    : {};
}

/** 只携带本轮检查覆盖的待提交文件，供归档交付及跨设备恢复核对。 */
export async function collectClassicSdkDeliveryInputs(
  root: string,
  manifest: string,
  identity: CheckIdentity,
  run?: Readonly<WorkflowRun>,
) {
  if (!isGitWorkTree(root)) return undefined;
  let hasHead = true;
  try {
    git(root, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    hasHead = false;
  }
  const trackedChanges = git(
    root,
    hasHead
      ? ['diff', 'HEAD', '--name-only', '--no-renames', '-z']
      : ['ls-files', '--cached', '-z'],
  );
  const changed = new Set(
    [
      ...trackedChanges.split('\0'),
      ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
    ].filter(Boolean),
  );
  const policy = await readCheckPolicy(root, identity);
  const patterns = policy.files?.map(compileCheckPolicyInputPattern);
  const outputs = policy.outputs?.map(compileCheckPolicyPattern) ?? [];
  const stagedDeletes = git(root, [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=D',
    '--no-renames',
    '-z',
  ])
    .split('\0')
    .filter(
      (ref) =>
        ref &&
        (!patterns || patterns.some((matches) => matches(ref))) &&
        !outputs.some((matches) => matches(ref)),
    );
  manifest = serializeCheckManifest([
    ...parseCheckManifest(manifest),
    ...stagedDeletes.map((p) => ({ p, h: 'missing', s: null, m: null })),
  ]);
  const baseline = await initialWorkspaceFiles(root, run);
  return Object.fromEntries(
    Object.entries(await collectClassicSdkImplementationInputs(root, manifest))
      .filter(([ref]) => [...changed].some((name) => ref === name || ref.startsWith(`${name}/`)))
      .filter(([ref, hash]) => !Object.hasOwn(baseline, ref) || baseline[ref] !== hash),
  );
}

async function committedHash(
  root: string,
  ref: string,
  expected: string,
  size: number | undefined,
  trees: Map<string, string[]>,
  allowed: Set<string>,
  revision = 'HEAD',
) {
  let repository = root,
    relative = ref,
    commit = revision;
  // 子模块的文件必须来自父提交所固定的子模块提交。
  for (;;) {
    const key = `${repository}\0${commit}`;
    let rows = trees.get(key);
    if (!rows) {
      rows = git(repository, ['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean);
      trees.set(key, rows);
    }
    const row = rows.find((entry) => entry.slice(entry.indexOf('\t') + 1) === relative);
    if (row) {
      const [mode, type, objectId] = row.slice(0, row.indexOf('\t')).split(' ');
      if (type !== 'blob' || mode === '120000')
        throw new Error(`Classic delivery file is not regular: ${ref}`);
      if (expected === `git:${objectId}`) return expected;
      break;
    }
    const parent = rows.find(
      (entry) =>
        entry.startsWith('160000 commit ') &&
        relative.startsWith(`${entry.slice(entry.indexOf('\t') + 1)}/`),
    );
    if (!parent) return 'missing';
    const prefix = parent.slice(parent.indexOf('\t') + 1);
    allowed.add(path.relative(root, path.join(repository, prefix)).replaceAll('\\', '/'));
    commit = parent.slice(0, parent.indexOf('\t')).split(' ')[2];
    repository = path.join(repository, prefix);
    relative = relative.slice(prefix.length + 1);
  }
  const hashContent = (filtered: boolean) =>
    new Promise<string>((resolve, reject) => {
      const gitHash = expected.startsWith('git:');
      const digest = createHash(gitHash && expected.length === 44 ? 'sha1' : 'sha256');
      if (gitHash)
        digest.update(
          `blob ${size ?? Number(git(repository, ['cat-file', '-s', `${commit}:${relative}`]))}\0`,
        );
      const child = spawnCommand(
        'git',
        filtered
          ? ['cat-file', '--filters', `--path=${relative}`, `${commit}:${relative}`]
          : ['cat-file', 'blob', `${commit}:${relative}`],
        { cwd: repository },
      );
      const timeout = setTimeout(() => child.kill(), 30_000);
      let bytes = 0;
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        digest.update(chunk);
      });
      child.stderr.resume();
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error(`Classic committed input changed: ${ref}`));
        else
          resolve(
            size === undefined || bytes === size
              ? (gitHash ? 'git:' : '') + digest.digest('hex')
              : 'different-size',
          );
      });
    });
  const raw = await hashContent(false);
  return raw === expected ? raw : hashContent(true);
}

function matchesCleanIndex(root: string, ref: string, expected: string) {
  const target = realpathSync.native(path.join(root, ref));
  const repository = realpathSync.native(
    git(path.dirname(target), ['rev-parse', '--show-toplevel']).trim(),
  );
  const relative = path.relative(repository, target).replaceAll('\\', '/');
  const entry = git(repository, ['ls-files', '--stage', '-z', '--', relative]).split('\0')[0];
  if (!entry || entry.split(' ')[1] !== expected.slice(4)) return false;
  try {
    git(repository, ['diff', '--quiet', '--', relative]);
    return true;
  } catch {
    return false;
  }
}

/** 交付必须包含已验证的待提交内容；工作区里的修复不能代替提交。 */
export async function assertClassicSdkDeliveryInputs(root: string, run: Readonly<WorkflowRun>) {
  const profile = (run.state as { workflow: string }).workflow;
  let output = run.actions
    .slice()
    .reverse()
    .find((action) => action.stepId === `${profile}.verify.check` && action.status === 'succeeded')
    ?.outcome?.output as Record<string, unknown> | undefined;
  const delivery = run.actions
    .slice()
    .reverse()
    .find((entry) => entry.stepId === `${profile}.archive.deliver`);
  const deliveryContext = delivery && classicDeliveryActionContext(run, delivery);
  if (deliveryContext?.repairCheckId) {
    const checked = run.actions.find((entry) => entry.id === deliveryContext.repairCheckId)!;
    await assertClassicSdkCheckReceipt(root, run, checked, {
      status: checked.outcome!.status,
      output: checked.outcome!.output,
    });
    await assertClassicDeliveryRepairCurrent(root, run, classicDeliveryRepairForAction(checked));
    output = checked.outcome!.output as Record<string, unknown>;
  }
  let inputs = output?.deliveryInputs as Record<string, string> | undefined;
  let verifiedManifest: string | undefined;
  const readVerifiedManifest = async () => {
    if (verifiedManifest !== undefined) return verifiedManifest;
    const ref = output?.manifestRef;
    if (typeof ref !== 'string' || !ref.startsWith(`${classicSdkCheckDirectoryRef(run)}/`))
      throw new Error('Classic delivery is missing verified inputs');
    const manifest = await readClassicProjectFile(root, ref, {
      label: 'Classic delivery input manifest',
    });
    if (checkManifestHash(manifest) !== output?.manifestHash)
      throw new Error('Classic delivery input manifest changed');
    verifiedManifest = manifest;
    return manifest;
  };
  if (inputs === undefined) {
    // 旧 Run 的固定清单仍可核对，不按当前工作区重建旧验收结果。
    const manifest = await readVerifiedManifest();
    const versioned = new Set(
      git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0'),
    );
    inputs = Object.fromEntries(
      Object.entries(await collectClassicSdkImplementationInputs(root, manifest, [])).filter(
        ([ref, hash]) => versioned.has(ref) || hash === 'missing',
      ),
    );
  }
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs))
    throw new Error('Classic delivery inputs are invalid');
  for (const [ref, hash] of Object.entries(inputs)) {
    if (
      normalizeWorkflowRelativePath(ref, 'Classic verified input') !== ref ||
      typeof hash !== 'string' ||
      !/^(?:missing|git:[a-f0-9]{40}(?:[a-f0-9]{24})?|[a-f0-9]{64})$/u.test(hash)
    )
      throw new Error('Classic verified input identity is invalid');
  }
  // 0.5.0 的归档 Run 可能误收 Native 草稿；仅用原检查绑定的配置解释归属，不改写收据。
  const foreignRoots = await foreignChangeRoots(root);
  if (Object.keys(inputs).some((ref) => underRoot(ref, foreignRoots))) {
    const manifest = await readVerifiedManifest();
    const configRef = '.comet/config.yaml';
    const expected = parseCheckManifest(manifest).find(({ p }) => p === configRef)?.h;
    const source = await readClassicProjectFile(root, configRef, {
      label: 'Classic delivery configuration',
      maxBytes: WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
    });
    const digest = createHash(
      expected?.startsWith('git:') && expected.length === 44 ? 'sha1' : 'sha256',
    );
    if (expected?.startsWith('git:')) digest.update(`blob ${Buffer.byteLength(source)}\0`);
    const actual =
      (expected?.startsWith('git:') ? 'git:' : '') + digest.update(source).digest('hex');
    if (!expected || actual !== expected)
      throw new Error(
        'Classic 旧交付输入中的其他 change 归属缺少原验证配置绑定，或配置已改变；不能豁免交付',
      );
    // 从同一份已核对字节解析归属，不能先读配置、再用另一次读取的摘要替它背书。
    const boundConfig = parseWorkflowProjectConfigDocument(source, {
      allowPartialProject: true,
      allowMissingNativeFields: true,
    });
    const boundRoots = boundConfig.native
      ? [path.posix.join(boundConfig.native.artifact_root, 'comet', 'changes')]
      : [];
    inputs = Object.fromEntries(
      Object.entries(inputs).filter(([ref]) => !underRoot(ref, boundRoots)),
    );
  }
  const report = run.evidenceWaits
    ?.slice()
    .reverse()
    .find(
      (wait) => wait.stepId === `${profile}.verify.report.evidence` && wait.status === 'resolved',
    )?.receipt;
  const reportRef = (run.state as { verificationReport?: string | null }).verificationReport;
  if (reportRef && !report) throw new Error(`Classic 交付缺少验证报告收据：${reportRef}`);
  let boundReportRef: string | undefined;
  if (report) {
    const changeDir = (run.input as { changeDir?: string } | null)?.changeDir;
    const archive = run.outputs[`${profile}.archive.execute`]?.value as
      { archiveDirectory?: string } | undefined;
    const ref =
      changeDir && archive?.archiveDirectory
        ? archivedClassicDocumentRef(report.ref, changeDir, archive.archiveDirectory)
        : report.ref;
    if (!ref || (reportRef && reportRef !== ref && reportRef !== report.ref))
      throw new Error('Classic 交付缺少已绑定的验证报告路径');
    // 报告有独立验收收据；只携带该文件及原内容摘要，不放宽其所在目录。
    boundReportRef = ref;
    inputs = { ...inputs, [ref]: report.contentHash };
  }
  return assertClassicSdkDeliveryFileInputs(root, inputs, boundReportRef);
}

/** 按同一个字节及 Git 内容契约核对实现文件和 Archive 绑定产物。 */
export async function assertClassicSdkDeliveryFileInputs(
  root: string,
  inputs: Record<string, string>,
  boundReportRef?: string,
) {
  const entries = Object.entries(inputs);
  if (
    entries.some(
      ([ref, hash]) =>
        !ref ||
        typeof hash !== 'string' ||
        !/^(?:missing|git:[a-f0-9]{40}(?:[a-f0-9]{24})?|[a-f0-9]{64})$/u.test(hash),
    )
  )
    throw new Error('Classic verified input identity is invalid');
  const allowed = new Set(entries.map(([ref]) => ref));
  const trees = new Map<string, string[]>();
  const hashes = hashGitPaths(
    root,
    entries.filter(([, hash]) => hash.startsWith('git:')).map(([ref]) => ref),
  );
  for (const [ref, expected] of entries) {
    const file = await inspectProtectedProjectPath(root, ref, {
      label: 'Classic delivery implementation',
      expected: 'file',
    });
    const actual = !file.exists
      ? 'missing'
      : expected.startsWith('git:')
        ? `git:${hashes.get(ref)}`
        : (await hashClassicProjectFile(root, ref, { label: 'Classic delivery implementation' }))
            .digest;
    if (
      actual !== expected &&
      !(file.exists && expected.startsWith('git:') && matchesCleanIndex(root, ref, expected))
    )
      throw new Error(
        ref === boundReportRef
          ? `Classic 验证报告内容已改变：${ref}`
          : `Classic verified implementation changed: ${ref}`,
      );

    const size = file.exists ? (await stat(file.target)).size : 0;
    if ((await committedHash(root, ref, expected, size, trees, allowed)) !== expected)
      throw new Error(
        ref === boundReportRef
          ? `Classic 归档提交缺少已验证报告或报告内容不符：${ref}`
          : `Classic commit omits verified implementation: ${ref}`,
      );
  }
  return allowed;
}

/** 归档产物在交付范围的中间提交中也不能被换成未经批准的正文。 */
export async function assertClassicSdkArchiveCommitInputs(
  root: string,
  inputs: Record<string, string>,
  commits: Map<string, string[]>,
  sources: Record<string, string> = {},
  stateFiles: readonly string[] = [],
) {
  const trees = new Map<string, string[]>();
  const allowed = new Set<string>();
  for (const [commit, paths] of commits)
    for (const ref of paths) {
      if (!Object.hasOwn(inputs, ref) || stateFiles.includes(ref)) continue;
      const identities = [
        ...new Set([inputs[ref], sources[ref]].filter((hash) => hash && hash !== 'missing')),
      ];
      // 已删除来源仍须核对中间提交，不能用最终 missing 豁免未经批准的正文。
      let matches = false;
      for (const expected of identities.length ? identities : ['missing']) {
        const actual = await committedHash(root, ref, expected, undefined, trees, allowed, commit);
        if (actual === 'missing' || actual === expected) {
          matches = true;
          break;
        }
      }
      if (!matches) throw new Error(`Classic 交付范围中的归档内容未经验证：${commit}:${ref}`);
    }
}
