import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import {
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../domains/engine/runtime.js';

const repositoryRoot = path.resolve('.');

const workflow = {
  id: 'editorial',
  version: '1',
  entry: 'draft',
  steps: {
    draft: { type: 'invoke_skill', ref: 'writer' },
    review: { type: 'ask_user', proposalFrom: 'draft' },
    publish: { type: 'call_tool', ref: 'publish' },
  },
  transitions: [
    { from: 'draft', to: 'review' },
    { from: 'review', to: 'publish', on: 'approved' },
    { from: 'review', to: 'draft', on: 'rejected' },
  ],
};

describe('Runtime JSON command', () => {
  let root: string;
  let projectRoot: string;
  let invocationCwd: string;
  let workflowFile: string;
  let requestNumber: number;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-command-'));
    projectRoot = path.join(root, 'editorial');
    invocationCwd = path.join(root, 'invocation');
    await Promise.all([fs.mkdir(projectRoot), fs.mkdir(invocationCwd)]);
    workflowFile = path.join(invocationCwd, 'workflow.json');
    await fs.writeFile(workflowFile, JSON.stringify(workflow));
    requestNumber = 0;
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function dispatch(request: unknown, overrides: Record<string, unknown> = {}) {
    const requestFile = path.join(invocationCwd, `request-${++requestNumber}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    return runtimeDispatchCommand(
      {
        request: requestFile,
        workflow: [workflowFile],
        rootDir: '../editorial/store',
        projectRoot: '../editorial',
        ...overrides,
      },
      {
        invocationCwd,
        environment: { COMET_RUNTIME_TEST_SECRET: 'not-persisted', PATH: process.env.PATH },
      },
    );
  }

  it('runs, resumes, approves, and cancels the same instance through independent commands', async () => {
    const cwdBefore = process.cwd();
    const started = await dispatch({
      operation: 'start',
      requestId: 'request-start',
      runId: 'article',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'harness' },
    });
    expect(started.exitCode).toBe(0);
    expect(started.response).toMatchObject({
      protocolVersion: 1,
      requestId: 'request-start',
      status: 'succeeded',
      data: { runId: 'article', revision: 1, actions: [{ type: 'invoke_skill' }] },
    });
    if (started.response.status !== 'succeeded') throw new Error('Start failed');
    const action = started.response.data.actions[0];
    const claimed = await dispatch({
      operation: 'claim',
      runId: 'article',
      expectedRevision: 1,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'external-agent',
      sessionId: 'session-1',
      claimToken: 'claim-1',
    });
    expect(claimed.exitCode).toBe(0);
    const outcome = {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'claim-1',
      outcomeId: 'draft-result',
      status: 'succeeded',
      output: { article: 'Draft' },
    };
    const recorded = await dispatch({ operation: 'record-outcome', runId: 'article', outcome });
    expect(recorded.exitCode).toBe(0);
    if (recorded.response.status !== 'succeeded') throw new Error('Record failed');
    const wait = recorded.response.data.waits[0];
    const revised = await dispatch({
      operation: 'revise-wait',
      runId: 'article',
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      proposal: { article: 'Updated draft' },
    });
    expect(revised.exitCode).toBe(0);
    if (revised.response.status !== 'succeeded') throw new Error('Revise failed');
    const newWait = revised.response.data.waits[0];
    const stale = await dispatch({
      operation: 'resolve-wait',
      runId: 'article',
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'approval-stale',
      choice: 'approved',
    });
    expect(stale).toMatchObject({
      exitCode: 65,
      response: { status: 'failed', error: { code: 'STALE_PROPOSAL' } },
    });
    const approved = await dispatch({
      operation: 'resolve-wait',
      runId: 'article',
      waitId: newWait.id,
      proposalHash: newWait.proposalHash,
      decisionId: 'approval-current',
      choice: 'approved',
    });
    expect(approved.exitCode).toBe(0);
    const resumed = await dispatch({ operation: 'next', runId: 'article' });
    expect(resumed.response).toMatchObject({
      status: 'succeeded',
      data: { actions: [expect.anything(), { type: 'call_tool', status: 'pending' }] },
    });
    const cancelled = await dispatch({
      operation: 'cancel',
      runId: 'article',
      reason: 'User requested cancellation',
    });
    expect(cancelled.response).toMatchObject({
      status: 'succeeded',
      data: { status: 'cancelled' },
    });
    const inspected = await dispatch({ operation: 'inspect', runId: 'article' }, { workflow: [] });
    expect(inspected.response).toMatchObject({
      status: 'succeeded',
      data: { status: 'cancelled' },
    });
    const sdk = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({ rootDir: path.join(projectRoot, 'store') }),
      workflows: [],
    });
    expect(await sdk.inspect('article')).toMatchObject({ status: 'cancelled' });
    expect(JSON.stringify(inspected.response)).not.toContain('not-persisted');
    expect(process.cwd()).toBe(cwdBefore);
  });

  it('deduplicates an identical result and returns a stable revision conflict', async () => {
    const started = await dispatch({
      operation: 'start',
      runId: 'article',
      workflow: { id: 'editorial', version: '1' },
      input: null,
    });
    if (started.response.status !== 'succeeded') throw new Error('Start failed');
    const action = started.response.data.actions[0];
    await dispatch({
      operation: 'claim',
      runId: 'article',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'agent',
      claimToken: 'claim',
    });
    const request = {
      operation: 'record-outcome',
      runId: 'article',
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'claim',
        outcomeId: 'result',
        status: 'succeeded',
        output: { article: 'Draft' },
      },
    };
    const first = await dispatch(request);
    const repeated = await dispatch(request);
    if (first.response.status !== 'succeeded' || repeated.response.status !== 'succeeded')
      throw new Error('Record failed');
    expect(repeated.response.data.revision).toBe(first.response.data.revision);
    const stale = await dispatch({ operation: 'next', runId: 'article', expectedRevision: 1 });
    expect(stale).toMatchObject({
      exitCode: 65,
      response: { error: { code: 'REVISION_CONFLICT' } },
    });
  });

  it('requires explicit reconciliation before retrying an unknown Action through the CLI', async () => {
    const started = await dispatch({
      operation: 'start',
      runId: 'article-recovery',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'recovery' },
    });
    if (started.response.status !== 'succeeded') throw new Error('Start failed');
    const action = started.response.data.actions[0];
    const claimed = await dispatch({
      operation: 'claim',
      runId: started.response.data.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'external-agent',
      claimToken: 'claim-unknown',
    });
    expect(claimed.exitCode).toBe(0);

    const unknown = await dispatch({
      operation: 'mark-unknown',
      runId: started.response.data.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'The host disconnected after dispatch',
    });
    expect(unknown.response).toMatchObject({
      status: 'succeeded',
      data: { actions: [{ status: 'unknown', attempt: 1 }] },
    });

    const unsafeRetry = await dispatch({
      operation: 'retry',
      runId: started.response.data.runId,
      actionId: action.id,
      attempt: action.attempt,
    });
    expect(unsafeRetry).toMatchObject({
      exitCode: 65,
      response: { status: 'failed', error: { code: 'RECONCILIATION_REQUIRED' } },
    });

    const retried = await dispatch({
      operation: 'retry',
      runId: started.response.data.runId,
      actionId: action.id,
      attempt: action.attempt,
      reconciliation: {
        resolution: 'not-executed',
        evidence: { providerStatus: 'not-found' },
      },
    });
    expect(retried.response).toMatchObject({
      status: 'succeeded',
      data: { status: 'running', actions: [{ status: 'pending', attempt: 2 }] },
    });
  });

  it.each([
    ['unknown operation', { operation: 'delete', runId: 'article' }],
    ['missing run identity', { operation: 'inspect' }],
    [
      'unknown caller context',
      { operation: 'inspect', runId: 'article', context: { environment: { SECRET: 'x' } } },
    ],
    ['malformed revision', { operation: 'next', runId: 'article', expectedRevision: '1' }],
    ['malformed outcome', { operation: 'record-outcome', runId: 'article', outcome: {} }],
  ])('rejects %s with a machine-readable usage error', async (_name, request) => {
    const result = await dispatch(request);
    expect(result).toMatchObject({
      exitCode: 64,
      response: { status: 'failed', error: { code: 'INVALID_REQUEST' } },
    });
    expect(result.response.requestId).toEqual(expect.any(String));
  });

  it('isolates simultaneous invocations with different project and storage roots', async () => {
    const [first, second] = await Promise.all([
      dispatch({
        operation: 'start',
        runId: 'same-id',
        workflow: { id: 'editorial', version: '1' },
        input: 'A',
      }),
      dispatch(
        {
          operation: 'start',
          runId: 'same-id',
          workflow: { id: 'editorial', version: '1' },
          input: 'B',
        },
        { rootDir: '../other/store', projectRoot: '../other' },
      ),
    ]);
    expect(first.response).toMatchObject({ status: 'succeeded', data: { input: 'A' } });
    expect(second.response).toMatchObject({ status: 'succeeded', data: { input: 'B' } });
  });
});

describe('Runtime through the real CLI', () => {
  let packageRoot: string;
  let cli: string;
  let projectRoot: string;
  let requestFile: string;
  let workflowFile: string;

  beforeAll(async () => {
    packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-cli-'));
    await fs.mkdir(path.join(packageRoot, 'bin'));
    await Promise.all(
      ['comet.js', 'comet-daemon-router.js', 'fast-runtime-router.js'].map((name) =>
        fs.copyFile(path.join(repositoryRoot, 'bin', name), path.join(packageRoot, 'bin', name)),
      ),
    );
    await fs.copyFile(
      path.join(repositoryRoot, 'package.json'),
      path.join(packageRoot, 'package.json'),
    );
    await fs.symlink(
      path.join(repositoryRoot, 'node_modules'),
      path.join(packageRoot, 'node_modules'),
      'junction',
    );
    execFileSync(
      process.execPath,
      [
        path.join(repositoryRoot, 'node_modules/typescript/bin/tsc'),
        '--outDir',
        path.join(packageRoot, 'dist'),
        '--declaration',
        'false',
        '--declarationMap',
        'false',
        '--sourceMap',
        'false',
      ],
      { cwd: repositoryRoot, stdio: 'pipe' },
    );
    cli = path.join(packageRoot, 'bin/comet.js');
  }, 60_000);

  afterAll(async () => {
    if (packageRoot) await fs.rm(packageRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-cli-project-'));
    requestFile = path.join(projectRoot, 'request.json');
    workflowFile = path.join(projectRoot, 'workflow.json');
    await fs.writeFile(workflowFile, JSON.stringify(workflow));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  function run(...args: string[]) {
    return spawnSync(process.execPath, [cli, ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        COMET_DAEMON: '0',
        HOME: projectRoot,
        USERPROFILE: projectRoot,
        COMET_NO_HINTS: '1',
      },
    });
  }

  it('dispatches and inspects a persisted run in separate CLI processes', async () => {
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        operation: 'start',
        requestId: 'cli-start',
        runId: 'article',
        workflow: { id: 'editorial', version: '1' },
        input: { topic: 'orchestration' },
      }),
    );
    const args = [
      'runtime',
      'dispatch',
      '--request',
      requestFile,
      '--workflow',
      workflowFile,
      '--root-dir',
      'store',
      '--project-root',
      projectRoot,
      '--json',
    ];
    const start = run(...args);
    expect(start.status, start.stderr).toBe(0);
    expect(start.stderr).toBe('');
    expect(JSON.parse(start.stdout)).toMatchObject({
      status: 'succeeded',
      data: { runId: 'article', revision: 1 },
    });
    await fs.writeFile(requestFile, JSON.stringify({ operation: 'inspect', runId: 'article' }));
    const inspected = run(...args);
    expect(inspected.status, inspected.stderr).toBe(0);
    const snapshot = JSON.parse(inspected.stdout);
    expect(snapshot).toMatchObject({
      status: 'succeeded',
      data: { runId: 'article', actions: [{ type: 'invoke_skill' }] },
    });

    const action = snapshot.data.actions[0];
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        operation: 'claim',
        runId: 'article',
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'external-agent',
        claimToken: 'cli-claim',
      }),
    );
    expect(run(...args).status).toBe(0);
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        operation: 'mark-unknown',
        runId: 'article',
        actionId: action.id,
        attempt: action.attempt,
        reason: 'The process stopped after dispatch',
      }),
    );
    expect(run(...args).status).toBe(0);

    await fs.writeFile(
      requestFile,
      JSON.stringify({ operation: 'retry', runId: 'article', actionId: action.id, attempt: 1 }),
    );
    const unsafeRetry = run(...args);
    expect(unsafeRetry.status).toBe(65);
    expect(JSON.parse(unsafeRetry.stdout)).toMatchObject({
      status: 'failed',
      error: { code: 'RECONCILIATION_REQUIRED' },
    });

    await fs.writeFile(
      requestFile,
      JSON.stringify({
        operation: 'retry',
        runId: 'article',
        actionId: action.id,
        attempt: 1,
        reconciliation: { resolution: 'not-executed', evidence: { lookup: 'not-found' } },
      }),
    );
    const retry = run(...args);
    expect(retry.status, retry.stderr).toBe(0);
    await fs.writeFile(requestFile, JSON.stringify({ operation: 'inspect', runId: 'article' }));
    const recovered = run(...args);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      status: 'succeeded',
      data: { actions: [{ status: 'pending', attempt: 2 }] },
    });
  });

  it('returns structured JSON for malformed files and CLI usage errors', async () => {
    await fs.writeFile(requestFile, '{bad json');
    const malformed = run(
      'runtime',
      'dispatch',
      '--request',
      requestFile,
      '--root-dir',
      'store',
      '--json',
    );
    expect(malformed.status).toBe(64);
    expect(JSON.parse(malformed.stdout)).toMatchObject({
      status: 'failed',
      error: { code: 'REQUEST_JSON_INVALID' },
    });
    const missing = run('runtime', 'dispatch', '--root-dir', 'store', '--json');
    expect(missing.status).toBe(64);
    expect(JSON.parse(missing.stdout)).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('keeps existing Skill commands discoverable alongside the new Runtime help', () => {
    for (const args of [
      ['runtime', '--help'],
      ['help', 'runtime'],
    ]) {
      const result = run(...args);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('dispatch');
    }
    const oldSkill = run('skill', '--help');
    expect(oldSkill.status, oldSkill.stderr).toBe(0);
    expect(oldSkill.stdout).toContain('run');
    expect(oldSkill.stdout).toContain('continue');
    expect(oldSkill.stdout).toContain('check');
  });
});
