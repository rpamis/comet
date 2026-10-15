import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { fingerprintDashboardFiles } from '../../../domains/dashboard/source-version.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('changes the display index version after file creation, editing and deletion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-version-'));
  roots.push(root);
  const file = path.join(root, 'state.yaml');
  const missing = await fingerprintDashboardFiles([file], 'workspace');
  await fs.writeFile(file, 'phase: build');
  const created = await fingerprintDashboardFiles([file], 'workspace');
  expect(created).not.toBe(missing);
  expect(await fingerprintDashboardFiles([file], 'workspace')).toBe(created);
  expect(await fingerprintDashboardFiles([file], 'other-workspace')).not.toBe(created);
  await fs.writeFile(file, 'phase: verify');
  expect(await fingerprintDashboardFiles([file], 'workspace')).not.toBe(created);
  await fs.rm(file);
  expect(await fingerprintDashboardFiles([file], 'workspace')).toBe(missing);
});

it('disables version reuse when filesystem metadata is unreadable', async () => {
  vi.spyOn(fs, 'lstat').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
  expect(await fingerprintDashboardFiles(['unreadable'], 'workspace')).toBeNull();
});
