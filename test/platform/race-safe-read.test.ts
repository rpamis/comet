import { execFileSync } from 'node:child_process';
import { promises as fs, symlinkSync, unlinkSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RaceSafeReadError, readFileRaceSafe } from '../../platform/fs/race-safe-read.js';

// Windows note: the primitive's win32 branch opens with plain O_RDONLY
// (Node exposes no O_NOFOLLOW there) and relies on the same lstat/realpath
// identity checks that run on POSIX. That parity conclusion is covered by
// reasoning over the shared code path, not by an actual Windows test run.
describe('race-safe bounded file read', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'race-safe-read-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads a regular file within the limit and returns bytes, stat, and realPath', async () => {
    const file = path.join(root, 'data.json');
    await fs.writeFile(file, '{"ok":true}');

    const result = await readFileRaceSafe(file, 1024);

    expect(result.bytes.toString('utf8')).toBe('{"ok":true}');
    expect(result.realPath).toBe(await fs.realpath(file));
    expect(result.stat.isFile()).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a pre-existing symlink before opening it',
    async () => {
      const target = path.join(root, 'target.txt');
      await fs.writeFile(target, 'secret');
      const file = path.join(root, 'link.txt');
      await fs.symlink(target, file);

      await expect(readFileRaceSafe(file, 1024, { label: 'test file' })).rejects.toMatchObject({
        name: 'RaceSafeReadError',
        reason: 'not-regular-file',
        message: 'test file must be a regular file',
      });
    },
  );

  it('rejects a directory path', async () => {
    const dir = path.join(root, 'subdir');
    await fs.mkdir(dir);

    await expect(readFileRaceSafe(dir, 1024)).rejects.toMatchObject({
      reason: 'not-regular-file',
    });
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO without blocking on open', async () => {
    const file = path.join(root, 'pipe');
    execFileSync('mkfifo', [file]);

    await expect(readFileRaceSafe(file, 1024)).rejects.toMatchObject({
      reason: 'not-regular-file',
    });
  });

  it('rejects a file over the byte limit before reading past it', async () => {
    const file = path.join(root, 'big.txt');
    await fs.writeFile(file, 'x'.repeat(1025));

    await expect(readFileRaceSafe(file, 1024, { label: 'test file' })).rejects.toMatchObject({
      reason: 'too-large',
      message: 'test file exceeds 1024 bytes',
    });
  });

  it('propagates ENOENT with its original code for missing files', async () => {
    const error = await readFileRaceSafe(path.join(root, 'missing.txt'), 1024).catch(
      (caught: unknown) => caught as NodeJS.ErrnoException,
    );

    expect(error.code).toBe('ENOENT');
  });

  it('calls verify at pre-open, post-open, and post-read with a stable context', async () => {
    const file = path.join(root, 'data.txt');
    await fs.writeFile(file, 'content');
    const checkpoints: string[] = [];

    await readFileRaceSafe(file, 1024, {
      verify: (checkpoint, context) => {
        checkpoints.push(checkpoint);
        expect(context.realPath.length).toBeGreaterThan(0);
        expect(context.identity.ino).not.toBe(undefined);
      },
    });

    expect(checkpoints).toEqual(['pre-open', 'post-open', 'post-read']);
  });

  it('aborts the read when verify throws at a checkpoint', async () => {
    const file = path.join(root, 'data.txt');
    await fs.writeFile(file, 'content');

    await expect(
      readFileRaceSafe(file, 1024, {
        verify: (checkpoint) => {
          if (checkpoint === 'post-open') throw new Error('chain violated');
        },
      }),
    ).rejects.toThrow('chain violated');
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a same-path replacement made while the file is open',
    async () => {
      const file = path.join(root, 'data.txt');
      await fs.writeFile(file, 'original');
      const replacement = path.join(root, 'replacement.txt');
      await fs.writeFile(replacement, 'replaced');

      await expect(
        readFileRaceSafe(file, 1024, {
          label: 'test file',
          hooks: {
            afterOpen: async () => {
              await fs.rename(replacement, file);
            },
          },
        }),
      ).rejects.toMatchObject({
        reason: 'changed',
        message: 'test file changed while reading',
      });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'does not follow a symlink swapped in after the pre-open check',
    async () => {
      const file = path.join(root, 'data.txt');
      await fs.writeFile(file, 'original');
      const outside = path.join(root, 'outside.txt');
      await fs.writeFile(outside, 'outside-content');

      // Start the read (its first lstat is dispatched asynchronously), then swap
      // in a symlink synchronously before yielding back to the event loop.
      const pending = readFileRaceSafe(file, 1024);
      unlinkSync(file);
      symlinkSync(outside, file);

      const result = await pending.catch((error: unknown) => error as Error);
      if (result instanceof Error) {
        expect(result.message).toMatch(/regular file|changed|ENOENT/);
      } else {
        expect(result.bytes.toString('utf8')).not.toBe('outside-content');
      }
    },
  );

  it('enforces the byte limit against growth through the same descriptor after open', async () => {
    const file = path.join(root, 'grow.txt');
    await fs.writeFile(file, 'start');

    await expect(
      readFileRaceSafe(file, 1024, {
        hooks: {
          afterOpen: async () => {
            await fs.appendFile(file, 'x'.repeat(2048));
          },
        },
      }),
    ).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('returns BigIntStats precision when bigint mode is requested', async () => {
    const file = path.join(root, 'data.txt');
    await fs.writeFile(file, 'content');

    const result = await readFileRaceSafe(file, 1024, { bigint: true });

    expect(typeof (result.stat as import('fs').BigIntStats).mtimeNs).toBe('bigint');
    expect(typeof result.stat.size).toBe('bigint');
    expect(result.bytes.toString('utf8')).toBe('content');
  });

  it('exposes RaceSafeReadError as an Error subclass with a stable name', async () => {
    const file = path.join(root, 'big.txt');
    await fs.writeFile(file, 'x'.repeat(2));

    const error = await readFileRaceSafe(file, 1, {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RaceSafeReadError);
    expect(error).toBeInstanceOf(Error);
  });
});
