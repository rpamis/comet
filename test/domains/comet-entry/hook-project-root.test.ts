import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCometHookProjectRoot } from '../../../domains/comet-entry/hook-project-root.js';

describe('Comet Hook worktree project root', () => {
  let primary: string;
  let secondary: string;

  beforeEach(async () => {
    primary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-primary-'));
    secondary = path.join(
      os.tmpdir(),
      `comet-hook-secondary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const git = (...args: string[]) =>
      spawnSync('git', ['-C', primary, ...args], { encoding: 'utf8', timeout: 20_000 });
    expect(git('init', '-b', 'master').status).toBe(0);
    expect(git('config', 'user.email', 'worktree@example.com').status).toBe(0);
    expect(git('config', 'user.name', 'Worktree Test').status).toBe(0);
    await fs.writeFile(path.join(primary, 'README.md'), '# worktree\n');
    expect(git('add', 'README.md').status).toBe(0);
    expect(git('commit', '-m', 'initial').status).toBe(0);
    expect(git('worktree', 'add', secondary, '-b', 'feature/secondary').status).toBe(0);
    for (const root of [primary, secondary]) {
      await fs.mkdir(path.join(root, '.comet'), { recursive: true });
      await fs.writeFile(path.join(root, '.comet', 'config.yaml'), 'schema: comet.project.v1\n');
    }
  });

  afterEach(async () => {
    spawnSync('git', ['-C', primary, 'worktree', 'remove', '--force', secondary], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    await fs.rm(secondary, { recursive: true, force: true });
    await fs.rm(primary, { recursive: true, force: true });
  });

  it('rebases relative targets from the Hook payload cwd to the linked worktree', async () => {
    await expect(
      resolveCometHookProjectRoot(primary, {
        intent: 'write',
        targets: ['src/a.ts'],
        toolName: 'Write',
        cwd: secondary,
      }),
    ).resolves.toBe(path.resolve(secondary));
  });

  it('rebases an absolute linked-worktree target without a payload cwd', async () => {
    await expect(
      resolveCometHookProjectRoot(primary, {
        intent: 'write',
        targets: [path.join(secondary, 'src', 'a.ts')],
        toolName: 'Write',
      }),
    ).resolves.toBe(path.resolve(secondary));
  });

  it('keeps project-external targets neutral to worktree selection', async () => {
    await expect(
      resolveCometHookProjectRoot(primary, {
        intent: 'write',
        targets: [path.join(os.tmpdir(), 'outside-comet-project.ts')],
        toolName: 'Write',
      }),
    ).resolves.toBe(path.resolve(primary));
  });

  it('fails closed when one request crosses registered worktrees', async () => {
    await expect(
      resolveCometHookProjectRoot(primary, {
        intent: 'write',
        targets: [path.join(primary, 'src', 'a.ts'), path.join(secondary, 'src', 'b.ts')],
        toolName: 'Edit',
      }),
    ).rejects.toThrow('cannot write across multiple Git worktrees');
  });

  it('fails closed when the selected linked worktree has no Comet config', async () => {
    await fs.rm(path.join(secondary, '.comet', 'config.yaml'));
    await expect(
      resolveCometHookProjectRoot(primary, {
        intent: 'write',
        targets: ['src/a.ts'],
        toolName: 'Write',
        cwd: secondary,
      }),
    ).rejects.toThrow('linked worktree');
  });
});
