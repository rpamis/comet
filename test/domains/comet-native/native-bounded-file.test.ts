import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readNativeBoundedTextFile } from '../../../domains/comet-native/native-bounded-file.js';

describe('Native bounded artifact reader', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-artifact-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects a partial Windows identity when the available inode differs', async () => {
    const file = path.join(root, 'report.md');
    await fs.writeFile(file, 'stable');
    const originalLstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      const stat = await originalLstat(...args);
      if (path.resolve(args[0].toString()) === file) {
        Object.defineProperties(stat, {
          dev: { value: 0 },
          ino: { value: stat.ino + 1_000_000 },
        });
      }
      return stat;
    });

    await expect(readNativeBoundedTextFile({ root, ref: 'report.md' })).rejects.toThrow(
      'changed while opening',
    );
  });

  it('returns only a normalized ref, bounded content identity, and UTF-8 text', async () => {
    await fs.mkdir(path.join(root, 'specs', 'auth'), { recursive: true });
    await fs.writeFile(path.join(root, 'specs', 'auth', 'spec.md'), 'hello\n');

    await expect(readNativeBoundedTextFile({ root, ref: 'specs/auth/spec.md' })).resolves.toEqual({
      ref: 'specs/auth/spec.md',
      size: 6,
      hash: createHash('sha256').update('hello\n').digest('hex'),
      text: 'hello\n',
    });
  });

  it.each(['../secret', '.env', '.git/config', 'runtime/evidence.json', 'cache/.pytest_cache/x'])(
    'rejects unsafe or sensitive ref %s',
    async (ref) => {
      await expect(readNativeBoundedTextFile({ root, ref })).rejects.toThrow(
        /normalized|sensitive/iu,
      );
    },
  );

  it('rejects size growth and path replacement while a file is open', async () => {
    await fs.writeFile(path.join(root, 'report.md'), 'old');
    await expect(
      readNativeBoundedTextFile({ root, ref: 'report.md', maxBytes: 2 }),
    ).rejects.toThrow('exceeds');

    await expect(
      readNativeBoundedTextFile({
        root,
        ref: 'report.md',
        hooks: {
          afterOpen: async () => {
            await fs.rename(path.join(root, 'report.md'), path.join(root, 'old-report.md'));
            await fs.writeFile(path.join(root, 'report.md'), 'new');
          },
        },
      }),
    ).rejects.toThrow('changed while reading');
  });

  it('detects replacement of a captured parent directory', async () => {
    const parent = path.join(root, 'nested');
    await fs.mkdir(parent);
    await fs.writeFile(path.join(parent, 'brief.md'), 'original');
    const displaced = `${parent}-displaced`;

    await expect(
      readNativeBoundedTextFile({
        root,
        ref: 'nested/brief.md',
        hooks: {
          afterParentChainCaptured: async () => {
            await fs.rename(parent, displaced);
            await fs.mkdir(parent);
            await fs.writeFile(path.join(parent, 'brief.md'), 'replacement');
          },
        },
      }),
    ).rejects.toThrow('parent changed');
  });

  it('rejects a symlink or junction in the parent chain', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-artifact-outside-'));
    try {
      await fs.writeFile(path.join(outside, 'brief.md'), 'outside');
      await fs.symlink(
        outside,
        path.join(root, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(readNativeBoundedTextFile({ root, ref: 'linked/brief.md' })).rejects.toThrow(
        /real directory|outside/iu,
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
