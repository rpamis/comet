import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { resolveProjectKnowledgeCacheLocation } from '../../platform/paths/project-knowledge-cache.js';

test('shares repository identity but isolates linked workspaces', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-pk-repository-'));
  const worktree = `${root}-worktree`;
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-pk-cache-'));
  try {
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Comet Test'], { cwd: root });
    await fs.writeFile(path.join(root, 'README.md'), '# test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'test'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['worktree', 'add', '-b', 'other', worktree], {
      cwd: root,
      stdio: 'ignore',
    });

    const primary = resolveProjectKnowledgeCacheLocation(root, cacheRoot);
    const linked = resolveProjectKnowledgeCacheLocation(worktree, cacheRoot);
    expect(linked.repositoryId).toBe(primary.repositoryId);
    expect(linked.workspaceId).not.toBe(primary.workspaceId);
    expect(linked.databasePath).not.toBe(primary.databasePath);
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktree], {
        cwd: root,
        stdio: 'ignore',
      });
    } catch {
      // The temporary directory cleanup below is sufficient if Git setup failed.
    }
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(worktree, { recursive: true, force: true });
    await fs.rm(cacheRoot, { recursive: true, force: true });
  }
});
