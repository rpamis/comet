import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createRuntime,
  createMemoryRuntimeStore,
  createFileRuntimeStore,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import {
  observeWorkflowRunStore,
  readChangeTraceSnapshots,
  workflowRunTraceUpdates,
} from '../../../domains/workflow-application/run-trace.js';
import { readRuntimeTraceSpans } from '../../../platform/process/runtime-trace.js';

const workflow = {
  id: 'trace-test',
  version: '1',
  entry: 'build.work',
  steps: {
    'build.work': { type: 'call_tool' as const, ref: 'work', retry: 'idempotent' as const },
    'verify.approve': { type: 'ask_user' as const, proposalFrom: 'build.work' },
  },
  transitions: [{ from: 'build.work', to: 'verify.approve' }],
};

describe('SDK Run observation', () => {
  let directory: string;
  let project: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-run-trace-'));
    project = path.join(directory, 'project');
    await fs.mkdir(project);
    vi.stubEnv('COMET_DATA_DIR', path.join(directory, 'data'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  });
  it('bounds selected identities and counts invalid entries and duplicate authorities accurately', async () => {
    const current = path.join(resolveWorkspaceRuntimeRootSync(project), 'sdk-runs', 'native');
    const prior = path.join(project, '.comet/runtime/sdk-runs/native');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
    });
    const run = await runtime.start({
      runId: 'duplicate',
      workflow: { id: workflow.id, version: '1' },
      input: null,
    });
    await createFileRuntimeStore<WorkflowRun>({ rootDir: current }).compareAndSwap(
      run.runId,
      null,
      run,
    );
    await createFileRuntimeStore<WorkflowRun>({ rootDir: prior }).compareAndSwap(
      run.runId,
      null,
      run,
    );
    await fs.writeFile(path.join(current, 'invalid'), '{}');
    expect(await readChangeTraceSnapshots(project, 'native', 0)).toEqual({
      runs: [],
      truncated: true,
      unreadable: 0,
    });
    expect(await readChangeTraceSnapshots(project, 'native', 1)).toEqual({
      runs: [],
      truncated: true,
      unreadable: 1,
    });
    expect(await readChangeTraceSnapshots(project, 'native', 2)).toEqual({
      runs: [],
      truncated: false,
      unreadable: 2,
    });
    await fs.rm(prior, { recursive: true });
    expect(await readChangeTraceSnapshots(project, 'native', 2)).toEqual({
      runs: [run],
      truncated: false,
      unreadable: 1,
    });
  });
  it('records real claims, outcomes and waits without storing raw inputs or claim credentials', async () => {
    const store = observeWorkflowRunStore(
      project,
      'native',
      createMemoryRuntimeStore<WorkflowRun>(),
    );
    const runtime = createRuntime({ store, workflows: [workflow] });
    const run = await runtime.start({
      runId: 'example',
      workflow: { id: workflow.id, version: '1' },
      input: { rawSecret: 'do-not-store' },
    });
    const action = run.actions[0];
    await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: 1,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'private-claim',
      capabilities: [],
    });
    await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: 1,
        inputHash: action.inputHash,
        claimToken: 'private-claim',
        outcomeId: 'done',
        status: 'succeeded',
        output: { result: 'raw-result' },
      },
    });
    const spans = (await readRuntimeTraceSpans(project)).spans;
    expect(spans.find((span) => span.kind === 'action')).toMatchObject({
      status: 'succeeded',
      attempt: 1,
    });
    expect(spans.find((span) => span.kind === 'action')!.startedAt).not.toBeNull();
    expect(spans.find((span) => span.kind === 'wait')).toMatchObject({ status: 'waiting' });
    expect(JSON.stringify(spans)).not.toMatch(/private-claim|do-not-store|raw-result/);
  });
  it('does not emit observations for unsuccessful compare-and-swap or read-only access', async () => {
    const base = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({ store: base, workflows: [workflow] });
    const run = await runtime.start({
      runId: 'example',
      workflow: { id: workflow.id, version: '1' },
      input: null,
    });
    const observed = observeWorkflowRunStore(project, 'classic', base);
    expect(await observed.read(run.runId)).toEqual(run);
    await base.compareAndSwap(run.runId, run.revision, { ...run, revision: run.revision + 1 });
    expect(
      await observed.compareAndSwap(run.runId, run.revision, {
        ...run,
        revision: run.revision + 1,
      }),
    ).toBe(false);
    expect((await readRuntimeTraceSpans(project)).spans).toEqual([]);
  });
  it('leaves historical starts unknown and separates attempts by stable identity', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
    });
    const run = await runtime.start({
      runId: 'example',
      workflow: { id: workflow.id, version: '1' },
      input: null,
    });
    run.actions[0].status = 'running';
    run.actions[0].attempt = 2;
    const spans = workflowRunTraceUpdates({
      workflow: 'native',
      previous: null,
      next: run,
      initial: false,
      observedAt: new Date().toISOString(),
    });
    expect(spans.every((span) => span.startedAt === null)).toBe(true);
    expect(spans.find((span) => span.kind === 'action')!.spanId).toBe(
      `action:${run.actions[0].id}:2`,
    );
  });
  it('keeps Classic profiles separate from the displayed workflow phase', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
    });
    const run = await runtime.start({
      runId: 'example',
      workflow: { id: workflow.id, version: '1' },
      input: null,
    });
    run.actions[0].stepId = 'hotfix.build.execute';
    expect(
      workflowRunTraceUpdates({
        workflow: 'classic',
        previous: null,
        next: run,
        initial: false,
        observedAt: new Date().toISOString(),
      }).find((span) => span.kind === 'action')!.attributes!.phase,
    ).toBe('build');
  });
  it('preserves a Store prototype checkpoint method without creating observations', async () => {
    const restore = vi.fn(async () => true);
    class Store {
      async read() {
        return null;
      }
      async compareAndSwap() {
        return false;
      }
      restoreCheckpoint(
        ...args: Parameters<
          NonNullable<
            import('../../../domains/engine/runtime.js').RuntimeStore<WorkflowRun>['restoreCheckpoint']
          >
        >
      ) {
        return restore(...args);
      }
    }
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
    });
    const run = await runtime.start({
      runId: 'example',
      workflow: { id: workflow.id, version: '1' },
      input: null,
    });
    expect(
      await observeWorkflowRunStore(project, 'native', new Store()).restoreCheckpoint!(
        'example',
        null,
        run,
      ),
    ).toBe(true);
    expect(restore).toHaveBeenCalledWith('example', null, run);
    expect((await readRuntimeTraceSpans(project)).spans).toEqual([]);
  });
});
