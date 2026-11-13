import '../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import { runRuntimeCli } from '../../app/cli/runtime-command.js';
import { advanceNativeSdkChange } from '../../domains/comet-native/native-sdk-next.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../domains/comet-native/native-runtime-ownership.js';
import { createNativePortableState } from '../../domains/comet-native/native-portable-state.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../domains/workflow-contract/change-runtime-owner.js';
import { nativeProjectPaths } from '../../domains/comet-native/native-paths.js';
import { fixtureAcceptanceReview } from '../helpers/native-builder-acceptance-review.js';

import type { RuntimeAction } from '../../domains/engine/runtime.js';
import * as taskContext from '../../app/commands/comet-task-context.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

function identifiedResultRequest(
  request: { receipt: string; result: { status: string; output: unknown } },
  outcomeId: string,
) {
  const { runId, ...identity } = JSON.parse(
    Buffer.from(request.receipt, 'base64url').toString('utf8'),
  );
  return {
    operation: 'record-outcome',
    runId,
    outcome: { ...identity, outcomeId, ...request.result },
  };
}
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Claim context delivery', () => {
  it('delivers real memory once per receiver and restores it explicitly through the public CLI', async () => {
    const { root, requestFile } = await builderFixture();
    await ensureCliBuilt(path.resolve('.'));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-claim-home-'));
    roots.push(home);
    await fs.mkdir(path.join(home, '.comet/memory'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.comet/memory/profile.md'),
      '# 个人画像\n\n## 沟通偏好\n\n- 使用中文回复\n',
    );
    const invoke = async (args: string[]) => {
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        [path.resolve('dist/app/cli/index.js'), ...args],
        {
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            XDG_CACHE_HOME: path.join(home, '.cache'),
            LOCALAPPDATA: path.join(home, 'local'),
          },
          windowsHide: true,
          timeout: 30_000,
        },
      );
      return { ...JSON.parse(stdout), cliStderr: stderr };
    };
    const args = [
      'runtime',
      'dispatch',
      '--application',
      'native',
      '--project-root',
      root,
      '--request',
      requestFile,
    ];
    const first = await invoke(args);
    expect(first.data.contextDelivery.status, first.cliStderr).toBe('delivered');
    expect(first.data.context[0].text).toContain('使用中文回复');
    expect((await invoke(args)).data.context).toEqual([]);
    const restored = await invoke(first.data.contextActions.restore.commandArgs.slice(1));
    expect(restored.context[0].text).toContain('使用中文回复');
    const receiverArgs = [...first.data.contextActions.restore.commandArgs.slice(1)];
    receiverArgs[receiverArgs.indexOf('--session') + 1] = 'new-receiver';
    const independent = await invoke(receiverArgs);
    expect(independent.context[0].applications[0].applicationId).not.toBe(
      first.data.context[0].applications[0].applicationId,
    );
    expect(
      first.data.context[0].applications.every(
        (application: { outcome?: string }) => application.outcome === undefined,
      ),
    ).toBe(true);
  }, 90_000);

  it('delivers context to the actual receiver without changing the claimed input or SDK response', async () => {
    const { root, requestFile, name } = await builderFixture();
    const collect = vi.spyOn(taskContext, 'collectCometTaskContextResult').mockResolvedValue({
      status: 'available',
      context: [
        {
          pluginId: 'comet.context-director',
          text: 'Use focused checks.',
          episodeId: 'ctx',
          manifest: [],
          applications: [],
        },
      ],
    });
    const result = await cli(root, requestFile);
    expect(result.data.context[0].text).toBe('Use focused checks.');
    expect(result.data.contextDelivery).toMatchObject({
      status: 'delivered',
      sessionId: 'builder-session',
      phase: 'build',
    });
    expect(collect).toHaveBeenCalledWith(
      root,
      expect.objectContaining({
        task: expect.stringContaining('The workflow resumes.'),
        sessionId: 'builder-session',
        phase: 'build',
        contextMode: 'incremental',
        charBudget: 6000,
      }),
      { workflow: 'native', change: name },
      { timeoutMs: 2000 },
    );
    expect(result.data.contextActions.restore.commandArgs).toEqual(
      expect.arrayContaining([root, 'builder-session', 'snapshot']),
    );
    expect(result.data.contextActions.expand.commandArgs).toEqual(
      expect.arrayContaining(['--expand-context', '<expansion-id>']),
    );
    expect(result.data.contextActions.complete.commandArgs).toEqual(
      expect.arrayContaining(['--complete', '--learning-file', '<learning-file.json>']),
    );
    const committed = (await inspectNativeSdkRun(root, name)).run;
    expect(result.data.action).toEqual(
      committed.actions.find((action) => action.id === result.data.action.id),
    );
    await cli(root, requestFile, true);
    await runtimeDispatchCommand({
      application: 'native',
      projectRoot: root,
      request: requestFile,
    });
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it('keeps a successful claim usable when context retrieval is unavailable', async () => {
    const { root, requestFile, name } = await builderFixture();
    vi.spyOn(taskContext, 'collectCometTaskContextResult').mockResolvedValue({
      status: 'unavailable',
      context: [],
    });
    const result = await cli(root, requestFile);
    expect(result.status).toBe('succeeded');
    expect(result.data.contextDelivery.status).toBe('unavailable');
    expect(result.data.context).toEqual([]);
    expect(result.data.resultRequest.receipt).toEqual(expect.any(String));
    expect(
      (await inspectNativeSdkRun(root, name)).run.actions.find(
        (action) => action.id === result.data.action.id,
      )?.status,
    ).toBe('running');
  });
});

async function builderFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-dispatch-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  const name = 'compact-handoff';
  const config = defaultProjectConfig('docs', 'en');
  await writeProjectConfig(root, {
    ...config,
    native: { ...config.native, document_writes: 'revert' },
  });
  await fs.mkdir(path.join(root, 'docs/comet/changes', name), { recursive: true });
  await registerSdkChangeOwner(root, {
    schema: COMET_CHANGE_OWNER_SCHEMA,
    workflow: 'native',
    change: name,
    format: 'sdk',
    application: 'native',
    runId: name,
  });
  await createNativeSdkRuntime(root).start({
    runId: name,
    workflow: { id: 'comet-native', version: '4' },
    input: { name, artifactRootRef: 'docs' },
    initialState: createNativePortableState({
      name,
      language: 'en',
      nextAction: 'prepare-shape-confirmation',
    }),
  });
  const inspection = await inspectNativeSdkRun(root, name);
  const paths = await nativeProjectPaths(root, inspection.artifactRootRef);
  const changeDir = path.join(paths.changesDir, name);
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Outcome\nShip the workflow.\n# Scope\nPreserve behavior.\n## Directory structure\n### Modified\n- src/ — preserve workflow behavior.\n# Non-goals\nNone.\n# Acceptance examples\n- The workflow resumes.\n# Constraints and invariants\nPreserve compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n',
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

async function verifierOutcomeFixture(
  beforeClaim?: (fixture: {
    root: string;
    name: string;
    requestFile: string;
    action: RuntimeAction;
  }) => Promise<void>,
) {
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
        requireIndependentReview: beforeClaim !== undefined,
        submittedAt: new Date().toISOString(),
      },
    },
  });
  await advanceNativeSdkChange(root, name);
  const { run, state } = await inspectNativeSdkRun(root, name);
  const action = run.actions.find(
    (entry) => entry.stepId === 'verify.verifier' && entry.status === 'pending',
  )!;
  expect(action).toBeDefined();
  await beforeClaim?.({ root, name, requestFile, action });
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
  it('reports actual platform Build checks through public receipt dispatch without scheduling a managed check', async () => {
    const { root, name, requestFile } = await builderFixture();
    const claimed = await cli(root, requestFile);
    const checked = await promisify(execFile)(process.execPath, ['-e', 'console.log("checked")'], {
      cwd: root,
      windowsHide: true,
    });
    expect(checked.stdout.trim()).toBe('checked');
    const request = claimed.data.resultRequest;
    request.result.output = {
      summary: 'Implemented and checked the fixture.',
      addressedAcceptanceIds: ['A1'],
      checks: [{ name: 'Unit', result: 'passed', note: checked.stdout.trim() }],
      knownLimits: [],
    };
    await fs.writeFile(requestFile, JSON.stringify(request));
    expect((await cli(root, requestFile)).status).toBe('succeeded');
    const run = (await inspectNativeSdkRun(root, name)).run;
    expect(
      run.actions.some((a) => a.stepId === 'build.checks' || a.stepId === 'verify.checks'),
    ).toBe(false);
    expect(run.actions.find((a) => a.id === claimed.data.action.id)?.outcome?.output).toMatchObject(
      { checks: [{ name: 'Unit', result: 'passed', note: 'checked' }] },
    );
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    expect(run.state).toMatchObject({ phase: 'verify', verification_result: 'pending' });
  });

  it('uses one result protocol and omits duplicate Builder review for a new public v4 Run', async () => {
    const { root, requestFile } = await builderFixture();
    const result = await cli(root, requestFile);
    expect(result.data.resultRequest.receipt).toEqual(expect.any(String));
    expect(result.data.resultRequest.result.output.acceptanceReview).toBeUndefined();
    expect(result.data.outcomeRequest).toBeUndefined();
    expect(result.data.failureOutcomeRequest).toBeUndefined();
    expect(result.data.markUnknownRequest).toBeUndefined();
  });

  it('waits for acceptance directly after a v4 Verifier result without a report Action', async () => {
    const { root, name, requestFile } = await verifierOutcomeFixture(undefined);
    const result = await cli(root, requestFile);
    expect(result.status).toBe('succeeded');
    const first = (await inspectNativeSdkRun(root, name)).run;
    expect(first.actions.some((action) => action.stepId === 'verify.report')).toBe(false);
    expect(first.waits.find((wait) => wait.stepId === 'verify.confirm')?.status).toBe('pending');
    expect(first.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
    expect(
      await fs.readFile(path.join(root, 'docs/comet/changes', name, 'verification.md'), 'utf8'),
    ).toContain('Fixture acceptance passed.');
    await cli(root, requestFile);
    expect((await inspectNativeSdkRun(root, name)).run.revision).toBe(first.revision);
  });

  it('preserves v4 acceptance when the report view fails and retries it on next', async () => {
    const { root, name, requestFile, action } = await verifierOutcomeFixture(undefined);
    const reportFile = path.join(root, 'docs/comet/changes', name, 'verification.md');
    await fs.mkdir(reportFile);
    const result = await cli(root, requestFile);
    expect(result.status).toBe('succeeded');
    expect(result.warning.code).toBe('NATIVE_REPORT_PENDING');
    const run = (await inspectNativeSdkRun(root, name)).run;
    expect(run.actions.find((entry) => entry.id === action.id)?.status).toBe('succeeded');
    expect(run.waits.find((wait) => wait.stepId === 'verify.confirm')?.status).toBe('pending');
    await fs.rmdir(reportFile);
    await advanceNativeSdkChange(root, name);
    expect(await fs.readFile(reportFile, 'utf8')).toContain('Fixture acceptance passed.');
    expect((await inspectNativeSdkRun(root, name)).run.revision).toBe(run.revision);
  });

  it('reports all malformed Builder fields together and accepts corrected content only with a new outcomeId', async () => {
    const f = await builderFixture();
    const claimed = await cli(f.root, f.requestFile);
    const request = identifiedResultRequest(claimed.data.resultRequest, 'invalid-fields');
    request.outcome.output = {
      summary: 'Implemented the fixture',
      acceptanceReview: [
        { id: 'B1', status: 'implemented-with-evidence', evidence: 'wrong', note: '' },
      ],
      checks: [{ name: 'Tests', result: 'blocked' }],
      knownLimits: [],
    };
    const submit = async () => {
      await fs.writeFile(f.requestFile, JSON.stringify(request));
      return runtimeDispatchCommand({
        application: 'native',
        projectRoot: f.root,
        request: f.requestFile,
      });
    };
    const before = (await inspectNativeSdkRun(f.root, f.name)).run;
    const rejected = await submit();
    expect(rejected.response.status).toBe('failed');
    const message = rejected.response.error?.message ?? '';
    for (const field of [
      'acceptanceReview[0].evidence',
      'acceptanceReview[0].note',
      'acceptanceReview[0].id',
      'B1',
      'A1',
      'checks[0].result',
      'outcomeId',
    ])
      expect(message).toContain(field);
    const stopped = (await inspectNativeSdkRun(f.root, f.name)).run;
    expect(stopped.state).toEqual(before.state);
    const action = stopped.actions.find((a) => a.id === f.request.actionId)!;
    expect(action.status).toBe('running');
    expect(action.claim).toEqual(before.actions.at(-1)?.claim);
    expect(action.rejectedOutcomes).toHaveLength(1);
    request.outcome.outcomeId = 'incomplete-and-invalid-check';
    request.outcome.output = {
      summary: 'Implemented the fixture',
      acceptanceReview: [],
      checks: [{ name: 'Tests', result: 'blocked' }],
      knownLimits: [],
    };
    const combined = await submit();
    expect(combined.response.status).toBe('failed');
    for (const field of ['A1', 'checks[0].result', 'outcomeId'])
      expect(combined.response.error?.message).toContain(field);
    expect((await inspectNativeSdkRun(f.root, f.name)).run.state).toEqual(before.state);
    request.outcome.output = {
      summary: 'Implemented the fixture',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [],
      knownLimits: [],
    };
    const conflict = await submit();
    expect(conflict.response.error?.code).toBe('OUTCOME_CONFLICT');
    expect(conflict.response.error?.message).toContain('新的 outcomeId');
    request.outcome.outcomeId = 'corrected-fields';
    const accepted = await submit();
    expect(accepted.response.status, JSON.stringify(accepted.response)).toBe('succeeded');
    const after = (await inspectNativeSdkRun(f.root, f.name)).run;
    const original = after.actions.find((a) => a.id === f.request.actionId)!;
    expect(original.claim).toEqual(before.actions.at(-1)?.claim);
    expect(original.rejectedOutcomes).toHaveLength(2);
    expect(original.outcome?.outcomeId).toBe('corrected-fields');
  });

  it('submits a Native candidate through its returned receipt without manual identity fields', async () => {
    const f = await builderFixture();
    const claimed = await cli(f.root, f.requestFile);
    const request = claimed.data.resultRequest;
    expect(request).toMatchObject({ operation: 'record-outcome', receipt: expect.any(String) });
    expect(request).not.toHaveProperty('outcome');
    expect(request.result.output).toMatchObject({
      summary: expect.any(String),
      addressedAcceptanceIds: ['A1'],
      checks: expect.any(Array),
    });
    expect(claimed.data.checkRequestTemplate).toBeUndefined();

    request.result = {
      status: 'succeeded',
      output: {
        summary: 'Implemented fixture.',
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
      },
    };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-receipt-'));
    roots.push(dir);
    const file = path.join(dir, 'submit.json');
    await fs.writeFile(file, JSON.stringify(request));
    await cli(f.root, file);
    const before = (await inspectNativeSdkRun(f.root, f.name)).run;
    expect(before.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    await cli(f.root, file);
    expect((await inspectNativeSdkRun(f.root, f.name)).run).toEqual(before);
  });

  it('rejects a Builder identity before claiming a Verifier and accepts an independent retry', async () => {
    const fixture = await verifierOutcomeFixture(async ({ root, name, requestFile, action }) => {
      const before = (await inspectNativeSdkRun(root, name)).run;
      await fs.writeFile(
        requestFile,
        JSON.stringify({
          operation: 'claim',
          runId: name,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'native-host',
          sessionId: 'builder-session',
          claimToken: 'wrong-verifier-token',
        }),
      );
      const rejected = await runtimeDispatchCommand({
        application: 'native',
        projectRoot: root,
        request: requestFile,
      });
      expect(rejected.response.status).toBe('failed');
      expect(rejected.response.error?.code).toBe('VERIFIER_SESSION_NOT_INDEPENDENT');
      expect(rejected.response.error?.message).toContain('independent');
      const after = (await inspectNativeSdkRun(root, name)).run;
      expect(after).toEqual(before);
      expect(after.actions.find((entry) => entry.id === action.id)).toMatchObject({
        status: 'pending',
      });
    });
    const run = (await inspectNativeSdkRun(fixture.root, fixture.name)).run;
    expect(run.actions.find((entry) => entry.id === fixture.action.id)).toMatchObject({
      status: 'running',
      claim: { sessionId: 'independent-verifier' },
    });
  });
  it('diagnoses misplaced outcome fields without changing the original claim', async () => {
    const f = await builderFixture();
    const claimed = await cli(f.root, f.requestFile);
    const before = (await inspectNativeSdkRun(f.root, f.name)).run;
    const template = identifiedResultRequest(
      claimed.data.resultRequest,
      'builder-original-failure',
    );
    template.outcome.status = 'failed';
    template.outcome.outcomeId = 'builder-original-failure';
    template.outcome.output = { summary: 'The fixture Builder execution failed.' };
    const { output, ...identity } = template.outcome;
    await fs.writeFile(
      f.requestFile,
      JSON.stringify({
        ...template,
        outcome: { ...identity, ...output, response: { kind: 'execution-failure' } },
      }),
    );
    const rejected = await runtimeDispatchCommand({
      application: 'native',
      projectRoot: f.root,
      request: f.requestFile,
    });
    expect(rejected.exitCode).toBe(64);
    expect(rejected.response.error?.code).toBe('INVALID_REQUEST');
    expect(rejected.response.error?.message).toContain('outcome.output');
    expect(rejected.response.error?.message).toContain('resultRequest');
    expect(rejected.response.error?.message).toContain('result.output');
    expect(rejected.response.error?.message).not.toContain(f.request.claimToken);
    expect((await inspectNativeSdkRun(f.root, f.name)).run).toEqual(before);
    await fs.writeFile(f.requestFile, JSON.stringify(template));
    const accepted = await runtimeDispatchCommand({
      application: 'native',
      projectRoot: f.root,
      request: f.requestFile,
    });
    expect(accepted.exitCode).toBe(0);
    const finished = (await inspectNativeSdkRun(f.root, f.name)).run;
    expect(finished.actions.find((action) => action.id === f.request.actionId)).toMatchObject({
      status: 'failed',
      claim: { token: f.request.claimToken },
      outcome: { outcomeId: 'builder-original-failure', output },
    });
  });
  it('does not disclose a Builder failure receipt to a rejected outcome with another claim', async () => {
    const f = await builderFixture();
    await cli(f.root, f.requestFile);
    const before = await inspectNativeSdkRun(f.root, f.name);
    await fs.writeFile(
      path.join(f.root, 'docs/comet/changes', f.name, 'specs/workflow/spec.md'),
      '# Workflow\nChanged behavior.\n',
    );
    await fs.writeFile(
      f.requestFile,
      JSON.stringify({
        operation: 'record-outcome',
        runId: f.name,
        outcome: {
          actionId: f.request.actionId,
          attempt: f.request.attempt,
          inputHash: f.request.inputHash,
          claimToken: 'another-claim',
          outcomeId: 'wrong-owner',
          status: 'failed',
          output: { summary: 'Not the original owner.' },
        },
      }),
    );
    const refused = await runtimeDispatchCommand({
      application: 'native',
      projectRoot: f.root,
      request: f.requestFile,
    });
    expect(refused.response.status).toBe('failed');
    expect(refused.response.recovery).toBeUndefined();
    const after = await inspectNativeSdkRun(f.root, f.name);
    expect(after.state).toEqual(before.state);
    expect(after.run.actions.find(({ id }) => id === f.request.actionId)).toMatchObject({
      status: 'running',
      claim: { token: f.request.claimToken },
    });
  });
  it('generates the report after a CLI Verifier outcome but still requires explicit acceptance', async () => {
    const { root, name, requestFile } = await verifierOutcomeFixture();
    const result = await cli(root, requestFile);
    expect(result.status).toBe('succeeded');
    const first = (await inspectNativeSdkRun(root, name)).run;
    expect(first.actions.some((a) => a.stepId === 'verify.report')).toBe(false);
    expect(
      await fs.readFile(path.join(root, 'docs/comet/changes', name, 'verification.md'), 'utf8'),
    ).toContain('Fixture acceptance passed.');
    expect(first.waits.find((w) => w.stepId === 'verify.confirm')?.status).toBe('pending');
    expect(first.actions.some((a) => a.stepId.startsWith('archive.'))).toBe(false);
    await cli(root, requestFile);
    expect((await inspectNativeSdkRun(root, name)).run.revision).toBe(first.revision);
  });

  it('preserves the SDK single-operation default and also completes report views in CLI details mode', async () => {
    const { root, name, requestFile } = await verifierOutcomeFixture();
    const result = await runtimeDispatchCommand({
      application: 'native',
      projectRoot: root,
      request: requestFile,
    });
    expect(result.response.status).toBe('succeeded');
    const run = (await inspectNativeSdkRun(root, name)).run;
    expect(run.actions.some((a) => a.stepId === 'verify.report')).toBe(false);
    await expect(
      fs.access(path.join(root, 'docs/comet/changes', name, 'verification.md')),
    ).rejects.toThrow();
    expect(run.waits.find((w) => w.stepId === 'verify.confirm')?.status).toBe('pending');
    const details = await cli(root, requestFile, true);
    expect(
      details.data.waits.find((w: { stepId: string }) => w.stepId === 'verify.confirm').status,
    ).toBe('pending');
    expect(
      await fs.readFile(path.join(root, 'docs/comet/changes', name, 'verification.md'), 'utf8'),
    ).toContain('Fixture acceptance passed.');
    expect((await inspectNativeSdkRun(root, name)).run.revision).toBe(run.revision);
  });

  it('keeps an accepted Verifier result successful when report view writing fails', async () => {
    const { root, name, requestFile, action } = await verifierOutcomeFixture();
    const report = path.join(root, 'docs/comet/changes', name, 'verification.md');
    await fs.mkdir(report);
    const result = await cli(root, requestFile);
    expect(result.status).toBe('succeeded');
    expect(result.warning.code).toBe('NATIVE_REPORT_PENDING');
    const run = (await inspectNativeSdkRun(root, name)).run;
    expect(run.actions.find((a) => a.id === action.id)?.status).toBe('succeeded');
    expect(run.actions.some((a) => a.stepId === 'verify.report')).toBe(false);
    expect(run.waits.find((w) => w.stepId === 'verify.confirm')?.status).toBe('pending');
    await fs.rmdir(report);
    await advanceNativeSdkChange(root, name);
    expect(await fs.readFile(report, 'utf8')).toContain('Fixture acceptance passed.');
    expect((await inspectNativeSdkRun(root, name)).run.revision).toBe(run.revision);
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
    expect(compact.data.resultRequest).toMatchObject({
      operation: 'record-outcome',
      receipt: expect.any(String),
      result: {
        status: 'succeeded',
        output: {
          summary: expect.any(String),
          addressedAcceptanceIds: ['A1'],
          checks: [
            expect.objectContaining({
              name: expect.any(String),
              result: expect.any(String),
              note: expect.any(String),
            }),
          ],
          knownLimits: expect.any(Array),
        },
      },
    });
    expect(
      JSON.parse(Buffer.from(compact.data.resultRequest.receipt, 'base64url').toString()),
    ).toEqual({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim!.token,
    });
    expect(compact.data.outcomeRequest).toBeUndefined();
    expect(compact.data.failureOutcomeRequest).toBeUndefined();
    expect(compact.data.continuation.userCommunication.agentInstruction).toContain(
      'original claimed task',
    );
    expect(compact.data.activeActions[0].outcomeRequestRef).toBe('resultRequest');
    expect(compact.data.activeActions[0]).not.toHaveProperty('outcomeRequest');
    expect(compact.data.activeActions[0].contextRequest).toMatchObject({
      phase: 'build',
      contextMode: 'snapshot',
      commandArgs: expect.arrayContaining([root, 'builder-session', '--context-mode', 'snapshot']),
    });
    expect(compact.data.continuation).not.toHaveProperty('contextRequest');
    expect(compact.data.activeActions[0].contextRequest).not.toHaveProperty('instruction');
    for (const key of [
      'run',
      'history',
      'commands',
      'actions',
      'outputs',
      'actionContexts',
      'waits',
    ])
      expect(compact.data).not.toHaveProperty(key);
    const serialized = (value: unknown) =>
      JSON.stringify(value, (_key, item) =>
        typeof item === 'string' ? item.replaceAll(root, '<project-root>') : item,
      );
    for (const historical of committed.actions.filter(({ id }) => id !== action.id))
      expect(serialized(compact.data)).not.toContain(serialized(historical));
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
    const request = identifiedResultRequest(claimed.data.resultRequest, 'builder-stopped');
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
