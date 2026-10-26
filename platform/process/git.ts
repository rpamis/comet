import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { measureCometGitCommand } from './runtime-metrics.js';
import { ExternalCommandError, runExternalCommandAsync } from './external-command.js';

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

async function executeGitCommandAsync(cwd: string, args: readonly string[]): Promise<string> {
  try {
    return await runExternalCommandAsync('git', ['-C', cwd, ...args], {
      timeoutMs: GIT_TIMEOUT_MS,
      maxBufferBytes: GIT_MAX_BUFFER,
    });
  } catch (error) {
    throw new GitCommandError(cwd, args, error instanceof ExternalCommandError ? error.stderr : '');
  }
}

export async function runGitCommandAsync(cwd: string, args: readonly string[]): Promise<string> {
  return (await executeGitCommandAsync(cwd, args)).trim();
}

/** 合并前只导入源检出中已有的 gitlink 提交，不切换子仓 HEAD 或改写工作区。 */
export function fetchGitlinkCommitsForMerge(
  targetRoot: string,
  sourceRoot: string,
  sourceCommit: string,
): void {
  const sourceTree = runGitCommand(sourceRoot, ['ls-tree', '-r', '-z', sourceCommit]);
  const targetTree = runGitCommand(targetRoot, ['ls-tree', '-r', '-z', 'HEAD']);
  const base = runGitCommand(targetRoot, ['merge-base', 'HEAD', sourceCommit]);
  const baseTree = runGitCommand(targetRoot, ['ls-tree', '-r', '-z', base]);
  const gitlinks = (tree: string) =>
    new Map(
      tree.split('\0').flatMap((record) => {
        const entry = record.match(/^160000 commit ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t(.+)$/su);
        return entry ? [[entry[2], entry[1]]] : [];
      }),
    );
  const targetLinks = gitlinks(targetTree);
  const baseLinks = gitlinks(baseTree);
  for (const record of sourceTree.split('\0')) {
    const entry = record.match(/^160000 commit ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t(.+)$/su);
    if (!entry) continue;
    const [, commit, ref] = entry;
    if (targetLinks.get(ref) === commit || targetLinks.get(ref) === baseLinks.get(ref)) continue;
    if (path.isAbsolute(ref) || ref.split('/').some((part) => part === '..' || part === '.git'))
      throw new Error(`Unsafe Git submodule path: ${ref}`);
    const resolveCheckout = (root: string) => {
      const checkout = path.resolve(root, ...ref.split('/'));
      const physical = path.resolve(realpathSync(root), ...ref.split('/'));
      const stat = lstatSync(checkout);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        realpathSync(checkout) !== physical ||
        realpathSync(runGitCommand(checkout, ['rev-parse', '--show-toplevel'])) !== physical
      )
        throw new Error(`Git 子仓 ${ref} 未初始化或路径不安全；请先恢复子仓检出再重试合并`);
      return checkout;
    };
    const target = resolveCheckout(targetRoot);
    try {
      runGitCommand(target, ['cat-file', '-e', `${commit}^{commit}`]);
      continue;
    } catch {
      /* 目标只缺对象；从已验证的本地 change 检出读取。 */
    }
    const source = resolveCheckout(sourceRoot);
    try {
      runGitCommand(source, ['cat-file', '-e', `${commit}^{commit}`]);
      runGitCommand(target, ['fetch', '--no-tags', '--no-write-fetch-head', '--', source, commit]);
      runGitCommand(target, ['cat-file', '-e', `${commit}^{commit}`]);
    } catch (error) {
      throw new Error(
        `Git 子仓 ${ref} 无法从 ${source} 导入合并所需提交 ${commit}；请先在目标子仓 fetch 该提交后重试原合并`,
        { cause: error },
      );
    }
  }
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
  return executeGitCommand(cwd, gitStatusPorcelainArgs(pathspecs));
}

export function readGitStatusPorcelainAsync(
  cwd: string,
  pathspecs: readonly string[] = [],
): Promise<string> {
  return executeGitCommandAsync(cwd, gitStatusPorcelainArgs(pathspecs));
}

/** 一次读取分支、HEAD 和工作区状态，仍保留既有指纹使用的 v1 原文。 */
export async function readGitStatusObservationAsync(
  cwd: string,
  pathspecs: readonly string[] = [],
): Promise<{ head: string; branch: string; status: string }> {
  const raw = await executeGitCommandAsync(cwd, [
    'status',
    '--porcelain=v2',
    '--branch',
    '-z',
    '--untracked-files=all',
    '--ignore-submodules=none',
    '--',
    ...pathspecs,
  ]);
  const observation = parseGitStatusObservation(raw);
  // Git 的伪状态与同名合法分支有歧义；仅在这两种情况下按原完整 ref 规则复核。
  if (raw.split('\0').some((record) => /^# branch\.head \((?:detached|null)\)$/iu.test(record))) {
    const [head, ref] = (
      await runGitCommandAsync(cwd, ['rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD'])
    ).split(/\r?\n/u);
    if (head !== observation.head || !ref)
      throw new Error('Git HEAD changed during status observation');
    observation.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : '';
  }
  return observation;
}

export function parseGitStatusObservation(raw: string): {
  head: string;
  branch: string;
  status: string;
} {
  if (!raw.endsWith('\0')) throw new Error('Git status returned an incomplete observation');
  const records = raw.slice(0, -1).split('\0');
  let head: string | undefined;
  let branch: string | undefined;
  let status = '';
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.startsWith('# branch.oid ')) {
      const value = record.slice(13);
      if (head !== undefined || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value))
        throw new Error('Git status returned an invalid HEAD');
      head = value;
    } else if (record.startsWith('# branch.head ')) {
      const value = record.slice(14);
      if (branch !== undefined || !value || /[\r\n]/u.test(value))
        throw new Error('Git status returned an invalid branch');
      branch = /^\((?:detached|null)\)$/iu.test(value) ? '' : value;
    } else if (record.startsWith('# ')) {
      // Git 允许未来扩展头字段；它们不改变现有指纹。
      continue;
    } else if (record.startsWith('? ') || record.startsWith('! ')) {
      if (record.length < 3) throw new Error('Git status returned an empty path');
      status += `${record[0]}${record[0]} ${record.slice(2)}\0`;
    } else {
      const kind = record[0];
      const metadataCount = kind === '1' ? 8 : kind === '2' ? 9 : kind === 'u' ? 10 : 0;
      if (!metadataCount) throw new Error('Git status returned an unknown record');
      // 只分隔元数据，路径中的空格、换行与反斜杠必须逐字保留。
      let cursor = 0;
      const fields: string[] = [];
      for (let field = 0; field < metadataCount; field += 1) {
        const separator = record.indexOf(' ', cursor);
        if (separator < 0) throw new Error('Git status returned incomplete metadata');
        fields.push(record.slice(cursor, separator));
        cursor = separator + 1;
      }
      const ref = record.slice(cursor);
      if (
        !ref ||
        !/^[.MADRCUT]{2}$/u.test(fields[1]) ||
        !/^(?:N\.\.\.|S[.C][.M][.U])$/u.test(fields[2])
      )
        throw new Error('Git status returned invalid metadata');
      const modes = kind === 'u' ? 4 : 3;
      const hashes = kind === 'u' ? 3 : 2;
      if (
        fields.slice(3, 3 + modes).some((mode) => !/^[0-7]{6}$/u.test(mode)) ||
        fields
          .slice(3 + modes, 3 + modes + hashes)
          .some((hash) => !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(hash)) ||
        (kind === '2' && !/^[RC]\d{1,3}$/u.test(fields[8]))
      )
        throw new Error('Git status returned invalid metadata');
      status += `${fields[1].replaceAll('.', ' ')} ${ref}\0`;
      if (kind === '2') {
        const source = records[++index];
        if (!source) throw new Error('Git status returned an incomplete rename record');
        status += `${source}\0`;
      }
    }
  }
  if (head === undefined || branch === undefined)
    throw new Error('Git status returned an incomplete HEAD observation');
  return { head, branch, status };
}

function gitStatusPorcelainArgs(pathspecs: readonly string[]): string[] {
  return [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignore-submodules=none',
    '--',
    ...pathspecs,
  ];
}

export function gitStatusPaths(cwd: string): string[] {
  return parseGitStatusPaths(
    executeGitCommand(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  );
}

/** Parse the same untrimmed NUL-delimited observation used by the caller. */
export function parseGitStatusPaths(raw: string): string[] {
  return [
    ...new Set(
      parseGitStatusEntries(raw).flatMap((entry) =>
        entry.paths.map((ref) => ref.replaceAll('\\', '/')),
      ),
    ),
  ].sort();
}

/** 从同一次完整 status 观察取得未跟踪路径，避免再执行 ls-files。 */
export function parseGitStatusUntrackedPaths(raw: string): string[] {
  return [
    ...new Set(
      parseGitStatusEntries(raw)
        .filter((entry) => entry.status === '??')
        .flatMap((entry) => entry.paths),
    ),
  ].sort();
}

function parseGitStatusEntries(raw: string): Array<{ status: string; paths: string[] }> {
  if (!raw) return [];
  const records = raw.split('\0').filter(Boolean);
  const entries: Array<{ status: string; paths: string[] }> = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) throw new Error('Git status returned an invalid porcelain record');
    const paths = [record.slice(3)];
    if (record[0] === 'R' || record[0] === 'C' || record[1] === 'R' || record[1] === 'C') {
      const source = records[index + 1];
      if (!source) throw new Error('Git status returned an incomplete rename record');
      paths.push(source);
      index += 1;
    }
    entries.push({ status: record.slice(0, 2), paths });
  }
  return entries;
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
