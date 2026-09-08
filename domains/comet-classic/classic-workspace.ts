import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

import {
  assertValidGitBranchName,
  gitWorktreeIsClean,
  runGitCommand,
} from '../../platform/process/git.js';
import {
  inspectGitWorktree,
  isLocalGitBranch,
  listGitWorktrees,
  type GitWorktreeEntry,
} from '../../platform/paths/git-worktree.js';
import { assertOpenSpecChangeName, inspectClassicActiveChangeDirectory } from './classic-paths.js';
import { readWorkflowProjectConfigDocument } from '../workflow-contract/project-config-reader.js';
import { writeWorkflowProjectConfigSource } from '../workflow-contract/project-config-writer.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { WORKFLOW_PROJECT_CONFIG_MAX_BYTES } from '../workflow-contract/project-config.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { classicLayoutPaths, readClassicArtifactLayout } from './classic-layout.js';

async function ensureWorkspaceConfig(sourceRoot: string, targetRoot: string): Promise<void> {
  if (samePath(sourceRoot, targetRoot)) return;
  const options = { allowPartialProject: true, allowMissingNativeFields: true };
  const source = await readWorkflowProjectConfigDocument(sourceRoot, options);
  if (!source) return;
  const target = await readWorkflowProjectConfigDocument(targetRoot, options);
  if (target) {
    if (JSON.stringify(source.classic) !== JSON.stringify(target.classic)) {
      throw new Error(
        `Classic worktree configuration differs from the source project: ${targetRoot}`,
      );
    }
  } else {
    const content = await readProtectedProjectFile(
      sourceRoot,
      '.comet/config.yaml',
      WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
      { label: 'Classic workspace configuration' },
    );
    await writeWorkflowProjectConfigSource(targetRoot, content.bytes.toString('utf8'), {
      allowPartialProject: true,
      expectedIdentity: { exists: false, sha256: null },
    });
  }
  await readClassicArtifactLayout(targetRoot);
  const layout = classicLayoutPaths(sourceRoot, await readClassicArtifactLayout(sourceRoot));
  const relativeConfig = path.relative(sourceRoot, path.join(layout.openSpecRoot, 'config.yaml'));
  const targetConfig = await inspectProtectedProjectPath(targetRoot, relativeConfig, {
    expected: 'file',
    label: 'Classic OpenSpec workspace configuration',
  });
  let openSpecContent;
  try {
    openSpecContent = await readProtectedProjectFile(sourceRoot, relativeConfig, 1024 * 1024, {
      label: 'Classic OpenSpec workspace configuration',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (targetConfig.exists) {
    const targetContent = await readProtectedProjectFile(targetRoot, relativeConfig, 1024 * 1024, {
      label: 'Classic OpenSpec workspace configuration',
    });
    if (
      openSpecContent.bytes.toString('utf8').replaceAll('\r\n', '\n') !==
      targetContent.bytes.toString('utf8').replaceAll('\r\n', '\n')
    ) {
      throw new Error(
        `Classic OpenSpec configuration differs from the source project: ${targetRoot}`,
      );
    }
    return;
  }
  await atomicWriteContainedText(
    path.join(targetRoot, relativeConfig),
    openSpecContent.bytes.toString('utf8'),
    {
      containedRoot: targetRoot,
      exclusive: true,
    },
  );
}

async function excludeWorktree(primaryRoot: string, worktreeRoot: string): Promise<void> {
  const relative = path.relative(primaryRoot, worktreeRoot).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return;
  if (/[\r\n]/u.test(relative)) throw new Error('Classic worktree path must not contain newlines');
  const escaped = relative
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('*', '\\*')
    .replaceAll('?', '\\?');
  const pattern = `/${escaped}/`;
  const common = path.resolve(
    primaryRoot,
    runGitCommand(primaryRoot, ['rev-parse', '--git-common-dir']),
  );
  const file = path.join(common, 'info', 'exclude');
  let source = '';
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (source.split(/\r?\n/u).includes(pattern)) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${source && !source.endsWith('\n') ? '\n' : ''}${pattern}\n`, 'utf8');
}

export type ClassicWorkspaceIsolation = 'current' | 'branch' | 'worktree';

export interface ClassicWorkspacePreparation {
  schema: 'comet.classic.workspace-preparation.v1';
  isolation: ClassicWorkspaceIsolation;
  projectRoot: string;
  changeBranch: string | null;
  targetBranch: string | null;
  worktreePath: string | null;
  createdBranch: boolean;
  createdWorktree: boolean;
  reusedWorktree: boolean;
}

export interface ClassicWorkspaceResolution {
  schema: 'comet.classic.workspace-resolution.v1';
  change: string;
  projectRoot: string;
  branch: string | null;
  isolation: string | null;
  routed: boolean;
  recreatedWorktree: boolean;
}

interface ClassicWorkspaceCandidate {
  projectRoot: string;
  worktree: GitWorktreeEntry | null;
  changeDirectory: string;
  isolation: string | null;
  boundBranch: string | null;
  branch: string | null;
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

async function assertPathAbsent(target: string): Promise<void> {
  try {
    await fs.lstat(target);
    throw new Error(`Classic worktree path already exists: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function resolveWorktreePath(primaryRoot: string, name: string, requested?: string): string {
  const target = path.resolve(primaryRoot, requested ?? path.join('.worktrees', name));
  if (!isInside(primaryRoot, target)) {
    throw new Error('Classic worktree path must remain inside the primary worktree');
  }
  const commonDir = path.resolve(
    primaryRoot,
    runGitCommand(primaryRoot, ['rev-parse', '--git-common-dir']),
  );
  if (isInside(commonDir, target)) {
    throw new Error('Classic worktree path cannot be inside the Git common directory');
  }
  return target;
}

function requestedWorktreePath(
  primaryRoot: string,
  requested: string | undefined,
): string | undefined {
  return requested === undefined ? undefined : path.resolve(primaryRoot, requested);
}

function findWorktreeByBranch(
  entries: readonly GitWorktreeEntry[],
  branch: string,
): GitWorktreeEntry | undefined {
  return entries.find((entry) => entry.branch === branch);
}

function preparation(
  values: Omit<ClassicWorkspacePreparation, 'schema'>,
): ClassicWorkspacePreparation {
  return { schema: 'comet.classic.workspace-preparation.v1', ...values };
}

export async function prepareClassicWorkspace(options: {
  projectRoot: string;
  name: string;
  isolation: ClassicWorkspaceIsolation;
  changeBranch?: string;
  targetBranch?: string;
  worktreePath?: string;
}): Promise<ClassicWorkspacePreparation> {
  assertOpenSpecChangeName(options.name);
  const initialRoot = path.resolve(options.projectRoot);
  const context = inspectGitWorktree(initialRoot);
  if (options.isolation === 'current') {
    if (options.changeBranch || options.targetBranch || options.worktreePath) {
      throw new Error(
        'Classic current isolation does not accept --change-branch, --target-branch, or --worktree-path',
      );
    }
    return preparation({
      isolation: 'current',
      projectRoot: initialRoot,
      changeBranch: context.currentBranch,
      targetBranch: context.currentBranch,
      worktreePath: null,
      createdBranch: false,
      createdWorktree: false,
      reusedWorktree: false,
    });
  }

  if (
    !context.isGitWorktree ||
    context.currentBranch === null ||
    context.primaryWorktreeRoot === null ||
    context.currentWorktreeRoot === null
  ) {
    throw new Error('Classic branch and worktree isolation require an attached Git branch');
  }

  const primaryRoot = context.primaryWorktreeRoot;
  const changeBranch = options.changeBranch ?? `comet/${options.name}`;
  assertValidGitBranchName(initialRoot, changeBranch);
  const targetBranch = options.targetBranch ?? context.currentBranch;
  assertValidGitBranchName(initialRoot, targetBranch);
  if (!isLocalGitBranch(initialRoot, targetBranch)) {
    throw new Error(`Classic target branch is not a verified local branch: ${targetBranch}`);
  }

  if (options.isolation === 'branch') {
    if (options.worktreePath) {
      throw new Error('--worktree-path is only valid with --isolation worktree');
    }
    if (context.currentBranch === changeBranch) {
      return preparation({
        isolation: 'branch',
        projectRoot: initialRoot,
        changeBranch,
        targetBranch,
        worktreePath: null,
        createdBranch: false,
        createdWorktree: false,
        reusedWorktree: false,
      });
    }
    if (!gitWorktreeIsClean(initialRoot)) {
      throw new Error('Classic branch isolation requires a clean current working directory');
    }
    if (isLocalGitBranch(initialRoot, changeBranch)) {
      throw new Error(`Classic change branch already exists: ${changeBranch}`);
    }
    runGitCommand(initialRoot, ['switch', '-c', changeBranch, targetBranch]);
    return preparation({
      isolation: 'branch',
      projectRoot: initialRoot,
      changeBranch,
      targetBranch,
      worktreePath: null,
      createdBranch: true,
      createdWorktree: false,
      reusedWorktree: false,
    });
  }

  if (context.currentBranch === changeBranch) {
    if (!context.isSecondaryWorktree) {
      throw new Error('Classic worktree isolation must use a linked Git worktree');
    }
    const requested = requestedWorktreePath(primaryRoot, options.worktreePath);
    if (requested && !samePath(requested, context.currentWorktreeRoot)) {
      throw new Error(
        `Classic worktree path ${requested} does not match the current worktree ${context.currentWorktreeRoot}`,
      );
    }
    await excludeWorktree(primaryRoot, context.currentWorktreeRoot);
    return preparation({
      isolation: 'worktree',
      projectRoot: initialRoot,
      changeBranch,
      targetBranch,
      worktreePath: initialRoot,
      createdBranch: false,
      createdWorktree: false,
      reusedWorktree: true,
    });
  }

  let entries = listGitWorktrees(initialRoot);
  let existing = findWorktreeByBranch(entries, changeBranch);
  if (existing && !(await pathExists(existing.root))) {
    runGitCommand(primaryRoot, ['worktree', 'prune']);
    entries = listGitWorktrees(initialRoot);
    existing = findWorktreeByBranch(entries, changeBranch);
  }
  if (existing) {
    const requested = requestedWorktreePath(primaryRoot, options.worktreePath);
    if (requested && !samePath(requested, existing.root)) {
      throw new Error(
        `Classic worktree branch ${changeBranch} is already checked out at ${existing.root}`,
      );
    }
    await fs.access(existing.root);
    await ensureWorkspaceConfig(initialRoot, existing.root);
    await excludeWorktree(primaryRoot, existing.root);
    return preparation({
      isolation: 'worktree',
      projectRoot: existing.root,
      changeBranch,
      targetBranch,
      worktreePath: existing.root,
      createdBranch: false,
      createdWorktree: false,
      reusedWorktree: true,
    });
  }

  const worktreePath = resolveWorktreePath(primaryRoot, options.name, options.worktreePath);
  await assertPathAbsent(worktreePath);
  const branchExists = isLocalGitBranch(initialRoot, changeBranch);
  runGitCommand(
    primaryRoot,
    branchExists
      ? ['worktree', 'add', worktreePath, changeBranch]
      : ['worktree', 'add', '-b', changeBranch, worktreePath, targetBranch],
  );
  entries = listGitWorktrees(initialRoot);
  if (!entries.some((entry) => samePath(entry.root, worktreePath))) {
    throw new Error(`Classic worktree was created but is not registered: ${worktreePath}`);
  }
  await ensureWorkspaceConfig(initialRoot, worktreePath);
  await excludeWorktree(primaryRoot, worktreePath);
  return preparation({
    isolation: 'worktree',
    projectRoot: worktreePath,
    changeBranch,
    targetBranch,
    worktreePath,
    createdBranch: !branchExists,
    createdWorktree: true,
    reusedWorktree: false,
  });
}

async function readCandidate(
  projectRoot: string,
  worktree: GitWorktreeEntry | null,
  name: string,
): Promise<ClassicWorkspaceCandidate | null> {
  let active;
  try {
    active = await inspectClassicActiveChangeDirectory(name, projectRoot);
  } catch {
    return null;
  }
  if (!active.stateExists) return null;
  let document;
  try {
    document = parseDocument(await fs.readFile(path.join(active.directory, '.comet.yaml'), 'utf8'));
  } catch {
    return null;
  }
  const record = (document.toJS() ?? {}) as Record<string, unknown>;
  return {
    projectRoot: path.resolve(projectRoot),
    worktree,
    changeDirectory: active.directory,
    isolation: typeof record.isolation === 'string' ? record.isolation : null,
    boundBranch: typeof record.bound_branch === 'string' ? record.bound_branch : null,
    branch: worktree?.branch ?? inspectGitWorktree(projectRoot).currentBranch,
  };
}

async function workspaceCandidates(
  projectRoot: string,
  name: string,
): Promise<{ entries: GitWorktreeEntry[]; candidates: ClassicWorkspaceCandidate[] }> {
  const entries = listGitWorktrees(projectRoot);
  const roots =
    entries.length > 0
      ? [...entries]
      : [{ root: path.resolve(projectRoot), branch: null, detached: false }];
  if (!roots.some((entry) => samePath(entry.root, projectRoot))) {
    roots.push({
      root: path.resolve(projectRoot),
      branch: inspectGitWorktree(projectRoot).currentBranch,
      detached: false,
    });
  }
  const candidates = (
    await Promise.all(roots.map((entry) => readCandidate(entry.root, entry, name)))
  ).filter((candidate): candidate is ClassicWorkspaceCandidate => candidate !== null);
  return { entries, candidates };
}

function candidateIsAligned(candidate: ClassicWorkspaceCandidate): boolean {
  if (candidate.isolation === null) return true;
  if (candidate.boundBranch === null && candidate.branch !== null) return true;
  if (
    candidate.boundBranch === null &&
    candidate.branch === null &&
    candidate.worktree?.detached === false
  ) {
    return true;
  }
  return candidate.boundBranch !== null && candidate.boundBranch === candidate.branch;
}

async function recreateWorktree(
  projectRoot: string,
  name: string,
  branch: string,
): Promise<string> {
  const context = inspectGitWorktree(projectRoot);
  if (!context.primaryWorktreeRoot) throw new Error('Classic Git primary worktree is unavailable');
  const primaryRoot = context.primaryWorktreeRoot;
  const target = resolveWorktreePath(primaryRoot, name);
  runGitCommand(primaryRoot, ['worktree', 'prune']);
  const existing = findWorktreeByBranch(listGitWorktrees(primaryRoot), branch);
  if (existing) {
    if (!samePath(existing.root, target)) {
      throw new Error(
        `Classic worktree branch ${branch} is already checked out at ${existing.root}`,
      );
    }
    // A failed configuration copy can leave a registered worktree without a
    // change state. Retry setup in place, preserving all existing files.
  } else {
    await assertPathAbsent(target);
    runGitCommand(primaryRoot, ['worktree', 'add', target, branch]);
  }
  await ensureWorkspaceConfig(projectRoot, target);
  if (existing && (await inspectClassicActiveChangeDirectory(name, target)).stateExists) {
    throw new Error(`Classic worktree contains a conflicting change binding: ${target}`);
  }
  await excludeWorktree(primaryRoot, target);
  return target;
}

export async function resolveClassicWorkspace(options: {
  projectRoot: string;
  name: string;
}): Promise<ClassicWorkspaceResolution> {
  const requestedRoot = path.resolve(options.projectRoot);
  const { candidates } = await workspaceCandidates(requestedRoot, options.name);
  if (candidates.length === 0) {
    throw new Error(
      `Classic change '${options.name}' was not found in any registered Git worktree`,
    );
  }

  const aligned = candidates.filter(candidateIsAligned);
  const requested = aligned.find((candidate) => samePath(candidate.projectRoot, requestedRoot));
  const selected = requested ?? aligned[0];
  if (selected) {
    return {
      schema: 'comet.classic.workspace-resolution.v1',
      change: options.name,
      projectRoot: selected.projectRoot,
      branch: selected.branch,
      isolation: selected.isolation,
      routed: !samePath(selected.projectRoot, requestedRoot),
      recreatedWorktree: false,
    };
  }

  const requestedCandidate = candidates.find((candidate) =>
    samePath(candidate.projectRoot, requestedRoot),
  );
  if (requestedCandidate && requestedCandidate.isolation !== 'worktree') {
    return {
      schema: 'comet.classic.workspace-resolution.v1',
      change: options.name,
      projectRoot: requestedCandidate.projectRoot,
      branch: requestedCandidate.branch,
      isolation: requestedCandidate.isolation,
      routed: false,
      recreatedWorktree: false,
    };
  }

  const source = candidates.find((candidate) => candidate.boundBranch !== null);
  const boundBranch = source?.boundBranch;
  const currentContext = inspectGitWorktree(requestedRoot);
  if (
    source?.isolation === 'worktree' &&
    boundBranch &&
    currentContext.primaryWorktreeRoot &&
    isLocalGitBranch(requestedRoot, boundBranch)
  ) {
    const recreated = await recreateWorktree(requestedRoot, options.name, boundBranch);
    return {
      schema: 'comet.classic.workspace-resolution.v1',
      change: options.name,
      projectRoot: recreated,
      branch: boundBranch,
      isolation: source.isolation,
      routed: true,
      recreatedWorktree: true,
    };
  }
  if (boundBranch) {
    throw new Error(
      `Classic change '${options.name}' is bound to branch '${boundBranch}', but no registered worktree is aligned; ask the user to rebind only if that branch was intentionally renamed or taken over.`,
    );
  }
  throw new Error(
    `Classic change '${options.name}' has no bound branch in its isolated workspace; ask the user to confirm a rebind before continuing.`,
  );
}

export async function classicWorkspaceCommandResult(
  action: 'prepare' | 'resolve',
  value: ClassicWorkspacePreparation | ClassicWorkspaceResolution,
): Promise<{ exitCode: number; stdout: string; data: unknown }> {
  const data = { action, ...value };
  return { exitCode: 0, stdout: `${JSON.stringify(data)}\n`, data };
}
