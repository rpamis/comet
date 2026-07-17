import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  applyNativeTransaction,
  appendNativeTransactionEvent,
  createNativeTransaction,
  nativeTransactionPaths,
  readNativeTransaction,
  readNativeTransactionEvents,
} from '../../../domains/comet-native/native-transaction.js';
import type {
  NativeProjectPaths,
  NativeTransactionEvent,
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

  it('rejects blank lines inside an append-only event log', async () => {
    await createNativeTransaction(paths, journal);
    await fs.appendFile(nativeTransactionPaths(paths, journal.id).events, '\n');

    await expect(readNativeTransactionEvents(paths, journal.id)).rejects.toThrow(
      'Invalid Native transaction event at line 2',
    );
  });

  it('recognizes every canonical event truncation and atomically replaces the tail before append', async () => {
    await createNativeTransaction(paths, journal);
    const eventsFile = nativeTransactionPaths(paths, journal.id).events;
    const prepared = await fs.readFile(eventsFile, 'utf8');
    const eventTypes: NativeTransactionEvent['type'][] = [
      'prepared',
      'operation-started',
      'operation-completed',
      'archive-finalization-started',
      'archive-finalized',
      'commit',
      'rollback-started',
      'rollback-completed',
    ];

    for (const type of eventTypes) {
      const candidate = JSON.stringify({
        sequence: 2,
        timestamp: '2026-07-14T00:00:01.000Z',
        type,
        ...(type === 'operation-started' || type === 'operation-completed'
          ? { operationId: 'write-spec' }
          : {}),
      });
      for (let cut = 1; cut < candidate.length; cut += 1) {
        await fs.writeFile(eventsFile, prepared + candidate.slice(0, cut));
        expect(await readNativeTransactionEvents(paths, journal.id)).toEqual([
          expect.objectContaining({ sequence: 1, type: 'prepared' }),
        ]);
      }

      await fs.writeFile(eventsFile, prepared + candidate.slice(0, -2));
      await appendNativeTransactionEvent(paths, journal.id, 'commit');
      const recovered = await readNativeTransactionEvents(paths, journal.id);
      expect(recovered.map((event) => [event.sequence, event.type])).toEqual([
        [1, 'prepared'],
        [2, 'commit'],
      ]);
      expect(await fs.readFile(eventsFile, 'utf8')).toBe(
        `${recovered.map((event) => JSON.stringify(event)).join('\n')}\n`,
      );
      expect((await appendNativeTransactionEvent(paths, journal.id, 'commit')).sequence).toBe(2);
      expect(await readNativeTransactionEvents(paths, journal.id)).toHaveLength(2);
    }
  });

  it('preserves a complete event whose final newline was not written', async () => {
    await createNativeTransaction(paths, journal);
    const eventsFile = nativeTransactionPaths(paths, journal.id).events;
    const prepared = await fs.readFile(eventsFile, 'utf8');
    const complete = JSON.stringify({
      sequence: 2,
      timestamp: '2026-07-14T00:00:01.000Z',
      type: 'operation-started',
      operationId: 'write-spec',
    });
    await fs.writeFile(eventsFile, prepared + complete);

    expect(
      (await appendNativeTransactionEvent(paths, journal.id, 'operation-started', 'write-spec'))
        .sequence,
    ).toBe(2);
    expect((await fs.readFile(eventsFile, 'utf8')).endsWith('\n')).toBe(true);
    await appendNativeTransactionEvent(paths, journal.id, 'operation-completed', 'write-spec');

    expect(
      (await readNativeTransactionEvents(paths, journal.id)).map((event) => event.type),
    ).toEqual(['prepared', 'operation-started', 'operation-completed']);
    expect((await fs.readFile(eventsFile, 'utf8')).endsWith('\n')).toBe(true);
  });

  it('rejects a syntactically complete invalid final event without a newline', async () => {
    await createNativeTransaction(paths, journal);
    await fs.appendFile(
      nativeTransactionPaths(paths, journal.id).events,
      JSON.stringify({
        sequence: 2,
        timestamp: '2026-07-14T00:00:01.000Z',
        type: 'unknown',
      }),
    );

    await expect(readNativeTransactionEvents(paths, journal.id)).rejects.toThrow(
      'Invalid Native transaction event at line 2',
    );
    await expect(appendNativeTransactionEvent(paths, journal.id, 'commit')).rejects.toThrow(
      'Invalid Native transaction event at line 2',
    );
  });

  it('rejects non-canonical and newline-terminated corrupt tails', async () => {
    await createNativeTransaction(paths, journal);
    const eventsFile = nativeTransactionPaths(paths, journal.id).events;
    const prepared = await fs.readFile(eventsFile, 'utf8');

    await fs.writeFile(eventsFile, `${prepared}{"sequence":2,"bad":`);
    await expect(readNativeTransactionEvents(paths, journal.id)).rejects.toThrow(
      'Invalid Native transaction event at line 2',
    );

    await fs.writeFile(eventsFile, `${prepared}{"sequence":2,"timestamp":"2026-99`);
    await expect(readNativeTransactionEvents(paths, journal.id)).rejects.toThrow(
      'Invalid Native transaction event at line 2',
    );

    await fs.writeFile(
      eventsFile,
      `${prepared}{"sequence":2,"timestamp":"2026-07-14T00:00:01.000Z"\n`,
    );
    await expect(readNativeTransactionEvents(paths, journal.id)).rejects.toThrow(
      'Invalid Native transaction event at line 2',
    );
  });

  it('bounds transaction journals and event logs before parsing', async () => {
    await createNativeTransaction(paths, journal);
    const tx = nativeTransactionPaths(paths, journal.id);
    await fs.writeFile(tx.events, Buffer.alloc(1024 * 1024 + 1, 0x20));
    await expect(readNativeTransactionEvents(paths, journal.id)).rejects.toThrow(
      'exceeds 1048576 bytes',
    );

    await fs.writeFile(tx.journal, Buffer.alloc(256 * 1024 + 1, 0x20));
    await expect(readNativeTransaction(paths, journal.id)).rejects.toThrow('exceeds 262144 bytes');
  });

  it('copies legacy staged bytes without UTF-8 coercion', async () => {
    await createNativeTransaction(paths, journal);
    const staged = path.join(paths.nativeRoot, journal.operations[0].staged!);
    const target = path.join(paths.nativeRoot, journal.operations[0].target);
    const bytes = Buffer.from([0xff, 0x00, 0x80, 0x41]);
    await fs.writeFile(staged, bytes);

    await applyNativeTransaction(paths, journal);

    expect(await fs.readFile(target)).toEqual(bytes);
  });

  it('rejects an oversized legacy staged object before loading or copying it', async () => {
    await createNativeTransaction(paths, journal);
    const staged = path.join(paths.nativeRoot, journal.operations[0].staged!);
    await fs.writeFile(staged, 'x');
    await fs.truncate(staged, 64 * 1024 * 1024 + 1);

    await expect(applyNativeTransaction(paths, journal)).rejects.toThrow('exceeds 67108864 bytes');
    await expect(
      fs.access(path.join(paths.nativeRoot, journal.operations[0].target)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects event and journal symlinks instead of following them',
    async () => {
      await createNativeTransaction(paths, journal);
      const tx = nativeTransactionPaths(paths, journal.id);
      const externalEvents = path.join(projectRoot, 'external-events.jsonl');
      const externalJournal = path.join(projectRoot, 'external-transaction.json');
      await fs.copyFile(tx.events, externalEvents);
      await fs.copyFile(tx.journal, externalJournal);

      await fs.rm(tx.events);
      await fs.symlink(externalEvents, tx.events, 'file');
      await expect(readNativeTransactionEvents(paths, journal.id)).rejects.toThrow(
        /regular file|outside/u,
      );

      await fs.rm(tx.journal);
      await fs.symlink(externalJournal, tx.journal, 'file');
      await expect(readNativeTransaction(paths, journal.id)).rejects.toThrow(
        /regular file|outside/u,
      );
    },
  );

  it('fails closed when the event-log parent is replaced during a protected read', async () => {
    await createNativeTransaction(paths, journal);
    const tx = nativeTransactionPaths(paths, journal.id);
    const displaced = `${tx.directory}-displaced`;

    await expect(
      readNativeTransactionEvents(paths, journal.id, {
        hooks: {
          async afterParentChainCaptured() {
            await fs.rename(tx.directory, displaced);
            await fs.mkdir(tx.directory);
            await fs.copyFile(path.join(displaced, 'events.jsonl'), tx.events);
          },
        },
      }),
    ).rejects.toThrow(/parent changed during I\/O|changed while reading/u);
  });

  it('fails closed when the journal parent is replaced during a protected read', async () => {
    await createNativeTransaction(paths, journal);
    const tx = nativeTransactionPaths(paths, journal.id);
    const displaced = `${tx.directory}-journal-displaced`;

    await expect(
      readNativeTransaction(paths, journal.id, {
        hooks: {
          async afterParentChainCaptured() {
            await fs.rename(tx.directory, displaced);
            await fs.mkdir(tx.directory);
            await fs.copyFile(path.join(displaced, 'transaction.json'), tx.journal);
          },
        },
      }),
    ).rejects.toThrow(/parent changed during I\/O|changed while reading/u);
  });
});
