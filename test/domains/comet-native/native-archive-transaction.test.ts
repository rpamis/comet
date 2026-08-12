import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyNativeArchiveTransactionV2,
  createNativeArchiveTransactionV2,
  finalizeNativeArchiveTransactionV2,
  nativeArchiveTransactionPaths,
  readNativeArchiveTransactionV2,
  rollbackNativeArchiveTransactionV2,
} from '../../../domains/comet-native/native-archive-transaction.js';
import { inspectNativeArchiveContent } from '../../../domains/comet-native/native-archive-content.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  appendNativeTransactionEvent,
  type NativeArchiveTransactionJournalV2,
} from '../../../domains/comet-native/native-transaction.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native Archive transaction V2 public lifecycle', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-transaction-'));
    paths = await nativeProjectPaths(root, '.');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function journal(
    id: string,
    change: string,
    status: NativeArchiveTransactionJournalV2['status'] = 'prepared',
  ) {
    const source = path.join(paths.changesDir, change);
    await fs.mkdir(source, { recursive: true });
    const sourceContent = await inspectNativeArchiveContent(source);
    return {
      schema: 'comet.native.transaction.v2',
      id,
      kind: 'archive',
      status,
      change,
      createdAt: '2026-08-12T00:00:00.000Z',
      preflightHash: 'a'.repeat(64),
      operations: [
        {
          id: 'archive-change',
          type: 'move',
          source: `changes/${change}`,
          target: `archive/2026-08-12-${change}`,
          expectedSourceHash: sourceContent?.hash ?? 'b'.repeat(64),
          expectedTargetHash: null,
        },
      ],
    } satisfies NativeArchiveTransactionJournalV2;
  }

  it('creates, reads, applies, and finalizes an empty transaction', async () => {
    const initial = await journal('12345678-abcd', 'transaction-change');
    await createNativeArchiveTransactionV2(paths, initial);
    await expect(readNativeArchiveTransactionV2(paths, initial.id)).resolves.toMatchObject({
      status: 'prepared',
      operations: [{ id: 'archive-change', type: 'move' }],
    });

    const applying = await applyNativeArchiveTransactionV2(paths, initial);
    expect(applying.status).toBe('applying');
    const alreadyApplying = await applyNativeArchiveTransactionV2(paths, applying);
    expect(alreadyApplying.status).toBe('applying');

    await finalizeNativeArchiveTransactionV2(
      paths,
      alreadyApplying,
      'archive-finalization-started',
    );
    const finalized = await finalizeNativeArchiveTransactionV2(
      paths,
      alreadyApplying,
      'archive-finalized',
    );
    expect(finalized.status).toBe('applying');
    const committed = await finalizeNativeArchiveTransactionV2(paths, finalized, 'commit');
    expect(committed.status).toBe('committed');
    expect(nativeArchiveTransactionPaths(paths, initial.id).journal).toContain(initial.id);
  });

  it('rejects invalid lifecycle transitions and finalization rollback', async () => {
    const committed = await journal('22345678-abcd', 'committed-change', 'committed');
    await createNativeArchiveTransactionV2(paths, committed);
    await expect(applyNativeArchiveTransactionV2(paths, committed)).rejects.toThrow(
      'cannot apply from committed',
    );

    const rollback = await journal('32345678-abcd', 'rollback-change');
    await createNativeArchiveTransactionV2(paths, rollback);
    await expect(rollbackNativeArchiveTransactionV2(paths, rollback)).resolves.toMatchObject({
      status: 'rolled-back',
    });

    const irreversible = await journal('42345678-abcd', 'irreversible-change');
    await createNativeArchiveTransactionV2(paths, irreversible);
    await appendNativeTransactionEvent(paths, irreversible.id, 'archive-finalization-started');
    await expect(rollbackNativeArchiveTransactionV2(paths, irreversible)).rejects.toThrow(
      'finalization started',
    );
  });
});
