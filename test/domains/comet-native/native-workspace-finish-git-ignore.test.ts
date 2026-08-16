import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  finishArchivedNativeWorkspace,
  type NativeWorkspaceFinishPlan,
} from '../../../domains/comet-native/native-workspace-finish.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';

describe('Native workspace finish Git ignore behavior', () => {
  let projectRoot: string | undefined;

  afterEach(async () => {
    if (projectRoot) await fs.rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  });

  it('skips ignored untracked archive artifacts instead of blocking finish', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-finish-ignore-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: projectRoot });
    await fs.writeFile(path.join(projectRoot, '.gitignore'), '/docs/\n');
    await fs.writeFile(path.join(projectRoot, 'README.md'), 'baseline\n');
    execFileSync('git', ['add', '.gitignore', 'README.md'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: projectRoot, stdio: 'ignore' });

    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const archiveDir = path.join(paths.archiveDir, 'ignored-change');
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.writeFile(path.join(archiveDir, 'verification.md'), '# Verification\n');

    const plan: NativeWorkspaceFinishPlan = {
      finish: 'keep',
      changeRoot: projectRoot,
      primaryRoot: projectRoot,
      changeBranch: 'comet/ignored-change',
      targetBranch: 'main',
      targetRoot: projectRoot,
      remote: null,
      isolation: 'branch',
    };

    await expect(
      finishArchivedNativeWorkspace({
        paths,
        state: { name: 'ignored-change', spec_changes: [] } as NativePortableState,
        name: 'ignored-change',
        archiveDir,
        transactionId: 'tx-ignore',
        plan,
      }),
    ).resolves.toMatchObject({ status: 'kept', pushed: false, merged: false });
  });

  it('stages tracked artifacts even when their directory is ignored', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-finish-tracked-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: projectRoot });
    await fs.writeFile(path.join(projectRoot, '.gitignore'), '/docs/\n');
    await fs.writeFile(path.join(projectRoot, 'README.md'), 'baseline\n');
    const trackedArtifact = path.join(
      projectRoot,
      'docs',
      'comet',
      'archive',
      'tracked-change',
      'verification.md',
    );
    await fs.mkdir(path.dirname(trackedArtifact), { recursive: true });
    await fs.writeFile(trackedArtifact, 'before\n');
    execFileSync('git', ['add', '.gitignore', 'README.md'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', '-f', '--', 'docs/comet/archive/tracked-change/verification.md'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: projectRoot, stdio: 'ignore' });
    await fs.writeFile(trackedArtifact, 'after\n');

    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const archiveDir = path.join(paths.archiveDir, 'tracked-change');
    const plan: NativeWorkspaceFinishPlan = {
      finish: 'keep',
      changeRoot: projectRoot,
      primaryRoot: projectRoot,
      changeBranch: 'comet/tracked-change',
      targetBranch: 'main',
      targetRoot: projectRoot,
      remote: null,
      isolation: 'branch',
    };

    await expect(
      finishArchivedNativeWorkspace({
        paths,
        state: { name: 'tracked-change', spec_changes: [] } as NativePortableState,
        name: 'tracked-change',
        archiveDir,
        transactionId: 'tx-tracked',
        plan,
      }),
    ).resolves.toMatchObject({ status: 'kept', pushed: false, merged: false });
    expect(
      execFileSync('git', ['show', '--format=', '--name-only', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
      }),
    ).toContain('docs/comet/archive/tracked-change/verification.md');
  });
});
