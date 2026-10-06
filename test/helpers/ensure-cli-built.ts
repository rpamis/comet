import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import {
  withRecoverableFileLock,
  type RecoverableFileLockOptions,
} from '../../platform/fs/plugin-store.js';

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function latestMtime(root: string): Promise<number> {
  const stats = await fs.stat(root);
  if (!stats.isDirectory()) return stats.mtimeMs;
  const entries = await fs.readdir(root, { withFileTypes: true });
  const times = await Promise.all(entries.map((entry) => latestMtime(path.join(root, entry.name))));
  return Math.max(stats.mtimeMs, ...times);
}

async function compiledFilesExist(repositoryRoot: string, root: string): Promise<boolean> {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!(await compiledFilesExist(repositoryRoot, file))) return false;
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      const output = path.join('dist', path.relative(repositoryRoot, file).slice(0, -3));
      for (const extension of ['.js', '.js.map', '.d.ts', '.d.ts.map'])
        if (!(await pathExists(path.join(repositoryRoot, output + extension)))) return false;
    }
  }
  return true;
}

async function cliBuildIsFresh(repositoryRoot: string): Promise<boolean> {
  const cliIndex = path.join(repositoryRoot, 'dist', 'app', 'cli', 'index.js');
  if (!(await pathExists(cliIndex))) return false;
  const sourceRoots = ['app', 'domains', 'platform'];
  for (const root of sourceRoots)
    if (!(await compiledFilesExist(repositoryRoot, path.join(repositoryRoot, root)))) return false;
  const sourceMtimes = await Promise.all(
    sourceRoots.map((root) => latestMtime(path.join(repositoryRoot, root))),
  );
  const [distStats, buildStats] = await Promise.all([
    fs.stat(cliIndex),
    fs.stat(path.join(repositoryRoot, 'build.js')),
  ]);
  return distStats.mtimeMs >= Math.max(...sourceMtimes, buildStats.mtimeMs);
}

interface EnsureCliBuiltOptions {
  lockOptions?: RecoverableFileLockOptions;
}

export async function ensureCliBuilt(
  repositoryRoot: string,
  options: EnsureCliBuiltOptions = {},
): Promise<void> {
  const lockPath = path.join(repositoryRoot, '.comet-test-build.lock');
  // 复用进程身份锁；活跃或无法确认退出的 owner 不能按文件年龄被夺取。
  await withRecoverableFileLock(
    lockPath,
    async () => {
      if (!(await cliBuildIsFresh(repositoryRoot))) {
        execFileSync(process.execPath, ['build.js'], {
          cwd: repositoryRoot,
          stdio: 'pipe',
        });
        if (!(await cliBuildIsFresh(repositoryRoot)))
          throw new Error('CLI build outputs are incomplete or stale');
      }
    },
    { timeoutMs: 180_000, retryMs: 100, ...options.lockOptions },
  );
}
