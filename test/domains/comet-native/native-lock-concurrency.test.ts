import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { acquireNativeLock, releaseNativeLock } from '../../../domains/comet-native/native-lock.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

interface WorkerResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const fixture = fileURLToPath(
  new URL('../../fixtures/native-lock-process-worker.ts', import.meta.url),
);

async function waitFor(file: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fs.access(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

function collect(child: ChildProcessWithoutNullStreams): Promise<WorkerResult> {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  return new Promise((resolve) => {
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('Native lock process concurrency', () => {
  let buildRoot: string;
  let worker: string;
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeAll(async () => {
    buildRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-lock-worker-'));
    worker = path.join(buildRoot, 'worker.mjs');
    await build({
      entryPoints: [fixture],
      outfile: worker,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
    });
  });

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-lock-process-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    await fs.mkdir(paths.locksDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(buildRoot, { recursive: true, force: true });
  });

  function startWorker(args: string[]): {
    child: ChildProcessWithoutNullStreams;
    result: Promise<WorkerResult>;
  } {
    const child = spawn(process.execPath, [worker, ...args], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { child, result: collect(child) };
  }

  it.each(['root-move', 'transition-example'])(
    'allows only one process to replace a diagnosed stale %s lock',
    async (lockName) => {
      const lockFile = path.join(paths.locksDir, `${lockName}.lock`);
      await fs.writeFile(
        lockFile,
        JSON.stringify({
          id: `stale-${lockName}`,
          pid: 2_147_483_647,
          hostname: os.hostname(),
          createdAt: '2026-07-17T00:00:00.000Z',
          operation: 'interrupted operation',
        }),
      );
      const readyPrimary = path.join(projectRoot, 'primary.ready');
      const readyLate = path.join(projectRoot, 'late.ready');
      const go = path.join(projectRoot, 'go');
      const primaryStatus = path.join(projectRoot, 'primary.status');
      const lateStatus = path.join(projectRoot, 'late.status');
      const release = path.join(projectRoot, 'release');
      const primary = startWorker([
        'takeover',
        projectRoot,
        lockName,
        'primary',
        readyPrimary,
        go,
        primaryStatus,
        release,
      ]);
      const late = startWorker([
        'takeover',
        projectRoot,
        lockName,
        'late',
        readyLate,
        go,
        lateStatus,
        release,
      ]);

      await Promise.all([waitFor(readyPrimary), waitFor(readyLate)]);
      await fs.writeFile(go, 'go\n');
      await Promise.all([waitFor(primaryStatus), waitFor(lateStatus)]);
      const statuses = await Promise.all([
        fs.readFile(primaryStatus, 'utf8'),
        fs.readFile(lateStatus, 'utf8'),
      ]);
      expect(statuses.filter((status) => status.startsWith('acquired:'))).toHaveLength(1);
      expect(statuses.filter((status) => status.startsWith('blocked:'))).toHaveLength(1);

      await fs.writeFile(release, 'release\n');
      const results = await Promise.all([primary.result, late.result]);
      expect(results).toEqual([
        expect.objectContaining({ code: 0, stderr: '' }),
        expect.objectContaining({ code: 0, stderr: '' }),
      ]);
      expect(JSON.parse(results[0].stdout)).toMatchObject({ takeover: { status: 'removed' } });
      expect(JSON.parse(results[1].stdout)).toMatchObject({ takeover: { status: 'changed' } });
    },
  );

  it('prevents an old owner release from removing a replacement owner', async () => {
    const old = await acquireNativeLock(paths, 'archive', 'old archive owner');
    const oldSnapshot = path.join(projectRoot, 'old-lock.json');
    await fs.writeFile(oldSnapshot, JSON.stringify(old));
    await releaseNativeLock(old);
    const replacement = await acquireNativeLock(paths, 'archive', 'replacement archive owner');
    const ready = path.join(projectRoot, 'release.ready');
    const go = path.join(projectRoot, 'release.go');
    const status = path.join(projectRoot, 'release.status');
    const workerProcess = startWorker([
      'release-old',
      projectRoot,
      'archive',
      'late',
      ready,
      go,
      status,
      oldSnapshot,
    ]);

    await waitFor(ready);
    await fs.writeFile(`${go}.primary`, 'replacement-ready\n');
    await fs.writeFile(go, 'go\n');
    await waitFor(status);
    expect(await fs.readFile(status, 'utf8')).toMatch(/^blocked:/u);
    expect(await fs.readFile(replacement.file, 'utf8')).toContain(replacement.owner.id);
    await expect(workerProcess.result).resolves.toMatchObject({ code: 0, stderr: '' });
    await releaseNativeLock(replacement);
  });

  it('elects one winner when two processes acquire the same free lock together', async () => {
    const readyA = path.join(projectRoot, 'race-a.ready');
    const readyB = path.join(projectRoot, 'race-b.ready');
    const go = path.join(projectRoot, 'race.go');
    const statusA = path.join(projectRoot, 'race-a.status');
    const statusB = path.join(projectRoot, 'race-b.status');
    const release = path.join(projectRoot, 'race.release');
    const contenders = [
      startWorker(['acquire-race', projectRoot, 'root-move', 'a', readyA, go, statusA, release]),
      startWorker(['acquire-race', projectRoot, 'root-move', 'b', readyB, go, statusB, release]),
    ];

    await Promise.all([waitFor(readyA), waitFor(readyB)]);
    await fs.writeFile(go, 'go\n');
    await Promise.all([waitFor(statusA), waitFor(statusB)]);
    const statuses = await Promise.all([
      fs.readFile(statusA, 'utf8'),
      fs.readFile(statusB, 'utf8'),
    ]);
    expect(statuses.filter((status) => status.startsWith('acquired:'))).toHaveLength(1);
    expect(statuses.filter((status) => status.startsWith('blocked:'))).toHaveLength(1);
    expect(statuses.join('\n')).not.toContain('coordinator is busy');

    await fs.writeFile(release, 'release\n');
    await expect(Promise.all(contenders.map(({ result }) => result))).resolves.toEqual([
      expect.objectContaining({ code: 0, stderr: '' }),
      expect.objectContaining({ code: 0, stderr: '' }),
    ]);
  });
});
