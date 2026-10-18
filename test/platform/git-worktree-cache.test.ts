import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitWorktreeMetadataStamp } from '../../platform/paths/git-worktree-cache.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-git-stamp-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return root;
}

describe('Git worktree metadata stamp', () => {
  it('does not enumerate an absent registry but detects its later creation', async () => {
    const root = await fixture();
    const readdir = vi.spyOn(fs, 'readdir');
    const missing = await gitWorktreeMetadataStamp(root, []);
    expect(missing).toMatch(/^[a-f0-9]{64}$/u);
    expect(readdir).not.toHaveBeenCalled();
    expect(await gitWorktreeMetadataStamp(root, [])).toBe(missing);
    await fs.mkdir(path.join(root, '.git', 'worktrees'));
    const created = await gitWorktreeMetadataStamp(root, []);
    expect(created).not.toBe(missing);
    expect(readdir).toHaveBeenCalledWith(path.join(root, '.git', 'worktrees'));
  });

  it('does not cache a symlink registry', async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, 'outside'));
    await fs.symlink(path.join(root, 'outside'), path.join(root, '.git', 'worktrees'), 'junction');
    expect(await gitWorktreeMetadataStamp(root, [])).toBeNull();
  });

  it('does not treat a regular registry file as an absent directory', async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, '.git', 'worktrees'), '');
    expect(await gitWorktreeMetadataStamp(root, [])).toBeNull();
  });
});
