import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
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
  it('uses the source index and preserves generation without reading unchanged payloads', async () => {
    let sources: DashboardSummarySource[] = [
      { key: 'a', fingerprint: 'one', read: async () => [record('a')] },
    ];
    const index = new DashboardSummaryIndex({
      projectRoot: root,
      cacheRoot: root,
      namespace: 'test',
      discover: async () => sources,
    });
    await index.refresh();
    const initial = await index.metadata();
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
    try {
      await index.refresh();
      expect((await index.metadata())?.generation).toBe(initial?.generation);
      expect(prepare.mock.calls.some(([sql]) => sql.includes('SELECT record_key,payload'))).toBe(
        false,
      );
    } finally {
      prepare.mockRestore();
    }
    const db = new DatabaseSync(index.databasePath);
    try {
      const plan = db
        .prepare(
          'EXPLAIN QUERY PLAN SELECT * FROM dashboard_summary_rows WHERE namespace=? AND source_key=?',
        )
        .all('test', 'a');
      expect(JSON.stringify(plan)).toContain('dashboard_summary_source');
    } finally {
      db.close();
    }
    sources = [];
    await index.refresh();
    expect((await index.metadata())?.generation).not.toBe(initial?.generation);
    expect((await index.query()).total).toBe(0);
  });
  it('charges discovery time against the materialization budget while making progress', async () => {
    let time = 1000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => time);
    const read = vi.fn(async () => [record('a')]);
    try {
      const index = new DashboardSummaryIndex({
        projectRoot: root,
        cacheRoot: root,
        namespace: 'budget',
        discover: async () => {
          time += 1000;
          return ['a', 'b', 'c'].map((key) => ({ key, fingerprint: 'one', read }));
        },
      });
      await index.refresh({ budgetMs: 100 });
      expect(read).toHaveBeenCalledTimes(1);
      expect(await index.metadata()).toMatchObject({
        indexing: true,
        indexedCount: 1,
        sourceCount: 3,
      });
    } finally {
      now.mockRestore();
    }
  });
  it('starts the refresh interval after a slow discovery completes', async () => {
    let time = 1000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => time);
    const discover = vi.fn(async () => {
      time += 5000;
      return [{ key: 'a', fingerprint: 'one', read: async () => [record('a')] }];
    });
    try {
      const index = new DashboardSummaryIndex({
        projectRoot: root,
        cacheRoot: root,
        namespace: 'slow',
        refreshIntervalMs: 3000,
        discover,
      });
      await index.refresh();
      await index.ensure();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(discover).toHaveBeenCalledTimes(1);
      time += 3001;
      await index.ensure();
      await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(2));
    } finally {
      now.mockRestore();
    }
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
  it('reads at most four sources concurrently and never exceeds maxSources', async () => {
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    const finished: string[] = [];
    const index = new DashboardSummaryIndex({
      projectRoot: root,
      cacheRoot: root,
      namespace: 'parallel',
      discover: async () =>
        Array.from({ length: 10 }, (_, i) => ({
          key: String(i),
          fingerprint: 'one',
          read: async () => {
            started.push(String(i));
            active++;
            peak = Math.max(peak, active);
            await gate;
            active--;
            finished.push(String(i));
            return [record(String(i))];
          },
        })),
    });
    const refresh = index.refresh({ maxSources: 6 });
    try {
      await vi.waitFor(() => expect(started).toHaveLength(4));
      expect(active).toBe(4);
    } finally {
      release();
      await refresh;
    }
    expect(peak).toBe(4);
    expect(started).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(finished).toHaveLength(6);
    expect(active).toBe(0);
    expect(await index.metadata()).toMatchObject({ indexedCount: 6, indexing: true });
  });
  it('starts a budgeted refresh with one source and stops before another batch after expiry', async () => {
    let time = 1000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => time);
    const started: string[] = [];
    try {
      const index = new DashboardSummaryIndex({
        projectRoot: root,
        cacheRoot: root,
        namespace: 'budgeted-parallel',
        discover: async () =>
          Array.from({ length: 10 }, (_, i) => ({
            key: String(i),
            fingerprint: 'one',
            read: async () => {
              started.push(String(i));
              if (i === 1) time += 101;
              return [record(String(i))];
            },
          })),
      });
      await index.refresh({ budgetMs: 100, maxSources: 8 });
      expect(started).toEqual(['0', '1', '2', '3', '4']);
      expect(await index.metadata()).toMatchObject({ indexedCount: 5, indexing: true });
    } finally {
      now.mockRestore();
    }
  });
  it('returns the budgeted first source before completing the background index', async () => {
    let time = 1000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => time);
    let releaseInitial!: () => void;
    let releaseBackground!: () => void;
    const initial = new Promise<void>((resolve) => {
      releaseInitial = resolve;
    });
    const background = new Promise<void>((resolve) => {
      releaseBackground = resolve;
    });
    let discoveries = 0;
    const started: string[] = [];
    const sources = Array.from({ length: 8 }, (_, i) => ({
      key: String(i),
      fingerprint: 'one',
      read: async () => {
        started.push(String(i));
        if (i === 0) {
          await initial;
          time += 1000;
        }
        return [record(String(i))];
      },
    }));
    const index = new DashboardSummaryIndex({
      projectRoot: root,
      cacheRoot: root,
      namespace: 'initial-background',
      discover: async () => {
        if (++discoveries > 1) await background;
        return sources;
      },
    });
    const ensure = index.ensure();
    try {
      await vi.waitFor(() => expect(started).toEqual(['0']));
      releaseInitial();
      await ensure;
      expect(await index.query()).toMatchObject({
        total: 1,
        indexedCount: 1,
        sourceCount: 8,
        indexing: true,
      });
      await vi.waitFor(() => expect(discoveries).toBe(2));
      expect(started).toEqual(['0']);
      releaseBackground();
      await vi.waitFor(async () =>
        expect(await index.query()).toMatchObject({ total: 8, indexedCount: 8, indexing: false }),
      );
      expect(started).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    } finally {
      releaseInitial();
      releaseBackground();
      await ensure;
      await index.refresh();
      now.mockRestore();
    }
  });
  it('keeps source and error ordering after out-of-order completion and retries failures', async () => {
    let fail = false;
    const finished: string[] = [];
    const reads: string[] = [];
    const releases = new Map<string, () => void>();
    const sources = ['a', 'b', 'c', 'd'].map((key) => ({
      key,
      fingerprint: 'one',
      read: async () => {
        reads.push(key);
        if (!fail) return [record(key)];
        await new Promise<void>((resolve) => releases.set(key, resolve));
        finished.push(key);
        if (key === 'b' || key === 'd') throw new Error(`failed-${key}`);
        return [{ ...record('shared'), payload: { id: key, status: 'completed' } }];
      },
    }));
    const index = new DashboardSummaryIndex({
      projectRoot: root,
      cacheRoot: root,
      namespace: 'ordered-parallel',
      discover: async () => sources,
    });
    await index.refresh();
    fail = true;
    for (const source of sources) source.fingerprint = 'two';
    const refresh = index.refresh();
    try {
      await vi.waitFor(() => expect(releases.size).toBe(4));
      for (const key of ['d', 'c', 'b', 'a']) {
        releases.get(key)!();
        await Promise.resolve();
      }
    } finally {
      for (const release of releases.values()) release();
      await refresh;
    }
    expect(finished).toEqual(['d', 'c', 'b', 'a']);
    expect((await index.metadata())?.errors).toEqual(['b: failed-b', 'd: failed-d']);
    expect(await index.find('shared')).toEqual({ id: 'c', status: 'completed' });
    expect(await index.find('b')).toEqual({ id: 'b', status: 'completed' });
    expect(await index.find('d')).toEqual({ id: 'd', status: 'completed' });
    fail = false;
    reads.length = 0;
    await index.refresh();
    expect(reads).toEqual(['b', 'd']);
    expect((await index.metadata())?.errors).toEqual([]);
    expect(await index.find('b')).toEqual({ id: 'b', status: 'completed' });
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
