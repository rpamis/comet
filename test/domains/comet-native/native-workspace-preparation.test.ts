import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const git = vi.hoisted(() => ({
  assertValidGitBranchName: vi.fn(),
  gitWorktreeIsClean: vi.fn(),
  runGitCommand: vi.fn(),
}));
const worktree = vi.hoisted(() => ({
  inspectGitWorktree: vi.fn(),
  isLocalGitBranch: vi.fn(),
  listGitWorktrees: vi.fn(),
  listGitWorktreeRoots: vi.fn(),
}));
const config = vi.hoisted(() => ({
  readProjectConfig: vi.fn(),
  writeProjectConfig: vi.fn(),
}));

vi.mock('../../../platform/process/git.js', () => git);
vi.mock('../../../platform/paths/git-worktree.js', () => worktree);
vi.mock('../../../domains/comet-native/native-config.js', () => config);

import {
  NativeWorkspacePreparationError,
  prepareNativeWorkspace,
} from '../../../domains/comet-native/native-workspace-preparation.js';
import type { CometProjectConfig } from '../../../domains/comet-native/native-types.js';

describe('Native workspace preparation', () => {
  let projectRoot: string;
  const sourceConfig = { native: { artifact_root: 'docs' } } as CometProjectConfig;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-workspace-preparation-'));
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    vi.resetAllMocks();
    git.gitWorktreeIsClean.mockReturnValue(true);
    git.runGitCommand.mockImplementation((_root: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse') return '.git';
      return '';
    });
    worktree.inspectGitWorktree.mockReturnValue({
      isGitWorktree: true,
      currentBranch: 'main',
      primaryWorktreeRoot: projectRoot,
      currentWorktreeRoot: projectRoot,
      isSecondaryWorktree: false,
    });
    worktree.isLocalGitBranch.mockReturnValue(true);
    worktree.listGitWorktreeRoots.mockReturnValue([projectRoot]);
    worktree.listGitWorktrees.mockReturnValue([]);
    config.readProjectConfig.mockResolvedValue(null);
    config.writeProjectConfig.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('handles current isolation and rejects detached or conflicting options', async () => {
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'example',
        isolation: 'current',
        sourceConfig: null,
      }),
    ).resolves.toMatchObject({
      binding: { isolation: 'current', changeBranch: 'main', targetBranch: 'main' },
      preparation: { createdBranch: false, createdWorktree: false },
    });

    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'example',
        isolation: 'current',
        changeBranch: 'comet/example',
        sourceConfig: null,
      }),
    ).rejects.toThrow('does not accept');

    worktree.inspectGitWorktree.mockReturnValueOnce({
      isGitWorktree: true,
      currentBranch: null,
      primaryWorktreeRoot: projectRoot,
      currentWorktreeRoot: projectRoot,
      isSecondaryWorktree: false,
    });
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'detached',
        isolation: 'current',
        sourceConfig: null,
      }),
    ).rejects.toThrow('detached HEAD');
  });

  it('prepares a new branch, resumes an existing branch, and wraps config failure', async () => {
    worktree.isLocalGitBranch.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'new-branch',
        isolation: 'branch',
        sourceConfig,
      }),
    ).resolves.toMatchObject({
      binding: { changeBranch: 'comet/new-branch', targetBranch: 'main' },
      preparation: { createdBranch: true, configInitialized: true },
    });
    expect(git.runGitCommand).toHaveBeenCalledWith(projectRoot, [
      'switch',
      '-c',
      'comet/new-branch',
      'main',
    ]);

    worktree.inspectGitWorktree.mockReturnValue({
      isGitWorktree: true,
      currentBranch: 'comet/resumed',
      primaryWorktreeRoot: projectRoot,
      currentWorktreeRoot: projectRoot,
      isSecondaryWorktree: false,
    });
    config.readProjectConfig.mockResolvedValue(sourceConfig);
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'resumed',
        isolation: 'branch',
        changeBranch: 'comet/resumed',
        targetBranch: 'main',
        sourceConfig,
      }),
    ).resolves.toMatchObject({ preparation: { createdBranch: false, configInitialized: false } });

    config.readProjectConfig.mockResolvedValue({ native: { artifact_root: 'other' } });
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'resumed',
        isolation: 'branch',
        changeBranch: 'comet/resumed',
        targetBranch: 'main',
        sourceConfig,
      }),
    ).rejects.toBeInstanceOf(NativeWorkspacePreparationError);
  });

  it('fails closed for branch prerequisites and dirty creation', async () => {
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'no-target',
        isolation: 'branch',
        changeBranch: 'main',
        sourceConfig: null,
      }),
    ).rejects.toThrow('requires --target-branch');

    worktree.isLocalGitBranch.mockReturnValue(false);
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'bad-target',
        isolation: 'branch',
        targetBranch: 'missing',
        sourceConfig: null,
      }),
    ).rejects.toThrow('not a verified local branch');

    worktree.isLocalGitBranch.mockReturnValue(true);
    git.gitWorktreeIsClean.mockReturnValue(false);
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'dirty',
        isolation: 'branch',
        targetBranch: 'main',
        sourceConfig: null,
      }),
    ).rejects.toThrow('clean current working directory');

    git.gitWorktreeIsClean.mockReturnValue(true);
    worktree.isLocalGitBranch.mockReturnValueOnce(true).mockReturnValueOnce(true);
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'existing',
        isolation: 'branch',
        targetBranch: 'main',
        sourceConfig: null,
      }),
    ).rejects.toThrow('already exists');

    worktree.inspectGitWorktree.mockReturnValueOnce({ isGitWorktree: false });
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'not-git',
        isolation: 'branch',
        sourceConfig: null,
      }),
    ).rejects.toThrow('attached Git branch');
  });

  it('reuses and validates an already prepared linked worktree', async () => {
    worktree.inspectGitWorktree.mockReturnValue({
      isGitWorktree: true,
      currentBranch: 'comet/example',
      primaryWorktreeRoot: projectRoot,
      currentWorktreeRoot: projectRoot,
      isSecondaryWorktree: true,
    });
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'example',
        isolation: 'worktree',
        targetBranch: 'main',
        worktreePath: '.',
        sourceConfig: sourceConfig,
      }),
    ).resolves.toMatchObject({
      binding: { isolation: 'worktree', changeBranch: 'comet/example' },
      preparation: { worktreePath: projectRoot, configInitialized: true },
    });

    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'example',
        isolation: 'worktree',
        targetBranch: 'main',
        worktreePath: 'other',
        sourceConfig: null,
      }),
    ).rejects.toThrow('does not match');

    worktree.inspectGitWorktree.mockReturnValueOnce({
      isGitWorktree: true,
      currentBranch: 'comet/example',
      primaryWorktreeRoot: projectRoot,
      currentWorktreeRoot: projectRoot,
      isSecondaryWorktree: false,
    });
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'example',
        isolation: 'worktree',
        targetBranch: 'main',
        sourceConfig: null,
      }),
    ).rejects.toThrow('linked Git worktree');
  });

  it('creates, resumes, prunes, and excludes an isolated worktree', async () => {
    const worktreePath = path.join(projectRoot, '.worktrees', 'example');
    worktree.listGitWorktrees.mockReturnValueOnce([]);
    worktree.isLocalGitBranch
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'example',
        isolation: 'worktree',
        sourceConfig,
      }),
    ).resolves.toMatchObject({
      projectRoot: worktreePath,
      preparation: { createdBranch: true, createdWorktree: true, gitExcludeUpdated: true },
    });
    expect(git.runGitCommand).toHaveBeenCalledWith(projectRoot, [
      'worktree',
      'add',
      '-b',
      'comet/example',
      worktreePath,
      'main',
    ]);

    const exclude = await fs.readFile(path.join(projectRoot, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('/.worktrees/example/');

    const existingRoot = path.join(projectRoot, 'existing-worktree');
    await fs.mkdir(existingRoot);
    worktree.listGitWorktrees.mockReturnValue([{ root: existingRoot, branch: 'comet/example' }]);
    config.readProjectConfig.mockResolvedValue(sourceConfig);
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'example',
        isolation: 'worktree',
        targetBranch: 'main',
        worktreePath: 'existing-worktree',
        sourceConfig,
      }),
    ).resolves.toMatchObject({
      projectRoot: existingRoot,
      preparation: { createdWorktree: false },
    });

    worktree.listGitWorktrees
      .mockReturnValueOnce([{ root: path.join(projectRoot, 'stale'), branch: 'comet/stale' }])
      .mockReturnValueOnce([]);
    worktree.isLocalGitBranch.mockReturnValue(true);
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'stale',
        isolation: 'worktree',
        sourceConfig: null,
      }),
    ).resolves.toMatchObject({ preparation: { createdBranch: false, createdWorktree: true } });
    expect(git.runGitCommand).toHaveBeenCalledWith(projectRoot, ['worktree', 'prune']);
  });

  it('rejects registered or unsafe worktree destinations and wraps creation errors', async () => {
    worktree.listGitWorktrees.mockReturnValue([{ root: 'other', branch: 'comet/example' }]);
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'example',
        isolation: 'worktree',
        sourceConfig: null,
      }),
    ).rejects.toThrow('already registered to a worktree');

    worktree.listGitWorktrees.mockReturnValue([]);
    git.runGitCommand.mockImplementation((_root: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse') return '.git';
      if (args[0] === 'worktree' && args[1] === 'add') throw new Error('worktree failed');
      return '';
    });
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'failed',
        isolation: 'worktree',
        sourceConfig: null,
      }),
    ).rejects.toMatchObject({
      name: 'NativeWorkspacePreparationError',
      preparation: { createdWorktree: false, gitExcludeUpdated: true },
    });

    const common = path.join(projectRoot, '.git', 'common');
    git.runGitCommand.mockImplementation((_root: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse') return common;
      return '';
    });
    await expect(
      prepareNativeWorkspace({
        projectRoot,
        name: 'unsafe',
        isolation: 'worktree',
        worktreePath: '.git/common/inside',
        sourceConfig: null,
      }),
    ).rejects.toThrow('inside the Git common directory');
  });
});
