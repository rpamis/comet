import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    vi.unstubAllEnvs();
    if (projectRoot) await fs.rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  });

  it.each(
    (['gitignore', 'info-exclude', 'global-excludes'] as const).flatMap((ignoreSource) =>
      (['branch', 'worktree'] as const).map((isolation) => ({ ignoreSource, isolation })),
    ),
  )(
    'preserves ignored untracked files and commits tracked edits and deletions ($ignoreSource, $isolation)',
    async ({ ignoreSource, isolation }) => {
      projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-finish-ignore-matrix-'));
      const root = path.join(projectRoot, 'repository');
      const home = path.join(projectRoot, 'home');
      await fs.mkdir(root);
      await fs.mkdir(home);
      vi.stubEnv('HOME', home);
      vi.stubEnv('USERPROFILE', home);
      vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(home, '.gitconfig'));
      vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
      const git = (cwd: string, ...args: string[]) =>
        execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git(root, 'init', '-b', 'main');
      git(root, 'config', 'user.email', 'native@example.test');
      git(root, 'config', 'user.name', 'Native Test');
      git(root, 'config', 'commit.gpgsign', 'false');
      const archiveRef = 'docs/comet/archive/ignored-change';
      await fs.mkdir(path.join(root, archiveRef), { recursive: true });
      await fs.writeFile(path.join(root, archiveRef, 'verification.md'), 'before\n');
      await fs.writeFile(path.join(root, archiveRef, 'obsolete.md'), 'delete me\n');
      await fs.writeFile(path.join(root, 'README.md'), 'unrelated baseline\n');
      git(root, 'add', '.');
      git(root, 'commit', '-m', 'baseline');
      if (ignoreSource === 'gitignore') {
        await fs.writeFile(path.join(root, '.gitignore'), '/docs/\n');
        git(root, 'add', '.gitignore');
        git(root, 'commit', '-m', 'ignore untracked documents');
      } else if (ignoreSource === 'info-exclude') {
        await fs.appendFile(path.join(root, '.git/info/exclude'), '\n/docs/\n');
      } else {
        const excludes = path.join(home, 'global-excludes');
        await fs.writeFile(excludes, '/docs/\n');
        git(root, 'config', '--global', 'core.excludesFile', excludes);
      }
      const changeRoot = isolation === 'worktree' ? path.join(projectRoot, 'linked') : root;
      if (isolation === 'worktree')
        git(root, 'worktree', 'add', '-b', 'comet/ignored-change', changeRoot);
      else git(root, 'checkout', '-b', 'comet/ignored-change');
      const paths = await nativeProjectPaths(changeRoot, 'docs');
      await ensureNativeDirectories(paths);
      const archiveDir = path.join(changeRoot, archiveRef);
      await fs.writeFile(path.join(archiveDir, 'verification.md'), 'after\n');
      await fs.rm(path.join(archiveDir, 'obsolete.md'));
      await fs.writeFile(path.join(archiveDir, 'untracked.md'), 'must stay untracked\n');
      await fs.writeFile(path.join(changeRoot, 'README.md'), 'unrelated user edit\n');
      const before = git(changeRoot, 'rev-parse', 'HEAD');
      const plan: NativeWorkspaceFinishPlan = {
        finish: 'keep',
        changeRoot,
        primaryRoot: root,
        changeBranch: 'comet/ignored-change',
        targetBranch: 'main',
        targetRoot: root,
        remote: null,
        isolation,
        pullRequestFinish: null,
      };
      const result = await finishArchivedNativeWorkspace({
        paths,
        state: { name: 'ignored-change', spec_changes: [] } as NativePortableState,
        name: 'ignored-change',
        archiveDir,
        transactionId: 'tx-ignore-matrix',
        plan,
      });
      expect(result).toMatchObject({ status: 'kept', pushed: false, merged: false });
      expect(result.commit).not.toBe(before);
      expect(git(changeRoot, 'show', `HEAD:${archiveRef}/verification.md`)).toBe('after');
      expect(git(changeRoot, 'ls-tree', '-r', '--name-only', 'HEAD', '--', archiveRef)).toBe(
        `${archiveRef}/verification.md`,
      );
      expect(git(changeRoot, 'ls-files', '--', `${archiveRef}/untracked.md`)).toBe('');
      expect(await fs.readFile(path.join(archiveDir, 'untracked.md'), 'utf8')).toBe(
        'must stay untracked\n',
      );
      expect(git(changeRoot, 'diff', '--name-only')).toBe('README.md');
      expect(git(changeRoot, 'show', 'HEAD:README.md')).toBe('unrelated baseline');
      expect(git(changeRoot, 'diff', '--cached', '--name-only')).toBe('');
    },
  );

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
