import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  applyNativeTransaction,
  appendNativeTransactionEvent,
  createNativeTransaction,
  nativeTransactionPaths,
  parseNativeArchiveTransactionJournalV2,
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
    await ensureNativeDirectories(paths);
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

  it('validates every Native Archive v2 journal and operation binding', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const valid = {
      schema: 'comet.native.transaction.v2',
      id,
      kind: 'archive',
      status: 'prepared',
      change: 'example-change',
      createdAt: '2026-07-14T00:00:00.000Z',
      preflightHash: 'a'.repeat(64),
      operations: [
        {
          id: 'spec-1-example',
          type: 'write',
          target: 'specs/example/spec.md',
          staged: `runtime/transactions/${id}/staged/specs/example/spec.md`,
          expectedTargetHash: null,
          stagedHash: 'b'.repeat(64),
        },
        {
          id: 'archive-change',
          type: 'move',
          source: 'changes/example-change',
          target: 'archive/2026-07-14-example-change',
          expectedTargetHash: null,
          expectedSourceHash: 'c'.repeat(64),
        },
      ],
    };
    expect(parseNativeArchiveTransactionJournalV2(valid)).toMatchObject({
      schema: 'comet.native.transaction.v2',
      operations: valid.operations,
    });

    expect(
      parseNativeArchiveTransactionJournalV2({
        ...valid,
        operations: [
          {
            id: 'spec-1-example',
            type: 'write',
            target: 'specs/example/spec.md',
            staged: `runtime/transactions/${id}/staged/specs/example/spec.md`,
            backup: `runtime/transactions/${id}/backups/specs/example/spec.md`,
            expectedTargetHash: 'd'.repeat(64),
            stagedHash: 'b'.repeat(64),
          },
          {
            id: 'spec-2-removed',
            type: 'remove',
            target: 'specs/removed/spec.md',
            backup: `runtime/transactions/${id}/backups/specs/removed/spec.md`,
            expectedTargetHash: 'e'.repeat(64),
          },
          valid.operations[1],
        ],
      }),
    ).toMatchObject({
      operations: [
        expect.objectContaining({ type: 'write', backup: expect.any(String) }),
        expect.objectContaining({ type: 'remove', expectedTargetHash: 'e'.repeat(64) }),
        expect.objectContaining({ type: 'move' }),
      ],
    });

    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['unknown journal field', { extra: true }, 'unknown field'],
      ['schema', { schema: 'wrong' }, 'schema'],
      ['id', { id: 'bad' }, 'id'],
      ['kind', { kind: 'root-move' }, 'kind'],
      ['status', { status: 'unknown' }, 'status'],
      ['change', { change: '../escape' }, 'change name'],
      ['timestamp', { createdAt: 'not-a-date' }, 'createdAt'],
      ['preflight hash', { preflightHash: 'bad' }, 'preflightHash'],
      ['operations type', { operations: null }, 'operations must'],
      ['operation object', { operations: [null] }, 'operations[0]'],
      [
        'operation unknown field',
        { operations: [{ ...valid.operations[0], extra: true }] },
        'unknown field',
      ],
      ['operation id', { operations: [{ ...valid.operations[0], id: 'bad id' }] }, 'id is invalid'],
      [
        'operation type',
        { operations: [{ ...valid.operations[0], type: 'copy' }] },
        'invalid type',
      ],
      [
        'operation target',
        { operations: [{ ...valid.operations[0], target: '../outside' }] },
        'target must',
      ],
      [
        'write staged',
        { operations: [{ ...valid.operations[0], staged: undefined }] },
        'requires staged',
      ],
      [
        'write source',
        { operations: [{ ...valid.operations[0], source: 'changes/x' }] },
        'forbids source',
      ],
      [
        'write staged hash',
        { operations: [{ ...valid.operations[0], stagedHash: 'bad' }] },
        'stagedHash',
      ],
      [
        'write backup binding',
        { operations: [{ ...valid.operations[0], backup: 'runtime/backup' }] },
        'backup must match',
      ],
      [
        'remove operation',
        {
          operations: [
            {
              id: 'spec-1-example',
              type: 'remove',
              target: 'specs/example/spec.md',
              expectedTargetHash: null,
              backup: 'runtime/transactions/x/backups/specs/example/spec.md',
            },
            valid.operations[1],
          ],
        },
        'requires a bound target',
      ],
      [
        'move operation',
        {
          operations: [
            valid.operations[0],
            { ...valid.operations[1], expectedTargetHash: 'd'.repeat(64) },
          ],
        },
        'absent target',
      ],
      [
        'duplicate operation ids',
        {
          operations: [valid.operations[0], { ...valid.operations[1], id: valid.operations[0].id }],
        },
        'ids must be unique',
      ],
      ['missing archive move', { operations: [valid.operations[0]] }, 'must end with'],
      [
        'archive move position',
        { operations: [valid.operations[1], valid.operations[0]] },
        'must end with',
      ],
      [
        'spec target',
        {
          operations: [
            { ...valid.operations[0], target: 'specs/NotValid/spec.md' },
            valid.operations[1],
          ],
        },
        'spec target',
      ],
      [
        'staged ref',
        {
          operations: [
            { ...valid.operations[0], staged: 'runtime/other/staged.md' },
            valid.operations[1],
          ],
        },
        'staged ref',
      ],
    ];
    for (const [_label, patch, message] of cases) {
      const candidate = {
        ...valid,
        ...patch,
      };
      expect(() => parseNativeArchiveTransactionJournalV2(candidate), _label).toThrow(message);
    }
  });

  it('does not resolve the exact Runtime root under the Native artifact root', async () => {
    const source = path.join(paths.runtimeDir, 'staged-change');
    await fs.mkdir(source, { recursive: true });
    const rootMove = {
      ...journal,
      operations: [
        {
          id: 'move-runtime-root',
          type: 'move' as const,
          source: 'runtime/staged-change',
          target: 'runtime',
        },
      ],
    };
    await createNativeTransaction(paths, rootMove);

    await expect(applyNativeTransaction(paths, rootMove)).rejects.toThrow(
      'Move target already exists: runtime',
    );
    await expect(fs.stat(source)).resolves.toBeDefined();
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

  it('covers the legacy journal parser matrix before applying a transaction', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['non-object journal', null, 'must be an object'],
      ['unsupported schema', { ...journal, schema: 'v0' }, 'Unsupported Native transaction schema'],
      ['invalid id', { ...journal, id: 'bad' }, 'transaction id is invalid'],
      ['invalid kind', { ...journal, kind: 'other' }, 'kind is invalid'],
      ['invalid status', { ...journal, status: 'other' }, 'status is invalid'],
      ['relative project root', { ...journal, projectRoot: 'relative' }, 'roots must be absolute'],
      ['relative native root', { ...journal, nativeRoot: 'relative' }, 'roots must be absolute'],
      ['invalid change', { ...journal, change: '../outside' }, 'change name is invalid'],
      ['invalid timestamp', { ...journal, createdAt: 'not-a-date' }, 'createdAt is invalid'],
      ['missing operations', { ...journal, operations: null }, 'operations must be an array'],
      [
        'invalid operation object',
        { ...journal, operations: [null] },
        'operations[0] must be an object',
      ],
      [
        'unknown operation field',
        { ...journal, operations: [{ ...journal.operations[0], extra: true }] },
        'unknown field',
      ],
      [
        'invalid operation id',
        { ...journal, operations: [{ ...journal.operations[0], id: 'bad id' }] },
        'id is invalid',
      ],
      [
        'invalid operation type',
        { ...journal, operations: [{ ...journal.operations[0], type: 'copy' }] },
        'invalid type',
      ],
      [
        'remove with staged',
        {
          ...journal,
          operations: [
            { id: 'remove-spec', type: 'remove', target: 'specs/x.md', staged: 'runtime/x' },
          ],
        },
        'forbids source and staged',
      ],
      [
        'move without source',
        { ...journal, operations: [{ id: 'move-spec', type: 'move', target: 'archive/x' }] },
        'requires source',
      ],
      [
        'move with backup',
        {
          ...journal,
          operations: [
            {
              id: 'move-spec',
              type: 'move',
              source: 'changes/x',
              target: 'archive/x',
              backup: 'runtime/x',
            },
          ],
        },
        'forbids staged and backup',
      ],
      [
        'duplicate operation ids',
        { ...journal, operations: [journal.operations[0], { ...journal.operations[0] }] },
        'operation ids must be unique',
      ],
      ['undefined optional change', { ...journal, change: undefined }, ''],
    ];

    await fs.mkdir(nativeTransactionPaths(paths, journal.id).directory, { recursive: true });
    for (const [label, value, message] of cases) {
      await fs.writeFile(nativeTransactionPaths(paths, journal.id).journal, JSON.stringify(value));
      const assertion = expect(readNativeTransaction(paths, journal.id), label).rejects;
      if (message) await assertion.toThrow(message);
      else {
        const parsed = await readNativeTransaction(paths, journal.id);
        expect(parsed).toMatchObject({ schema: 'comet.native.transaction.v1' });
        expect(parsed).not.toHaveProperty('change');
      }
    }
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
    const staged = path.join(
      paths.runtimeDir,
      journal.operations[0].staged!.slice('runtime/'.length),
    );
    const target = path.join(paths.nativeRoot, journal.operations[0].target);
    const bytes = Buffer.from([0xff, 0x00, 0x80, 0x41]);
    await fs.writeFile(staged, bytes);

    await applyNativeTransaction(paths, journal);

    expect(await fs.readFile(target)).toEqual(bytes);
  });

  it('rejects an oversized legacy staged object before loading or copying it', async () => {
    await createNativeTransaction(paths, journal);
    const staged = path.join(
      paths.runtimeDir,
      journal.operations[0].staged!.slice('runtime/'.length),
    );
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
