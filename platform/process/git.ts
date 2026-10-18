import { execFileSync } from 'node:child_process';

import { measureCometGitCommand } from './runtime-metrics.js';

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
    return measureCometGitCommand(() =>
      execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GIT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
      }),
    );
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

/** 源文件比较保留前后空白和换行，不能使用会 trim 的命令输出。 */
export function readGitBlob(cwd: string, objectId: string): string {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(objectId)) throw new Error('Invalid Git blob id');
  return executeGitCommand(cwd, ['cat-file', 'blob', objectId]);
}

/** 按内容对象批量读取原文；限制单个对象和每批输出，避免批量比较耗尽内存。 */
export function readGitBlobs(
  cwd: string,
  objectIds: readonly string[],
  maxBlobBytes = 1024 * 1024,
): Map<string, string> {
  if (!Number.isSafeInteger(maxBlobBytes) || maxBlobBytes < 1 || maxBlobBytes > GIT_MAX_BUFFER / 2)
    throw new Error('Invalid Git blob size limit');
  const ids = [...new Set(objectIds)];
  if (ids.some((id) => !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(id)))
    throw new Error('Invalid Git blob id');
  const blobs = new Map<string, string>();
  let totalBytes = 0;
  const execute = (args: string[], input: readonly string[]) =>
    measureCometGitCommand(() =>
      execFileSync('git', ['-C', cwd, 'cat-file', ...args], {
        input: input.join('\n') + '\n',
        timeout: GIT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
  for (let offset = 0; offset < ids.length; offset += 4096) {
    const metadata = execute(['--batch-check'], ids.slice(offset, offset + 4096));
    const sizes = new Map<string, number>();
    for (const line of metadata.toString('ascii').trimEnd().split('\n')) {
      const match = line.match(/^([a-f0-9]{40}(?:[a-f0-9]{24})?) blob (\d+)$/u);
      if (!match) continue;
      const size = Number(match[2]);
      if (Number.isSafeInteger(size) && size <= maxBlobBytes) {
        totalBytes += size;
        if (totalBytes > 64 * 1024 * 1024)
          throw new Error('Git blob batch exceeds its total size limit');
        sizes.set(match[1], size);
      }
    }
    let batch: string[] = [];
    let bytes = 0;
    const flush = () => {
      if (!batch.length) return;
      const output = execute(['--batch'], batch);
      let cursor = 0;
      for (const id of batch) {
        const newline = output.indexOf(10, cursor);
        if (newline < 0) throw new Error('Git batch returned an incomplete header');
        const header = output.subarray(cursor, newline).toString('ascii');
        const size = sizes.get(id)!;
        if (header !== `${id} blob ${size}` || output[newline + size + 1] !== 10)
          throw new Error('Git batch returned an invalid blob');
        blobs.set(id, output.subarray(newline + 1, newline + size + 1).toString('utf8'));
        cursor = newline + size + 2;
      }
      if (cursor !== output.length) throw new Error('Git batch returned unexpected content');
      batch = [];
      bytes = 0;
    };
    for (const [id, size] of sizes) {
      if (bytes + size + 128 > GIT_MAX_BUFFER / 2 || batch.length >= 1024) flush();
      batch.push(id);
      bytes += size + 128;
    }
    flush();
  }
  return blobs;
}

export function gitWorktreeIsClean(cwd: string): boolean {
  return runGitCommand(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']) === '';
}

export function assertValidGitBranchName(cwd: string, branch: string): void {
  runGitCommand(cwd, ['check-ref-format', '--branch', branch]);
}

export function readGitStatusPorcelain(cwd: string, pathspecs: readonly string[] = []): string {
  return executeGitCommand(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignore-submodules=none',
    '--',
    ...pathspecs,
  ]);
}

export function gitStatusPaths(cwd: string): string[] {
  return parseGitStatusPaths(
    executeGitCommand(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  );
}

/** Parse the same untrimmed NUL-delimited observation used by the caller. */
export function parseGitStatusPaths(raw: string): string[] {
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
