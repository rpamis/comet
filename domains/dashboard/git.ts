import { execFile } from 'child_process';
import { createHash } from 'crypto';
import path from 'path';
import { promisify } from 'util';
import type { DashboardGitPage, GitSnapshot } from './types.js';

const execFileAsync = promisify(execFile);

const PREVIEW_LIMIT = 5;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const RUN_OPTS = { timeout: 10_000, maxBuffer: 1024 * 1024 };

export class DashboardGitQueryError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'DashboardGitQueryError';
  }
}

interface GitPageQuery {
  limit?: number;
  cursor?: string;
}

interface GitPageCursor {
  version: 1;
  kind: 'commits' | 'files';
  project: string;
  anchor: string;
  offset: number;
}

/**
 * Collect a lightweight Git snapshot for the dashboard. Best-effort: anything
 * that cannot be resolved (non-repo, missing HEAD, detached state) yields
 * empty/null fields rather than throwing.
 */
export async function collectGitSnapshot(projectPath: string): Promise<GitSnapshot> {
  const isRepo = await runGit(projectPath, ['rev-parse', '--is-inside-work-tree']);
  if (isRepo.trim() !== 'true') {
    return emptySnapshot();
  }

  const [branch, head, statusOut, log] = await Promise.all([
    runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(emptyToNull),
    runGit(projectPath, ['log', '-1', '--pretty=format:%h %s']).then(emptyToNull),
    // NUL-terminated porcelain keeps paths verbatim: git never quotes or
    // octal-escapes them, so non-ASCII filenames stay readable regardless of
    // the user's core.quotePath setting.
    runGit(projectPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    runGit(projectPath, [
      'log',
      '--no-show-signature',
      '-n',
      String(PREVIEW_LIMIT + 1),
      '--pretty=format:%h %s',
    ]),
  ]);

  const dirtyEntries = parsePorcelainRecords(statusOut);
  const recentCommits = parseCommitLines(log);

  return {
    branch,
    head,
    dirtyFiles: dirtyEntries.length,
    dirtyFileList: dirtyEntries.slice(0, PREVIEW_LIMIT),
    dirtyFileListHasMore: dirtyEntries.length > PREVIEW_LIMIT,
    recentCommits: recentCommits.slice(0, PREVIEW_LIMIT),
    recentCommitsHasMore: recentCommits.length > PREVIEW_LIMIT,
  };
}

export async function collectDashboardGitCommitPage(
  projectPath: string,
  query: GitPageQuery = {},
): Promise<DashboardGitPage> {
  const limit = pageLimit(query.limit);
  const cursor = decodeCursor(projectPath, 'commits', query.cursor);
  try {
    await requireRepository(projectPath);
    const anchor = cursor?.anchor ?? (await currentCommit(projectPath));
    if (anchor === null) return { items: [], nextCursor: null, total: null };
    if (cursor) {
      try {
        await executeGit(projectPath, ['cat-file', '-e', `${anchor}^{commit}`]);
      } catch {
        throw new DashboardGitQueryError('提交分页对应的版本已不可用，请重新加载。', 409);
      }
    }
    const offset = cursor?.offset ?? 0;
    const entries = parseCommitLines(
      await executeGit(projectPath, [
        'log',
        '--no-show-signature',
        '--pretty=format:%h %s',
        `--skip=${offset}`,
        '-n',
        String(limit + 1),
        anchor,
        '--',
      ]),
    );
    return {
      items: entries.slice(0, limit),
      nextCursor:
        entries.length > limit
          ? encodeCursor(projectPath, 'commits', anchor, offset + limit)
          : null,
      total: null,
    };
  } catch (error) {
    if (error instanceof DashboardGitQueryError) throw error;
    throw new DashboardGitQueryError('读取 Git 提交记录失败。', 500);
  }
}

export async function collectDashboardGitFilePage(
  projectPath: string,
  query: GitPageQuery = {},
): Promise<DashboardGitPage> {
  const limit = pageLimit(query.limit);
  const cursor = decodeCursor(projectPath, 'files', query.cursor);
  try {
    await requireRepository(projectPath);
    const status = await executeGit(projectPath, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
    const anchor = digest(status);
    if (cursor && cursor.anchor !== anchor) {
      throw new DashboardGitQueryError('Git 文件列表已变化，请重新加载。', 409);
    }
    const entries = parsePorcelainRecords(status);
    const offset = cursor?.offset ?? 0;
    return {
      items: entries.slice(offset, offset + limit),
      nextCursor:
        offset + limit < entries.length
          ? encodeCursor(projectPath, 'files', anchor, offset + limit)
          : null,
      total: entries.length,
    };
  } catch (error) {
    if (error instanceof DashboardGitQueryError) throw error;
    throw new DashboardGitQueryError('读取 Git 文件列表失败。', 500);
  }
}

function pageLimit(limit = DEFAULT_PAGE_LIMIT): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new DashboardGitQueryError(`Git 分页数量必须为 1 到 ${MAX_PAGE_LIMIT} 的整数。`);
  }
  return limit;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encodeCursor(
  projectPath: string,
  kind: GitPageCursor['kind'],
  anchor: string,
  offset: number,
): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      kind,
      project: digest(path.resolve(projectPath)),
      anchor,
      offset,
    }),
  ).toString('base64url');
}

function decodeCursor(
  projectPath: string,
  kind: GitPageCursor['kind'],
  raw: string | undefined,
): GitPageCursor | null {
  if (raw === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/u.test(raw)) throw new Error('无效的编码');
    const decoded = Buffer.from(raw, 'base64url');
    if (decoded.toString('base64url') !== raw) throw new Error('无效的编码');
    const cursor = JSON.parse(decoded.toString('utf8')) as GitPageCursor;
    if (
      cursor === null ||
      typeof cursor !== 'object' ||
      Object.keys(cursor).length !== 5 ||
      cursor.version !== 1 ||
      cursor.kind !== kind ||
      cursor.project !== digest(path.resolve(projectPath)) ||
      typeof cursor.anchor !== 'string' ||
      !(kind === 'commits' ? /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u : /^[a-f0-9]{64}$/u).test(
        cursor.anchor,
      ) ||
      !Number.isSafeInteger(cursor.offset) ||
      cursor.offset < 0
    ) {
      throw new Error('无效的游标');
    }
    return cursor;
  } catch {
    throw new DashboardGitQueryError('Git 分页游标无效，请重新加载。');
  }
}

async function requireRepository(projectPath: string): Promise<void> {
  if ((await executeGit(projectPath, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') {
    throw new DashboardGitQueryError('当前项目不是 Git 工作区。', 500);
  }
}

async function currentCommit(projectPath: string): Promise<string | null> {
  try {
    return (
      await executeGit(projectPath, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
    ).trim();
  } catch (error) {
    if ((error as { code?: number }).code !== 1) throw error;
    const ref = (await executeGit(projectPath, ['symbolic-ref', '--quiet', 'HEAD'])).trim();
    try {
      await executeGit(projectPath, ['show-ref', '--verify', '--quiet', ref]);
    } catch (refError) {
      if ((refError as { code?: number }).code === 1) return null;
      throw refError;
    }
    throw error;
  }
}

function parseCommitLines(log: string): string[] {
  return log
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function emptySnapshot(): GitSnapshot {
  return {
    branch: null,
    head: null,
    dirtyFiles: 0,
    dirtyFileList: [],
    recentCommits: [],
    recentCommitsHasMore: false,
    dirtyFileListHasMore: false,
  };
}

async function executeGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['--no-optional-locks', ...args], { cwd, ...RUN_OPTS });
  return result.stdout.toString();
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    return await executeGit(cwd, args);
  } catch {
    return '';
  }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Parse dirty paths from NUL-terminated porcelain v1 status output.
 *
 * Each record is "XY PATH". Renames and copies store the new path in the
 * entry and the original path in the following NUL record; the snapshot
 * keeps showing the new path. XY is two status characters and the third
 * byte is always a separator, so shorter entries are malformed and skipped
 * to keep the snapshot best-effort.
 */
function parsePorcelainRecords(raw: string): string[] {
  const records = raw.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    paths.push(record.slice(3));
    if (record[0] === 'R' || record[0] === 'C' || record[1] === 'R' || record[1] === 'C') {
      index += 1;
    }
  }
  return paths;
}
