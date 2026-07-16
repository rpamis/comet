import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import { sha256Text } from '../../../domains/comet-native/native-hash.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativeContentSnapshot,
  parseNativeContentSnapshotManifest,
} from '../../../domains/comet-native/native-snapshot.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native VCS-independent content snapshots', () => {
  let projectRoot: string;
  let outsideRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-snapshot-'));
    outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-snapshot-outside-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    await fs.mkdir(paths.nativeRoot, { recursive: true });
  });

  afterEach(async () => {
    await Promise.all([
      fs.rm(projectRoot, { recursive: true, force: true }),
      fs.rm(outsideRoot, { recursive: true, force: true }),
    ]);
  });

  it('records only safe project-relative metadata and excludes secrets, caches, Native state, and links', async () => {
    const safe = 'export const safe = true;\n';
    await Promise.all([
      fs.mkdir(path.join(projectRoot, 'src'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, '.git'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, '.cache'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, 'node_modules', 'dep'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, 'private', 'nested'), { recursive: true }),
      fs.mkdir(path.join(paths.nativeRoot, 'runtime'), { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'src', 'app.ts'), safe),
      fs.writeFile(path.join(projectRoot, 'src', '.env.production'), 'TOKEN=secret\n'),
      fs.writeFile(path.join(projectRoot, '.env.local'), 'TOKEN=secret\n'),
      fs.writeFile(path.join(projectRoot, '.git', 'config'), 'secret\n'),
      fs.writeFile(path.join(projectRoot, '.cache', 'cache.bin'), 'secret\n'),
      fs.writeFile(path.join(projectRoot, 'node_modules', 'dep', 'index.js'), 'secret\n'),
      fs.writeFile(path.join(projectRoot, 'private', 'nested', 'key.txt'), 'secret\n'),
      fs.writeFile(path.join(paths.nativeRoot, 'runtime', 'state.json'), 'secret\n'),
      fs.writeFile(paths.configFile, 'secret\n'),
      fs.writeFile(path.join(outsideRoot, 'outside.txt'), 'secret\n'),
    ]);
    await fs.symlink(
      outsideRoot,
      path.join(projectRoot, 'linked-outside'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const manifest = await createNativeContentSnapshot(paths, {
      now: new Date('2026-07-17T00:00:00.000Z'),
      denylist: ['private'],
    });

    expect(manifest).toMatchObject({
      schema: 'comet.native.content-snapshot.v1',
      origin: 'explicit',
      createdAt: '2026-07-17T00:00:00.000Z',
      complete: true,
      omittedCount: 0,
      entries: [
        {
          path: 'src/app.ts',
          hash: sha256Text(safe),
          size: Buffer.byteLength(safe),
          type: 'file',
        },
      ],
    });
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain(outsideRoot);
    expect(serialized).not.toContain('TOKEN');
  });

  it('excludes a worktree .git file without reading or recording its gitdir target', async () => {
    await Promise.all([
      fs.writeFile(path.join(projectRoot, '.git'), 'gitdir: C:/private/worktree-metadata\n'),
      fs.writeFile(path.join(projectRoot, 'source.ts'), 'export {};\n'),
    ]);

    const manifest = await createNativeContentSnapshot(paths);

    expect(manifest.entries.map((entry) => entry.path)).toEqual(['source.ts']);
    expect(JSON.stringify(manifest)).not.toContain('worktree-metadata');
  });

  it('records an unreadable child as an omission while preserving the readable snapshot', async () => {
    const blocked = path.join(projectRoot, 'blocked.txt');
    await Promise.all([
      fs.writeFile(blocked, 'do not read\n'),
      fs.writeFile(path.join(projectRoot, 'readable.txt'), 'safe\n'),
    ]);
    const originalLstat = fs.lstat.bind(fs);
    const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (target) => {
      if (path.resolve(String(target)) === path.resolve(blocked)) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }
      return originalLstat(target);
    });
    try {
      const manifest = await createNativeContentSnapshot(paths);
      expect(manifest.complete).toBe(false);
      expect(manifest.entries.map((entry) => entry.path)).toEqual(['readable.txt']);
      expect(manifest.omitted).toContainEqual({
        path: 'blocked.txt',
        size: null,
        type: 'file',
        reason: 'unreadable',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('records a child removed after directory enumeration as changed during read', async () => {
    const removed = path.join(projectRoot, 'removed.txt');
    await fs.writeFile(removed, 'gone soon\n');
    const originalLstat = fs.lstat.bind(fs);
    const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (target) => {
      if (path.resolve(String(target)) === path.resolve(removed)) {
        throw Object.assign(new Error('file disappeared'), { code: 'ENOENT' });
      }
      return originalLstat(target);
    });
    try {
      const manifest = await createNativeContentSnapshot(paths);
      expect(manifest.complete).toBe(false);
      expect(manifest.entries).toEqual([]);
      expect(manifest.omitted).toEqual([
        {
          path: 'removed.txt',
          size: null,
          type: 'file',
          reason: 'changed-during-read',
        },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it('bounds hashing to the observed file size when a file grows after lstat', async () => {
    const growing = path.join(projectRoot, 'growing.txt');
    await fs.writeFile(growing, 'small');
    const originalLstat = fs.lstat.bind(fs);
    let grew = false;
    const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (target) => {
      const result = await originalLstat(target);
      if (!grew && path.resolve(String(target)) === path.resolve(growing)) {
        grew = true;
        await fs.appendFile(growing, Buffer.alloc(256 * 1024, 'x'));
      }
      return result;
    });
    try {
      const manifest = await createNativeContentSnapshot(paths);
      expect(manifest.entries).toEqual([]);
      expect(manifest.omitted).toEqual([
        {
          path: 'growing.txt',
          size: null,
          type: 'file',
          reason: 'changed-during-read',
        },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a file identity swap before reading from the opened handle', async () => {
    const target = path.join(projectRoot, 'target.txt');
    const outside = path.join(outsideRoot, 'outside-secret.txt');
    await fs.writeFile(target, 'project content\n');
    await fs.writeFile(outside, 'outside secret\n');
    const originalOpen = fs.open.bind(fs);
    let redirected = false;
    let readSpy: ReturnType<typeof vi.spyOn> | undefined;
    const openSpy = vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (!redirected && path.resolve(String(file)) === path.resolve(target)) {
        redirected = true;
        const handle = await originalOpen(outside, flags, mode);
        readSpy = vi.spyOn(handle, 'read');
        return handle;
      }
      return originalOpen(file, flags, mode);
    });
    try {
      const manifest = await createNativeContentSnapshot(paths);
      expect(readSpy).toBeDefined();
      expect(readSpy).not.toHaveBeenCalled();
      expect(manifest.entries).toEqual([]);
      expect(manifest.omitted).toEqual([
        {
          path: 'target.txt',
          size: null,
          type: 'file',
          reason: 'changed-during-read',
        },
      ]);
    } finally {
      openSpy.mockRestore();
    }
  });

  it('marks deterministic file-count and size budget omissions instead of silently dropping them', async () => {
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'a.txt'), '12345'),
      fs.writeFile(path.join(projectRoot, 'b.txt'), '1234'),
      fs.writeFile(path.join(projectRoot, 'c.txt'), '12'),
    ]);

    const manifest = await createNativeContentSnapshot(paths, {
      limits: { maxFiles: 1, maxFileBytes: 4, maxTotalBytes: 4 },
    });

    expect(manifest.complete).toBe(false);
    expect(manifest.entries).toEqual([
      expect.objectContaining({ path: 'b.txt', size: 4, type: 'file' }),
    ]);
    expect(manifest.omitted).toEqual([
      expect.objectContaining({ path: 'a.txt', reason: 'file-size' }),
      expect.objectContaining({ path: 'c.txt', reason: 'file-count' }),
    ]);
    expect(manifest.omittedCount).toBe(2);
  });

  it('retains a deterministic hash/ref for omissions beyond the recorded output budget', async () => {
    await Promise.all(
      Array.from({ length: 1_003 }, (_, index) =>
        fs.writeFile(
          path.join(projectRoot, `overflow-${index.toString().padStart(4, '0')}.txt`),
          'x',
        ),
      ),
    );
    const options = {
      limits: { maxFiles: 1, maxFileBytes: 1, maxTotalBytes: 1 },
    } as const;

    const first = await createNativeContentSnapshot(paths, options);
    const second = await createNativeContentSnapshot(paths, options);

    expect(first.omittedCount).toBe(1_002);
    expect(first.omitted).toHaveLength(1_000);
    expect(first.omissionOverflow).toMatchObject({
      count: 2,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      ref: expect.stringMatching(/^native-snapshot:\/\/omitted-overflow\/[a-f0-9]{64}$/u),
    });
    expect(second.omissionOverflow).toEqual(first.omissionOverflow);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('overflow-1001.txt');
    expect(serialized).not.toContain('overflow-1002.txt');
  });

  it('caps the serialized manifest and summarizes entries that do not fit', async () => {
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        fs.writeFile(
          path.join(
            projectRoot,
            `manifest-${index.toString().padStart(2, '0')}-${'x'.repeat(120)}.txt`,
          ),
          'x',
        ),
      ),
    );

    const manifest = await createNativeContentSnapshot(paths, {
      now: new Date('2026-07-17T00:00:00.000Z'),
      limits: { maxManifestBytes: 1_500 },
    });
    const serialized = JSON.stringify(manifest, null, 2) + '\n';

    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(1_500);
    expect(manifest.complete).toBe(false);
    expect(manifest.omittedCount).toBeGreaterThan(0);
    expect(manifest.omitted).toEqual([]);
    expect(manifest.omissionOverflow?.count).toBe(manifest.omittedCount);
    expect(parseNativeContentSnapshotManifest(JSON.parse(serialized))).toEqual(manifest);
  });

  it('removes a newly created change directory when baseline capture fails so retry can succeed', async () => {
    const originalReaddir = fs.readdir.bind(fs);
    let failProjectRead = true;
    const spy = vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
      if (failProjectRead && path.resolve(String(args[0])) === path.resolve(projectRoot)) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }
      return originalReaddir(...args);
    });
    try {
      await expect(
        createNativeChange({ paths, name: 'retryable-change', language: 'en' }),
      ).rejects.toMatchObject({ code: 'EACCES' });
      await expect(fs.access(nativeChangeDir(paths, 'retryable-change'))).rejects.toMatchObject({
        code: 'ENOENT',
      });

      failProjectRead = false;
      await expect(
        createNativeChange({ paths, name: 'retryable-change', language: 'en' }),
      ).resolves.toMatchObject({ name: 'retryable-change', revision: 1 });
    } finally {
      spy.mockRestore();
    }
  });
});
