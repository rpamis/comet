import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { JsonFileTextStore, withRecoverableFileLock } from '../../platform/fs/plugin-store.js';

describe('JsonFileTextStore locking', () => {
  it('recovers a lock whose owning process is no longer alive', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lock-stale-'));
    try {
      const file = path.join(root, 'state.json');
      const lock = `${file}.lock`;
      await fs.writeFile(
        lock,
        JSON.stringify({ pid: 2_147_483_647, nonce: 'stale-owner', createdAt: 1 }),
        'utf8',
      );
      const store = new JsonFileTextStore(file);

      await expect(store.withLock(async () => 'recovered')).resolves.toBe('recovered');
      await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not delete a lock file after its ownership nonce changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lock-owner-'));
    try {
      const file = path.join(root, 'state.json');
      const lock = `${file}.lock`;
      const store = new JsonFileTextStore(file);

      await store.withLock(async () => {
        await fs.writeFile(
          lock,
          JSON.stringify({ pid: process.pid, nonce: 'replacement-owner', createdAt: Date.now() }),
          'utf8',
        );
      });

      await expect(fs.readFile(lock, 'utf8')).resolves.toContain('replacement-owner');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('recovers an empty lock file left by a crash between creation and owner write', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lock-empty-'));
    try {
      const file = path.join(root, 'state.json');
      const lock = `${file}.lock`;
      // A fresh empty lock (mtime now) is given a short in-flight-write grace, so
      // age it just past EMPTY_LOCK_GRACE_MS (10 s) before expecting recovery.
      const empty = path.join(root, 'empty-marker');
      await fs.writeFile(empty, '');
      const past = new Date(Date.now() - 11_000);
      await fs.writeFile(lock, '');
      await fs.utimes(lock, past, past);
      const store = new JsonFileTextStore(file);

      await expect(store.withLock(async () => 'recovered')).resolves.toBe('recovered');
      await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps waiting on a fresh empty lock to respect an in-flight owner write', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lock-fresh-'));
    try {
      const file = path.join(root, 'state.json');
      const lock = `${file}.lock`;
      await fs.writeFile(lock, '');

      // A just-created empty lock is plausibly mid-write; acquiring must not
      // silently steal it. The short custom timeout keeps this test fast while
      // exercising the wait-then-timeout path.
      await expect(
        withRecoverableFileLock(lock, async () => 'stolen', { timeoutMs: 150, retryMs: 20 }),
      ).rejects.toThrow(/Timed out waiting for file lock/u);
      await expect(fs.readFile(lock, 'utf8')).resolves.toBe('');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
