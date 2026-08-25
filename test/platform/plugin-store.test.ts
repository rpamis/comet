import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { JsonFileTextStore } from '../../platform/fs/plugin-store.js';

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
});
