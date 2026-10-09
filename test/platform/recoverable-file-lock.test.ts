import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diagnoseRecoverableFileLock,
  repairRecoverableFileLock,
  withRecoverableFileLock,
} from '../../platform/fs/recoverable-file-lock.js';
import { readProcessIdentity } from '../../platform/process/process-identity.js';
import { RaceSafeReadError } from '../../platform/fs/race-safe-read.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-recoverable-lock-'));
  roots.push(root);
  return { root, lock: path.join(root, 'projection.lock') };
}
const deadOwner = () => ({
  pid: 2_147_483_647,
  nonce: 'dead',
  hostname: os.hostname(),
  createdAt: Date.now(),
});
const remoteOwner = () => ({
  pid: process.pid,
  nonce: 'remote',
  hostname: 'another-host',
  createdAt: 1,
});

describe('recoverable file lock safety', () => {
  it.each(['', '{partial-owner:'])(
    'never uses age or clock drift to steal unknown owner %j',
    async (source) => {
      const { lock } = await fixture();
      await fs.writeFile(lock, source);
      await fs.utimes(lock, new Date(0), new Date(0));
      const inspected = await diagnoseRecoverableFileLock(lock);
      expect(inspected.status).toBe('malformed');
      await expect(
        withRecoverableFileLock(lock, async () => 'unsafe', { timeoutMs: 20, retryMs: 1 }),
      ).rejects.toThrow(/Timed out/);
      expect(await repairRecoverableFileLock(lock, inspected.token!)).toBe('blocked');
      expect(await fs.readFile(lock, 'utf8')).toBe(source);
      expect(
        await repairRecoverableFileLock(lock, inspected.token!, { confirmedOwnerStopped: true }),
      ).toBe('removed');
    },
  );

  it('requires exact confirmed cross-host identity and refuses a live local owner', async () => {
    const { lock } = await fixture();
    await fs.writeFile(lock, JSON.stringify(remoteOwner()));
    const remote = await diagnoseRecoverableFileLock(lock);
    expect(remote.status).toBe('unknown');
    expect(await repairRecoverableFileLock(lock, remote.token!)).toBe('blocked');
    await fs.writeFile(lock, JSON.stringify({ ...remoteOwner(), nonce: 'replacement' }));
    expect(
      await repairRecoverableFileLock(lock, remote.token!, { confirmedOwnerStopped: true }),
    ).toBe('changed');
    await fs.writeFile(
      lock,
      JSON.stringify({
        ...remoteOwner(),
        hostname: os.hostname(),
        processIdentity: await readProcessIdentity(process.pid),
      }),
    );
    const active = await diagnoseRecoverableFileLock(lock);
    expect(active.status).toBe('active');
    expect(
      await repairRecoverableFileLock(lock, active.token!, { confirmedOwnerStopped: true }),
    ).toBe('blocked');
  });

  it('binds repair to file identity even when a replacement has identical bytes', async () => {
    const { lock, root } = await fixture();
    const content = JSON.stringify(remoteOwner());
    await fs.writeFile(lock, content);
    const inspected = await diagnoseRecoverableFileLock(lock);
    const replacement = path.join(root, 'replacement');
    await fs.writeFile(replacement, content);
    await fs.rename(replacement, lock);
    expect(
      await repairRecoverableFileLock(lock, inspected.token!, { confirmedOwnerStopped: true }),
    ).toBe('changed');
    expect(await fs.readFile(lock, 'utf8')).toBe(content);
  });

  it('preserves a replacement raced immediately before quarantine', async () => {
    const { lock, root } = await fixture();
    await fs.writeFile(lock, JSON.stringify(deadOwner()));
    const inspected = await diagnoseRecoverableFileLock(lock);
    const rename = fs.rename.bind(fs);
    let raced = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from) === lock && !raced) {
        raced = true;
        await fs.writeFile(path.join(root, 'next'), JSON.stringify(remoteOwner()));
        await rename(path.join(root, 'next'), lock);
      }
      return rename(from, to);
    });
    await expect(repairRecoverableFileLock(lock, inspected.token!)).rejects.toThrow(
      /changed during repair/,
    );
    expect(JSON.parse(await fs.readFile(lock, 'utf8')).nonce).toBe('remote');
  });

  it('publishes complete owner records before the public lock exists', async () => {
    const { lock } = await fixture();
    const link = fs.link.bind(fs);
    vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
      if (String(to) === lock) {
        expect(JSON.parse(await fs.readFile(from, 'utf8'))).toMatchObject({
          pid: process.pid,
          hostname: os.hostname(),
        });
        await expect(fs.lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
      }
      return link(from, to);
    });
    await withRecoverableFileLock(lock, async () => undefined);
  });

  it('serializes simultaneous stale recovery and live writers', async () => {
    const { lock } = await fixture();
    await fs.writeFile(lock, JSON.stringify(deadOwner()));
    let active = 0;
    let completed = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withRecoverableFileLock(
          lock,
          async () => {
            active += 1;
            expect(active).toBe(1);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            completed += 1;
          },
          { timeoutMs: 10000, retryMs: 1 },
        ),
      ),
    );
    expect(completed).toBe(8);
    expect((await diagnoseRecoverableFileLock(lock)).status).toBe('missing');
  });

  it.for(['changed', 'EPERM'] as const)(
    'recovers a transient coordinator read failure without overlapping writers (%s)',
    async (failure, context) => {
      if (failure === 'EPERM' && process.platform !== 'win32')
        context.skip('Windows sharing-violation recovery');
      const { lock } = await fixture();
      const realpath = fs.realpath.bind(fs);
      let injected = false;
      vi.spyOn(fs, 'realpath').mockImplementation(async (file) => {
        if (String(file).endsWith('.ticket') && !injected) {
          injected = true;
          if (failure === 'changed') throw new RaceSafeReadError('changed', 'Changed ticket');
          throw Object.assign(new Error('Transient sharing violation'), { code: 'EPERM' });
        }
        return realpath(file);
      });
      let active = 0;
      const results = await Promise.allSettled(
        Array.from({ length: 2 }, () =>
          withRecoverableFileLock(
            lock,
            async () => {
              active += 1;
              expect(active).toBe(1);
              await new Promise((resolve) => setTimeout(resolve, 5));
              active -= 1;
            },
            { timeoutMs: 10000, retryMs: 1 },
          ),
        ),
      );
      expect(injected).toBe(true);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      expect((await diagnoseRecoverableFileLock(lock)).status).toBe('missing');
    },
  );

  it.runIf(process.platform === 'win32')(
    'preserves an unreadable coordinator owner and refuses to enter after the deadline',
    async () => {
      const { lock } = await fixture();
      const directory = `${lock}.contenders`;
      await fs.mkdir(directory);
      const foreign = path.join(directory, 'blocked.ticket');
      const content = JSON.stringify({ ...remoteOwner(), ticket: 1 });
      await fs.writeFile(foreign, content);
      const realpath = fs.realpath.bind(fs);
      vi.spyOn(fs, 'realpath').mockImplementation(async (file) => {
        if (String(file) === foreign)
          throw Object.assign(new Error('Persistent permission failure'), { code: 'EPERM' });
        return realpath(file);
      });
      const operation = vi.fn();
      await expect(
        withRecoverableFileLock(lock, operation, { timeoutMs: 100, retryMs: 1 }),
      ).rejects.toMatchObject({ code: 'EPERM' });
      expect(operation).not.toHaveBeenCalled();
      expect(await fs.readFile(foreign, 'utf8')).toBe(content);
    },
  );

  it('ignores dead choosing and ticket owners without minimum age or deleting their records', async () => {
    const { lock } = await fixture();
    const directory = `${lock}.contenders`;
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'dead.choosing'), JSON.stringify(deadOwner()));
    await fs.writeFile(
      path.join(directory, 'dead.ticket'),
      JSON.stringify({ ...deadOwner(), ticket: 1 }),
    );
    await withRecoverableFileLock(lock, async () => undefined, { timeoutMs: 100 });
    expect((await fs.readdir(directory)).sort()).toEqual(['dead.choosing', 'dead.ticket']);
  });

  it.each(['', JSON.stringify(deadOwner()), JSON.stringify({ ...remoteOwner(), ticket: 1 })])(
    'diagnoses and confirms abandoned coordinator records %j with no main lock',
    async (content) => {
      const { lock } = await fixture();
      await fs.mkdir(`${lock}.contenders`);
      const contender = path.join(`${lock}.contenders`, 'old.ticket');
      await fs.writeFile(contender, content);
      const before = await fs.readdir(`${lock}.contenders`);
      const diagnosis = await diagnoseRecoverableFileLock(lock);
      expect(diagnosis.status).toBe('missing');
      expect(diagnosis.coordinator).toHaveLength(1);
      expect(await fs.readdir(`${lock}.contenders`)).toEqual(before);
      const token = diagnosis.coordinator![0].token;
      expect(await repairRecoverableFileLock(lock, token)).toBe('blocked');
      expect(await repairRecoverableFileLock(lock, token, { confirmedOwnerStopped: true })).toBe(
        'removed',
      );
      await withRecoverableFileLock(lock, async () => undefined, { timeoutMs: 100 });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects symbolic links without touching their target',
    async () => {
      const { root, lock } = await fixture();
      const target = path.join(root, 'target');
      await fs.writeFile(target, 'private');
      await fs.symlink(target, lock);
      await expect(diagnoseRecoverableFileLock(lock)).rejects.toThrow(/regular file/);
      await expect(withRecoverableFileLock(lock, async () => 'unsafe')).rejects.toThrow(
        /regular file/,
      );
      expect(await fs.readFile(target, 'utf8')).toBe('private');
    },
  );

  it('propagates unreadable metadata rather than diagnosing healthy or removing it', async () => {
    const { lock } = await fixture();
    await fs.writeFile(lock, JSON.stringify(deadOwner()));
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation((async (
      file: Parameters<typeof fs.open>[0],
      ...args: unknown[]
    ) => {
      if (String(file) === lock) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return (open as (...args: unknown[]) => ReturnType<typeof fs.open>)(file, ...args);
    }) as typeof fs.open);
    await expect(diagnoseRecoverableFileLock(lock)).rejects.toMatchObject({ code: 'EACCES' });
    expect(await fs.readFile(lock, 'utf8')).toContain('dead');
  });

  it('uses a monotonic timeout when the wall clock moves backwards', async () => {
    const { lock } = await fixture();
    await fs.writeFile(lock, '{}');
    let clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => (clock -= 100_000));
    await expect(
      withRecoverableFileLock(lock, async () => 'unsafe', { timeoutMs: 20, retryMs: 1 }),
    ).rejects.toThrow(/Timed out/);
  });
  it('treats a legacy owner with no hostname as unknown even when that pid is absent locally', async () => {
    const { lock } = await fixture();
    await fs.writeFile(lock, JSON.stringify({ pid: 2_147_483_647, nonce: 'legacy', createdAt: 1 }));
    expect((await diagnoseRecoverableFileLock(lock)).status).toBe('unknown');
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a linked coordinator directory without changing the outside directory',
    async () => {
      const { root, lock } = await fixture();
      const outside = path.join(root, 'outside');
      await fs.mkdir(outside);
      await fs.symlink(outside, `${lock}.contenders`);
      await expect(withRecoverableFileLock(lock, async () => 'unsafe')).rejects.toThrow(
        /coordinator must be a directory/,
      );
      await expect(diagnoseRecoverableFileLock(lock)).rejects.toThrow(
        /coordinator must be a directory/,
      );
      expect(await fs.readdir(outside)).toEqual([]);
    },
  );
  it('keeps a malformed coordinator ticket when its identifiable owner is still alive', async () => {
    const { lock } = await fixture();
    await fs.mkdir(`${lock}.contenders`);
    const ticket = path.join(`${lock}.contenders`, 'live.ticket');
    await fs.writeFile(
      ticket,
      JSON.stringify({
        ...remoteOwner(),
        hostname: os.hostname(),
        processIdentity: await readProcessIdentity(process.pid),
      }),
    );
    const inspected = await diagnoseRecoverableFileLock(lock);
    expect(inspected.coordinator?.[0].status).toBe('malformed');
    expect(
      await repairRecoverableFileLock(lock, inspected.coordinator![0].token, {
        confirmedOwnerStopped: true,
      }),
    ).toBe('blocked');
    expect(await fs.readFile(ticket, 'utf8')).toContain('remote');
  });
});
