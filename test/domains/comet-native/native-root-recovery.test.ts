import { promises as fs } from 'fs';
import { execFileSync } from 'node:child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readProjectConfig,
  resolveNativeProject,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { createNativeChange } from '../../../domains/comet-native/native-change.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  moveNativeRoot,
  recoverNativeRootMove,
} from '../../../domains/comet-native/native-root-move.js';
import { readNativeTransaction } from '../../../domains/comet-native/native-transaction.js';
import {
  inspectNativeWorkspaceAdvisory,
  readNativeWorkspaceIdentity,
} from '../../../domains/comet-native/native-workspace.js';
import { seedNativeRoot } from '../../helpers/native-root.js';

describe('Native artifact root recovery', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-root-recovery-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function enableBatchClarification(): Promise<void> {
    const config = await readProjectConfig(projectRoot);
    if (!config) throw new Error('Expected seeded Native project config');
    config.native.clarification_mode = 'batch';
    await writeProjectConfig(projectRoot, config);
  }

  it('continues an interruption in the copying stage and blocks normal discovery meanwhile', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    await enableBatchClarification();
    await createNativeChange({
      paths: await nativeProjectPaths(projectRoot, '.'),
      name: 'identity-change',
      language: 'en',
    });
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
    expect(recovered.config.native).toEqual({
      artifact_root: 'docs',
      language: 'en',
      clarification_mode: 'batch',
    });
    await expect(fs.access(source)).rejects.toMatchObject({ code: 'ENOENT' });
    const destinationPaths = await nativeProjectPaths(projectRoot, 'docs');
    const workspace = await readNativeWorkspaceIdentity(destinationPaths, 'identity-change');
    await expect(
      inspectNativeWorkspaceAdvisory({ paths: destinationPaths, identity: workspace! }),
    ).resolves.toEqual({ state: 'aligned', findingCodes: [], driftComponents: [] });
  });

  it('rolls back an interruption in the ready stage', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    await enableBatchClarification();
    const sourcePaths = await nativeProjectPaths(projectRoot, '.');
    await createNativeChange({ paths: sourcePaths, name: 'identity-change', language: 'en' });
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
    expect(recovered.config.native).toEqual({
      artifact_root: '.',
      language: 'en',
      clarification_mode: 'batch',
    });
    expect(
      (await readNativeTransaction(await nativeProjectPaths(projectRoot, '.'), transactionId))
        .status,
    ).toBe('rolled-back');
    await expect(fs.access(path.join(projectRoot, 'docs', 'comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const workspace = await readNativeWorkspaceIdentity(sourcePaths, 'identity-change');
    await expect(
      inspectNativeWorkspaceAdvisory({ paths: sourcePaths, identity: workspace! }),
    ).resolves.toEqual({ state: 'aligned', findingCodes: [], driftComponents: [] });
  });

  it('continues an interruption after the config switched', async () => {
    await seedNativeRoot(projectRoot, '.');
    await createNativeChange({
      paths: await nativeProjectPaths(projectRoot, '.'),
      name: 'identity-change',
      language: 'en',
    });
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
    const workspace = await readNativeWorkspaceIdentity(destinationPaths, 'identity-change');
    await expect(
      inspectNativeWorkspaceAdvisory({ paths: destinationPaths, identity: workspace! }),
    ).resolves.toEqual({ state: 'aligned', findingCodes: [], driftComponents: [] });
  });

  it('continues a transaction-bound source quarantine after a removal crash', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    let quarantine = '';
    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveSourceQuarantined(target) {
            quarantine = target;
            throw new Error('crash after source quarantine');
          },
        },
      }),
    ).rejects.toThrow('crash after source quarantine');

    expect(path.basename(quarantine)).toMatch(/^\.comet-native-source-.+\.removing$/u);
    await expect(fs.access(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(quarantine, 'specs', 'word-count', 'spec.md'), 'utf8')).toBe(
      'count words\n',
    );
    expect((await readProjectConfig(projectRoot))?.native.pending_root_move?.stage).toBe(
      'switched',
    );

    const recovered = await recoverNativeRootMove({ projectRoot, strategy: 'continue' });
    expect(recovered.activeNativeRoot).toBe(path.join(projectRoot, 'docs', 'comet'));
    await expect(fs.access(quarantine)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(recovered.config.native).toEqual({
      artifact_root: 'docs',
      language: 'en',
      clarification_mode: 'sequential',
    });
  });

  it('continues deletion when a quarantined source is only a valid manifest subset', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveCleanupEntryRemoved(kind, _ref, removedCount) {
            if (kind === 'forward-source' && removedCount === 2) {
              throw new Error('crash during source cleanup');
            }
          },
        },
      }),
    ).rejects.toThrow('crash during source cleanup');

    const pending = (await readProjectConfig(projectRoot))?.native.pending_root_move;
    expect(pending?.cleanup).toMatchObject({ kind: 'forward-source', state: 'deleting' });
    const quarantine = path.join(projectRoot, `.comet-native-source-${pending!.id}.removing`);
    await expect(fs.access(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(quarantine, { recursive: true })).length).toBeGreaterThan(0);

    const recovered = await recoverNativeRootMove({ projectRoot, strategy: 'continue' });
    expect(recovered.config.native).toEqual({
      artifact_root: 'docs',
      language: 'en',
      clarification_mode: 'sequential',
    });
    await expect(fs.access(quarantine)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    [
      'extra content',
      async (quarantine: string) => {
        await fs.writeFile(path.join(quarantine, 'unexpected.txt'), 'unexpected\n');
      },
    ],
    [
      'tampered content',
      async (quarantine: string) => {
        await fs.writeFile(path.join(quarantine, 'specs', 'word-count', 'spec.md'), 'tampered\n');
      },
    ],
  ])('fails closed when a source quarantine has %s', async (_label, mutate) => {
    await seedNativeRoot(projectRoot, '.');
    let quarantine = '';
    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveSourceQuarantined(target) {
            quarantine = target;
            throw new Error('crash before quarantine validation');
          },
        },
      }),
    ).rejects.toThrow('crash before quarantine validation');
    await mutate(quarantine);

    await expect(recoverNativeRootMove({ projectRoot, strategy: 'continue' })).rejects.toThrow(
      /cleanup quarantine differs from its bound manifest/u,
    );
    expect((await readProjectConfig(projectRoot))?.native.pending_root_move?.cleanup).toMatchObject(
      {
        kind: 'forward-source',
        state: 'prepared',
      },
    );
    expect(await fs.stat(quarantine)).toBeTruthy();
  });

  it('resumes a partially deleted rollback quarantine with the same manifest rules', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveStage(stage) {
            if (stage === 'switched') throw new Error('crash before source cleanup');
          },
        },
      }),
    ).rejects.toThrow('crash before source cleanup');

    await expect(
      recoverNativeRootMove({
        projectRoot,
        strategy: 'rollback',
        hooks: {
          afterRootMoveCleanupEntryRemoved(kind, _ref, removedCount) {
            if (kind === 'rollback-destination' && removedCount === 2) {
              throw new Error('crash during rollback cleanup');
            }
          },
        },
      }),
    ).rejects.toThrow('crash during rollback cleanup');

    const pending = (await readProjectConfig(projectRoot))?.native.pending_root_move;
    expect(pending?.cleanup).toMatchObject({ kind: 'rollback-destination', state: 'deleting' });
    const destination = path.join(projectRoot, 'docs', 'comet');
    const quarantine = path.join(projectRoot, 'docs', `.comet.${pending!.id}.rollback-removing`);
    await expect(fs.access(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(quarantine, { recursive: true })).length).toBeGreaterThan(0);

    const recovered = await recoverNativeRootMove({ projectRoot, strategy: 'rollback' });
    expect(recovered.activeNativeRoot).toBe(source);
    expect(recovered.config.native).toEqual({
      artifact_root: '.',
      language: 'en',
      clarification_mode: 'sequential',
    });
    await expect(fs.access(quarantine)).rejects.toMatchObject({ code: 'ENOENT' });
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

  it('bounds the staged fallback journal before parsing it', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    let transactionId = '';
    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveStage(stage, journal) {
            transactionId = journal.id;
            if (stage === 'ready') throw new Error('crash before journal fallback');
          },
        },
      }),
    ).rejects.toThrow('crash before journal fallback');
    const staging = path.join(projectRoot, 'docs', `.comet-native-move-${transactionId}`);
    const sourceJournal = path.join(
      source,
      'runtime',
      'transactions',
      transactionId,
      'transaction.json',
    );
    const stagedJournal = path.join(
      staging,
      'runtime',
      'transactions',
      transactionId,
      'transaction.json',
    );
    await fs.rm(sourceJournal);
    await fs.writeFile(stagedJournal, 'x'.repeat(256 * 1024 + 1));

    await expect(recoverNativeRootMove({ projectRoot, strategy: 'continue' })).rejects.toThrow(
      /exceeds 262144 bytes/u,
    );
    expect(await fs.stat(source)).toBeTruthy();
    expect(await fs.stat(staging)).toBeTruthy();
  });

  it('rejects a junction in the staged fallback journal parent chain', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    let transactionId = '';
    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveStage(stage, journal) {
            transactionId = journal.id;
            if (stage === 'ready') throw new Error('crash before junction fallback');
          },
        },
      }),
    ).rejects.toThrow('crash before junction fallback');
    const staging = path.join(projectRoot, 'docs', `.comet-native-move-${transactionId}`);
    const sourceJournal = path.join(
      source,
      'runtime',
      'transactions',
      transactionId,
      'transaction.json',
    );
    const stagedTransaction = path.join(staging, 'runtime', 'transactions', transactionId);
    const external = path.join(projectRoot, 'external-journal');
    const journal = await fs.readFile(sourceJournal);
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, 'transaction.json'), journal);
    await fs.rm(sourceJournal);
    await fs.rm(stagedTransaction, { recursive: true });
    await fs.symlink(
      external,
      stagedTransaction,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(recoverNativeRootMove({ projectRoot, strategy: 'continue' })).rejects.toThrow(
      /parent must be a real directory/u,
    );
    expect(await fs.readFile(path.join(external, 'transaction.json'))).toEqual(journal);
    expect(await fs.stat(source)).toBeTruthy();
  });
});
