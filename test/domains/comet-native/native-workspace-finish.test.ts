import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  finishArchivedNativeWorkspace,
  NativeWorkspaceFinishError,
} from '../../../domains/comet-native/native-workspace-finish.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type { NativeChangeState } from '../../../domains/comet-native/native-types.js';

describe('Native workspace finish recovery', () => {
  let projectRoot: string;
  let targetBranch: string;
  const changeBranch = 'comet/conflicting-merge';

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-workspace-finish-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: projectRoot });
    await fs.writeFile(path.join(projectRoot, 'shared.txt'), 'base\n');
    execFileSync('git', ['add', 'shared.txt'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: projectRoot, stdio: 'ignore' });
    targetBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['switch', '-c', changeBranch], { cwd: projectRoot, stdio: 'ignore' });
    await fs.writeFile(path.join(projectRoot, 'shared.txt'), 'change\n');
    execFileSync('git', ['add', 'shared.txt'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'change branch'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['switch', targetBranch], { cwd: projectRoot, stdio: 'ignore' });
    await fs.writeFile(path.join(projectRoot, 'shared.txt'), 'target\n');
    execFileSync('git', ['add', 'shared.txt'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'target branch'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['switch', changeBranch], { cwd: projectRoot, stdio: 'ignore' });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('aborts a failed branch merge and restores the change branch', async () => {
    const paths = await nativeProjectPaths(projectRoot, '.');
    const state = {
      name: 'conflicting-merge',
      spec_changes: [],
    } as NativeChangeState;

    await expect(
      finishArchivedNativeWorkspace({
        paths,
        state,
        name: state.name,
        archiveDir: path.join(projectRoot, 'archive'),
        transactionId: 'transaction-id',
        plan: {
          finish: 'merge',
          changeRoot: projectRoot,
          primaryRoot: projectRoot,
          changeBranch,
          targetBranch,
          targetRoot: projectRoot,
          remote: null,
          isolation: 'branch',
        },
      }),
    ).rejects.toBeInstanceOf(NativeWorkspaceFinishError);

    expect(
      execFileSync('git', ['branch', '--show-current'], {
        cwd: projectRoot,
        encoding: 'utf8',
      }).trim(),
    ).toBe(changeBranch);
    expect(() =>
      execFileSync('git', ['rev-parse', '--verify', 'MERGE_HEAD'], {
        cwd: projectRoot,
        stdio: 'ignore',
      }),
    ).toThrow();
  });
});
