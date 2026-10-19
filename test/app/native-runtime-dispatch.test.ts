import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import { runRuntimeCli } from '../../app/cli/runtime-command.js';
import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import { advanceNativeSdkChange } from '../../domains/comet-native/native-sdk-next.js';
import { inspectNativeSdkRun } from '../../domains/comet-native/native-runtime-ownership.js';
import { nativeProjectPaths } from '../../domains/comet-native/native-paths.js';
import { fixtureAcceptanceReview } from '../helpers/native-builder-acceptance-review.js';
import { nativeSdkReportExecutor } from '../../domains/comet-native/native-sdk-report.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function builderFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-dispatch-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  const name = 'compact-handoff';
  const created = await runNativeCli([
    'new',
    name,
    '--runtime',
    'sdk',
    '--project-root',
    root,
    '--json',
  ]);
  expect(created.exitCode, created.stderr).toBe(0);
  const inspection = await inspectNativeSdkRun(root, name);
  const paths = await nativeProjectPaths(root, inspection.artifactRootRef);
  const changeDir = path.join(paths.changesDir, name);
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Outcome\nShip the workflow.\n# Scope\nPreserve behavior.\n# Non-goals\nNone.\n# Acceptance examples\n- The workflow resumes.\n# Constraints and invariants\nPreserve compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n',
  );
  await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'specs', 'workflow', 'spec.md'),
    '# Workflow\nThe workflow resumes.\n',
  );
  await advanceNativeSdkChange(root, name);
  const prepared = await inspectNativeSdkRun(root, name);
  await advanceNativeSdkChange(root, name, {
    expectedAction: 'confirm-shape',
    expectedStateVersion: prepared.state.state_version,
    summary: 'Confirm the fixture Shape.',
  });
  const builder = await inspectNativeSdkRun(root, name);
  const action = builder.run.actions.find(
    (entry) => entry.stepId === 'build.builder' && entry.status === 'pending',
  )!;
  const requestFile = path.join(root, 'request.json');
  const request = {
    operation: 'claim',
    runId: name,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: 'builder-session',
    claimToken: 'builder-token',
  };
  await fs.writeFile(requestFile, JSON.stringify(request));
  return { root, name, requestFile, request };
}

async function cli(root: string, request: string, details = false) {
  const previousExitCode = process.exitCode;
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await runRuntimeCli([
      'runtime',
      'dispatch',
      '--application',
      'native',
      '--request',
      request,
      '--project-root',
      root,
      ...(details ? ['--details'] : []),
    ]);
    expect(process.exitCode).toBe(0);
    return JSON.parse(output.mock.calls.at(-1)![0] as string);
  } finally {
    output.mockRestore();
    process.exitCode = previousExitCode;
  }
}

async function verifierOutcomeFixture() {
  const fixture = await builderFixture();
  const { root, name } = fixture;
  await cli(root, fixture.requestFile);
  const requestRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-verifier-request-'));
  roots.push(requestRoot);
  const requestFile = path.join(requestRoot, 'request.json');
  const submit = async (request: unknown) => {
    await fs.writeFile(requestFile, JSON.stringify(request));
    const result = await runtimeDispatchCommand({
      application: 'native',
      projectRoot: root,
      request: requestFile,
    });
    expect(result.response.status, JSON.stringify(result.response)).toBe('succeeded');
    return result;
  };
  await submit({
    operation: 'record-outcome',
    runId: name,
    outcome: {
      actionId: fixture.request.actionId,
      attempt: fixture.request.attempt,
      inputHash: fixture.request.inputHash,
      claimToken: fixture.request.claimToken,
      outcomeId: 'builder-candidate',
      status: 'succeeded',
      output: {
        summary: 'Implemented the fixture.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: new Date().toISOString(),
        verificationChecks: [],
      },
    },
  });
  await advanceNativeSdkChange(root, name);
  const { run, state } = await inspectNativeSdkRun(root, name);
  const action = run.actions.find(
    (entry) => entry.stepId === 'verify.verifier' && entry.status === 'pending',
  )!;
  expect(action).toBeDefined();
  await submit({
    operation: 'claim',
    runId: name,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: 'independent-verifier',
    claimToken: 'verifier-token',
  });
  const request = {
    operation: 'record-outcome',
    runId: name,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'verifier-token',
      outcomeId: 'verifier-final',
      status: 'succeeded',
      output: {
        candidateId: state.builder_handoff!.candidate_id,
        verifierExecutionRef: 'independent-verifier',
        response: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Fixture independently checked.' }],
            risks: [],
            summary: 'Fixture acceptance passed.',
          },
        },
      },
    },
  };
  await fs.writeFile(requestFile, JSON.stringify(request));
  return { root, name, requestFile, action };
}

describe('Native dispatch CLI presentation', () => {
  it('generates the report after a CLI Verifier outcome but still requires explicit acceptance', async () => {
    const { root, name, requestFile } = await verifierOutcomeFixture();
    const result = await cli(root, requestFile);
    expect(result.status).toBe('succeeded');
    const first = (await inspectNativeSdkRun(root, name)).run;
    expect(first.actions.find((action) => action.stepId === 'verify.report')?.status).toBe(
      'succeeded',
    );
    expect(first.waits.find((wait) => wait.stepId === 'verify.confirm')?.status).toBe('pending');
    expect(first.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
    await cli(root, requestFile);
    expect((await inspectNativeSdkRun(root, name)).run.revision).toBe(first.revision);
  });

  it('preserves the SDK single-operation default and also completes reports in CLI details mode', async () => {
    const { root, name, requestFile } = await verifierOutcomeFixture();
    const result = await runtimeDispatchCommand({
      application: 'native',
      projectRoot: root,
      request: requestFile,
    });
    expect(result.response.status).toBe('succeeded');
    expect(
      (await inspectNativeSdkRun(root, name)).run.actions.find(
        (action) => action.stepId === 'verify.report',
      )?.status,
    ).toBe('pending');
    const details = await cli(root, requestFile, true);
    expect(
      details.data.waits.find((wait: { stepId: string }) => wait.stepId === 'verify.confirm')
        .status,
    ).toBe('pending');
  });

  it('keeps an accepted Verifier result successful when automatic report execution fails', async () => {
    const { root, name, requestFile, action } = await verifierOutcomeFixture();
    vi.spyOn(nativeSdkReportExecutor, 'execute').mockRejectedValueOnce(
      new Error('Fixture report write interrupted'),
    );
    const result = await cli(root, requestFile);
    expect(result.status).toBe('succeeded');
    expect(result.warning.code).toBe('NATIVE_REPORT_PENDING');
    const run = (await inspectNativeSdkRun(root, name)).run;
    expect(run.actions.find((entry) => entry.id === action.id)?.status).toBe('succeeded');
    expect(run.actions.find((entry) => entry.stepId === 'verify.report')?.status).toBe('unknown');
    expect(run.waits.some((wait) => wait.stepId === 'verify.confirm')).toBe(false);
  });
  it('preserves complete claimed inputs, state, identity and result template without repeating the Run history', async () => {
    const { root, requestFile, name } = await builderFixture();
    const compact = await cli(root, requestFile);
    const committed = (await inspectNativeSdkRun(root, name)).run;
    const action = committed.actions.find((entry) => entry.status === 'running')!;
    expect(compact.data).toMatchObject({
      schema: 'comet.native.dispatch-result.v1',
      runId: name,
      revision: committed.revision,
      state: committed.state,
      action,
    });
    expect(compact.data.action).toEqual(action);
    expect(compact.data.state).toEqual(committed.state);
    expect(compact.data.outcomeRequest).toEqual({
      operation: 'record-outcome',
      runId: name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        outcomeId: '<outcome-id>',
        status: 'succeeded',
        output: expect.objectContaining({
          summary: expect.any(String),
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: [expect.objectContaining({ id: 'A1' })],
          verificationChecks: [expect.objectContaining({ executable: '<executable>' })],
        }),
      },
    });
    expect(compact.data.failureOutcomeRequest).toMatchObject({
      operation: 'record-outcome',
      runId: name,
      outcome: {
        actionId: action.id,
        claimToken: action.claim!.token,
        status: 'failed',
        output: { summary: '<actual-execution-failure>' },
      },
    });
    expect(compact.data.continuation.userCommunication.agentInstruction).toContain(
      'original claimed task',
    );
    expect(compact.data.activeActions[0].outcomeRequestRef).toBe('outcomeRequest');
    expect(compact.data.activeActions[0]).not.toHaveProperty('outcomeRequest');
    expect(compact.data.activeActions[0].contextRequest).toMatchObject({
      phase: 'build',
      contextMode: 'snapshot',
      commandArgs: expect.arrayContaining([root, 'builder-session', '--context-mode', 'snapshot']),
    });
    expect(compact.data.continuation).not.toHaveProperty('contextRequest');
    expect(compact.data.activeActions[0].contextRequest).not.toHaveProperty('instruction');
    for (const key of ['actions', 'outputs', 'actionContexts', 'waits'])
      expect(compact.data).not.toHaveProperty(key);
    const serialized = (value: unknown) =>
      JSON.stringify(value, (_key, item) =>
        typeof item === 'string' ? item.replaceAll(root, '<project-root>') : item,
      );
    expect(Buffer.byteLength(serialized(compact.data))).toBeLessThan(
      // 当前 Action 的具体结果契约可增加固定正文，历史仍不得重复返回。
      Buffer.byteLength(serialized(committed)) / 2 + 1024,
    );
    const sdk = await runtimeDispatchCommand({
      application: 'native',
      projectRoot: root,
      request: requestFile,
    });
    expect(sdk.response).toMatchObject({ status: 'succeeded', data: committed });
    expect(sdk).not.toHaveProperty('cliResponse');
    const details = await cli(root, requestFile, true);
    expect(details.data).toEqual(committed);
    await fs.writeFile(requestFile, JSON.stringify(compact.data.inspection.request));
    expect((await cli(root, requestFile)).data).toEqual(committed);
  });

  it('returns the submitted outcome receipt and explicit user decision from the same committed Run', async () => {
    const { root, requestFile, name } = await builderFixture();
    const claimed = await cli(root, requestFile);
    const request = claimed.data.outcomeRequest;
    request.outcome = {
      ...request.outcome,
      outcomeId: 'builder-stopped',
      status: 'failed',
      output: { summary: 'The actual Builder stopped before finishing.' },
    };
    await fs.writeFile(requestFile, JSON.stringify(request));
    const submitted = await cli(root, requestFile);
    const committed = (await inspectNativeSdkRun(root, name)).run;
    expect(submitted.data.action).toEqual(
      committed.actions.find((entry) => entry.id === request.outcome.actionId),
    );
    expect(submitted.data.action.receipts).toHaveLength(1);
    expect(submitted.data.action.outcome).toEqual(request.outcome);
    expect(submitted.data).not.toHaveProperty('outcomeRequest');
    expect(submitted.data.continuation).toMatchObject({
      requiresUserDecision: true,
      disposition: 'await-user',
    });
    expect(submitted.data.pendingBuilderDecisions).toHaveLength(1);
    expect((await cli(root, requestFile)).data).toEqual(submitted.data);
  });
});
