import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  copyNativeProtectedFile,
  readNativeProtectedDirectory,
  readNativeProtectedFile,
  removeNativeProtectedDirectory,
  removeNativeProtectedFile,
} from '../../../domains/comet-native/native-protected-file.js';

const execFileAsync = promisify(execFile);

describe('Native protected file I/O', () => {
  let sandbox: string;
  let sourceRoot: string;
  let targetRoot: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-protected-file-'));
    sourceRoot = path.join(sandbox, 'source');
    targetRoot = path.join(sandbox, 'target');
    await fs.mkdir(path.join(sourceRoot, 'nested'), { recursive: true });
    await fs.mkdir(path.join(targetRoot, 'nested'), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('reads a stable file when Windows path stats omit the device id', async () => {
    const source = path.join(sourceRoot, 'nested', 'spec.md');
    await fs.writeFile(source, 'trusted source\n');
    const originalLstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      const stat = await originalLstat(...args);
      if (path.resolve(args[0].toString()) === source) {
        Object.defineProperty(stat, 'dev', { value: 0 });
      }
      return stat;
    });

    await expect(
      readNativeProtectedFile({
        root: sourceRoot,
        file: source,
        maxBytes: 1024,
        label: 'Windows protected file',
      }),
    ).resolves.toMatchObject({
      bytes: Buffer.from('trusted source\n'),
      size: 15,
    });
  });

  it('stops protected directory enumeration at its entry budget', async () => {
    await Promise.all(
      ['one', 'two', 'three'].map((name) =>
        fs.writeFile(path.join(sourceRoot, 'nested', `${name}.txt`), name),
      ),
    );

    await expect(
      readNativeProtectedDirectory({
        root: sourceRoot,
        directory: path.join(sourceRoot, 'nested'),
        label: 'bounded directory',
        maxEntries: 2,
      }),
    ).rejects.toThrow('exceeds 2 entries');
  });

  it('fails closed when the opened source path is replaced', async () => {
    const source = path.join(sourceRoot, 'nested', 'spec.md');
    const displaced = path.join(sourceRoot, 'nested', 'spec-original.md');
    const target = path.join(targetRoot, 'nested', 'spec.md');
    await fs.writeFile(source, 'trusted source\n');

    await expect(
      copyNativeProtectedFile({
        sourceRoot,
        source,
        targetRoot,
        target,
        maxBytes: 1024,
        label: 'protected copy',
        expectedTargetHash: null,
        exclusive: true,
        hooks: {
          afterOpen: async () => {
            await fs.rename(source, displaced);
            await fs.writeFile(source, 'replacement source\n');
          },
        },
      }),
    ).rejects.toThrow(/changed while opening/u);

    await expect(fs.access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(displaced, 'utf8')).toBe('trusted source\n');
    expect(await fs.readFile(source, 'utf8')).toBe('replacement source\n');
  });

  it('fails closed when a captured source parent is replaced', async () => {
    const parent = path.join(sourceRoot, 'nested');
    const displaced = path.join(sourceRoot, 'nested-original');
    const source = path.join(parent, 'spec.md');
    const target = path.join(targetRoot, 'nested', 'spec.md');
    await fs.writeFile(source, 'trusted source\n');

    await expect(
      copyNativeProtectedFile({
        sourceRoot,
        source,
        targetRoot,
        target,
        maxBytes: 1024,
        label: 'protected parent copy',
        expectedTargetHash: null,
        exclusive: true,
        hooks: {
          afterParentChainCaptured: async () => {
            await fs.rename(parent, displaced);
            await fs.mkdir(parent);
            await fs.writeFile(path.join(parent, 'spec.md'), 'replacement source\n');
          },
        },
      }),
    ).rejects.toThrow(/parent changed during I\/O/u);

    await expect(fs.access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(displaced, 'spec.md'), 'utf8')).toBe('trusted source\n');
    expect(await fs.readFile(path.join(parent, 'spec.md'), 'utf8')).toBe('replacement source\n');
  });

  it('does not commit bytes through a replaced target parent', async () => {
    const source = path.join(sourceRoot, 'nested', 'spec.md');
    const targetParent = path.join(targetRoot, 'nested');
    const displacedTargetParent = path.join(targetRoot, 'nested-original');
    const target = path.join(targetParent, 'spec.md');
    await fs.writeFile(source, 'trusted source\n');

    await expect(
      copyNativeProtectedFile({
        sourceRoot,
        source,
        targetRoot,
        target,
        maxBytes: 1024,
        label: 'protected target copy',
        expectedTargetHash: null,
        exclusive: true,
        hooks: {
          beforeTargetCommit: async () => {
            await fs.rename(targetParent, displacedTargetParent);
            await fs.mkdir(targetParent);
          },
        },
      }),
    ).rejects.toThrow(/parent changed before commit/u);

    expect(await fs.readdir(targetParent)).toEqual([]);
    expect((await fs.readdir(displacedTargetParent)).some((entry) => entry.endsWith('.tmp'))).toBe(
      true,
    );
  });

  it('rejects a symlink or junction source without modifying its external target', async () => {
    const external = path.join(sandbox, 'external');
    const linkedParent = path.join(sourceRoot, 'linked');
    const source = path.join(linkedParent, 'secret.md');
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, 'secret.md'), 'external secret\n');
    await fs.symlink(external, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(
      readNativeProtectedFile({
        root: sourceRoot,
        file: source,
        maxBytes: 1024,
        label: 'protected symlink',
      }),
    ).rejects.toThrow(/parent must be a real directory|must be a regular file/u);
    expect(await fs.readFile(path.join(external, 'secret.md'), 'utf8')).toBe('external secret\n');
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO without blocking on open', async () => {
    const fifo = path.join(sourceRoot, 'nested', 'pipe');
    await execFileAsync('mkfifo', [fifo]);

    await expect(
      readNativeProtectedFile({
        root: sourceRoot,
        file: fifo,
        maxBytes: 1024,
        label: 'protected FIFO',
      }),
    ).rejects.toThrow(/must be a regular file/u);
  });

  it('does not recursively remove a quarantined directory that was replaced', async () => {
    const removable = path.join(targetRoot, 'removable');
    const quarantine = path.join(targetRoot, '.removable.transaction.removing');
    const displaced = path.join(targetRoot, 'removable-original');
    await fs.mkdir(removable);
    await fs.writeFile(path.join(removable, 'trusted.txt'), 'trusted\n');

    await expect(
      removeNativeProtectedDirectory({
        root: targetRoot,
        directory: removable,
        quarantine,
        label: 'protected removal',
        beforeRemove: async (quarantine) => {
          await fs.rename(quarantine, displaced);
          await fs.mkdir(quarantine);
          await fs.writeFile(path.join(quarantine, 'replacement.txt'), 'do not remove\n');
        },
      }),
    ).rejects.toThrow(/changed before removal/u);

    expect(await fs.readFile(path.join(displaced, 'trusted.txt'), 'utf8')).toBe('trusted\n');
    expect(await fs.readFile(path.join(quarantine, 'replacement.txt'), 'utf8')).toBe(
      'do not remove\n',
    );
  });

  it('does not unlink a file rewritten after its cleanup hash was verified', async () => {
    const file = path.join(targetRoot, 'nested', 'cleanup.txt');
    await fs.writeFile(file, 'trusted\n');
    const snapshot = await readNativeProtectedFile({
      root: targetRoot,
      file,
      maxBytes: 1024,
      label: 'cleanup snapshot',
    });

    await expect(
      removeNativeProtectedFile({
        root: targetRoot,
        file,
        maxBytes: 1024,
        expectedHash: snapshot.hash,
        expectedSize: snapshot.size,
        label: 'protected file removal',
        beforeRemove: async () => {
          await fs.writeFile(file, 'changed\n');
        },
      }),
    ).rejects.toThrow(/changed before removal/u);

    expect(await fs.readFile(file, 'utf8')).toBe('changed\n');
  });
});
