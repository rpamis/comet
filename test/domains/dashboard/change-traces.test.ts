import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  changeTraceStatistics,
  collectChangeTrace,
  collectChangeTraceIndex,
} from '../../../domains/dashboard/change-traces.js';
import {
  recordRuntimeTraceSpans,
  type RuntimeTraceSpan,
} from '../../../platform/process/runtime-trace.js';
import {
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { startDashboardServer } from '../../../domains/dashboard/server.js';

describe('Change trace observation', () => {
  let directory: string, project: string;
  const origin = Date.now() - 100000;
  const at = (offset: number) => new Date(origin + offset).toISOString();
  const span = (
    id: string,
    start: number | null,
    end: number | null,
    extra: Partial<RuntimeTraceSpan> = {},
  ): RuntimeTraceSpan => ({
    traceId: 'workflow:native:example',
    spanId: id,
    parentSpanId: 'root',
    workflow: 'native',
    change: 'example',
    runId: 'example',
    kind: 'action',
    name: id,
    status: 'succeeded',
    startedAt: start === null ? null : at(start),
    endedAt: end === null ? null : at(end),
    updatedAt: at(1000),
    revision: 3,
    attempt: 1,
    ...extra,
  });
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-trace-view-'));
    project = path.join(directory, 'project');
    await fs.mkdir(project);
    vi.stubEnv('COMET_DATA_DIR', path.join(directory, 'data'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  });
  it('unions parallel execution, subtracts explicit waiting and keeps missing timings unknown', () => {
    const result = changeTraceStatistics(
      [
        span('a', 0, 100),
        span('b', 30, 70),
        span('wait', 40, 60, { kind: 'wait' }),
        span('missing', null, null),
        span('root', 0, 200, { kind: 'workflow' }),
      ],
      origin + 200,
    );
    expect(result.observedWorkMs).toBe(80);
    expect(result.waitMs).toBe(20);
    expect(result.unknownTiming).toBe(1);
    expect(
      changeTraceStatistics([span('unknown', 0, null, { status: 'unknown' })], origin + 200)
        .observedWorkMs,
    ).toBeNull();
  });
  it('shows failed attempts while keeping a recovered phase successful and filters workflows', async () => {
    await recordRuntimeTraceSpans(project, [
      span('root', 0, 100, { parentSpanId: null, kind: 'workflow' }),
      span('try1', 0, 10, {
        status: 'failed',
        attributes: { phase: 'build', actionId: 'work' },
        attempt: 1,
      }),
      span('try2', 20, 40, { attributes: { phase: 'build', actionId: 'work' }, attempt: 2 }),
      span('other', 40, 60, { attributes: { phase: 'build', actionId: 'other' }, attempt: 1 }),
    ]);
    const detail = await collectChangeTrace(project, 'workflow:native:example');
    expect(detail).toMatchObject({ retries: 1, firstPassRate: 0.5, snapshot: false });
    expect(detail!.nodes.find((node) => node.spanId === 'phase:build')).toMatchObject({
      status: 'succeeded',
      timing: 'range',
    });
    expect(detail!.nodes.find((node) => node.spanId === 'try1')!.status).toBe('failed');
    expect((await collectChangeTraceIndex(project, 'classic')).traces).toEqual([]);
    expect((await collectChangeTraceIndex(project, 'native')).traces).toHaveLength(1);
    expect(
      (await collectChangeTraceIndex(project, 'native', { from: at(0), to: at(100) })).traces,
    ).toHaveLength(1);
    expect(
      (await collectChangeTraceIndex(project, 'native', { from: at(1), to: at(100) })).traces,
    ).toEqual([]);
  });
  it('reads old SDK snapshots without inventing timestamps or creating observability storage', async () => {
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(project), 'sdk-runs', 'native'),
    });
    const runtime = createRuntime({
      store,
      workflows: [
        {
          id: 'history',
          version: '1',
          entry: 'build.work',
          steps: { 'build.work': { type: 'call_tool', ref: 'work' } },
        },
      ],
    });
    await runtime.start({
      runId: 'legacy',
      workflow: { id: 'history', version: '1' },
      input: null,
    });
    const root = path.dirname(resolveWorkspaceRuntimeRootSync(project));
    const before = await fs.readdir(root);
    const index = await collectChangeTraceIndex(project);
    expect(index.traces[0]).toMatchObject({
      snapshot: true,
      startedAt: null,
      updatedAt: null,
      observedWorkMs: null,
    });
    expect(
      (
        await collectChangeTraceIndex(project, 'all', {
          from: at(-100000),
          to: new Date().toISOString(),
        })
      ).traces,
    ).toEqual([]);
    const detail = await collectChangeTrace(project, index.traces[0].traceId);
    expect(detail!.nodes.every((node) => node.startedAt === null && node.endedAt === null)).toBe(
      true,
    );
    expect(await fs.readdir(root)).toEqual(before);
  });
  it('serves only project-scoped GET/HEAD reads and rejects missing identities and mutations', async () => {
    const server = await startDashboardServer({ projectPath: project, port: 0 });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const projects = await (await fetch(base + '/api/dashboard/projects')).json();
      const url = base + '/api/dashboard/projects/' + projects.currentProjectId;
      expect((await (await fetch(url + '/change-traces')).json()).traces).toEqual([]);
      expect((await fetch(url + '/change-traces?workflow=bad')).status).toBe(400);
      expect((await fetch(url + '/change-traces?from=bad&to=bad')).status).toBe(400);
      expect((await fetch(url + '/change-trace')).status).toBe(400);
      expect(
        (await fetch(url + '/change-trace?traceId=workflow%3Anative%3A..%2F..%2Fother')).status,
      ).toBe(404);
      expect(
        (
          await fetch(url + '/change-traces', {
            method: 'POST',
            headers: { Origin: base, 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(405);
      expect((await fetch(url + '/change-traces', { method: 'HEAD' })).status).toBe(200);
      expect(await fs.readdir(directory)).toEqual(['project']);
    } finally {
      await server.close();
    }
  });
});
