import { randomUUID } from 'node:crypto';
import { accessSync, constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { atomicWriteJson } from './native-atomic-file.js';
import { readNativeStatusRecord } from './native-archived-status.js';
import { runExternalCommand } from '../../platform/process/external-command.js';
import { gitBranchRemote, gitStatusPaths, runGitCommand } from '../../platform/process/git.js';
import { inspectGitWorktree, listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';

import { canonicalSpecPath } from './native-artifacts.js';
import { nativeChangeDir } from './native-change.js';
import type { NativePortableState } from './native-portable-types.js';
import { nativeSelectionFile } from './native-selection.js';
import {
  managedConfigMatches,
  nativeWorkspaceIsClean,
  removeNativeWorkspaceConfig,
} from './native-workspace-config.js';
import type { NativeChangeState, NativeProjectPaths } from './native-types.js';
import type { NativeWorkspaceFinish, NativeWorkspaceIdentityV3 } from './native-workspace.js';
import { inspectNativeWorkspaceBinding } from './native-workspace.js';
import type { WorkflowNativePullRequestFinishConfig } from '../workflow-contract/types.js';
import {
  finishNativePullRequest,
  NativePullRequestFinishError,
  type NativePullRequestFinishOutcome,
} from './native-pull-request-finish.js';

export interface NativeWorkspaceFinishPlan {
  commitMessage?: string;
  mergeMessage?: string | null;
  finish: NativeWorkspaceFinish;
  changeRoot: string;
  primaryRoot: string;
  changeBranch: string;
  targetBranch: string;
  targetRoot: string | null;
  remote: string | null;
  isolation: 'current' | 'branch' | 'worktree';
  pullRequestFinish: WorkflowNativePullRequestFinishConfig | null;
}

export interface NativeWorkspaceFinishResult {
  action: NativeWorkspaceFinish;
  status: 'completed' | 'kept' | 'blocked';
  commit: string | null;
  remote: string | null;
  pushed: boolean;
  pullRequestUrl: string | null;
  pullRequest: NativePullRequestFinishOutcome | null;
  merged: boolean;
  targetRoot: string | null;
  cleanup: {
    performed: boolean;
    reason: string | null;
  };
  blockedPaths: string[];
  message: string | null;
  diagnosticArgs: string[] | null;
  recoveryArgs: string[] | null;
}

export const NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA = 'comet.native.workspace-finish.v1' as const;

export interface NativeWorkspaceFinishJournal {
  schema: typeof NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA;
  name: string;
  transactionId: string;
  archiveDir: string | null;
  status: 'pending' | 'blocked';
  result: NativeWorkspaceFinishResult | null;
  updatedAt: string;
  createdAt?: string;
  plan?: NativeWorkspaceFinishPlan;
  commit?: {
    parent: string;
    paths: string[];
    entries: string[];
    sha: string | null;
  };
  merge?: { target: string; source: string; sha: string | null };
}

export interface NativeWorkspaceFinishJournalReadOptions {
  /**
   * Status discovery is best-effort across every worktree.  A malformed
   * journal in one workspace must become a visible diagnostic instead of
   * aborting discovery for all other changes.  Mutating callers omit this
   * callback so invalid data still fails closed before a mutation.
   */
  onError?: (name: string, message: string) => void;
}

const NATIVE_FINISH_NAME_SOURCE = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
const NATIVE_FINISH_NAME_PATTERN = new RegExp(`^${NATIVE_FINISH_NAME_SOURCE}$`, 'u');
const NATIVE_FINISH_TRANSACTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const GIT_OBJECT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export function validateNativeWorkspaceFinishMessage(message: string, flag: string): void {
  if (!message.trim() || message.includes('\0')) {
    throw new Error(`${flag} must contain non-whitespace text and no NUL character`);
  }
}

function parseNativeWorkspaceFinishJournal(value: unknown): NativeWorkspaceFinishJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native workspace finish journal is invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema !== NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA ||
    typeof record.name !== 'string' ||
    !NATIVE_FINISH_NAME_PATTERN.test(record.name) ||
    typeof record.transactionId !== 'string' ||
    !NATIVE_FINISH_TRANSACTION_PATTERN.test(record.transactionId) ||
    (record.archiveDir !== null &&
      (typeof record.archiveDir !== 'string' || !path.isAbsolute(record.archiveDir))) ||
    !['pending', 'blocked'].includes(String(record.status)) ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.updatedAt))
  ) {
    throw new Error('Native workspace finish journal is invalid');
  }
  if (record.result !== null) {
    if (!record.result || typeof record.result !== 'object' || Array.isArray(record.result)) {
      throw new Error('Native workspace finish journal result is invalid');
    }
    const result = record.result as Record<string, unknown>;
    if (
      !['merge', 'push', 'pull-request', 'keep'].includes(String(result.action)) ||
      !['completed', 'kept', 'blocked'].includes(String(result.status)) ||
      !Array.isArray(result.blockedPaths) ||
      result.blockedPaths.some((entry) => typeof entry !== 'string') ||
      (result.recoveryArgs !== null &&
        (!Array.isArray(result.recoveryArgs) ||
          result.recoveryArgs.some((entry) => typeof entry !== 'string')))
    ) {
      throw new Error('Native workspace finish journal result is invalid');
    }
  }
  if (record.plan !== undefined) {
    const plan = record.plan as NativeWorkspaceFinishPlan;
    if (
      !plan ||
      typeof plan !== 'object' ||
      !['keep', 'merge', 'push', 'pull-request'].includes(plan.finish) ||
      !['current', 'branch', 'worktree'].includes(plan.isolation) ||
      ![plan.changeRoot, plan.primaryRoot].every(
        (root) => typeof root === 'string' && path.isAbsolute(root),
      ) ||
      ![plan.changeBranch, plan.targetBranch].every(
        (branch) => typeof branch === 'string' && branch.length > 0,
      ) ||
      (plan.targetRoot !== null &&
        (typeof plan.targetRoot !== 'string' || !path.isAbsolute(plan.targetRoot))) ||
      (plan.remote !== null && typeof plan.remote !== 'string') ||
      typeof plan.commitMessage !== 'string' ||
      (plan.mergeMessage !== null && typeof plan.mergeMessage !== 'string')
    ) {
      throw new Error('Native workspace finish journal plan is invalid');
    }
    validateNativeWorkspaceFinishMessage(plan.commitMessage, 'commit-message');
    if (plan.mergeMessage !== null)
      validateNativeWorkspaceFinishMessage(plan.mergeMessage!, 'merge-message');
  }
  if (
    record.createdAt !== undefined &&
    (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)))
  )
    throw new Error('Native workspace finish journal creation identity is invalid');
  if (record.commit !== undefined) {
    const commit = record.commit as NativeWorkspaceFinishJournal['commit'];
    if (
      !commit ||
      !GIT_OBJECT_PATTERN.test(commit.parent) ||
      !Array.isArray(commit.paths) ||
      !commit.paths.every(
        (ref) =>
          typeof ref === 'string' &&
          ref.length > 0 &&
          !path.posix.isAbsolute(ref) &&
          !path.win32.isAbsolute(ref) &&
          !ref.split('/').includes('..'),
      ) ||
      !Array.isArray(commit.entries) ||
      !commit.entries.every((entry) => typeof entry === 'string') ||
      (commit.sha !== null && !GIT_OBJECT_PATTERN.test(commit.sha))
    ) {
      throw new Error('Native workspace finish journal commit is invalid');
    }
  }
  if (record.merge !== undefined) {
    const merge = record.merge as NativeWorkspaceFinishJournal['merge'];
    if (
      !merge ||
      !GIT_OBJECT_PATTERN.test(merge.target) ||
      !GIT_OBJECT_PATTERN.test(merge.source) ||
      (merge.sha !== null && !GIT_OBJECT_PATTERN.test(merge.sha))
    ) {
      throw new Error('Native workspace finish journal merge is invalid');
    }
  }
  return {
    schema: NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA,
    name: record.name,
    transactionId: record.transactionId,
    archiveDir: record.archiveDir as string | null,
    status: record.status as NativeWorkspaceFinishJournal['status'],
    result: record.result as NativeWorkspaceFinishResult | null,
    updatedAt: record.updatedAt,
    ...(record.createdAt === undefined ? {} : { createdAt: record.createdAt as string }),
    ...(record.plan === undefined ? {} : { plan: record.plan as NativeWorkspaceFinishPlan }),
    ...(record.commit === undefined
      ? {}
      : { commit: record.commit as NonNullable<NativeWorkspaceFinishJournal['commit']> }),
    ...(record.merge === undefined
      ? {}
      : { merge: record.merge as NonNullable<NativeWorkspaceFinishJournal['merge']> }),
  };
}

function workspaceFinishJournalFile(
  paths: Pick<NativeProjectPaths, 'transactionsDir'>,
  name: string,
): string {
  if (!NATIVE_FINISH_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid Native workspace finish journal name: ${name}`);
  }
  return path.join(paths.transactionsDir, `workspace-finish-${name}.json`);
}

export async function readNativeWorkspaceFinishJournal(
  paths: Pick<NativeProjectPaths, 'transactionsDir'>,
  name: string,
  options: NativeWorkspaceFinishJournalReadOptions = {},
): Promise<NativeWorkspaceFinishJournal | null> {
  const file = workspaceFinishJournalFile(paths, name);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Native workspace finish journal is not a regular file');
    }
    const parsed = parseNativeWorkspaceFinishJournal(JSON.parse(await fs.readFile(file, 'utf8')));
    if (parsed.name !== name) throw new Error('Native workspace finish journal name is invalid');
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (options.onError) {
      options.onError(name, error instanceof Error ? error.message : String(error));
      return null;
    }
    throw error;
  }
}

export async function listNativeWorkspaceFinishJournals(
  paths: Pick<NativeProjectPaths, 'transactionsDir'>,
  options: NativeWorkspaceFinishJournalReadOptions = {},
): Promise<NativeWorkspaceFinishJournal[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.transactionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const journals: NativeWorkspaceFinishJournal[] = [];
  for (const entry of entries) {
    if ((!entry.isFile() && !entry.isSymbolicLink()) || entry.isDirectory()) continue;
    const match = new RegExp(`^workspace-finish-(${NATIVE_FINISH_NAME_SOURCE})\\.json$`, 'u').exec(
      entry.name,
    );
    if (!match) continue;
    const journal = await readNativeWorkspaceFinishJournal(paths, match[1], options);
    if (journal) journals.push(journal);
  }
  return journals;
}

/**
 * Preserve a corrupt finish journal for forensics while removing it from the
 * active transaction namespace.  This is intentionally an explicit doctor
 * repair operation; normal status/archive reads never discard recovery data.
 */
export async function quarantineNativeWorkspaceFinishJournal(
  paths: Pick<NativeProjectPaths, 'transactionsDir'>,
  name: string,
): Promise<string | null> {
  const file = workspaceFinishJournalFile(paths, name);
  const quarantine = path.join(
    paths.transactionsDir,
    `workspace-finish-invalid-${name}-${randomUUID()}.json`,
  );
  try {
    // lstat deliberately avoids following a hostile or broken symlink.  A
    // malformed journal is quarantined by moving the directory entry itself;
    // doctor must be able to repair a symlink/non-regular entry without
    // reading or deleting anything it points to.
    await fs.lstat(file);
    await fs.rename(file, quarantine);
    return quarantine;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeNativeWorkspaceFinishJournal(
  paths: Pick<NativeProjectPaths, 'transactionsDir'>,
  journal: NativeWorkspaceFinishJournal,
): Promise<void> {
  const parsed = parseNativeWorkspaceFinishJournal(journal);
  await atomicWriteJson(workspaceFinishJournalFile(paths, parsed.name), parsed, {
    containedRoot: paths.transactionsDir,
  });
}

export async function clearNativeWorkspaceFinishJournal(
  paths: Pick<NativeProjectPaths, 'transactionsDir'>,
  name: string,
): Promise<void> {
  try {
    await fs.unlink(workspaceFinishJournalFile(paths, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function prepareNativeWorkspaceFinishMessages(options: {
  name: string;
  plan: NativeWorkspaceFinishPlan;
  journal?: NativeWorkspaceFinishJournal | null;
  commitMessage?: string;
  mergeMessage?: string;
}): Promise<NativeWorkspaceFinishPlan> {
  const { plan, journal } = options;
  const recorded = journal?.plan;
  if (recorded) {
    for (const key of ['finish', 'isolation', 'changeBranch', 'targetBranch', 'remote'] as const) {
      if (plan[key] !== recorded[key])
        throw new Error(`Recorded Native workspace finish ${key} changed`);
    }
    for (const key of ['changeRoot', 'primaryRoot', 'targetRoot'] as const) {
      if (plan[key] !== recorded[key])
        throw new Error(`Recorded Native workspace finish ${key} changed`);
    }
  }
  const commitMessage =
    options.commitMessage ?? recorded?.commitMessage ?? `chore(native): archive ${options.name}`;
  const mergeMessage =
    options.mergeMessage ??
    recorded?.mergeMessage ??
    (plan.finish === 'merge'
      ? await previewDefaultMergeMessage(plan, commitMessage, journal)
      : null);
  if (options.mergeMessage !== undefined && plan.finish !== 'merge') {
    throw new Error('--merge-message requires a merge workspace finish');
  }
  if (
    recorded?.commitMessage !== undefined &&
    commitMessage !== recorded.commitMessage &&
    journal?.commit
  ) {
    const head = runGitCommand(plan.changeRoot, ['rev-parse', 'HEAD']);
    if (
      journal.commit.sha ||
      (head !== journal.commit.parent && matchesFinishCommit(plan.changeRoot, journal.commit, head))
    ) {
      throw new Error('The archive commit already exists; --commit-message cannot rewrite it');
    }
  }
  if (recorded && mergeMessage !== recorded.mergeMessage && journal?.merge?.sha) {
    throw new Error('The merge commit already exists; --merge-message cannot rewrite it');
  }
  return { ...plan, commitMessage, mergeMessage };
}

async function previewDefaultMergeMessage(
  plan: NativeWorkspaceFinishPlan,
  commitMessage: string,
  journal?: NativeWorkspaceFinishJournal | null,
): Promise<string> {
  // Git's shortlog includes the pending archive commit. Build that history in
  // temporary metadata so preview never writes the project's index, refs or objects.
  const tempRoot = path.resolve(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(tempRoot, 'comet-native-merge-preview-'));
  if (!pathContains(tempRoot, dir) || path.resolve(dir) === tempRoot)
    throw new Error('Native merge preview temporary directory is outside its root');
  try {
    const objectFormat = runGitCommand(plan.changeRoot, ['rev-parse', '--show-object-format']);
    const hooks = path.join(dir, 'hooks');
    await fs.mkdir(hooks, { recursive: true });
    runGitCommand(dir, [
      '-c',
      `core.hooksPath=${hooks}`,
      'init',
      '--bare',
      '--template=',
      `--object-format=${objectFormat}`,
    ]);
    runGitCommand(dir, ['config', 'core.hooksPath', hooks]);
    const commonDir = runGitCommand(plan.changeRoot, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]);
    await fs.writeFile(
      path.join(dir, 'objects/info/alternates'),
      `${path.join(commonDir, 'objects').replaceAll('\\', '/')}\n`,
    );
    const configArgs: string[] = ['-c', 'commit.gpgsign=false'];
    for (const key of [
      'user.name',
      'user.email',
      'author.name',
      'author.email',
      'committer.name',
      'committer.email',
      'i18n.commitEncoding',
      'merge.log',
      'merge.branchdesc',
      'merge.suppressDest',
      `branch.${plan.changeBranch}.description`,
    ]) {
      let values: string[];
      try {
        values = runGitCommand(plan.targetRoot ?? plan.changeRoot, [
          'config',
          '--null',
          '--get-all',
          key,
        ])
          .split('\0')
          .filter(Boolean);
      } catch {
        continue;
      }
      if (key === 'merge.suppressDest') configArgs.push('-c', `${key}=`);
      for (const value of values) configArgs.push('-c', `${key}=${value}`);
    }
    const source = runGitCommand(plan.changeRoot, ['rev-parse', `refs/heads/${plan.changeBranch}`]);
    const checkpoint = journal?.commit;
    const committed =
      checkpoint &&
      source !== checkpoint.parent &&
      matchesFinishCommit(plan.changeRoot, checkpoint, source);
    let mergeSource = source;
    if (!committed) {
      const file = path.join(dir, 'archive-message');
      await fs.writeFile(file, commitMessage);
      const tree = runGitCommand(plan.changeRoot, ['rev-parse', `${source}^{tree}`]);
      mergeSource = runGitCommand(dir, [
        ...configArgs,
        'commit-tree',
        tree,
        '-p',
        source,
        '-F',
        file,
      ]);
    }
    const target = runGitCommand(plan.changeRoot, ['rev-parse', `refs/heads/${plan.targetBranch}`]);
    runGitCommand(dir, ['update-ref', '--no-deref', 'HEAD', target]);
    runGitCommand(dir, ['update-ref', `refs/heads/${plan.changeBranch}`, mergeSource]);
    const file = path.join(dir, 'merge-head');
    await fs.writeFile(file, `${mergeSource}\t\tbranch '${plan.changeBranch}' of .\n`);
    return runGitCommand(dir, [
      ...configArgs,
      'fmt-merge-msg',
      ...mergeMessageLogOptions(plan, plan.targetRoot ?? plan.changeRoot),
      '--into-name',
      plan.targetBranch,
      '-F',
      file,
    ]);
  } finally {
    if (pathContains(tempRoot, dir) && path.resolve(dir) !== tempRoot)
      await fs.rm(dir, { recursive: true, force: true });
  }
}

function mergeMessageLogOptions(plan: NativeWorkspaceFinishPlan, root: string): string[] {
  let options: string;
  try {
    options = runGitCommand(root, ['config', '--get', `branch.${plan.targetBranch}.mergeOptions`]);
  } catch {
    return [];
  }
  // Git's branch mergeOptions contract excludes option values containing whitespace.
  return options
    .split(/\s+/u)
    .map((option) => option.replace(/^(['"])(.*)\1$/u, '$2'))
    .filter((option) => /^--(?:no-log|log(?:=\d+)?)$/u.test(option));
}

export async function readNativeWorkspaceFinishArchive(
  paths: NativeProjectPaths,
  journal: NativeWorkspaceFinishJournal,
) {
  if (
    !journal.archiveDir ||
    !pathContains(paths.archiveDir, journal.archiveDir) ||
    path.resolve(paths.archiveDir) === path.resolve(journal.archiveDir)
  ) {
    throw new Error('Native workspace finish journal has no safe archived change directory');
  }
  const record = await readNativeStatusRecord(
    paths,
    path.join(journal.archiveDir, 'comet-state.yaml'),
  );
  if (
    record.state.name !== journal.name ||
    !record.state.archived ||
    record.state.status !== 'done' ||
    (journal.createdAt !== undefined && record.state.created_at !== journal.createdAt)
  ) {
    throw new Error('Native workspace finish journal does not match a completed Archive record');
  }
  return record;
}

function finishTreeEntries(root: string, refs: string[], commit?: string): string[] {
  const raw = runGitCommand(
    root,
    commit
      ? ['ls-tree', '-r', '-z', commit, '--', ...refs]
      : ['ls-files', '--stage', '-z', '--', ...refs],
  );
  return raw
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = commit
        ? /^(\d+) (?:blob|commit) ([a-f0-9]+)\t([\s\S]+)$/u.exec(entry)
        : /^(\d+) ([a-f0-9]+) 0\t([\s\S]+)$/u.exec(entry);
      if (!match) throw new Error('Native workspace finish encountered an unresolved index entry');
      return `${match[1]} ${match[2]}\t${match[3]}`;
    })
    .sort();
}

function matchesFinishCommit(
  root: string,
  checkpoint: NonNullable<NativeWorkspaceFinishJournal['commit']>,
  sha: string,
): boolean {
  try {
    runGitCommand(root, ['merge-base', '--is-ancestor', checkpoint.parent, sha]);
    if (checkpoint.sha) runGitCommand(root, ['merge-base', '--is-ancestor', checkpoint.sha, sha]);
    return (
      JSON.stringify(finishTreeEntries(root, checkpoint.paths, sha)) ===
      JSON.stringify(checkpoint.entries)
    );
  } catch {
    return false;
  }
}

async function archivedFilesCommitted(
  paths: NativeProjectPaths,
  state: NativePortableState,
  archiveDir: string,
  root: string,
  sha: string,
): Promise<boolean> {
  const files: string[] = [];
  async function visit(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error('Native archived record contains a symbolic link');
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  await visit(archiveDir);
  for (const change of state.spec_changes) {
    const file = canonicalSpecPath(paths, change.capability);
    if (await pathExists(file)) files.push(file);
  }
  try {
    if (
      runGitCommand(root, [
        'ls-tree',
        '-r',
        '--name-only',
        sha,
        '--',
        portableRelative(paths.projectRoot, nativeChangeDir(paths, state.name)),
      ])
    )
      return false;
    return files.every((file) => {
      const ref = portableRelative(paths.projectRoot, file);
      return (
        runGitCommand(root, ['rev-parse', `${sha}:${ref}`]) ===
        runGitCommand(root, ['hash-object', '--path', ref, '--', file])
      );
    });
  } catch {
    return false;
  }
}

/** Read-only reconciliation: Doctor never creates a commit, push, or merge. */
export async function inspectNativeWorkspaceFinishCompletion(
  paths: NativeProjectPaths,
  journal: NativeWorkspaceFinishJournal,
): Promise<boolean> {
  const archived = await readNativeWorkspaceFinishArchive(paths, journal);
  const plan =
    journal.plan ??
    (await prepareNativePortableWorkspaceFinish({
      paths,
      state: archived.state,
      archiveDir: journal.archiveDir!,
    }));
  if (!plan) return true;
  if (
    path.resolve(plan.changeRoot) !== path.resolve(paths.projectRoot) ||
    plan.isolation !== archived.state.workspace.isolation
  )
    return false;
  if (
    plan.isolation !== 'current' &&
    (plan.changeBranch !== archived.state.workspace.change_branch ||
      plan.targetBranch !== archived.state.workspace.target_branch ||
      plan.finish !== archived.state.workspace.finish)
  )
    return false;
  if (inspectGitWorktree(plan.changeRoot).currentBranch !== plan.changeBranch) {
    // A branch merge may already have switched this checkout to the target.
    if (
      plan.isolation !== 'branch' ||
      plan.finish !== 'merge' ||
      inspectGitWorktree(plan.changeRoot).currentBranch !== plan.targetBranch
    )
      return false;
  }
  const sha = runGitCommand(plan.changeRoot, ['rev-parse', `refs/heads/${plan.changeBranch}`]);
  const owned = portableArchiveOwnedPaths(paths, archived.state, journal.archiveDir!);
  if (gitStatusPaths(plan.changeRoot).some((ref) => pathCovered(ref, owned))) return false;
  if (journal.commit) {
    const expectedPaths = [
      portableRelative(paths.projectRoot, nativeChangeDir(paths, journal.name)),
      portableRelative(paths.projectRoot, journal.archiveDir!),
      ...archived.state.spec_changes.map((change) =>
        portableRelative(paths.projectRoot, canonicalSpecPath(paths, change.capability)),
      ),
      portableRelative(paths.projectRoot, nativeSelectionFile(paths)),
    ];
    if (JSON.stringify(journal.commit.paths) !== JSON.stringify(expectedPaths)) return false;
    if (!matchesFinishCommit(plan.changeRoot, journal.commit, sha)) return false;
  }
  if (
    !(await archivedFilesCommitted(
      paths,
      archived.state,
      journal.archiveDir!,
      plan.changeRoot,
      sha,
    ))
  )
    return false;
  if (plan.finish === 'keep') return true;
  if (plan.finish === 'merge') {
    try {
      runGitCommand(plan.changeRoot, [
        'merge-base',
        '--is-ancestor',
        sha,
        `refs/heads/${plan.targetBranch}`,
      ]);
      return true;
    } catch {
      return false;
    }
  }
  // Push and PR completion still use the existing provider-aware Archive path.
  return false;
}

async function defaultMergeMessage(plan: NativeWorkspaceFinishPlan, root: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-merge-message-'));
  const file = path.join(dir, 'merge-head');
  try {
    const sha = runGitCommand(plan.changeRoot, ['rev-parse', `refs/heads/${plan.changeBranch}`]);
    await fs.writeFile(file, `${sha}\t\tbranch '${plan.changeBranch}' of .\n`);
    return runGitCommand(root, [
      'fmt-merge-msg',
      ...mergeMessageLogOptions(plan, root),
      '--into-name',
      plan.targetBranch,
      '-F',
      file,
    ]);
  } finally {
    await fs.unlink(file).catch(() => {});
    await fs.rmdir(dir);
  }
}

export class NativeWorkspaceFinishError extends Error {
  constructor(readonly result: NativeWorkspaceFinishResult) {
    super(result.message ?? 'Native workspace finish is blocked');
    this.name = 'NativeWorkspaceFinishError';
  }
}

/**
 * Raised before Archive mutates anything when the Git working tree contains
 * paths outside the change-owned finish scope. Keeping the paths on the
 * error lets the CLI return a complete, machine-readable blocker list.
 */
export class NativeWorkspaceFinishPreparationError extends Error {
  constructor(
    readonly paths: string[],
    readonly workspaceRoot: string,
    messagePrefix = 'Native workspace finish is blocked',
  ) {
    super(`${messagePrefix}; remaining paths: ${paths.join(', ')}`);
    this.name = 'NativeWorkspaceFinishPreparationError';
  }
}

type NativeWorkspaceFinishState =
  | Pick<NativeChangeState, 'name' | 'spec_changes'>
  | Pick<NativePortableState, 'name' | 'spec_changes'>;

function pathContains(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function portableRelative(projectRoot: string, target: string): string {
  const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`Native workspace finish path escaped the project: ${target}`);
  }
  return relative;
}

function pathCovered(candidate: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => candidate === entry || candidate.startsWith(`${entry}/`));
}

function portableArchiveOwnedPaths(
  paths: NativeProjectPaths,
  state: NativePortableState,
  archiveDir?: string,
  appliedSpecChanges: readonly { capability: string }[] = [],
): string[] {
  const allowed = [
    ...(managedConfigMatches(paths.projectRoot) ? ['.comet/config.yaml'] : []),
    portableRelative(paths.projectRoot, nativeChangeDir(paths, state.name)),
    portableRelative(paths.projectRoot, nativeSelectionFile(paths)),
  ];
  if (archiveDir) allowed.push(portableRelative(paths.projectRoot, archiveDir));
  for (const change of archiveDir ? state.spec_changes : appliedSpecChanges) {
    allowed.push(portableRelative(paths.projectRoot, canonicalSpecPath(paths, change.capability)));
  }
  return allowed;
}

function assertFinishScopeClean(projectRoot: string, allowed: readonly string[]): void {
  const unrelated = gitStatusPaths(projectRoot).filter(
    (candidate) => !pathCovered(candidate, allowed),
  );
  if (unrelated.length > 0) {
    throw new NativeWorkspaceFinishPreparationError(unrelated, projectRoot);
  }
}

function absoluteGitPaths(projectRoot: string, candidates: readonly string[]): string[] {
  return candidates.map((candidate) => path.resolve(projectRoot, ...candidate.split('/')));
}

function assertTargetWorktreeClean(targetRoot: string): void {
  const targetBlockers = gitStatusPaths(targetRoot).filter(
    (candidate) => !(candidate === '.comet/config.yaml' && managedConfigMatches(targetRoot)),
  );
  if (targetBlockers.length > 0) {
    throw new NativeWorkspaceFinishPreparationError(
      absoluteGitPaths(targetRoot, targetBlockers),
      targetRoot,
      `Native merge target worktree is not clean: ${targetRoot}`,
    );
  }
}

function gitPathList(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

function listTrackedPaths(projectRoot: string, candidate: string): string[] {
  return gitPathList(runGitCommand(projectRoot, ['ls-files', '-z', '--', candidate]));
}

function listUntrackedNonIgnoredPaths(projectRoot: string, candidate: string): string[] {
  return gitPathList(
    runGitCommand(projectRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      candidate,
    ]),
  );
}

function assertGitIdentity(projectRoot: string): void {
  try {
    if (
      runGitCommand(projectRoot, ['config', '--get', 'user.name']) &&
      runGitCommand(projectRoot, ['config', '--get', 'user.email'])
    ) {
      return;
    }
  } catch {
    // Fall through to the stable user-facing error below.
  }
  throw new Error('Native workspace finish requires configured Git user.name and user.email');
}

function findTargetRoot(primaryRoot: string, targetBranch: string): string | null {
  for (const root of listGitWorktreeRoots(primaryRoot)) {
    const context = inspectGitWorktree(root);
    if (context.currentBranch === targetBranch) return root;
  }
  return null;
}

function assertCommandAvailable(command: string, args: readonly string[]): void {
  try {
    runExternalCommand(command, args, { timeoutMs: 10_000 });
  } catch (error) {
    throw new Error(`${command} is required for the selected Native workspace finish`, {
      cause: error,
    });
  }
}

function assertPullRequestProviderAvailable(
  projectRoot: string,
  config: WorkflowNativePullRequestFinishConfig | undefined,
): void {
  if (!config) return;
  const executable = config.command[0];
  try {
    const absoluteExecutable =
      path.posix.isAbsolute(executable) || path.win32.isAbsolute(executable);
    if (absoluteExecutable) {
      throw new Error('configured executable must not be an absolute path');
    }
    if (/[\\/]/u.test(executable)) {
      const resolved = path.resolve(projectRoot, executable);
      if (!pathContains(projectRoot, resolved)) {
        throw new Error('configured executable escapes the project root');
      }
      accessSync(resolved, fsConstants.X_OK);
      return;
    }
    runExternalCommand(process.platform === 'win32' ? 'where' : 'which', [executable], {
      timeoutMs: 10_000,
    });
  } catch (error) {
    throw new Error(
      `Configured Native pull request finish executable is not available: ${executable}`,
      { cause: error },
    );
  }
}

export async function prepareNativeWorkspaceFinish(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  workspace: NativeWorkspaceIdentityV3;
  pullRequestFinish?: WorkflowNativePullRequestFinishConfig;
}): Promise<NativeWorkspaceFinishPlan | null> {
  const { paths, workspace } = options;
  if (workspace.isolation === 'current') return null;
  if (!workspace.finish || !workspace.changeBranch || !workspace.targetBranch) {
    throw new Error('Native isolated workspace finish is not persisted');
  }
  if (workspace.changeBranch === workspace.targetBranch) {
    throw new Error('Native change and target branches must be different for workspace finish');
  }
  const inspection = await inspectNativeWorkspaceBinding({ paths, identity: workspace });
  if (inspection.state !== 'aligned') {
    throw new Error(`Native workspace finish is blocked: ${inspection.message ?? inspection.code}`);
  }
  const context = inspectGitWorktree(paths.projectRoot);
  if (!context.primaryWorktreeRoot) {
    throw new Error('Native workspace finish requires a registered Git worktree');
  }
  assertGitIdentity(paths.projectRoot);
  const allowedBeforeArchive = [portableRelative(paths.projectRoot, nativeSelectionFile(paths))];
  assertFinishScopeClean(paths.projectRoot, allowedBeforeArchive);
  const targetRoot =
    workspace.isolation === 'branch'
      ? paths.projectRoot
      : findTargetRoot(context.primaryWorktreeRoot, workspace.targetBranch);
  if (workspace.finish === 'merge' && workspace.isolation === 'worktree') {
    if (!targetRoot) {
      throw new Error(
        `Native merge finish requires a registered worktree on target branch ${workspace.targetBranch}`,
      );
    }
    assertTargetWorktreeClean(targetRoot);
  }
  const remote =
    workspace.finish === 'push' || workspace.finish === 'pull-request'
      ? gitBranchRemote(paths.projectRoot, workspace.changeBranch)
      : null;
  if (workspace.finish === 'pull-request') {
    assertCommandAvailable('gh', ['--version']);
    assertPullRequestProviderAvailable(paths.projectRoot, options.pullRequestFinish);
  }
  return {
    finish: workspace.finish,
    changeRoot: paths.projectRoot,
    primaryRoot: context.primaryWorktreeRoot,
    changeBranch: workspace.changeBranch,
    targetBranch: workspace.targetBranch,
    targetRoot,
    remote,
    isolation: workspace.isolation,
    pullRequestFinish: options.pullRequestFinish ?? null,
  };
}

/**
 * Prepare Git finishing directly from the portable YAML binding.
 *
 * Unlike the legacy workspace identity this deliberately does not create or
 * compare root hashes. The current Git worktree registration and branch are
 * the only local facts needed before the user-authorized finish action.
 */
export async function prepareNativePortableWorkspaceFinish(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  archiveDir?: string;
  appliedSpecChanges?: readonly { capability: string }[];
  pullRequestFinish?: WorkflowNativePullRequestFinishConfig;
}): Promise<NativeWorkspaceFinishPlan | null> {
  const { paths, state } = options;
  const workspace = state.workspace;
  const context = inspectGitWorktree(paths.projectRoot);
  if (workspace.isolation === 'current') {
    // A current-workspace change has no user-selected finish action, but a
    // Git repository can still safely absorb its change-owned Archive files
    // in the same commit. Non-Git projects retain the historical no-op.
    if (!context.isGitWorktree) return null;
    if (!context.primaryWorktreeRoot || !context.currentBranch) {
      throw new Error('Native current workspace finish requires a registered Git branch');
    }
    assertGitIdentity(paths.projectRoot);
    return {
      finish: 'keep',
      changeRoot: paths.projectRoot,
      primaryRoot: context.primaryWorktreeRoot,
      changeBranch: context.currentBranch,
      targetBranch: context.currentBranch,
      targetRoot: paths.projectRoot,
      remote: null,
      isolation: 'current',
      pullRequestFinish: null,
    };
  }
  if (!workspace.finish || !workspace.change_branch || !workspace.target_branch) {
    throw new Error('Native isolated workspace finish is not persisted');
  }
  if (workspace.change_branch === workspace.target_branch) {
    throw new Error('Native change and target branches must be different for workspace finish');
  }
  if (!context.primaryWorktreeRoot || context.currentBranch !== workspace.change_branch) {
    throw new Error(
      `Native workspace finish requires branch ${workspace.change_branch} in the current registered worktree`,
    );
  }
  assertGitIdentity(paths.projectRoot);
  // The active change directory is deliberately part of the archive-owned
  // scope before the move. Archive finalization updates its state/report and
  // then stages those files in the single archive commit; treating them as
  // unrelated here forces an unnecessary manual commit and makes a dry-run
  // disagree with the confirmed path.
  const allowedBeforeArchive = portableArchiveOwnedPaths(
    paths,
    state,
    options.archiveDir,
    options.appliedSpecChanges,
  );
  // Explicit `keep` is also a non-destructive local finish: only the change
  // owned paths may be committed, while unrelated staged and working files
  // stay in place. Merge, push and PR still require an isolated clean scope.
  if (workspace.finish !== 'keep') {
    assertFinishScopeClean(paths.projectRoot, allowedBeforeArchive);
  }
  const targetRoot =
    workspace.isolation === 'branch'
      ? paths.projectRoot
      : findTargetRoot(context.primaryWorktreeRoot, workspace.target_branch);
  if (workspace.finish === 'merge' && workspace.isolation === 'worktree') {
    if (!targetRoot) {
      throw new Error(
        `Native merge finish requires a registered worktree on target branch ${workspace.target_branch}`,
      );
    }
    assertTargetWorktreeClean(targetRoot);
  }
  const remote =
    workspace.finish === 'push' || workspace.finish === 'pull-request'
      ? gitBranchRemote(paths.projectRoot, workspace.change_branch)
      : null;
  if (workspace.finish === 'pull-request') {
    assertCommandAvailable('gh', ['--version']);
    assertPullRequestProviderAvailable(paths.projectRoot, options.pullRequestFinish);
  }
  return {
    finish: workspace.finish,
    changeRoot: paths.projectRoot,
    primaryRoot: context.primaryWorktreeRoot,
    changeBranch: workspace.change_branch,
    targetBranch: workspace.target_branch,
    targetRoot,
    remote,
    isolation: workspace.isolation,
    pullRequestFinish: options.pullRequestFinish ?? null,
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function baseResult(plan: NativeWorkspaceFinishPlan): NativeWorkspaceFinishResult {
  return {
    action: plan.finish,
    status: plan.finish === 'keep' ? 'kept' : 'completed',
    commit: null,
    remote: plan.remote,
    pushed: false,
    pullRequestUrl: null,
    pullRequest: null,
    merged: false,
    targetRoot: plan.targetRoot,
    cleanup: { performed: false, reason: null },
    blockedPaths: [],
    message: null,
    diagnosticArgs: null,
    recoveryArgs: null,
  };
}

async function cleanupMergedWorktree(plan: NativeWorkspaceFinishPlan): Promise<{
  performed: boolean;
  reason: string | null;
}> {
  if (plan.isolation !== 'worktree') return { performed: false, reason: null };
  if (pathContains(plan.changeRoot, process.cwd())) {
    return {
      performed: false,
      reason: 'invocation-working-directory-is-the-change-worktree',
    };
  }
  try {
    await removeNativeWorkspaceConfig(plan.changeRoot);
    runGitCommand(plan.primaryRoot, ['worktree', 'remove', plan.changeRoot]);
    return { performed: true, reason: null };
  } catch (error) {
    return {
      performed: false,
      reason: `worktree-cleanup-failed: ${(error as Error).message}`,
    };
  }
}

export async function finishArchivedNativeWorkspace(options: {
  paths: NativeProjectPaths;
  state: NativeWorkspaceFinishState;
  name: string;
  archiveDir: string;
  transactionId: string;
  plan: NativeWorkspaceFinishPlan;
}): Promise<NativeWorkspaceFinishResult> {
  const result = baseResult(options.plan);
  let switchedMergeRoot: string | null = null;
  let mergeRoot: string | null = null;
  let mergeAttempted = false;
  let journal = await readNativeWorkspaceFinishJournal(options.paths, options.name);
  const save = async () => {
    if (!journal) return;
    journal = { ...journal, result: { ...result }, updatedAt: new Date().toISOString() };
    await writeNativeWorkspaceFinishJournal(options.paths, journal);
  };
  try {
    const allowedPaths = [
      portableRelative(options.paths.projectRoot, nativeChangeDir(options.paths, options.name)),
      portableRelative(options.paths.projectRoot, options.archiveDir),
      ...options.state.spec_changes.map((change) =>
        portableRelative(
          options.paths.projectRoot,
          canonicalSpecPath(options.paths, change.capability),
        ),
      ),
      portableRelative(options.paths.projectRoot, nativeSelectionFile(options.paths)),
    ];
    if (journal?.commit && JSON.stringify(journal.commit.paths) !== JSON.stringify(allowedPaths)) {
      throw new Error('Recorded Native archive commit scope does not match this change');
    }
    const preservesUnrelatedChanges =
      options.plan.isolation === 'current' || options.plan.finish === 'keep';
    const head = runGitCommand(options.plan.changeRoot, ['rev-parse', 'HEAD']);
    if (journal?.commit) {
      if (journal.commit.sha || head !== journal.commit.parent) {
        if (!matchesFinishCommit(options.plan.changeRoot, journal.commit, head)) {
          throw new Error(
            'Recorded Native archive commit does not match the current branch or archived contents',
          );
        }
        if (gitStatusPaths(options.plan.changeRoot).some((ref) => pathCovered(ref, allowedPaths))) {
          throw new Error('Native archived contents changed after the archive commit');
        }
        result.commit = head;
      }
    }
    const unexpected = gitStatusPaths(options.plan.changeRoot).filter(
      (candidate) =>
        !pathCovered(candidate, allowedPaths) &&
        !(candidate === '.comet/config.yaml' && managedConfigMatches(options.plan.changeRoot)),
    );
    if (unexpected.length > 0 && !preservesUnrelatedChanges) {
      result.blockedPaths = unexpected;
      throw new Error(
        `Native Archive produced or encountered paths outside the authorized finish scope: ${unexpected.join(', ')}`,
      );
    }
    const trackedCandidates: string[] = [];
    const untrackedPaths = new Set<string>();
    for (const candidate of allowedPaths) {
      const absolute = path.resolve(options.paths.projectRoot, ...candidate.split('/'));
      const tracked = listTrackedPaths(options.plan.changeRoot, candidate);
      if (tracked.length > 0) trackedCandidates.push(candidate);
      if (await pathExists(absolute)) {
        for (const file of listUntrackedNonIgnoredPaths(options.plan.changeRoot, candidate)) {
          untrackedPaths.add(file);
        }
      }
    }
    if (!result.commit && trackedCandidates.length > 0) {
      runGitCommand(options.plan.changeRoot, ['add', '-u', '--', ...trackedCandidates]);
    }
    if (!result.commit && untrackedPaths.size > 0) {
      runGitCommand(options.plan.changeRoot, ['add', '--', ...untrackedPaths]);
    }
    const staged = runGitCommand(options.plan.changeRoot, [
      'diff',
      '--cached',
      '--name-only',
      '-z',
      '--',
      ...allowedPaths,
    ]);
    if (staged && !result.commit) {
      const commitPaths = [...new Set([...trackedCandidates, ...untrackedPaths])];
      if (journal) {
        const entries = finishTreeEntries(options.plan.changeRoot, allowedPaths);
        if (journal.commit && JSON.stringify(entries) !== JSON.stringify(journal.commit.entries)) {
          throw new Error(
            'Native archived contents changed since the rejected commit; restore the recorded contents before retrying',
          );
        }
        journal = {
          ...journal,
          commit: journal.commit ?? { parent: head, paths: allowedPaths, entries, sha: null },
        };
        await save();
      }
      try {
        runGitCommand(
          options.plan.changeRoot,
          preservesUnrelatedChanges
            ? [
                'commit',
                '--only',
                '-m',
                options.plan.commitMessage ?? `chore(native): archive ${options.name}`,
                '--',
                ...commitPaths,
              ]
            : [
                'commit',
                '-m',
                options.plan.commitMessage ?? `chore(native): archive ${options.name}`,
              ],
        );
      } catch (error) {
        const actual = runGitCommand(options.plan.changeRoot, ['rev-parse', 'HEAD']);
        if (
          !journal?.commit ||
          actual === journal.commit.parent ||
          !matchesFinishCommit(options.plan.changeRoot, journal.commit, actual)
        )
          throw error;
      }
    }
    result.commit = runGitCommand(options.plan.changeRoot, ['rev-parse', 'HEAD']);
    if (journal) {
      if (
        journal.commit &&
        !matchesFinishCommit(options.plan.changeRoot, journal.commit, result.commit)
      ) {
        throw new Error('Native archive commit does not contain the recorded archived contents');
      }
      const archived = await readNativeWorkspaceFinishArchive(options.paths, journal);
      if (
        !(await archivedFilesCommitted(
          options.paths,
          archived.state,
          options.archiveDir,
          options.plan.changeRoot,
          result.commit,
        ))
      ) {
        throw new Error('Native archive files are not committed with their expected contents');
      }
      if (journal.commit)
        journal = { ...journal, commit: { ...journal.commit, sha: result.commit } };
      await save();
    }
    const remainingOwned = gitStatusPaths(options.plan.changeRoot).filter((candidate) =>
      pathCovered(candidate, allowedPaths),
    );
    if (remainingOwned.length > 0) {
      throw new Error(
        `Native archive commit left change-owned working-tree changes: ${remainingOwned.join(', ')}`,
      );
    }
    if (!preservesUnrelatedChanges && !nativeWorkspaceIsClean(options.plan.changeRoot)) {
      throw new Error('Native archive commit left unexpected working-tree changes');
    }

    if (options.plan.finish === 'keep') return result;
    if (options.plan.finish === 'push' || options.plan.finish === 'pull-request') {
      runGitCommand(options.plan.changeRoot, [
        'push',
        '--set-upstream',
        options.plan.remote!,
        options.plan.changeBranch,
      ]);
      result.pushed = true;
      await save();
      if (options.plan.finish === 'pull-request') {
        result.pullRequest = finishNativePullRequest({
          projectRoot: options.plan.changeRoot,
          changeName: options.name,
          transactionId: options.transactionId,
          remote: options.plan.remote!,
          baseBranch: options.plan.targetBranch,
          headBranch: options.plan.changeBranch,
          headSha: result.commit!,
          config: options.plan.pullRequestFinish,
        });
        result.pullRequestUrl = result.pullRequest.pullRequest.url;
        await save();
      }
      const cwdInsideChangeRoot = pathContains(options.plan.changeRoot, process.cwd());
      if (options.plan.isolation === 'worktree' && !cwdInsideChangeRoot) {
        await removeNativeWorkspaceConfig(options.plan.changeRoot);
        runGitCommand(options.plan.primaryRoot, ['worktree', 'remove', options.plan.changeRoot]);
        result.cleanup = { performed: true, reason: null };
      } else if (options.plan.isolation === 'worktree') {
        result.cleanup = {
          performed: false,
          reason: 'invocation-working-directory-is-the-change-worktree',
        };
      }
      return result;
    }

    mergeRoot = options.plan.targetRoot ?? options.plan.changeRoot;
    if (options.plan.isolation === 'branch') {
      runGitCommand(mergeRoot, ['switch', options.plan.targetBranch]);
      switchedMergeRoot = mergeRoot;
    }
    let alreadyMerged = false;
    try {
      runGitCommand(mergeRoot, [
        'merge-base',
        '--is-ancestor',
        result.commit,
        `refs/heads/${options.plan.targetBranch}`,
      ]);
      alreadyMerged = true;
    } catch {
      /* The recorded change still needs its authorized merge. */
    }
    if (!alreadyMerged) {
      const message =
        options.plan.mergeMessage ?? (await defaultMergeMessage(options.plan, mergeRoot));
      if (journal) {
        journal = {
          ...journal,
          plan: { ...options.plan, mergeMessage: message },
          merge: {
            target: runGitCommand(mergeRoot, ['rev-parse', 'HEAD']),
            source: result.commit,
            sha: null,
          },
        };
        await save();
      }
      mergeAttempted = true;
      try {
        runGitCommand(mergeRoot, [
          'merge',
          '--no-ff',
          '--no-edit',
          '--no-log',
          '-m',
          message,
          options.plan.changeBranch,
        ]);
      } catch (error) {
        try {
          runGitCommand(mergeRoot, ['merge-base', '--is-ancestor', result.commit, 'HEAD']);
        } catch {
          throw error;
        }
      }
    }
    result.merged = true;
    result.targetRoot = mergeRoot;
    if (journal?.merge)
      journal = {
        ...journal,
        merge: { ...journal.merge, sha: runGitCommand(mergeRoot, ['rev-parse', 'HEAD']) },
      };
    await save();
    result.cleanup = await cleanupMergedWorktree(options.plan);
    return result;
  } catch (error) {
    if (error instanceof NativePullRequestFinishError && error.pullRequest) {
      result.pullRequestUrl = error.pullRequest.url;
    }
    if (mergeAttempted && mergeRoot && !result.merged) {
      try {
        if (runGitCommand(mergeRoot, ['rev-parse', '--verify', 'MERGE_HEAD']) === result.commit) {
          runGitCommand(mergeRoot, ['merge', '--abort']);
        }
      } catch {
        /* Preserve the original Git failure when there is no owned merge to abort. */
      }
    }
    if (switchedMergeRoot !== null) {
      let restored: boolean;
      try {
        runGitCommand(switchedMergeRoot, ['merge', '--abort']);
      } catch {
        // The failed merge may not have left an in-progress merge to abort.
      }
      try {
        if (inspectGitWorktree(switchedMergeRoot).currentBranch === options.plan.targetBranch) {
          runGitCommand(switchedMergeRoot, ['switch', options.plan.changeBranch]);
        }
        restored =
          inspectGitWorktree(switchedMergeRoot).currentBranch === options.plan.changeBranch;
      } catch {
        restored = false;
      }
      if (!restored) result.targetRoot = switchedMergeRoot;
    }
    result.status = 'blocked';
    result.message = (error as Error).message;
    result.diagnosticArgs = [
      'git',
      '-C',
      options.plan.finish === 'merge' && result.targetRoot
        ? result.targetRoot
        : options.plan.changeRoot,
      'status',
      '--short',
    ];
    result.recoveryArgs = ['comet', 'native', 'archive', options.name, '--confirmed'];
    await save();
    throw new NativeWorkspaceFinishError(result);
  }
}
