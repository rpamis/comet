import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bindRuntimeTrace,
  observeRuntimeSpan,
  readRuntimeTraceSpans,
  recordRuntimeTraceSpans,
  type RuntimeTraceSpan,
} from '../../../platform/process/runtime-trace.js';
import {
  observeRuntimeOperation,
  readRuntimePerformanceRecords,
} from '../../../platform/process/runtime-performance.js';

describe('Runtime trace storage and propagation', () => {
  let directory: string;
  let project: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-trace-'));
    project = path.join(directory, 'project');
    await fs.mkdir(project);
    vi.stubEnv('COMET_DATA_DIR', path.join(directory, 'data'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const span = (overrides: Partial<RuntimeTraceSpan> = {}): RuntimeTraceSpan => ({
    traceId: 'trace',
    spanId: 'root',
    parentSpanId: null,
    workflow: 'native',
    change: 'example',
    runId: 'example',
    kind: 'action',
    name: 'build.implement',
    status: 'running',
    startedAt: new Date(Date.now() - 100).toISOString(),
    endedAt: null,
    updatedAt: new Date().toISOString(),
    revision: 1,
    ...overrides,
  });
  it('does not create storage on a read or an unassociated operation', async () => {
    expect((await readRuntimeTraceSpans(project)).spans).toEqual([]);
    await observeRuntimeSpan(
      { projectRoot: () => project, workflow: 'native', kind: 'command', name: 'show' },
      async () => 1,
    );
    expect(await fs.readdir(directory)).toEqual(['project']);
  });
  it('retains the recorded start across processes, rejects stale updates and redacts summaries', async () => {
    const first = span();
    await recordRuntimeTraceSpans(project, [first]);
    vi.stubEnv('TEST_TRACE_SECRET', 'private-value');
    await recordRuntimeTraceSpans(project, [
      span({
        revision: 3,
        startedAt: null,
        endedAt: new Date().toISOString(),
        status: 'succeeded',
        summary: 'api_key=private-value',
      }),
    ]);
    await recordRuntimeTraceSpans(project, [span({ revision: 2, status: 'failed' })]);
    const read = (await readRuntimeTraceSpans(project)).spans[0];
    expect(read).toMatchObject({ status: 'succeeded', revision: 3, startedAt: first.startedAt });
    expect(read.endedAt).not.toBeNull();
    expect(read.summary).not.toContain('private-value');
    expect((await readRuntimePerformanceRecords(project)).records).toEqual([]);
  });
  it('accepts a delayed start without rolling back a newer terminal outcome', async () => {
    const start = span();
    await recordRuntimeTraceSpans(project, [
      span({
        revision: 3,
        status: 'succeeded',
        startedAt: null,
        endedAt: new Date().toISOString(),
      }),
    ]);
    await recordRuntimeTraceSpans(project, [start]);
    expect((await readRuntimeTraceSpans(project)).spans[0]).toMatchObject({
      revision: 3,
      status: 'succeeded',
      startedAt: start.startedAt,
    });
  });
  it('keeps parallel command trees and workspace identities separate, including failed checks', async () => {
    await Promise.all(
      ['one', 'two'].map((change) =>
        observeRuntimeOperation(
          { projectRoot: () => project, workflow: 'native', command: 'check' },
          async () => {
            bindRuntimeTrace({ workflow: 'native', change, runId: change });
            await observeRuntimeOperation(
              { projectRoot: () => project, workflow: 'native', kind: 'check', command: 'check' },
              async () => ({ exitCode: 1 }),
            );
            return { exitCode: 0 };
          },
        ),
      ),
    );
    const rows = (await readRuntimeTraceSpans(project)).spans;
    expect(rows).toHaveLength(4);
    for (const change of ['one', 'two']) {
      const group = rows.filter((row) => row.change === change);
      expect(new Set(group.map((row) => row.traceId)).size).toBe(1);
      expect(group.find((row) => row.kind === 'check')).toMatchObject({
        status: 'failed',
        parentSpanId: group.find((row) => row.kind === 'command')!.spanId,
      });
    }
    const second = path.join(directory, 'other');
    await fs.mkdir(second);
    expect((await readRuntimeTraceSpans(second)).spans).toEqual([]);
  });
  it('does not inherit a parent trace when nested work enters another workspace', async () => {
    const other = path.join(directory, 'child-worktree');
    await fs.mkdir(other);
    await observeRuntimeSpan(
      { projectRoot: () => project, workflow: 'native', kind: 'command', name: 'parent' },
      async () => {
        bindRuntimeTrace({ workflow: 'native', change: 'parent', runId: 'parent' });
        await observeRuntimeSpan(
          { projectRoot: () => other, workflow: 'native', kind: 'check', name: 'child-check' },
          async () => {
            bindRuntimeTrace({ workflow: 'native', change: 'child', runId: 'child' });
          },
        );
      },
    );
    const parent = (await readRuntimeTraceSpans(project)).spans;
    const child = (await readRuntimeTraceSpans(other)).spans;
    expect(parent).toHaveLength(1);
    expect(child).toHaveLength(1);
    expect(parent[0]).toMatchObject({ change: 'parent', parentSpanId: null, status: 'succeeded' });
    expect(child[0]).toMatchObject({ change: 'child', parentSpanId: null, status: 'succeeded' });
    expect(parent[0].traceId).not.toBe(child[0].traceId);
  });
  it('preserves original values and errors when observation fails', async () => {
    vi.stubEnv('COMET_DATA_DIR', project);
    const value = { secret: 'original' };
    expect(
      await observeRuntimeSpan(
        { projectRoot: () => project, workflow: 'classic', kind: 'command', name: 'next' },
        async () => {
          bindRuntimeTrace({ workflow: 'classic', change: 'example', runId: 'example' });
          return value;
        },
      ),
    ).toBe(value);
    const error = new Error('original');
    await expect(
      observeRuntimeSpan(
        { projectRoot: () => project, workflow: 'classic', kind: 'command', name: 'next' },
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);
  });
  it('bounds UTF-8 payload bytes for Chinese summaries and attributes', async () => {
    await recordRuntimeTraceSpans(project, [
      span({
        name: '节'.repeat(240),
        summary: '结果'.repeat(500),
        attributes: { details: '说明'.repeat(1000) },
      }),
    ]);
    const [record] = (await readRuntimeTraceSpans(project)).spans;
    expect(record).toMatchObject({ spanId: 'root', status: 'running' });
    expect(Buffer.byteLength(JSON.stringify(record), 'utf8')).toBeLessThanOrEqual(4096);
    expect(record.summary).toBeTruthy();
  });
  it('bounds reads, discloses truncation, and excludes expired spans', async () => {
    await recordRuntimeTraceSpans(project, [
      span({ spanId: 'expired', updatedAt: new Date(Date.now() - 9 * 86400000).toISOString() }),
      span(),
      span({ spanId: 'second' }),
    ]);
    const read = await readRuntimeTraceSpans(project, { limit: 1 });
    expect(read.truncated).toBe(true);
    expect(read.spans).toHaveLength(1);
    expect((await readRuntimeTraceSpans(project, { traceId: 'missing' })).spans).toEqual([]);
  });
});
