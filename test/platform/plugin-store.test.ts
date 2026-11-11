import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

import { JsonFileTextStore, withRecoverableFileLock } from '../../platform/fs/plugin-store.js';
import {
  diagnoseRecoverableFileLock,
  repairRecoverableFileLock,
} from '../../platform/fs/recoverable-file-lock.js';

describe('JsonFileTextStore locking', () => {
  it('releases a process-exited store lock without recording a PID or probing an old process', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lock-exit-'));
    try {
      const file = path.join(root, 'state.json');
      const bundle = path.join(root, 'store.cjs');
      await build({
        entryPoints: ['platform/fs/plugin-store.ts'],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        logLevel: 'silent',
      });
      await promisify(execFile)(process.execPath, [
        '-e',
        'const {JsonFileTextStore}=require(process.argv[1]);new JsonFileTextStore(process.argv[2]).withLock(async()=>process.exit(0));',
        bundle,
        file,
      ]);
      const owner = JSON.parse(await fs.readFile(`${file}.lock`, 'utf8'));
      expect(owner.protocolVersion).toBe(2);
      expect(owner).not.toHaveProperty('pid');
      expect(owner).not.toHaveProperty('hostname');
      expect(owner).not.toHaveProperty('processIdentity');
      await expect(new JsonFileTextStore(file).withLock(async () => 'recovered')).resolves.toBe(
        'recovered',
      );
      await expect(fs.stat(`${file}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('requires explicit stop confirmation before recovering a legacy PID lock', async () => {
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
      await expect(store.withLock(async () => 'unconfirmed')).rejects.toThrow(
        'Legacy lock requires confirmation',
      );
      const inspection = await diagnoseRecoverableFileLock(lock);
      expect(await repairRecoverableFileLock(lock, inspection.token!)).toBe('blocked');
      expect(
        await repairRecoverableFileLock(lock, 'wrong-token', {
          confirmedOwnerStopped: true,
        }),
      ).toBe('changed');
      await expect(fs.readFile(lock, 'utf8')).resolves.toContain('stale-owner');
      expect(
        await repairRecoverableFileLock(lock, inspection.token!, {
          confirmedOwnerStopped: true,
        }),
      ).toBe('removed');
      await expect(store.withLock(async () => 'recovered')).resolves.toBe('recovered');
      await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not infer stop permission from a legacy PID or process identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lock-reused-pid-'));
    try {
      const file = path.join(root, 'state.json');
      const lock = `${file}.lock`;
      await fs.writeFile(
        lock,
        JSON.stringify({
          pid: process.pid,
          nonce: 'previous-owner',
          createdAt: 1,
          hostname: os.hostname(),
          processIdentity: 'previous-process-instance',
        }),
        'utf8',
      );

      await expect(
        withRecoverableFileLock(lock, async () => 'recovered', { timeoutMs: 500 }),
      ).rejects.toThrow('Legacy lock requires confirmation');
      await expect(fs.readFile(lock, 'utf8')).resolves.toContain('previous-owner');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('records transaction metadata without a host or process identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lock-identity-'));
    try {
      const lock = path.join(root, 'state.lock');
      await withRecoverableFileLock(lock, async () => {
        const owner = JSON.parse(await fs.readFile(lock, 'utf8')) as Record<string, unknown>;
        expect(owner).toMatchObject({ protocolVersion: 2, nonce: expect.any(String) });
        expect(owner).not.toHaveProperty('pid');
        expect(owner).not.toHaveProperty('hostname');
        expect(owner).not.toHaveProperty('processIdentity');
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not steal a live same-host lock whose legacy owner lacks process identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lock-unknown-owner-'));
    try {
      const lock = path.join(root, 'state.lock');
      await fs.writeFile(
        lock,
        JSON.stringify({
          pid: process.pid,
          nonce: 'legacy-owner',
          createdAt: 1,
          hostname: os.hostname(),
        }),
      );

      await expect(
        withRecoverableFileLock(lock, async () => 'stolen', { timeoutMs: 100, retryMs: 10 }),
      ).rejects.toThrow('Legacy lock requires confirmation');
      await expect(fs.readFile(lock, 'utf8')).resolves.toContain('legacy-owner');
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

  it('requires stop confirmation for an old empty lock regardless of age', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lock-empty-'));
    try {
      const file = path.join(root, 'state.json');
      const lock = `${file}.lock`;
      const empty = path.join(root, 'empty-marker');
      await fs.writeFile(empty, '');
      const past = new Date(Date.now() - 11_000);
      await fs.writeFile(lock, '');
      await fs.utimes(lock, past, past);
      const store = new JsonFileTextStore(file);
      await expect(store.withLock(async () => 'unconfirmed')).rejects.toThrow(
        'Legacy lock requires confirmation',
      );
      const inspection = await diagnoseRecoverableFileLock(lock);
      expect(await repairRecoverableFileLock(lock, inspection.token!)).toBe('blocked');
      await expect(fs.readFile(lock, 'utf8')).resolves.toBe('');
      expect(
        await repairRecoverableFileLock(lock, inspection.token!, {
          confirmedOwnerStopped: true,
        }),
      ).toBe('removed');
      await expect(store.withLock(async () => 'recovered')).resolves.toBe('recovered');
      await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves a fresh empty legacy lock until the original operation is confirmed stopped', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lock-fresh-'));
    try {
      const file = path.join(root, 'state.json');
      const lock = `${file}.lock`;
      await fs.writeFile(lock, '');

      await expect(
        withRecoverableFileLock(lock, async () => 'stolen', { timeoutMs: 150, retryMs: 20 }),
      ).rejects.toThrow('Legacy lock requires confirmation');
      await expect(fs.readFile(lock, 'utf8')).resolves.toBe('');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('bounded receipt reads', () => {
  it.skipIf(process.platform === 'win32')(
    'reads exact UTF-8 byte limits and rejects oversized or invalid limits',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-read-limit-'));
      try {
        const store = new JsonFileTextStore(path.join(root, 'state.json'));
        await expect(store.read(3)).resolves.toBeNull();
        await store.write('中');
        await expect(store.read(3)).resolves.toBe('中');
        await expect(store.read(2)).rejects.toThrow('size limit');
        await expect(store.read(0)).rejects.toThrow('size limit');
        await expect(store.read()).resolves.toBe('中');
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );
});

it.skipIf(process.platform !== 'linux')(
  'bounded reads reject a FIFO and exit without a blocked filesystem worker',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-fifo-'));
    try {
      const fifo = path.join(root, 'journal.json');
      execFileSync('mkfifo', [fifo]);
      const bundle = path.join(root, 'store.cjs');
      await build({
        entryPoints: ['platform/fs/plugin-store.ts'],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'cjs',
      });
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          '-e',
          `
      const { JsonFileTextStore } = require(process.argv[1]);
      new JsonFileTextStore(process.argv[2]).read(1024).then(
        () => { process.exitCode = 1; },
        error => { console.log(error.message); }
      );
    `,
          bundle,
          fifo,
        ],
        { timeout: 2_000 },
      );
      expect(stdout).toContain('regular file');
      const target = path.join(root, 'actual.json');
      const link = path.join(root, 'link.json');
      await fs.writeFile(target, '{}');
      await fs.symlink(target, link);
      await expect(new JsonFileTextStore(link).read(1024)).rejects.toMatchObject({ code: 'ELOOP' });
      await expect(new JsonFileTextStore(root).read(1024)).rejects.toThrow('regular file');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
