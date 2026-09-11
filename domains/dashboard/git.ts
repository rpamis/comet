import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GitSnapshot } from './types.js';

const execFileAsync = promisify(execFile);

const DIRTY_LIMIT = 20;
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
    runGit(projectPath, ['status', '--porcelain=v1', '-z']),
    runGit(projectPath, ['log', `-${RECENT_COMMIT_LIMIT}`, '--pretty=format:%h %s']),
  ]);

  const dirtyEntries = parsePorcelainRecords(statusOut);

  return {
    branch,
    head,
    dirtyFiles: dirtyEntries.length,
    dirtyFileList: dirtyEntries.slice(0, DIRTY_LIMIT),
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
    dirtyFiles: 0,
    dirtyFileList: [],
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
