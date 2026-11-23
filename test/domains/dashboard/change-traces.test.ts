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
  createMemoryRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { writeNativeManagedRunState } from '../../../domains/comet-native/native-sdk-state-store.js';
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
  it('lists Changes beyond the first hundred traces and retrieves their scoped records', async () => {
    const root = { parentSpanId: null, kind: 'workflow' } as const;
    await recordRuntimeTraceSpans(project, [
      ...Array.from({ length: 101 }, (_, index) =>
        span('root', 20, 30, { ...root, traceId: `recent-${index}`, change: 'recent' }),
      ),
      span('root', 0, 10, { ...root, traceId: 'older', change: 'older', updatedAt: at(500) }),
    ]);
    const server = await startDashboardServer({ projectPath: project, port: 0 });
    try {
      const base = `http://127.0.0.1:${server.port}/api/dashboard/projects`;
      const projects = await (await fetch(base)).json();
      const url = `${base}/${projects.currentProjectId}/change-traces`;
      const all = await (await fetch(url)).json();
      expect(all.traces).toHaveLength(100);
      expect(all.traces.every((trace: { change: string }) => trace.change === 'recent')).toBe(true);
      expect(all.changes).toEqual(['native:recent', 'native:older']);

      const selected = await (await fetch(`${url}?change=native%3Aolder`)).json();
      expect(selected.changes).toEqual(all.changes);
      expect(selected.traces).toEqual([expect.objectContaining({ traceId: 'older' })]);
      expect(selected.truncated).toBe(false);

      const range = new URLSearchParams({ change: 'native:older', from: at(20), to: at(100) });
      const outsideRange = await (await fetch(`${url}?${range}`)).json();
      expect(outsideRange.changes).toEqual(['native:recent']);
      expect(outsideRange.traces).toEqual([]);
      const otherWorkflow = await (
        await fetch(`${url}?workflow=classic&change=native%3Aolder`)
      ).json();
      expect(otherWorkflow.changes).toEqual([]);
      expect(otherWorkflow.traces).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('includes a copied Native archive checkpoint in all-time Change traces without restoring its Run', async () => {
    await writeProjectConfig(project, defaultProjectConfig('docs', 'en'));
    const name = 'archived-supervisor';
    const archiveRef = '2026-11-23-' + name;
    const nativeRoot = path.join(project, 'docs', 'comet');
    const archiveDirectory = path.join(nativeRoot, 'archive', archiveRef);
    await fs.mkdir(archiveDirectory, { recursive: true });
    const initial = createNativePortableState({ name, language: 'en' });
    const state = {
      ...initial,
      phase: 'archive',
      status: 'done',
      archived: true,
      loop: { ...initial.loop, stage: 'done' },
    } as const;
    const workflow = { id: 'comet-native', version: '1' };
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          ...workflow,
          entry: 'archive',
          steps: { archive: { type: 'call_tool', ref: 'archive' } },
        },
      ],
    });
    const initialRun = await runtime.start({
      runId: name,
      workflow,
      input: { name, artifactRootRef: 'docs' },
      initialState: state,
    });
    const action = initialRun.actions[0];
    const actionIdentity = {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'archive-claim',
    };
    await runtime.claim({ runId: name, executorId: 'host', ...actionIdentity });
    const run = await runtime.recordOutcome({
      runId: name,
      outcome: { ...actionIdentity, outcomeId: 'archived', status: 'succeeded', output: null },
    });
    const stateFile = path.join(archiveDirectory, 'comet-state.yaml');
    const receipt = {
      runId: name,
      change: name,
      archiveRef,
      transactionId: 'archive-test',
      stateVersion: state.state_version,
      specs: [],
    };
    await writeNativeManagedRunState(stateFile, state, nativeRoot, run, receipt);

    const traceId = 'workflow:native:' + name;
    const index = await collectChangeTraceIndex(project);
    expect(index.changes).toEqual(['native:' + name]);
    expect(index.traces).toEqual([
      expect.objectContaining({ traceId, snapshot: true, startedAt: null, endedAt: null }),
    ]);
    const detail = await collectChangeTrace(project, traceId);
    expect(detail).toMatchObject({
      snapshot: true,
      nodes: expect.arrayContaining([
        expect.objectContaining({
          kind: 'action',
          name: 'archive',
          status: 'succeeded',
          timing: 'unknown',
        }),
      ]),
    });
    expect(
      (await collectChangeTraceIndex(project, 'native', { from: at(0), to: at(1000) })).changes,
    ).toEqual([]);
    await expect(fs.stat(resolveWorkspaceRuntimeRootSync(project))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    await writeNativeManagedRunState(stateFile, state, nativeRoot, run, {
      ...receipt,
      runId: 'different-run',
    });
    expect(await collectChangeTraceIndex(project)).toMatchObject({ changes: [], unreadable: 1 });
    expect(await collectChangeTrace(project, traceId)).toBeNull();
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
