import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativeTransaction,
  nativeTransactionPaths,
  readNativeTransaction,
  readNativeTransactionEvents,
} from '../../../domains/comet-native/native-transaction.js';
import type {
  NativeProjectPaths,
  NativeTransactionJournal,
} from '../../../domains/comet-native/native-types.js';

describe('Native transaction schema', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let journal: NativeTransactionJournal;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-transaction-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    journal = {
      schema: 'comet.native.transaction.v1',
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      kind: 'archive',
      status: 'prepared',
      projectRoot,
      nativeRoot: paths.nativeRoot,
      change: 'example-change',
      createdAt: '2026-07-14T00:00:00.000Z',
      operations: [
        {
          id: 'write-spec',
          type: 'write',
          target: 'specs/example/spec.md',
          staged: 'runtime/transactions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/staged/spec.md',
        },
      ],
    };
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('round-trips a strict journal and append-only prepared event', async () => {
    await createNativeTransaction(paths, journal);
    expect(await readNativeTransaction(paths, journal.id)).toEqual(journal);
    expect(await readNativeTransactionEvents(paths, journal.id)).toEqual([
      expect.objectContaining({ sequence: 1, type: 'prepared' }),
    ]);
  });

  it.each([
    ['unknown journal key', { unknown: true }],
    ['invalid status', { status: 'unknown' }],
    ['non-ISO timestamp', { createdAt: 'July 14 2026' }],
    [
      'unsafe operation ref',
      {
        operations: [
          {
            id: 'write-spec',
            type: 'write',
            target: '../outside.md',
            staged: 'runtime/staged.md',
          },
        ],
      },
    ],
    [
      'invalid operation matrix',
      {
        operations: [
          {
            id: 'move-change',
            type: 'move',
            target: 'archive/change',
            staged: 'runtime/staged-change',
          },
        ],
      },
    ],
  ])('fails closed for %s', async (_label, patch) => {
    await expect(
      createNativeTransaction(paths, { ...journal, ...patch } as NativeTransactionJournal),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      fs.access(nativeTransactionPaths(paths, journal.id).journal),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects corrupted event sequence and preserves the journal for diagnosis', async () => {
    await createNativeTransaction(paths, journal);
    const events = nativeTransactionPaths(paths, journal.id).events;
    await fs.appendFile(
      events,
      JSON.stringify({
        sequence: 9,
        timestamp: '2026-07-14T00:00:01.000Z',
        type: 'commit',
      }) + '\n',
    );

    await expect(readNativeTransactionEvents(paths, journal.id)).rejects.toThrow(
      'Invalid Native transaction event at line 2',
    );
    expect((await readNativeTransaction(paths, journal.id)).id).toBe(journal.id);
  });
});
