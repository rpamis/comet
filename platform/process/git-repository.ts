import { execFile } from 'node:child_process';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

type GitInspectionOperation = 'discovery' | 'status';

type GitInspectionFailureKind =
  | 'not-repository'
  | 'git-unavailable'
  | 'timeout'
  | 'output-limit'
  | 'command-failed'
  | 'invalid-output';

interface GitInspectionFailure {
  kind: GitInspectionFailureKind;
  operation: GitInspectionOperation;
}

interface AvailableGitRepositoryInspection {
  available: true;
  head: string | null;
  branch: string | null;
  worktreeRoot: string;
  commonDir: string;
  changedPaths: string[];
  failure: null;
}

interface UnavailableGitRepositoryInspection {
  available: false;
  head: null;
  branch: null;
  worktreeRoot: null;
  commonDir: null;
  changedPaths: null;
  failure: GitInspectionFailure;
}

/**
 * A read-only snapshot of Git runtime facts.
 *
 * `available: false` deliberately nulls every fact. In particular,
 * `changedPaths: null` means unknown and must not be interpreted as a clean worktree.
 */
type GitRepositoryInspection =
  | AvailableGitRepositoryInspection
  | UnavailableGitRepositoryInspection;

/** Process safety limits for each Git command used by the inspection. */
interface InspectGitRepositoryOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

interface GitCommandSuccess {
  ok: true;
  stdout: string;
}

interface GitCommandFailure {
  ok: false;
  kind: Exclude<GitInspectionFailureKind, 'not-repository' | 'invalid-output'>;
  stderr: string;
}

type GitCommandResult = GitCommandSuccess | GitCommandFailure;

interface ParsedStatus {
  head: string | null;
  branch: string | null;
  changedPaths: string[];
}

type ProjectRelativePath =
  | { kind: 'inside'; path: string }
  | { kind: 'outside' }
  | { kind: 'invalid' };

type ProcessError = Error & {
  code?: number | string;
  killed?: boolean;
};

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function streamText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

function classifyProcessError(error: ProcessError): GitCommandFailure['kind'] {
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || error.code === 'ENOBUFS') {
    return 'output-limit';
  }
  if (error.code === 'ETIMEDOUT' || error.killed) return 'timeout';
  if (error.code === 'ENOENT') return 'git-unavailable';
  return 'command-failed';
}

function runGit(
  projectPath: string,
  args: string[],
  options: Required<InspectGitRepositoryOptions>,
): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const argv = ['-C', projectPath, ...args];
    const executionOptions = {
      encoding: 'utf8' as const,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
      },
      maxBuffer: options.maxOutputBytes,
      shell: false as const,
      timeout: options.timeoutMs,
      windowsHide: true,
    };

    try {
      execFile('git', argv, executionOptions, (error, stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            kind: classifyProcessError(error as ProcessError),
            stderr: streamText(stderr),
          });
          return;
        }
        resolve({ ok: true, stdout: streamText(stdout) });
      });
    } catch (error) {
      resolve({
        ok: false,
        kind: classifyProcessError(error as ProcessError),
        stderr: '',
      });
    }
  });
}

function unavailable(
  kind: GitInspectionFailureKind,
  operation: GitInspectionOperation,
): UnavailableGitRepositoryInspection {
  return {
    available: false,
    head: null,
    branch: null,
    worktreeRoot: null,
    commonDir: null,
    changedPaths: null,
    failure: { kind, operation },
  };
}

function isNotRepositoryError(stderr: string): boolean {
  return /not a git repository|not a git work tree|must be run in a work tree/iu.test(stderr);
}

function normalizeRuntimePath(rawPath: string, projectPath: string): string | null {
  if (!rawPath) return null;
  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(projectPath, rawPath);
  return path.normalize(absolutePath);
}

function normalizeGitPath(rawPath: string): string | null {
  if (!rawPath || rawPath.includes('\0')) return null;
  const portablePath = path.sep === '\\' ? rawPath.replace(/\\/g, '/') : rawPath;
  if (path.posix.isAbsolute(portablePath)) return null;
  const normalizedPath = path.posix.normalize(portablePath);
  if (normalizedPath === '..' || normalizedPath.startsWith('../')) return null;
  return normalizedPath;
}

function normalizeProjectPrefix(rawPrefix: string): string | null {
  if (!rawPrefix) return '';
  const normalizedPrefix = normalizeGitPath(rawPrefix.replace(/\/$/u, ''));
  return normalizedPrefix;
}

function toProjectRelativePath(
  repositoryRelativePath: string,
  projectPrefix: string,
): ProjectRelativePath {
  const normalizedPath = normalizeGitPath(repositoryRelativePath);
  if (!normalizedPath) return { kind: 'invalid' };
  if (!projectPrefix) return { kind: 'inside', path: normalizedPath };

  const relativePath = path.posix.relative(projectPrefix, normalizedPath);
  if (!relativePath) return { kind: 'invalid' };
  if (relativePath === '..' || relativePath.startsWith('../')) return { kind: 'outside' };
  return { kind: 'inside', path: relativePath };
}

function fieldAfterSpaces(record: string, numberOfSpaces: number): string | null {
  let cursor = 0;
  for (let index = 0; index < numberOfSpaces; index += 1) {
    cursor = record.indexOf(' ', cursor);
    if (cursor < 0) return null;
    cursor += 1;
  }
  return record.slice(cursor);
}

function parseStatus(output: string, projectPrefix: string): ParsedStatus | null {
  const records = output.split('\0');
  const changedPaths = new Set<string>();
  let head: string | null = null;
  let branch: string | null = null;
  let observedHead = false;
  let observedBranch = false;

  const addPath = (rawPath: string): boolean => {
    const result = toProjectRelativePath(rawPath, projectPrefix);
    if (result.kind === 'invalid') return false;
    if (result.kind === 'inside') changedPaths.add(result.path);
    return true;
  };

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    if (record.startsWith('# branch.oid ')) {
      const value = record.slice('# branch.oid '.length);
      observedHead = true;
      head = value === '(initial)' ? null : value || null;
      continue;
    }
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length);
      observedBranch = true;
      branch = value === '(detached)' ? null : value || null;
      continue;
    }
    if (record.startsWith('# ')) continue;

    if (record.startsWith('? ')) {
      if (!addPath(record.slice(2))) return null;
      continue;
    }
    if (record.startsWith('! ')) continue;

    const ordinaryPath = record.startsWith('1 ') ? fieldAfterSpaces(record, 8) : null;
    if (ordinaryPath !== null) {
      if (!addPath(ordinaryPath)) return null;
      continue;
    }

    const renamedPath = record.startsWith('2 ') ? fieldAfterSpaces(record, 9) : null;
    if (renamedPath !== null) {
      const originalPath = records[index + 1];
      if (!originalPath || !addPath(renamedPath) || !addPath(originalPath)) return null;
      index += 1;
      continue;
    }

    const unmergedPath = record.startsWith('u ') ? fieldAfterSpaces(record, 10) : null;
    if (unmergedPath !== null) {
      if (!addPath(unmergedPath)) return null;
      continue;
    }

    return null;
  }

  if (!observedHead || !observedBranch) return null;
  return { head, branch, changedPaths: [...changedPaths].sort() };
}

/**
 * Inspect a worktree without invoking a shell or mutating repository state.
 * Changed paths use `/`, are scoped and relative to `projectPath`, and include
 * every in-project side of rename/copy records.
 */
async function inspectGitRepository(
  projectPath: string,
  options: InspectGitRepositoryOptions = {},
): Promise<GitRepositoryInspection> {
  const resolvedProjectPath = path.resolve(projectPath);
  const commandOptions: Required<InspectGitRepositoryOptions> = {
    timeoutMs: positiveLimit(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxOutputBytes: positiveLimit(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
  };

  const discovery = await runGit(
    resolvedProjectPath,
    [
      'rev-parse',
      '--is-inside-work-tree',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
      '--show-prefix',
    ],
    commandOptions,
  );

  if (!discovery.ok) {
    const kind =
      discovery.kind === 'command-failed' && isNotRepositoryError(discovery.stderr)
        ? 'not-repository'
        : discovery.kind;
    return unavailable(kind, 'discovery');
  }

  const discoveryLines = discovery.stdout.split(/\r?\n/u);
  if (discoveryLines[0] !== 'true') return unavailable('not-repository', 'discovery');

  const worktreeRoot = normalizeRuntimePath(discoveryLines[1] ?? '', resolvedProjectPath);
  const commonDir = normalizeRuntimePath(discoveryLines[2] ?? '', resolvedProjectPath);
  const projectPrefix = normalizeProjectPrefix(discoveryLines[3] ?? '');
  if (!worktreeRoot || !commonDir || projectPrefix === null) {
    return unavailable('invalid-output', 'discovery');
  }

  const status = await runGit(
    resolvedProjectPath,
    ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'],
    commandOptions,
  );
  if (!status.ok) return unavailable(status.kind, 'status');

  const parsedStatus = parseStatus(status.stdout, projectPrefix);
  if (!parsedStatus) return unavailable('invalid-output', 'status');

  return {
    available: true,
    head: parsedStatus.head,
    branch: parsedStatus.branch,
    worktreeRoot,
    commonDir,
    changedPaths: parsedStatus.changedPaths,
    failure: null,
  };
}

export { inspectGitRepository };
export type {
  AvailableGitRepositoryInspection,
  GitInspectionFailure,
  GitInspectionFailureKind,
  GitInspectionOperation,
  GitRepositoryInspection,
  InspectGitRepositoryOptions,
  UnavailableGitRepositoryInspection,
};
