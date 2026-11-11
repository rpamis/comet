import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as identity from '../../../platform/process/process-identity.js';
import {
  withRecoverableFileLock,
  repairRecoverableFileLock,
} from '../../../platform/fs/recoverable-file-lock.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('releases the transaction after the writer exits without a PID lookup or doctor repair', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-lock-interrupted-'));
  roots.push(root);
  const entry = path.join(root, 'holder.mjs');
  const file = path.join(root, 'state.lock');
  await build({
    stdin: {
      contents: `import { withRecoverableFileLock } from ${JSON.stringify(path.resolve('platform/fs/recoverable-file-lock.ts'))};
        await withRecoverableFileLock(process.argv[2], async () => { process.stdout.write('held'); await new Promise((resolve) => setInterval(resolve, 10000)); });`,
      resolveDir: process.cwd(),
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const child = spawn(process.execPath, [entry, file], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  try {
    await once(child.stdout!, 'data');
    const closed = once(child, 'close');
    child.kill();
    await closed;
    await withRecoverableFileLock(
      file,
      async () => {
        expect(JSON.parse(await fs.readFile(file, 'utf8'))).not.toHaveProperty('pid');
      },
      { timeoutMs: 1000 },
    );
  } finally {
    child.kill();
  }
});

it('retires a confirmed legacy operation without binding its PID to the replacement', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-lock-legacy-pid-'));
  roots.push(root);
  const file = path.join(root, 'state.lock');
  await fs.writeFile(
    file,
    JSON.stringify({
      pid: process.pid,
      processIdentity: 'old-thread',
      nonce: 'old',
      createdAt: Date.now(),
    }),
  );
  await expect(withRecoverableFileLock(file, async () => undefined)).rejects.toThrow('Legacy lock');
  expect(await repairRecoverableFileLock(file, 'old')).toBe('blocked');
  expect(await repairRecoverableFileLock(file, 'old', { confirmedOwnerStopped: true })).toBe(
    'removed',
  );
  await withRecoverableFileLock(file, async () => {
    const owner = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(owner.nonce).not.toBe('old');
    expect(owner).not.toHaveProperty('pid');
  });
});

it('preserves the original operation error when lock cleanup also fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-lock-original-error-'));
  roots.push(root);
  const file = path.join(root, 'state.lock');
  const original = new Error('original operation failed');
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  await expect(
    withRecoverableFileLock(file, async () => {
      await fs.unlink(file);
      await fs.mkdir(file);
      throw original;
    }),
  ).rejects.toBe(original);
});

it('serializes writers without probing or persisting a process identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-lock-without-pid-'));
  roots.push(root);
  const probe = vi.spyOn(identity, 'readProcessIdentity');
  const file = path.join(root, 'state.lock');
  let active = 0;
  let maximum = 0;
  await Promise.all(
    Array.from({ length: 4 }, () =>
      withRecoverableFileLock(file, async () => {
        active++;
        maximum = Math.max(maximum, active);
        const owner = JSON.parse(await fs.readFile(file, 'utf8'));
        expect(owner).not.toHaveProperty('pid');
        expect(owner).not.toHaveProperty('processIdentity');
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
      }),
    ),
  );
  expect(maximum).toBe(1);
  expect(probe).not.toHaveBeenCalled();
});

it('serializes independent processes without process ownership records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-lock-processes-'));
  roots.push(root);
  const entry = path.join(root, 'writer.mjs');
  const file = path.join(root, 'counter.json');
  await fs.writeFile(file, '0');
  await build({
    stdin: {
      contents: `import { promises as fs } from 'node:fs';
        import { withRecoverableFileLock } from ${JSON.stringify(path.resolve('platform/fs/recoverable-file-lock.ts'))};
        for (let i=0;i<3;i++) await withRecoverableFileLock(process.argv[2]+'.lock', async () => {
          const current=Number(await fs.readFile(process.argv[2],'utf8'));
          await new Promise(resolve => setTimeout(resolve,10));
          await fs.writeFile(process.argv[2],String(current+1));
        });`,
      resolveDir: process.cwd(),
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  await Promise.all(
    Array.from(
      { length: 4 },
      () =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [entry, file], {
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true,
          });
          let error = '';
          child.stderr!.on('data', (chunk) => {
            error += chunk;
          });
          child.once('error', reject);
          child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(error))));
        }),
    ),
  );
  expect(await fs.readFile(file, 'utf8')).toBe('12');
});
