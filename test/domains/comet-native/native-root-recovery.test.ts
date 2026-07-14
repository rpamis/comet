import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readProjectConfig,
  resolveNativeProject,
} from '../../../domains/comet-native/native-config.js';
import { createNativeChange } from '../../../domains/comet-native/native-change.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  moveNativeRoot,
  recoverNativeRootMove,
} from '../../../domains/comet-native/native-root-move.js';
import { readNativeTransaction } from '../../../domains/comet-native/native-transaction.js';
import { seedNativeRoot } from '../../helpers/native-root.js';

describe('Native artifact root recovery', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-root-recovery-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('continues an interruption in the copying stage and blocks normal discovery meanwhile', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveStage(stage) {
            if (stage === 'copying') throw new Error('crash while copying');
          },
        },
      }),
    ).rejects.toThrow('crash while copying');
    expect((await readProjectConfig(projectRoot))?.native.pending_root_move?.stage).toBe('copying');
    await expect(resolveNativeProject({ startPath: projectRoot })).rejects.toThrow(
      /root move .* incomplete/u,
    );
    await expect(
      createNativeChange({
        paths: await nativeProjectPaths(projectRoot, '.'),
        name: 'must-not-start',
        language: 'en',
      }),
    ).rejects.toThrow(/root move .* incomplete/u);

    const recovered = await recoverNativeRootMove({ projectRoot, strategy: 'continue' });
    expect(recovered.activeNativeRoot).toBe(path.join(projectRoot, 'docs', 'comet'));
    expect(recovered.config.native).toEqual({ artifact_root: 'docs' });
    await expect(fs.access(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back an interruption in the ready stage', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    let transactionId = '';
    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveStage(stage, journal) {
            transactionId = journal.id;
            if (stage === 'ready') throw new Error('crash while ready');
          },
        },
      }),
    ).rejects.toThrow('crash while ready');

    const recovered = await recoverNativeRootMove({ projectRoot, strategy: 'rollback' });
    expect(recovered.activeNativeRoot).toBe(source);
    expect(recovered.config.native).toEqual({ artifact_root: '.' });
    expect(
      (await readNativeTransaction(await nativeProjectPaths(projectRoot, '.'), transactionId))
        .status,
    ).toBe('rolled-back');
    await expect(fs.access(path.join(projectRoot, 'docs', 'comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('continues an interruption after the config switched', async () => {
    await seedNativeRoot(projectRoot, '.');
    let transactionId = '';
    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveStage(stage, journal) {
            transactionId = journal.id;
            if (stage === 'switched') throw new Error('crash after switch');
          },
        },
      }),
    ).rejects.toThrow('crash after switch');
    expect(await readProjectConfig(projectRoot)).toMatchObject({
      native: { artifact_root: 'docs', pending_root_move: { stage: 'switched' } },
    });

    const recovered = await recoverNativeRootMove({ projectRoot, strategy: 'continue' });
    const destinationPaths = await nativeProjectPaths(projectRoot, 'docs');
    expect(recovered.activeNativeRoot).toBe(destinationPaths.nativeRoot);
    expect((await readNativeTransaction(destinationPaths, transactionId)).status).toBe('committed');
  });

  it('stops without deleting either tree when staged hashes changed', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    let transactionId = '';
    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveStage(stage, journal) {
            transactionId = journal.id;
            if (stage === 'ready') throw new Error('crash while ready');
          },
        },
      }),
    ).rejects.toThrow('crash while ready');
    const staging = path.join(projectRoot, 'docs', `.comet-native-move-${transactionId}`);
    await fs.writeFile(path.join(staging, 'specs', 'word-count', 'spec.md'), 'tampered\n');

    await expect(recoverNativeRootMove({ projectRoot, strategy: 'continue' })).rejects.toThrow(
      /preserve both trees/u,
    );
    expect(await fs.stat(source)).toBeTruthy();
    expect(await fs.stat(staging)).toBeTruthy();
    expect((await readProjectConfig(projectRoot))?.native.pending_root_move?.stage).toBe('ready');
  });
});
