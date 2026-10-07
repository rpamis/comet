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

describe('Native dispatch CLI presentation', () => {
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
        status: '<succeeded|failed>',
        output: '<actual-action-output>',
      },
    });
    expect(compact.data.continuation.userCommunication.agentInstruction).toContain(
      'original claimed task',
    );
    expect(compact.data.activeActions[0].outcomeRequest).toEqual(compact.data.outcomeRequest);
    for (const key of ['actions', 'outputs', 'actionContexts', 'waits'])
      expect(compact.data).not.toHaveProperty(key);
    expect(Buffer.byteLength(JSON.stringify(compact.data))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(committed)) / 2,
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
