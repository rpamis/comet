import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  archiveNativeChange,
  recoverArchiveTransaction,
} from '../../../domains/comet-native/native-archive.js';
import {
  createNativeChange,
  readNativeChangeFile,
} from '../../../domains/comet-native/native-change.js';
import { sha256File } from '../../../domains/comet-native/native-hash.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativeTransaction,
  nativeRootRef,
  readNativeTransaction,
} from '../../../domains/comet-native/native-transaction.js';
import {
  nativeArchiveTransactionPaths,
  readNativeArchiveTransactionV2,
} from '../../../domains/comet-native/native-archive-transaction.js';
import type {
  NativeProjectPaths,
  NativeSpecChange,
} from '../../../domains/comet-native/native-types.js';
import {
  prepareNativeArchiveFixture,
  readyNativeArchivePreflight,
} from '../../helpers/native-archive.js';

describe('Native archive recovery', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-recovery-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function preparedChange(name: string): Promise<{
    changeDir: string;
    canonical: string;
    specChanges: NativeSpecChange[];
  }> {
    const canonical = path.join(paths.specsDir, 'authentication', 'spec.md');
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, 'old auth\n');
    const specChanges: NativeSpecChange[] = [
      {
        capability: 'authentication',
        operation: 'replace',
        source: 'specs/authentication.md',
        base_hash: await sha256File(canonical),
      },
      { capability: 'sessions', operation: 'create', source: 'specs/sessions.md', base_hash: null },
    ];
    const { changeDir } = await prepareNativeArchiveFixture({
      paths,
      name,
      specChanges,
      proposedSpecs: {
        'specs/authentication.md': 'new auth\n',
        'specs/sessions.md': 'new sessions\n',
      },
    });
    return { changeDir, canonical, specChanges };
  }

  it('continues after all staged specs were prepared', async () => {
    const { changeDir, canonical } = await preparedChange('prepared-crash');
    const now = new Date('2026-07-17T00:00:00.000Z');
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'prepared-crash',
      now,
    });
    let transactionId = '';
    await expect(
      archiveNativeChange({
        paths,
        name: 'prepared-crash',
        expectedPreflightHash,
        now,
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
            throw new Error('crash after prepared');
          },
        },
      }),
    ).rejects.toThrow('crash after prepared');
    expect((await readNativeTransaction(paths, transactionId)).status).toBe('prepared');
    expect(await fs.readFile(canonical, 'utf8')).toBe('old auth\n');
    expect(await fs.stat(changeDir)).toBeTruthy();
    await expect(
      createNativeChange({ paths, name: 'blocked-by-recovery', language: 'en' }),
    ).rejects.toThrow('transaction recovery is required');

    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'continue',
    });
    expect(recovered.status).toBe('committed');
    expect(await fs.readFile(canonical, 'utf8')).toBe('new auth\n');
  });

  it('rolls back after one canonical spec was replaced', async () => {
    const { changeDir, canonical } = await preparedChange('replace-crash');
    const now = new Date('2026-07-17T00:00:00.000Z');
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'replace-crash',
      now,
    });
    let transactionId = '';
    await expect(
      archiveNativeChange({
        paths,
        name: 'replace-crash',
        expectedPreflightHash,
        now,
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
          },
          afterOperation(_operation, completed) {
            if (completed === 1) throw new Error('crash after replace');
          },
        },
      }),
    ).rejects.toThrow('crash after replace');
    expect(await fs.readFile(canonical, 'utf8')).toBe('new auth\n');

    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'rollback',
    });
    expect(recovered.status).toBe('rolled-back');
    expect(await fs.readFile(canonical, 'utf8')).toBe('old auth\n');
    await expect(fs.access(path.join(paths.specsDir, 'sessions', 'spec.md'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
    expect(await fs.stat(changeDir)).toBeTruthy();
  });

  it('continues when canonical specs are complete but the active change still exists', async () => {
    const { changeDir } = await preparedChange('specs-complete-crash');
    const now = new Date('2026-07-18T00:00:00.000Z');
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'specs-complete-crash',
      now,
    });
    let transactionId = '';
    await expect(
      archiveNativeChange({
        paths,
        name: 'specs-complete-crash',
        expectedPreflightHash,
        now,
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
          },
          afterOperation(_operation, completed) {
            if (completed === 2) throw new Error('crash before move');
          },
        },
      }),
    ).rejects.toThrow('crash before move');
    expect(await fs.stat(changeDir)).toBeTruthy();
    expect((await readNativeTransaction(paths, transactionId)).status).toBe('applying');

    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'continue',
    });
    expect(recovered.status).toBe('committed');
    await expect(fs.access(changeDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('finalizes when the active change moved before the journal committed', async () => {
    const { changeDir } = await preparedChange('move-crash');
    const now = new Date('2026-07-19T00:00:00.000Z');
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'move-crash',
      now,
    });
    let transactionId = '';
    const archiveDir = path.join(paths.archiveDir, '2026-07-19-move-crash');
    await expect(
      archiveNativeChange({
        paths,
        name: 'move-crash',
        expectedPreflightHash,
        now,
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
          },
          afterOperation(operation) {
            if (operation.id === 'archive-change') throw new Error('crash after move');
          },
        },
      }),
    ).rejects.toThrow('crash after move');
    await expect(fs.access(changeDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readNativeChangeFile(path.join(archiveDir, 'change.yaml'))).archived).toBe(false);

    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'continue',
    });
    expect(recovered.status).toBe('committed');
    expect((await readNativeChangeFile(path.join(archiveDir, 'change.yaml'))).archived).toBe(true);
  });

  it('fails closed when staged content changes before the first operation', async () => {
    const { canonical, changeDir } = await preparedChange('staged-drift');
    const now = new Date('2026-07-20T00:00:00.000Z');
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'staged-drift',
      now,
    });
    let transactionId = '';
    await expect(
      archiveNativeChange({
        paths,
        name: 'staged-drift',
        expectedPreflightHash,
        now,
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
            throw new Error('crash after prepared');
          },
        },
      }),
    ).rejects.toThrow('crash after prepared');
    const journal = await readNativeArchiveTransactionV2(paths, transactionId);
    const write = journal.operations.find((operation) => operation.type === 'write');
    expect(write?.staged).toBeTruthy();
    const staged = path.resolve(paths.nativeRoot, ...write!.staged!.split('/'));
    await fs.writeFile(staged, 'tampered staged content\n');

    await expect(
      recoverArchiveTransaction({ paths, transactionId, strategy: 'continue' }),
    ).rejects.toThrow('staged file');
    expect(await fs.readFile(canonical, 'utf8')).toBe('old auth\n');
    expect(await fs.stat(changeDir)).toBeTruthy();
    expect((await readNativeArchiveTransactionV2(paths, transactionId)).status).toBe('applying');
  });

  it('preserves the journal and refuses rollback over externally changed canonical content', async () => {
    const { canonical } = await preparedChange('rollback-drift');
    const now = new Date('2026-07-21T00:00:00.000Z');
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'rollback-drift',
      now,
    });
    let transactionId = '';
    await expect(
      archiveNativeChange({
        paths,
        name: 'rollback-drift',
        expectedPreflightHash,
        now,
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
          },
          afterOperation(_operation, completed) {
            if (completed === 1) throw new Error('crash after replace');
          },
        },
      }),
    ).rejects.toThrow('crash after replace');
    await fs.writeFile(canonical, 'external canonical content\n');

    await expect(
      recoverArchiveTransaction({ paths, transactionId, strategy: 'rollback' }),
    ).rejects.toThrow('content changed');
    expect(await fs.readFile(canonical, 'utf8')).toBe('external canonical content\n');
    expect((await readNativeArchiveTransactionV2(paths, transactionId)).status).toBe(
      'rolling-back',
    );
  });

  it('refuses to finalize an archive directory that changed after its move', async () => {
    await preparedChange('moved-content-drift');
    const now = new Date('2026-07-22T00:00:00.000Z');
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'moved-content-drift',
      now,
    });
    let transactionId = '';
    await expect(
      archiveNativeChange({
        paths,
        name: 'moved-content-drift',
        expectedPreflightHash,
        now,
        hooks: {
          afterPrepared(journal) {
            transactionId = journal.id;
          },
          afterOperation(operation) {
            if (operation.id === 'archive-change') throw new Error('crash after move');
          },
        },
      }),
    ).rejects.toThrow('crash after move');
    const archiveDir = path.join(paths.archiveDir, '2026-07-22-moved-content-drift');
    await fs.writeFile(path.join(archiveDir, 'unexpected.txt'), 'external content\n');

    await expect(
      recoverArchiveTransaction({ paths, transactionId, strategy: 'continue' }),
    ).rejects.toThrow(/content changed|changed before finalization/u);
    expect(await fs.readFile(path.join(archiveDir, 'unexpected.txt'), 'utf8')).toBe(
      'external content\n',
    );
    expect((await readNativeArchiveTransactionV2(paths, transactionId)).status).toBe('applying');
    expect(nativeArchiveTransactionPaths(paths, transactionId).journal).toContain(transactionId);
  });

  it('continues legacy v1 Archive journals without weakening v2 writes', async () => {
    const { changeDir } = await prepareNativeArchiveFixture({
      paths,
      name: 'legacy-v1-recovery',
    });
    const transactionId = 'a1b2c3d4-1e9ac';
    const archiveDir = path.join(paths.archiveDir, '2026-07-23-legacy-v1-recovery');
    await createNativeTransaction(paths, {
      schema: 'comet.native.transaction.v1',
      id: transactionId,
      kind: 'archive',
      status: 'prepared',
      projectRoot: paths.projectRoot,
      nativeRoot: paths.nativeRoot,
      change: 'legacy-v1-recovery',
      createdAt: '2026-07-23T00:00:00.000Z',
      operations: [
        {
          id: 'archive-change',
          type: 'move',
          source: nativeRootRef(paths, changeDir),
          target: nativeRootRef(paths, archiveDir),
        },
      ],
    });

    const recovered = await recoverArchiveTransaction({
      paths,
      transactionId,
      strategy: 'continue',
    });

    expect(recovered).toMatchObject({
      schema: 'comet.native.transaction.v1',
      status: 'committed',
    });
    expect((await readNativeChangeFile(path.join(archiveDir, 'change.yaml'))).archived).toBe(true);
  });
});
