import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  nativeProjectPaths,
  ensureNativeDirectories,
} from '../../../domains/comet-native/native-paths.js';
import { runGitCommand } from '../../../platform/process/git.js';
import { withNativeCommandRecovery } from '../../../domains/comet-native/native-command-recovery.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-command-lock-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  return { root, paths };
}

it.each([
  ['unable to create ref.lock', true],
  ['WORKTREE /candidate is LOCKED', true],
  ['unable to create\nref.lock', false],
  ['worktree\nlocked', false],
  ['worktree'.repeat(20_000), false],
  ['unable to create'.repeat(20_000), false],
])('classifies Git lock diagnostics without crossing lines (%#)', async (message, locked) => {
  const { root } = await project();
  const result = await withNativeCommandRecovery(
    { command: 'archive', exitCode: 73, error: { code: 'conflict', message } },
    { projectRoot: root },
  );
  expect((result.data as { recovery?: { code: string } } | undefined)?.recovery?.code).toBe(
    locked ? 'git-lock' : 'archive-blocked',
  );
});

it.each(['native', 'classic-full'])(
  'keeps failed %s command recovery diagnosis read-only before any Run exists',
  async (application) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-recovery-readonly-'));
    roots.push(root);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const result = await withNativeCommandRecovery(
      {
        command: 'runtime',
        exitCode: 73,
        error: { code: 'conflict', message: 'Run does not exist' },
      },
      { projectRoot: root, name: 'missing-change', application },
    );
    expect(result.error?.message).toBe('Run does not exist');
    await expect(fs.lstat(resolveWorkspaceRuntimeRootSync(root))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.lstat(path.join(root, '.comet'))).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('reports an actual Git index lock with its path and retry conditions without deleting the Git lock', async () => {
  const { root } = await project();
  await fs.writeFile(path.join(root, 'candidate.txt'), 'candidate');
  const lock = path.join(root, '.git', 'index.lock');
  await fs.writeFile(lock, 'Original Git writer has not been reconciled.');
  let message = '';
  try {
    runGitCommand(root, ['add', 'candidate.txt']);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toContain('index.lock');
  const result = await withNativeCommandRecovery(
    {
      command: 'archive',
      exitCode: 73,
      error: { code: 'conflict', message },
      data: {
        change: 'git-locked',
        workspaceFinishResult: {
          status: 'blocked',
          message,
          targetRoot: root,
          recoveryArgs: ['comet', 'native', 'archive', 'git-locked', '--confirmed'],
        },
      },
    },
    { projectRoot: root, name: 'git-locked' },
  );
  expect(result.data).toMatchObject({
    recovery: { code: 'git-lock', affectedPaths: [lock], owner: null },
  });
  expect(await fs.readFile(lock, 'utf8')).toBe('Original Git writer has not been reconciled.');
  await fs.unlink(lock);
  expect(runGitCommand(root, ['add', 'candidate.txt'])).toBe('');
});
