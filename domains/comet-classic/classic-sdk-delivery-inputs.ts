import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { spawnCommand } from '../../platform/process/spawn-command.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import type { WorkflowRun } from '../engine/runtime.js';
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

async function implementationInputs(
  root: string,
  manifest: string,
): Promise<Record<string, string>> {
  const layout = await resolveClassicLayout(root);
  const roots = ['.comet', layout.openSpecRoot, layout.superpowersRoot].map((ref) =>
    path.isAbsolute(ref) ? path.relative(root, ref).replaceAll('\\', '/') : ref,
  );
  return Object.fromEntries(
    parseCheckManifest(manifest)
      .filter(
        ({ p }) =>
          !p.includes('\0') &&
          !p.split('/').includes('node_modules') &&
          !roots.some((ref) => p === ref || p.startsWith(`${ref}/`)),
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
  if (inputs === undefined) {
    // 旧 Run 的固定清单仍可核对，不按当前工作区重建旧验收结果。
    const ref = output?.manifestRef;
    if (typeof ref !== 'string' || !ref.startsWith(`${classicSdkCheckDirectoryRef(run)}/`))
      throw new Error('Classic delivery is missing verified inputs');
    const manifest = await readClassicProjectFile(root, ref, {
      label: 'Classic delivery input manifest',
    });
    if (checkManifestHash(manifest) !== output?.manifestHash)
      throw new Error('Classic delivery input manifest changed');
    const versioned = new Set(
      git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0'),
    );
    inputs = Object.fromEntries(
      Object.entries(await implementationInputs(root, manifest)).filter(
        ([ref, hash]) => versioned.has(ref) || hash === 'missing',
      ),
    );
  }
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs))
    throw new Error('Classic delivery inputs are invalid');
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
      throw new Error(`Classic verified implementation changed: ${ref}`);
    const size = file.exists ? (await stat(file.target)).size : 0;
    if ((await committedHash(root, ref, expected, size, trees, allowed)) !== expected)
      throw new Error(`Classic commit omits verified implementation: ${ref}`);
  }
  return allowed;
}
