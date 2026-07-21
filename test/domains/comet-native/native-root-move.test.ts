import { promises as fs } from 'fs';
import { execFileSync } from 'node:child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { createNativeChange } from '../../../domains/comet-native/native-change.js';
import { sha256File } from '../../../domains/comet-native/native-hash.js';
import { acquireNativeLock, releaseNativeLock } from '../../../domains/comet-native/native-lock.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { moveNativeRoot } from '../../../domains/comet-native/native-root-move.js';
import { readNativeTransaction } from '../../../domains/comet-native/native-transaction.js';
import {
  inspectNativeWorkspaceAdvisory,
  readNativeWorkspaceIdentity,
} from '../../../domains/comet-native/native-workspace.js';
import { seedNativeRoot } from '../../helpers/native-root.js';

describe('Native artifact root moves', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-root-move-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
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
    const config = await readProjectConfig(projectRoot);
    config!.native.clarification_mode = 'batch';
    await writeProjectConfig(projectRoot, config!);
    const sourcePaths = await nativeProjectPaths(projectRoot, from);
    await createNativeChange({ paths: sourcePaths, name: 'identity-change', language: 'en' });
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
      workflows: ['native'],
      ambient_resume: true,
      native: {
        artifact_root: to,
        language: 'en',
        clarification_mode: 'batch',
      },
    });
    const workspace = await readNativeWorkspaceIdentity(destinationPaths, 'identity-change');
    expect(workspace).not.toBeNull();
    await expect(
      inspectNativeWorkspaceAdvisory({ paths: destinationPaths, identity: workspace! }),
    ).resolves.toEqual({ state: 'aligned', findingCodes: [], driftComponents: [] });
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

  it('fails closed when a source directory is replaced after enumeration', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    const sourceParent = path.join(source, 'specs', 'word-count');
    const displaced = path.join(source, 'specs', 'word-count-original');
    const originalReaddir = fs.readdir.bind(fs);
    let replaced = false;
    const readdir = vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
      const entries = await originalReaddir(...args);
      if (!replaced && path.resolve(String(args[0])) === path.resolve(sourceParent)) {
        replaced = true;
        await fs.rename(sourceParent, displaced);
        await fs.mkdir(sourceParent);
        await fs.writeFile(path.join(sourceParent, 'spec.md'), 'replacement must not move\n');
      }
      return entries;
    });
    try {
      await expect(moveNativeRoot({ projectRoot, toArtifactRoot: 'docs' })).rejects.toThrow(
        /parent changed during I\/O/u,
      );
    } finally {
      readdir.mockRestore();
    }

    expect(await fs.readFile(path.join(displaced, 'spec.md'), 'utf8')).not.toContain('replacement');
    expect(await fs.readFile(path.join(sourceParent, 'spec.md'), 'utf8')).toBe(
      'replacement must not move\n',
    );
    await expect(fs.access(path.join(projectRoot, 'docs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not recursively remove a source root replaced after equivalence checks', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    const displaced = path.join(projectRoot, 'comet-original');

    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          beforeRootMoveSourceRemove: async () => {
            await fs.rename(source, displaced);
            await fs.mkdir(source);
            await fs.writeFile(path.join(source, 'replacement.txt'), 'do not remove\n');
          },
        },
      }),
    ).rejects.toThrow(/changed before quarantine/u);

    expect(await fs.readFile(path.join(source, 'replacement.txt'), 'utf8')).toBe('do not remove\n');
    expect(await fs.readFile(path.join(displaced, 'specs', 'word-count', 'spec.md'), 'utf8')).toBe(
      'count words\n',
    );
    expect(
      await fs.readFile(
        path.join(projectRoot, 'docs', 'comet', 'specs', 'word-count', 'spec.md'),
        'utf8',
      ),
    ).toBe('count words\n');
  });

  it('quarantines first and rejects a child rewritten by the pre-quarantine hook', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    const sourceSpec = path.join(source, 'specs', 'word-count', 'spec.md');

    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          beforeRootMoveSourceRemove: async () => {
            await fs.writeFile(sourceSpec, 'rewritten during cleanup\n');
          },
        },
      }),
    ).rejects.toThrow(/cleanup quarantine differs from its bound manifest/u);

    const pending = (await readProjectConfig(projectRoot))?.native.pending_root_move;
    expect(pending?.cleanup).toMatchObject({ kind: 'forward-source', state: 'prepared' });
    const quarantine = path.join(projectRoot, `.comet-native-source-${pending!.id}.removing`);
    await expect(fs.access(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(quarantine, 'specs', 'word-count', 'spec.md'), 'utf8')).toBe(
      'rewritten during cleanup\n',
    );
    expect(
      await fs.readFile(
        path.join(projectRoot, 'docs', 'comet', 'specs', 'word-count', 'spec.md'),
        'utf8',
      ),
    ).toBe('count words\n');
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
      expect((await readProjectConfig(projectRoot))?.native).toEqual({
        artifact_root: '.',
        language: 'en',
        clarification_mode: 'sequential',
      });
      await expect(fs.access(path.join(projectRoot, 'docs', 'comet'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await releaseNativeLock(staleArchiveLock);
    }
  });
});
