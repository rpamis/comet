import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DashboardSummaryIndex,
  type DashboardSummarySource,
} from '../../../domains/dashboard/summary-index.js';

describe('Dashboard SQLite summary index', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-summary-index-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const record = (key: string, status = 'completed') => ({
    key,
    sortKey: key,
    search: key,
    status,
    payload: { id: key, status },
  });
  it('persists summaries and only reads changed sources after restart', async () => {
    const readA = vi.fn(async () => [record('a')]),
      readB = vi.fn(async () => [record('b')]);
    let sources: DashboardSummarySource[] = [
      { key: 'a', fingerprint: 'one', read: readA },
      { key: 'b', fingerprint: 'one', read: readB },
    ];
    const options = {
      projectRoot: root,
      cacheRoot: root,
      namespace: 'test',
      discover: async () => sources,
    };
    const first = new DashboardSummaryIndex(options);
    await first.refresh();
    expect((await first.query({ limit: 1 })).items).toEqual([{ id: 'a', status: 'completed' }]);
    const restarted = new DashboardSummaryIndex(options);
    await restarted.refresh();
    expect(readA).toHaveBeenCalledTimes(1);
    expect(readB).toHaveBeenCalledTimes(1);
    sources = [{ ...sources[0], fingerprint: 'two' }, sources[1]];
    await restarted.refresh();
    expect(readA).toHaveBeenCalledTimes(2);
    expect(readB).toHaveBeenCalledTimes(1);
    sources = [sources[1]];
    await restarted.refresh();
    expect((await restarted.query()).items).toEqual([{ id: 'b', status: 'completed' }]);
  });
  it('bounds initial materialization and reports incomplete indexing', async () => {
    const reads = vi.fn(async () => [record(String(reads.mock.calls.length))]);
    const index = new DashboardSummaryIndex({
      projectRoot: root,
      cacheRoot: root,
      namespace: 'test',
      discover: async () =>
        Array.from({ length: 100 }, (_, i) => ({
          key: String(i),
          fingerprint: 'one',
          read: reads,
        })),
    });
    await index.refresh({ maxSources: 3 });
    expect(reads).toHaveBeenCalledTimes(3);
    expect(await index.query()).toMatchObject({
      indexing: true,
      sourceCount: 100,
      indexedCount: 3,
      total: 3,
    });
  });
  it('filters and paginates in SQLite and keeps live reads out of the cached response', async () => {
    const index = new DashboardSummaryIndex({
      projectRoot: root,
      cacheRoot: root,
      namespace: 'test',
      discover: async () => [
        {
          key: 's',
          fingerprint: 'one',
          read: async () => [record('a', 'running'), record('b'), record('c')],
        },
      ],
    });
    await index.refresh();
    expect(await index.query({ statuses: ['completed'], limit: 1, offset: 1 })).toMatchObject({
      items: [{ id: 'c', status: 'completed' }],
      total: 2,
    });
    expect(await index.find('a')).toEqual({ id: 'a', status: 'running' });
  });
  it('keeps cached rows and reports a failed discovery', async () => {
    let fail = false;
    const index = new DashboardSummaryIndex({
      projectRoot: root,
      cacheRoot: root,
      namespace: 'test',
      discover: async () => {
        if (fail) throw new Error('source unavailable');
        return [{ key: 'a', fingerprint: 'one', read: async () => [record('a')] }];
      },
    });
    await index.refresh();
    fail = true;
    await expect(index.refresh()).rejects.toThrow('source unavailable');
    expect(await index.query()).toMatchObject({
      items: [{ id: 'a', status: 'completed' }],
      indexing: false,
      errors: ['source unavailable'],
    });
  });
  it('reports pending discovery for an empty cache before showing a newly created run', async () => {
    let sources: DashboardSummarySource[] = [];
    const index = new DashboardSummaryIndex({
      projectRoot: root,
      cacheRoot: root,
      namespace: 'test',
      refreshIntervalMs: 0,
      discover: async () => sources,
    });
    await index.refresh();
    sources = [{ key: 'a', fingerprint: 'one', read: async () => [record('a')] }];
    await index.ensure();
    expect(await index.query()).toMatchObject({ indexing: true, total: 0 });
    await vi.waitFor(async () =>
      expect((await index.query()).items).toEqual([{ id: 'a', status: 'completed' }]),
    );
  });
});
