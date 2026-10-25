import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  finishArchivedNativeWorkspace,
  NativeWorkspaceFinishError,
  listNativeWorkspaceFinishJournals,
  quarantineNativeWorkspaceFinishJournal,
  readNativeWorkspaceFinishJournal,
} from '../../../domains/comet-native/native-workspace-finish.js';
import { nativeChangeDir } from '../../../domains/comet-native/native-change.js';
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

  it('fetches missing gitlink commits from the change checkout before an authorized worktree merge', async () => {
    const target = path.join(projectRoot, 'aggregate');
    const change = path.join(projectRoot, 'aggregate-change');
    const dependency = path.join(target, 'dependency');
    await fs.mkdir(dependency, { recursive: true });
    const git = (cwd: string, ...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args],
        { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
    git(target, 'init', '-q', '-b', 'main');
    await fs.writeFile(path.join(target, '.gitignore'), '.comet/runtime\n');
    git(dependency, 'init', '-q');
    await fs.writeFile(path.join(dependency, 'value.txt'), 'baseline\n');
    git(dependency, 'add', '.');
    git(dependency, 'commit', '-qm', 'baseline');
    git(target, 'add', 'dependency', '.gitignore');
    git(target, 'commit', '-qm', 'baseline');
    git(target, 'worktree', 'add', '-q', '-b', 'change', change);
    git(change, 'clone', '-q', '--no-local', dependency, path.join(change, 'dependency'));
    await fs.writeFile(path.join(dependency, 'value.txt'), 'target\n');
    git(dependency, 'commit', '-qam', 'target');
    const targetChild = git(dependency, 'rev-parse', 'HEAD');
    git(target, 'add', 'dependency');
    git(target, 'commit', '-qm', 'target pointer');
    const changeDependency = path.join(change, 'dependency');
    git(changeDependency, 'fetch', '-q', dependency, targetChild);
    git(changeDependency, 'checkout', '-q', '--detach', targetChild);
    await fs.writeFile(path.join(changeDependency, 'value.txt'), 'change\n');
    git(changeDependency, 'commit', '-qam', 'change');
    const changeChild = git(changeDependency, 'rev-parse', 'HEAD');
    git(change, 'add', 'dependency');
    git(change, 'commit', '-qm', 'change pointer');
    expect(() => git(dependency, 'cat-file', '-e', `${changeChild}^{commit}`)).toThrow();
    const paths = await nativeProjectPaths(change, 'docs');
    const archiveDir = path.join(paths.archiveDir, '2026-10-25-gitlink-merge');
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.writeFile(path.join(archiveDir, 'brief.md'), 'Archive the verified gitlink.\n');
    const result = await finishArchivedNativeWorkspace({
      paths,
      state: { name: 'gitlink-merge', spec_changes: [] } as unknown as NativeChangeState,
      name: 'gitlink-merge',
      archiveDir,
      transactionId: 'gitlink-merge-transaction',
      plan: {
        finish: 'merge',
        changeRoot: change,
        primaryRoot: target,
        changeBranch: 'change',
        targetBranch: 'main',
        targetRoot: target,
        remote: null,
        isolation: 'worktree',
      },
    });
    expect(result.merged).toBe(true);
    expect(git(dependency, 'cat-file', '-t', changeChild)).toBe('commit');
    expect(git(target, 'ls-tree', 'HEAD', 'dependency')).toContain(changeChild);
    expect(git(dependency, 'rev-parse', 'HEAD')).toBe(targetChild);
  });

  it('keeps malformed finish journals visible and quarantines them only on explicit repair', async () => {
    const paths = await nativeProjectPaths(projectRoot, '.');
    await fs.mkdir(paths.transactionsDir, { recursive: true });
    const file = path.join(paths.transactionsDir, 'workspace-finish-corrupt.json');
    await fs.writeFile(file, '{not-json');

    const errors: Array<{ name: string; message: string }> = [];
    await expect(
      readNativeWorkspaceFinishJournal(paths, 'corrupt', {
        onError: (name, message) => errors.push({ name, message }),
      }),
    ).resolves.toBeNull();
    await expect(
      listNativeWorkspaceFinishJournals(paths, {
        onError: (name, message) => errors.push({ name, message }),
      }),
    ).resolves.toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.name).toBe('corrupt');

    const quarantined = await quarantineNativeWorkspaceFinishJournal(paths, 'corrupt');
    expect(quarantined).toBeTruthy();
    await expect(fs.access(file)).rejects.toThrow();
    await expect(fs.access(quarantined!)).resolves.toBeUndefined();
  });

  it('quarantines a non-regular journal entry without following it', async () => {
    const paths = await nativeProjectPaths(projectRoot, '.');
    await fs.mkdir(paths.transactionsDir, { recursive: true });
    const file = path.join(paths.transactionsDir, 'workspace-finish-corrupt-directory.json');
    await fs.mkdir(file);

    await expect(readNativeWorkspaceFinishJournal(paths, 'corrupt-directory')).rejects.toThrow(
      /not a regular file/i,
    );
    const quarantined = await quarantineNativeWorkspaceFinishJournal(paths, 'corrupt-directory');

    expect(quarantined).toBeTruthy();
    await expect(fs.access(file)).rejects.toThrow();
    await expect(fs.stat(quarantined!)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
  });

  it.each([
    { finish: 'keep' as const, isolation: 'current' as const },
    { finish: 'keep' as const, isolation: 'worktree' as const },
  ])(
    'preserves unrelated changes for $isolation/$finish finishes',
    async ({ finish, isolation }) => {
      const paths = await nativeProjectPaths(projectRoot, '.');
      const name = `kept-${isolation}`;
      const changeDir = nativeChangeDir(paths, name);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'comet-state.yaml'), 'owned change\n');

      const staged = path.join(projectRoot, `unrelated-${isolation}-staged.txt`);
      const working = path.join(projectRoot, `unrelated-${isolation}-working.txt`);
      const untracked = path.join(projectRoot, `unrelated-${isolation}-untracked.txt`);
      await fs.writeFile(staged, 'staged content\n');
      execFileSync('git', ['add', path.basename(staged)], { cwd: projectRoot, stdio: 'ignore' });
      await fs.writeFile(working, 'working content\n');
      await fs.writeFile(untracked, 'untracked content\n');

      const result = await finishArchivedNativeWorkspace({
        paths,
        state: { name, spec_changes: [] } as NativeChangeState,
        name,
        archiveDir: path.join(projectRoot, 'archive', name),
        transactionId: `transaction-${isolation}`,
        plan: {
          finish,
          changeRoot: projectRoot,
          primaryRoot: projectRoot,
          changeBranch,
          targetBranch,
          targetRoot: projectRoot,
          remote: null,
          isolation,
        },
      });

      expect(result).toMatchObject({ status: 'kept', pushed: false, merged: false });
      expect(
        execFileSync('git', ['diff', '--cached', '--name-only'], {
          cwd: projectRoot,
          encoding: 'utf8',
        }).trim(),
      ).toBe(path.basename(staged));
      expect(await fs.readFile(staged, 'utf8')).toBe('staged content\n');
      expect(await fs.readFile(working, 'utf8')).toBe('working content\n');
      expect(await fs.readFile(untracked, 'utf8')).toBe('untracked content\n');
      expect(
        execFileSync('git', ['show', '--format=', '--name-only', result.commit!], {
          cwd: projectRoot,
          encoding: 'utf8',
        }),
      ).toContain(
        path.relative(projectRoot, path.join(changeDir, 'comet-state.yaml')).replaceAll('\\', '/'),
      );
    },
  );
});
