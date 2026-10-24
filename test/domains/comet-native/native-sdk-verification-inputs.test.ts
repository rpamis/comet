import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryRuntimeStore,
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
  type RuntimeValue,
} from '../../../domains/engine/runtime.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import {
  collectNativeSdkShapeProposal,
  defineNativeWorkflowApplication,
} from '../../../domains/comet-native/native-sdk-application.js';
import {
  nativeSdkCurrentCheckSummaries,
  recoverNativeSdkChecks,
} from '../../../domains/comet-native/native-sdk-checks.js';
import { inspectNativeSdkCheckExecutions } from '../../../domains/comet-native/native-sdk-check-execution.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';

type ReceiptFault = 'null-snapshot' | 'unknown-schema' | 'missing-candidate' | 'incomplete';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function writeProjectFile(root: string, relative: string, content: string) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function succeedLatestAction(
  runtime: ReturnType<typeof createRuntime>,
  run: WorkflowRun,
  root: string,
  receipt: string,
  output: unknown,
  sessionId?: string,
) {
  const action = run.actions.at(-1)!;
  const context = { requestId: receipt, projectRoot: root };
  const claimed =
    action.status === 'running'
      ? run
      : await runtime.claim({
          runId: run.runId,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'native-host',
          ...(sessionId ? { sessionId } : {}),
          claimToken: receipt,
          context,
        });
  return runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: claimed.actions.at(-1)!.claim!.token,
      outcomeId: receipt,
      status: 'succeeded',
      output: output as RuntimeValue,
    },
    context,
  });
}

async function checkedCandidate(
  options: {
    legacyReceipt?: boolean;
    receiptFault?: ReceiptFault;
    checkSource?: string;
    executeChecks?: boolean;
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-verification-inputs-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeProjectFile(root, '.gitignore', '.next/\n');
  await writeProjectFile(root, 'value.ts', 'export const value = 1;\n');
  await writeProjectFile(root, '.next/types/routes.d.ts', 'export type Route = "/";\n');
  await writeProjectFile(root, '.next/dev/types/routes.d.ts', 'export type DevRoute = "/";\n');
  await writeProjectFile(root, '.next/server/app/page.js', 'good');
  await writeProjectFile(root, '.next/static/chunks/main.js', 'good');
  await writeProjectFile(root, '.next/BUILD_ID', 'build-one');
  await writeProjectFile(root, '.next/routes-manifest.json', '{}');
  execFileSync('git', ['add', '.gitignore', 'value.ts'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: root },
  );
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const changeDir = path.join(paths.changesDir, 'verification-inputs');
  await fs.mkdir(changeDir);
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    `# Outcome
Preserve the verified application.
# Scope
Preserve the selected workflow.
## Directory structure
### Modified
- value.ts: preserve the selected value.
# Non-goals
None.
# Acceptance examples
- The selected value is available.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run focused Native checks.
`,
  );
  await writeProjectFile(
    changeDir,
    'specs/workflow/spec.md',
    '# Workflow\nThe selected value remains available.\n',
  );
  const initialState = createNativePortableState({
    name: 'verification-inputs',
    language: 'en',
    createdAt: '2026-10-23T00:00:00.000Z',
    nextAction: 'prepare-shape-confirmation',
  });
  const application = defineNativeWorkflowApplication();
  const storeOptions = { rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs') };
  const store = options.legacyReceipt
    ? createFileRuntimeStore<WorkflowRun>(storeOptions)
    : createMemoryRuntimeStore<WorkflowRun>();
  const runtimeOptions = {
    store,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    validators: application.validators,
    stateValidators: application.stateValidators,
    commandValidators: application.commandValidators,
    executors: application.executors,
  };
  let runtime = createRuntime({
    ...runtimeOptions,
    executors:
      options.legacyReceipt || options.receiptFault
        ? application.executors.map((executor) =>
            executor.id !== 'comet-native-checks'
              ? executor
              : {
                  ...executor,
                  async execute(...args: Parameters<typeof executor.execute>) {
                    const result = await executor.execute(...args);
                    const output = { ...(result.output as Record<string, RuntimeValue>) };
                    // 通过真实执行器生成结果，只改变被测收据格式，不伪造状态推进。
                    if (options.legacyReceipt) delete output.inputSnapshot;
                    else if (options.receiptFault === 'null-snapshot') output.inputSnapshot = null;
                    else {
                      const snapshot = {
                        ...(output.inputSnapshot as Record<string, RuntimeValue>),
                      };
                      if (options.receiptFault === 'unknown-schema') snapshot.schema = 'unknown';
                      if (options.receiptFault === 'missing-candidate')
                        delete snapshot.candidateBefore;
                      if (options.receiptFault === 'incomplete') {
                        snapshot.complete = false;
                        snapshot.diagnostics = ['Fixture input enumeration was incomplete.'];
                      }
                      output.inputSnapshot = snapshot;
                    }
                    return { ...result, output };
                  },
                },
          )
        : application.executors,
  });
  let run = await runtime.start({
    runId: 'verification-inputs',
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: { name: 'verification-inputs', artifactRootRef: 'docs' },
    initialState,
  });
  run = await succeedLatestAction(
    runtime,
    run,
    root,
    'shape-proposal',
    await collectNativeSdkShapeProposal({ paths, state: initialState }),
  );
  const wait = run.waits.at(-1)!;
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'shape-approved',
    choice: 'approved',
  });
  run = await succeedLatestAction(
    runtime,
    run,
    root,
    'shape-revalidated',
    await collectNativeSdkShapeProposal({
      paths,
      state: run.state as unknown as NativePortableState,
    }),
  );
  const check = {
    id: 'application-inputs',
    name: 'Read application and generated types',
    executable: process.execPath,
    argv: [
      '-e',
      options.checkSource ??
        'for (const file of ["value.ts", ".next/types/routes.d.ts", ".next/dev/types/routes.d.ts", ".next/server/app/page.js", ".next/static/chunks/main.js", ".next/BUILD_ID", ".next/routes-manifest.json"]) require("node:fs").readFileSync(file, "utf8"); process.stdout.write("verified");',
    ],
    cwdRef: '.',
    timeoutMs: 5_000,
    repeatable: true,
  };
  run = await succeedLatestAction(
    runtime,
    run,
    root,
    'builder-candidate',
    {
      summary: 'Implemented the selected value.',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [],
      knownLimits: [],
      review: null,
      submittedAt: '2026-10-23T01:00:00.000Z',
      verificationChecks: [check],
    },
    'builder-session',
  );
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.checks', status: 'pending' });
  if (options.executeChecks === false)
    return { root, paths, changeDir, runtime, store, run, check };
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'comet-native-checks',
    context: { requestId: 'runtime-checks', projectRoot: root },
  });
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
  expect(await nativeSdkCurrentCheckSummaries({ run, projectRoot: root })).toMatchObject([
    { id: check.id, status: 'passed' },
  ]);
  if (options.legacyReceipt) {
    const restartedStore = createFileRuntimeStore<WorkflowRun>(storeOptions);
    runtime = createRuntime({ ...runtimeOptions, store: restartedStore });
    run = (await restartedStore.read(run.runId))!;
  }
  return { root, paths, changeDir, runtime, store, run, check };
}

async function submitVerifierResult(prepared: Awaited<ReturnType<typeof checkedCandidate>>) {
  const { root, runtime, run } = prepared;
  const state = run.state as unknown as NativePortableState;
  return succeedLatestAction(
    runtime,
    run,
    root,
    'verifier-final-result',
    {
      candidateId: state.builder_handoff!.candidate_id,
      verifierExecutionRef: 'verifier-session',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'pass',
          acceptance: [{ id: 'A1', result: 'passed', reason: 'The selected value is available.' }],
          risks: [],
          summary: 'All acceptance scenarios passed.',
        },
      },
    },
    'verifier-session',
  );
}

async function completeArchive(
  prepared: Awaited<ReturnType<typeof checkedCandidate>>,
  verified: WorkflowRun,
) {
  const { root, paths, changeDir, runtime } = prepared;
  let run = await runtime.execute({
    runId: verified.runId,
    actionId: verified.actions.at(-1)!.id,
    executorId: 'comet-native-report',
    context: { requestId: 'verification-report', projectRoot: root },
  });
  const approval = run.waits.at(-1)!;
  expect(approval).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: approval.id,
    proposalHash: approval.proposalHash,
    decisionId: 'verification-approved',
    choice: 'approved',
  });
  for (const executorId of [
    'comet-native-report-revalidate',
    'comet-native-archive-preflight',
    'comet-native-archive-apply',
    'comet-native-archive-finalize',
  ]) {
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId,
      context: { requestId: executorId, projectRoot: root },
    });
  }
  expect(run).toMatchObject({ status: 'completed', state: { archived: true, status: 'done' } });
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.finalize', status: 'succeeded' });
  const archive = run.outputs['archive.execute'].value as { archiveRef: string };
  expect(await fs.stat(path.join(paths.archiveDir, archive.archiveRef))).toBeDefined();
  await expect(fs.access(changeDir)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(path.join(paths.specsDir, 'workflow/spec.md'), 'utf8')).toContain(
    'The selected value remains available.',
  );
  return run;
}

async function approveCheckRepair(
  prepared: Awaited<ReturnType<typeof checkedCandidate>>,
  rejected: WorkflowRun,
) {
  const { root, runtime } = prepared;
  const action = rejected.actions.at(-1)!;
  expect(action).toMatchObject({ stepId: 'verify.checks', status: 'running' });
  expect(
    (await inspectNativeSdkCheckExecutions({ projectRoot: root, run: rejected }))[0],
  ).toMatchObject({
    phase: 'completed',
    quiescent: true,
    execution: { outcome: { status: 'succeeded' } },
  });
  const stillWaiting = await recoverNativeSdkChecks(root, rejected, runtime);
  expect(stillWaiting.actions.at(-1)).toMatchObject({ id: action.id, status: 'running' });
  const reconciled = await recoverNativeSdkChecks(root, stillWaiting, runtime, {
    reconcileInterrupted: true,
    stoppedActions: [
      {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        evidence:
          'The original Node check exited after its file operations and its process group is quiescent. It started no detached descendants.',
      },
    ],
  });
  expect(reconciled.actions.find((entry) => entry.id === action.id)).toMatchObject({
    status: 'failed',
    outcome: {
      output: {
        checks: [{ id: prepared.check.id, status: 'passed', exitCode: 0 }],
        interruption: { kind: 'completed-input-drift', unknownCheckIds: [] },
      },
    },
  });
  expect(reconciled.state).toMatchObject({ phase: 'verify', status: 'await-user' });
  const repair = reconciled.waits.at(-1)!;
  expect(repair).toMatchObject({ stepId: 'verify.checks-stop', status: 'pending' });
  const repaired = await runtime.resolveWait({
    runId: reconciled.runId,
    waitId: repair.id,
    proposalHash: repair.proposalHash,
    decisionId: 'approve-source-drift-repair',
    choice: 'repair',
  });
  expect(repaired.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });
  expect(repaired.state).toMatchObject({ phase: 'build', status: 'active' });
  expect(repaired.actions.some((entry) => entry.stepId === 'verify.verifier')).toBe(false);
  return repaired;
}

describe('Native SDK verification input binding', () => {
  it('completes Archive after the Builder, Runtime checks and Verifier finish normally', async () => {
    const prepared = await checkedCandidate();
    const completed = await submitVerifierResult(prepared);
    await completeArchive(prepared, completed);
  });

  it.each(['HTTP_PROXY', 'PATH', 'TEMP'])(
    'accepts a final result from another shell with a different %s and unchanged inputs',
    async (variable) => {
      const prepared = await checkedCandidate();
      const original = process.env[variable];
      vi.stubEnv(
        variable,
        variable === 'PATH'
          ? `${original ?? ''}${path.delimiter}${path.join(prepared.root, 'verifier-bin')}`
          : variable === 'HTTP_PROXY'
            ? 'http://verifier-proxy.invalid:3128'
            : path.join(prepared.root, 'verifier-temp'),
      );
      const completed = await submitVerifierResult(prepared);
      expect(completed.actions.at(-1)).toMatchObject({
        stepId: 'verify.report',
        status: 'pending',
      });
      await completeArchive(prepared, completed);
    },
  );

  it('records a nonzero check that changes source as failed and returns to Build', async () => {
    const prepared = await checkedCandidate({
      executeChecks: false,
      checkSource:
        'require("node:fs").writeFileSync("value.ts", "export const value = 2;\\n"); process.exit(7);',
    });
    const action = prepared.run.actions.at(-1)!;
    const run = await prepared.runtime.execute({
      runId: prepared.run.runId,
      actionId: action.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'failed-source-changing-check', projectRoot: prepared.root },
    });
    expect(run.actions.find((entry) => entry.id === action.id)).toMatchObject({
      status: 'failed',
      outcome: { output: { checks: [{ status: 'failed', exitCode: 7 }] } },
    });
    expect(run.state).toMatchObject({ phase: 'build', status: 'active' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });
  });

  it('rejects source-changing checks and recovers to Build only after the repair approval', async () => {
    const prepared = await checkedCandidate({
      executeChecks: false,
      checkSource:
        'const fs = require("node:fs"); require("node:assert/strict").equal(fs.readFileSync("value.ts", "utf8"), "export const value = 1;\\n"); fs.writeFileSync("value.ts", "export const value = 2;\\n"); process.stdout.write("checked original source");',
    });
    const { root, runtime, run } = prepared;
    await expect(
      runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'source-changing-check', projectRoot: root },
      }),
    ).rejects.toThrow('OUTCOME_REJECTED');
    expect(await fs.readFile(path.join(root, 'value.ts'), 'utf8')).toBe(
      'export const value = 2;\n',
    );
    const rejected = (await prepared.store.read(run.runId))!;
    expect(rejected.actions.some((action) => action.stepId === 'verify.verifier')).toBe(false);
    await approveCheckRepair(prepared, rejected);
    expect(await fs.readFile(path.join(root, 'value.ts'), 'utf8')).toBe(
      'export const value = 2;\n',
    );
  });

  it('rejects checks whose initially incomplete generated inputs disappear during execution', async () => {
    const prepared = await checkedCandidate({
      executeChecks: false,
      checkSource:
        'const fs = require("node:fs"); fs.readFileSync("dist/.env", "utf8"); fs.unlinkSync("dist/.env"); process.stdout.write("read generated input before removal");',
    });
    const { root, runtime, store, run } = prepared;
    await fs.appendFile(path.join(root, '.git/info/exclude'), '\ndist/\n');
    await writeProjectFile(root, 'dist/.env', 'PUBLIC_TEST_FIXTURE=true\n');
    await expect(
      runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'initially-incomplete-checks', projectRoot: root },
      }),
    ).rejects.toThrow(/OUTCOME_REJECTED.*快照不完整/u);
    await expect(fs.access(path.join(root, 'dist/.env'))).rejects.toMatchObject({ code: 'ENOENT' });
    const rejected = (await store.read(run.runId))!;
    expect(rejected.actions.some((entry) => entry.stepId === 'verify.verifier')).toBe(false);
    expect(rejected.actions.at(-1)?.rejectedOutcomes?.at(-1)?.outcome.output).toMatchObject({
      inputSnapshot: { complete: false, diagnostics: expect.arrayContaining([expect.any(String)]) },
      checks: [{ id: prepared.check.id, status: 'passed', exitCode: 0 }],
    });
    await approveCheckRepair(prepared, rejected);
  });

  it('completes Archive when checks rebuild their generated Next type inputs', async () => {
    const prepared = await checkedCandidate({
      checkSource:
        'const fs = require("node:fs"); for (const file of [".next/types/routes.d.ts", ".next/dev/types/routes.d.ts"]) { fs.writeFileSync(file, "export type Route = 1;\\n"); require("node:assert/strict").match(fs.readFileSync(file, "utf8"), /Route = 1/); } process.stdout.write("generated inputs checked");',
    });
    const completed = await submitVerifierResult(prepared);
    await completeArchive(prepared, completed);
  });

  it.each([
    ['value.ts', 'export const value = 2;\n'],
    ['.next/types/routes.d.ts', 'export type Route = "/changed";\n'],
    ['.next/dev/types/routes.d.ts', 'export type DevRoute = "/changed";\n'],
    ['.next/server/app/page.js', 'bad'],
    ['.next/static/chunks/main.js', 'bad'],
    ['.next/BUILD_ID', 'build-two'],
    ['.next/routes-manifest.json', '{"changed":true}'],
  ])('rejects the final result when a verified input changes: %s', async (file, content) => {
    const prepared = await checkedCandidate();
    await writeProjectFile(prepared.root, file, content);
    await expect(submitVerifierResult(prepared)).rejects.toThrow('OUTCOME_REJECTED');
    expect((await prepared.store.read(prepared.run.runId))?.actions.at(-1)).toMatchObject({
      stepId: 'verify.verifier',
      status: 'running',
    });
  });

  it.each<ReceiptFault>(['null-snapshot', 'unknown-schema', 'missing-candidate', 'incomplete'])(
    'rejects a %s receipt instead of falling back to matching legacy fingerprints',
    async (receiptFault) => {
      const prepared = await checkedCandidate({ receiptFault, executeChecks: false });
      const { root, runtime, store, run } = prepared;
      const action = run.actions.at(-1)!;
      await expect(
        runtime.execute({
          runId: run.runId,
          actionId: action.id,
          executorId: 'comet-native-checks',
          context: { requestId: 'invalid-snapshot-checks', projectRoot: root },
        }),
      ).rejects.toThrow('OUTCOME_REJECTED');
      const rejected = (await store.read(run.runId))!;
      expect(rejected.actions.some((entry) => entry.stepId === 'verify.verifier')).toBe(false);
      const rejectedAction = rejected.actions.find((entry) => entry.id === action.id)!;
      expect(rejectedAction.status).not.toBe('succeeded');
      expect(rejectedAction.rejectedOutcomes?.at(-1)?.outcome.output).toMatchObject({
        inputBefore: expect.any(String),
        inputAfter: expect.any(String),
        checks: [{ id: prepared.check.id, status: 'passed', exitCode: 0 }],
      });
    },
  );

  it('accepts a persisted 0.5.0 check receipt in its original execution environment', async () => {
    const prepared = await checkedCandidate({ legacyReceipt: true });
    const receipt = prepared.run.outputs['verify.checks'].value;
    expect(receipt).toMatchObject({
      inputBefore: expect.any(String),
      inputAfter: expect.any(String),
    });
    expect(receipt).not.toHaveProperty('inputSnapshot');
    const completed = await submitVerifierResult(prepared);
    expect(completed.actions.at(-1)).toMatchObject({ stepId: 'verify.report', status: 'pending' });
  });

  it('upgrades a persisted 0.5.0 receipt once through refreshChecks before accepting another shell', async () => {
    const prepared = await checkedCandidate({ legacyReceipt: true });
    const { root, runtime, store, check } = prepared;
    const candidateId = (prepared.run.state as unknown as NativePortableState).builder_handoff!
      .candidate_id;
    vi.stubEnv('HTTP_PROXY', 'http://first-verifier-proxy.invalid:3128');
    await expect(submitVerifierResult(prepared)).rejects.toThrow(
      /OUTCOME_REJECTED.*refreshChecks/u,
    );
    const rejected = (await store.read(prepared.run.runId))!;
    expect(rejected.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'running' });
    const state = rejected.state as unknown as NativePortableState;
    const requested = await succeedLatestAction(
      runtime,
      rejected,
      root,
      'legacy-refresh-request',
      {
        candidateId,
        verifierExecutionRef: 'verifier-session',
        refreshChecks: true,
        response: {
          kind: 'request-checks',
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          checks: [check],
        },
      },
      'verifier-session',
    );
    expect(requested.actions.at(-1)).toMatchObject({
      stepId: 'verify.requested-checks',
      status: 'pending',
    });
    const refreshed = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'legacy-refresh-checks', projectRoot: root },
    });
    expect(refreshed.outputs['verify.requested-checks'].value).toMatchObject({
      candidateId,
      inputSnapshot: {
        schema: 'comet.native.check-input.v2',
        before: expect.any(String),
        after: expect.any(String),
        complete: true,
        diagnostics: [],
      },
    });
    vi.stubEnv('HTTP_PROXY', 'http://second-verifier-proxy.invalid:3128');
    vi.stubEnv('TEMP', path.join(root, 'another-verifier-temp'));
    const completed = await submitVerifierResult({ ...prepared, run: refreshed });
    expect(completed.actions.at(-1)).toMatchObject({ stepId: 'verify.report', status: 'pending' });
    expect((completed.state as unknown as NativePortableState).builder_handoff!.candidate_id).toBe(
      candidateId,
    );
    expect(completed.actions.filter((action) => action.stepId === 'build.builder')).toHaveLength(1);
    await completeArchive(prepared, completed);
  });

  it('accepts the final result after Next cache, trace and non-type dev output churn', async () => {
    const prepared = await checkedCandidate();
    for (const [file, content] of [
      ['.next/cache/webpack/client-development/0.pack', 'new cache'],
      ['.next/trace', 'new trace'],
      ['.next/dev/server/app/page.js', 'new dev output'],
      ['.next/dev/logs/next-development.log', 'new dev log'],
    ]) {
      await writeProjectFile(prepared.root, file, content);
    }
    const completed = await submitVerifierResult(prepared);
    await completeArchive(prepared, completed);
  });
});
