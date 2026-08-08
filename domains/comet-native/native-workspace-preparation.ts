import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  assertValidGitBranchName,
  gitWorktreeIsClean,
  runGitCommand,
} from '../../platform/process/git.js';
import {
  inspectGitWorktree,
  isLocalGitBranch,
  listGitWorktreeRoots,
} from '../../platform/paths/git-worktree.js';

import { readProjectConfig, writeProjectConfig } from './native-config.js';
import type { CometProjectConfig } from './native-types.js';
import type { NativeWorkspaceBinding, NativeWorkspaceIsolation } from './native-workspace.js';

export interface NativeWorkspacePreparation {
  isolation: NativeWorkspaceIsolation;
  projectRoot: string;
  changeBranch: string | null;
  targetBranch: string | null;
  worktreePath: string | null;
  createdBranch: boolean;
  createdWorktree: boolean;
  gitExcludeUpdated: boolean;
  configInitialized: boolean;
}

export interface PreparedNativeWorkspace {
  projectRoot: string;
  binding: NativeWorkspaceBinding;
  preparation: NativeWorkspacePreparation;
}

export class NativeWorkspacePreparationError extends Error {
  constructor(
    message: string,
    readonly preparation: NativeWorkspacePreparation,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'NativeWorkspacePreparationError';
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function nativeConfigIdentity(config: CometProjectConfig): string {
  return JSON.stringify(config.native);
}

async function ensureConfig(
  targetRoot: string,
  sourceConfig: CometProjectConfig | null,
): Promise<boolean> {
  const targetConfig = await readProjectConfig(targetRoot);
  if (targetConfig && sourceConfig) {
    if (nativeConfigIdentity(targetConfig) !== nativeConfigIdentity(sourceConfig)) {
      throw new Error(
        `Native worktree configuration differs from the source project: ${path.join(targetRoot, '.comet', 'config.yaml')}`,
      );
    }
    return false;
  }
  if (!targetConfig && sourceConfig) {
    await writeProjectConfig(targetRoot, sourceConfig);
    return true;
  }
  return false;
}

async function appendLocalExclude(projectRoot: string, worktreePath: string): Promise<boolean> {
  if (!isInside(projectRoot, worktreePath)) return false;
  const relative = path.relative(projectRoot, worktreePath).replaceAll('\\', '/');
  const pattern = `/${relative.replace(/\/+$/u, '')}/`;
  const rawCommonDir = runGitCommand(projectRoot, ['rev-parse', '--git-common-dir']);
  const commonDir = path.resolve(projectRoot, rawCommonDir);
  const excludeFile = path.join(commonDir, 'info', 'exclude');
  let existing = '';
  try {
    existing = await fs.readFile(excludeFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing.split(/\r?\n/u).includes(pattern)) return false;
  await fs.mkdir(path.dirname(excludeFile), { recursive: true });
  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await fs.appendFile(excludeFile, `${prefix}${pattern}\n`, 'utf8');
  return true;
}

function resolveWorktreePath(
  primaryRoot: string,
  name: string,
  requested: string | undefined,
): string {
  const target = path.resolve(primaryRoot, requested ?? path.join('.worktrees', name));
  const commonDir = path.resolve(
    primaryRoot,
    runGitCommand(primaryRoot, ['rev-parse', '--git-common-dir']),
  );
  if (isInside(commonDir, target)) {
    throw new Error('Native worktree path cannot be inside the Git common directory');
  }
  if (listGitWorktreeRoots(primaryRoot).some((root) => samePath(root, target))) {
    throw new Error(`Native worktree path is already registered: ${target}`);
  }
  return target;
}

async function assertPathAbsent(target: string): Promise<void> {
  try {
    await fs.lstat(target);
    throw new Error(`Native worktree path already exists: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function prepareNativeWorkspace(options: {
  projectRoot: string;
  name: string;
  isolation: NativeWorkspaceIsolation;
  changeBranch?: string;
  targetBranch?: string;
  worktreePath?: string;
  sourceConfig: CometProjectConfig | null;
}): Promise<PreparedNativeWorkspace> {
  const initialRoot = path.resolve(options.projectRoot);
  if (options.isolation === 'current') {
    if (options.changeBranch || options.targetBranch || options.worktreePath) {
      throw new Error(
        'Native current isolation does not accept --change-branch, --target-branch, or --worktree-path',
      );
    }
    const context = inspectGitWorktree(initialRoot);
    if (context.isGitWorktree && context.currentBranch === null) {
      throw new Error('Native workspace binding requires a branch; detached HEAD is not supported');
    }
    return {
      projectRoot: initialRoot,
      binding: {
        isolation: 'current',
        changeBranch: context.currentBranch,
        targetBranch: context.currentBranch,
      },
      preparation: {
        isolation: 'current',
        projectRoot: initialRoot,
        changeBranch: context.currentBranch,
        targetBranch: context.currentBranch,
        worktreePath: null,
        createdBranch: false,
        createdWorktree: false,
        gitExcludeUpdated: false,
        configInitialized: false,
      },
    };
  }

  const context = inspectGitWorktree(initialRoot);
  if (
    !context.isGitWorktree ||
    context.currentBranch === null ||
    context.primaryWorktreeRoot === null ||
    context.currentWorktreeRoot === null
  ) {
    throw new Error('Native branch and worktree isolation require an attached Git branch');
  }
  const changeBranch = options.changeBranch ?? `comet/${options.name}`;
  assertValidGitBranchName(initialRoot, changeBranch);
  const alreadyPrepared = context.currentBranch === changeBranch;
  const targetBranch =
    options.targetBranch ?? (alreadyPrepared ? undefined : context.currentBranch);
  if (!targetBranch) {
    throw new Error(
      'Native isolated workspace already on its change branch requires --target-branch',
    );
  }
  assertValidGitBranchName(initialRoot, targetBranch);
  if (!isLocalGitBranch(initialRoot, targetBranch)) {
    throw new Error(`Native target branch is not a verified local branch: ${targetBranch}`);
  }

  if (options.isolation === 'branch') {
    if (options.worktreePath) {
      throw new Error('--worktree-path is only valid with --isolation worktree');
    }
    let createdBranch = false;
    if (!alreadyPrepared) {
      if (!gitWorktreeIsClean(initialRoot)) {
        throw new Error('Native branch isolation requires a clean current working directory');
      }
      if (isLocalGitBranch(initialRoot, changeBranch)) {
        throw new Error(`Native change branch already exists: ${changeBranch}`);
      }
      runGitCommand(initialRoot, ['switch', '-c', changeBranch, targetBranch]);
      createdBranch = true;
    }
    let configInitialized: boolean;
    try {
      configInitialized = await ensureConfig(initialRoot, options.sourceConfig);
    } catch (error) {
      throw new NativeWorkspacePreparationError(
        `Native branch preparation is incomplete: ${(error as Error).message}`,
        {
          isolation: 'branch',
          projectRoot: initialRoot,
          changeBranch,
          targetBranch,
          worktreePath: null,
          createdBranch,
          createdWorktree: false,
          gitExcludeUpdated: false,
          configInitialized: false,
        },
        { cause: error },
      );
    }
    return {
      projectRoot: initialRoot,
      binding: { isolation: 'branch', changeBranch, targetBranch },
      preparation: {
        isolation: 'branch',
        projectRoot: initialRoot,
        changeBranch,
        targetBranch,
        worktreePath: null,
        createdBranch,
        createdWorktree: false,
        gitExcludeUpdated: false,
        configInitialized,
      },
    };
  }

  if (alreadyPrepared) {
    if (!context.isSecondaryWorktree) {
      throw new Error('Native worktree isolation must use a linked Git worktree');
    }
    const requestedWorktreePath = options.worktreePath
      ? path.resolve(context.primaryWorktreeRoot, options.worktreePath)
      : undefined;
    if (requestedWorktreePath && !samePath(requestedWorktreePath, context.currentWorktreeRoot)) {
      throw new Error(
        `Native worktree path ${requestedWorktreePath} does not match the current worktree ${context.currentWorktreeRoot}`,
      );
    }
    let configInitialized: boolean;
    try {
      configInitialized = await ensureConfig(initialRoot, options.sourceConfig);
    } catch (error) {
      throw new NativeWorkspacePreparationError(
        `Native worktree preparation is incomplete: ${(error as Error).message}`,
        {
          isolation: 'worktree',
          projectRoot: initialRoot,
          changeBranch,
          targetBranch,
          worktreePath: initialRoot,
          createdBranch: false,
          createdWorktree: false,
          gitExcludeUpdated: false,
          configInitialized: false,
        },
        { cause: error },
      );
    }
    return {
      projectRoot: initialRoot,
      binding: { isolation: 'worktree', changeBranch, targetBranch },
      preparation: {
        isolation: 'worktree',
        projectRoot: initialRoot,
        changeBranch,
        targetBranch,
        worktreePath: initialRoot,
        createdBranch: false,
        createdWorktree: false,
        gitExcludeUpdated: false,
        configInitialized,
      },
    };
  }
  if (isLocalGitBranch(initialRoot, changeBranch)) {
    throw new Error(`Native change branch already exists: ${changeBranch}`);
  }
  const worktreePath = resolveWorktreePath(
    context.primaryWorktreeRoot,
    options.name,
    options.worktreePath,
  );
  await assertPathAbsent(worktreePath);
  const gitExcludeUpdated = await appendLocalExclude(context.primaryWorktreeRoot, worktreePath);
  const preparation: NativeWorkspacePreparation = {
    isolation: 'worktree',
    projectRoot: worktreePath,
    changeBranch,
    targetBranch,
    worktreePath,
    createdBranch: false,
    createdWorktree: false,
    gitExcludeUpdated,
    configInitialized: false,
  };
  try {
    runGitCommand(context.primaryWorktreeRoot, [
      'worktree',
      'add',
      '-b',
      changeBranch,
      worktreePath,
      targetBranch,
    ]);
    preparation.createdBranch = true;
    preparation.createdWorktree = true;
    preparation.configInitialized = await ensureConfig(worktreePath, options.sourceConfig);
  } catch (error) {
    throw new NativeWorkspacePreparationError(
      `Native worktree preparation is incomplete: ${(error as Error).message}`,
      preparation,
      { cause: error },
    );
  }
  return {
    projectRoot: worktreePath,
    binding: { isolation: 'worktree', changeBranch, targetBranch },
    preparation,
  };
}
