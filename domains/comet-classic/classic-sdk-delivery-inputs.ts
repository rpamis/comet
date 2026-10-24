import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { spawnCommand } from '../../platform/process/spawn-command.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { readWorkflowProjectConfigDocument } from '../workflow-contract/project-config-reader.js';
import {
  normalizeWorkflowRelativePath,
  parseWorkflowProjectConfigDocument,
  WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
} from '../workflow-contract/project-config.js';
import type { WorkflowRun } from '../engine/runtime.js';
import { archivedClassicDocumentRef } from './classic-archive-annotation.js';
import { isGitWorkTree } from './classic-branch-binding.js';
import {
  checkManifestHash,
  parseCheckManifest,
  serializeCheckManifest,
  compileCheckPolicyPattern,
} from './classic-check-manifest.js';
import type { CheckIdentity } from './classic-check-policy.js';
import { readCheckPolicy } from './classic-check-policy.js';
import { hashGitPaths } from './classic-check-snapshot.js';
import { resolveClassicLayout } from './classic-layout.js';
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

async function foreignChangeRoots(root: string): Promise<string[]> {
  const config = await readWorkflowProjectConfigDocument(root, {
    allowPartialProject: true,
    allowMissingNativeFields: true,
  });
  // 检查可以依赖其他 change 的草稿，但检查覆盖不代表获准交付这些草稿。
  return config?.native ? [path.posix.join(config.native.artifact_root, 'comet', 'changes')] : [];
}

function underRoot(ref: string, roots: string[]) {
  return roots.some((root) => ref === root || ref.startsWith(`${root}/`));
}

async function implementationInputs(
  root: string,
  manifest: string,
  foreignRoots?: string[],
): Promise<Record<string, string>> {
  const layout = await resolveClassicLayout(root);
  const roots = [
    '.comet',
    layout.openSpecRoot,
    layout.superpowersRoot,
    ...(foreignRoots ?? (await foreignChangeRoots(root))),
  ].map((ref) => (path.isAbsolute(ref) ? path.relative(root, ref).replaceAll('\\', '/') : ref));
  return Object.fromEntries(
    parseCheckManifest(manifest)
      .filter(
        ({ p }) =>
          !p.includes('\0') && !p.split('/').includes('node_modules') && !underRoot(p, roots),
      )
      .map(({ p, h }) => [p, h]),
  );
}

/** 只携带本轮检查覆盖的待提交文件，供归档交付及跨设备恢复核对。 */
export async function collectClassicSdkDeliveryInputs(
  root: string,
  manifest: string,
  identity: CheckIdentity,
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
  const patterns = policy.files?.map(compileCheckPolicyPattern);
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
  return Object.fromEntries(
    Object.entries(await implementationInputs(root, manifest)).filter(([ref]) =>
      [...changed].some((name) => ref === name || ref.startsWith(`${name}/`)),
    ),
  );
}

async function committedHash(
  root: string,
  ref: string,
  expected: string,
  size: number,
  trees: Map<string, string[]>,
  allowed: Set<string>,
) {
  let repository = root,
    relative = ref,
    commit = 'HEAD';
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
      if (gitHash) digest.update(`blob ${size}\0`);
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
            bytes === size ? (gitHash ? 'git:' : '') + digest.digest('hex') : 'different-size',
          );
      });
    });
  const raw = await hashContent(false);
  return raw === expected ? raw : hashContent(true);
}

function matchesCleanIndex(root: string, ref: string, expected: string) {
  const repository = git(path.dirname(path.join(root, ref)), [
    'rev-parse',
    '--show-toplevel',
  ]).trim();
  const relative = path.relative(repository, path.join(root, ref)).replaceAll('\\', '/');
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
  const output = run.actions
    .slice()
    .reverse()
    .find((action) => action.stepId === `${profile}.verify.check` && action.status === 'succeeded')
    ?.outcome?.output as Record<string, unknown> | undefined;
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
      Object.entries(await implementationInputs(root, manifest, [])).filter(
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
