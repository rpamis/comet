import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const git = vi.hoisted(() => ({
  gitBranchRemote: vi.fn(),
  gitStatusPaths: vi.fn(),
  gitWorktreeIsClean: vi.fn(),
  runGitCommand: vi.fn(),
}));
const worktree = vi.hoisted(() => ({
  inspectGitWorktree: vi.fn(),
  listGitWorktreeRoots: vi.fn(),
}));
const workspace = vi.hoisted(() => ({
  inspectNativeWorkspaceBinding: vi.fn(),
}));
const external = vi.hoisted(() => ({ runExternalCommand: vi.fn() }));

vi.mock('../../../platform/process/git.js', () => git);
vi.mock('../../../platform/paths/git-worktree.js', () => worktree);
vi.mock('../../../platform/process/external-command.js', () => external);
vi.mock('../../../domains/comet-native/native-workspace.js', () => workspace);

import {
  finishArchivedNativeWorkspace,
  NativeWorkspaceFinishError,
  prepareNativePortableWorkspaceFinish,
  prepareNativeWorkspaceFinish,
} from '../../../domains/comet-native/native-workspace-finish.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import type {
  NativeProjectPaths,
  NativeChangeState,
} from '../../../domains/comet-native/native-types.js';
import type { NativeWorkspaceIdentityV3 } from '../../../domains/comet-native/native-workspace.js';

const projectRoot = path.resolve('D:/native-workspace-finish-test');
const paths: NativeProjectPaths = {
  projectRoot,
  configFile: path.join(projectRoot, '.comet', 'config.yaml'),
  artifactRoot: projectRoot,
  artifactRootRef: '.',
  nativeRoot: path.join(projectRoot, 'comet'),
  specsDir: path.join(projectRoot, 'comet', 'specs'),
  changesDir: path.join(projectRoot, 'comet', 'changes'),
  archiveDir: path.join(projectRoot, 'comet', 'archive'),
  runtimeDir: path.join(projectRoot, '.comet', 'runtime', 'native'),
  changesRuntimeDir: path.join(projectRoot, '.comet', 'runtime', 'native', 'changes'),
  locksDir: path.join(projectRoot, '.comet', 'runtime', 'native', 'locks'),
  transactionsDir: path.join(projectRoot, '.comet', 'runtime', 'native', 'transactions'),
};

const identity = (): NativeWorkspaceIdentityV3 => ({
  schema: 'comet.native.workspace.v3',
  capturedAt: '2026-08-12T00:00:00.000Z',
  capturedRevision: 1,
  nativeRootRef: 'comet',
  projectRootId: 'a'.repeat(64),
  nativeRootId: 'b'.repeat(64),
  projectRootPathId: 'c'.repeat(64),
  nativeRootPathId: 'd'.repeat(64),
  sessionHash: 'e'.repeat(64),
  isolation: 'branch',
  changeBranch: 'comet/change',
  targetBranch: 'main',
  finish: 'keep',
});

const state = { name: 'example', spec_changes: [] } as NativeChangeState;

function plan(overrides: Record<string, unknown> = {}) {
  return {
    finish: 'keep' as const,
    changeRoot: projectRoot,
    primaryRoot: projectRoot,
    changeBranch: 'comet/change',
    targetBranch: 'main',
    targetRoot: projectRoot,
    remote: null,
    isolation: 'branch' as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  git.gitBranchRemote.mockReturnValue('origin');
  git.gitStatusPaths.mockReturnValue([]);
  git.gitWorktreeIsClean.mockReturnValue(true);
  git.runGitCommand.mockImplementation((_root: string, args: readonly string[]) => {
    if (args[0] === 'config') return 'Native Test';
    if (args[0] === 'rev-parse') return 'a'.repeat(40);
    return '';
  });
  worktree.inspectGitWorktree.mockReturnValue({
    isGitWorktree: true,
    currentBranch: 'comet/change',
    primaryWorktreeRoot: projectRoot,
    isSecondaryWorktree: false,
  });
  worktree.listGitWorktreeRoots.mockReturnValue([projectRoot]);
  workspace.inspectNativeWorkspaceBinding.mockResolvedValue({
    state: 'aligned',
    code: null,
    message: null,
  });
  external.runExternalCommand.mockReturnValue('gh version 2');
});

describe('Native workspace finish preparation', () => {
  it('accepts current, branch, push, and pull-request finishes', async () => {
    await expect(
      prepareNativeWorkspaceFinish({
        paths,
        state,
        workspace: { ...identity(), isolation: 'current', changeBranch: null, targetBranch: null },
      }),
    ).resolves.toBeNull();

    await expect(
      prepareNativeWorkspaceFinish({ paths, state, workspace: identity() }),
    ).resolves.toMatchObject({ finish: 'keep', isolation: 'branch', targetRoot: projectRoot });

    for (const finish of ['push', 'pull-request'] as const) {
      await expect(
        prepareNativeWorkspaceFinish({ paths, state, workspace: { ...identity(), finish } }),
      ).resolves.toMatchObject({ finish, remote: 'origin' });
    }
    expect(external.runExternalCommand).toHaveBeenCalledWith(
      'gh',
      ['--version'],
      expect.objectContaining({ timeoutMs: 10_000 }),
    );
  });

  it('rejects incomplete, conflicting, drifted, dirty, and unconfigured finishes', async () => {
    await expect(
      prepareNativeWorkspaceFinish({ paths, state, workspace: { ...identity(), finish: null } }),
    ).rejects.toThrow(/not persisted/u);
    await expect(
      prepareNativeWorkspaceFinish({
        paths,
        state,
        workspace: { ...identity(), targetBranch: 'comet/change' },
      }),
    ).rejects.toThrow(/different/u);

    workspace.inspectNativeWorkspaceBinding.mockResolvedValueOnce({
      state: 'drifted',
      code: 'workspace-branch-changed',
      message: 'wrong branch',
    });
    await expect(
      prepareNativeWorkspaceFinish({ paths, state, workspace: identity() }),
    ).rejects.toThrow(/wrong branch/u);

    worktree.inspectGitWorktree.mockReturnValueOnce({
      isGitWorktree: true,
      currentBranch: 'comet/change',
      primaryWorktreeRoot: null,
      isSecondaryWorktree: false,
    });
    await expect(
      prepareNativeWorkspaceFinish({ paths, state, workspace: identity() }),
    ).rejects.toThrow(/registered Git worktree/u);

    git.runGitCommand.mockImplementation((_root: string, args: readonly string[]) =>
      args[0] === 'config' ? '' : 'a'.repeat(40),
    );
    await expect(
      prepareNativeWorkspaceFinish({ paths, state, workspace: identity() }),
    ).rejects.toThrow(/user.name/u);

    git.runGitCommand.mockImplementation((_root: string, args: readonly string[]) => {
      if (args[0] === 'config') return 'Native Test';
      if (args[0] === 'rev-parse') return 'a'.repeat(40);
      return '';
    });
    git.gitStatusPaths.mockReturnValueOnce(['src/unrelated.ts']);
    await expect(
      prepareNativeWorkspaceFinish({ paths, state, workspace: identity() }),
    ).rejects.toThrow(/remaining paths/u);
  });

  it('requires a registered clean target worktree for worktree merge', async () => {
    const worktreeIdentity = {
      ...identity(),
      isolation: 'worktree' as const,
      finish: 'merge' as const,
    };
    worktree.listGitWorktreeRoots.mockReturnValue([]);
    await expect(
      prepareNativeWorkspaceFinish({ paths, state, workspace: worktreeIdentity }),
    ).rejects.toThrow(/registered worktree/u);

    worktree.listGitWorktreeRoots.mockReturnValue([projectRoot]);
    worktree.inspectGitWorktree.mockReturnValue({
      isGitWorktree: true,
      currentBranch: 'main',
      primaryWorktreeRoot: projectRoot,
      isSecondaryWorktree: false,
    });
    git.gitWorktreeIsClean.mockReturnValueOnce(false);
    await expect(
      prepareNativeWorkspaceFinish({ paths, state, workspace: worktreeIdentity }),
    ).rejects.toThrow(/not clean/u);
  });

  it('prepares the portable schema with archive-owned paths allowed', async () => {
    const portable = {
      name: 'example',
      workspace: {
        isolation: 'branch',
        change_branch: 'comet/change',
        target_branch: 'main',
        finish: 'keep',
      },
    } as NativePortableState;
    await expect(
      prepareNativePortableWorkspaceFinish({
        paths,
        state: portable,
        archiveDir: path.join(projectRoot, 'comet', 'archive', 'example'),
      }),
    ).resolves.toMatchObject({ finish: 'keep', changeBranch: 'comet/change' });

    await expect(
      prepareNativePortableWorkspaceFinish({
        paths,
        state: { ...portable, workspace: { ...portable.workspace, isolation: 'current' } },
      }),
    ).resolves.toBeNull();
    await expect(
      prepareNativePortableWorkspaceFinish({
        paths,
        state: { ...portable, workspace: { ...portable.workspace, finish: null } },
      }),
    ).rejects.toThrow(/not persisted/u);
  });
});

describe('Native archived workspace finish', () => {
  it('keeps a clean archive commit without publishing or merging', async () => {
    await expect(
      finishArchivedNativeWorkspace({
        paths,
        state,
        name: state.name,
        archiveDir: path.join(projectRoot, 'comet', 'archive', state.name),
        transactionId: 'tx-1',
        plan: plan(),
      }),
    ).resolves.toMatchObject({ status: 'kept', commit: 'a'.repeat(40), pushed: false });
    expect(git.runGitCommand).toHaveBeenCalledWith(projectRoot, [
      'diff',
      '--cached',
      '--name-only',
      '-z',
    ]);
  });

  it('publishes, opens a pull request, and cleans a detached change worktree', async () => {
    external.runExternalCommand.mockImplementation((command: string, args: readonly string[]) =>
      command === 'gh' && args[0] === 'pr' ? 'https://github.com/example/pr/1\n' : 'gh version 2',
    );
    const result = await finishArchivedNativeWorkspace({
      paths,
      state,
      name: state.name,
      archiveDir: path.join(projectRoot, 'comet', 'archive', state.name),
      transactionId: 'tx-2',
      plan: plan({ finish: 'pull-request', remote: 'origin', isolation: 'worktree' }),
    });
    expect(result).toMatchObject({
      status: 'completed',
      pushed: true,
      pullRequestUrl: 'https://github.com/example/pr/1',
      cleanup: { performed: true },
    });
    expect(git.runGitCommand).toHaveBeenCalledWith(projectRoot, [
      'worktree',
      'remove',
      projectRoot,
    ]);
  });

  it('returns a blocked result for an unexpected archive path and exposes recovery args', async () => {
    git.gitStatusPaths.mockReturnValue(['unrelated.txt']);
    const rejection = finishArchivedNativeWorkspace({
      paths,
      state,
      name: state.name,
      archiveDir: path.join(projectRoot, 'comet', 'archive', state.name),
      transactionId: 'tx-3',
      plan: plan({ finish: 'merge' }),
    });
    await expect(rejection).rejects.toBeInstanceOf(NativeWorkspaceFinishError);
    await expect(rejection).rejects.toMatchObject({
      result: {
        status: 'blocked',
        recoveryArgs: ['git', '-C', projectRoot, 'status', '--short'],
      },
    });
  });

  it('merges a branch finish and restores the branch when merge fails', async () => {
    const merge = plan({ finish: 'merge' });
    await expect(
      finishArchivedNativeWorkspace({
        paths,
        state,
        name: state.name,
        archiveDir: path.join(projectRoot, 'comet', 'archive', state.name),
        transactionId: 'tx-4',
        plan: merge,
      }),
    ).resolves.toMatchObject({ merged: true, targetRoot: projectRoot });

    git.runGitCommand.mockImplementation((_root: string, args: readonly string[]) => {
      if (args[0] === 'config') return 'Native Test';
      if (args[0] === 'rev-parse') return 'a'.repeat(40);
      if (args[0] === 'merge') throw new Error('merge conflict');
      return '';
    });
    worktree.inspectGitWorktree
      .mockReturnValueOnce({ currentBranch: 'main' })
      .mockReturnValueOnce({ currentBranch: 'comet/change' });
    const failed = finishArchivedNativeWorkspace({
      paths,
      state,
      name: state.name,
      archiveDir: path.join(projectRoot, 'comet', 'archive', state.name),
      transactionId: 'tx-5',
      plan: merge,
    });
    await expect(failed).rejects.toMatchObject({ result: { status: 'blocked' } });
    expect(git.runGitCommand).toHaveBeenCalledWith(projectRoot, ['merge', '--abort']);
    expect(git.runGitCommand).toHaveBeenCalledWith(projectRoot, ['switch', 'comet/change']);
  });
});
