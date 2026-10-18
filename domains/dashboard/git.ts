import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import type { GitSnapshot } from './types.js';

const execFileAsync = promisify(execFile);

const DIRTY_LIMIT = 20;
const DIRTY_ENTRY_LIMIT = 200;
const RECENT_COMMIT_LIMIT = 3;
const RUN_OPTS = { timeout: 10_000, maxBuffer: 1024 * 1024 };

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
    collectGitStatus(projectPath),
    runGit(projectPath, ['log', `-${RECENT_COMMIT_LIMIT}`, '--pretty=format:%h %s']),
  ]);

  const dirtyEntries = statusOut.entries;

  return {
    branch,
    head,
    dirtyFiles: statusOut.count,
    status: statusOut.count === null ? 'error' : 'available',
    dirtyEntriesTruncated: statusOut.count !== null && statusOut.count > dirtyEntries.length,
    dirtyFileList: dirtyEntries.slice(0, DIRTY_LIMIT).map((entry) => entry.path),
    dirtyEntries,
    recentCommits: log
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  };
}

function emptySnapshot(): GitSnapshot {
  return {
    branch: null,
    head: null,
    dirtyFiles: null,
    status: 'unavailable',
    dirtyFileList: [],
    dirtyEntries: [],
    recentCommits: [],
  };
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd, ...RUN_OPTS });
    return result.stdout.toString();
  } catch {
    return '';
  }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** 流式消费完整状态，只保留有界展示条目；失败不能解释成干净工作区。 */
async function collectGitStatus(cwd: string): Promise<{
  count: number | null;
  entries: { path: string; status: string }[];
}> {
  return new Promise((resolve) => {
    const entries: { path: string; status: string }[] = [];
    let count = 0;
    let pending = '';
    let skipSource = false;
    let settled = false;
    const child = spawn('git', ['status', '--porcelain=v1', '-z'], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok ? { count, entries } : { count: null, entries: [] });
    };
    const fail = () => {
      child.kill('SIGKILL');
      child.stdout.destroy();
      child.unref();
      finish(false);
    };
    const timer = setTimeout(fail, RUN_OPTS.timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf('\0')) >= 0) {
        if (end > 1024 * 1024) {
          fail();
          return;
        }
        const record = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (skipSource) {
          if (!record) {
            fail();
            return;
          }
          skipSource = false;
          continue;
        }
        if (record.length < 4 || record[2] !== ' ') {
          fail();
          return;
        }
        count += 1;
        if (entries.length < DIRTY_ENTRY_LIMIT)
          entries.push({ path: record.slice(3), status: record.slice(0, 2) });
        skipSource = /^[RC]|^.[RC]/u.test(record);
      }
      // 单一路径异常长时也必须有界，不能无限积累未结束的记录。
      if (pending.length > 1024 * 1024) fail();
    });
    child.once('error', () => finish(false));
    child.once('close', (code, signal) =>
      finish(code === 0 && signal === null && pending.length === 0 && !skipSource),
    );
  });
}
