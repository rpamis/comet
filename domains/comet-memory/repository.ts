import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';

import { withRecoverableFileLock } from '../../platform/fs/plugin-store.js';

import type {
  FileMemoryRepositoryOptions,
  MemoryGitSync,
  GitMemorySyncOptions,
  MemoryProjectFileBinding,
  MemoryRepository,
  MemoryRuntimeState,
  MemorySyncResult,
} from './types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_RETRY_MS = 20;

export function memoryFilePath(scope: 'global' | 'project', projectKey?: string): string {
  if (scope === 'global') return 'profile.md';
  if (projectKey === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(projectKey)) {
    throw new Error('Project memory requires a safe project key');
  }
  return `projects/${projectKey}.md`;
}

export function projectMemoryFilePath(projectName: string): string {
  const normalized = projectName.trim().replace(/[^A-Za-z0-9._-]+/gu, '-');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalized)) {
    throw new Error('Project memory name is invalid');
  }
  return `projects/${normalized}.md`;
}

export function hashMemoryText(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Derive one stable, safe project key from a canonical repository identity. */
export function deriveProjectKey(identity: string): string {
  const canonical = identity
    .trim()
    .replace(/\\/gu, '/')
    .replace(/\.git$/iu, '')
    .replace(/\/+$/u, '')
    .toLocaleLowerCase();
  if (canonical.length === 0) throw new Error('Project identity must not be empty');
  const leaf = canonical.split(/[/:]/u).filter(Boolean).at(-1) ?? 'project';
  const slug = leaf.replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'project';
  return `${slug.slice(0, 40)}-${hashMemoryText(canonical).slice(0, 8)}`;
}

export function emptyMemoryState(): MemoryRuntimeState {
  return {
    version: 3,
    records: [],
    history: {},
    evidence: {},
    observations: [],
    conflicts: [],
    tombstones: [],
    settings: {
      learningEnabled: true,
      retrievalEnabled: true,
      pausedProjects: [],
      pausedLearningProjects: [],
      pausedRetrievalProjects: [],
    },
    files: {},
    projectFiles: {},
    appliedMutationIds: [],
    applicationOutcomes: {},
    feedbackState: {},
    pendingFileProjections: {},
  };
}

export class FileMemoryRepository implements MemoryRepository {
  private readonly root: string;
  private readonly git?: MemoryGitSync;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly projectKey?: string;
  private readonly projectName?: string;

  public constructor(root: string, options: FileMemoryRepositoryOptions = {}) {
    this.root = path.resolve(root);
    this.git = options.git;
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.lockRetryMs = options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS;
    this.projectKey = options.projectKey;
    this.projectName = options.projectName;
  }

  public projectFileBinding(): MemoryProjectFileBinding | undefined {
    if (this.projectKey === undefined || this.projectName === undefined) return undefined;
    return {
      projectKey: this.projectKey,
      projectName: this.projectName,
      path: projectMemoryFilePath(this.projectName),
    };
  }

  public async readText(relativePath: string): Promise<string | null> {
    const target = this.resolve(relativePath);
    try {
      return await fs.readFile(target, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  public async writeText(relativePath: string, content: string): Promise<void> {
    const target = this.resolve(relativePath);
    const directory = path.dirname(target);
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
    const handle = await fs.open(
      temporary,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    );
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, target);
  }

  public async readState(): Promise<MemoryRuntimeState> {
    const content = await this.readText('.comet/runtime/memory-state.json');
    if (content === null || content.trim().length === 0) return emptyMemoryState();
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (error) {
      throw new Error(`Memory runtime state is invalid JSON: ${(error as Error).message}`, {
        cause: error,
      });
    }
    return validateState(parsed);
  }

  public async writeState(state: MemoryRuntimeState): Promise<void> {
    await this.writeText('.comet/runtime/memory-state.json', `${JSON.stringify(state, null, 2)}\n`);
  }

  public async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const runtimeDirectory = path.join(this.root, '.comet', 'runtime');
    await fs.mkdir(runtimeDirectory, { recursive: true });
    const lock = path.join(runtimeDirectory, '.memory.lock');
    return withRecoverableFileLock(lock, operation, {
      timeoutMs: this.lockTimeoutMs,
      retryMs: this.lockRetryMs,
    });
  }

  public async sync(): Promise<MemorySyncResult> {
    if (this.git === undefined) {
      return {
        status: 'local-only',
        retryable: false,
        message: 'No memory Git remote is configured',
      };
    }
    return this.withLock(() => this.git!.sync());
  }

  public async remote(): Promise<string | null> {
    return this.git?.remote ? this.git.remote() : null;
  }

  public async configureRemote(url: string): Promise<void> {
    if (!this.git?.configureRemote) throw new Error('Memory Git sync is unavailable');
    await this.withLock(() => this.git!.configureRemote!(url));
  }

  private resolve(relativePath: string): string {
    const normalized = relativePath.replaceAll('\\', '/');
    if (
      normalized.length === 0 ||
      path.posix.isAbsolute(normalized) ||
      normalized.split('/').some((segment) => segment === '..' || segment.length === 0)
    ) {
      throw new Error(`Memory path must stay inside the repository: ${relativePath}`);
    }
    const target = path.resolve(this.root, ...normalized.split('/'));
    const relative = path.relative(this.root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Memory path must stay inside the repository: ${relativePath}`);
    }
    return target;
  }
}

/** Git adapter for the dedicated memory repository; it never receives a project-repository path. */
export class GitMemorySync implements MemoryGitSync {
  private readonly root: string;
  private readonly remoteName: string;
  private readonly commitMessage: string;
  private readonly runCommand: (args: readonly string[]) => Promise<{
    readonly stdout: string;
    readonly stderr: string;
  }>;

  public constructor(root: string, options: GitMemorySyncOptions = {}) {
    this.root = path.resolve(root);
    this.remoteName = options.remoteName ?? 'origin';
    this.commitMessage = options.commitMessage ?? 'chore(memory): sync personal memory';
    this.runCommand =
      options.run ??
      (async (args) => {
        const result = await execFileAsync('git', [...args], {
          cwd: this.root,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        });
        return { stdout: result.stdout, stderr: result.stderr };
      });
  }

  public async sync(): Promise<MemorySyncResult> {
    await fs.mkdir(this.root, { recursive: true });
    try {
      await this.runCommand(['rev-parse', '--git-dir']);
    } catch {
      try {
        await this.runCommand(['init']);
      } catch (error) {
        return failedSync(error, true);
      }
    }

    try {
      await this.runCommand(['remote', 'get-url', this.remoteName]);
    } catch {
      return {
        status: 'local-only',
        retryable: false,
        message: 'No memory Git remote is configured',
      };
    }

    try {
      const paths: string[] = [];
      for (const candidate of ['profile.md', '.comet/runtime/memory-state.json']) {
        try {
          await fs.access(path.join(this.root, candidate));
          paths.push(candidate);
        } catch {
          // A scope is optional until its first memory exists.
        }
      }
      try {
        await fs.access(path.join(this.root, 'projects'));
        paths.push('projects');
      } catch {
        // The project memory directory is optional until the first project memory exists.
      }
      if (paths.length === 0) {
        return { status: 'local-only', retryable: false, message: 'No memory files exist yet' };
      }
      await this.runCommand(['add', '--', ...paths]);
      const status = await this.runCommand(['status', '--porcelain', '--', ...paths]);
      if (status.stdout.trim().length > 0)
        await this.runCommand(['commit', '-m', this.commitMessage]);
      await this.runCommand(['pull', '--rebase', '--autostash', this.remoteName]);
      await this.runCommand(['push', this.remoteName]);
      return {
        status: 'synced',
        retryable: false,
        ...(status.stdout.trim().length === 0
          ? { message: 'Memory repository is up to date' }
          : {}),
      };
    } catch (error) {
      return failedSync(error, /conflict|merge|rebase/iu.test(errorMessage(error)));
    }
  }

  public async remote(): Promise<string | null> {
    await fs.mkdir(this.root, { recursive: true });
    try {
      await this.runCommand(['rev-parse', '--git-dir']);
      const result = await this.runCommand(['remote', 'get-url', this.remoteName]);
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  public async configureRemote(url: string): Promise<void> {
    const normalized = url.trim();
    if (!normalized) throw new Error('Memory Git remote must not be empty');
    await fs.mkdir(this.root, { recursive: true });
    try {
      await this.runCommand(['rev-parse', '--git-dir']);
    } catch {
      await this.runCommand(['init']);
    }
    try {
      await this.runCommand(['remote', 'get-url', this.remoteName]);
      await this.runCommand(['remote', 'set-url', this.remoteName, normalized]);
    } catch {
      await this.runCommand(['remote', 'add', this.remoteName, normalized]);
    }
  }
}

function failedSync(error: unknown, conflict: boolean): MemorySyncResult {
  return {
    status: conflict ? 'conflict' : 'failed',
    retryable: true,
    message: errorMessage(error),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function validateState(value: unknown): MemoryRuntimeState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Memory runtime state must be an object');
  }
  const candidate = value as Partial<MemoryRuntimeState> & { version?: unknown };
  if (candidate.version !== 3) return emptyMemoryState();
  if (!Array.isArray(candidate.records)) {
    throw new Error('Memory runtime state version or records are invalid');
  }
  return {
    version: 3,
    records: candidate.records,
    history: candidate.history ?? {},
    evidence: candidate.evidence ?? {},
    observations: candidate.observations ?? [],
    conflicts: candidate.conflicts ?? [],
    tombstones: candidate.tombstones ?? [],
    settings: {
      learningEnabled: candidate.settings?.learningEnabled ?? true,
      retrievalEnabled: candidate.settings?.retrievalEnabled ?? true,
      pausedProjects: [...(candidate.settings?.pausedProjects ?? [])],
      pausedLearningProjects: [
        ...(candidate.settings?.pausedLearningProjects ?? candidate.settings?.pausedProjects ?? []),
      ],
      pausedRetrievalProjects: [
        ...(candidate.settings?.pausedRetrievalProjects ??
          candidate.settings?.pausedProjects ??
          []),
      ],
    },
    files: candidate.files ?? {},
    projectFiles: candidate.projectFiles ?? {},
    appliedMutationIds: [...(candidate.appliedMutationIds ?? [])],
    applicationOutcomes: { ...(candidate.applicationOutcomes ?? {}) },
    feedbackState: { ...(candidate.feedbackState ?? {}) },
    pendingFileProjections: { ...(candidate.pendingFileProjections ?? {}) },
  };
}
