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
  it('publishes an uncontended owner without creating coordinator tickets', async () => {
    const { lock } = await fixture();
    await withRecoverableFileLock(lock, async () => {
      expect((await diagnoseRecoverableFileLock(lock)).status).toBe('active');
      await expect(fs.access(`${lock}.contenders`)).rejects.toMatchObject({ code: 'ENOENT' });
    });
    expect((await diagnoseRecoverableFileLock(lock)).status).toBe('missing');
  });
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
      ).rejects.toThrow(/Legacy lock requires confirmation/);
      expect(await repairRecoverableFileLock(lock, inspected.token!)).toBe('blocked');
      expect(await fs.readFile(lock, 'utf8')).toBe(source);
      expect(
        await repairRecoverableFileLock(lock, inspected.token!, { confirmedOwnerStopped: true }),
      ).toBe('removed');
    },
  );

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
    const read = fs.readFile.bind(fs);
    const mockedRead = vi.spyOn(fs, 'readFile').mockImplementation((async (
      file: Parameters<typeof fs.readFile>[0],
      ...args: unknown[]
    ) => {
      if (String(file) === lock) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return (read as (...args: unknown[]) => ReturnType<typeof fs.readFile>)(file, ...args);
    }) as typeof fs.readFile);
    await expect(diagnoseRecoverableFileLock(lock)).rejects.toMatchObject({ code: 'EACCES' });
    mockedRead.mockRestore();
    expect(await fs.readFile(lock, 'utf8')).toContain('dead');
  });

  it('uses a monotonic timeout when the wall clock moves backwards', async () => {
    const { lock } = await fixture();
    await withRecoverableFileLock(lock, async () => {
      let clock = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => (clock -= 100_000));
      await expect(
        withRecoverableFileLock(lock, async () => 'unsafe', { timeoutMs: 20, retryMs: 1 }),
      ).rejects.toThrow(/Timed out/);
    });
  });
  it('treats a legacy owner with no hostname as unknown even when that pid is absent locally', async () => {
    const { lock } = await fixture();
    await fs.writeFile(lock, JSON.stringify({ pid: 2_147_483_647, nonce: 'legacy', createdAt: 1 }));
    expect((await diagnoseRecoverableFileLock(lock)).status).toBe('unknown');
  });
});

describe('recoverable file lock release', () => {
  const collectWarnings = () => {
    const warnings: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      warnings.push(String(chunk));
      return true;
    });
    return warnings;
  };

  it('removes its own lock when the coordinator cannot run at release time', async () => {
    const { lock } = await fixture();
    const warnings = collectWarnings();

    await withRecoverableFileLock(
      lock,
      async () => {
        // A plain file where the coordinator expects its ticket directory makes
        // every coordinated metadata update fail, including the release.
        await fs.rm(`${lock}.contenders`, { recursive: true, force: true });
        await fs.writeFile(`${lock}.contenders`, 'not a directory');
      },
      { timeoutMs: 2_000, retryMs: 5 },
    );

    await expect(fs.access(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(warnings.join('')).toBe('');
  });

  it('keeps a lock whose metadata changed while held and reports it', async () => {
    const { lock } = await fixture();
    const warnings = collectWarnings();

    await withRecoverableFileLock(lock, async () => {
      const raw = JSON.parse(await fs.readFile(lock, 'utf8'));
      await fs.writeFile(lock, JSON.stringify({ ...raw, createdAt: raw.createdAt + 1 }));
    });

    expect(warnings.join('')).toContain('changed while held');
    expect(JSON.parse(await fs.readFile(lock, 'utf8')).nonce).toEqual(expect.any(String));
  });

  it('lets the same process acquire the lock again after a failed coordinated release', async () => {
    const { lock } = await fixture();
    const warnings = collectWarnings();
    const breakCoordinator = async () => {
      await fs.rm(`${lock}.contenders`, { recursive: true, force: true });
      await fs.writeFile(`${lock}.contenders`, 'not a directory');
    };

    await withRecoverableFileLock(lock, breakCoordinator, { timeoutMs: 2_000, retryMs: 5 });

    // The leaked lock, not the broken coordinator, is what used to deadlock the
    // retry: a live local owner is reported `active` forever and is never stale,
    // so the second acquisition waited until its own deadline. Repairing the
    // coordinator first keeps the two failures distinguishable.
    await fs.rm(`${lock}.contenders`, { force: true });
    await expect(
      withRecoverableFileLock(lock, async () => 'reacquired', { timeoutMs: 2_000, retryMs: 5 }),
    ).resolves.toBe('reacquired');
    expect(warnings.join('')).toBe('');
  });

  it('never removes a lock another owner republished while held', async () => {
    const { lock } = await fixture();
    const warnings = collectWarnings();

    await withRecoverableFileLock(lock, async () => {
      await fs.writeFile(lock, JSON.stringify(remoteOwner()));
    });

    // `release` must only remove the exact nonce it published. A foreign lock is
    // left alone even on the direct-release fallback path, and says so.
    expect(await fs.readFile(lock, 'utf8')).toContain('remote');
    expect(warnings.join('')).toContain('owned by another holder');
  });

  it('never removes a lock another owner republished while the coordinator is unusable', async () => {
    const { lock } = await fixture();
    const warnings = collectWarnings();

    await withRecoverableFileLock(
      lock,
      async () => {
        // Both hazards at once: the coordinator cannot run, so the fallback decides,
        // and another owner has republished the lock in the meantime. The fallback
        // must still remove only the exact token it published.
        await fs.rm(`${lock}.contenders`, { recursive: true, force: true });
        await fs.writeFile(`${lock}.contenders`, 'not a directory');
        await fs.writeFile(lock, JSON.stringify(remoteOwner()));
      },
      { timeoutMs: 2_000, retryMs: 5 },
    );

    expect(await fs.readFile(lock, 'utf8')).toContain('remote');
    expect(warnings.join('')).toContain('owned by another holder');
    expect(warnings.join('')).toContain('owned by another holder');
  });

  it('says nothing when the lock is already gone before release', async () => {
    const { lock } = await fixture();
    const warnings = collectWarnings();

    await withRecoverableFileLock(lock, async () => {
      // A stale-looking lock can be cleaned up by an operator while the holder is
      // still running. There is then nothing to remove and nothing to report.
      await fs.rm(lock, { force: true });
    });

    await expect(fs.access(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(warnings.join('')).toBe('');
  });

  it('keeps a lock it cannot inspect at release time and reports why', async () => {
    const { lock } = await fixture();
    const warnings = collectWarnings();
    const original = fs.readFile.bind(fs);
    const reader = vi.spyOn(fs, 'readFile');
    await expect(
      withRecoverableFileLock(lock, async () => {
        reader.mockImplementation((async (file, ...args) => {
          if (String(file) === lock)
            throw Object.assign(new Error('release metadata denied'), { code: 'EACCES' });
          return original(file, ...args);
        }) as typeof fs.readFile);
      }),
    ).rejects.toThrow('release metadata denied');
    reader.mockRestore();
    expect(await fs.readFile(lock, 'utf8')).toContain('nonce');
    expect(warnings.join('')).toBe('');
  });
});
