import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gitStatusPaths } from '../../platform/process/git.js';

describe('Git process helpers', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-git-process-'));
    execFileSync('git', ['init', '-b', 'master'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'git-process@example.com'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.name', 'Git Process Test'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, '.comet', 'current-change.json'), '{}\n');
    execFileSync('git', ['add', '.comet/current-change.json'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['commit', '-m', 'test: add selection'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('preserves a leading dot when a tracked path is deleted', async () => {
    await fs.rm(path.join(projectRoot, '.comet', 'current-change.json'));

    expect(gitStatusPaths(projectRoot)).toEqual(['.comet/current-change.json']);
  });
});
