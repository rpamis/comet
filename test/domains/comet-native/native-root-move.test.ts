import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readProjectConfig } from '../../../domains/comet-native/native-config.js';
import { sha256File } from '../../../domains/comet-native/native-hash.js';
import { acquireNativeLock, releaseNativeLock } from '../../../domains/comet-native/native-lock.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { moveNativeRoot } from '../../../domains/comet-native/native-root-move.js';
import { readNativeTransaction } from '../../../domains/comet-native/native-transaction.js';
import { seedNativeRoot } from '../../helpers/native-root.js';

describe('Native artifact root moves', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-root-move-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it.each([
    ['.', 'docs'],
    ['docs', '.'],
    ['docs', 'artifacts/native'],
  ])('moves %s to %s with file-by-file hash equivalence', async (from, to) => {
    const source = await seedNativeRoot(projectRoot, from);
    const sourceSpec = path.join(source, 'specs', 'word-count', 'spec.md');
    const sourceBinary = path.join(source, 'changes', 'active-change', 'payload.bin');
    const expected = [await sha256File(sourceSpec), await sha256File(sourceBinary)];

    const result = await moveNativeRoot({
      projectRoot,
      toArtifactRoot: to,
      now: new Date('2026-07-14T03:00:00.000Z'),
    });
    const destinationPaths = await nativeProjectPaths(projectRoot, to);

    expect(result).toMatchObject({
      fromNativeRoot: source,
      toNativeRoot: destinationPaths.nativeRoot,
    });
    expect(await readProjectConfig(projectRoot)).toEqual({
      schema: 'comet.project.v1',
      default_workflow: 'native',
      native: { artifact_root: to },
    });
    expect([
      await sha256File(path.join(destinationPaths.specsDir, 'word-count', 'spec.md')),
      await sha256File(path.join(destinationPaths.changesDir, 'active-change', 'payload.bin')),
    ]).toEqual(expected);
    await expect(fs.access(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readNativeTransaction(destinationPaths, result.transactionId)).toMatchObject({
      kind: 'root-move',
      status: 'committed',
    });
  });

  it('refuses an occupied destination without modifying either tree', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    const destination = path.join(projectRoot, 'docs', 'comet');
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, 'sentinel.txt'), 'keep');

    await expect(moveNativeRoot({ projectRoot, toArtifactRoot: 'docs' })).rejects.toThrow(
      /occupied/u,
    );
    expect(await fs.stat(source)).toBeTruthy();
    expect(await fs.readFile(path.join(destination, 'sentinel.txt'), 'utf8')).toBe('keep');
    expect((await readProjectConfig(projectRoot))?.native.artifact_root).toBe('.');
  });

  it('refuses symlinks in the persisted Native tree', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    const outside = path.join(projectRoot, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(source, 'linked-outside'), 'junction');

    await expect(moveNativeRoot({ projectRoot, toArtifactRoot: 'docs' })).rejects.toThrow(
      /contains a symlink/u,
    );
    expect((await readProjectConfig(projectRoot))?.native.pending_root_move?.stage).toBe('copying');
    expect(await fs.stat(source)).toBeTruthy();
  });

  it('serializes root moves with archive operations through the global lock', async () => {
    await seedNativeRoot(projectRoot, '.');
    const paths = await nativeProjectPaths(projectRoot, '.');
    const archiveGlobalLock = await acquireNativeLock(paths, 'root-move', 'archive active-change');
    try {
      await expect(moveNativeRoot({ projectRoot, toArtifactRoot: 'docs' })).rejects.toThrow(
        /already held/u,
      );
    } finally {
      await releaseNativeLock(archiveGlobalLock);
    }
  });

  it('refuses to copy any unresolved operation lock into the destination root', async () => {
    await seedNativeRoot(projectRoot, '.');
    const paths = await nativeProjectPaths(projectRoot, '.');
    const staleArchiveLock = await acquireNativeLock(
      paths,
      'archive',
      'archive interrupted-change',
    );
    try {
      await expect(moveNativeRoot({ projectRoot, toArtifactRoot: 'docs' })).rejects.toThrow(
        'must be diagnosed before moving',
      );
      expect((await readProjectConfig(projectRoot))?.native).toEqual({ artifact_root: '.' });
      await expect(fs.access(path.join(projectRoot, 'docs', 'comet'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await releaseNativeLock(staleArchiveLock);
    }
  });
});
