import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { resolveProjectKnowledgeStorageLocation } from '../../platform/paths/project-knowledge-storage.js';

test('shares repository storage but isolates linked workspaces', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-pk-repository-'));
  const worktree = `${root}-worktree`;
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-pk-storage-'));
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

    const primary = resolveProjectKnowledgeStorageLocation(root, storageRoot);
    const linked = resolveProjectKnowledgeStorageLocation(worktree, storageRoot);
    expect(linked.repositoryId).toBe(primary.repositoryId);
    expect(linked.workspaceId).not.toBe(primary.workspaceId);
    expect(linked.databasePath).toBe(primary.databasePath);
    expect(linked.databasePath).toMatch(/knowledge\.sqlite$/u);
    expect(linked.databasePath.startsWith(worktree)).toBe(false);
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktree], {
        cwd: root,
        stdio: 'ignore',
      });
    } catch {
      // Temporary-directory cleanup below is enough when git cleanup fails.
    }
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(worktree, { recursive: true, force: true });
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});
