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
    runGit(projectPath, ['status', '--porcelain']),
    runGit(projectPath, ['log', `-${RECENT_COMMIT_LIMIT}`, '--pretty=format:%h %s']),
  ]);

  const dirtyEntries = statusOut
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map(parsePorcelainLine);

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

function parsePorcelainLine(line: string): string {
  // Porcelain v1 format: "XY <path>" or "XY <old> -> <new>".
  // XY is the two-character status; column 3 is always a separator space.
  // Trimming the leading status block lets us recover the path even when X
  // or Y is a space (e.g. " M file.txt", "?? new.txt").
  const body = line.slice(3);
  const arrowIdx = body.indexOf(' -> ');
  return (arrowIdx >= 0 ? body.slice(arrowIdx + 4) : body).trim();
}
