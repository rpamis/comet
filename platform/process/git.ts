import { execFileSync } from 'node:child_process';

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

export class GitCommandError extends Error {
  constructor(
    readonly cwd: string,
    readonly args: readonly string[],
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
    this.name = 'GitCommandError';
  }
}

function executeGitCommand(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
    });
  } catch (error) {
    const stderr =
      typeof (error as { stderr?: unknown }).stderr === 'string'
        ? (error as { stderr: string }).stderr.trim()
        : Buffer.isBuffer((error as { stderr?: unknown }).stderr)
          ? (error as { stderr: Buffer }).stderr.toString('utf8').trim()
          : '';
    throw new GitCommandError(cwd, args, stderr);
  }
}

export function runGitCommand(cwd: string, args: readonly string[]): string {
  return executeGitCommand(cwd, args).trim();
}

export function gitWorktreeIsClean(cwd: string): boolean {
  return runGitCommand(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']) === '';
}

export function assertValidGitBranchName(cwd: string, branch: string): void {
  runGitCommand(cwd, ['check-ref-format', '--branch', branch]);
}

export function gitStatusPaths(cwd: string): string[] {
  const raw = executeGitCommand(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!raw) return [];
  const records = raw.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) throw new Error('Git status returned an invalid porcelain record');
    paths.push(record.slice(3).replaceAll('\\', '/'));
    if (record[0] === 'R' || record[0] === 'C' || record[1] === 'R' || record[1] === 'C') {
      const source = records[index + 1];
      if (!source) throw new Error('Git status returned an incomplete rename record');
      paths.push(source.replaceAll('\\', '/'));
      index += 1;
    }
  }
  return [...new Set(paths)].sort();
}

export function gitBranchRemote(cwd: string, branch: string): string {
  try {
    const configured = runGitCommand(cwd, ['config', '--get', `branch.${branch}.remote`]);
    if (configured && configured !== '.') return configured;
  } catch {
    // A branch without an upstream can still use an unambiguous origin remote.
  }
  const remotes = runGitCommand(cwd, ['remote'])
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (remotes.includes('origin')) return 'origin';
  if (remotes.length === 1) return remotes[0];
  throw new Error(
    remotes.length === 0
      ? 'Native workspace finish requires a configured Git remote'
      : `Native workspace finish requires an unambiguous Git remote: ${remotes.join(', ')}`,
  );
}
