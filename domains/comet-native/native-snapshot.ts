import { createHash } from 'crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'fs';
import path from 'path';

import { atomicWriteJson } from './native-atomic-file.js';
import { sha256Text } from './native-hash.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import { readNativeProtectedTextFile } from './native-protected-file.js';
import { nativeSensitiveRelativePathReason } from './native-sensitive-paths.js';
import type {
  NativeContentSnapshotManifest,
  NativeGitProjectionEvidence,
  NativeGitSelectionEvidence,
  NativePhysicalSelectionEvidence,
  NativeProjectPaths,
  NativeSnapshotEntry,
  NativeSnapshotOmission,
  NativeSnapshotOmissionOverflow,
} from './native-types.js';

export const DEFAULT_NATIVE_SNAPSHOT_LIMITS = {
  maxFiles: 10_000,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
} as const;

const MAX_RECORDED_OMISSIONS = 1_000;
const NATIVE_SNAPSHOT_MANIFEST_HARD_MAX_BYTES = 8 * 1024 * 1024;
const CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const MANIFEST_KEYS = new Set([
  'schema',
  'origin',
  'capture',
  'createdAt',
  'complete',
  'limits',
  'entries',
  'omitted',
  'omittedCount',
  'omissionOverflow',
]);
const LIMIT_KEYS = new Set(['maxFiles', 'maxFileBytes', 'maxTotalBytes', 'maxManifestBytes']);
const CAPTURE_KEYS = new Set(['provider', 'gitSelection', 'physicalSelection', 'projection']);
const GIT_PROJECTION_KEYS = new Set(['provider', 'selection']);
const GIT_SELECTION_KEYS = new Set([
  'schema',
  'status',
  'stageBefore',
  'combined',
  'stageAfter',
  'finalStageBefore',
  'finalCombined',
  'finalStageAfter',
]);
const GIT_SELECTION_STREAM_KEYS = new Set([
  'hash',
  'recordCount',
  'storedRecordCount',
  'stdoutBytes',
  'overflow',
]);
const PHYSICAL_SELECTION_KEYS = new Set(['schema', 'status', 'before', 'after']);
const PHYSICAL_SELECTION_STREAM_KEYS = new Set([
  'hash',
  'visitedNodeCount',
  'recordCount',
  'storedRecordCount',
  'encodedBytes',
  'overflow',
  'unstable',
]);
const ENTRY_KEYS = new Set(['path', 'hash', 'size', 'type']);
const OMISSION_KEYS = new Set(['path', 'size', 'type', 'reason']);
const OMISSION_OVERFLOW_KEYS = new Set(['ref', 'hash', 'count']);
const SNAPSHOT_ORIGINS = new Set<NativeContentSnapshotManifest['origin']>([
  'change-created',
  'legacy-migration',
  'explicit',
]);
const OMISSION_TYPES = new Set<NativeSnapshotOmission['type']>(['file', 'directory', 'other']);
const OMISSION_REASONS = new Set<NativeSnapshotOmission['reason']>([
  'file-size',
  'file-count',
  'total-size',
  'manifest-size',
  'changed-during-read',
  'unreadable',
  'gitlink-unavailable',
  'gitlink-dirty',
  'gitlink-changed',
  'legacy-gitlink-boundary',
  'git-enumeration-limit',
  'git-selection-changed',
  'physical-enumeration-limit',
  'physical-selection-changed',
]);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const UNREADABLE_ERROR_CODES = new Set(['EACCES', 'EPERM']);

interface SnapshotOptions {
  now?: Date;
  origin?: NativeContentSnapshotManifest['origin'];
  limits?: Partial<NativeContentSnapshotManifest['limits']>;
  denylist?: readonly string[];
  gitSelectionLimits?: Partial<NativeGitSelectionLimits>;
  gitSelectionHooks?: NativeGitSelectionHooks;
  physicalSelectionLimits?: Partial<NativePhysicalSelectionLimits>;
  physicalSelectionHooks?: NativePhysicalSelectionHooks;
  /**
   * Shared execution budget. Git subprocesses are terminated at expiry. Physical-tree traversal
   * checks it before and after each filesystem operation; Node cannot cancel an in-flight fs call.
   */
  deadlineMs?: number;
  gitProcess?: NativeGitProcessAdapter;
}

interface NativeGitProcessAdapter {
  command: string;
  argsPrefix?: readonly string[];
  terminateTree?: (child: ChildProcess) => void | Promise<void>;
}

interface NativeSnapshotExecution {
  deadlineAt: number;
  gitProcess: NativeGitProcessAdapter;
}

interface NativeGitSelectionLimits {
  maxRecords: number;
  maxBytes: number;
  maxRecordBytes: number;
}

interface NativePhysicalSelectionLimits {
  maxNodes: number;
  maxBytes: number;
  maxPathBytes: number;
}

interface NativePhysicalSelectionHooks {
  afterInitialSelection?: () => void | Promise<void>;
  afterNode?: (relative: string) => void | Promise<void>;
}

interface NativeGitSelectionHooks {
  afterStageBefore?: () => void | Promise<void>;
  afterCombined?: () => void | Promise<void>;
  afterInitialSelection?: () => void | Promise<void>;
  afterFirstEntryCaptured?: (relative: string) => void | Promise<void>;
  outputChunkBytes?: number;
}

interface NativeGitSelectionFence {
  stageBefore: NativeGitSelectionEvidence['stageBefore'];
  combined: NativeGitSelectionEvidence['combined'];
  stageAfter: NativeGitSelectionEvidence['stageAfter'];
}

interface NativeGitSnapshotSelection {
  tracked: Set<string>;
  untracked: Set<string>;
  gitlinks: Set<string>;
  nestedRepositories: Set<string>;
  omissions: NativeSnapshotOmission[];
  overflow: NativeGitSelectionOverflow | null;
  evidence: NativeGitSelectionEvidence | null;
  initialFence: NativeGitSelectionFence;
}

interface NativeGitSelectionOverflow {
  count: number;
  hash: string;
}

interface NativePhysicalSelectionRecord {
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
}

interface NativePhysicalSnapshotSelection {
  records: NativePhysicalSelectionRecord[];
  evidence: NativePhysicalSelectionEvidence['before'];
  omissions: NativeSnapshotOmission[];
}

type NativeCapturedEntryValidation =
  | {
      kind: 'file';
      target: string;
      realTarget: string;
      stat: import('fs').Stats;
    }
  | {
      kind: 'symlink';
      target: string;
      rawTarget: Buffer;
      stat: import('fs').Stats;
    }
  | {
      kind: 'gitlink';
      target: string;
      realTarget: string;
      stat: import('fs').Stats;
      hash: string;
    };

export interface NativeContentSnapshotHealth {
  complete: boolean;
  omittedCount: number;
  recordedOmissionCount: number;
  overflowCount: number;
  samplePaths: string[];
  sampleTruncated: boolean;
}

const GIT_LIST_STDERR_LIMIT = 64 * 1024;
const GIT_TEXT_STDOUT_LIMIT = 64 * 1024;
const DEFAULT_NATIVE_SNAPSHOT_EXECUTION_BUDGET_MS = 60_000;
const WINDOWS_TASKKILL_ATTEMPT_MS = 1_000;
const WINDOWS_TASKKILL_ATTEMPTS = 2;
const DEFAULT_NATIVE_GIT_SELECTION_LIMITS: NativeGitSelectionLimits = {
  maxRecords: 20_000,
  maxBytes: 8 * 1024 * 1024,
  maxRecordBytes: 64 * 1024,
};
const DEFAULT_NATIVE_PHYSICAL_SELECTION_LIMITS: NativePhysicalSelectionLimits = {
  maxNodes: 20_000,
  maxBytes: 8 * 1024 * 1024,
  maxPathBytes: 64 * 1024,
};

function createNativeSnapshotExecution(options: SnapshotOptions): NativeSnapshotExecution {
  const deadlineMs = options.deadlineMs ?? DEFAULT_NATIVE_SNAPSHOT_EXECUTION_BUDGET_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) {
    throw new Error('Native snapshot execution budget must be a positive integer');
  }
  return {
    deadlineAt: Date.now() + deadlineMs,
    gitProcess: options.gitProcess ?? { command: 'git' },
  };
}

function remainingNativeSnapshotTime(execution: NativeSnapshotExecution): number {
  return Math.max(0, execution.deadlineAt - Date.now());
}

function nativeSnapshotExecutionHasBudget(execution: NativeSnapshotExecution): boolean {
  return remainingNativeSnapshotTime(execution) >= 1;
}

function nativeGitSnapshotTimeoutError(cause?: unknown): Error & { code: 'GIT_SNAPSHOT_TIMEOUT' } {
  const error =
    cause === undefined
      ? new Error('Native snapshot deadline exceeded while waiting for Git')
      : new Error('Native snapshot deadline exceeded while waiting for Git', { cause });
  return Object.assign(error, { code: 'GIT_SNAPSHOT_TIMEOUT' as const });
}

function isNativeGitSnapshotTimeout(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'GIT_SNAPSHOT_TIMEOUT';
}

function resolveNativePhysicalSelectionLimits(
  values: Partial<NativePhysicalSelectionLimits> | undefined,
): NativePhysicalSelectionLimits {
  const limits = { ...DEFAULT_NATIVE_PHYSICAL_SELECTION_LIMITS, ...values };
  if (
    !Number.isSafeInteger(limits.maxNodes) ||
    limits.maxNodes < 1 ||
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes < 1 ||
    !Number.isSafeInteger(limits.maxPathBytes) ||
    limits.maxPathBytes < 1 ||
    limits.maxPathBytes > limits.maxBytes
  ) {
    throw new Error('Native physical selection limits must be positive bounded integers');
  }
  return limits;
}

async function terminateNativeProcessTree(
  child: ChildProcess,
  adapter: NativeGitProcessAdapter,
): Promise<void> {
  if (adapter.terminateTree) {
    await adapter.terminateTree(child);
    return;
  }
  const pid = child.pid;
  if (pid === undefined) {
    child.kill('SIGKILL');
    return;
  }
  if (process.platform === 'win32') {
    const configuredSystemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    const systemRoot =
      configuredSystemRoot && path.win32.isAbsolute(configuredSystemRoot)
        ? path.win32.resolve(configuredSystemRoot)
        : 'C:\\Windows';
    const taskkill = path.win32.join(systemRoot, 'System32', 'taskkill.exe');
    if (!path.win32.isAbsolute(taskkill)) {
      child.kill('SIGKILL');
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      throw Object.assign(new Error('Native Git taskkill path is not trusted'), {
        code: 'GIT_SNAPSHOT_TERMINATION_UNCONFIRMED' as const,
      });
    }
    const runTaskkillAttempt = (): Promise<boolean> =>
      new Promise((resolve) => {
        let finished = false;
        let killer: ChildProcess | null = null;
        let fallbackTimer: NodeJS.Timeout | null = null;
        const finish = (confirmed: boolean, terminateKiller = false): void => {
          if (finished) return;
          finished = true;
          if (fallbackTimer) clearTimeout(fallbackTimer);
          if (terminateKiller) killer?.kill('SIGKILL');
          resolve(confirmed);
        };
        try {
          killer = spawn(taskkill, ['/pid', String(pid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          killer.once('error', () => finish(false));
          killer.once('close', (code) => finish(code === 0));
          fallbackTimer = setTimeout(() => finish(false, true), WINDOWS_TASKKILL_ATTEMPT_MS);
          fallbackTimer.unref();
        } catch {
          finish(false);
        }
      });
    for (let attempt = 0; attempt < WINDOWS_TASKKILL_ATTEMPTS; attempt += 1) {
      if (await runTaskkillAttempt()) {
        child.kill('SIGKILL');
        return;
      }
    }
    child.kill('SIGKILL');
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
    throw Object.assign(
      new Error('Native Git process-tree termination could not be confirmed on Windows'),
      { code: 'GIT_SNAPSHOT_TERMINATION_UNCONFIRMED' as const },
    );
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  child.kill('SIGKILL');
}

interface NativeGitProcessCompletion {
  code: number | null;
  spawnError: Error | null;
}

function startNativeGitProcess(
  execution: NativeSnapshotExecution,
  projectRoot: string,
  args: readonly string[],
  input: boolean,
): { child: ChildProcess; completion: Promise<NativeGitProcessCompletion> } {
  const remaining = remainingNativeSnapshotTime(execution);
  if (remaining < 1) throw nativeGitSnapshotTimeoutError();
  const adapter = execution.gitProcess;
  const child = spawn(
    adapter.command,
    [...(adapter.argsPrefix ?? []), '-C', projectRoot, ...args],
    {
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    },
  );
  let spawnError: Error | null = null;
  let timedOut = false;
  let termination: Promise<{ error: unknown | null }> | null = null;
  child.once('error', (error) => {
    spawnError = error;
  });
  const close = new Promise<number | null>((resolve) => {
    child.once('close', resolve);
  });
  const timer = setTimeout(() => {
    timedOut = true;
    termination = terminateNativeProcessTree(child, adapter).then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );
  }, remaining);
  timer.unref();
  const completion = close.then(async (code) => {
    clearTimeout(timer);
    if (timedOut) {
      const result = await termination;
      if (result?.error) throw nativeGitSnapshotTimeoutError(result.error);
      throw nativeGitSnapshotTimeoutError();
    }
    return { code, spawnError };
  });
  return { child, completion };
}

function resolveNativeGitSelectionLimits(
  values: Partial<NativeGitSelectionLimits> | undefined,
): NativeGitSelectionLimits {
  const limits = { ...DEFAULT_NATIVE_GIT_SELECTION_LIMITS, ...values };
  if (
    !Number.isSafeInteger(limits.maxRecords) ||
    limits.maxRecords < 1 ||
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes < 1 ||
    !Number.isSafeInteger(limits.maxRecordBytes) ||
    limits.maxRecordBytes < 1 ||
    limits.maxRecordBytes > limits.maxBytes
  ) {
    throw new Error('Native Git selection limits must be positive bounded integers');
  }
  return limits;
}

async function runGitBoundedOutput(
  execution: NativeSnapshotExecution,
  projectRoot: string,
  args: readonly string[],
  maxBytes = GIT_TEXT_STDOUT_LIMIT,
): Promise<Buffer> {
  const { child, completion } = startNativeGitProcess(execution, projectRoot, args, false);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stderrBytes = 0;
  let stdoutBytes = 0;
  let stdoutOverflow = false;
  child.stdout!.on('data', (chunk: Buffer) => {
    const remaining = Math.max(0, maxBytes - stdoutBytes);
    if (remaining > 0) stdout.push(Buffer.from(chunk).subarray(0, remaining));
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > maxBytes) stdoutOverflow = true;
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    if (stderrBytes >= GIT_LIST_STDERR_LIMIT) return;
    const remaining = GIT_LIST_STDERR_LIMIT - stderrBytes;
    const bounded = Buffer.from(chunk).subarray(0, remaining);
    stderr.push(bounded);
    stderrBytes += bounded.byteLength;
  });
  const { code, spawnError } = await completion;
  if (code === 0 && spawnError === null && !stdoutOverflow) return Buffer.concat(stdout);
  throw Object.assign(
    new Error(
      `git ${args.join(' ')} failed${spawnError ? `: ${spawnError.message}` : stderr.length > 0 ? `: ${Buffer.concat(stderr).toString('utf8').trim()}` : ''}`,
    ),
    { code: 'GIT_SNAPSHOT_UNAVAILABLE' },
  );
}

interface GitNullRecordResult {
  records: Buffer[];
  digest: string;
  overflow: boolean;
  recordCount: number;
  stdoutBytes: number;
}

interface GitNullRecordOptions extends NativeGitSelectionLimits {
  acceptedExitCodes?: readonly number[];
  stdin?: Buffer;
  outputChunkBytes?: number;
}

function gitSelectionStreamEvidence(
  result: GitNullRecordResult,
): NativeGitSelectionEvidence['combined'] {
  return {
    hash: result.digest,
    recordCount: result.recordCount,
    storedRecordCount: result.records.length,
    stdoutBytes: result.stdoutBytes,
    overflow: result.overflow,
  };
}

function runGitNullRecords(
  execution: NativeSnapshotExecution,
  projectRoot: string,
  args: readonly string[],
  options: GitNullRecordOptions,
): Promise<GitNullRecordResult> {
  if (
    options.outputChunkBytes !== undefined &&
    (!Number.isSafeInteger(options.outputChunkBytes) || options.outputChunkBytes < 1)
  ) {
    throw new Error('Native Git output chunk size must be a positive integer');
  }
  return new Promise((resolve, reject) => {
    const { child, completion } = startNativeGitProcess(
      execution,
      projectRoot,
      args,
      options.stdin !== undefined,
    );
    const records: Buffer[] = [];
    const digest = createHash('sha256');
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let storedBytes = 0;
    let recordCount = 0;
    let pending = Buffer.alloc(0);
    let droppingRecord = false;
    let overflow = false;
    let malformed = false;
    const consumeChunk = (chunk: Buffer): void => {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const separator = chunk.indexOf(0, offset);
        const end = separator < 0 ? chunk.byteLength : separator;
        const part = chunk.subarray(offset, end);
        if (!droppingRecord && part.byteLength > 0) {
          if (pending.byteLength + part.byteLength > options.maxRecordBytes) {
            pending = Buffer.alloc(0);
            droppingRecord = true;
            overflow = true;
          } else {
            pending = Buffer.concat([pending, part]);
          }
        }
        if (separator < 0) break;
        recordCount += 1;
        if (pending.byteLength === 0 && !droppingRecord) malformed = true;
        const recordBytes = pending.byteLength + 1;
        if (
          !droppingRecord &&
          recordCount <= options.maxRecords &&
          storedBytes + recordBytes <= options.maxBytes
        ) {
          records.push(pending);
          storedBytes += recordBytes;
        } else {
          overflow = true;
        }
        pending = Buffer.alloc(0);
        droppingRecord = false;
        offset = separator + 1;
      }
    };
    child.stdout!.on('data', (chunk: Buffer) => {
      digest.update(chunk);
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > options.maxBytes) overflow = true;
      const outputChunkBytes = options.outputChunkBytes;
      if (outputChunkBytes === undefined) {
        consumeChunk(chunk);
        return;
      }
      for (let offset = 0; offset < chunk.byteLength; offset += outputChunkBytes) {
        consumeChunk(chunk.subarray(offset, Math.min(chunk.byteLength, offset + outputChunkBytes)));
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderrBytes >= GIT_LIST_STDERR_LIMIT) return;
      const remaining = GIT_LIST_STDERR_LIMIT - stderrBytes;
      const bounded = Buffer.from(chunk).subarray(0, remaining);
      stderr.push(bounded);
      stderrBytes += bounded.byteLength;
    });
    child.stdin?.on('error', () => {
      // `close` reports the authoritative command result; ignore an early pipe close here.
    });
    void completion.then(({ code, spawnError }) => {
      const acceptedExitCodes = options.acceptedExitCodes ?? [0];
      if (
        code !== null &&
        acceptedExitCodes.includes(code) &&
        spawnError === null &&
        !malformed &&
        pending.byteLength === 0 &&
        !droppingRecord
      ) {
        resolve({
          records,
          digest: digest.digest('hex'),
          overflow,
          recordCount,
          stdoutBytes,
        });
        return;
      }
      reject(
        new Error(
          `git ${args.join(' ')} failed${spawnError ? `: ${spawnError.message}` : malformed || pending.byteLength > 0 || droppingRecord ? ': malformed NUL-delimited output' : stderr.length > 0 ? `: ${Buffer.concat(stderr).toString('utf8').trim()}` : ''}`,
        ),
      );
    }, reject);
    if (options.stdin) child.stdin?.end(options.stdin);
  });
}

function decodeGitRecord(value: Buffer): string {
  const decoded = value.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(value)) {
    throw new Error('Native Git snapshot provider returned non-UTF-8 path data');
  }
  return decoded;
}

async function runGitCheckIgnore(
  execution: NativeSnapshotExecution,
  projectRoot: string,
  paths: readonly string[],
): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const result = await runGitNullRecords(
    execution,
    projectRoot,
    ['check-ignore', '--no-index', '-z', '--stdin'],
    {
      ...DEFAULT_NATIVE_GIT_SELECTION_LIMITS,
      maxRecords: Math.max(1, paths.length),
      acceptedExitCodes: [0, 1],
      stdin: Buffer.from(`${paths.join('\0')}\0`, 'utf8'),
    },
  );
  if (result.overflow) {
    throw new Error('Native Git check-ignore output exceeded its safety budget');
  }
  return new Set(
    result.records.map((record) => {
      const value = decodeGitRecord(record);
      return value.endsWith('/') ? value.slice(0, -1) : value;
    }),
  );
}

async function runGitHasOutput(
  execution: NativeSnapshotExecution,
  projectRoot: string,
  args: readonly string[],
): Promise<boolean> {
  const { child, completion } = startNativeGitProcess(execution, projectRoot, args, false);
  const stderr: Buffer[] = [];
  let stderrBytes = 0;
  let hasOutput = false;
  child.stdout!.on('data', (chunk: Buffer) => {
    if (chunk.byteLength > 0) hasOutput = true;
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    if (stderrBytes >= GIT_LIST_STDERR_LIMIT) return;
    const remaining = GIT_LIST_STDERR_LIMIT - stderrBytes;
    const bounded = Buffer.from(chunk).subarray(0, remaining);
    stderr.push(bounded);
    stderrBytes += bounded.byteLength;
  });
  const { code, spawnError } = await completion;
  if (code === 0 && spawnError === null) return hasOutput;
  throw new Error(
    `git ${args.join(' ')} failed${spawnError ? `: ${spawnError.message}` : stderr.length > 0 ? `: ${Buffer.concat(stderr).toString('utf8').trim()}` : ''}`,
  );
}

function safeGitProjectPath(value: string): string | null {
  const withoutDirectoryMarker = value.endsWith('/') ? value.slice(0, -1) : value;
  if (
    withoutDirectoryMarker.length === 0 ||
    withoutDirectoryMarker.includes('\\') ||
    path.posix.isAbsolute(withoutDirectoryMarker) ||
    /^[A-Za-z]:/u.test(withoutDirectoryMarker) ||
    path.posix.normalize(withoutDirectoryMarker) !== withoutDirectoryMarker ||
    withoutDirectoryMarker === '..' ||
    withoutDirectoryMarker.startsWith('../') ||
    withoutDirectoryMarker.includes('\0')
  ) {
    return null;
  }
  return withoutDirectoryMarker;
}

function requireSafeGitProjectPaths(values: readonly string[], source: string): string[] {
  return values.map((value) => {
    const relative = safeGitProjectPath(value);
    if (relative === null) {
      throw new Error(`Native Git snapshot provider returned an unsafe ${source} path`);
    }
    return relative;
  });
}

async function hasGitMetadataBoundary(projectRoot: string): Promise<boolean> {
  let cursor = path.resolve(projectRoot);
  while (true) {
    try {
      await fs.lstat(path.join(cursor, '.git'));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

interface NativeGitSelectionResults {
  stagedBefore: GitNullRecordResult;
  combined: GitNullRecordResult;
  stagedAfter: GitNullRecordResult;
}

async function readNativeGitSelectionResults(
  execution: NativeSnapshotExecution,
  projectRoot: string,
  limits: NativeGitSelectionLimits,
  hooks: Pick<
    NativeGitSelectionHooks,
    'afterStageBefore' | 'afterCombined' | 'outputChunkBytes'
  > = {},
): Promise<NativeGitSelectionResults> {
  const options: GitNullRecordOptions = {
    ...limits,
    ...(hooks.outputChunkBytes === undefined ? {} : { outputChunkBytes: hooks.outputChunkBytes }),
  };
  const stagedBefore = await runGitNullRecords(
    execution,
    projectRoot,
    ['ls-files', '--stage', '-z'],
    options,
  );
  await hooks.afterStageBefore?.();
  const combined = await runGitNullRecords(
    execution,
    projectRoot,
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    options,
  );
  await hooks.afterCombined?.();
  const stagedAfter = await runGitNullRecords(
    execution,
    projectRoot,
    ['ls-files', '--stage', '-z'],
    options,
  );
  return { stagedBefore, combined, stagedAfter };
}

function gitSelectionFence(results: NativeGitSelectionResults): NativeGitSelectionFence {
  return {
    stageBefore: gitSelectionStreamEvidence(results.stagedBefore),
    combined: gitSelectionStreamEvidence(results.combined),
    stageAfter: gitSelectionStreamEvidence(results.stagedAfter),
  };
}

async function nativeGitSnapshotSelection(
  execution: NativeSnapshotExecution,
  projectRoot: string,
  limits: NativeGitSelectionLimits = DEFAULT_NATIVE_GIT_SELECTION_LIMITS,
  hooks: NativeGitSelectionHooks = {},
): Promise<NativeGitSnapshotSelection | null> {
  if (!(await hasGitMetadataBoundary(projectRoot))) return null;
  let insideWorktree: Buffer;
  try {
    insideWorktree = await runGitBoundedOutput(execution, projectRoot, [
      'rev-parse',
      '--is-inside-work-tree',
    ]);
  } catch (error) {
    if (isNativeGitSnapshotTimeout(error)) throw error;
    throw new Error('Native Git snapshot provider could not inspect the repository boundary', {
      cause: error,
    });
  }
  if (insideWorktree.toString('utf8').trim() !== 'true') {
    throw new Error('Native Git snapshot provider found .git metadata outside a working tree');
  }
  let results: NativeGitSelectionResults;
  try {
    results = await readNativeGitSelectionResults(execution, projectRoot, limits, hooks);
  } catch (error) {
    if (isNativeGitSnapshotTimeout(error)) throw error;
    throw new Error('Native Git snapshot provider failed after repository detection', {
      cause: error,
    });
  }
  const { stagedBefore, combined, stagedAfter } = results;

  const tracked = new Set<string>();
  const gitlinks = new Set<string>();
  const addStagedRecords = (records: readonly Buffer[]): void => {
    for (const encoded of records) {
      const record = decodeGitRecord(encoded);
      const separator = record.indexOf('\t');
      if (separator < 0) {
        throw new Error('Native Git snapshot provider returned a malformed staged record');
      }
      const header =
        /^(?<mode>[0-7]{6}) (?<objectId>[a-f0-9]{40}|[a-f0-9]{64}) (?<stage>[0-3])$/u.exec(
          record.slice(0, separator),
        )?.groups;
      if (!header) {
        throw new Error('Native Git snapshot provider returned a malformed staged header');
      }
      const relative = safeGitProjectPath(record.slice(separator + 1));
      if (relative === null) {
        throw new Error('Native Git snapshot provider returned an unsafe staged path');
      }
      tracked.add(relative);
      if (header.mode === '160000' && header.stage === '0') gitlinks.add(relative);
    }
  };
  addStagedRecords(stagedBefore.records);
  addStagedRecords(stagedAfter.records);

  const combinedRecords = combined.records.map(decodeGitRecord);
  const combinedPaths = requireSafeGitProjectPaths(combinedRecords, 'combined');
  const untracked = new Set(combinedPaths.filter((relative) => !tracked.has(relative)));
  const nestedRepositories = new Set(
    combinedPaths.filter(
      (relative, index) => !tracked.has(relative) && combinedRecords[index]!.endsWith('/'),
    ),
  );
  for (const gitlink of gitlinks) nestedRepositories.delete(gitlink);
  return {
    tracked,
    untracked,
    gitlinks,
    nestedRepositories,
    omissions: [],
    overflow: null,
    evidence: null,
    initialFence: gitSelectionFence(results),
  };
}

function sameGitSelectionStream(
  left: NativeGitSelectionEvidence['combined'],
  right: NativeGitSelectionEvidence['combined'],
): boolean {
  return (
    left.hash === right.hash &&
    left.recordCount === right.recordCount &&
    left.storedRecordCount === right.storedRecordCount &&
    left.stdoutBytes === right.stdoutBytes &&
    left.overflow === right.overflow
  );
}

function gitSelectionFenceOverflow(fence: NativeGitSelectionFence): boolean {
  return fence.stageBefore.overflow || fence.combined.overflow || fence.stageAfter.overflow;
}

function gitSelectionChanged(
  initial: NativeGitSelectionFence,
  final: NativeGitSelectionFence,
): boolean {
  return (
    !sameGitSelectionStream(initial.stageBefore, initial.stageAfter) ||
    !sameGitSelectionStream(initial.stageAfter, final.stageBefore) ||
    !sameGitSelectionStream(initial.combined, final.combined) ||
    !sameGitSelectionStream(final.stageBefore, final.stageAfter)
  );
}

async function finalizeNativeGitSnapshotSelection(
  execution: NativeSnapshotExecution,
  projectRoot: string,
  limits: NativeGitSelectionLimits,
  selection: NativeGitSnapshotSelection,
  outputChunkBytes?: number,
): Promise<void> {
  let finalResults: NativeGitSelectionResults;
  try {
    finalResults = await readNativeGitSelectionResults(execution, projectRoot, limits, {
      ...(outputChunkBytes === undefined ? {} : { outputChunkBytes }),
    });
  } catch (error) {
    if (isNativeGitSnapshotTimeout(error)) throw error;
    throw new Error('Native Git snapshot provider failed during its final selection fence', {
      cause: error,
    });
  }
  const initial = selection.initialFence;
  const final = gitSelectionFence(finalResults);
  const hasOverflow = gitSelectionFenceOverflow(initial) || gitSelectionFenceOverflow(final);
  const changed = gitSelectionChanged(initial, final);
  if (hasOverflow) {
    selection.omissions.push({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'git-enumeration-limit',
    });
  }
  if (changed) {
    selection.omissions.push({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'git-selection-changed',
    });
  }
  selection.evidence =
    hasOverflow || changed
      ? {
          schema: 'comet.native.git-selection.v1',
          status:
            hasOverflow && changed ? 'overflow-and-changed' : hasOverflow ? 'overflow' : 'changed',
          ...initial,
          finalStageBefore: final.stageBefore,
          finalCombined: final.combined,
          finalStageAfter: final.stageAfter,
        }
      : null;
  if (initial.combined.overflow || final.combined.overflow) {
    selection.overflow = {
      count: Math.max(
        1,
        initial.combined.recordCount - initial.combined.storedRecordCount,
        final.combined.recordCount - final.combined.storedRecordCount,
      ),
      hash: sha256Text(
        `comet.native.git-selection-overflow.v2\n${JSON.stringify({
          initial: initial.combined,
          final: final.combined,
        })}`,
      ),
    };
  }
}

const PHYSICAL_SELECTION_SUM_MASK = (1n << 256n) - 1n;

function physicalSelectionRecordType(
  stat: import('fs').Stats,
): NativePhysicalSelectionRecord['type'] {
  if (stat.isFile()) return 'file';
  if (stat.isDirectory()) return 'directory';
  if (stat.isSymbolicLink()) return 'symlink';
  return 'other';
}

async function nativePhysicalSnapshotSelection(options: {
  execution: NativeSnapshotExecution;
  paths: NativeProjectPaths;
  physicalProjectRoot: string;
  physicalNativeRoot: string;
  denylist: readonly string[];
  limits: NativePhysicalSelectionLimits;
  hooks?: NativePhysicalSelectionHooks;
}): Promise<NativePhysicalSnapshotSelection> {
  // This is deliberately a cooperative execution budget, not a promise-race timeout. Node's fs
  // promises do not accept AbortSignal; abandoning one would let I/O or a Dir handle live past the
  // snapshot. Every production fs operation is therefore checked on both sides, and any crossing
  // makes the whole physical selection non-overridable overflow evidence.
  const projectRoot = path.resolve(options.paths.projectRoot);
  const nativeRoot = path.resolve(options.paths.nativeRoot);
  const configFile = path.resolve(options.paths.configFile);
  const selectionFile = path.join(projectRoot, '.comet', 'current-change.json');
  const records: NativePhysicalSelectionRecord[] = [];
  const omissions: NativeSnapshotOmission[] = [];
  const xor = Buffer.alloc(32);
  let sum = 0n;
  let visitedNodeCount = 0;
  let recordCount = 0;
  let encodedBytes = 0;
  let overflow = false;
  let unstable = false;
  let stopped = false;

  const hasExecutionBudget = (): boolean => {
    if (remainingNativeSnapshotTime(options.execution) >= 1) return true;
    overflow = true;
    stopped = true;
    return false;
  };

  const addRecord = (record: NativePhysicalSelectionRecord): void => {
    const encoded = Buffer.from(`${record.type}\0${record.path}`, 'utf8');
    const digest = createHash('sha256')
      .update('comet.native.physical-selection-record.v1\0')
      .update(encoded)
      .digest();
    for (let index = 0; index < xor.length; index += 1) xor[index] ^= digest[index]!;
    sum = (sum + BigInt(`0x${digest.toString('hex')}`)) & PHYSICAL_SELECTION_SUM_MASK;
    recordCount += 1;
    encodedBytes += encoded.byteLength;
    if (
      Buffer.byteLength(record.path, 'utf8') > options.limits.maxPathBytes ||
      encodedBytes > options.limits.maxBytes
    ) {
      overflow = true;
      stopped = true;
      return;
    }
    records.push(record);
  };

  const visit = async (directory: string): Promise<void> => {
    if (stopped) return;
    if (!hasExecutionBudget()) return;
    let handle: Awaited<ReturnType<typeof fs.opendir>>;
    try {
      handle = await fs.opendir(directory);
    } catch (error) {
      if (!hasExecutionBudget()) return;
      if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
      if (directory === projectRoot && isUnreadableError(error)) throw error;
      unstable ||= isChangedDuringReadError(error);
      overflow ||= isUnreadableError(error);
      stopped = true;
      return;
    }
    if (!hasExecutionBudget()) {
      try {
        await handle.close();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED') throw error;
      }
      return;
    }
    let traversalFailed = false;
    let traversalError: unknown;
    try {
      while (!stopped) {
        if (!hasExecutionBudget()) break;
        let child: import('fs').Dirent | null;
        try {
          child = await handle.read();
        } catch (error) {
          if (!hasExecutionBudget()) break;
          if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
          if (directory === projectRoot && isUnreadableError(error)) throw error;
          unstable ||= isChangedDuringReadError(error);
          overflow ||= isUnreadableError(error);
          stopped = true;
          break;
        }
        if (!hasExecutionBudget() || child === null) break;
        visitedNodeCount += 1;
        if (visitedNodeCount > options.limits.maxNodes) {
          overflow = true;
          stopped = true;
          break;
        }
        const target = path.join(directory, child.name);
        const relative = portableRelative(projectRoot, target);
        if (
          target === configFile ||
          target === selectionFile ||
          sameOrInside(nativeRoot, target) ||
          options.denylist.some((denied) => sameOrInside(denied, target)) ||
          nativeSensitiveRelativePathReason(relative) !== null
        ) {
          continue;
        }
        if (!hasExecutionBudget()) break;
        let stat: import('fs').Stats;
        try {
          stat = await fs.lstat(target);
        } catch (error) {
          if (!hasExecutionBudget()) break;
          if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
          unstable = true;
          addRecord({ path: relative, type: 'other' });
          omissions.push({
            path: relative,
            size: null,
            type: 'file',
            reason: isUnreadableError(error) ? 'unreadable' : 'changed-during-read',
          });
          await options.hooks?.afterNode?.(relative);
          if (stopped) break;
          if (!hasExecutionBudget()) break;
          continue;
        }
        if (!hasExecutionBudget()) break;
        const type = physicalSelectionRecordType(stat);
        if (type === 'directory') {
          if (!hasExecutionBudget()) break;
          let realDirectory: string;
          try {
            realDirectory = await fs.realpath(target);
          } catch (error) {
            if (!hasExecutionBudget()) break;
            if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
            unstable = true;
            addRecord({ path: relative, type });
            omissions.push({
              path: relative,
              size: null,
              type: 'directory',
              reason: isUnreadableError(error) ? 'unreadable' : 'changed-during-read',
            });
            await options.hooks?.afterNode?.(relative);
            if (stopped) break;
            if (!hasExecutionBudget()) break;
            continue;
          }
          if (!hasExecutionBudget()) break;
          if (
            !isInsidePath(options.physicalProjectRoot, realDirectory) ||
            sameOrInside(options.physicalNativeRoot, realDirectory)
          ) {
            continue;
          }
          addRecord({ path: relative, type });
          await options.hooks?.afterNode?.(relative);
          if (!hasExecutionBudget()) break;
          await visit(target);
          if (stopped) break;
          continue;
        }
        addRecord({ path: relative, type });
        await options.hooks?.afterNode?.(relative);
        if (!hasExecutionBudget()) break;
        if (stopped) break;
      }
    } catch (error) {
      traversalFailed = true;
      traversalError = error;
    }
    let closeError: unknown;
    try {
      await handle.close();
    } catch (error) {
      closeError = error;
    }
    const withinBudget = hasExecutionBudget();
    if (traversalFailed) throw traversalError;
    if (
      withinBudget &&
      closeError !== undefined &&
      (closeError as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED'
    ) {
      throw closeError;
    }
  };

  await visit(projectRoot);
  hasExecutionBudget();
  if (overflow) {
    // The tail is intentionally unbound once a hard enumeration budget is crossed. Discard the
    // order-dependent prefix entirely; callers must treat this evidence as non-overridable.
    records.length = 0;
    recordCount = 0;
    encodedBytes = 0;
  } else {
    records.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    omissions.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  }
  const hash = overflow
    ? sha256Text(
        `comet.native.physical-selection-incomplete.v1\n${JSON.stringify({
          maxNodes: options.limits.maxNodes,
          maxBytes: options.limits.maxBytes,
          maxPathBytes: options.limits.maxPathBytes,
        })}`,
      )
    : sha256Text(
        `comet.native.physical-selection.v1\n${JSON.stringify({
          visitedNodeCount,
          recordCount,
          encodedBytes,
          xor: xor.toString('hex'),
          sum: sum.toString(16).padStart(64, '0'),
        })}`,
      );
  return {
    records,
    omissions,
    evidence: {
      hash,
      visitedNodeCount,
      recordCount,
      storedRecordCount: records.length,
      encodedBytes,
      overflow,
      unstable,
    },
  };
}

function samePhysicalSelectionStream(
  left: NativePhysicalSelectionEvidence['before'],
  right: NativePhysicalSelectionEvidence['before'],
): boolean {
  return (
    left.hash === right.hash &&
    left.visitedNodeCount === right.visitedNodeCount &&
    left.recordCount === right.recordCount &&
    left.storedRecordCount === right.storedRecordCount &&
    left.encodedBytes === right.encodedBytes &&
    left.overflow === right.overflow &&
    left.unstable === right.unstable
  );
}

function finalizeNativePhysicalSelection(
  before: NativePhysicalSelectionEvidence['before'],
  after: NativePhysicalSelectionEvidence['after'],
): { evidence: NativePhysicalSelectionEvidence | null; omissions: NativeSnapshotOmission[] } {
  const hasOverflow = before.overflow || after.overflow;
  const changed = before.unstable || after.unstable || !samePhysicalSelectionStream(before, after);
  const omissions: NativeSnapshotOmission[] = [];
  if (hasOverflow) {
    omissions.push({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'physical-enumeration-limit',
    });
  }
  if (changed) {
    omissions.push({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'physical-selection-changed',
    });
  }
  return {
    omissions,
    evidence:
      hasOverflow || changed
        ? {
            schema: 'comet.native.physical-selection.v1',
            status:
              hasOverflow && changed
                ? 'overflow-and-changed'
                : hasOverflow
                  ? 'overflow'
                  : 'changed',
            before,
            after,
          }
        : null,
  };
}

function selectionPaths(selection: NativeGitSnapshotSelection): string[] {
  return [...new Set([...selection.tracked, ...selection.untracked])].sort((left, right) =>
    left.localeCompare(right, 'en'),
  );
}

async function readGitlinkWorkingTreeHeadHash(
  execution: NativeSnapshotExecution,
  target: string,
): Promise<string> {
  const output = await runGitBoundedOutput(execution, target, ['rev-parse', '--verify', 'HEAD']);
  const objectId = output.toString('utf8').trim().toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(objectId)) {
    throw new Error('Native Git snapshot provider received an invalid submodule HEAD');
  }
  return sha256Text(`gitlink:${objectId}`);
}

async function inspectGitlinkWorkingTree(
  execution: NativeSnapshotExecution,
  target: string,
): Promise<{ hash: string; dirty: boolean }> {
  const before = await readGitlinkWorkingTreeHeadHash(execution, target);
  const dirty = await runGitHasOutput(execution, target, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=normal',
  ]);
  const after = await readGitlinkWorkingTreeHeadHash(execution, target);
  if (after !== before) {
    throw new Error('Native Git snapshot provider observed a changing submodule HEAD');
  }
  return { hash: after, dirty };
}

function isSnapshotProjectRef(paths: NativeProjectPaths, relative: string): boolean {
  if (nativeSensitiveRelativePathReason(relative) !== null) return false;
  const target = path.resolve(paths.projectRoot, ...relative.split('/'));
  return !sameOrInside(path.resolve(paths.nativeRoot), target);
}

export function inspectNativeContentSnapshotHealth(
  value: NativeContentSnapshotManifest,
  options: { maxRecordedPaths?: number } = {},
): NativeContentSnapshotHealth {
  const manifest = parseNativeContentSnapshotManifest(value);
  const maxRecordedPaths = options.maxRecordedPaths ?? 20;
  if (!Number.isSafeInteger(maxRecordedPaths) || maxRecordedPaths < 0) {
    throw new Error('Native snapshot health maxRecordedPaths must be a non-negative integer');
  }
  const samplePaths = manifest.omitted.slice(0, maxRecordedPaths).map((omission) => omission.path);
  return {
    complete: manifest.complete,
    omittedCount: manifest.omittedCount,
    recordedOmissionCount: manifest.omitted.length,
    overflowCount: manifest.omissionOverflow?.count ?? 0,
    samplePaths,
    sampleTruncated: samplePaths.length < manifest.omittedCount,
  };
}

function portableRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

function normalizedDenylist(projectRoot: string, values: readonly string[]): string[] {
  return values.map((value) => path.resolve(projectRoot, ...value.split(/[\\/]/u)));
}

function sameOrInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return normalizedTarget === normalizedRoot || isInsidePath(normalizedRoot, normalizedTarget);
}

function isUnreadableError(error: unknown): boolean {
  return UNREADABLE_ERROR_CODES.has((error as NodeJS.ErrnoException).code ?? '');
}

function isChangedDuringReadError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function serializedManifestBytes(manifest: NativeContentSnapshotManifest): number {
  return Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n');
}

function foldSnapshotOverflowHash(previous: string, kind: string, value: unknown): string {
  const payload = JSON.stringify(value);
  return sha256Text(
    `${previous}\n${Buffer.byteLength(kind)}:${kind}\n${Buffer.byteLength(payload)}:${payload}`,
  );
}

function isSelectionIntegrityOmission(omission: NativeSnapshotOmission): boolean {
  return (
    omission.reason === 'git-enumeration-limit' ||
    omission.reason === 'git-selection-changed' ||
    omission.reason === 'physical-enumeration-limit' ||
    omission.reason === 'physical-selection-changed'
  );
}

function takeLastCompactableOmission(
  omissions: NativeSnapshotOmission[],
): NativeSnapshotOmission | null {
  for (let index = omissions.length - 1; index >= 0; index -= 1) {
    const omission = omissions[index]!;
    if (isSelectionIntegrityOmission(omission)) continue;
    omissions.splice(index, 1);
    return omission;
  }
  return null;
}

function sameFileIdentity(left: import('fs').Stats, right: import('fs').Stats): boolean {
  if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return (
    left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.size === right.size
  );
}

async function sha256FileBounded(
  file: string,
  maxBytes: number,
  expected: import('fs').Stats,
  execution: NativeSnapshotExecution,
): Promise<
  | { status: 'complete'; hash: string; bytes: number; finalStat: import('fs').Stats }
  | { status: 'changed' }
  | { status: 'budget-exhausted' }
> {
  if (!nativeSnapshotExecutionHasBudget(execution)) return { status: 'budget-exhausted' };
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(file, 'r');
  } catch (error) {
    if (!nativeSnapshotExecutionHasBudget(execution)) return { status: 'budget-exhausted' };
    throw error;
  }
  if (!nativeSnapshotExecutionHasBudget(execution)) {
    await handle.close();
    return { status: 'budget-exhausted' };
  }
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
  let bytes = 0;
  try {
    if (!nativeSnapshotExecutionHasBudget(execution)) return { status: 'budget-exhausted' };
    const opened = await handle.stat();
    if (!nativeSnapshotExecutionHasBudget(execution)) return { status: 'budget-exhausted' };
    if (!opened.isFile() || !sameFileIdentity(expected, opened)) return { status: 'changed' };
    while (true) {
      if (!nativeSnapshotExecutionHasBudget(execution)) return { status: 'budget-exhausted' };
      const remaining = maxBytes + 1 - bytes;
      if (remaining < 1) return { status: 'changed' };
      const result = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (!nativeSnapshotExecutionHasBudget(execution)) return { status: 'budget-exhausted' };
      if (result.bytesRead === 0) {
        if (!nativeSnapshotExecutionHasBudget(execution)) return { status: 'budget-exhausted' };
        const finalStat = await handle.stat();
        if (!nativeSnapshotExecutionHasBudget(execution)) {
          return { status: 'budget-exhausted' };
        }
        if (!finalStat.isFile() || !sameFileIdentity(opened, finalStat)) {
          return { status: 'changed' };
        }
        return { status: 'complete', hash: hash.digest('hex'), bytes, finalStat };
      }
      if (bytes + result.bytesRead > maxBytes) return { status: 'changed' };
      hash.update(buffer.subarray(0, result.bytesRead));
      bytes += result.bytesRead;
    }
  } finally {
    await handle.close();
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, keys: Set<string>, label: string): void {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) throw new Error(`${label} contains unknown field: ${unknown}`);
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
}

function snapshotPath(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new Error(`${label} must be a normalized project-relative path`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    path.posix.isAbsolute(value) ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`${label} must stay inside the project root`);
  }
  return value;
}

function parseEntry(value: unknown, index: number): NativeSnapshotEntry {
  const entry = record(value, `Native snapshot entry ${index}`);
  rejectUnknown(entry, ENTRY_KEYS, `Native snapshot entry ${index}`);
  const entryPath = snapshotPath(entry.path, `Native snapshot entry ${index} path`);
  if (typeof entry.hash !== 'string' || !HASH_PATTERN.test(entry.hash)) {
    throw new Error(`Native snapshot entry ${index} hash is invalid`);
  }
  if (entry.type !== 'file') throw new Error(`Native snapshot entry ${index} type is invalid`);
  return {
    path: entryPath,
    hash: entry.hash,
    size: nonNegativeInteger(entry.size, `Native snapshot entry ${index} size`),
    type: 'file',
  };
}

function parseOmission(value: unknown, index: number): NativeSnapshotOmission {
  const omission = record(value, `Native snapshot omission ${index}`);
  rejectUnknown(omission, OMISSION_KEYS, `Native snapshot omission ${index}`);
  if (!OMISSION_TYPES.has(omission.type as NativeSnapshotOmission['type'])) {
    throw new Error(`Native snapshot omission ${index} type is invalid`);
  }
  if (!OMISSION_REASONS.has(omission.reason as NativeSnapshotOmission['reason'])) {
    throw new Error(`Native snapshot omission ${index} reason is invalid`);
  }
  return {
    path: snapshotPath(omission.path, `Native snapshot omission ${index} path`),
    size:
      omission.size === null
        ? null
        : nonNegativeInteger(omission.size, `Native snapshot omission ${index} size`),
    type: omission.type as NativeSnapshotOmission['type'],
    reason: omission.reason as NativeSnapshotOmission['reason'],
  };
}

function parseOmissionOverflow(value: unknown): NativeSnapshotOmissionOverflow {
  const overflow = record(value, 'Native snapshot omission overflow');
  rejectUnknown(overflow, OMISSION_OVERFLOW_KEYS, 'Native snapshot omission overflow');
  if (typeof overflow.hash !== 'string' || !HASH_PATTERN.test(overflow.hash)) {
    throw new Error('Native snapshot omission overflow hash is invalid');
  }
  const expectedRef = `native-snapshot://omitted-overflow/${overflow.hash}`;
  if (overflow.ref !== expectedRef) {
    throw new Error('Native snapshot omission overflow ref is invalid');
  }
  return {
    ref: expectedRef,
    hash: overflow.hash,
    count: positiveInteger(overflow.count, 'Native snapshot omission overflow count'),
  };
}

function parseGitSelectionStreamEvidence(
  value: unknown,
  label: string,
): NativeGitSelectionEvidence['combined'] {
  const stream = record(value, label);
  rejectUnknown(stream, GIT_SELECTION_STREAM_KEYS, label);
  if (typeof stream.hash !== 'string' || !HASH_PATTERN.test(stream.hash)) {
    throw new Error(`${label} hash is invalid`);
  }
  if (typeof stream.overflow !== 'boolean') {
    throw new Error(`${label} overflow flag is invalid`);
  }
  const recordCount = nonNegativeInteger(stream.recordCount, `${label} recordCount`);
  const storedRecordCount = nonNegativeInteger(
    stream.storedRecordCount,
    `${label} storedRecordCount`,
  );
  const stdoutBytes = nonNegativeInteger(stream.stdoutBytes, `${label} stdoutBytes`);
  if (storedRecordCount > recordCount || (!stream.overflow && storedRecordCount !== recordCount)) {
    throw new Error(`${label} stored record count is inconsistent`);
  }
  return {
    hash: stream.hash,
    recordCount,
    storedRecordCount,
    stdoutBytes,
    overflow: stream.overflow,
  };
}

function parseGitSelectionEvidence(value: unknown): NativeGitSelectionEvidence {
  const selection = record(value, 'Native Git selection evidence');
  rejectUnknown(selection, GIT_SELECTION_KEYS, 'Native Git selection evidence');
  if (selection.schema !== 'comet.native.git-selection.v1') {
    throw new Error('Native Git selection evidence schema is invalid');
  }
  if (
    selection.status !== 'overflow' &&
    selection.status !== 'changed' &&
    selection.status !== 'overflow-and-changed'
  ) {
    throw new Error('Native Git selection evidence status is invalid');
  }
  const stageBefore = parseGitSelectionStreamEvidence(
    selection.stageBefore,
    'Native Git selection stageBefore',
  );
  const combined = parseGitSelectionStreamEvidence(
    selection.combined,
    'Native Git selection combined',
  );
  const stageAfter = parseGitSelectionStreamEvidence(
    selection.stageAfter,
    'Native Git selection stageAfter',
  );
  const finalStageBefore = parseGitSelectionStreamEvidence(
    selection.finalStageBefore,
    'Native Git selection finalStageBefore',
  );
  const finalCombined = parseGitSelectionStreamEvidence(
    selection.finalCombined,
    'Native Git selection finalCombined',
  );
  const finalStageAfter = parseGitSelectionStreamEvidence(
    selection.finalStageAfter,
    'Native Git selection finalStageAfter',
  );
  const hasOverflow = [
    stageBefore,
    combined,
    stageAfter,
    finalStageBefore,
    finalCombined,
    finalStageAfter,
  ].some((stream) => stream.overflow);
  const changed =
    !sameGitSelectionStream(stageBefore, stageAfter) ||
    !sameGitSelectionStream(stageAfter, finalStageBefore) ||
    !sameGitSelectionStream(combined, finalCombined) ||
    !sameGitSelectionStream(finalStageBefore, finalStageAfter);
  const expectedStatus =
    hasOverflow && changed ? 'overflow-and-changed' : hasOverflow ? 'overflow' : 'changed';
  if (!hasOverflow && !changed) {
    throw new Error('Native Git selection evidence must describe an exceptional selection');
  }
  if (selection.status !== expectedStatus) {
    throw new Error('Native Git selection evidence status is inconsistent');
  }
  return {
    schema: 'comet.native.git-selection.v1',
    status: expectedStatus,
    stageBefore,
    combined,
    stageAfter,
    finalStageBefore,
    finalCombined,
    finalStageAfter,
  };
}

function parsePhysicalSelectionStreamEvidence(
  value: unknown,
  label: string,
): NativePhysicalSelectionEvidence['before'] {
  const stream = record(value, label);
  rejectUnknown(stream, PHYSICAL_SELECTION_STREAM_KEYS, label);
  if (typeof stream.hash !== 'string' || !HASH_PATTERN.test(stream.hash)) {
    throw new Error(`${label} hash is invalid`);
  }
  if (typeof stream.overflow !== 'boolean' || typeof stream.unstable !== 'boolean') {
    throw new Error(`${label} flags are invalid`);
  }
  const visitedNodeCount = nonNegativeInteger(stream.visitedNodeCount, `${label} visitedNodeCount`);
  const recordCount = nonNegativeInteger(stream.recordCount, `${label} recordCount`);
  const storedRecordCount = nonNegativeInteger(
    stream.storedRecordCount,
    `${label} storedRecordCount`,
  );
  const encodedBytes = nonNegativeInteger(stream.encodedBytes, `${label} encodedBytes`);
  if (storedRecordCount > recordCount || (!stream.overflow && storedRecordCount !== recordCount)) {
    throw new Error(`${label} stored record count is inconsistent`);
  }
  return {
    hash: stream.hash,
    visitedNodeCount,
    recordCount,
    storedRecordCount,
    encodedBytes,
    overflow: stream.overflow,
    unstable: stream.unstable,
  };
}

function parsePhysicalSelectionEvidence(value: unknown): NativePhysicalSelectionEvidence {
  const selection = record(value, 'Native physical selection evidence');
  rejectUnknown(selection, PHYSICAL_SELECTION_KEYS, 'Native physical selection evidence');
  if (selection.schema !== 'comet.native.physical-selection.v1') {
    throw new Error('Native physical selection evidence schema is invalid');
  }
  if (
    selection.status !== 'overflow' &&
    selection.status !== 'changed' &&
    selection.status !== 'overflow-and-changed'
  ) {
    throw new Error('Native physical selection evidence status is invalid');
  }
  const before = parsePhysicalSelectionStreamEvidence(
    selection.before,
    'Native physical selection before',
  );
  const after = parsePhysicalSelectionStreamEvidence(
    selection.after,
    'Native physical selection after',
  );
  const hasOverflow = before.overflow || after.overflow;
  const changed = before.unstable || after.unstable || !samePhysicalSelectionStream(before, after);
  if (!hasOverflow && !changed) {
    throw new Error('Native physical selection evidence must describe an exceptional selection');
  }
  const expectedStatus =
    hasOverflow && changed ? 'overflow-and-changed' : hasOverflow ? 'overflow' : 'changed';
  if (selection.status !== expectedStatus) {
    throw new Error('Native physical selection evidence status is inconsistent');
  }
  return {
    schema: 'comet.native.physical-selection.v1',
    status: expectedStatus,
    before,
    after,
  };
}

export function parseNativeContentSnapshotManifest(value: unknown): NativeContentSnapshotManifest {
  const manifest = record(value, 'Native content snapshot manifest');
  rejectUnknown(manifest, MANIFEST_KEYS, 'Native content snapshot manifest');
  if (manifest.schema !== 'comet.native.content-snapshot.v1') {
    throw new Error('Unsupported Native content snapshot schema');
  }
  if (!SNAPSHOT_ORIGINS.has(manifest.origin as NativeContentSnapshotManifest['origin'])) {
    throw new Error('Native content snapshot origin is invalid');
  }
  let capture: NativeContentSnapshotManifest['capture'];
  if (manifest.capture !== undefined) {
    const captureValue = record(manifest.capture, 'Native content snapshot capture');
    rejectUnknown(captureValue, CAPTURE_KEYS, 'Native content snapshot capture');
    if (captureValue.provider !== 'git' && captureValue.provider !== 'physical-tree') {
      throw new Error('Native content snapshot capture provider is invalid');
    }
    const gitSelection =
      captureValue.gitSelection === undefined
        ? undefined
        : parseGitSelectionEvidence(captureValue.gitSelection);
    const physicalSelection =
      captureValue.physicalSelection === undefined
        ? undefined
        : parsePhysicalSelectionEvidence(captureValue.physicalSelection);
    let projection: NativeGitProjectionEvidence | null = null;
    if (captureValue.projection !== undefined) {
      const projectionValue = record(captureValue.projection, 'Native content snapshot projection');
      rejectUnknown(projectionValue, GIT_PROJECTION_KEYS, 'Native content snapshot projection');
      if (projectionValue.provider !== 'git') {
        throw new Error('Native content snapshot projection provider is invalid');
      }
      projection = {
        provider: 'git',
        ...(projectionValue.selection === undefined
          ? {}
          : { selection: parseGitSelectionEvidence(projectionValue.selection) }),
      };
    }
    if (captureValue.provider === 'git') {
      if (physicalSelection || projection) {
        throw new Error('Native Git capture cannot include physical or projection evidence');
      }
      capture = {
        provider: 'git',
        ...(gitSelection ? { gitSelection } : {}),
      };
    } else {
      if (gitSelection) {
        throw new Error('Native physical-tree capture cannot include direct Git evidence');
      }
      if (physicalSelection && projection) {
        throw new Error('Native physical-tree capture cannot combine selection and projection');
      }
      capture = projection
        ? { provider: 'physical-tree', projection }
        : {
            provider: 'physical-tree',
            ...(physicalSelection ? { physicalSelection } : {}),
          };
    }
  }
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error('Native content snapshot timestamp is invalid');
  }
  if (typeof manifest.complete !== 'boolean') {
    throw new Error('Native content snapshot complete flag is invalid');
  }
  const limitValue = record(manifest.limits, 'Native content snapshot limits');
  rejectUnknown(limitValue, LIMIT_KEYS, 'Native content snapshot limits');
  const limits = {
    maxFiles: positiveInteger(limitValue.maxFiles, 'Native snapshot maxFiles'),
    maxFileBytes: positiveInteger(limitValue.maxFileBytes, 'Native snapshot maxFileBytes'),
    maxTotalBytes: positiveInteger(limitValue.maxTotalBytes, 'Native snapshot maxTotalBytes'),
    maxManifestBytes: positiveInteger(
      limitValue.maxManifestBytes,
      'Native snapshot maxManifestBytes',
    ),
  };
  if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.omitted)) {
    throw new Error('Native content snapshot entries and omissions must be arrays');
  }
  const entries = manifest.entries.map(parseEntry);
  const omitted = manifest.omitted.map(parseOmission);
  const omittedCount = nonNegativeInteger(
    manifest.omittedCount,
    'Native content snapshot omittedCount',
  );
  const omissionOverflow =
    manifest.omissionOverflow === undefined
      ? undefined
      : parseOmissionOverflow(manifest.omissionOverflow);
  if (entries.length > limits.maxFiles) {
    throw new Error('Native content snapshot exceeds its file-count limit');
  }
  if (
    entries.some((entry) => entry.size > limits.maxFileBytes) ||
    entries.reduce((total, entry) => total + entry.size, 0) > limits.maxTotalBytes
  ) {
    throw new Error('Native content snapshot exceeds its byte limits');
  }
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error('Native content snapshot contains duplicate paths');
  }
  if (omitted.length > MAX_RECORDED_OMISSIONS || omittedCount < omitted.length) {
    throw new Error('Native content snapshot omission count is invalid');
  }
  const overflowCount = omittedCount - omitted.length;
  if (
    (overflowCount === 0 && omissionOverflow) ||
    (overflowCount > 0 && omissionOverflow?.count !== overflowCount)
  ) {
    throw new Error('Native content snapshot omission overflow is inconsistent');
  }
  if (manifest.complete !== (omittedCount === 0)) {
    throw new Error('Native content snapshot completeness is inconsistent');
  }
  const enumerationOmissions = omitted.filter(
    (omission) => omission.reason === 'git-enumeration-limit',
  );
  const selectionChangedOmissions = omitted.filter(
    (omission) => omission.reason === 'git-selection-changed',
  );
  for (const omission of [...enumerationOmissions, ...selectionChangedOmissions]) {
    if (omission.path !== '.' || omission.size !== null || omission.type !== 'directory') {
      throw new Error('Native Git selection omission must use the project-root sentinel');
    }
  }
  if (enumerationOmissions.length > 1 || selectionChangedOmissions.length > 1) {
    throw new Error('Native Git selection omissions must not be duplicated');
  }
  const gitSelection =
    capture?.provider === 'git' ? capture.gitSelection : capture?.projection?.selection;
  const evidenceHasOverflow =
    gitSelection?.status === 'overflow' || gitSelection?.status === 'overflow-and-changed';
  const evidenceHasSelectionChange =
    gitSelection?.status === 'changed' || gitSelection?.status === 'overflow-and-changed';
  if (evidenceHasOverflow !== (enumerationOmissions.length === 1)) {
    throw new Error('Native Git enumeration omission and selection evidence are inconsistent');
  }
  if (evidenceHasSelectionChange !== (selectionChangedOmissions.length === 1)) {
    throw new Error('Native Git selection-change omission and selection evidence are inconsistent');
  }
  const physicalEnumerationOmissions = omitted.filter(
    (omission) => omission.reason === 'physical-enumeration-limit',
  );
  const physicalChangedOmissions = omitted.filter(
    (omission) => omission.reason === 'physical-selection-changed',
  );
  for (const omission of [...physicalEnumerationOmissions, ...physicalChangedOmissions]) {
    if (omission.path !== '.' || omission.size !== null || omission.type !== 'directory') {
      throw new Error('Native physical selection omission must use the project-root sentinel');
    }
  }
  if (physicalEnumerationOmissions.length > 1 || physicalChangedOmissions.length > 1) {
    throw new Error('Native physical selection omissions must not be duplicated');
  }
  const physicalSelection = capture?.physicalSelection;
  const physicalEvidenceHasOverflow =
    physicalSelection?.status === 'overflow' ||
    physicalSelection?.status === 'overflow-and-changed';
  const physicalEvidenceHasChange =
    physicalSelection?.status === 'changed' || physicalSelection?.status === 'overflow-and-changed';
  if (physicalEvidenceHasOverflow !== (physicalEnumerationOmissions.length === 1)) {
    throw new Error('Native physical enumeration omission and evidence are inconsistent');
  }
  if (physicalEvidenceHasChange !== (physicalChangedOmissions.length === 1)) {
    throw new Error('Native physical selection-change omission and evidence are inconsistent');
  }
  const parsed: NativeContentSnapshotManifest = {
    schema: 'comet.native.content-snapshot.v1',
    origin: manifest.origin as NativeContentSnapshotManifest['origin'],
    ...(capture ? { capture } : {}),
    createdAt: manifest.createdAt,
    complete: manifest.complete,
    limits,
    entries,
    omitted,
    omittedCount,
    ...(omissionOverflow ? { omissionOverflow } : {}),
  };
  if (serializedManifestBytes(parsed) > limits.maxManifestBytes) {
    throw new Error('Native content snapshot exceeds its manifest byte limit');
  }
  return parsed;
}

/**
 * Projects a legacy physical-tree snapshot onto the same Git-owned universe used by new
 * snapshots. This keeps existing v1 baselines usable after ignored directories and nested
 * repositories stop participating in Native evidence.
 */
export async function filterNativeContentSnapshotToProjectScope(
  paths: NativeProjectPaths,
  value: NativeContentSnapshotManifest,
  options: Pick<
    SnapshotOptions,
    'gitSelectionLimits' | 'gitSelectionHooks' | 'deadlineMs' | 'gitProcess'
  > = {},
): Promise<NativeContentSnapshotManifest> {
  const manifest = parseNativeContentSnapshotManifest(value);
  if (
    manifest.capture?.provider === 'git' ||
    manifest.capture?.projection ||
    manifest.capture?.physicalSelection
  ) {
    return manifest;
  }
  const projectRoot = path.resolve(paths.projectRoot);
  const execution = createNativeSnapshotExecution(options);
  const gitSelectionLimits = resolveNativeGitSelectionLimits(options.gitSelectionLimits);
  const selection = await nativeGitSnapshotSelection(
    execution,
    projectRoot,
    gitSelectionLimits,
    options.gitSelectionHooks,
  );
  if (selection === null) return manifest;

  const selected = new Set(
    selectionPaths(selection).filter((relative) => isSnapshotProjectRef(paths, relative)),
  );
  const gitlinkPaths = [...selection.gitlinks].filter((relative) => selected.has(relative));
  const nestedRepositoryPaths = [...selection.nestedRepositories].filter((relative) =>
    isSnapshotProjectRef(paths, relative),
  );
  const atOrBeneath = (relative: string, boundaries: readonly string[]): boolean =>
    boundaries.some((boundary) => relative === boundary || relative.startsWith(`${boundary}/`));
  const beneathGitlink = (relative: string): boolean => atOrBeneath(relative, gitlinkPaths);
  const beneathNestedRepository = (relative: string): boolean =>
    atOrBeneath(relative, nestedRepositoryPaths);
  const ignoredCandidates = [
    ...manifest.entries.map((entry) => entry.path),
    ...manifest.omitted.flatMap((omission) =>
      omission.type === 'directory' ? [omission.path, `${omission.path}/`] : [omission.path],
    ),
  ].filter(
    (relative) =>
      !selected.has(relative) && !beneathGitlink(relative) && !beneathNestedRepository(relative),
  );
  const ignored = await runGitCheckIgnore(execution, projectRoot, ignoredCandidates);
  const entries = manifest.entries.filter(
    (entry) =>
      !beneathGitlink(entry.path) &&
      !beneathNestedRepository(entry.path) &&
      isSnapshotProjectRef(paths, entry.path) &&
      (selected.has(entry.path) || !ignored.has(entry.path)),
  );

  await finalizeNativeGitSnapshotSelection(
    execution,
    projectRoot,
    gitSelectionLimits,
    selection,
    options.gitSelectionHooks?.outputChunkBytes,
  );

  const boundaryOmissions: NativeSnapshotOmission[] = [...selection.omissions];
  for (const gitlink of gitlinkPaths) {
    // A physical-tree baseline recorded file contents below the old boundary, not the
    // submodule commit, and it did not record empty directories. Therefore no current
    // gitlink can be proven new or unchanged. Injecting today's HEAD would make the
    // historical baseline lie, so preserve every such boundary as explicit uncertainty.
    boundaryOmissions.push({
      path: gitlink,
      size: null,
      type: 'directory',
      reason: 'legacy-gitlink-boundary',
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'));

  const omitted = manifest.omitted.filter((omission) => {
    if (beneathGitlink(omission.path)) return false;
    if (beneathNestedRepository(omission.path)) return false;
    if (!isSnapshotProjectRef(paths, omission.path)) return false;
    if (!ignored.has(omission.path)) return true;
    return (
      selected.has(omission.path) ||
      [...selected].some((relative) => relative.startsWith(`${omission.path}/`))
    );
  });
  for (const omission of boundaryOmissions) {
    if (
      !omitted.some(
        (current) => current.path === omission.path && current.reason === omission.reason,
      )
    ) {
      omitted.push(omission);
    }
  }
  omitted.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  let overflowCount = manifest.omissionOverflow?.count ?? 0;
  let overflowHash =
    manifest.omissionOverflow?.hash ?? sha256Text('comet.native.snapshot-omission-overflow.v1');
  if (selection.overflow) {
    overflowCount += selection.overflow.count;
    overflowHash = foldSnapshotOverflowHash(overflowHash, 'git-selection', {
      source: 'git-selection',
      ...selection.overflow,
    });
  }
  const foldOverflow = (omission: NativeSnapshotOmission): void => {
    overflowCount += 1;
    overflowHash = foldSnapshotOverflowHash(overflowHash, 'omission', omission);
  };
  while (omitted.length > MAX_RECORDED_OMISSIONS) {
    const omission = takeLastCompactableOmission(omitted);
    if (omission === null) {
      throw new Error(
        'Projected Native snapshot has too many required selection-integrity omissions',
      );
    }
    foldOverflow(omission);
  }

  const buildProjection = (): NativeContentSnapshotManifest => ({
    ...manifest,
    capture: {
      provider: 'physical-tree',
      projection: {
        provider: 'git',
        ...(selection.evidence ? { selection: selection.evidence } : {}),
      },
    },
    complete: omitted.length + overflowCount === 0,
    entries,
    omitted,
    omittedCount: omitted.length + overflowCount,
    ...(overflowCount > 0
      ? {
          omissionOverflow: {
            ref: `native-snapshot://omitted-overflow/${overflowHash}`,
            hash: overflowHash,
            count: overflowCount,
          },
        }
      : {}),
  });
  let projected = buildProjection();
  while (serializedManifestBytes(projected) > manifest.limits.maxManifestBytes) {
    const omission = takeLastCompactableOmission(omitted);
    if (omission === null) {
      throw new Error('Projected Native snapshot cannot fit its manifest byte limit');
    }
    foldOverflow(omission);
    projected = buildProjection();
  }
  return parseNativeContentSnapshotManifest(projected);
}

export function nativeBaselineManifestFile(paths: NativeProjectPaths, name: string): string {
  if (!CHANGE_NAME_PATTERN.test(name)) throw new Error(`Invalid Native change name: ${name}`);
  const changeDir = path.join(paths.changesDir, name);
  if (!isInsidePath(paths.changesDir, changeDir)) throw new Error('Native change path escaped');
  return path.join(changeDir, 'runtime', 'baseline-manifest.json');
}

export async function createNativeContentSnapshot(
  paths: NativeProjectPaths,
  options: SnapshotOptions = {},
): Promise<NativeContentSnapshotManifest> {
  const execution = createNativeSnapshotExecution(options);
  const limits = {
    maxFiles: options.limits?.maxFiles ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxFiles,
    maxFileBytes: options.limits?.maxFileBytes ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxFileBytes,
    maxTotalBytes: options.limits?.maxTotalBytes ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxTotalBytes,
    maxManifestBytes:
      options.limits?.maxManifestBytes ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxManifestBytes,
  };
  const gitSelectionLimits = resolveNativeGitSelectionLimits(options.gitSelectionLimits);
  const physicalSelectionLimits = resolveNativePhysicalSelectionLimits(
    options.physicalSelectionLimits,
  );
  if (
    limits.maxFiles < 1 ||
    limits.maxFileBytes < 1 ||
    limits.maxTotalBytes < 1 ||
    limits.maxManifestBytes < 1
  ) {
    throw new Error('Native snapshot limits must be positive');
  }

  const projectRoot = path.resolve(paths.projectRoot);
  const physicalProjectRoot = await fs.realpath(projectRoot);
  const nativeRoot = path.resolve(paths.nativeRoot);
  const physicalNativeRoot = await fs.realpath(nativeRoot);
  const configFile = path.resolve(paths.configFile);
  const selectionFile = path.join(projectRoot, '.comet', 'current-change.json');
  const denylist = normalizedDenylist(projectRoot, options.denylist ?? []);
  const entries: NativeContentSnapshotManifest['entries'] = [];
  const omitted: NativeSnapshotOmission[] = [];
  const capturedEntryValidations = new Map<string, NativeCapturedEntryValidation>();
  const capturedTrackedAbsences = new Map<string, string>();
  let omittedCount = 0;
  let overflowCount = 0;
  let overflowHash = sha256Text('comet.native.snapshot-omission-overflow.v1');
  let totalBytes = 0;
  let notifiedFirstEntry = false;
  let physicalSelectionEvidence: NativePhysicalSelectionEvidence | null = null;

  const foldOverflow = (value: NativeSnapshotOmission): void => {
    overflowCount += 1;
    overflowHash = foldSnapshotOverflowHash(overflowHash, 'omission', value);
  };

  const omit = (value: NativeSnapshotOmission): void => {
    omittedCount += 1;
    if (omitted.length < MAX_RECORDED_OMISSIONS) {
      omitted.push(value);
      return;
    }
    if (isSelectionIntegrityOmission(value)) {
      const displaced = takeLastCompactableOmission(omitted);
      if (displaced === null) {
        throw new Error('Native snapshot has too many required selection-integrity omissions');
      }
      foldOverflow(displaced);
      omitted.push(value);
      return;
    }
    foldOverflow(value);
  };

  const foldGitSelectionOverflow = (value: NativeGitSelectionOverflow): void => {
    omittedCount += value.count;
    overflowCount += value.count;
    overflowHash = foldSnapshotOverflowHash(overflowHash, 'git-selection', {
      source: 'git-selection',
      ...value,
    });
  };

  const foldManifestEntryOverflow = (entry: NativeSnapshotEntry): void => {
    overflowCount += 1;
    overflowHash = foldSnapshotOverflowHash(overflowHash, 'manifest-entry', {
      reason: 'manifest-size',
      entry,
    });
  };

  const recordCapturedEntry = async (
    entry: NativeSnapshotEntry,
    validation: NativeCapturedEntryValidation,
  ): Promise<void> => {
    entries.push(entry);
    totalBytes += entry.size;
    capturedEntryValidations.set(entry.path, validation);
    if (!notifiedFirstEntry) {
      notifiedFirstEntry = true;
      await options.gitSelectionHooks?.afterFirstEntryCaptured?.(entry.path);
    }
  };

  const invalidateCapturedEntry = (relative: string, omission: NativeSnapshotOmission): void => {
    const index = entries.findIndex((entry) => entry.path === relative);
    if (index < 0) return;
    const [entry] = entries.splice(index, 1);
    totalBytes -= entry!.size;
    capturedEntryValidations.delete(relative);
    omit(omission);
  };

  const captureFile = async (
    target: string,
    relative: string,
    before: import('fs').Stats,
  ): Promise<void> => {
    if (!before.isFile() || before.isSymbolicLink()) return;
    if (!nativeSnapshotExecutionHasBudget(execution)) return;
    let realTarget;
    try {
      realTarget = await fs.realpath(target);
    } catch (error) {
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
      omit({
        path: relative,
        size: before.size,
        type: 'file',
        reason: isChangedDuringReadError(error) ? 'changed-during-read' : 'unreadable',
      });
      return;
    }
    if (!nativeSnapshotExecutionHasBudget(execution)) return;
    if (
      !isInsidePath(physicalProjectRoot, realTarget) ||
      sameOrInside(physicalNativeRoot, realTarget)
    ) {
      return;
    }
    if (entries.length >= limits.maxFiles) {
      omit({ path: relative, size: before.size, type: 'file', reason: 'file-count' });
      return;
    }
    if (before.size > limits.maxFileBytes) {
      omit({ path: relative, size: before.size, type: 'file', reason: 'file-size' });
      return;
    }
    if (totalBytes + before.size > limits.maxTotalBytes) {
      omit({ path: relative, size: before.size, type: 'file', reason: 'total-size' });
      return;
    }
    let boundedHash;
    let after;
    let afterRealTarget;
    try {
      boundedHash = await sha256FileBounded(realTarget, before.size, before, execution);
      if (
        boundedHash.status === 'budget-exhausted' ||
        !nativeSnapshotExecutionHasBudget(execution)
      ) {
        return;
      }
      if (boundedHash.status === 'changed') {
        omit({ path: relative, size: null, type: 'file', reason: 'changed-during-read' });
        return;
      }
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      afterRealTarget = await fs.realpath(target);
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      after = await fs.lstat(target);
    } catch (error) {
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
      omit({
        path: relative,
        size: before.size,
        type: 'file',
        reason: isChangedDuringReadError(error) ? 'changed-during-read' : 'unreadable',
      });
      return;
    }
    if (!nativeSnapshotExecutionHasBudget(execution)) return;
    if (
      boundedHash.bytes !== before.size ||
      afterRealTarget !== realTarget ||
      !sameFileIdentity(before, boundedHash.finalStat) ||
      !sameFileIdentity(boundedHash.finalStat, after) ||
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      omit({
        path: relative,
        size: after.isFile() ? after.size : null,
        type: after.isFile() ? 'file' : 'other',
        reason: 'changed-during-read',
      });
      return;
    }
    if (!nativeSnapshotExecutionHasBudget(execution)) return;
    await recordCapturedEntry(
      { path: relative, hash: boundedHash.hash, size: after.size, type: 'file' },
      { kind: 'file', target, realTarget, stat: after },
    );
  };

  const captureSymbolicLink = async (
    target: string,
    relative: string,
    before: import('fs').Stats,
  ): Promise<void> => {
    if (!nativeSnapshotExecutionHasBudget(execution)) return;
    let firstTarget: Buffer;
    let secondTarget: Buffer;
    let after: import('fs').Stats;
    try {
      firstTarget = await fs.readlink(target, { encoding: 'buffer' });
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      after = await fs.lstat(target);
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      secondTarget = await fs.readlink(target, { encoding: 'buffer' });
    } catch (error) {
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
      omit({
        path: relative,
        size: null,
        type: 'other',
        reason: isChangedDuringReadError(error) ? 'changed-during-read' : 'unreadable',
      });
      return;
    }
    if (!nativeSnapshotExecutionHasBudget(execution)) return;
    if (
      !after.isSymbolicLink() ||
      !sameFileIdentity(before, after) ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      !firstTarget.equals(secondTarget)
    ) {
      omit({ path: relative, size: null, type: 'other', reason: 'changed-during-read' });
      return;
    }
    const size = firstTarget.byteLength;
    if (entries.length >= limits.maxFiles) {
      omit({ path: relative, size, type: 'other', reason: 'file-count' });
      return;
    }
    if (size > limits.maxFileBytes) {
      omit({ path: relative, size, type: 'other', reason: 'file-size' });
      return;
    }
    if (totalBytes + size > limits.maxTotalBytes) {
      omit({ path: relative, size, type: 'other', reason: 'total-size' });
      return;
    }
    const hash = createHash('sha256').update('symlink\0').update(firstTarget).digest('hex');
    if (!nativeSnapshotExecutionHasBudget(execution)) return;
    await recordCapturedEntry(
      { path: relative, hash, size, type: 'file' },
      { kind: 'symlink', target, rawTarget: firstTarget, stat: after },
    );
  };

  const revalidateCapturedEntries = async (): Promise<void> => {
    for (const [relative, validation] of [...capturedEntryValidations]) {
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      if (validation.kind === 'file') {
        let realTarget: string;
        let stat: import('fs').Stats;
        try {
          realTarget = await fs.realpath(validation.target);
          if (!nativeSnapshotExecutionHasBudget(execution)) return;
          stat = await fs.lstat(validation.target);
        } catch (error) {
          if (!nativeSnapshotExecutionHasBudget(execution)) return;
          if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
          invalidateCapturedEntry(relative, {
            path: relative,
            size: null,
            type: 'file',
            reason: isUnreadableError(error) ? 'unreadable' : 'changed-during-read',
          });
          continue;
        }
        if (!nativeSnapshotExecutionHasBudget(execution)) return;
        if (
          realTarget !== validation.realTarget ||
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          !sameFileIdentity(validation.stat, stat) ||
          stat.size !== validation.stat.size ||
          stat.mtimeMs !== validation.stat.mtimeMs ||
          stat.ctimeMs !== validation.stat.ctimeMs
        ) {
          invalidateCapturedEntry(relative, {
            path: relative,
            size: stat.isFile() ? stat.size : null,
            type: stat.isFile() ? 'file' : 'other',
            reason: 'changed-during-read',
          });
        }
        continue;
      }

      if (validation.kind === 'symlink') {
        let stat: import('fs').Stats;
        let rawTarget: Buffer;
        try {
          stat = await fs.lstat(validation.target);
          if (!nativeSnapshotExecutionHasBudget(execution)) return;
          rawTarget = await fs.readlink(validation.target, { encoding: 'buffer' });
        } catch (error) {
          if (!nativeSnapshotExecutionHasBudget(execution)) return;
          if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
          invalidateCapturedEntry(relative, {
            path: relative,
            size: null,
            type: 'other',
            reason: isUnreadableError(error) ? 'unreadable' : 'changed-during-read',
          });
          continue;
        }
        if (!nativeSnapshotExecutionHasBudget(execution)) return;
        if (
          !stat.isSymbolicLink() ||
          !sameFileIdentity(validation.stat, stat) ||
          stat.mtimeMs !== validation.stat.mtimeMs ||
          stat.ctimeMs !== validation.stat.ctimeMs ||
          !validation.rawTarget.equals(rawTarget)
        ) {
          invalidateCapturedEntry(relative, {
            path: relative,
            size: null,
            type: 'other',
            reason: 'changed-during-read',
          });
        }
        continue;
      }

      let realTarget: string;
      let stat: import('fs').Stats;
      try {
        realTarget = await fs.realpath(validation.target);
        if (!nativeSnapshotExecutionHasBudget(execution)) return;
        stat = await fs.lstat(validation.target);
      } catch {
        if (!nativeSnapshotExecutionHasBudget(execution)) return;
        invalidateCapturedEntry(relative, {
          path: relative,
          size: null,
          type: 'directory',
          reason: 'gitlink-unavailable',
        });
        continue;
      }
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      const validBoundary =
        realTarget === validation.realTarget &&
        stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        sameFileIdentity(validation.stat, stat) &&
        isInsidePath(physicalProjectRoot, realTarget) &&
        !sameOrInside(physicalNativeRoot, realTarget);
      if (!validBoundary) {
        invalidateCapturedEntry(relative, {
          path: relative,
          size: null,
          type: 'directory',
          reason: 'gitlink-changed',
        });
        continue;
      }
      let workingTree: Awaited<ReturnType<typeof inspectGitlinkWorkingTree>>;
      try {
        if (!nativeSnapshotExecutionHasBudget(execution)) return;
        workingTree = await inspectGitlinkWorkingTree(execution, realTarget);
      } catch (error) {
        if (isNativeGitSnapshotTimeout(error)) throw error;
        invalidateCapturedEntry(relative, {
          path: relative,
          size: null,
          type: 'directory',
          reason: 'gitlink-unavailable',
        });
        continue;
      }
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      if (workingTree.dirty) {
        invalidateCapturedEntry(relative, {
          path: relative,
          size: null,
          type: 'directory',
          reason: 'gitlink-dirty',
        });
      } else if (workingTree.hash !== validation.hash) {
        invalidateCapturedEntry(relative, {
          path: relative,
          size: null,
          type: 'directory',
          reason: 'gitlink-changed',
        });
      }
    }
    for (const [relative, target] of capturedTrackedAbsences) {
      if (!nativeSnapshotExecutionHasBudget(execution)) return;
      try {
        const stat = await fs.lstat(target);
        if (!nativeSnapshotExecutionHasBudget(execution)) return;
        omit({
          path: relative,
          size: stat.isFile() ? stat.size : null,
          type: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other',
          reason: 'changed-during-read',
        });
      } catch (error) {
        if (!nativeSnapshotExecutionHasBudget(execution)) return;
        if (isChangedDuringReadError(error)) continue;
        if (!isUnreadableError(error)) throw error;
        omit({ path: relative, size: null, type: 'file', reason: 'unreadable' });
      }
    }
  };

  const gitSelection = await nativeGitSnapshotSelection(
    execution,
    projectRoot,
    gitSelectionLimits,
    options.gitSelectionHooks,
  );
  if (gitSelection === null) {
    const before = await nativePhysicalSnapshotSelection({
      execution,
      paths,
      physicalProjectRoot,
      physicalNativeRoot,
      denylist,
      limits: physicalSelectionLimits,
      hooks: options.physicalSelectionHooks,
    });
    await options.physicalSelectionHooks?.afterInitialSelection?.();
    for (const record of before.records) {
      if (record.type !== 'file' && record.type !== 'symlink') continue;
      if (remainingNativeSnapshotTime(execution) < 1) break;
      const target = path.resolve(projectRoot, ...record.path.split('/'));
      let stat: import('fs').Stats;
      try {
        stat = await fs.lstat(target);
      } catch (error) {
        if (!nativeSnapshotExecutionHasBudget(execution)) break;
        if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
        omit({
          path: record.path,
          size: null,
          type: 'file',
          reason: isChangedDuringReadError(error) ? 'changed-during-read' : 'unreadable',
        });
        continue;
      }
      if (remainingNativeSnapshotTime(execution) < 1) break;
      if (record.type === 'symlink' && stat.isSymbolicLink()) {
        await captureSymbolicLink(target, record.path, stat);
        if (remainingNativeSnapshotTime(execution) < 1) break;
        continue;
      }
      if (record.type !== 'file' || !stat.isFile() || stat.isSymbolicLink()) {
        omit({
          path: record.path,
          size: stat.isFile() ? stat.size : null,
          type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
          reason: 'changed-during-read',
        });
        continue;
      }
      await captureFile(target, record.path, stat);
      if (remainingNativeSnapshotTime(execution) < 1) break;
    }
    if (remainingNativeSnapshotTime(execution) >= 1) await revalidateCapturedEntries();
    const after = await nativePhysicalSnapshotSelection({
      execution,
      paths,
      physicalProjectRoot,
      physicalNativeRoot,
      denylist,
      limits: physicalSelectionLimits,
    });
    const finalized = finalizeNativePhysicalSelection(before.evidence, after.evidence);
    physicalSelectionEvidence = finalized.evidence;
    for (const omission of [...before.omissions, ...after.omissions, ...finalized.omissions]) {
      if (
        omitted.some(
          (current) => current.path === omission.path && current.reason === omission.reason,
        )
      ) {
        continue;
      }
      omit(omission);
    }
  } else {
    await options.gitSelectionHooks?.afterInitialSelection?.();
    for (const relative of selectionPaths(gitSelection)) {
      if (!isSnapshotProjectRef(paths, relative)) continue;
      const target = path.resolve(projectRoot, ...relative.split('/'));
      if (
        target === configFile ||
        target === selectionFile ||
        denylist.some((denied) => sameOrInside(denied, target))
      ) {
        continue;
      }
      if (gitSelection.gitlinks.has(relative)) {
        if (entries.length >= limits.maxFiles) {
          omit({ path: relative, size: 0, type: 'file', reason: 'file-count' });
          continue;
        }
        let realGitlink: string;
        let gitlinkStat: import('fs').Stats;
        try {
          [realGitlink, gitlinkStat] = await Promise.all([fs.realpath(target), fs.lstat(target)]);
        } catch {
          omit({
            path: relative,
            size: null,
            type: 'directory',
            reason: 'gitlink-unavailable',
          });
          continue;
        }
        if (
          gitlinkStat.isSymbolicLink() ||
          !gitlinkStat.isDirectory() ||
          !isInsidePath(physicalProjectRoot, realGitlink) ||
          sameOrInside(physicalNativeRoot, realGitlink)
        ) {
          omit({
            path: relative,
            size: null,
            type: 'directory',
            reason: 'gitlink-unavailable',
          });
          continue;
        }
        try {
          const workingTree = await inspectGitlinkWorkingTree(execution, realGitlink);
          if (workingTree.dirty) {
            omit({
              path: relative,
              size: null,
              type: 'directory',
              reason: 'gitlink-dirty',
            });
            continue;
          }
          await recordCapturedEntry(
            {
              path: relative,
              hash: workingTree.hash,
              size: 0,
              type: 'file',
            },
            {
              kind: 'gitlink',
              target,
              realTarget: realGitlink,
              stat: gitlinkStat,
              hash: workingTree.hash,
            },
          );
        } catch (error) {
          if (isNativeGitSnapshotTimeout(error)) throw error;
          // The index knows this is a gitlink, but an uninitialized, unreadable, or
          // concurrently changing checkout has no trustworthy working-tree pointer.
          omit({
            path: relative,
            size: null,
            type: 'directory',
            reason: 'gitlink-unavailable',
          });
        }
        continue;
      }
      let before;
      try {
        before = await fs.lstat(target);
      } catch (error) {
        if (isChangedDuringReadError(error) && gitSelection.tracked.has(relative)) {
          capturedTrackedAbsences.set(relative, target);
          continue;
        }
        if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
        omit({
          path: relative,
          size: null,
          type: 'file',
          reason: isChangedDuringReadError(error) ? 'changed-during-read' : 'unreadable',
        });
        continue;
      }
      if (before.isSymbolicLink()) {
        await captureSymbolicLink(target, relative, before);
        continue;
      }
      if (!before.isFile()) {
        if (!gitSelection.nestedRepositories.has(relative)) {
          omit({ path: relative, size: null, type: 'other', reason: 'changed-during-read' });
        }
        continue;
      }
      await captureFile(target, relative, before);
    }
    await revalidateCapturedEntries();
    await finalizeNativeGitSnapshotSelection(
      execution,
      projectRoot,
      gitSelectionLimits,
      gitSelection,
      options.gitSelectionHooks?.outputChunkBytes,
    );
    for (const omission of gitSelection.omissions) omit(omission);
    if (gitSelection.overflow) foldGitSelectionOverflow(gitSelection.overflow);
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  omitted.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const capture: NonNullable<NativeContentSnapshotManifest['capture']> =
    gitSelection === null
      ? {
          provider: 'physical-tree',
          ...(physicalSelectionEvidence ? { physicalSelection: physicalSelectionEvidence } : {}),
        }
      : {
          provider: 'git',
          ...(gitSelection.evidence ? { gitSelection: gitSelection.evidence } : {}),
        };
  const buildManifest = (): NativeContentSnapshotManifest => ({
    schema: 'comet.native.content-snapshot.v1',
    origin: options.origin ?? 'explicit',
    capture,
    createdAt: (options.now ?? new Date()).toISOString(),
    complete: omittedCount === 0,
    limits,
    entries,
    omitted,
    omittedCount,
    ...(overflowCount > 0
      ? {
          omissionOverflow: {
            ref: `native-snapshot://omitted-overflow/${overflowHash}`,
            hash: overflowHash,
            count: overflowCount,
          },
        }
      : {}),
  });

  let manifest = buildManifest();
  while (serializedManifestBytes(manifest) > limits.maxManifestBytes) {
    const compactableOmissionCount = omitted.filter(
      (omission) => !isSelectionIntegrityOmission(omission),
    ).length;
    if (compactableOmissionCount > 0) {
      const removeCount = Math.max(1, Math.ceil(omitted.length / 4));
      for (let removed = 0; removed < removeCount; removed += 1) {
        const omission = takeLastCompactableOmission(omitted);
        if (omission === null) break;
        foldOverflow(omission);
      }
    } else if (entries.length > 0) {
      const removeCount = Math.max(1, Math.ceil(entries.length / 4));
      for (const entry of entries.splice(-removeCount)) {
        omittedCount += 1;
        foldManifestEntryOverflow(entry);
      }
    } else {
      throw new Error('Native snapshot manifest byte limit is too small for its metadata');
    }
    manifest = buildManifest();
  }
  return manifest;
}

export async function writeNativeBaselineManifest(
  paths: NativeProjectPaths,
  name: string,
  manifest: NativeContentSnapshotManifest,
): Promise<void> {
  const file = nativeBaselineManifestFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  await atomicWriteJson(file, parseNativeContentSnapshotManifest(manifest));
}

export async function readNativeBaselineManifest(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeContentSnapshotManifest | null> {
  const file = nativeBaselineManifestFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    const source = await readNativeProtectedTextFile({
      root: paths.nativeRoot,
      file,
      maxBytes: NATIVE_SNAPSHOT_MANIFEST_HARD_MAX_BYTES,
      label: 'Native baseline snapshot manifest',
    });
    return parseNativeContentSnapshotManifest(JSON.parse(source.text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
