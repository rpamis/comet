import { promises as fs } from 'fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'os';
import path from 'path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import { sha256Text } from '../../../domains/comet-native/native-hash.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativeContentSnapshot,
  filterNativeContentSnapshotToProjectScope,
  inspectNativeContentSnapshotHealth,
  parseNativeContentSnapshotManifest,
} from '../../../domains/comet-native/native-snapshot.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

const execFileAsync = promisify(execFile);

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
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await Promise.all([
      fs.mkdir(path.join(projectRoot, 'src'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, '.cache'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, 'node_modules', 'dep'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, 'private', 'nested'), { recursive: true }),
      fs.mkdir(path.join(paths.nativeRoot, 'runtime'), { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'src', 'app.ts'), safe),
      fs.writeFile(path.join(projectRoot, 'src', '.env.production'), 'TOKEN=secret\n'),
      fs.writeFile(path.join(projectRoot, '.env.local'), 'TOKEN=secret\n'),
      fs.writeFile(path.join(projectRoot, '.gitignore'), '.cache/\nnode_modules/\n'),
      fs.writeFile(path.join(projectRoot, '.cache', 'cache.bin'), 'secret\n'),
      fs.writeFile(path.join(projectRoot, 'node_modules', 'dep', 'index.js'), 'secret\n'),
      fs.writeFile(path.join(projectRoot, 'private', 'nested', 'key.txt'), 'secret\n'),
      fs.writeFile(path.join(paths.nativeRoot, 'runtime', 'state.json'), 'secret\n'),
      fs.writeFile(paths.configFile, 'secret\n'),
      fs.writeFile(path.join(projectRoot, '.comet', 'current-change.json'), 'selection\n'),
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
    });
    expect(manifest.entries).toContainEqual(
      expect.objectContaining({ path: '.gitignore', type: 'file' }),
    );
    expect(manifest.entries).toContainEqual({
      path: 'src/app.ts',
      hash: sha256Text(safe),
      size: Buffer.byteLength(safe),
      type: 'file',
    });
    if (process.platform !== 'win32') {
      expect(manifest.entries).toContainEqual({
        path: 'linked-outside',
        hash: createHash('sha256').update('symlink\0').update(outsideRoot).digest('hex'),
        size: Buffer.byteLength(outsideRoot),
        type: 'file',
      });
    }
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain(outsideRoot);
    expect(serialized).not.toContain('TOKEN');
  });

  it('fails closed when a discovered worktree .git file cannot be resolved', async () => {
    await Promise.all([
      fs.writeFile(path.join(projectRoot, '.git'), 'gitdir: C:/private/worktree-metadata\n'),
      fs.writeFile(path.join(projectRoot, 'source.ts'), 'export {};\n'),
    ]);

    await expect(createNativeContentSnapshot(paths)).rejects.toThrow(
      'Native Git snapshot provider could not inspect the repository boundary',
    );
  });

  it('fails closed after repository detection when a required Git listing probe fails', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await fs.writeFile(path.join(projectRoot, 'source.ts'), 'export {};\n');
    await fs.writeFile(path.join(projectRoot, '.git', 'index'), 'not a git index');

    await expect(createNativeContentSnapshot(paths)).rejects.toThrow(
      'Native Git snapshot provider failed after repository detection',
    );
  });

  it.runIf(process.platform !== 'win32')(
    'fails closed when Git owns a path that the portable manifest cannot represent',
    async () => {
      await execFileAsync('git', ['init'], { cwd: projectRoot });
      const unsafeName = 'unsafe\\name.ts';
      await fs.writeFile(path.join(projectRoot, unsafeName), 'export {};\n');
      await execFileAsync('git', ['add', '--', unsafeName], { cwd: projectRoot });

      await expect(createNativeContentSnapshot(paths)).rejects.toThrow(
        'Native Git snapshot provider returned an unsafe staged path',
      );
    },
  );

  it('uses Git tracked and non-ignored untracked files without expanding ignored or nested repositories', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await Promise.all([
      fs.mkdir(path.join(projectRoot, 'src'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, 'coverage'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, '.idea'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, 'vendor', 'nested'), { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(path.join(projectRoot, '.gitignore'), 'coverage/\n.idea/\n'),
      fs.writeFile(path.join(projectRoot, 'src', 'tracked.ts'), 'tracked\n'),
      fs.writeFile(path.join(projectRoot, 'src', 'untracked.ts'), 'untracked\n'),
      fs.writeFile(path.join(projectRoot, 'coverage', 'noise.json'), 'ignored\n'),
      fs.writeFile(path.join(projectRoot, '.idea', 'workspace.xml'), 'ignored\n'),
      fs.writeFile(path.join(projectRoot, 'vendor', 'nested', 'payload.txt'), 'nested\n'),
    ]);
    await execFileAsync('git', ['add', '.gitignore', 'src/tracked.ts'], { cwd: projectRoot });
    await execFileAsync('git', ['init'], { cwd: path.join(projectRoot, 'vendor', 'nested') });

    const manifest = await createNativeContentSnapshot(paths);

    expect(manifest.capture).toEqual({ provider: 'git' });
    expect(manifest.entries.map((entry) => entry.path)).toEqual([
      '.gitignore',
      'src/tracked.ts',
      'src/untracked.ts',
    ]);
    expect(JSON.stringify(manifest)).not.toContain('noise.json');
    expect(JSON.stringify(manifest)).not.toContain('workspace.xml');
    expect(JSON.stringify(manifest)).not.toContain('payload.txt');
  });

  it('unions a path staged after combined selection and marks the index race incomplete', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    const latePath = path.join(projectRoot, 'late-staged.ts');

    const manifest = await createNativeContentSnapshot(paths, {
      gitSelectionHooks: {
        afterCombined: async () => {
          await fs.writeFile(latePath, 'export const late = true;\n');
          await execFileAsync('git', ['add', 'late-staged.ts'], { cwd: projectRoot });
        },
      },
    });

    expect(manifest.entries.map((entry) => entry.path)).toContain('late-staged.ts');
    expect(manifest.omitted).toContainEqual({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'git-selection-changed',
    });
    expect(manifest.capture?.gitSelection).toMatchObject({
      schema: 'comet.native.git-selection.v1',
      status: 'changed',
      stageBefore: { overflow: false, recordCount: 0, storedRecordCount: 0 },
      stageAfter: { overflow: false, recordCount: 1, storedRecordCount: 1 },
    });
    expect(manifest.complete).toBe(false);

    expect(() =>
      parseNativeContentSnapshotManifest({
        ...manifest,
        capture: { provider: 'git' },
      }),
    ).toThrow(/selection-change omission and selection evidence are inconsistent/iu);
    expect(() =>
      parseNativeContentSnapshotManifest({
        ...manifest,
        complete: true,
        omitted: [],
        omittedCount: 0,
      }),
    ).toThrow(/selection-change omission and selection evidence are inconsistent/iu);
  });

  it('does not change a complete snapshot when an existing worktree change is only staged', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await fs.writeFile(path.join(projectRoot, 'worktree-change.ts'), 'export const value = 1;\n');
    const options = { now: new Date('2026-07-17T00:00:00.000Z') } as const;

    const beforeStaging = await createNativeContentSnapshot(paths, options);
    await execFileAsync('git', ['add', 'worktree-change.ts'], { cwd: projectRoot });
    const afterStaging = await createNativeContentSnapshot(paths, options);

    expect(beforeStaging.complete).toBe(true);
    expect(afterStaging).toEqual(beforeStaging);
    expect(afterStaging.capture).toEqual({ provider: 'git' });
  });

  it('marks a path created after the initial Git selection as an incomplete selection change', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });

    const manifest = await createNativeContentSnapshot(paths, {
      gitSelectionHooks: {
        afterInitialSelection: async () => {
          await fs.writeFile(path.join(projectRoot, 'created-after-selection.ts'), 'late\n');
        },
      },
    });

    expect(manifest.entries).toEqual([]);
    expect(manifest.omitted).toContainEqual({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'git-selection-changed',
    });
    expect(manifest.capture?.gitSelection).toMatchObject({
      status: 'changed',
      combined: { recordCount: 0 },
      finalCombined: { recordCount: 1 },
    });
    expect(manifest.complete).toBe(false);
  });

  it('removes a file changed after its first hash during final content revalidation', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'a-first.txt'), 'first\n'),
      fs.writeFile(path.join(projectRoot, 'z-last.txt'), 'last\n'),
    ]);

    const manifest = await createNativeContentSnapshot(paths, {
      gitSelectionHooks: {
        afterFirstEntryCaptured: async (relative) => {
          expect(relative).toBe('a-first.txt');
          await fs.writeFile(path.join(projectRoot, relative), 'changed after capture\n');
        },
      },
    });

    expect(manifest.entries.map((entry) => entry.path)).toEqual(['z-last.txt']);
    expect(manifest.omitted).toContainEqual({
      path: 'a-first.txt',
      size: Buffer.byteLength('changed after capture\n'),
      type: 'file',
      reason: 'changed-during-read',
    });
    expect(manifest.capture).toEqual({ provider: 'git' });
    expect(manifest.complete).toBe(false);
  });

  it('keeps the root selection-change omission recorded when compacting the manifest', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    const files = Array.from(
      { length: 30 },
      (_, index) => `selection-${String(index).padStart(2, '0')}-${'x'.repeat(80)}.txt`,
    );
    await Promise.all(files.map((file) => fs.writeFile(path.join(projectRoot, file), 'xx')));

    const manifest = await createNativeContentSnapshot(paths, {
      limits: { maxFileBytes: 1, maxManifestBytes: 3_000 },
      gitSelectionHooks: {
        afterCombined: async () => {
          await execFileAsync('git', ['add', files[0]!], { cwd: projectRoot });
        },
      },
    });

    expect(manifest.omitted).toContainEqual({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'git-selection-changed',
    });
    expect(manifest.capture?.gitSelection?.status).toBe('changed');
    expect(manifest.omissionOverflow?.count).toBeGreaterThan(0);
    expect(Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`)).toBeLessThanOrEqual(3_000);
    expect(parseNativeContentSnapshotManifest(manifest)).toEqual(manifest);
  });

  it.each([
    ['record', { maxRecords: 2, maxBytes: 1_024, maxRecordBytes: 512 }],
    ['byte', { maxRecords: 100, maxBytes: 16, maxRecordBytes: 16 }],
  ] as const)(
    'turns Git %s-budget overflow into a bounded incomplete omission',
    async (_budget, gitSelectionLimits) => {
      await execFileAsync('git', ['init'], { cwd: projectRoot });
      await Promise.all([
        fs.writeFile(path.join(projectRoot, 'selection-a.txt'), 'a'),
        fs.writeFile(path.join(projectRoot, 'selection-b.txt'), 'b'),
        fs.writeFile(path.join(projectRoot, 'selection-c.txt'), 'c'),
      ]);

      const manifest = await createNativeContentSnapshot(paths, { gitSelectionLimits });

      expect(manifest.omitted).toContainEqual({
        path: '.',
        size: null,
        type: 'directory',
        reason: 'git-enumeration-limit',
      });
      expect(manifest.omittedCount).toBeGreaterThan(1);
      expect(manifest.omissionOverflow).toMatchObject({
        count: manifest.omittedCount - manifest.omitted.length,
        hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(manifest.capture?.gitSelection).toMatchObject({
        schema: 'comet.native.git-selection.v1',
        status: 'overflow',
        combined: {
          overflow: true,
          recordCount: 3,
          hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      });
      expect(manifest.complete).toBe(false);

      await fs.rename(
        path.join(projectRoot, 'selection-c.txt'),
        path.join(projectRoot, 'selection-d.txt'),
      );
      const changedTail = await createNativeContentSnapshot(paths, { gitSelectionLimits });
      expect(changedTail.capture?.gitSelection?.combined.hash).not.toBe(
        manifest.capture?.gitSelection?.combined.hash,
      );
      expect(changedTail.omissionOverflow?.hash).not.toBe(manifest.omissionOverflow?.hash);
      expect(parseNativeContentSnapshotManifest(manifest)).toEqual(manifest);

      expect(() =>
        parseNativeContentSnapshotManifest({
          ...manifest,
          capture: { provider: 'git' },
        }),
      ).toThrow(/enumeration omission and selection evidence are inconsistent/iu);
      expect(() =>
        parseNativeContentSnapshotManifest({
          ...manifest,
          omitted: manifest.omitted.filter(
            (omission) => omission.reason !== 'git-enumeration-limit',
          ),
          omittedCount: manifest.omittedCount - 1,
        }),
      ).toThrow(/enumeration omission and selection evidence are inconsistent/iu);
    },
  );

  it('keeps byte-budget selection evidence stable across stdout chunk segmentation', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'selection-a.txt'), 'a'),
      fs.writeFile(path.join(projectRoot, 'selection-b.txt'), 'b'),
      fs.writeFile(path.join(projectRoot, 'selection-c.txt'), 'c'),
    ]);
    const baseOptions = {
      now: new Date('2026-07-17T00:00:00.000Z'),
      gitSelectionLimits: { maxRecords: 100, maxBytes: 16, maxRecordBytes: 16 },
    } as const;

    const byteChunks = await createNativeContentSnapshot(paths, {
      ...baseOptions,
      gitSelectionHooks: { outputChunkBytes: 1 },
    });
    const largeChunks = await createNativeContentSnapshot(paths, {
      ...baseOptions,
      gitSelectionHooks: { outputChunkBytes: 1_024 },
    });

    expect(byteChunks.capture?.gitSelection?.status).toBe('overflow');
    expect(byteChunks.capture?.gitSelection?.combined.storedRecordCount).toBe(1);
    expect(largeChunks).toEqual(byteChunks);
  });

  it.runIf(process.platform !== 'win32')(
    'hashes a Git-owned symlink target string without following the target',
    async () => {
      await execFileAsync('git', ['init'], { cwd: projectRoot });
      const firstOutside = path.join(outsideRoot, 'first-secret.txt');
      const secondOutside = path.join(outsideRoot, 'second-secret.txt');
      const link = path.join(projectRoot, 'external-link.txt');
      await Promise.all([
        fs.writeFile(firstOutside, 'first secret contents\n'),
        fs.writeFile(secondOutside, 'second secret contents\n'),
      ]);
      await fs.symlink(firstOutside, link, 'file');
      await execFileAsync('git', ['add', 'external-link.txt'], { cwd: projectRoot });
      const first = await createNativeContentSnapshot(paths);

      await fs.rename(link, path.join(outsideRoot, 'old-link'));
      await fs.symlink(secondOutside, link, 'file');
      const second = await createNativeContentSnapshot(paths);

      expect(first.complete).toBe(true);
      expect(second.complete).toBe(true);
      expect(first.entries).toHaveLength(1);
      expect(second.entries).toHaveLength(1);
      expect(second.entries[0]?.hash).not.toBe(first.entries[0]?.hash);
      expect(JSON.stringify([first, second])).not.toContain(outsideRoot);
      expect(JSON.stringify([first, second])).not.toContain('secret contents');

      const changedAfterCapture = await createNativeContentSnapshot(paths, {
        gitSelectionHooks: {
          afterFirstEntryCaptured: async () => {
            await fs.unlink(link);
            await fs.symlink(firstOutside, link, 'file');
          },
        },
      });
      expect(changedAfterCapture.entries).toEqual([]);
      expect(changedAfterCapture.omitted).toContainEqual({
        path: 'external-link.txt',
        size: null,
        type: 'other',
        reason: 'changed-during-read',
      });
    },
  );

  it('captures the working-tree gitlink HEAD and detects an unstaged pointer change', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    const gitlinkRoot = path.join(projectRoot, 'website');
    await fs.mkdir(gitlinkRoot, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: gitlinkRoot });
    await fs.writeFile(path.join(gitlinkRoot, 'page.md'), 'first\n');
    await execFileAsync('git', ['add', 'page.md'], { cwd: gitlinkRoot });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet@example.test',
        'commit',
        '-m',
        'first',
      ],
      { cwd: gitlinkRoot },
    );
    await execFileAsync('git', ['add', 'website'], { cwd: projectRoot });
    const firstHead = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: gitlinkRoot })
    ).stdout.trim();
    const first = await createNativeContentSnapshot(paths);

    await fs.writeFile(path.join(gitlinkRoot, 'page.md'), 'second\n');
    await execFileAsync('git', ['add', 'page.md'], { cwd: gitlinkRoot });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet@example.test',
        'commit',
        '-m',
        'second',
      ],
      { cwd: gitlinkRoot },
    );
    const secondHead = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: gitlinkRoot })
    ).stdout.trim();
    const second = await createNativeContentSnapshot(paths);

    expect(secondHead).not.toBe(firstHead);
    expect(first.entries.find((entry) => entry.path === 'website')?.hash).toBe(
      sha256Text(`gitlink:${firstHead}`),
    );
    expect(second.entries.find((entry) => entry.path === 'website')?.hash).toBe(
      sha256Text(`gitlink:${secondHead}`),
    );
    expect(second.entries.find((entry) => entry.path === 'website')?.hash).not.toBe(
      first.entries.find((entry) => entry.path === 'website')?.hash,
    );

    const dirtiedAfterCapture = await createNativeContentSnapshot(paths, {
      gitSelectionHooks: {
        afterFirstEntryCaptured: async (relative) => {
          expect(relative).toBe('website');
          await fs.writeFile(path.join(gitlinkRoot, 'page.md'), 'dirty after capture\n');
        },
      },
    });
    expect(dirtiedAfterCapture.entries).toEqual([]);
    expect(dirtiedAfterCapture.omitted).toContainEqual({
      path: 'website',
      size: null,
      type: 'directory',
      reason: 'gitlink-dirty',
    });

    await fs.writeFile(path.join(gitlinkRoot, 'page.md'), 'dirty working tree\n');
    const dirty = await createNativeContentSnapshot(paths);
    expect(dirty.entries.find((entry) => entry.path === 'website')).toBeUndefined();
    expect(dirty.omitted).toContainEqual({
      path: 'website',
      size: null,
      type: 'directory',
      reason: 'gitlink-dirty',
    });
    expect(dirty.complete).toBe(false);
  });

  it('marks an uninitialized gitlink checkout as an explicit incomplete omission', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    const gitlinkRoot = path.join(projectRoot, 'website');
    await fs.mkdir(gitlinkRoot, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: gitlinkRoot });
    await fs.writeFile(path.join(gitlinkRoot, 'page.md'), 'page\n');
    await execFileAsync('git', ['add', 'page.md'], { cwd: gitlinkRoot });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet@example.test',
        'commit',
        '-m',
        'fixture',
      ],
      { cwd: gitlinkRoot },
    );
    await execFileAsync('git', ['add', 'website'], { cwd: projectRoot });
    await fs.rename(gitlinkRoot, path.join(outsideRoot, 'website-checkout'));
    await fs.mkdir(gitlinkRoot);

    const manifest = await createNativeContentSnapshot(paths);

    expect(manifest.entries.find((entry) => entry.path === 'website')).toBeUndefined();
    expect(manifest).toMatchObject({
      complete: false,
      omitted: [
        {
          path: 'website',
          size: null,
          type: 'directory',
          reason: 'gitlink-unavailable',
        },
      ],
      omittedCount: 1,
    });
  });

  it('retains physical-tree capture as the non-Git fallback', async () => {
    await Promise.all([
      fs.writeFile(path.join(projectRoot, '.gitignore'), 'ignored.log\n'),
      fs.writeFile(path.join(projectRoot, 'ignored.log'), 'fallback content\n'),
    ]);

    const manifest = await createNativeContentSnapshot(paths);

    expect(manifest.capture).toEqual({ provider: 'physical-tree' });
    expect(manifest.entries.map((entry) => entry.path)).toEqual(['.gitignore', 'ignored.log']);
  });

  it.runIf(process.platform !== 'win32')(
    'captures a stable physical-tree symlink by its raw target without following it',
    async () => {
      const outside = path.join(outsideRoot, 'physical-secret.txt');
      const link = path.join(projectRoot, 'physical-link.txt');
      await fs.writeFile(outside, 'outside secret contents\n');
      await fs.symlink(outside, link, 'file');

      const manifest = await createNativeContentSnapshot(paths);

      expect(manifest.complete).toBe(true);
      expect(manifest.capture).toEqual({ provider: 'physical-tree' });
      expect(manifest.entries).toEqual([
        {
          path: 'physical-link.txt',
          hash: createHash('sha256').update('symlink\0').update(outside).digest('hex'),
          size: Buffer.byteLength(outside),
          type: 'file',
        },
      ]);
      expect(JSON.stringify(manifest)).not.toContain('outside secret contents');
    },
  );

  it('marks a physical directory node-budget overflow as hard incomplete evidence', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        fs.writeFile(path.join(projectRoot, `many-${String(index).padStart(2, '0')}.txt`), 'x'),
      ),
    );

    const manifest = await createNativeContentSnapshot(paths, {
      physicalSelectionLimits: { maxNodes: 3, maxBytes: 1_024, maxPathBytes: 512 },
    });

    expect(manifest.entries).toEqual([]);
    expect(manifest.omitted).toContainEqual({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'physical-enumeration-limit',
    });
    expect(manifest.capture?.physicalSelection).toMatchObject({
      schema: 'comet.native.physical-selection.v1',
      status: 'overflow',
      before: { overflow: true, storedRecordCount: 0 },
      after: { overflow: true, storedRecordCount: 0 },
    });
    expect(manifest.complete).toBe(false);
    expect(parseNativeContentSnapshotManifest(manifest)).toEqual(manifest);
    expect(() =>
      parseNativeContentSnapshotManifest({
        ...manifest,
        capture: { provider: 'physical-tree' },
      }),
    ).toThrow(/physical enumeration omission and evidence are inconsistent/iu);
    expect(() =>
      parseNativeContentSnapshotManifest({
        ...manifest,
        complete: true,
        omitted: [],
        omittedCount: 0,
      }),
    ).toThrow(/physical enumeration omission and evidence are inconsistent/iu);
  });

  it('detects an a-to-z move during physical enumeration with an order-independent fence', async () => {
    await fs.writeFile(path.join(projectRoot, 'a.txt'), 'moving\n');
    let moved = false;

    const manifest = await createNativeContentSnapshot(paths, {
      physicalSelectionHooks: {
        afterNode: async (relative) => {
          if (moved || relative !== 'a.txt') return;
          moved = true;
          await fs.rename(path.join(projectRoot, 'a.txt'), path.join(projectRoot, 'z.txt'));
        },
      },
    });

    expect(moved).toBe(true);
    expect(manifest.omitted).toContainEqual({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'physical-selection-changed',
    });
    expect(manifest.capture?.physicalSelection?.status).toBe('changed');
    expect(manifest.complete).toBe(false);
  });

  it('keeps physical selection hashes stable when opendir yields the same nodes in reverse order', async () => {
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'one.txt'), 'one\n'),
      fs.writeFile(path.join(projectRoot, 'two.txt'), 'two\n'),
    ]);
    const originalOpendir = fs.opendir.bind(fs);
    let reverse = false;
    const spy = vi.spyOn(fs, 'opendir').mockImplementation(async (directory, options) => {
      if (path.resolve(String(directory)) !== path.resolve(projectRoot)) {
        return originalOpendir(directory, options);
      }
      const children = await fs.readdir(projectRoot, { withFileTypes: true });
      if (reverse) children.reverse();
      let index = 0;
      return {
        read: async () => children[index++] ?? null,
        close: async () => undefined,
      } as unknown as Awaited<ReturnType<typeof fs.opendir>>;
    });
    const snapshotOptions = {
      now: new Date('2026-07-17T00:00:00.000Z'),
      physicalSelectionHooks: {
        afterInitialSelection: async () => {
          await fs.writeFile(path.join(projectRoot, 'late.txt'), 'late\n');
        },
      },
    } as const;
    try {
      const forward = await createNativeContentSnapshot(paths, snapshotOptions);
      await fs.rm(path.join(projectRoot, 'late.txt'));
      reverse = true;
      const backward = await createNativeContentSnapshot(paths, snapshotOptions);

      expect(forward.capture?.physicalSelection?.status).toBe('changed');
      expect(backward.capture?.physicalSelection?.before.hash).toBe(
        forward.capture?.physicalSelection?.before.hash,
      );
      expect(backward.capture?.physicalSelection?.after.hash).toBe(
        forward.capture?.physicalSelection?.after.hash,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('turns an exhausted physical execution budget into bounded root evidence', async () => {
    await fs.writeFile(path.join(projectRoot, 'deadline.txt'), 'deadline\n');
    const startedAt = Date.now();

    const manifest = await createNativeContentSnapshot(paths, {
      deadlineMs: 20,
      physicalSelectionHooks: {
        afterInitialSelection: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
        },
      },
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(manifest.omitted).toContainEqual({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'physical-enumeration-limit',
    });
    expect(manifest.capture?.physicalSelection).toBeDefined();
    expect(manifest.complete).toBe(false);
  });

  it('marks physical selection overflow when a filesystem operation crosses its execution budget', async () => {
    const delayedPath = path.join(projectRoot, 'deadline-io.txt');
    await fs.writeFile(delayedPath, 'deadline\n');
    const originalLstat = fs.lstat.bind(fs);
    let delayed = false;
    const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (!delayed && path.resolve(String(args[0])) === path.resolve(delayedPath)) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return originalLstat(...args);
    });
    try {
      const manifest = await createNativeContentSnapshot(paths, { deadlineMs: 100 });

      expect(delayed).toBe(true);
      expect(manifest.omitted).toContainEqual({
        path: '.',
        size: null,
        type: 'directory',
        reason: 'physical-enumeration-limit',
      });
      expect(manifest.capture?.physicalSelection).toBeDefined();
      expect(manifest.complete).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('cannot report a complete physical fence when its final opendir crosses the execution budget', async () => {
    await fs.writeFile(path.join(projectRoot, 'final-fence.txt'), 'fenced\n');
    const originalOpendir = fs.opendir.bind(fs);
    let rootOpenCount = 0;
    const spy = vi.spyOn(fs, 'opendir').mockImplementation(async (...args) => {
      if (path.resolve(String(args[0])) === path.resolve(projectRoot)) {
        rootOpenCount += 1;
        if (rootOpenCount === 2) {
          await new Promise((resolve) => setTimeout(resolve, 650));
        }
      }
      return originalOpendir(...args);
    });
    try {
      const manifest = await createNativeContentSnapshot(paths, { deadlineMs: 500 });

      expect(rootOpenCount).toBe(2);
      expect(manifest.omitted).toContainEqual({
        path: '.',
        size: null,
        type: 'directory',
        reason: 'physical-enumeration-limit',
      });
      expect(manifest.capture?.physicalSelection?.after.overflow).toBe(true);
      expect(manifest.complete).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('stops physical file capture after realpath crosses the execution budget', async () => {
    const target = path.join(projectRoot, 'capture-budget.txt');
    await fs.writeFile(target, 'capture\n');
    const originalRealpath = fs.realpath.bind(fs);
    const originalOpen = fs.open.bind(fs);
    let delayed = false;
    let targetOpenCount = 0;
    const realpathSpy = vi.spyOn(fs, 'realpath').mockImplementation(async (...args) => {
      if (!delayed && path.resolve(String(args[0])) === path.resolve(target)) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
      return originalRealpath(...args);
    });
    const openSpy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (path.resolve(String(args[0])) === path.resolve(target)) targetOpenCount += 1;
      return originalOpen(...args);
    });
    try {
      const manifest = await createNativeContentSnapshot(paths, { deadlineMs: 500 });

      expect(delayed).toBe(true);
      expect(targetOpenCount).toBe(0);
      expect(manifest.omitted).toContainEqual({
        path: '.',
        size: null,
        type: 'directory',
        reason: 'physical-enumeration-limit',
      });
      expect(manifest.complete).toBe(false);
    } finally {
      realpathSpy.mockRestore();
      openSpy.mockRestore();
    }
  });

  it('stops physical revalidation after one entry crosses the execution budget', async () => {
    const relativePaths = ['a-revalidate.txt', 'z-revalidate.txt'];
    await Promise.all(
      relativePaths.map((relative) => fs.writeFile(path.join(projectRoot, relative), relative)),
    );
    const originalRealpath = fs.realpath.bind(fs);
    const realpathCalls = new Map<string, number>();
    let firstCaptured: string | null = null;
    let delayed = false;
    const spy = vi.spyOn(fs, 'realpath').mockImplementation(async (...args) => {
      const target = path.resolve(String(args[0]));
      const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
      if (relativePaths.includes(relative)) {
        realpathCalls.set(relative, (realpathCalls.get(relative) ?? 0) + 1);
        if (!delayed && relative === firstCaptured) {
          delayed = true;
          await new Promise((resolve) => setTimeout(resolve, 650));
        }
      }
      return originalRealpath(...args);
    });
    try {
      const manifest = await createNativeContentSnapshot(paths, {
        deadlineMs: 500,
        gitSelectionHooks: {
          afterFirstEntryCaptured: (relative) => {
            firstCaptured = relative;
          },
        },
      });

      expect(delayed).toBe(true);
      const notRevalidated = relativePaths.find((relative) => relative !== firstCaptured);
      expect(notRevalidated).toBeDefined();
      expect(realpathCalls.get(notRevalidated!)).toBe(2);
      expect(manifest.omitted).toContainEqual({
        path: '.',
        size: null,
        type: 'directory',
        reason: 'physical-enumeration-limit',
      });
      expect(manifest.complete).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('shares one execution deadline across consecutive Git commands', async () => {
    await fs.mkdir(path.join(projectRoot, '.git'));
    const fakeGit = path.join(outsideRoot, 'delayed-git.cjs');
    await fs.writeFile(
      fakeGit,
      [
        'const args = process.argv.slice(2);',
        'setTimeout(() => {',
        "  if (args.includes('--is-inside-work-tree')) process.stdout.write('true\\n');",
        '}, 100);',
      ].join('\n'),
    );
    const startedAt = Date.now();

    await expect(
      createNativeContentSnapshot(paths, {
        deadlineMs: 250,
        gitProcess: { command: process.execPath, argsPrefix: [fakeGit] },
      }),
    ).rejects.toMatchObject({ code: 'GIT_SNAPSHOT_TIMEOUT' });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('propagates a Git status timeout instead of converting it into a gitlink omission', async () => {
    await Promise.all([
      fs.mkdir(path.join(projectRoot, '.git')),
      fs.mkdir(path.join(projectRoot, 'module')),
    ]);
    const fakeGit = path.join(outsideRoot, 'gitlink-status-git.cjs');
    const objectId = 'a'.repeat(40);
    await fs.writeFile(
      fakeGit,
      [
        'const args = process.argv.slice(2);',
        "if (args.includes('status')) {",
        '  setInterval(() => {}, 1000);',
        "} else if (args.includes('--is-inside-work-tree')) {",
        "  process.stdout.write('true\\n');",
        "} else if (args.includes('--stage')) {",
        "  process.stdout.write('160000 " + objectId + " 0\\tmodule\\0');",
        "} else if (args.includes('--cached')) {",
        "  process.stdout.write('module\\0');",
        "} else if (args.includes('--verify')) {",
        "  process.stdout.write('" + objectId + "\\n');",
        '} else {',
        '  process.exitCode = 1;',
        '}',
      ].join('\n'),
    );

    await expect(
      createNativeContentSnapshot(paths, {
        deadlineMs: 750,
        gitProcess: { command: process.execPath, argsPrefix: [fakeGit] },
      }),
    ).rejects.toMatchObject({ code: 'GIT_SNAPSHOT_TIMEOUT' });
  });

  it('terminates a hanging Git process tree at the shared snapshot deadline', async () => {
    await fs.mkdir(path.join(projectRoot, '.git'));
    const fakeGit = path.join(outsideRoot, 'hanging-git.cjs');
    const pidFile = path.join(outsideRoot, 'hanging-git-pids.json');
    await fs.writeFile(
      fakeGit,
      [
        "const { spawn } = require('node:child_process');",
        "const fs = require('node:fs');",
        "const marker = process.argv.indexOf('-C');",
        'const projectRoot = process.argv[marker + 1];',
        'process.chdir(projectRoot);',
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
        "  stdio: 'ignore',",
        '  cwd: projectRoot,',
        '});',
        'fs.writeFileSync(' +
          JSON.stringify(pidFile) +
          ', JSON.stringify([process.pid, child.pid]));',
        'setInterval(() => {}, 1000);',
      ].join('\n'),
    );
    const startedAt = Date.now();

    await expect(
      createNativeContentSnapshot(paths, {
        deadlineMs: 250,
        gitProcess: { command: process.execPath, argsPrefix: [fakeGit] },
      }),
    ).rejects.toMatchObject({ code: 'GIT_SNAPSHOT_TIMEOUT' });
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    const pids = JSON.parse(await fs.readFile(pidFile, 'utf8')) as number[];
    const processExists = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    };
    await vi.waitFor(
      () => {
        expect(pids.every((pid) => !processExists(pid))).toBe(true);
      },
      { timeout: 2_000, interval: 20 },
    );

    const movedRoot = `${projectRoot}-after-git-timeout`;
    await expect(fs.rename(projectRoot, movedRoot)).resolves.toBeUndefined();
    projectRoot = movedRoot;
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  it('keeps the timeout code stable when process-tree termination cannot be confirmed', async () => {
    await fs.mkdir(path.join(projectRoot, '.git'));
    const fakeGit = path.join(outsideRoot, 'unconfirmed-git.cjs');
    await fs.writeFile(fakeGit, 'setInterval(() => {}, 1000);\n');

    const error = await createNativeContentSnapshot(paths, {
      deadlineMs: 100,
      gitProcess: {
        command: process.execPath,
        argsPrefix: [fakeGit],
        terminateTree: (child) => {
          child.kill('SIGKILL');
          child.stdin?.destroy();
          child.stdout?.destroy();
          child.stderr?.destroy();
          throw Object.assign(new Error('tree termination was not confirmed'), {
            code: 'GIT_SNAPSHOT_TERMINATION_UNCONFIRMED',
          });
        },
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'GIT_SNAPSHOT_TIMEOUT',
      cause: { code: 'GIT_SNAPSHOT_TERMINATION_UNCONFIRMED' },
    });
  });

  it.runIf(process.platform === 'win32')(
    'releases concurrent Git probe handles before returning',
    async () => {
      await fs.writeFile(path.join(projectRoot, '.git'), 'gitdir: C:/missing/worktree\n');
      await fs.writeFile(path.join(projectRoot, 'source.ts'), 'export {};\n');

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => createNativeContentSnapshot(paths)),
      );
      expect(results.every((result) => result.status === 'rejected')).toBe(true);
      const movedRoot = `${projectRoot}-moved`;
      await expect(fs.rename(projectRoot, movedRoot)).resolves.toBeUndefined();
      projectRoot = movedRoot;
      paths = await nativeProjectPaths(projectRoot, '.');
    },
  );

  it('projects a legacy physical-tree baseline without inventing a historical gitlink pointer', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await Promise.all([
      fs.mkdir(path.join(projectRoot, 'src'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, 'website'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, 'coverage'), { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(path.join(projectRoot, '.gitignore'), 'coverage/\n'),
      fs.writeFile(path.join(projectRoot, 'src', 'app.ts'), 'app\n'),
      fs.writeFile(path.join(projectRoot, 'website', 'page.md'), 'page\n'),
      fs.writeFile(path.join(projectRoot, 'coverage', 'noise.json'), 'noise\n'),
    ]);
    await execFileAsync('git', ['add', '.gitignore', 'src/app.ts'], { cwd: projectRoot });
    await execFileAsync('git', ['init'], { cwd: path.join(projectRoot, 'website') });
    await execFileAsync('git', ['add', 'page.md'], { cwd: path.join(projectRoot, 'website') });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet@example.test',
        'commit',
        '-m',
        'fixture',
      ],
      { cwd: path.join(projectRoot, 'website') },
    );
    await execFileAsync('git', ['add', 'website'], { cwd: projectRoot });
    const legacy: Parameters<typeof filterNativeContentSnapshotToProjectScope>[1] = {
      schema: 'comet.native.content-snapshot.v1',
      origin: 'change-created',
      createdAt: '2026-07-17T00:00:00.000Z',
      complete: false,
      limits: {
        maxFiles: 100,
        maxFileBytes: 1_000,
        maxTotalBytes: 10_000,
        maxManifestBytes: 10_000,
      },
      entries: [
        { path: 'src/app.ts', hash: sha256Text('app\n'), size: 4, type: 'file' },
        { path: 'website/page.md', hash: sha256Text('page\n'), size: 5, type: 'file' },
        { path: 'coverage/noise.json', hash: sha256Text('noise\n'), size: 6, type: 'file' },
      ],
      omitted: [
        { path: 'website/large.bin', size: 9_999, type: 'file', reason: 'file-size' },
        { path: 'coverage/more.json', size: 9_999, type: 'file', reason: 'file-size' },
      ],
      omittedCount: 2,
    };

    const projected = await filterNativeContentSnapshotToProjectScope(paths, legacy);
    expect(projected.entries.map((entry) => entry.path)).toEqual(['src/app.ts']);
    expect(projected).toMatchObject({
      complete: false,
      omitted: [
        {
          path: 'website',
          size: null,
          type: 'directory',
          reason: 'legacy-gitlink-boundary',
        },
      ],
      omittedCount: 1,
    });
  });

  it('binds exceptional Git enumeration evidence into a legacy physical-tree projection', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'selection-a.txt'), 'a'),
      fs.writeFile(path.join(projectRoot, 'selection-b.txt'), 'b'),
      fs.writeFile(path.join(projectRoot, 'selection-c.txt'), 'c'),
    ]);
    const legacy: Parameters<typeof filterNativeContentSnapshotToProjectScope>[1] = {
      schema: 'comet.native.content-snapshot.v1',
      origin: 'change-created',
      capture: { provider: 'physical-tree' },
      createdAt: '2026-07-17T00:00:00.000Z',
      complete: true,
      limits: {
        maxFiles: 100,
        maxFileBytes: 1_000,
        maxTotalBytes: 10_000,
        maxManifestBytes: 20_000,
      },
      entries: [
        { path: 'selection-a.txt', hash: sha256Text('a'), size: 1, type: 'file' },
        { path: 'selection-b.txt', hash: sha256Text('b'), size: 1, type: 'file' },
        { path: 'selection-c.txt', hash: sha256Text('c'), size: 1, type: 'file' },
      ],
      omitted: [],
      omittedCount: 0,
    };
    const gitSelectionLimits = { maxRecords: 2, maxBytes: 1_024, maxRecordBytes: 512 };

    const first = await filterNativeContentSnapshotToProjectScope(paths, legacy, {
      gitSelectionLimits,
    });
    expect(first.capture).toMatchObject({
      provider: 'physical-tree',
      projection: {
        provider: 'git',
        selection: {
          schema: 'comet.native.git-selection.v1',
          status: 'overflow',
          combined: { overflow: true, recordCount: 3 },
        },
      },
    });
    expect(first.omitted).toContainEqual({
      path: '.',
      size: null,
      type: 'directory',
      reason: 'git-enumeration-limit',
    });
    expect(first.omissionOverflow).toMatchObject({ count: 1 });
    await expect(
      filterNativeContentSnapshotToProjectScope(paths, first, {
        gitSelectionHooks: {
          afterStageBefore: () => {
            throw new Error('an existing projection must not enumerate Git again');
          },
        },
      }),
    ).resolves.toEqual(first);

    await fs.rename(
      path.join(projectRoot, 'selection-c.txt'),
      path.join(projectRoot, 'selection-d.txt'),
    );
    const changedTail = await filterNativeContentSnapshotToProjectScope(paths, legacy, {
      gitSelectionLimits,
    });
    expect(changedTail.capture?.projection?.selection?.combined.hash).not.toBe(
      first.capture?.projection?.selection?.combined.hash,
    );
    expect(changedTail.omissionOverflow?.hash).not.toBe(first.omissionOverflow?.hash);
    expect(parseNativeContentSnapshotManifest(first)).toEqual(first);
    const projectedSelection = first.capture?.projection?.selection;
    expect(projectedSelection).toBeDefined();
    expect(() =>
      parseNativeContentSnapshotManifest({
        ...first,
        capture: { provider: 'physical-tree', gitSelection: projectedSelection },
      }),
    ).toThrow(/physical-tree capture cannot include direct Git evidence/iu);
    expect(() =>
      parseNativeContentSnapshotManifest({
        ...first,
        capture: { provider: 'git', projection: first.capture?.projection },
      }),
    ).toThrow(/Git capture cannot include physical or projection evidence/iu);
    const physicalStream = {
      hash: 'a'.repeat(64),
      visitedNodeCount: 1,
      recordCount: 1,
      storedRecordCount: 1,
      encodedBytes: 16,
      overflow: false,
      unstable: true,
    };
    expect(() =>
      parseNativeContentSnapshotManifest({
        ...first,
        capture: {
          provider: 'physical-tree',
          projection: first.capture?.projection,
          physicalSelection: {
            schema: 'comet.native.physical-selection.v1',
            status: 'changed',
            before: physicalStream,
            after: physicalStream,
          },
        },
      }),
    ).toThrow(/cannot combine selection and projection/iu);
  });

  it('drops legacy descendants owned by an unregistered nested repository', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await Promise.all([
      fs.mkdir(path.join(projectRoot, 'src'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, 'vendor', 'nested'), { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'src', 'app.ts'), 'app\n'),
      fs.writeFile(path.join(projectRoot, 'vendor', 'nested', 'payload.txt'), 'nested\n'),
    ]);
    await execFileAsync('git', ['add', 'src/app.ts'], { cwd: projectRoot });
    await execFileAsync('git', ['init'], { cwd: path.join(projectRoot, 'vendor', 'nested') });

    const projected = await filterNativeContentSnapshotToProjectScope(paths, {
      schema: 'comet.native.content-snapshot.v1',
      origin: 'change-created',
      createdAt: '2026-07-17T00:00:00.000Z',
      complete: true,
      limits: {
        maxFiles: 100,
        maxFileBytes: 1_000,
        maxTotalBytes: 10_000,
        maxManifestBytes: 10_000,
      },
      entries: [
        { path: 'src/app.ts', hash: sha256Text('app\n'), size: 4, type: 'file' },
        {
          path: 'vendor/nested/payload.txt',
          hash: sha256Text('nested\n'),
          size: 7,
          type: 'file',
        },
      ],
      omitted: [],
      omittedCount: 0,
    });

    expect(projected.entries.map((entry) => entry.path)).toEqual(['src/app.ts']);
    expect(projected).toMatchObject({ complete: true, omitted: [], omittedCount: 0 });
  });

  it('returns bounded diagnostics for an incomplete baseline at creation time', () => {
    const manifest = parseNativeContentSnapshotManifest({
      schema: 'comet.native.content-snapshot.v1',
      origin: 'change-created',
      createdAt: '2026-07-17T00:00:00.000Z',
      complete: false,
      limits: {
        maxFiles: 10,
        maxFileBytes: 10,
        maxTotalBytes: 100,
        maxManifestBytes: 10_000,
      },
      entries: [],
      omitted: [
        { path: 'large.bin', size: 11, type: 'file', reason: 'file-size' },
        { path: 'other.bin', size: 12, type: 'file', reason: 'file-size' },
      ],
      omittedCount: 4,
      omissionOverflow: {
        ref: `native-snapshot://omitted-overflow/${'a'.repeat(64)}`,
        hash: 'a'.repeat(64),
        count: 2,
      },
    });

    expect(inspectNativeContentSnapshotHealth(manifest, { maxRecordedPaths: 1 })).toEqual({
      complete: false,
      omittedCount: 4,
      recordedOmissionCount: 2,
      overflowCount: 2,
      samplePaths: ['large.bin'],
      sampleTruncated: true,
    });
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
      expect(manifest.omitted).toContainEqual({
        path: '.',
        size: null,
        type: 'directory',
        reason: 'physical-selection-changed',
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
      expect(manifest.omitted).toContainEqual({
        path: 'removed.txt',
        size: null,
        type: 'file',
        reason: 'changed-during-read',
      });
      expect(manifest.omitted).toContainEqual({
        path: '.',
        size: null,
        type: 'directory',
        reason: 'physical-selection-changed',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('bounds hashing to the observed file size when a file grows after lstat', async () => {
    const growing = path.join(projectRoot, 'growing.txt');
    await fs.writeFile(growing, 'small');
    const originalLstat = fs.lstat.bind(fs);
    let targetLstatCount = 0;
    const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (target) => {
      const result = await originalLstat(target);
      if (path.resolve(String(target)) === path.resolve(growing)) {
        targetLstatCount += 1;
      }
      if (targetLstatCount === 2 && path.resolve(String(target)) === path.resolve(growing)) {
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
    const files = Array.from({ length: 40 }, (_, index) =>
      path.join(
        projectRoot,
        `manifest-${index.toString().padStart(2, '0')}-${'x'.repeat(120)}.txt`,
      ),
    );
    await Promise.all(files.map((file) => fs.writeFile(file, 'x')));
    const options = {
      now: new Date('2026-07-17T00:00:00.000Z'),
      limits: { maxManifestBytes: 1_500 },
    } as const;
    const manifest = await createNativeContentSnapshot(paths, options);
    const serialized = JSON.stringify(manifest, null, 2) + '\n';

    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(1_500);
    expect(manifest.complete).toBe(false);
    expect(manifest.omittedCount).toBeGreaterThan(0);
    expect(manifest.omitted).toEqual([]);
    expect(manifest.omissionOverflow?.count).toBe(manifest.omittedCount);
    expect(parseNativeContentSnapshotManifest(JSON.parse(serialized))).toEqual(manifest);

    await Promise.all(files.map((file) => fs.writeFile(file, 'y')));
    const changed = await createNativeContentSnapshot(paths, options);
    expect(changed.omissionOverflow?.hash).not.toBe(manifest.omissionOverflow?.hash);
  });

  it('removes a newly created change directory when baseline capture fails so retry can succeed', async () => {
    const originalOpendir = fs.opendir.bind(fs);
    let failProjectRead = true;
    const spy = vi.spyOn(fs, 'opendir').mockImplementation(async (...args) => {
      if (failProjectRead && path.resolve(String(args[0])) === path.resolve(projectRoot)) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }
      return originalOpendir(...args);
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
