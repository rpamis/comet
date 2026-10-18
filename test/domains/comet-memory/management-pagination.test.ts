import { mkdtemp, rm } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FileMemoryRepository,
  PersonalMemoryService,
} from '../../../domains/comet-memory/index.js';

async function fixture(
  run: (
    repository: FileMemoryRepository,
    service: PersonalMemoryService,
    root: string,
  ) => Promise<void>,
  count = 225,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'memory-pagination-'));
  try {
    const repository = new FileMemoryRepository(root);
    const service = new PersonalMemoryService({ repository });
    await service.remember({
      scope: 'global',
      category: 'preference',
      text: 'Use concise replies.',
    });
    const state = await repository.readState();
    const template = state.records[0]!;
    await repository.writeState({
      ...state,
      records: Array.from({ length: count }, (_, index) => ({
        ...template,
        id: `memory-${String(index).padStart(4, '0')}`,
        text: `Unique memory ${String(index).padStart(4, '0')}: ${'文'.repeat(150)}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      })),
    });
    await run(repository, service, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('personal memory management pagination', () => {
  it('makes every record reachable across entry and byte bounded pages, including old search matches', async () => {
    await fixture(async (_repository, service) => {
      const first = await service.manage();
      expect(first).toMatchObject({ total: 225, offset: 0, truncated: true });
      expect(first.records.length).toBeLessThan(100);
      expect(Buffer.byteLength(JSON.stringify(first.records))).toBeLessThan(33 * 1024);
      const byEntries = await service.manage({ maxBytes: 1024 * 1024 });
      expect(byEntries.records).toHaveLength(100);
      expect(byEntries.nextOffset).toBe(100);
      const ids: string[] = [];
      let offset: number | undefined = 0;
      do {
        const page = await service.manage({ offset });
        ids.push(...page.records.map((record) => record.id));
        expect(page.total).toBe(225);
        if (page.nextOffset !== undefined) expect(page.nextOffset).toBeGreaterThan(offset!);
        offset = page.nextOffset;
      } while (offset !== undefined);
      expect(new Set(ids).size).toBe(225);
      expect(ids).toHaveLength(225);
      expect(ids.at(-1)).toBe('memory-0000');
      const searched = await service.manage({ query: 'Unique memory 0000:' });
      expect(searched).toMatchObject({
        total: 1,
        truncated: false,
        records: [{ id: 'memory-0000' }],
      });
      expect(await service.manage({ managementFilter: 'history' })).toMatchObject({
        total: 0,
        records: [],
        counts: { all: 225, profile: 225 },
      });
    });
  });

  it('reports an oversized entry without losing it or exceeding the requested budget', async () => {
    await fixture(async (_repository, service) => {
      const page = await service.manage({ maxBytes: 10 });
      expect(page).toMatchObject({ records: [], total: 225, nextOffset: 0, truncated: true });
      expect(page.requiredBytes).toBeGreaterThan(10);
      const expanded = await service.manage({ maxBytes: page.requiredBytes });
      expect(expanded.records).toHaveLength(1);
      expect(expanded.nextOffset).toBe(1);
      expect(Buffer.byteLength(JSON.stringify(expanded.records[0]))).toBe(page.requiredBytes);
    });
  });

  it('refreshes totals and search after deletion and normalizes invalid offsets', async () => {
    await fixture(async (_repository, service) => {
      const old = await service.manage({ query: '0000:' });
      await service.remove(old.records[0]!.id, { permanent: true });
      const refreshed = await service.manage({ query: '0000:', managementFilter: 'profile' });
      expect(refreshed).toMatchObject({ total: 0, records: [] });
      expect(await service.manage({ offset: -1 })).toMatchObject({ offset: 0 });
      expect(await service.manage({ offset: Number.NaN })).toMatchObject({ offset: 0 });
      const end = await service.manage({ offset: 9999 });
      expect(end.offset).toBe(end.total);
      expect(end.nextOffset).toBeUndefined();
    });
  });

  it('keeps repeated reads write-free, reuses unchanged disk state and sees another repository writer', async () => {
    await fixture(async (repository, service, root) => {
      await service.status();
      const writes = vi.spyOn(repository, 'writeState');
      const diskReads = vi.spyOn(repository, 'readText');
      await Promise.all([
        service.status(),
        service.retrieve({ view: 'combined' }),
        service.manage(),
      ]);
      expect(writes).not.toHaveBeenCalled();
      expect(
        diskReads.mock.calls.filter(([file]) => file === '.comet/runtime/memory-state.json'),
      ).toHaveLength(0);
      const other = new PersonalMemoryService({ repository: new FileMemoryRepository(root) });
      await Promise.all([
        service.remember({
          scope: 'global',
          category: 'preference',
          text: 'Concurrent alpha preference.',
        }),
        other.remember({
          scope: 'global',
          category: 'preference',
          text: 'Concurrent beta preference.',
        }),
      ]);
      expect(
        (await service.manage({ query: 'Concurrent' })).records.map((record) => record.text).sort(),
      ).toEqual(['Concurrent alpha preference.', 'Concurrent beta preference.']);
      await repository.writeText('profile.md', '- [preference] Manual edit after cache.\n');
      expect((await service.manage({ query: 'Manual edit after cache.' })).records).toHaveLength(1);
      expect(writes).toHaveBeenCalled();
    });
  });

  it.each([{ ino: 0n }, { ctimeNs: 0n }, { mtimeNs: 0n }, { ino: undefined }])(
    'reads fresh bytes when filesystem identity is unavailable: %o',
    async (unavailableIdentity) => {
      await fixture(async (repository, _service, root) => {
        const state = await repository.readState();
        const signature = await fs.stat(path.join(root, '.comet/runtime/memory-state.json'), {
          bigint: true,
        });
        const stat = vi
          .spyOn(fs, 'stat')
          .mockResolvedValue({ ...signature, ...unavailableIdentity } as never);
        const reads = vi.spyOn(repository, 'readText');
        try {
          for (const text of ['alpha', 'bravo']) {
            await repository.writeText(
              '.comet/runtime/memory-state.json',
              JSON.stringify({ ...state, records: [{ ...state.records[0], text }] }),
            );
            expect((await repository.readState()).records[0]?.text).toBe(text);
          }
          expect(
            reads.mock.calls.filter(([file]) => file === '.comet/runtime/memory-state.json'),
          ).toHaveLength(2);
        } finally {
          stat.mockRestore();
          reads.mockRestore();
        }
      });
    },
  );

  it('initializes an empty repository once and leaves unchanged read snapshots on disk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'memory-empty-read-'));
    try {
      const repository = new FileMemoryRepository(root);
      const service = new PersonalMemoryService({ repository });
      const writes = vi.spyOn(repository, 'writeText');
      await service.status();
      expect(
        JSON.parse((await repository.readText('.comet/runtime/memory-state.json'))!),
      ).toMatchObject({ version: 3, records: [] });
      writes.mockClear();
      await Promise.all([
        service.status(),
        service.retrieve({ view: 'combined' }),
        service.manage(),
      ]);
      expect(writes).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('migrates state while keeping returned cached values isolated', async () => {
    await fixture(async (repository, service) => {
      const state = await repository.readState();
      const legacy = JSON.parse(JSON.stringify(state));
      delete legacy.records[0].authority;
      delete legacy.feedbackState;
      await repository.writeText('.comet/runtime/memory-state.json', JSON.stringify(legacy));
      const writes = vi.spyOn(repository, 'writeState');
      await service.status();
      expect(writes).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse((await repository.readText('.comet/runtime/memory-state.json'))!),
      ).toHaveProperty('feedbackState');
      const exposed = await repository.readState();
      (exposed.records as unknown[]).length = 0;
      expect((await repository.readState()).records).toHaveLength(225);
      writes.mockClear();
      await service.status();
      expect(writes).not.toHaveBeenCalled();
      const withMissingDefaults = JSON.parse(
        (await repository.readText('.comet/runtime/memory-state.json'))!,
      );
      delete withMissingDefaults.feedbackState;
      await repository.writeText(
        '.comet/runtime/memory-state.json',
        JSON.stringify(withMissingDefaults),
      );
      await service.status();
      expect(writes).toHaveBeenCalledTimes(1);
    });
  });
});
