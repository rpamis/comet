import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const stats = await fs.stat(lockPath);
    if (Date.now() - stats.mtimeMs > 120_000) await fs.rm(lockPath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function cliBuildIsFresh(repositoryRoot: string): Promise<boolean> {
  const cliIndex = path.join(repositoryRoot, 'dist', 'app', 'cli', 'index.js');
  if (!(await pathExists(cliIndex))) return false;
  const sourceRoots = ['app', 'domains', 'platform'];
  const sourceMtimes = await Promise.all(
    sourceRoots.map((root) => latestMtime(path.join(repositoryRoot, root))),
  );
  const [distStats, buildStats] = await Promise.all([
    fs.stat(cliIndex),
    fs.stat(path.join(repositoryRoot, 'build.js')),
  ]);
  return distStats.mtimeMs >= Math.max(...sourceMtimes, buildStats.mtimeMs);
}

export async function ensureCliBuilt(repositoryRoot: string): Promise<void> {
  const lockPath = path.join(repositoryRoot, '.comet-test-build.lock');
  // Wait for up to ~3 minutes for a concurrent build (test suites fan out across
  // many files, all racing through this helper). Only the holder of the lock
  // performs the build; everyone else polls for freshness instead of stacking
  // redundant `build.js` invocations that can corrupt `dist` under contention.
  const maxWaitAttempts = 1_800;
  for (let attempt = 0; attempt < maxWaitAttempts; attempt += 1) {
    await removeStaleLock(lockPath);
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(lockPath, 'wx');
      if (!(await cliBuildIsFresh(repositoryRoot))) {
        execFileSync(process.execPath, ['build.js'], {
          cwd: repositoryRoot,
          stdio: 'pipe',
        });
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally {
      await handle?.close();
      if (handle) await fs.rm(lockPath, { force: true });
    }

    // Did not hold the lock: a peer is building (or just released it). Wait for
    // the build to land rather than immediately re-claiming the lock, which
    // avoids redundant builds and the mtime races they create on Windows.
    if (await cliBuildIsFresh(repositoryRoot)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for CLI build to complete: ${lockPath}`);
}
