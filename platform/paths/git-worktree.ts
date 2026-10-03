import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { measureCometGitCommand } from '../process/runtime-metrics.js';
import { ExternalCommandError, runExternalCommandAsync } from '../process/external-command.js';
import { gitWorktreeMetadataStamp } from './git-worktree-cache.js';
import { resolveWindowsCommand } from '../process/spawn-command.js';

interface GitWorktreeContext {
  isGitWorktree: boolean;
  isSecondaryWorktree: boolean;
  currentWorktreeRoot: string | null;
  primaryWorktreeRoot: string | null;
  currentBranch: string | null;
}

export interface GitWorktreeEntry {
  root: string;
  branch: string | null;
  detached: boolean;
}

const readScope = new AsyncLocalStorage<Map<string, GitWorktreeEntry[]>>();
const readRoots = new AsyncLocalStorage<Map<string, string>>();

/** Reuse worktree observations only within one read-only query, never across commands. */
export function withGitWorktreeReadScope<T>(operation: () => T): T {
  if (readScope.getStore()) return operation();
  return readScope.run(new Map(), operation);
}

/** daemon 专用；只复用已核对元数据的查询观察，写命令不进入此作用域。 */
export function createGitWorktreeReadCache(): {
  run<T>(projectRoot: string, operation: () => Promise<T>, invocationCwd?: string): Promise<T>;
} {
  const entries = new Map<
    string,
    { stamp: string; observations: Map<string, GitWorktreeEntry[]>; roots: Map<string, string> }
  >();
  let configPaths: Promise<string[] | null> | undefined;
  let environment = '';
  const stamp = async (projectRoot: string, configs: readonly string[]) => {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        gitWorktreeMetadataStamp(projectRoot, configs),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 100);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  };
  return {
    async run(projectRoot, operation, invocationCwd = projectRoot) {
      const gitExecutable =
        process.platform === 'win32'
          ? resolveWindowsCommand('git', process.env, projectRoot)
          : (process.env.PATH ?? '')
              .split(path.delimiter)
              .map((directory) => path.join(directory, 'git'))
              .find((candidate) => fs.existsSync(candidate));
      const gitIdentity = gitExecutable
        ? await fs.promises
            .stat(gitExecutable, { bigint: true })
            .then((stat) => `${stat.dev}:${stat.ino}:${stat.ctimeNs}:${stat.mtimeNs}:${stat.size}`)
            .catch(() => null)
        : null;
      const currentEnvironment =
        JSON.stringify(
          Object.entries(process.env)
            .filter(([key]) => /^(?:GIT_|HOME$|USERPROFILE$|XDG_CONFIG_HOME$|PATH$)/iu.test(key))
            .sort(),
        ) + gitIdentity;
      if (environment !== currentEnvironment) {
        environment = currentEnvironment;
        configPaths = undefined;
        entries.clear();
      }
      const cacheAllowed =
        !Object.keys(process.env).some(
          (key) =>
            /^GIT_/iu.test(key) && !/^GIT_(?:PAGER|TERMINAL_PROMPT|OPTIONAL_LOCKS)$/iu.test(key),
        ) && gitIdentity !== null;
      if (cacheAllowed)
        configPaths ??= Promise.all(
          ['GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL'].map((name) =>
            runExternalCommandAsync('git', ['var', name], {
              cwd: projectRoot,
              timeoutMs: 500,
              maxBufferBytes: 16384,
            }),
          ),
        )
          .then((values) => values.flatMap((value) => value.trim().split(/\r?\n/u).filter(Boolean)))
          .catch(() => null);
      const configs = cacheAllowed ? await configPaths! : null;
      const paths = [...new Set([path.resolve(projectRoot), path.resolve(invocationCwd)])];
      const key = JSON.stringify(paths.map(canonicalPathForComparison));
      const metadata = async () => {
        if (!configs) return null;
        const stamps = await Promise.all(paths.map((target) => stamp(target, configs)));
        return stamps.every((value) => value !== null) ? JSON.stringify(stamps) : null;
      };
      const before = await metadata();
      const existing = entries.get(key);
      const observations =
        before !== null && before === existing?.stamp
          ? new Map(existing.observations)
          : new Map<string, GitWorktreeEntry[]>();
      const roots =
        before !== null && before === existing?.stamp
          ? new Map(existing.roots)
          : new Map<string, string>();
      if (observations.size === 0) entries.delete(key);
      if (observations.size === 0) {
        // 缓存未命中时异步刷新，避免 Git 子进程阻塞 daemon 的其他连接。
        await Promise.all(
          paths.map(async (target) => {
            try {
              const [root, output] = await Promise.all([
                runExternalCommandAsync('git', ['-C', target, 'rev-parse', '--show-toplevel'], {
                  timeoutMs: 1000,
                  maxBufferBytes: 16384,
                }),
                runExternalCommandAsync(
                  'git',
                  ['-C', target, 'worktree', 'list', '--porcelain', '-z'],
                  { timeoutMs: 1000, maxBufferBytes: 262144 },
                ),
              ]);
              const worktrees = parseGitWorktrees(output.trim());
              if (worktrees.some((entry) => samePath(entry.root, root.trim()))) {
                roots.set(
                  canonicalPathForComparison(target),
                  canonicalPathForComparison(root.trim()),
                );
                for (const entry of worktrees)
                  observations.set(canonicalPathForComparison(entry.root), worktrees);
              } else throw new Error('Git worktree root could not be resolved');
            } catch (error) {
              if (
                !(error instanceof ExternalCommandError) ||
                !/not a git repository/iu.test(error.stderr)
              )
                throw error;
              // 与原查询的非 Git 结果一致；不在后台再次同步启动失败的命令。
              observations.set(canonicalPathForComparison(target), []);
            }
          }),
        );
      }
      const result = await readRoots.run(roots, () => readScope.run(observations, operation));
      if (before !== null && observations.size > 0 && before === (await metadata())) {
        if (entries.size >= 8) entries.delete(entries.keys().next().value!);
        entries.set(key, { stamp: before, observations, roots });
      } else entries.delete(key);
      return result;
    },
  };
}

function rememberWorktrees(entries: GitWorktreeEntry[]): GitWorktreeEntry[] {
  const active = readScope.getStore();
  for (const entry of entries) active?.set(canonicalPathForComparison(entry.root), entries);
  return entries;
}

function runGit(projectPath: string, args: string[]): string {
  return measureCometGitCommand(() =>
    execFileSync('git', ['-C', projectPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      windowsHide: true,
    }).trim(),
  );
}

/**
 * Compare two paths by identity on disk. On Windows this resolves 8.3 short
 * names and casing through the filesystem, so the same root observed from
 * different sources (Node's `path.resolve` versus `git worktree list`) still
 * compares equal; on other platforms it compares the resolved paths.
 */
export function samePath(left: string, right: string): boolean {
  return canonicalPathForComparison(left) === canonicalPathForComparison(right);
}

function canonicalPathForComparison(target: string): string {
  const resolved = path.resolve(target);
  try {
    const real = fs.realpathSync.native(resolved);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  } catch {
    // A path that does not exist yet cannot be resolved by the filesystem.
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
}

function inspectGitWorktree(projectPath: string): GitWorktreeContext {
  try {
    const observedRoot = readRoots.getStore()?.get(canonicalPathForComparison(projectPath));
    const observed = readScope
      .getStore()
      ?.get(observedRoot ?? canonicalPathForComparison(projectPath));
    if (observed) {
      const context = gitWorktreeContextFromEntries(observedRoot ?? projectPath, observed);
      if (context) return context;
      if (observed.length === 0)
        return {
          isGitWorktree: false,
          isSecondaryWorktree: false,
          currentWorktreeRoot: null,
          primaryWorktreeRoot: null,
          currentBranch: null,
        };
    }
    const currentWorktreeRoot = path.resolve(runGit(projectPath, ['rev-parse', '--show-toplevel']));
    const entries =
      readScope.getStore()?.get(canonicalPathForComparison(currentWorktreeRoot)) ??
      readGitWorktrees(projectPath);
    const context = gitWorktreeContextFromEntries(currentWorktreeRoot, entries);
    // Use one fresh worktree-list observation for both identity and branch.
    // A missing entry must fail closed rather than borrow another worktree's branch.
    if (!context) throw new Error('Current worktree is missing from Git worktree list');
    return context;
  } catch {
    return {
      isGitWorktree: false,
      isSecondaryWorktree: false,
      currentWorktreeRoot: null,
      primaryWorktreeRoot: null,
      currentBranch: null,
    };
  }
}

function listGitWorktrees(projectPath: string): GitWorktreeEntry[] {
  try {
    const observed = readScope
      .getStore()
      ?.get(
        readRoots.getStore()?.get(canonicalPathForComparison(projectPath)) ??
          canonicalPathForComparison(projectPath),
      );
    if (observed) return observed.map((entry) => ({ ...entry }));
    runGit(projectPath, ['rev-parse', '--is-inside-work-tree']);
    return readGitWorktrees(projectPath);
  } catch {
    return [];
  }
}

function readGitWorktrees(projectPath: string): GitWorktreeEntry[] {
  const entries = parseGitWorktrees(runGit(projectPath, ['worktree', 'list', '--porcelain', '-z']));
  rememberWorktrees(entries);
  return entries.map((entry) => ({ ...entry }));
}

function parseGitWorktrees(output: string): GitWorktreeEntry[] {
  const lines = output.split('\0');
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | null = null;
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = {
        root: path.resolve(line.slice('worktree '.length)),
        branch: null,
        detached: false,
      };
    } else if (current && line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (current && line === 'detached') {
      current.detached = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

function listGitWorktreeRoots(projectPath: string): string[] {
  return listGitWorktrees(projectPath).map((entry) => entry.root);
}

/** A read-only projection of one already observed worktree list. */
function gitWorktreeContextFromEntries(
  projectPath: string,
  entries: readonly GitWorktreeEntry[],
): GitWorktreeContext | null {
  const current = entries.find((entry) =>
    samePath(path.resolve(entry.root), path.resolve(projectPath)),
  );
  if (!current) return null;
  const primaryWorktreeRoot = path.resolve(entries[0].root);
  const currentWorktreeRoot = path.resolve(current.root);
  return {
    isGitWorktree: true,
    isSecondaryWorktree: !samePath(primaryWorktreeRoot, currentWorktreeRoot),
    currentWorktreeRoot,
    primaryWorktreeRoot,
    currentBranch: current.branch,
  };
}

/** Read the branch without paying for an unrelated worktree enumeration. */
function currentGitBranch(projectPath: string): string | null {
  try {
    return runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || null;
  } catch {
    return null;
  }
}

function isLocalGitBranch(projectPath: string, branch: string): boolean {
  try {
    runGit(projectPath, ['check-ref-format', '--branch', branch]);
    runGit(projectPath, ['show-ref', '--verify', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function resolveGitRef(projectPath: string, ref: string): string | null {
  try {
    const objectId = runGit(projectPath, [
      'rev-parse',
      '--verify',
      `${ref}^{commit}`,
    ]).toLowerCase();
    return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(objectId) ? objectId : null;
  } catch {
    return null;
  }
}

export {
  inspectGitWorktree,
  currentGitBranch,
  gitWorktreeContextFromEntries,
  isLocalGitBranch,
  listGitWorktreeRoots,
  listGitWorktrees,
  resolveGitRef,
};
export type { GitWorktreeContext };
