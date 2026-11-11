import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as worktrees from '../../../platform/paths/git-worktree.js';
import {
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../../../domains/workflow-contract/workspace-runtime.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { findClassicSdkWorkspace } from '../../../domains/comet-classic/classic-sdk-status.js';

let temporary: string;
let project: string;
beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-explicit-runtime-import-'));
  project = path.join(temporary, 'project');
  await fs.mkdir(project);
  vi.stubEnv('COMET_DATA_DIR', path.join(temporary, 'data'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(temporary, { recursive: true, force: true });
});

it('resolves the current Runtime path without importing, repairing or fencing legacy storage', async () => {
  const legacy = path.join(project, '.comet/runtime/saved.json');
  await fs.mkdir(path.dirname(legacy), { recursive: true });
  await fs.writeFile(legacy, '{"saved":"original"}');
  const target = resolveWorkspaceRuntimeRootSync(project);
  expect(await resolveWorkspaceRuntimeRoot(project)).toBe(target);
  expect(await fs.readFile(legacy, 'utf8')).toBe('{"saved":"original"}');
  expect(await fs.stat(target).catch(() => null)).toBeNull();
});

it('prepares Native paths without moving a legacy change Runtime', async () => {
  const legacy = path.join(project, 'docs/comet/changes/example/runtime/saved.json');
  await fs.mkdir(path.dirname(legacy), { recursive: true });
  await fs.writeFile(legacy, '{"saved":"original"}');
  const paths = await nativeProjectPaths(project, 'docs', { change: 'example' });
  expect(await fs.readFile(legacy, 'utf8')).toBe('{"saved":"original"}');
  expect(await fs.stat(paths.changesRuntimeDir).catch(() => null)).toBeNull();
});

it('looks for a Classic Run only in the explicitly supplied workspace', async () => {
  const scan = vi.spyOn(worktrees, 'listGitWorktrees').mockReturnValue([]);
  expect(await findClassicSdkWorkspace(project, 'missing', { readOnly: true })).toBeNull();
  expect(scan).not.toHaveBeenCalled();
});
