import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import { createDiskApplication } from '../helpers/workflow-application.js';
import type { projectWorkflowApplicationRun } from '../../domains/workflow-application/run-view.js';

type RunView = ReturnType<typeof projectWorkflowApplicationRun>;

describe('custom application compact CLI output', () => {
  let root: string;
  let app: Awaited<ReturnType<typeof createDiskApplication>>;
  let requestNumber = 0;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-compact-application-'));
    app = await createDiskApplication(root);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  async function request(request: unknown, details = false) {
    const requestFile = path.join(root, `request-${++requestNumber}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    return runtimeDispatchCommand(
      { request: requestFile, projectRoot: root, applicationFile: app.file, details },
      { output: 'compact' },
    );
  }
  async function dispatch(input: unknown, details = false) {
    const result = await request(input, details);
    expect(result.response.status, JSON.stringify(result.response)).toBe('succeeded');
    if (result.response.status !== 'succeeded') throw new Error('Application request failed');
    return { ...result, response: result.response };
  }
  function view(result: Awaited<ReturnType<typeof dispatch>>) {
    return (result.cliResponse as { data: RunView }).data;
  }
  const start = {
    operation: 'start',
    runId: 'report',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'A real report' },
  };

  it('keeps the full SDK response but returns only current work to the CLI by default', async () => {
    const result = await dispatch(start);
    expect(result.response.data.actions).toHaveLength(1);
    expect(result.cliResponse).toMatchObject({
      status: 'succeeded',
      data: {
        schema: 'comet.application.run-view.v1',
        runId: 'report',
        revision: 1,
        current: { actions: [{ id: 'report:1', status: 'pending' }] },
      },
    });
    expect(view(result).current.actions[0].input).toEqual(result.response.data.actions[0].input);
    expect(view(result)).not.toHaveProperty('actionContexts');
    expect(view(result)).not.toHaveProperty('actions');
    expect(view(result).inspection.commandArgs).toContain('--details');
    expect(view(result).continuation.commandArgs).toContain(root);
    const inspected = await dispatch(view(result).inspection.request);
    expect(inspected.cliResponse).toBeUndefined();
    expect(inspected.response.data).toEqual(result.response.data);
    const detailed = await dispatch({ operation: 'next', runId: 'report' }, true);
    expect(detailed.cliResponse).toBeUndefined();
    expect(detailed.response.data).toEqual(result.response.data);
    const full = await runtimeDispatchCommand({
      request: path.join(root, `request-${requestNumber}.json`),
      projectRoot: root,
      applicationFile: app.file,
    });
    expect(full.cliResponse).toBeUndefined();
    expect(full.response.status === 'succeeded' && full.response.data).toEqual(
      result.response.data,
    );
  });

  it('continues through revision, explicit approval and the same claimed outcome using returned templates', async () => {
    const initial = view(await dispatch(start));
    const executed = await dispatch(initial.current.actions[0].executeRequests![0]);
    let current = view(executed);
    expect(current.current.actions).toEqual([]);
    expect(current.current.waits).toHaveLength(1);
    const wait = current.current.waits[0];
    expect(wait.proposal).toEqual(executed.response.data.waits[0].proposal);
    expect(wait).not.toHaveProperty('results');
    const revised = await dispatch({
      ...wait.reviseRequest,
      proposal: { report: 'Revised scope for this isolated test' },
    });
    current = view(revised);
    expect(current.current.waits[0].proposalHash).not.toBe(wait.proposalHash);
    const stale = await request({
      ...wait.resolveRequest,
      expectedRevision: current.revision,
      decisionId: 'stale-approval',
      choice: 'approved',
    });
    expect(stale.response).toMatchObject({
      status: 'failed',
      error: { code: 'STALE_PROPOSAL' },
    });
    current = view(
      await dispatch({
        ...current.current.waits[0].resolveRequest,
        decisionId: 'approved-revision',
        choice: 'approved',
      }),
    );
    expect(current.current.waits).toEqual([]);
    expect(current.current.actions).toHaveLength(1);
    expect(current.current.approvals).toMatchObject([
      {
        id: wait.id,
        proposalHash: revised.response.data.waits[0].proposalHash,
        decision: { id: 'approved-revision', choice: 'approved' },
      },
    ]);
    const claimed = await dispatch({
      ...current.current.actions[0].claimRequest,
      executorId: 'manual-local-publish',
      sessionId: 'isolated-test',
    });
    current = view(claimed);
    expect(current.current.actions[0].claim).toEqual(claimed.response.data.actions.at(-1)!.claim);
    expect(current.current.actions[0].executeRequests).toBeUndefined();
    const outcomeRequest = current.current.actions[0].outcomeRequest!;
    const completed = await dispatch({
      ...outcomeRequest,
      outcome: {
        ...outcomeRequest.outcome,
        outcomeId: 'actual-publish',
        status: 'succeeded',
        output: { ref: 'local-report.md' },
      },
    });
    expect(view(completed)).toMatchObject({
      status: 'completed',
      current: { actions: [], waits: [] },
      outputs: { publish: { value: { ref: 'local-report.md' } } },
    });
    expect(view(completed).outputs).toEqual(completed.response.data.outputs);
    expect(view(completed).continuation.nextRequest).toBeUndefined();
  });

  it('retains every parallel action, current input and join dependency after reverse completion', async () => {
    const parallelRoot = path.join(root, 'parallel');
    await fs.mkdir(parallelRoot);
    app = await createDiskApplication(parallelRoot, { parallel: true });
    const initial = view(await dispatch(start));
    expect(initial.current.actions.map((action) => action.stepId)).toEqual(['left', 'right']);
    const right = initial.current.actions.find((action) => action.stepId === 'right')!;
    const first = await dispatch(right.executeRequests![0]);
    const current = view(first);
    expect(current.current.actions.map((action) => action.stepId)).toEqual(['left']);
    expect(current.current.actions[0].input).toEqual(first.response.data.actions[0].input);
    expect(current.current.joins).toEqual({ join: { left: 0, right: 1 } });
    const second = view(await dispatch(current.current.actions[0].executeRequests![0]));
    expect(second.current.actions.map((action) => action.stepId)).toEqual(['join']);
    expect(second.current.actions[0].input).toMatchObject({
      outputs: {
        left: { title: 'A real report — reviewed' },
        right: { title: 'A real report — reviewed' },
      },
    });
  });

  it('keeps unknown work bound to the original claim and requires real reconciliation before retry', async () => {
    const initial = view(await dispatch(start));
    let current = view(
      await dispatch({
        ...initial.current.actions[0].claimRequest,
        sessionId: 'interrupted-session',
      }),
    );
    const claim = current.current.actions[0].claim;
    expect(current.current.actions[0].retryRequest).toBeUndefined();
    current = view(
      await dispatch({
        ...current.current.actions[0].markUnknownRequest,
        reason: 'The isolated test did not execute the Skill',
      }),
    );
    const unknown = current.current.actions[0];
    expect(unknown.claim).toEqual(claim);
    expect(unknown).toMatchObject({
      attempt: 1,
      status: 'unknown',
      retryRequest: { attempt: 1, reconciliation: { resolution: 'not-executed', evidence: null } },
      outcomeRequest: {
        outcome: { claimToken: claim!.token, attempt: 1, inputHash: unknown.inputHash },
      },
    });
    expect(unknown.executeRequests).toBeUndefined();
    expect(unknown.claimRequest).toBeUndefined();
    const duplicate = await request({
      ...initial.current.actions[0].executeRequests![0],
      expectedRevision: current.revision,
    });
    expect(duplicate.response).toMatchObject({
      status: 'failed',
      error: { code: 'ACTION_ALREADY_CLAIMED' },
    });
    const unsupported = await request(unknown.retryRequest);
    expect(unsupported.response).toMatchObject({
      status: 'failed',
      error: { code: 'RECONCILIATION_REQUIRED' },
    });
    current = view(
      await dispatch({
        ...unknown.retryRequest,
        reconciliation: {
          resolution: 'not-executed',
          evidence: 'Test only called claim and mark-unknown; no Skill process was invoked',
        },
      }),
    );
    expect(current.current.actions[0]).toMatchObject({
      id: unknown.id,
      attempt: 2,
      status: 'pending',
    });
    expect(current.current.actions[0].claim).toBeUndefined();
    const completed = view(await dispatch(current.current.actions[0].executeRequests![0]));
    expect(completed.current.waits).toHaveLength(1);
  });

  it('never suggests retrying an unknown attempt that already has a rejected outcome', async () => {
    const initial = view(await dispatch(start));
    let current = view(
      await dispatch({ ...initial.current.actions[0].claimRequest, sessionId: 'original-session' }),
    );
    const template = current.current.actions[0].outcomeRequest!;
    const rejected = await request({
      ...template,
      outcome: {
        ...template.outcome,
        outcomeId: 'invalid-title',
        status: 'succeeded',
        output: { title: 'incorrect' },
      },
    });
    expect(rejected.response).toMatchObject({
      status: 'failed',
      error: { code: 'OUTCOME_REJECTED' },
    });
    current = view(
      await dispatch({
        operation: 'mark-unknown',
        runId: 'report',
        actionId: current.current.actions[0].id,
        attempt: 1,
        reason: 'The submitted result requires correction',
      }),
    );
    expect(current.current.actions[0].rejectedOutcomes).toHaveLength(1);
    expect(current.current.actions[0].retryRequest).toBeUndefined();
    expect(current.current.actions[0].claimRequest).toBeUndefined();
    expect(current.current.actions[0].outcomeRequest).toBeDefined();
  });

  it('avoids repeating a long completed action while retaining the entire pending proposal', async () => {
    const initial = view(
      await dispatch({ ...start, input: { topic: 'Detailed local report. '.repeat(500) } }),
    );
    const result = await dispatch(initial.current.actions[0].executeRequests![0]);
    const current = view(result);
    expect(current.current.waits[0].proposal).toEqual(result.response.data.waits[0].proposal);
    expect(current.history.actions).toBe(1);
    expect(current.current.actions).toEqual([]);
    const compactBytes = Buffer.byteLength(JSON.stringify(result.cliResponse));
    const fullBytes = Buffer.byteLength(JSON.stringify(result.response));
    expect(compactBytes).toBeLessThan(fullBytes * 0.65);
  });
});
