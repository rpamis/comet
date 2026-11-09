import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveWorkspaceRuntimeLocation } from '../../../platform/paths/workspace-runtime.js';
import { acquireRecoverableFileLock } from '../../../platform/fs/recoverable-file-lock.js';
import { resolveWorkspaceRuntimeRoot } from '../../../domains/workflow-contract/workspace-runtime.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('recovers a legacy migration recovery lock only after the original operation is confirmed stopped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-legacy-recovery-'));
  roots.push(root);
  vi.stubEnv('COMET_DATA_DIR', path.join(root, 'data'));
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  const location = resolveWorkspaceRuntimeLocation(project);
  await fs.mkdir(location.workspaceRoot, { recursive: true });
  const file = path.join(location.workspaceRoot, '.runtime-migration-recovery.lock');
  const source = JSON.stringify({ nonce: 'interrupted-migration', createdAt: Date.now() });
  await fs.writeFile(file, source);
  await expect(resolveWorkspaceRuntimeRoot(project)).rejects.toThrow(
    'Legacy lock requires confirmation',
  );
  expect(await fs.readFile(file, 'utf8')).toBe(source);
  expect(await resolveWorkspaceRuntimeRoot(project, { confirmedOwnerStopped: true })).toBe(
    location.runtimeRoot,
  );
  expect(await fs.readdir(location.runtimeRoot)).toEqual([]);
});

it('preserves an active migration recovery transaction even when recovery is confirmed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-active-recovery-'));
  roots.push(root);
  vi.stubEnv('COMET_DATA_DIR', path.join(root, 'data'));
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  const location = resolveWorkspaceRuntimeLocation(project);
  const file = path.join(location.workspaceRoot, '.runtime-migration-recovery.lock');
  const lock = await acquireRecoverableFileLock(file);
  const source = await fs.readFile(file, 'utf8');
  try {
    await expect(
      resolveWorkspaceRuntimeRoot(project, { confirmedOwnerStopped: true }),
    ).rejects.toThrow('Timed out waiting for file lock');
    expect(await fs.readFile(file, 'utf8')).toBe(source);
  } finally {
    await lock.release();
  }
  expect(await resolveWorkspaceRuntimeRoot(project)).toBe(location.runtimeRoot);
});
