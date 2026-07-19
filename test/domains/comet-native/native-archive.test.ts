import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  archiveNativeChange,
  NativeArchivePreflightError,
} from '../../../domains/comet-native/native-archive.js';
import { nativeArchiveTransactionPaths } from '../../../domains/comet-native/native-archive-transaction.js';
import {
  createNativeChange,
  readNativeChangeFile,
} from '../../../domains/comet-native/native-change.js';
import { sha256File } from '../../../domains/comet-native/native-hash.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  resolveSelectedNativeChange,
  selectNativeChange,
} from '../../../domains/comet-native/native-selection.js';
import { readNativeTransaction } from '../../../domains/comet-native/native-transaction.js';
import type {
  NativeProjectPaths,
  NativeSpecChange,
} from '../../../domains/comet-native/native-types.js';
import { NATIVE_RUN_STORAGE } from '../../../domains/engine/storage-layout.js';
import { readRunStateAt } from '../../../domains/engine/storage-run.js';
import {
  prepareNativeArchiveFixture,
  readyNativeArchivePreflight,
} from '../../helpers/native-archive.js';

describe('Native archive', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('applies create, replace, and remove specs before archiving the active change', async () => {
    const replace = path.join(paths.specsDir, 'authentication', 'spec.md');
    const remove = path.join(paths.specsDir, 'legacy-auth', 'spec.md');
    await fs.mkdir(path.dirname(replace), { recursive: true });
    await fs.mkdir(path.dirname(remove), { recursive: true });
    await fs.writeFile(replace, 'old authentication\n');
    await fs.writeFile(remove, 'legacy authentication\n');
    const specChanges: NativeSpecChange[] = [
      { capability: 'sessions', operation: 'create', source: 'specs/sessions.md', base_hash: null },
      {
        capability: 'authentication',
        operation: 'replace',
        source: 'specs/authentication.md',
        base_hash: await sha256File(replace),
      },
      {
        capability: 'legacy-auth',
        operation: 'remove',
        base_hash: await sha256File(remove),
      },
    ];
    const now = new Date('2026-07-14T02:00:00.000Z');
    const { changeDir } = await prepareNativeArchiveFixture({
      paths,
      name: 'auth-update',
      specChanges,
      proposedSpecs: {
        'specs/sessions.md': 'session spec\n',
        'specs/authentication.md': 'new auth spec\n',
      },
    });
    await selectNativeChange(paths, 'auth-update');
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'auth-update',
      now,
    });

    const result = await archiveNativeChange({
      paths,
      name: 'auth-update',
      expectedPreflightHash,
      now,
    });

    expect(result.archiveDir).toBe(path.join(paths.archiveDir, '2026-07-14-auth-update'));
    expect(await fs.readFile(path.join(paths.specsDir, 'sessions', 'spec.md'), 'utf8')).toBe(
      'session spec\n',
    );
    expect(await fs.readFile(replace, 'utf8')).toBe('new auth spec\n');
    await expect(fs.access(remove)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(changeDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      await readNativeChangeFile(path.join(result.archiveDir, 'comet-state.yaml')),
    ).toMatchObject({
      archived: true,
      phase: 'archive',
    });
    expect((await readRunStateAt(result.archiveDir, NATIVE_RUN_STORAGE))?.status).toBe('completed');
    expect(await readNativeTransaction(paths, result.transactionId)).toMatchObject({
      schema: 'comet.native.transaction.v2',
      kind: 'archive',
      status: 'committed',
      preflightHash: expectedPreflightHash,
    });
    const storedJournal = JSON.parse(
      await fs.readFile(nativeArchiveTransactionPaths(paths, result.transactionId).journal, 'utf8'),
    ) as Record<string, unknown>;
    expect(storedJournal).not.toHaveProperty('projectRoot');
    expect(storedJournal).not.toHaveProperty('nativeRoot');
    expect(JSON.stringify(storedJournal)).not.toContain(projectRoot);
    expect(storedJournal.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'write',
          expectedTargetHash: null,
          stagedHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
        expect.objectContaining({
          type: 'move',
          expectedSourceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          expectedTargetHash: null,
        }),
      ]),
    );
    await expect(
      fs.access(path.join(paths.projectRoot, '.comet', 'current-change.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('supports an archive with no spec changes', async () => {
    const now = new Date('2026-07-15T00:00:00.000Z');
    await prepareNativeArchiveFixture({ paths, name: 'docs-only' });
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'docs-only',
      now,
    });
    const result = await archiveNativeChange({
      paths,
      name: 'docs-only',
      expectedPreflightHash,
      now,
    });
    expect(await fs.readdir(paths.specsDir).catch(() => [])).toEqual([]);
    expect(
      await readNativeChangeFile(path.join(result.archiveDir, 'comet-state.yaml')),
    ).toMatchObject({
      archived: true,
    });
  });

  it('preserves the current selection when archiving a different Native change', async () => {
    const now = new Date('2026-07-15T00:00:00.000Z');
    await createNativeChange({ paths, name: 'selected-change', language: 'en' });
    await prepareNativeArchiveFixture({ paths, name: 'archived-change' });
    await selectNativeChange(paths, 'selected-change');
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'archived-change',
      now,
    });

    await archiveNativeChange({
      paths,
      name: 'archived-change',
      expectedPreflightHash,
      now,
    });

    expect(await resolveSelectedNativeChange(paths)).toBe('selected-change');
  });

  it('refuses a transactions junction that would stage archive data outside comet', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-transactions-outside-'));
    try {
      const specChanges: NativeSpecChange[] = [
        {
          capability: 'sessions',
          operation: 'create',
          source: 'specs/sessions.md',
          base_hash: null,
        },
      ];
      const now = new Date('2026-07-17T00:00:00.000Z');
      await prepareNativeArchiveFixture({
        paths,
        name: 'unsafe-transactions',
        specChanges,
        proposedSpecs: { 'specs/sessions.md': 'session spec\n' },
      });
      const expectedPreflightHash = await readyNativeArchivePreflight({
        paths,
        name: 'unsafe-transactions',
        now,
      });
      await fs.rm(paths.transactionsDir, { recursive: true, force: true });
      await fs.symlink(
        outside,
        paths.transactionsDir,
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      await expect(
        archiveNativeChange({
          paths,
          name: 'unsafe-transactions',
          expectedPreflightHash,
          now,
        }),
      ).rejects.toThrow('resolves outside the Native root');
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('returns structured base-hash conflicts and leaves canonical specs unchanged', async () => {
    const canonical = path.join(paths.specsDir, 'authentication', 'spec.md');
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, 'expected canonical\n');
    const expectedHash = await sha256File(canonical);
    const now = new Date('2026-07-17T00:00:00.000Z');
    const { changeDir } = await prepareNativeArchiveFixture({
      paths,
      name: 'conflicting-auth',
      specChanges: [
        {
          capability: 'authentication',
          operation: 'replace',
          source: 'specs/authentication.md',
          base_hash: expectedHash,
        },
      ],
      proposedSpecs: { 'specs/authentication.md': 'proposed spec\n' },
    });
    // Preview the exact facts first, then simulate another writer changing the canonical spec.
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'conflicting-auth',
      now,
    });
    await fs.writeFile(canonical, 'current canonical\n');

    let thrown: unknown;
    try {
      await archiveNativeChange({
        paths,
        name: 'conflicting-auth',
        expectedPreflightHash,
        now,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NativeArchivePreflightError);
    expect(thrown).toMatchObject({ code: 'native-archive-preflight' });
    expect(await fs.readFile(canonical, 'utf8')).toBe('current canonical\n');
    expect(await fs.stat(changeDir)).toBeTruthy();
  });

  it('never overwrites an existing date-prefixed archive target', async () => {
    const now = new Date('2026-07-16T00:00:00.000Z');
    const { changeDir } = await prepareNativeArchiveFixture({
      paths,
      name: 'immutable-target',
    });
    const expectedPreflightHash = await readyNativeArchivePreflight({
      paths,
      name: 'immutable-target',
      now,
    });
    const target = path.join(paths.archiveDir, '2026-07-16-immutable-target');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'sentinel.txt'), 'keep');
    await expect(
      archiveNativeChange({
        paths,
        name: 'immutable-target',
        expectedPreflightHash,
        now,
      }),
    ).rejects.toBeInstanceOf(NativeArchivePreflightError);
    expect(await fs.readFile(path.join(target, 'sentinel.txt'), 'utf8')).toBe('keep');
    expect(await fs.stat(changeDir)).toBeTruthy();
  });

  it('refuses canonical spec junctions that would write outside comet', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-spec-outside-'));
    try {
      await fs.mkdir(paths.specsDir, { recursive: true });
      await fs.symlink(
        outside,
        path.join(paths.specsDir, 'escaped-spec'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const now = new Date('2026-07-17T00:00:00.000Z');
      await prepareNativeArchiveFixture({
        paths,
        name: 'escaped-spec-change',
        specChanges: [
          {
            capability: 'escaped-spec',
            operation: 'create',
            source: 'specs/escaped-spec.md',
            base_hash: null,
          },
        ],
        proposedSpecs: { 'specs/escaped-spec.md': 'outside denied\n' },
      });

      await expect(
        readyNativeArchivePreflight({ paths, name: 'escaped-spec-change', now }),
      ).rejects.toThrow(/must be a real directory|outside the Native root/u);
      await expect(fs.access(path.join(outside, 'spec.md'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
