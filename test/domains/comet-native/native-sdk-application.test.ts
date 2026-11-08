import { build } from 'esbuild';
import * as portableCheckpoints from '../../../domains/engine/portable-run-checkpoint.js';
import * as checkpointLocks from '../../../platform/fs/recoverable-file-lock.js';
import { parse as parseYaml } from 'yaml';
import { inspectNativeHookGuard } from '../../../domains/comet-native/native-hook-guard.js';
import { refreshNativeSdkVerificationReport } from '../../../domains/comet-native/native-sdk-report.js';
import * as nativeReportView from '../../../domains/comet-native/native-verification-report-v2.js';
import { withCometRuntimeMetrics } from '../../../platform/process/runtime-metrics.js';
import { readRuntimePerformanceRecords } from '../../../platform/process/runtime-performance.js';
import { inspectNativeSdkCancellation } from '../../../domains/comet-native/native-sdk-cancellation.js';
import * as nativeSdkChecks from '../../../domains/comet-native/native-sdk-checks.js';
import * as nativeSdkReportRecovery from '../../../domains/comet-native/native-sdk-report.js';
import * as nativeSdkRevisionRecovery from '../../../domains/comet-native/native-sdk-revise.js';
import * as processIdentity from '../../../platform/process/process-identity.js';
import * as windowsIdentity from '../../../platform/process/windows-process-identity.js';
import { nativeCandidateInputGate } from '../../../domains/comet-native/native-portable-checks.js';
import * as nativePortableChecks from '../../../domains/comet-native/native-portable-checks.js';
import { nativeEditReviewScope } from '../../../domains/comet-native/native-edit-review.js';
import {
  nativeSdkAutomaticReportAction,
  recoverNativeSdkReportRevalidation,
} from '../../../domains/comet-native/native-sdk-report.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { createLegacyNativeSdkChange } from '../../helpers/native-legacy-sdk-change.js';
import { requireFileSymlink } from '../../helpers/file-symlink.js';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import { waitForCondition, waitForProcessExit } from '../../helpers/native-portable-process.js';
import {
  assertNativeSdkCandidateUnchanged,
  nativeSdkCheckExecutor,
  nativeSdkCurrentCheckSummaries,
  recoverNativeSdkChecks,
} from '../../../domains/comet-native/native-sdk-checks.js';
import {
  inspectNativeSdkCheckExecutions,
  hasNativeSdkPortableStopEvidence,
  reconcileNativeSdkExecutionStops,
  createNativeSdkCheckExecution,
  acknowledgeNativeSdkCheckStopped,
} from '../../../domains/comet-native/native-sdk-check-execution.js';

import * as nativeDomain from '../../../domains/comet-native/index.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { prepareNativePortableShapeConfirmation } from '../../../domains/comet-native/native-loop-runtime.js';
import { inspectNativeSdkArchiveFinalization } from '../../../domains/comet-native/native-portable-archive.js';
import { removeNativeWorkspaceConfig } from '../../../domains/comet-native/native-workspace-config.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import { advanceNativeSdkChange } from '../../../domains/comet-native/native-sdk-next.js';
import { nativeSdkImplementationRevisionExecutor } from '../../../domains/comet-native/native-sdk-revise.js';
import {
  nativeTotalSpecHash,
  nativeLegacySectionHash,
} from '../../../domains/comet-native/native-delta-spec.js';
import { runNativeEditReviewCommand } from '../../../domains/comet-native/native-edit-review-command.js';
import { captureApprovedShapeOriginals } from '../../../domains/comet-native/native-shape-review-evidence.js';
import {
  projectNativeSdkContinuation,
  projectNativeSdkDispatchResult,
  nativeSdkTaskResultTemplate,
} from '../../../domains/comet-native/native-sdk-continuation.js';
import {
  inspectNativeSdkDefinitionUpgrade,
  loadOwnedNativeSdkRuntime,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import {
  nativeSdkBeforeReportRecovery,
  nativeSdkBeforeImplementationRevision,
  nativeSdkBeforeArchiveCandidateRecovery,
  nativeSdkLegacyTransitionHandler,
  nativeSdkBeforeVerifierRecovery,
} from '../../../domains/comet-native/native-sdk-definition.js';
import {
  nativeSdkArchivePreflightExecutor,
  nativeSdkArchivePreflightValidator,
  nativeSdkArchiveFinalizeExecutor,
  nativeSdkArchiveApplyExecutor,
} from '../../../domains/comet-native/native-sdk-archive.js';
import { archiveNativeSdkChange } from '../../../domains/comet-native/native-sdk-archive-command.js';
import * as nativeRequirements from '../../../domains/comet-native/native-portable-requirements.js';
import { nativeSupervisorStateFile } from '../../../domains/comet-native/native-supervisor-state.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import {
  createMemoryRuntimeStore,
  createPortableRunCheckpoint,
  readPortableRunCheckpoint,
  createFileRuntimeStore,
  createRuntime,
  type DefineWorkflowOptions,
  type RuntimeValidator,
  type RuntimeStateValidator,
  type RuntimeExecutor,
  type WorkflowRun,
  type WorkflowTransitionHandler,
  hashRuntimeValue,
} from '../../../domains/engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
  recoverSdkChangeOwnerToActive,
} from '../../../domains/workflow-contract/change-runtime-owner.js';

/** 归档阻塞保留原错误；未完成的 Action 通过退出码 73 返回恢复信息。 */
async function expectArchiveFailure(
  operation: ReturnType<typeof archiveNativeSdkChange>,
  expected?: string | RegExp,
) {
  let message: string;
  try {
    const result = await operation;
    expect(result.exitCode, JSON.stringify(result)).toBe(73);
    expect(result.error?.code).toBe('blocked');
    message = result.error!.message;
  } catch (error) {
    if (!(error instanceof Error) || error.name === 'AssertionError') throw error;
    message = error.message;
  }
  if (typeof expected === 'string') expect(message).toContain(expected);
  else if (expected) expect(message).toMatch(expected);
}

function expectOriginalActionFacts(run: WorkflowRun, expected: WorkflowRun['actions']) {
  const actual = run.actions.filter((action) => expected.some(({ id }) => id === action.id));
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    const { executionStop: oldStop, ...oldFacts } = expected[index];
    const { executionStop: newStop, ...newFacts } = actual[index];
    expect(newFacts).toEqual(oldFacts);
    if (oldStop) expect(newStop).toEqual(oldStop);
    else if (newStop) expect(hasNativeSdkPortableStopEvidence(run, actual[index])).toBe(true);
  }
}

type NativeApplication = {
  workflow: DefineWorkflowOptions;
  transitionHandler: WorkflowTransitionHandler;
  validators: readonly RuntimeValidator[];
  stateValidators: readonly RuntimeStateValidator[];
  executors: readonly RuntimeExecutor[];
};

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-sdk-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  const config = defaultProjectConfig('docs', 'en');
  await writeProjectConfig(root, {
    ...config,
    native: { ...config.native, document_writes: 'revert' },
  });
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const changeDir = path.join(paths.changesDir, 'sdk-shape');
  await fs.mkdir(changeDir);
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    `# Outcome
Ship the selected workflow.
# Scope
Preserve the selected workflow.
## Directory structure
### Modified
- domains/workflow.ts: preserve workflow recovery.
# Non-goals
None.
# Acceptance examples
- The selected workflow resumes.
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
  await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'specs', 'workflow', 'spec.md'),
    '# Workflow\nThe selected workflow resumes without losing confirmed work.\n',
  );
  return {
    root,
    paths,
    changeDir,
    initialState: createNativePortableState({
      name: 'sdk-shape',
      language: 'en',
      createdAt: '2026-09-24T00:00:00.000Z',
      nextAction: 'prepare-shape-confirmation',
    }),
  };
}

async function allowAgentDocumentReview(root: string) {
  const config = defaultProjectConfig('docs', 'en');
  await writeProjectConfig(root, {
    ...config,
    native: { ...config.native, document_writes: 'allow' },
  });
}

function nativeApplication(version: '1' | '2' | '3' = '1'): NativeApplication {
  const define = (nativeDomain as Record<string, unknown>).defineNativeWorkflowApplication;
  expect(define).toBeTypeOf('function');
  return (define as (version: '1' | '2' | '3') => NativeApplication)(version);
}

function preCheckRecoveryApplication(): NativeApplication {
  const application = nativeApplication();
  const workflow = nativeSdkBeforeVerifierRecovery(application.workflow);
  delete workflow.steps['verify.checks-stop'];
  workflow.transitions = workflow.transitions.filter(
    ({ from, to, on }) =>
      from !== 'verify.checks-stop' &&
      to !== 'verify.checks-stop' &&
      !(from === 'verify.checks' && on === 'failed'),
  );
  return {
    ...application,
    workflow,
    transitionHandler: nativeSdkLegacyTransitionHandler(workflow, application.transitionHandler),
  };
}

function preChildArchiveApplication(): NativeApplication {
  const application = preCheckRecoveryApplication();
  const workflow = structuredClone(application.workflow);
  delete workflow.steps['supervisor.child.archive'];
  workflow.transitions = workflow.transitions.filter(
    ({ from, to }) => from !== 'supervisor.child.archive' && to !== 'supervisor.child.archive',
  );
  return {
    ...application,
    workflow,
    transitionHandler: {
      ...application.transitionHandler,
      apply({ run, event }) {
        // 重现旧定义：集成检查成功后直接推进下一 Child，不产生归档 Action。
        if (
          event.kind === 'action-outcome' &&
          event.stepId === 'supervisor.child.integration-checks' &&
          event.outcome.status === 'succeeded'
        )
          return application.transitionHandler.apply({
            run,
            event: {
              ...event,
              stepId: 'supervisor.child.archive',
              outcome: {
                ...event.outcome,
                output: {
                  integrationCommit: (event.outcome.output as { candidateId: string }).candidateId,
                },
              },
            },
          });
        return application.transitionHandler.apply({ run, event });
      },
    },
  };
}

function collectProposal(
  paths: Awaited<ReturnType<typeof nativeProjectPaths>>,
  state: NativePortableState,
  materializeTargets = false,
) {
  const collect = (nativeDomain as Record<string, unknown>).collectNativeSdkShapeProposal;
  expect(collect).toBeTypeOf('function');
  return (
    collect as (options: {
      paths: typeof paths;
      state: NativePortableState;
      materializeTargets?: boolean;
    }) => Promise<unknown>
  )({ paths, state, materializeTargets });
}

async function succeedLatestAction(
  runtime: ReturnType<typeof createRuntime>,
  run: WorkflowRun,
  output: unknown,
  root: string,
  receipt: string,
  sessionId?: string,
) {
  const action = run.actions.at(-1)!;
  const context = { requestId: receipt, projectRoot: root };
  const claimed = await runtime.claim({
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
      output,
    },
    context,
  });
}

async function preparedShape(
  storeKind: 'memory' | 'file' | 'sdk' = 'memory',
  application = nativeApplication(),
  beforeShape?: (root: string) => Promise<void>,
) {
  const fixtureData = await fixture();
  await beforeShape?.(fixtureData.root);
  const store =
    storeKind === 'sdk'
      ? createNativeSdkStateStore(fixtureData.root)
      : storeKind === 'file'
        ? createFileRuntimeStore<WorkflowRun>({
            rootDir: path.join(resolveWorkspaceRuntimeRootSync(fixtureData.root), 'sdk-runs'),
          })
        : createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({
    store,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    validators: application.validators,
    stateValidators: application.stateValidators,
    commandValidators: application.commandValidators,
    executors: application.executors,
  });
  let run = await runtime.start({
    runId: storeKind === 'sdk' ? 'sdk-shape' : 'native-sdk-shape',
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: { name: 'sdk-shape', artifactRootRef: 'docs' },
    initialState: fixtureData.initialState,
  });
  if (storeKind === 'sdk') {
    await registerSdkChangeOwner(fixtureData.root, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: 'sdk-shape',
      format: 'sdk',
      application: 'native',
      runId: run.runId,
    });
  }
  run = await succeedLatestAction(
    runtime,
    run,
    await collectProposal(fixtureData.paths, fixtureData.initialState),
    fixtureData.root,
    'shape-proposal',
  );
  return { ...fixtureData, application, store, runtime, run };
}

async function dispatchedVerifier(
  verificationChecks: unknown[] = [],
  storeKind: 'memory' | 'file' | 'sdk' = 'memory',
  application = nativeApplication(),
  executeChecks = true,
  beforeChecks?: (root: string) => Promise<void>,
  beforeShape?: (root: string) => Promise<void>,
) {
  const prepared = await preparedShape(storeKind, application, beforeShape);
  const { root, paths, runtime } = prepared;
  const shapeWait = prepared.run.waits.at(-1)!;
  let run = await runtime.resolveWait({
    runId: prepared.run.runId,
    waitId: shapeWait.id,
    proposalHash: shapeWait.proposalHash,
    decisionId: 'shape-approved',
    choice: 'approved',
  });
  run = await succeedLatestAction(
    runtime,
    run,
    await collectProposal(paths, run.state as NativePortableState),
    root,
    'shape-revalidated',
  );
  run = await succeedLatestAction(
    runtime,
    run,
    {
      summary: 'Implemented the selected workflow.',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [],
      knownLimits: [],
      review: null,
      submittedAt: '2026-09-24T01:00:00.000Z',
      verificationChecks,
    },
    root,
    'builder-candidate',
    'builder-session-1',
  );
  await beforeChecks?.(root);
  if (executeChecks)
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'native-check-execution', projectRoot: root },
    });
  return { ...prepared, run };
}

async function recordNonBehavioralEdit(root: string, name: string, summary: string) {
  const observed = (await runNativeEditReviewCommand({
    projectRoot: root,
    name,
    operation: 'observe',
    sessionId: 'builder-session-1',
  })) as { recordTemplate: Record<string, unknown> };
  const reviewRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'native-reviewed-edit-'));
  roots.push(reviewRoot);
  const file = path.join(reviewRoot, 'review.json');
  await fs.writeFile(
    file,
    JSON.stringify({ ...observed.recordTemplate, decision: 'non-behavioral', summary }),
  );
  await runNativeEditReviewCommand({ projectRoot: root, name, operation: 'record', file });
}

async function stalledVerifier(storeKind: 'memory' | 'sdk' = 'memory') {
  const prepared = await dispatchedVerifier([], storeKind);
  const { root, runtime } = prepared;
  let run = prepared.run;
  for (let index = 1; index <= 4; index += 1) {
    const state = run.state as NativePortableState;
    run = await succeedLatestAction(
      runtime,
      run,
      {
        candidateId: state.builder_handoff!.candidate_id,
        verifierExecutionRef: `stalled-verifier-${index}`,
        response: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'fail',
            acceptance: [{ id: 'A1', result: 'failed', reason: 'The same scenario still fails.' }],
            risks: [],
            summary: 'No acceptance progress.',
          },
        },
      },
      root,
      `stalled-result-${index}`,
      `stalled-verifier-${index}`,
    );
    if (index === 4) break;
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder' });
    run = await succeedLatestAction(
      runtime,
      run,
      {
        summary: 'Tried another repair hypothesis.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: `2026-09-24T0${index + 1}:00:00.000Z`,
        verificationChecks: [],
      },
      root,
      `stalled-builder-${index}`,
      `stalled-builder-session-${index}`,
    );
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: `stalled-checks-${index}`, projectRoot: root },
    });
  }
  return { ...prepared, run };
}

async function awaitingArchiveApplication(
  storeKind: 'memory' | 'file' | 'sdk' = 'memory',
  beforePreflight?: (options: { root: string; run: WorkflowRun }) => void | Promise<void>,
  stopBeforePreflight = false,
  prepareProject?: (root: string) => Promise<void>,
  application = nativeApplication(),
  beforeShape?: (root: string) => Promise<void>,
  verificationChecks: unknown[] = [],
) {
  const prepared = await dispatchedVerifier(
    verificationChecks,
    storeKind,
    application,
    true,
    undefined,
    async (root) => {
      await beforeShape?.(root);
      await prepareProject?.(root);
    },
  );
  const { root, runtime } = prepared;
  let run = prepared.run;
  run = await succeedLatestAction(
    runtime,
    run,
    {
      candidateId: (run.state as NativePortableState).builder_handoff!.candidate_id,
      verifierExecutionRef: 'verifier-session-1',
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'pass',
          acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified the selected workflow.' }],
          risks: [],
          summary: 'All acceptance scenarios passed.',
        },
      },
    },
    root,
    'verifier-result',
    'verifier-session-1',
  );
  for (const [executorId, requestId] of [
    ['comet-native-report', 'native-report'],
    ['comet-native-report-revalidate', 'native-report-revalidate'],
    ['comet-native-archive-preflight', 'native-archive-preflight'],
  ]) {
    if (run.waits.at(-1)?.stepId === 'verify.confirm' && run.waits.at(-1)?.status === 'pending') {
      const wait = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'verification-approved',
        choice: 'approved',
      });
    }
    if (executorId === 'comet-native-archive-preflight') {
      if (stopBeforePreflight) break;
      await beforePreflight?.({ root, run });
    }
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId,
      context: { requestId, projectRoot: root },
    });
  }
  return { ...prepared, run };
}

describe('Native protocol simplification', () => {
  it('archives declared test outputs while continuing to bind generated application inputs', async () => {
    const prepared = await awaitingArchiveApplication(
      'sdk',
      undefined,
      true,
      async (root) => {
        await fs.writeFile(path.join(root, '.gitignore'), 'dist/\n');
        await fs.mkdir(path.join(root, 'dist/eval'), { recursive: true });
        await fs.writeFile(path.join(root, 'dist/application.js'), 'original application');
      },
      nativeApplication(),
      undefined,
      [
        {
          id: 'test-output',
          name: 'Test with trace output',
          executable: process.execPath,
          argv: ['-e', 'require("node:fs").writeFileSync("dist/eval/trace.json", "trace")'],
          cwdRef: '.',
          timeoutMs: 5000,
          repeatable: true,
          outputs: ['dist/eval'],
        },
      ],
    );
    const { root, runtime, run } = prepared;
    await fs.writeFile(path.join(root, 'dist/eval/verifier.json'), 'independent trace');
    const result = spawnSync(
      process.execPath,
      [
        path.resolve('assets/skills/comet-native/scripts/comet-native-archive.mjs'),
        run.runId,
        '--project-root',
        root,
        '--json',
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect((await runtime.inspect(run.runId)).status).toBe('completed');
    expect(await fs.readFile(path.join(root, 'dist/eval/verifier.json'), 'utf8')).toBe(
      'independent trace',
    );
  });
  it.each(['absent', 'present', 'unknown'] as const)(
    'reconciles legacy EPERM only with explicit stop evidence and Windows enumeration %s',
    async (presence) => {
      const {
        root,
        runtime,
        run: ready,
      } = await dispatchedVerifier([], 'sdk', nativeApplication(), false);
      const pending = ready.actions.at(-1)!;
      const run = await runtime.claim({
        runId: ready.runId,
        actionId: pending.id,
        attempt: pending.attempt,
        inputHash: pending.inputHash,
        executorId: 'comet-native-checks',
        claimToken: 'legacy-eperm',
        context: { requestId: 'legacy-eperm', projectRoot: root },
      });
      const action = run.actions.at(-1)!;
      const registration = await createNativeSdkCheckExecution({
        projectRoot: root,
        run,
        action,
        candidateId: (run.state as NativePortableState).builder_handoff!.candidate_id,
        plansHash: hashRuntimeValue([]),
      });
      registration.execution.owner = { pid: 2147483001 };
      registration.execution.child = { pid: 2147483002 };
      registration.execution.phase = 'interrupted';
      registration.execution.terminationUnconfirmed = true;
      await registration.save();
      const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
      const original = processIdentity.inspectProcessLiveness;
      vi.spyOn(processIdentity, 'inspectProcessLiveness').mockImplementation((pid, identity) =>
        pid === 2147483001 ? Promise.resolve('dead') : original(pid, identity),
      );
      vi.spyOn(processIdentity, 'inspectProcessTreeLiveness').mockResolvedValue('unknown');
      vi.spyOn(windowsIdentity, 'inspectWindowsProcessPresence').mockResolvedValue(presence);
      const stoppedAction = {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        evidence:
          'Original check and all descendants were observed stopped; legacy PID is absent in system enumeration.',
      };
      Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
      try {
        await expect(
          acknowledgeNativeSdkCheckStopped({
            projectRoot: root,
            run,
            action,
            stoppedAction: { ...stoppedAction, claimToken: 'wrong' },
          }),
        ).rejects.toThrow(/领取/u);
        if (presence === 'absent') {
          const stoppedFile = path.join(
            resolveWorkspaceRuntimeRootSync(root),
            'stopped-actions.json',
          );
          await fs.writeFile(stoppedFile, JSON.stringify([stoppedAction]));
          const result = await nativeDoctorCommand(
            [run.runId, '--repair', '--confirmed', '--stopped-actions', stoppedFile],
            root,
          );
          expect(result.exitCode, JSON.stringify(result)).toBe(0);
          const repaired = await runtime.inspect(run.runId);
          expect(repaired.actions.find((entry) => entry.id === action.id)?.status).toBe('failed');
          expect((repaired.state as NativePortableState).builder_handoff).toEqual(
            (run.state as NativePortableState).builder_handoff,
          );
        } else
          await expect(
            acknowledgeNativeSdkCheckStopped({ projectRoot: root, run, action, stoppedAction }),
          ).rejects.toThrow(/尚未确认退出/u);
      } finally {
        Object.defineProperty(process, 'platform', descriptor);
      }
      const inspection = (await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0];
      expect(inspection.quiescent).toBe(presence === 'absent');
    },
  );
  it('records a failed read-only preflight without resampling its transient diagnostic', async () => {
    const { root, runtime, run } = await awaitingArchiveApplication('sdk', undefined, true);
    const action = run.actions.at(-1)!;
    await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: nativeSdkArchivePreflightExecutor.id,
      claimToken: 'preflight-claim',
      context: { requestId: 'preflight-claim', projectRoot: root },
    });
    const completed = await runtime.recordOutcome({
      runId: run.runId,
      context: { requestId: 'transient-preflight', projectRoot: root },
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'preflight-claim',
        outcomeId: 'transient-preflight',
        status: 'failed',
        output: {
          ready: false,
          reason: 'candidate-unavailable',
          message: 'Input directory changed while sampling.',
        },
      },
    });
    expect(completed.actions.at(-1)?.status).toBe('failed');
    expect(completed.state).toEqual(run.state);
    expect(completed.waits).toEqual(run.waits);
    const result = await runNativeCli(['archive', run.runId, '--project-root', root, '--json']);
    expect(result.exitCode, result.stderr).toBe(0);
    const archived = await runtime.inspect(run.runId);
    expect(archived.status).toBe('completed');
    expect(archived.actions.filter((a) => a.stepId === 'verify.verifier')).toHaveLength(1);
  });

  it('returns the original accepted decision after recovery without clearing acceptance or advancing Archive', async () => {
    const { root, runtime, run } = await awaitingArchiveApplication('sdk', undefined, true);
    const approved = run.waits.find(
      (wait) => wait.stepId === 'verify.confirm' && wait.status === 'resolved',
    )!;
    const decision = {
      expectedAction: 'accept-result' as const,
      expectedStateVersion: (run.state as NativePortableState).state_version - 1,
      proposalHash: approved.proposalHash,
      summary: 'The user already accepted this result.',
    };
    const result = await advanceNativeSdkChange(root, run.runId, decision);
    expect(result.exitCode).toBe(0);
    expect(await runtime.inspect(run.runId)).toEqual(run);
    const stale = await advanceNativeSdkChange(root, run.runId, {
      ...decision,
      proposalHash: 'another-candidate',
    });
    expect(stale.exitCode).toBe(73);
    expect(await runtime.inspect(run.runId)).toEqual(run);
  });

  it('keeps acceptance when a preflight input snapshot is incomplete and archives after a stable retry', async () => {
    const { root, runtime, run } = await awaitingArchiveApplication('sdk', undefined, true);
    const inspect = vi
      .spyOn(nativeSdkChecks, 'assertNativeSdkArchiveCheckInputs')
      .mockRejectedValueOnce(
        new nativeSdkChecks.NativeSdkCheckInputSnapshotError('Directory changed during sampling'),
      );
    const action = run.actions.at(-1)!;
    const failed = await runtime.execute({
      runId: run.runId,
      actionId: action.id,
      executorId: nativeSdkArchivePreflightExecutor.id,
      context: { requestId: 'incomplete-snapshot', projectRoot: root },
    });
    expect(failed.actions.at(-1)?.outcome).toMatchObject({
      status: 'failed',
      output: { ready: false, reason: 'candidate-unavailable' },
    });
    expect(failed.state).toEqual(run.state);
    expect(failed.waits).toEqual(run.waits);
    inspect.mockRestore();
    const result = await runNativeCli(['archive', run.runId, '--project-root', root, '--json']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect((await runtime.inspect(run.runId)).status).toBe('completed');
  });

  it('recovers a rejected running preflight through public archive without rebuilding accepted work', async () => {
    const { root, runtime, run } = await awaitingArchiveApplication('sdk', undefined, true);
    const action = run.actions.at(-1)!;
    await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: nativeSdkArchivePreflightExecutor.id,
      claimToken: 'rejected-preflight',
      context: { requestId: 'claim', projectRoot: root },
    });
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        context: { requestId: 'obsolete-preflight', projectRoot: root },
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'rejected-preflight',
          outcomeId: 'obsolete-preflight',
          status: 'succeeded',
          output: { ready: true },
        },
      }),
    ).rejects.toThrow();
    expect((await runtime.inspect(run.runId)).actions.at(-1)?.status).toBe('running');
    await reconcileNativeSdkExecutionStops(root, await runtime.inspect(run.runId), runtime);
    const status = JSON.parse(
      (await runNativeCli(['status', run.runId, '--project-root', root, '--json'])).stdout!,
    );
    expect(status.data.continuation.commandArgs).toContain('--recover');
    const recovered = spawnSync(
      process.execPath,
      [
        path.resolve('assets/skills/comet-native/scripts/comet-native-archive.mjs'),
        run.runId,
        '--recover',
        '--project-root',
        root,
        '--json',
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    expect(recovered.status, recovered.stderr || recovered.stdout).toBe(0);
    const after = await runtime.inspect(run.runId);
    expect(after.actions.find((a) => a.id === action.id)?.status).toBe('succeeded');
    expect(after.state).toEqual(run.state);
    expect(after.waits).toEqual(run.waits);
    expect(
      (await runNativeCli(['archive', run.runId, '--project-root', root, '--json'])).exitCode,
    ).toBe(0);
    expect((await runtime.inspect(run.runId)).status).toBe('completed');
  });

  it('preserves an unknown Verifier execution without claiming or replaying it', async () => {
    const { root, runtime, run } = await dispatchedVerifier([], 'sdk');
    const action = run.actions.at(-1)!;
    await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: 'independent-verifier',
      claimToken: 'original-claim',
      context: { requestId: 'claim-verifier', projectRoot: root },
    });
    await runtime.markUnknown({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Platform result is unknown',
    });
    const before = await runtime.inspect(run.runId);
    await runNativeCli(['next', run.runId, '--project-root', root, '--json']);
    const after = await runtime.inspect(run.runId);
    expect(after.actions.at(-1)).toEqual(before.actions.at(-1));
    expect(after.actions).toHaveLength(before.actions.length);
    expect(after.state).toEqual(before.state);
    expect(after.outputs).toEqual(before.outputs);
    expect(after.waits).toEqual(before.waits);
    expect(after.ready).toEqual(before.ready);
  });

  it('stops public next at result confirmation without starting Archive', async () => {
    const prepared = await dispatchedVerifier([], 'sdk');
    const { root, runtime } = prepared;
    const run = await succeedLatestAction(
      runtime,
      prepared.run,
      {
        candidateId: (prepared.run.state as NativePortableState).builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified.' }],
            risks: [],
            summary: 'Passed.',
          },
        },
      },
      root,
      'independent-result',
      'verifier-session',
    );
    await runNativeCli(['next', run.runId, '--project-root', root, '--json']);
    const waiting = await runtime.inspect(run.runId);
    expect(waiting.waits.at(-1)).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
    expect(waiting.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
    await runNativeCli(['next', run.runId, '--project-root', root, '--json']);
    expect(await runtime.inspect(run.runId)).toEqual(waiting);
  });

  it('stops public next after failed checks without dispatching a Verifier', async () => {
    const { root, runtime, run } = await dispatchedVerifier(
      [
        {
          id: 'fail',
          name: 'Failing check',
          executable: process.execPath,
          argv: ['-e', 'process.exit(1)'],
          cwdRef: '.',
          timeoutMs: 10000,
          repeatable: true,
        },
      ],
      'sdk',
      nativeApplication(),
      false,
    );
    await runNativeCli(['next', run.runId, '--project-root', root, '--json']);
    const stopped = await runtime.inspect(run.runId);
    expect(stopped.actions.find((action) => action.stepId === 'verify.checks')).toMatchObject({
      status: 'failed',
      attempt: 1,
    });
    expect(stopped.actions.some((action) => action.stepId === 'verify.verifier')).toBe(false);
  });

  it('collects formal approved originals in the Native observe response', async () => {
    const { root, paths, changeDir, run } = await awaitingArchiveApplication(
      'sdk',
      undefined,
      false,
      undefined,
      nativeApplication(),
      allowAgentDocumentReview,
    );
    await captureApprovedShapeOriginals(paths, run.state as NativePortableState);
    const brief = path.join(changeDir, 'brief.md');
    await fs.appendFile(brief, '\nAdditional explanation only.\n');
    await fs.writeFile(path.join(root, 'implementation.js'), 'export const result = true;');
    const response = await runNativeEditReviewCommand({
      operation: 'observe',
      projectRoot: root,
      name: 'sdk-shape',
      sessionId: 'current-agent',
    });
    expect(response).toHaveProperty('formalReview');
    expect(response).toHaveProperty('recordTemplate');
    expect((response as { formalReview: { recordTemplate: unknown } }).formalReview).toHaveProperty(
      'recordTemplate',
    );
    expect(
      (response as { formalReview: { originalPaths: unknown[] } }).formalReview.originalPaths
        .length,
    ).toBeGreaterThan(0);
  });

  it.each([
    undefined,
    'local-time-without-a-format',
    '2026-11-05T10:30:00Z',
    '2026-10-23T01:00:00.00Z',
  ])(
    'records a Runtime submission time without requiring Agent metadata (%s)',
    async (submittedAt) => {
      const { root, paths, runtime, run: proposed } = await preparedShape();
      const wait = proposed.waits.at(-1)!;
      let run = await runtime.resolveWait({
        runId: proposed.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'approve',
        choice: 'approved',
      });
      run = await succeedLatestAction(
        runtime,
        run,
        await collectProposal(paths, run.state as NativePortableState),
        root,
        'revalidate',
      );
      const before = Date.now();
      run = await succeedLatestAction(
        runtime,
        run,
        {
          summary: 'Implemented the selected workflow.',
          ...(submittedAt === undefined ? {} : { addressedAcceptanceIds: ['A1'] }),
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [],
          ...(submittedAt === undefined ? {} : { submittedAt }),
        },
        root,
        'builder-with-runtime-time',
        'builder-session',
      );
      const handoff = (run.state as NativePortableState).builder_handoff!;
      expect(handoff.addressed_acceptance_ids).toEqual(submittedAt === undefined ? [] : ['A1']);
      expect(handoff.acceptance_review).toHaveLength(1);
      if (submittedAt !== undefined && Number.isFinite(Date.parse(submittedAt))) {
        expect(Date.parse(handoff.submitted_at)).toBe(Date.parse(submittedAt));
      } else {
        expect(Date.parse(handoff.submitted_at)).toBeGreaterThanOrEqual(before);
        expect(Date.parse(handoff.submitted_at)).toBeLessThanOrEqual(Date.now());
      }
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.checks', status: 'pending' });
    },
  );

  it.each(['source', 'bundle'])(
    'drains authorized internal Archive actions through public next without repeating them (%s)',
    async (entry) => {
      const { root, runtime, run } = await awaitingArchiveApplication('sdk', undefined, true);
      const next = async () => {
        if (entry === 'source')
          return (await runNativeCli(['next', run.runId, '--project-root', root, '--json']))
            .exitCode;
        const result = spawnSync(
          process.execPath,
          [
            path.resolve('assets/skills/comet-native/scripts/comet-native-next.mjs'),
            run.runId,
            '--project-root',
            root,
            '--json',
          ],
          { encoding: 'utf8', timeout: 120_000 },
        );
        expect(result.error).toBeUndefined();
        expect(result.stderr).not.toContain('Error');
        return result.status;
      };
      expect(await next()).toBe(0);
      const completed = await runtime.inspect(run.runId);
      expect(completed.status).toBe('completed');
      expect(
        completed.actions
          .filter((action) => action.stepId.startsWith('archive.'))
          .map((action) => [action.stepId, action.status]),
      ).toEqual([
        ['archive.prepare', 'succeeded'],
        ['archive.execute', 'succeeded'],
        ['archive.finalize', 'succeeded'],
      ]);
      expect(await next()).toBe(0);
      expect(await runtime.inspect(run.runId)).toEqual(completed);
    },
  );

  it('stops public next at an independent Verifier handoff', async () => {
    const { root, runtime, run } = await dispatchedVerifier([], 'sdk', nativeApplication(), false);
    const result = await runNativeCli(['next', run.runId, '--project-root', root, '--json']);
    expect(result.exitCode).toBe(0);
    const current = await runtime.inspect(run.runId);
    expect(current.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    expect(current.actions.at(-1)?.claim).toBeUndefined();
    expect(current.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
  });
});

async function initializeArchiveGit(root: string) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  await fs.writeFile(path.join(root, 'implementation.js'), 'export const result = true;');
  execFileSync('git', ['add', 'implementation.js'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
}

async function awaitingArchiveFinalization(storeKind: 'memory' | 'file' = 'memory') {
  const prepared = await awaitingArchiveApplication(storeKind);
  const run = await prepared.runtime.execute({
    runId: prepared.run.runId,
    actionId: prepared.run.actions.at(-1)!.id,
    executorId: 'comet-native-archive-apply',
    context: { requestId: 'native-archive-apply', projectRoot: prepared.root },
  });
  return { ...prepared, run };
}

describe('Native SDK v2 Archive simplification', () => {
  it('rejects candidate edits between preflight execution and its committed outcome', async () => {
    await expect(
      awaitingArchiveApplication(
        'memory',
        () => {
          const execute = nativeSdkArchivePreflightExecutor.execute;
          vi.spyOn(nativeSdkArchivePreflightExecutor, 'execute').mockImplementationOnce(
            async (action, context, run) => {
              const result = await execute(action, context, run);
              await fs.writeFile(
                path.join(context!.projectRoot!, 'implementation.js'),
                'export const result = false;',
              );
              return result;
            },
          );
        },
        false,
        undefined,
        nativeApplication('2'),
        async (root) => {
          await fs.writeFile(path.join(root, 'implementation.js'), 'export const result = true;');
        },
      ),
    ).rejects.toThrow(/候选|preflight changed|EXECUTION_UNKNOWN|结果/u);
  });

  it('accepts structured evidence after the reading report is edited before confirmation', async () => {
    const {
      root,
      changeDir,
      runtime,
      run: pending,
    } = await dispatchedVerifier([], 'memory', nativeApplication('2'));
    const state = pending.state as NativePortableState;
    let run = await succeedLatestAction(
      runtime,
      pending,
      {
        candidateId: state.builder_handoff!.candidate_id,
        verifierExecutionRef: 'view-verifier',
        response: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'pass',
            acceptance: [
              {
                id: 'A1',
                result: 'passed',
                reason: 'The implementation satisfies the approved criterion.',
              },
            ],
            risks: [],
            summary: 'Verified the candidate.',
          },
        },
      },
      root,
      'view-verifier-result',
      'view-verifier',
    );
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report',
      context: { requestId: 'view-report', projectRoot: root },
    });
    const report = path.join(changeDir, 'verification.md');
    await fs.appendFile(report, '\nHuman note added after reading the result.\n');
    const wait = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'view-approved',
      choice: 'approved',
    });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report-revalidate',
      context: { requestId: 'view-revalidation', projectRoot: root },
    });
    expect((run.state as NativePortableState).phase).toBe('archive');
    expect((run.state as NativePortableState).verification_result).toBe('pass');
    expect(await fs.readFile(report, 'utf8')).toContain('Human note added');
    expect(run.actions.filter((action) => action.stepId === 'verify.verifier')).toHaveLength(1);
  });

  it('collects one current input snapshot per preflight execution and commit boundary', async () => {
    const { root, runtime, run } = await awaitingArchiveApplication(
      'memory',
      undefined,
      true,
      undefined,
      nativeApplication('2'),
    );
    const snapshots = vi.spyOn(nativePortableChecks, 'nativeRawInputSnapshot');
    const prepared = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-archive-preflight',
      context: { requestId: 'single-preflight-observation', projectRoot: root },
    });
    expect(prepared.outputs['archive.prepare'].value).toMatchObject({ ready: true });
    expect(snapshots).toHaveBeenCalledTimes(2);
  });

  it('archives a current Spec while another active SDK change declares the same capability', async () => {
    const peerName = 'capability-peer';
    const prepared = await awaitingArchiveApplication(
      'sdk',
      undefined,
      true,
      async (root) => {
        const paths = await nativeProjectPaths(root, 'docs');
        const peerDir = path.join(paths.changesDir, peerName);
        await fs.mkdir(path.join(peerDir, 'specs/workflow'), { recursive: true });
        await fs.copyFile(
          path.join(paths.changesDir, 'sdk-shape', 'brief.md'),
          path.join(peerDir, 'brief.md'),
        );
        await fs.copyFile(
          path.join(paths.changesDir, 'sdk-shape', 'specs/workflow/spec.md'),
          path.join(peerDir, 'specs/workflow/spec.md'),
        );
      },
      nativeApplication('2'),
    );
    const { root, paths } = prepared;
    const peerApplication = nativeApplication('2');
    const peerRuntime = createRuntime({
      ...peerApplication,
      workflows: [peerApplication.workflow],
      transitionHandlers: [peerApplication.transitionHandler],
      store: createNativeSdkStateStore(root),
    });
    const peerInitial = createNativePortableState({
      name: peerName,
      language: 'en',
      nextAction: 'prepare-shape-confirmation',
    });
    let peerRun = await peerRuntime.start({
      runId: peerName,
      workflow: { id: peerApplication.workflow.id, version: peerApplication.workflow.version },
      input: { name: peerName, artifactRootRef: 'docs' },
      initialState: peerInitial,
    });
    await registerSdkChangeOwner(root, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: peerName,
      format: 'sdk',
      application: 'native',
      runId: peerName,
    });
    peerRun = await succeedLatestAction(
      peerRuntime,
      peerRun,
      await collectProposal(paths, peerInitial),
      root,
      'peer-shape',
    );
    const result = await runNativeCli(['archive', 'sdk-shape', '--project-root', root, '--json']);
    expect(result.exitCode).toBe(0);
    expect((await prepared.runtime.inspect(prepared.run.runId)).status).toBe('completed');
    expect((await peerRuntime.inspect(peerName)).state).toEqual(peerRun.state);
    expect(await fs.readFile(path.join(paths.specsDir, 'workflow/spec.md'), 'utf8')).toContain(
      'workflow',
    );
  });

  it('refuses an actual canonical Spec conflict after preflight without overwriting it', async () => {
    const { root, paths, runtime, run } = await awaitingArchiveApplication(
      'sdk',
      undefined,
      false,
      undefined,
      nativeApplication('2'),
    );
    const canonical = path.join(paths.specsDir, 'workflow/spec.md');
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    const changed = '# Workflow\n\nAnother accepted change owns these bytes.\n';
    await fs.writeFile(canonical, changed);
    const result = await runNativeCli(['archive', 'sdk-shape', '--project-root', root, '--json']);
    expect(result.exitCode).toBe(73);
    expect(await fs.readFile(canonical, 'utf8')).toBe(changed);
    expect((await runtime.inspect(run.runId)).status).not.toBe('completed');
  });

  it.each(['edited', 'missing'] as const)(
    'archives the accepted structured result with a %s report view',
    async (kind) => {
      const { root, paths, changeDir, runtime, run } = await awaitingArchiveApplication(
        'sdk',
        undefined,
        true,
        undefined,
        nativeApplication('2'),
      );
      const report = path.join(changeDir, 'verification.md');
      const edited = `${await fs.readFile(report, 'utf8')}\nUser note preserved exactly.\n`;
      if (kind === 'edited') await fs.writeFile(report, edited);
      else await fs.rm(report);
      const status = await runNativeCli(['status', 'sdk-shape', '--project-root', root, '--json']);
      expect(status.exitCode).toBe(0);
      expect(JSON.stringify(JSON.parse(status.stdout!).data.recovery ?? null)).not.toMatch(
        /verification-report-drift|report-missing/u,
      );
      const result = await runNativeCli(['archive', 'sdk-shape', '--project-root', root, '--json']);
      expect(result.exitCode).toBe(0);
      const completed = await runtime.inspect(run.runId);
      expect(completed.status).toBe('completed');
      const receipt = completed.outputs['archive.finalize'].value as {
        archiveRef: string;
        verificationResultHash: string;
        preservedReportsRef: string;
      };
      expect(receipt.verificationResultHash).toMatch(/^[a-f0-9]{64}$/u);
      const archivedReport = path.join(paths.archiveDir, receipt.archiveRef, 'verification.md');
      expect(await fs.readFile(archivedReport, 'utf8')).toContain('Archived');
      if (kind === 'edited') {
        const preserved = path.join(
          paths.workspaceRuntimeRoot,
          receipt.preservedReportsRef,
          `${createHash('sha256').update(edited).digest('hex')}.md`,
        );
        expect(await fs.readFile(preserved, 'utf8')).toBe(edited);
      }
      await fs.writeFile(archivedReport, 'User updated the reading view after archiving.\n');
      const recovered = await runNativeCli([
        'archive',
        'sdk-shape',
        '--recover',
        '--project-root',
        root,
        '--json',
      ]);
      expect(recovered.exitCode).toBe(0);
      expect(JSON.parse(recovered.stdout!).data.alreadyArchived).toBe(true);
    },
  );
});

describe('Native SDK Workflow Application', () => {
  it('waits for the original Archive task before parsing complete stdout JSON', async () => {
    const { root, run } = await awaitingArchiveApplication();
    const projection = await projectNativeSdkContinuation({
      run,
      state: run.state as unknown as NativePortableState,
      projectRoot: root,
    });
    const instruction = projection.continuation.userCommunication.agentInstruction;
    expect(instruction).toContain('stdout');
    expect(instruction).toContain('stderr');
    expect(instruction).toMatch(/original task|原任务/u);
    expect(instruction).toMatch(/complete JSON|完整 JSON/u);
  });
  it('binds a separate Verifier handoff and accepts its filled outcome template', async () => {
    const { root, runtime, run: prepared } = await dispatchedVerifier();
    const action = prepared.actions.at(-1)!;
    const pending = await projectNativeSdkContinuation({
      run: prepared,
      state: prepared.state as unknown as NativePortableState,
      projectRoot: root,
    });
    expect(pending.pendingAction).toMatchObject({
      stepId: 'verify.verifier',
      contextRequest: { phase: 'verify', contextMode: 'snapshot' },
      sessionRequirements: {
        independent: true,
        readOnly: true,
        mustDifferFromSessionId: 'builder-session-1',
      },
    });
    const handoff = JSON.stringify(pending.pendingActions[0]);
    expect(handoff.indexOf('"independent":true')).toBeLessThan(handoff.indexOf('"input":'));
    const claim = pending.pendingAction!.claimRequest!;
    const { operation: _operation, ...request } = claim;
    const context = { requestId: 'template-verifier', projectRoot: root };
    const claimed = await runtime.claim({
      ...request,
      sessionId: 'template-verifier-session',
      claimToken: 'template-verifier-token',
      context,
    });
    const projection = await projectNativeSdkDispatchResult({
      run: claimed,
      state: claimed.state as unknown as NativePortableState,
      actionId: action.id,
      projectRoot: root,
    });
    const template = projection.outcomeRequest!;
    const fields = Object.keys(projection);
    expect(fields.indexOf('outcomeRequest')).toBeLessThan(fields.indexOf('state'));
    expect(fields.indexOf('contextRequest')).toBeGreaterThanOrEqual(0);
    expect(fields.indexOf('contextRequest')).toBeLessThan(fields.indexOf('state'));
    expect(projection.outcomeTemplateInstruction).toContain('stdout');
    expect(projection.outcomeTemplateInstruction).toContain('stderr');
    expect(projection.outcomeTemplateInstruction).toContain('data.outcomeRequest');
    expect(projection.outcomeTemplateInstruction).toContain('data.contextRequest');
    const output = template.outcome.output as {
      candidateId: string;
      verifierExecutionRef: string;
      response: {
        kind: string;
        result: { iteration: number; attempt: number; acceptance: { id: string }[] };
      };
    };
    expect(output.verifierExecutionRef).toBe('template-verifier-session');
    expect(output.candidateId).toBe(
      (claimed.state as unknown as NativePortableState).builder_handoff!.candidate_id,
    );
    expect(projection.failureOutcomeRequest).toMatchObject({
      outcome: { claimToken: 'template-verifier-token', status: 'failed' },
    });
    expect(projection.requestChecksOutcomeRequest).toMatchObject({
      outcome: {
        output: {
          candidateId: output.candidateId,
          response: {
            kind: 'request-checks',
            iteration: output.response.result.iteration,
            attempt: output.response.result.attempt,
            checks: [{ cwdRef: '.' }],
          },
        },
      },
    });
    const finished = await runtime.recordOutcome({
      runId: claimed.runId,
      outcome: {
        ...template.outcome,
        status: 'succeeded',
        outcomeId: 'template-verifier-result',
        output: {
          ...output,
          response: {
            kind: 'final-result',
            result: {
              ...output.response.result,
              verdict: 'pass',
              acceptance: output.response.result.acceptance.map(({ id }) => ({
                id,
                result: 'passed',
                reason: 'Independently inspected the fixture implementation and checks.',
              })),
              risks: [],
              summary: 'The fixture meets all confirmed acceptance criteria.',
            },
          },
        },
      },
      context,
    });
    expect(finished.actions.find(({ id }) => id === action.id)?.status).toBe('succeeded');
    expect(finished.state).toMatchObject({ verification_result: 'pass' });
  });

  it('preserves interrupted finalization and recovers its original receipt without replaying Archive', async () => {
    const { root, paths, runtime, run } = await awaitingArchiveApplication('sdk', undefined, true);
    const options = {
      projectRoot: root,
      name: run.runId,
      dryRun: false,
      recover: false,
      confirmed: false,
    };
    const finalize = nativeSdkArchiveFinalizeExecutor.execute;
    vi.spyOn(nativeSdkArchiveFinalizeExecutor, 'execute').mockImplementationOnce(
      async (...args) => {
        await finalize(...args);
        throw new Error('Host lost after persisting the actual Archive receipt');
      },
    );
    await expectArchiveFailure(archiveNativeSdkChange(options), 'EXECUTION_UNKNOWN');
    const interrupted = await runtime.inspect(run.runId);
    expect(interrupted.actions.at(-1)).toMatchObject({
      stepId: 'archive.finalize',
      status: 'unknown',
    });
    expect(interrupted.outputs['archive.execute'].value).toMatchObject({
      transactionId: expect.any(String),
    });
    expect((await archiveNativeSdkChange({ ...options, dryRun: true })).data).toMatchObject({
      ready: false,
    });
    expect(await archiveNativeSdkChange(options)).toMatchObject({
      exitCode: 73,
      error: { code: 'blocked' },
    });
    expect(await runtime.inspect(run.runId)).toEqual(interrupted);
    expect((await archiveNativeSdkChange({ ...options, recover: true })).data).toMatchObject({
      recoveredAction: { id: interrupted.actions.at(-1)!.id, stepId: 'archive.finalize' },
      run: { status: 'completed' },
    });
    const recovered = await runtime.inspect(run.runId);
    expect(recovered.actions.filter((action) => action.stepId.startsWith('archive.'))).toHaveLength(
      3,
    );
    expect(recovered.actions.at(-1)!.claim).toEqual(interrupted.actions.at(-1)!.claim);
    expect(await fs.readdir(path.join(paths.runtimeDir, 'sdk-archive-receipts'))).toHaveLength(1);
    await archiveNativeSdkChange(options);
    expect(await runtime.inspect(run.runId)).toEqual(recovered);
  });

  it.each([0, 1, 2])(
    'completes Archive from persisted checkpoint %i without replaying completed Actions',
    async (checkpoint) => {
      const {
        root,
        runtime,
        run: prepared,
      } = await awaitingArchiveApplication('sdk', undefined, true);
      let run = prepared;
      const executors = ['comet-native-archive-preflight', 'comet-native-archive-apply'];
      for (let index = 0; index < checkpoint; index += 1) {
        run = await runtime.execute({
          runId: run.runId,
          actionId: run.actions.at(-1)!.id,
          executorId: executors[index],
          context: { requestId: `archive-checkpoint-${index}`, projectRoot: root },
        });
      }
      const existing = run.actions.filter((action) => action.status === 'succeeded');
      const options = {
        projectRoot: root,
        name: run.runId,
        dryRun: false,
        recover: false,
        confirmed: false,
      };
      const files = async (
        dir: string,
      ): Promise<Record<string, { content: string; mtimeMs: number }>> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const result: Record<string, { content: string; mtimeMs: number }> = {};
        for (const entry of entries) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) Object.assign(result, await files(file));
          else
            result[file] = {
              content: (await fs.readFile(file)).toString('base64'),
              mtimeMs: (await fs.stat(file)).mtimeMs,
            };
        }
        return result;
      };
      const before = await files(root);
      const preview = await archiveNativeSdkChange({ ...options, dryRun: true });
      expect(preview.data, JSON.stringify(preview.data.blockers)).toMatchObject({ ready: true });
      expect(await runtime.inspect(run.runId)).toEqual(run);
      expect(await files(root)).toEqual(before);
      if (checkpoint === 2) {
        const driftFile = path.join(root, 'unexpected-implementation.js');
        await fs.writeFile(driftFile, 'export const changed = true;');
        const changed = await files(root);
        const blocked = await archiveNativeSdkChange({ ...options, dryRun: true });
        expect(blocked.data).toMatchObject({ ready: false });
        expect(await runtime.inspect(run.runId)).toEqual(run);
        expect(await files(root)).toEqual(changed);
        await fs.rm(driftFile);
      }
      const result = await archiveNativeSdkChange(options);
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        status: 'done',
        run: { status: 'completed' },
        continuation: { disposition: 'done' },
        completedActions: ['archive.prepare', 'archive.execute', 'archive.finalize']
          .slice(checkpoint)
          .map((stepId) => ({ stepId, status: 'succeeded' })),
      });
      const completed = await runtime.inspect(run.runId);
      expectOriginalActionFacts(completed, existing);
      expect(
        completed.actions.filter((action) => action.stepId.startsWith('archive.')),
      ).toHaveLength(3);
      expect(completed.outputs['archive.finalize'].value).toMatchObject({
        transactionId: expect.any(String),
        archiveRef: expect.any(String),
      });
      const repeated = await archiveNativeSdkChange(options);
      expect(repeated.data).toMatchObject({
        completedActions: [],
        run: { revision: completed.revision, status: 'completed' },
      });
      expect(await runtime.inspect(run.runId)).toEqual(completed);
    },
  );

  it('reads the finalized Archive report once and rejects later report changes', async () => {
    const { root, paths, runtime, run: pending } = await awaitingArchiveFinalization();
    const run = await runtime.execute({
      runId: pending.runId,
      actionId: pending.actions.at(-1)!.id,
      executorId: 'comet-native-archive-finalize',
      context: { requestId: 'archive-report-read-budget', projectRoot: root },
    });
    const state = run.state as NativePortableState;
    const receipt = run.outputs['archive.finalize'].value as {
      archiveRef: string;
      reportSha256: string;
    };
    const reportFile = path.join(paths.archiveDir, receipt.archiveRef, 'verification.md');
    const original = await fs.readFile(reportFile, 'utf8');
    expect(receipt.reportSha256).toBe(createHash('sha256').update(original).digest('hex'));
    const inspect = () => inspectNativeSdkArchiveFinalization({ paths, state, runId: run.runId });
    const opens = vi.spyOn(fs, 'open');
    const reads = vi.spyOn(fs, 'readFile');
    try {
      await expect(inspect()).resolves.toMatchObject(receipt);
      expect(opens.mock.calls.filter(([file]) => String(file) === reportFile)).toHaveLength(1);
      expect(reads.mock.calls.filter(([file]) => String(file) === reportFile)).toHaveLength(0);
    } finally {
      opens.mockRestore();
      reads.mockRestore();
    }

    for (const changed of [`${original}\nUnexpected edit.\n`, `\uFEFF${original}`]) {
      await fs.writeFile(reportFile, changed);
      await expect(inspect()).rejects.toThrow(
        'Native SDK Archive report changed after finalization',
      );
    }
    const receiptsDir = path.join(paths.runtimeDir, 'sdk-archive-receipts');
    const receipts = await fs.readdir(receiptsDir);
    expect(receipts).toHaveLength(1);
    const receiptFile = path.join(receiptsDir, receipts[0]);
    const persistedReceipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    for (const changed of [
      original.replace('generated_from_state_version:', 'invalid_state_version:'),
      original.replace(
        `generated_from_state_version: ${state.state_version}`,
        `generated_from_state_version: ${state.state_version + 1}`,
      ),
    ]) {
      await fs.writeFile(reportFile, changed);
      await fs.writeFile(
        receiptFile,
        JSON.stringify({
          ...persistedReceipt,
          reportSha256: createHash('sha256').update(changed).digest('hex'),
        }),
      );
      await expect(inspect()).rejects.toThrow(
        'Native SDK Archive report changed after finalization',
      );
    }
    await fs.writeFile(reportFile, Buffer.from([0xff]));
    await expect(inspect()).rejects.toThrow('Native artifact is not valid UTF-8');
    await fs.rm(reportFile);
    await expect(inspect()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['pending', 'claimed', 'definition-drift'] as const)(
    'repairs only the known pre-Child-archive definition and preserves Run facts (%s)',
    async (scenario) => {
      const { root, initialState } = await fixture();
      const application = preChildArchiveApplication();
      if (scenario === 'definition-drift') application.workflow.maxTransitions = 999;
      const store = createNativeSdkStateStore(root);
      const runtime = createRuntime({
        ...application,
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        store,
      });
      let run = await runtime.start({
        runId: 'sdk-shape',
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { name: 'sdk-shape', artifactRootRef: 'docs' },
        initialState,
      });
      await registerSdkChangeOwner(root, {
        schema: COMET_CHANGE_OWNER_SCHEMA,
        workflow: 'native',
        change: run.runId,
        format: 'sdk',
        application: 'native',
        runId: run.runId,
      });
      if (scenario === 'claimed') {
        const action = run.actions[0];
        run = await runtime.claim({
          runId: run.runId,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'native-host',
          claimToken: 'original-execution',
        });
      }
      const before = await store.read(run.runId);
      if (scenario === 'definition-drift') {
        expect(await inspectNativeSdkDefinitionUpgrade(root, run.runId, false)).toBeNull();
        expect(await inspectNativeSdkDefinitionUpgrade(root, run.runId, true)).toBeNull();
        expect(await store.read(run.runId)).toEqual(before);
        return;
      }
      expect(await inspectNativeSdkDefinitionUpgrade(root, run.runId, false)).toMatchObject({
        repaired: false,
        ready: scenario === 'pending',
      });
      expect(await store.read(run.runId)).toEqual(before);
      if (scenario === 'claimed') {
        await expect(inspectNativeSdkDefinitionUpgrade(root, run.runId, true)).rejects.toThrow(
          'running',
        );
        expect(await store.read(run.runId)).toEqual(before);
        return;
      }
      expect(await inspectNativeSdkDefinitionUpgrade(root, run.runId, true)).toMatchObject({
        repaired: true,
        ready: true,
      });
      const restored = await createRuntime({
        ...nativeApplication(),
        store,
        workflows: [nativeApplication().workflow],
        transitionHandlers: [nativeApplication().transitionHandler],
      }).inspect(run.runId);
      expect(restored.actions).toEqual(run.actions);
      expect(restored.state).toEqual(run.state);
      expect(restored.revision).toBe(run.revision + 1);
      expect(await inspectNativeSdkDefinitionUpgrade(root, run.runId, true)).toBeNull();
    },
  );
  it('keeps blocked Archive preflight read-only and retries without not-executed evidence', async () => {
    const peerName = 'capability-peer';
    const prepared = await awaitingArchiveApplication('sdk', undefined, true, async (root) => {
      const paths = await nativeProjectPaths(root, 'docs');
      const peerDir = path.join(paths.changesDir, peerName);
      await fs.mkdir(path.join(peerDir, 'specs/workflow'), { recursive: true });
      await fs.copyFile(
        path.join(paths.changesDir, 'sdk-shape', 'brief.md'),
        path.join(peerDir, 'brief.md'),
      );
      await fs.copyFile(
        path.join(paths.changesDir, 'sdk-shape', 'specs/workflow/spec.md'),
        path.join(peerDir, 'specs/workflow/spec.md'),
      );
    });
    const { root, runtime, paths } = prepared;
    const peerDir = path.join(paths.changesDir, peerName);
    const peerApplication = nativeApplication();
    const peerRuntime = createRuntime({
      ...peerApplication,
      workflows: [peerApplication.workflow],
      transitionHandlers: [peerApplication.transitionHandler],
      store: createNativeSdkStateStore(root),
    });
    const peerInitial = createNativePortableState({
      name: peerName,
      language: 'en',
      createdAt: '2026-09-24T00:00:00.000Z',
      nextAction: 'prepare-shape-confirmation',
    });
    const peerRun = await peerRuntime.start({
      runId: peerName,
      workflow: { id: peerApplication.workflow.id, version: peerApplication.workflow.version },
      input: { name: peerName, artifactRootRef: 'docs' },
      initialState: peerInitial,
    });
    await registerSdkChangeOwner(root, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: peerName,
      format: 'sdk',
      application: 'native',
      runId: peerName,
    });
    await succeedLatestAction(
      peerRuntime,
      peerRun,
      await collectProposal(paths, peerInitial),
      root,
      'peer-shape',
    );
    const reportFile = path.join(prepared.changeDir, 'verification.md');
    const reportBefore = await fs.readFile(reportFile, 'utf8');
    let run = await runtime.execute({
      runId: prepared.run.runId,
      actionId: prepared.run.actions.at(-1)!.id,
      executorId: 'comet-native-archive-preflight',
      context: { requestId: 'blocked-preflight', projectRoot: root },
    });
    const failed = run.actions.at(-1)!;
    expect(failed.status).toBe('failed');
    expect(failed.outcome?.output).toMatchObject({ ready: false, capabilityPeers: [peerName] });
    expect(await fs.readFile(reportFile, 'utf8')).toBe(reportBefore);
    const peerBefore = await peerRuntime.inspect(peerName);
    const cancelled = await peerRuntime.cancel({
      runId: peerName,
      reason: 'The user cancelled the competing requirement',
    });
    expect(cancelled.status).toBe('cancelled');
    run = await runtime.retry({ runId: run.runId, actionId: failed.id, attempt: failed.attempt });
    expect(run.actions.at(-1)!.reconciliations).toEqual([]);
    run = await runtime.execute({
      runId: run.runId,
      actionId: failed.id,
      executorId: 'comet-native-archive-preflight',
      context: { requestId: 'retry-preflight', projectRoot: root },
    });
    expect(run.outputs['archive.prepare'].value).toMatchObject({
      ready: true,
      capabilityPeers: [],
    });
    expect(await fs.readFile(reportFile, 'utf8')).toBe(reportBefore);
    expect((await peerRuntime.inspect(peerName)).state).toEqual(peerBefore.state);
    expect(await fs.readFile(path.join(peerDir, 'brief.md'), 'utf8')).toBe(
      await fs.readFile(path.join(prepared.changeDir, 'brief.md'), 'utf8'),
    );
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-archive-apply',
      context: { requestId: 'apply-after-retry', projectRoot: root },
    });
    expect(run.outputs['archive.execute']).toBeDefined();
  });

  it('checks Archive acceptance once at each preparation, execution, and commit boundary', async () => {
    let calls = 0;
    const inspect = nativeRequirements.inspectNativePortableAcceptanceDrift;
    const { run } = await awaitingArchiveApplication('memory', () => {
      vi.spyOn(nativeRequirements, 'inspectNativePortableAcceptanceDrift').mockImplementation(
        async (options) => {
          calls += 1;
          return inspect(options);
        },
      );
    });
    expect(run.outputs['archive.prepare'].value).toMatchObject({ ready: true });
    expect(calls).toBe(2);
  });

  it('rejects Archive document drift before overwriting the confirmed report', async () => {
    let reportFile = '';
    let before = '';
    const { run } = await awaitingArchiveApplication('memory', async ({ root }) => {
      const paths = await nativeProjectPaths(root, 'docs');
      const changeDir = path.join(paths.changesDir, 'sdk-shape');
      reportFile = path.join(changeDir, 'verification.md');
      before = await fs.readFile(reportFile, 'utf8');
      const brief = path.join(changeDir, 'brief.md');
      await fs.writeFile(
        brief,
        (await fs.readFile(brief, 'utf8')).replace(
          'The selected workflow resumes.',
          'The selected workflow requires a different result.',
        ),
      );
    });
    expect(run.actions.at(-1)).toMatchObject({
      status: 'failed',
      outcome: { output: { reason: 'candidate-drift' } },
    });
    expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.stop', status: 'pending' });
    expect(await fs.readFile(reportFile, 'utf8')).toBe(before);
  });

  it('rechecks Archive documents after executor output and before committing the outcome', async () => {
    await expect(
      awaitingArchiveApplication('memory', () => {
        const execute = nativeSdkArchivePreflightExecutor.execute;
        vi.spyOn(nativeSdkArchivePreflightExecutor, 'execute').mockImplementation(
          async (action, context, run) => {
            const output = await execute(action, context, run);
            const paths = await nativeProjectPaths(context!.projectRoot!, 'docs');
            const brief = path.join(paths.changesDir, 'sdk-shape', 'brief.md');
            await fs.writeFile(
              brief,
              (await fs.readFile(brief, 'utf8')).replace(
                'The selected workflow resumes.',
                'The selected workflow changed after preflight.',
              ),
            );
            return output;
          },
        );
      }),
    ).rejects.toThrow(/OUTCOME_REJECTED/u);
  });

  it('waits for an explicit decision before continuing a partially executed Builder in a new Action', async () => {
    const prepared = await preparedShape('file');
    const { root, paths, application, store } = prepared;
    let { run, runtime } = prepared;
    const shapeWait = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: shapeWait.id,
      proposalHash: shapeWait.proposalHash,
      decisionId: 'shape-approved-before-builder-failure',
      choice: 'approved',
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-revalidated-before-builder-failure',
    );
    const builder = run.actions.at(-1)!;
    expect(builder).toMatchObject({ stepId: 'build.builder', status: 'pending' });
    const partialFile = path.join(root, 'partial-builder.txt');
    await fs.writeFile(partialFile, 'partial implementation\n');
    const context = { requestId: 'failed-builder', projectRoot: root };
    run = await runtime.claim({
      runId: run.runId,
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      executorId: 'native-host',
      sessionId: 'failed-builder-session',
      claimToken: 'failed-builder-claim',
      context,
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        claimToken: 'failed-builder-claim',
        outcomeId: 'builder-partial-failure',
        status: 'failed',
        output: { summary: 'The Builder stopped after writing a partial implementation.' },
      },
      context,
    });
    expect(run.actions.filter((action) => action.stepId === 'build.builder')).toHaveLength(1);
    const resumeWait = run.waits.at(-1)!;
    expect(resumeWait).toMatchObject({ stepId: 'build.resume', status: 'pending' });
    expect(await fs.readFile(partialFile, 'utf8')).toBe('partial implementation\n');

    runtime = createRuntime({
      store,
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
      executors: application.executors,
    });
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: resumeWait.id,
      proposalHash: resumeWait.proposalHash,
      decisionId: 'approve-builder-continuation',
      choice: 'continue',
    });
    expect(run.actions.find((action) => action.id === builder.id)).toMatchObject({
      status: 'failed',
      attempt: builder.attempt,
    });
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'build.builder',
      status: 'pending',
      input: { activation: { failedBuilderActionId: builder.id } },
    });
    expect(run.actions.at(-1)!.id).not.toBe(builder.id);
    expect(await fs.readFile(partialFile, 'utf8')).toBe('partial implementation\n');
  });

  it('keeps the candidate and checks when a claimed Verifier execution fails, then waits after repeated failures', async () => {
    const { root, runtime, run: dispatched } = await dispatchedVerifier([], 'file');
    const candidateId = (dispatched.state as NativePortableState).builder_handoff!.candidate_id;
    let run = dispatched;
    for (let index = 1; index <= 3; index += 1) {
      const action = run.actions.at(-1)!;
      expect(action).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
      const context = { requestId: `verifier-execution-failure-${index}`, projectRoot: root };
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'native-host',
        sessionId: `verifier-session-${index}`,
        claimToken: `verifier-claim-${index}`,
        context,
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: claimed.actions.find((entry) => entry.id === action.id)!.claim!.token,
          outcomeId: `verifier-execution-failure-${index}`,
          status: 'failed',
          output: { summary: 'The host confirmed that the Verifier task failed.' },
        },
        context,
      });
      expect(run.state).toMatchObject({
        builder_handoff: { candidate_id: candidateId },
        loop: { execution_failure_count: index },
      });
      expect(run.outputs['verify.checks']).toMatchObject({ value: { candidateId } });
      if (index < 3) {
        expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
      }
    }
    expect(run.state).toMatchObject({ phase: 'verify', status: 'blocked' });
    expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.retry', status: 'pending' });
    const wait = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'user-approved-verifier-retry',
      choice: 'retry',
    });
    expect(run.state).toMatchObject({
      phase: 'verify',
      status: 'active',
      builder_handoff: { candidate_id: candidateId },
      loop: { execution_failure_count: 0 },
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    run = await succeedLatestAction(
      runtime,
      run,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-4',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: (run.state as NativePortableState).loop.attempt,
            verdict: 'pass',
            acceptance: [
              { id: 'A1', result: 'passed', reason: 'The retry verified the workflow.' },
            ],
            risks: [],
            summary: 'The independent retry passed.',
          },
        },
      },
      root,
      'verifier-retry-result',
      'verifier-session-4',
    );
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.report', status: 'pending' });
  });

  it('records document-backed Shape acceptance in the SDK Run before asking the user', async () => {
    const { run } = await preparedShape();
    expect(run.actions[0]).toMatchObject({ stepId: 'shape.prepare', type: 'call_tool' });
    expect(run.state).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      document_constraints_version: 3,
      acceptance: [{ source: 'brief.md', text: 'The selected workflow resumes.' }],
    });
    expect(run.waits.at(-1)).toMatchObject({
      stepId: 'shape.confirm',
      status: 'pending',
      choices: ['approved', 'rejected'],
    });
  });

  it('materializes a Delta target before Shape and refuses independent target edits', async () => {
    const f = await fixture();
    const baseline =
      '# Workflow\n\n## Requirement: workflow.existing Existing behavior\n\nExisting behavior stays available.\n';
    await fs.mkdir(path.join(f.paths.specsDir, 'workflow'), { recursive: true });
    await fs.writeFile(path.join(f.paths.specsDir, 'workflow/spec.md'), baseline);
    await fs.writeFile(path.join(f.changeDir, 'specs/workflow/spec.md'), baseline);
    const delta = {
      schema: 'comet.native.delta.v1',
      capability: 'workflow',
      base_hash: nativeTotalSpecHash(baseline),
      base_version: 1,
      legacy_hash: nativeLegacySectionHash(baseline),
      base_requirements: {
        'workflow.existing': nativeTotalSpecHash(
          '## Requirement: workflow.existing Existing behavior\n\nExisting behavior stays available.\n',
        ),
      },
      operations: [
        {
          id: 'workflow.added',
          operation: 'add',
          title: 'Added behavior',
          body: 'The additional behavior is available.',
        },
      ],
    };
    const deltaFile = path.join(f.changeDir, 'specs/workflow/delta.yaml');
    await fs.writeFile(deltaFile, JSON.stringify(delta));
    const first = (await collectProposal(f.paths, f.initialState, true)) as {
      specChanges: unknown[];
    };
    expect(first.specChanges[0]).toMatchObject({ delta_source: 'specs/workflow/delta.yaml' });
    const target = path.join(f.changeDir, 'specs/workflow/spec.md');
    expect(await fs.readFile(target, 'utf8')).toContain('The additional behavior is available.');
    delta.operations[0].body = 'The revised additional behavior is available.';
    await fs.writeFile(deltaFile, JSON.stringify(delta));
    await expect(collectProposal(f.paths, f.initialState)).rejects.toThrow(
      /target|requirement|Delta|delta/iu,
    );
    expect(await fs.readFile(target, 'utf8')).not.toContain(
      'The revised additional behavior is available.',
    );
    await collectProposal(f.paths, f.initialState, true);
    expect(await fs.readFile(target, 'utf8')).toContain(
      'The revised additional behavior is available.',
    );
    const independent = (await fs.readFile(target, 'utf8')) + '\nUser independent requirement.\n';
    await fs.writeFile(target, independent);
    delta.operations[0].body = 'Another proposed behavior.';
    await fs.writeFile(deltaFile, JSON.stringify(delta));
    await expect(collectProposal(f.paths, f.initialState, true)).rejects.toThrow(
      /independent|独立/iu,
    );
    expect(await fs.readFile(target, 'utf8')).toBe(independent);
  });

  it.each([
    { suffix: '', format: 'summary' },
    { suffix: ' with referenced acceptance', format: 'references' },
  ])(
    'confirms a Supervisor child plan and coordination mode in the same SDK Run$suffix',
    async ({ format }) => {
      const { root, paths, changeDir, initialState } = await fixture();
      await fs.writeFile(
        path.join(changeDir, 'children.yaml'),
        `schema: comet.native.children.v2
children:
  - name: api
    ${format === 'summary' ? 'summary: Build the API' : 'covers: [A1]'}
    depends_on: []
  - name: ui
    ${format === 'summary' ? 'summary: Build the UI' : 'covers: []'}
    depends_on: []
`,
      );
      const application = nativeApplication();
      const runtime = createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        validators: application.validators,
        stateValidators: application.stateValidators,
        commandValidators: application.commandValidators,
        executors: application.executors,
      });
      let run = await runtime.start({
        runId: 'supervisor-sdk-shape',
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { name: 'sdk-shape', artifactRootRef: 'docs' },
        initialState,
      });
      run = await succeedLatestAction(
        runtime,
        run,
        await collectProposal(paths, initialState),
        root,
        'supervisor-shape-proposal',
      );
      const wait = run.waits.at(-1)!;
      if (format === 'references') {
        expect(
          (
            run.outputs['shape.prepare'].value as {
              children: { contract: { acceptance_index: unknown } };
            }
          ).children.contract.acceptance_index,
        ).toEqual({
          A1: { source: 'brief.md', text: 'The selected workflow resumes.' },
        });
        expect(await fs.readFile(path.join(changeDir, 'children.yaml'), 'utf8')).not.toContain(
          'acceptance_index',
        );
      }
      expect(wait).toMatchObject({
        stepId: 'supervisor.shape.confirm',
        choices: ['multi-session', 'single-session', 'rejected'],
      });
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'supervisor-choice',
        choice: 'multi-session',
      });
      run = await succeedLatestAction(
        runtime,
        run,
        await collectProposal(paths, run.state as NativePortableState),
        root,
        'supervisor-shape-revalidated',
      );
      expect(run.state).toMatchObject({
        phase: 'build',
        coordination_mode: 'multi-session',
        children_contract_hash: expect.any(String),
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.prepare',
        type: 'call_tool',
      });
    },
  );

  // 完整 Supervisor 场景包含多个真实 worktree；Windows 独立执行已测得超过两分钟。
  it('repairs failed Supervisor Children and serializes integration after a definition upgrade', async () => {
    const upgradeDefinition = true;
    const { root, paths, changeDir } = await fixture();
    await fs.writeFile(
      path.join(changeDir, 'children.yaml'),
      `schema: comet.native.children.v2
children:
  - name: api
    summary: Build the API
    depends_on: []
  - name: ui
    summary: Build the UI
    depends_on: []
`,
    );
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Comet Test'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'comet-test@example.com'], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync(
      'git',
      ['-c', 'user.name=Comet Test', '-c', 'user.email=comet-test@example.com', 'add', '-A'],
      {
        cwd: root,
        stdio: 'ignore',
      },
    );
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.com',
        'commit',
        '-m',
        'baseline',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const initialState = createNativePortableState({
      name: 'sdk-shape',
      language: 'en',
      workspace: {
        isolation: 'current',
        change_branch: branch,
        target_branch: branch,
        finish: null,
      },
    });
    let application = upgradeDefinition ? preChildArchiveApplication() : nativeApplication();
    const createSupervisorRuntime = () =>
      createRuntime({
        store: createNativeSdkStateStore(root),
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        validators: application.validators,
        stateValidators: application.stateValidators,
        commandValidators: application.commandValidators,
        executors: application.executors,
      });
    let runtime = createSupervisorRuntime();
    let run = await runtime.start({
      runId: 'sdk-shape',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { name: 'sdk-shape', artifactRootRef: 'docs' },
      initialState,
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, initialState),
      root,
      'shape-plan',
    );
    const wait = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'use-multi-session',
      choice: 'multi-session',
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-current',
    );
    const prepare = run.actions.at(-1)!;
    expect(prepare.stepId).toBe('supervisor.prepare');
    run = await runtime.execute({
      runId: run.runId,
      actionId: prepare.id,
      executorId: 'native-supervisor-prepare',
      context: { requestId: 'prepare-integration', projectRoot: root },
    });
    const preparations = run.actions.filter(
      (action) => action.stepId === 'supervisor.child.prepare',
    );
    expect(
      preparations.map(
        (action) => (action.input as { activation: { child: string } }).activation.child,
      ),
    ).toEqual(['api', 'ui']);
    for (const action of preparations) {
      run = await runtime.execute({
        runId: run.runId,
        actionId: action.id,
        executorId: 'native-supervisor-child-prepare',
        context: { requestId: `prepare-${action.id}`, projectRoot: root },
      });
    }
    const builders = run.actions.filter((action) => action.stepId === 'supervisor.child.builder');
    expect(builders).toHaveLength(2);
    expect(
      builders.map(
        (action) => (action.input as { activation: { child: string } }).activation.child,
      ),
    ).toEqual(['api', 'ui']);
    expect(
      builders.map(
        (action) => (action.input as { activation: { worktree: string } }).activation.worktree,
      ),
    ).toEqual([
      path.join(root, '.worktrees', 'sdk-shape-api'),
      path.join(root, '.worktrees', 'sdk-shape-ui'),
    ]);
    await expect(fs.access(nativeSupervisorStateFile(paths, 'sdk-shape'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    let lateUiCandidateCommit: string | null = null;
    async function reportChildAction(
      action: (typeof run.actions)[number],
      output: unknown,
      receipt: string,
      sessionId: string,
    ) {
      const projection = await projectNativeSdkContinuation({
        run,
        state: run.state as unknown as NativePortableState,
        projectRoot: root,
      });
      const handoff = projection.pendingActions?.find(({ id }) => id === action.id);
      expect(handoff?.contextRequest?.phase).toBe(
        action.ref?.includes('verifier') ? 'verify' : 'build',
      );
      expect(handoff?.contextRequest?.commandArgs).toContain(
        (action.input as { activation: { worktree: string } }).activation.worktree,
      );
      expect(handoff?.contextRequest?.task).toContain(
        (action.input as { activation: { child: string } }).activation.child,
      );
      const context = { requestId: receipt, projectRoot: root };
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'native-host',
        sessionId,
        claimToken: receipt,
        context,
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: claimed.actions.find((candidate) => candidate.id === action.id)!.claim!.token,
          outcomeId: receipt,
          status: 'succeeded',
          output,
        },
        context,
      });
    }
    for (const child of ['api', 'ui']) {
      const childWorktree = path.join(root, '.worktrees', `sdk-shape-${child}`);
      await fs.writeFile(path.join(childWorktree, `${child}.txt`), `${child} implemented\n`);
      await fs.writeFile(path.join(childWorktree, 'shared.txt'), `${child} implementation\n`);
      execFileSync('git', ['add', `${child}.txt`, 'shared.txt'], {
        cwd: childWorktree,
        stdio: 'ignore',
      });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.com',
          'commit',
          '-m',
          `${child} candidate`,
        ],
        { cwd: childWorktree, stdio: 'ignore' },
      );
      let candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: childWorktree,
        encoding: 'utf8',
      }).trim();
      const childAction = (stepId: string) =>
        run.actions.find(
          (action) =>
            action.stepId === stepId &&
            action.status === 'pending' &&
            (action.input as { activation?: { child?: string } }).activation?.child === child,
        )!;
      await reportChildAction(
        childAction('supervisor.child.builder'),
        {
          candidateCommit,
          verificationChecks: [
            {
              id: `${child}-check`,
              name: `${child} check`,
              executable: process.execPath,
              argv: ['-e', child === 'api' ? 'process.exit(1)' : 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        `${child}-builder-result`,
        `${child}-builder-session`,
      );
      const check = childAction('supervisor.child.checks');
      run = await runtime.execute({
        runId: run.runId,
        actionId: check.id,
        executorId: 'comet-native-checks',
        context: { requestId: `${child}-checks`, projectRoot: root },
      });
      if (child === 'api') {
        expect(run.actions.find((action) => action.id === check.id)?.status).toBe('failed');
        expect(childAction('supervisor.child.builder')).toMatchObject({
          input: {
            activation: {
              child: 'api',
              worktree: childWorktree,
              failedCheckActionId: check.id,
            },
          },
        });
        await fs.appendFile(path.join(childWorktree, 'api.txt'), 'API check repaired\n');
        execFileSync('git', ['add', 'api.txt'], { cwd: childWorktree, stdio: 'ignore' });
        execFileSync(
          'git',
          [
            '-c',
            'user.name=Comet Test',
            '-c',
            'user.email=comet-test@example.com',
            'commit',
            '-m',
            'repair api',
          ],
          { cwd: childWorktree, stdio: 'ignore' },
        );
        candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: childWorktree,
          encoding: 'utf8',
        }).trim();
        await reportChildAction(
          childAction('supervisor.child.builder'),
          {
            candidateCommit,
            verificationChecks: [
              {
                id: 'api-repair-check',
                name: 'API repair check',
                executable: process.execPath,
                argv: ['-e', 'process.exit(0)'],
                cwdRef: '.',
                timeoutMs: 10000,
                repeatable: true,
              },
            ],
          },
          'api-repair-builder-result',
          'api-repair-builder-session',
        );
        run = await runtime.execute({
          runId: run.runId,
          actionId: childAction('supervisor.child.checks').id,
          executorId: 'comet-native-checks',
          context: { requestId: 'api-repair-checks', projectRoot: root },
        });
      }
      if (child === 'ui') {
        const failedVerifier = childAction('supervisor.child.verifier');
        await reportChildAction(
          failedVerifier,
          {
            candidateCommit,
            verdict: 'fail',
            evidence: {
              summary: 'The UI still misses the acceptance example.',
              checks: ['ui-check'],
              acceptance: [
                { id: 'child:ui', result: 'failed', reason: 'The UI behavior is incomplete.' },
              ],
            },
          },
          'ui-verifier-failed',
          'ui-verifier-failed-session',
        );
        expect(childAction('supervisor.child.builder')).toMatchObject({
          input: {
            activation: {
              child: 'ui',
              worktree: childWorktree,
              failedVerifierActionId: failedVerifier.id,
            },
          },
        });
        await fs.appendFile(path.join(childWorktree, 'ui.txt'), 'UI acceptance repaired\n');
        execFileSync('git', ['add', 'ui.txt'], { cwd: childWorktree, stdio: 'ignore' });
        execFileSync(
          'git',
          [
            '-c',
            'user.name=Comet Test',
            '-c',
            'user.email=comet-test@example.com',
            'commit',
            '-m',
            'repair ui',
          ],
          { cwd: childWorktree, stdio: 'ignore' },
        );
        candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: childWorktree,
          encoding: 'utf8',
        }).trim();
        await reportChildAction(
          childAction('supervisor.child.builder'),
          {
            candidateCommit,
            verificationChecks: [
              {
                id: 'ui-repair-check',
                name: 'UI repair check',
                executable: process.execPath,
                argv: ['-e', 'process.exit(0)'],
                cwdRef: '.',
                timeoutMs: 10000,
                repeatable: true,
              },
            ],
          },
          'ui-repair-builder-result',
          'ui-repair-builder-session',
        );
        run = await runtime.execute({
          runId: run.runId,
          actionId: childAction('supervisor.child.checks').id,
          executorId: 'comet-native-checks',
          context: { requestId: 'ui-repair-checks', projectRoot: root },
        });
      }
      if (child === 'ui') {
        lateUiCandidateCommit = candidateCommit;
        continue;
      }
      await reportChildAction(
        childAction('supervisor.child.verifier'),
        {
          candidateCommit,
          verdict: 'pass',
          integrationChecks: [
            {
              id: `${child}-integration`,
              name: `${child} integration check`,
              executable: process.execPath,
              argv: ['-e', child === 'api' ? 'process.exit(1)' : 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
          evidence: {
            summary: `Independent ${child} review passed.`,
            checks: [child === 'ui' ? 'ui-repair-check' : 'api-repair-check'],
            acceptance: [{ id: `child:${child}`, result: 'passed', reason: `Reviewed ${child}.` }],
          },
        },
        `${child}-verifier-result`,
        `${child}-verifier-session`,
      );
    }
    expect(
      run.actions.filter(
        (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
      ),
    ).toHaveLength(1);
    const firstIntegration = run.actions.find(
      (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
    )!;
    run = await runtime.execute({
      runId: run.runId,
      actionId: firstIntegration.id,
      executorId: 'native-supervisor-integrate',
      context: { requestId: 'first-integration', projectRoot: root },
    });
    expect(
      run.actions.filter(
        (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
      ),
    ).toHaveLength(0);
    const firstChecks = run.actions.find(
      (action) =>
        action.stepId === 'supervisor.child.integration-checks' && action.status === 'pending',
    )!;
    run = await runtime.execute({
      runId: run.runId,
      actionId: firstChecks.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'first-integration-checks', projectRoot: root },
    });
    expect(run.actions.find((action) => action.id === firstChecks.id)?.status).toBe('failed');
    let pendingRepair = run.actions.at(-1)!;
    expect(pendingRepair).toMatchObject({
      stepId: 'supervisor.child.integration-repair',
      status: 'pending',
    });
    expect(lateUiCandidateCommit).toMatch(/^[a-f0-9]{40}$/u);
    const lateUiVerifier = run.actions.find(
      (action) =>
        action.stepId === 'supervisor.child.verifier' &&
        action.status === 'pending' &&
        (action.input as { activation?: { child?: string } }).activation?.child === 'ui',
    )!;
    await reportChildAction(
      lateUiVerifier,
      {
        candidateCommit: lateUiCandidateCommit,
        verdict: 'pass',
        integrationChecks: [
          {
            id: 'ui-integration',
            name: 'UI integration check',
            executable: process.execPath,
            argv: ['-e', 'process.exit(0)'],
            cwdRef: '.',
            timeoutMs: 10000,
            repeatable: true,
          },
        ],
        evidence: {
          summary: 'Independent UI review passed.',
          checks: ['ui-repair-check'],
          acceptance: [{ id: 'child:ui', result: 'passed', reason: 'Reviewed UI.' }],
        },
      },
      'late-ui-verifier-result',
      'late-ui-verifier-session',
    );
    expect(
      run.actions.filter(
        (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
      ),
    ).toHaveLength(0);
    const originalRepair = pendingRepair;
    const failureContext = { requestId: 'integration-repair-failed', projectRoot: root };
    run = await runtime.claim({
      runId: run.runId,
      actionId: originalRepair.id,
      attempt: originalRepair.attempt,
      inputHash: originalRepair.inputHash,
      executorId: 'native-host',
      sessionId: 'failed-repair-session',
      claimToken: 'failed-repair-token',
      context: failureContext,
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: originalRepair.id,
        attempt: originalRepair.attempt,
        inputHash: originalRepair.inputHash,
        claimToken: 'failed-repair-token',
        outcomeId: 'integration-repair-failed',
        status: 'failed',
        output: { summary: 'Stopped after partial integration repair.' },
      },
      context: failureContext,
    });
    const failedActions = structuredClone(run.actions);
    await registerSdkChangeOwner(root, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: run.runId,
      format: 'sdk',
      application: 'native',
      runId: run.runId,
    });
    expect(await nativeDoctorCommand([run.runId, '--repair'], root)).toMatchObject({
      exitCode: 0,
      data: { healthy: true, repaired: true },
    });
    application = nativeApplication();
    runtime = createSupervisorRuntime();
    run = await runtime.next({ runId: run.runId });
    expectOriginalActionFacts(run, failedActions);
    const resume = run.waits.find(
      (entry) =>
        entry.stepId === 'supervisor.child.integration-resume' && entry.status === 'pending',
    )!;
    expect(resume).toBeDefined();
    expect(run.status).toBe('waiting');
    const beforeDecision = await projectNativeSdkContinuation({
      run,
      state: run.state as NativePortableState,
      projectRoot: root,
    });
    expect(beforeDecision.continuation).toMatchObject({ mode: 'ask', requiresUserDecision: true });
    const continued = await advanceNativeSdkChange(root, run.runId, {
      expectedAction: 'continue-builder',
      expectedStateVersion: (run.state as NativePortableState).state_version,
      proposalHash: resume.proposalHash,
      summary: 'The user chose to continue the integration repair.',
    });
    expect(continued.exitCode).toBe(0);
    run = await runtime.inspect(run.runId);
    pendingRepair = run.actions.find(
      (entry) =>
        entry.stepId === 'supervisor.child.integration-repair' && entry.status === 'pending',
    )!;
    expect(pendingRepair.id).not.toBe(originalRepair.id);
    expect(pendingRepair.input).toMatchObject({
      activation: { failedRepairActionId: originalRepair.id },
    });
    expect(run.actions.find((entry) => entry.id === originalRepair.id)?.outcome).toEqual(
      failedActions.find((entry) => entry.id === originalRepair.id)?.outcome,
    );
    const integrationWorktree = path.join(root, '.worktrees', 'sdk-shape-integration');
    await fs.writeFile(
      path.join(integrationWorktree, 'integration-repair.txt'),
      'partial repair\n',
    );
    const successor = pendingRepair;
    await runtime.claim({
      runId: run.runId,
      actionId: successor.id,
      attempt: successor.attempt,
      inputHash: successor.inputHash,
      executorId: 'native-host',
      sessionId: 'second-repair-session',
      claimToken: 'second-repair-token',
      context: failureContext,
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: successor.id,
        attempt: successor.attempt,
        inputHash: successor.inputHash,
        claimToken: 'second-repair-token',
        outcomeId: 'second-repair-failed',
        status: 'failed',
        output: { summary: 'Stopped again with uncommitted repair work.' },
      },
      context: failureContext,
    });
    expect(run.status).toBe('waiting');
    const secondResume = run.waits.find(
      (entry) =>
        entry.stepId === 'supervisor.child.integration-resume' && entry.status === 'pending',
    )!;
    expect(secondResume.proposalHash).not.toBe(resume.proposalHash);
    expect(
      (
        await advanceNativeSdkChange(root, run.runId, {
          expectedAction: 'continue-builder',
          expectedStateVersion: (run.state as NativePortableState).state_version,
          proposalHash: resume.proposalHash,
          summary: 'Stale approval must not continue a different repair.',
        })
      ).exitCode,
    ).not.toBe(0);
    expect(
      (
        await advanceNativeSdkChange(root, run.runId, {
          expectedAction: 'continue-builder',
          expectedStateVersion: (run.state as NativePortableState).state_version,
          proposalHash: secondResume.proposalHash,
          summary: 'The user chose to continue the preserved partial repair.',
        })
      ).exitCode,
    ).toBe(0);
    expect(
      await fs.readFile(path.join(integrationWorktree, 'integration-repair.txt'), 'utf8'),
    ).toBe('partial repair\n');
    run = await runtime.inspect(run.runId);
    pendingRepair = run.actions.find(
      (entry) =>
        entry.stepId === 'supervisor.child.integration-repair' && entry.status === 'pending',
    )!;
    expect(pendingRepair.input).toMatchObject({
      activation: { failedRepairActionId: successor.id },
    });
    await fs.writeFile(path.join(integrationWorktree, 'integration-repair.txt'), 'repaired\n');
    execFileSync('git', ['add', 'integration-repair.txt'], {
      cwd: integrationWorktree,
      stdio: 'ignore',
    });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.com',
        'commit',
        '-m',
        'repair integration',
      ],
      { cwd: integrationWorktree, stdio: 'ignore' },
    );
    const repairCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: integrationWorktree,
      encoding: 'utf8',
    }).trim();
    const repair = run.actions.find((action) => action.id === pendingRepair.id)!;
    await reportChildAction(
      repair,
      {
        summary: 'Repaired the integration check.',
        integrationCommit: repairCommit,
        integrationChecks: [
          {
            id: 'api-integration-repair',
            name: 'API integration repair check',
            executable: process.execPath,
            argv: ['-e', 'process.exit(0)'],
            cwdRef: '.',
            timeoutMs: 10000,
            repeatable: true,
          },
        ],
      },
      'integration-repair-result',
      'integration-repair-session',
    );
    const repairedCheck = run.actions.at(-1)!;
    expect(repairedCheck).toMatchObject({ stepId: 'supervisor.child.integration-checks' });
    run = await runtime.execute({
      runId: run.runId,
      actionId: repairedCheck.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'integration-repair-checks', projectRoot: root },
    });
    expect(run.actions.find((action) => action.id === repairedCheck.id)?.status).toBe('succeeded');
    const apiArchive = run.actions.find(
      (action) => action.stepId === 'supervisor.child.archive' && action.status === 'pending',
    )!;
    run = await runtime.execute({
      runId: run.runId,
      actionId: apiArchive.id,
      executorId: 'native-supervisor-child-archive',
      context: { requestId: 'api-child-archive', projectRoot: root },
    });
    expect(run.actions.find((action) => action.id === apiArchive.id)?.status).toBe('succeeded');
    expect(
      run.actions.filter(
        (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
      ),
    ).toHaveLength(1);
    const uiIntegration = run.actions.find(
      (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
    )!;
    await fs.writeFile(path.join(root, 'target-update.txt'), 'preserve target work\n');
    execFileSync('git', ['add', 'target-update.txt'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'advance target during Supervisor Build'], {
      cwd: root,
      stdio: 'ignore',
    });
    const updatedTarget = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const beforeIntegrationDrift = structuredClone(run);
    const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: integrationWorktree,
      encoding: 'utf8',
    }).trim();
    const integrationBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: integrationWorktree,
      encoding: 'utf8',
    }).trim();
    const driftCommit = execFileSync(
      'git',
      ['commit-tree', `${baseCommit}^{tree}`, '-p', baseCommit, '-m', 'unexpected branch drift'],
      { cwd: integrationWorktree, encoding: 'utf8' },
    ).trim();
    execFileSync(
      'git',
      ['update-ref', `refs/heads/${integrationBranch}`, driftCommit, baseCommit],
      {
        cwd: integrationWorktree,
        stdio: 'ignore',
      },
    );
    await expect(
      runtime.execute({
        runId: run.runId,
        actionId: uiIntegration.id,
        executorId: 'native-supervisor-integrate',
        context: { requestId: 'ui-integration-drift', projectRoot: root },
      }),
    ).rejects.toThrow('Native SDK Supervisor integration branch changed after the prior check');
    run = await runtime.inspect(run.runId);
    expect(run.actions.find((action) => action.id === uiIntegration.id)).toMatchObject({
      status: 'pending',
      attempt: uiIntegration.attempt,
    });
    expect(await runtime.inspect(run.runId)).toEqual(beforeIntegrationDrift);
    expect(() =>
      execFileSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
        cwd: integrationWorktree,
        stdio: 'ignore',
      }),
    ).toThrow();
    execFileSync(
      'git',
      ['update-ref', `refs/heads/${integrationBranch}`, baseCommit, driftCommit],
      {
        cwd: integrationWorktree,
        stdio: 'ignore',
      },
    );
    await expect(
      runtime.execute({
        runId: run.runId,
        actionId: uiIntegration.id,
        executorId: 'native-supervisor-integrate',
        context: { requestId: 'ui-integration-conflict', projectRoot: root },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
    runtime = createSupervisorRuntime();
    run = await runtime.inspect(run.runId);
    const conflicted = run.actions.find((action) => action.id === uiIntegration.id)!;
    expect(conflicted.status).toBe('unknown');
    const targetMergeCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: integrationWorktree,
      encoding: 'utf8',
    }).trim();
    expect(
      (await fs.readFile(path.join(integrationWorktree, 'target-update.txt'), 'utf8')).trim(),
    ).toBe('preserve target work');
    expect(
      execFileSync('git', ['rev-parse', 'MERGE_HEAD'], {
        cwd: integrationWorktree,
        encoding: 'utf8',
      }).trim(),
    ).toBe(lateUiCandidateCommit);
    await fs.writeFile(path.join(integrationWorktree, 'shared.txt'), 'API and UI integrated\n');
    execFileSync('git', ['add', 'shared.txt'], { cwd: integrationWorktree, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.com',
        'commit',
        '-m',
        'resolve UI integration',
      ],
      { cwd: integrationWorktree, stdio: 'ignore' },
    );
    const mergedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: integrationWorktree,
      encoding: 'utf8',
    }).trim();
    const forgedMerge = execFileSync(
      'git',
      [
        'commit-tree',
        `${mergedCommit}^{tree}`,
        '-p',
        driftCommit,
        '-p',
        lateUiCandidateCommit!,
        '-m',
        'merge on unverified base',
      ],
      { cwd: integrationWorktree, encoding: 'utf8' },
    ).trim();
    execFileSync(
      'git',
      ['update-ref', `refs/heads/${integrationBranch}`, forgedMerge, mergedCommit],
      {
        cwd: integrationWorktree,
        stdio: 'ignore',
      },
    );
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: conflicted.id,
          attempt: conflicted.attempt,
          inputHash: conflicted.inputHash,
          claimToken: conflicted.claim!.token,
          outcomeId: 'ui-integration-wrong-base',
          status: 'succeeded',
          output: {
            child: 'ui',
            candidateCommit: lateUiCandidateCommit,
            baseCommit: driftCommit,
            integrationCommit: forgedMerge,
            integrationBranch,
            integrationWorktree,
          },
        },
        context: { requestId: 'ui-integration-wrong-base', projectRoot: root },
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    execFileSync(
      'git',
      ['update-ref', `refs/heads/${integrationBranch}`, mergedCommit, forgedMerge],
      {
        cwd: integrationWorktree,
        stdio: 'ignore',
      },
    );
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: conflicted.id,
        attempt: conflicted.attempt,
        inputHash: conflicted.inputHash,
        claimToken: conflicted.claim!.token,
        outcomeId: 'ui-integration-resolved',
        status: 'succeeded',
        output: {
          child: 'ui',
          candidateCommit: lateUiCandidateCommit,
          baseCommit,
          targetCommit: updatedTarget,
          targetMergeCommit,
          integrationCommit: mergedCommit,
          integrationBranch,
          integrationWorktree,
        },
      },
      context: { requestId: 'ui-integration-resolved', projectRoot: root },
    });
    expect(run.actions.find((action) => action.id === uiIntegration.id)?.status).toBe('succeeded');
    const finalChecks = run.actions.at(-1)!;
    expect(finalChecks.stepId).toBe('supervisor.child.integration-checks');
    run = await runtime.execute({
      runId: run.runId,
      actionId: finalChecks.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'ui-integration-checks', projectRoot: root },
    });
    const uiArchive = run.actions.find(
      (action) => action.stepId === 'supervisor.child.archive' && action.status === 'pending',
    )!;
    run = await runtime.execute({
      runId: run.runId,
      actionId: uiArchive.id,
      executorId: 'native-supervisor-child-archive',
      context: { requestId: 'ui-child-archive', projectRoot: root },
    });
    expect(run.actions.find((action) => action.id === uiArchive.id)?.status).toBe('succeeded');
    expect(run.actions.at(-1)?.stepId).toBe('supervisor.parent.builder');
  }, 240_000);

  it.each([
    'normal',
    'partial-recovery',
    'branch-lock-recovery',
    'delivery-recovery',
    'delivery-ref-lock',
    'target-drift',
    'child-builder-failure',
    'parent-builder-failure',
  ] as const)(
    'handles parent repair, delivery, and cleanup after Supervisor DAG restart (%s)',
    async (scenario) => {
      const { root, paths, changeDir } = await fixture();
      await fs.writeFile(
        path.join(changeDir, 'children.yaml'),
        `schema: comet.native.children.v2
children:
  - name: api
    summary: Build the API
    depends_on: []
  - name: ui
    summary: Build the UI
    depends_on: [api]
`,
      );
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Comet Test'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'comet-test@example.com'], {
        cwd: root,
        stdio: 'ignore',
      });
      execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.com',
          'commit',
          '-m',
          'baseline',
        ],
        { cwd: root, stdio: 'ignore' },
      );
      const branch = execFileSync('git', ['branch', '--show-current'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      const initialState = createNativePortableState({
        name: 'sdk-shape',
        language: 'en',
        workspace: {
          isolation: 'current',
          change_branch: branch,
          target_branch: branch,
          finish: null,
        },
      });
      const application = nativeApplication();
      const createSupervisorRuntime = () =>
        createRuntime({
          store: createFileRuntimeStore<WorkflowRun>({
            rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs', 'native'),
          }),
          workflows: [application.workflow],
          transitionHandlers: [application.transitionHandler],
          validators: application.validators,
          stateValidators: application.stateValidators,
          commandValidators: application.commandValidators,
          executors: application.executors,
        });
      let runtime = createSupervisorRuntime();
      let run = await runtime.start({
        runId: 'sdk-shape',
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { name: 'sdk-shape', artifactRootRef: 'docs' },
        initialState,
      });
      run = await succeedLatestAction(
        runtime,
        run,
        await collectProposal(paths, initialState),
        root,
        'candidate-shape-plan',
      );
      const wait = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'candidate-multi-session',
        choice: 'multi-session',
      });
      run = await succeedLatestAction(
        runtime,
        run,
        await collectProposal(paths, run.state as NativePortableState),
        root,
        'candidate-shape-current',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'native-supervisor-prepare',
        context: { requestId: 'candidate-integration', projectRoot: root },
      });
      const childPrepare = run.actions.find(
        (action) => action.stepId === 'supervisor.child.prepare',
      )!;
      run = await runtime.execute({
        runId: run.runId,
        actionId: childPrepare.id,
        executorId: 'native-supervisor-child-prepare',
        context: { requestId: 'candidate-child', projectRoot: root },
      });
      let builder = run.actions.find((action) => action.stepId === 'supervisor.child.builder')!;
      const childWorktree = path.join(root, '.worktrees', 'sdk-shape-api');
      if (scenario === 'child-builder-failure') {
        await fs.writeFile(path.join(childWorktree, 'api.txt'), 'partial API\n');
        const failureContext = { requestId: 'candidate-child-builder-failed', projectRoot: root };
        run = await runtime.claim({
          runId: run.runId,
          actionId: builder.id,
          attempt: builder.attempt,
          inputHash: builder.inputHash,
          executorId: 'native-host',
          sessionId: 'candidate-child-builder-failed',
          claimToken: 'candidate-child-builder-failed',
          context: failureContext,
        });
        run = await runtime.recordOutcome({
          runId: run.runId,
          outcome: {
            actionId: builder.id,
            attempt: builder.attempt,
            inputHash: builder.inputHash,
            claimToken: 'candidate-child-builder-failed',
            outcomeId: 'candidate-child-builder-failed',
            status: 'failed',
            output: { summary: 'The Child Builder stopped after writing api.txt.' },
          },
          context: failureContext,
        });
        const resumeWait = run.waits.at(-1)!;
        expect(resumeWait).toMatchObject({ stepId: 'supervisor.child.resume', status: 'pending' });
        expect(await fs.readFile(path.join(childWorktree, 'api.txt'), 'utf8')).toBe(
          'partial API\n',
        );
        run = await runtime.resolveWait({
          runId: run.runId,
          waitId: resumeWait.id,
          proposalHash: resumeWait.proposalHash,
          decisionId: 'continue-candidate-child-builder',
          choice: 'continue',
        });
        expect(run.actions.at(-1)).toMatchObject({
          stepId: 'supervisor.child.builder',
          status: 'pending',
          input: {
            activation: {
              child: 'api',
              worktree: childWorktree,
              failedBuilderActionId: builder.id,
            },
          },
        });
        builder = run.actions.at(-1)!;
      }
      await fs.writeFile(path.join(childWorktree, 'api.txt'), 'API implemented\n');
      await fs.mkdir(path.join(childWorktree, 'api-subdir'));
      await fs.writeFile(path.join(childWorktree, 'api-subdir', 'marker.txt'), 'ready\n');
      execFileSync('git', ['add', 'api.txt', 'api-subdir/marker.txt'], {
        cwd: childWorktree,
        stdio: 'ignore',
      });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.com',
          'commit',
          '-m',
          'api candidate',
        ],
        { cwd: childWorktree, stdio: 'ignore' },
      );
      const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: childWorktree,
        encoding: 'utf8',
      }).trim();
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        executorId: 'native-host',
        sessionId: 'builder-api-session',
        claimToken: 'builder-api-claim',
        context: { requestId: 'builder-api-claim', projectRoot: root },
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: builder.id,
          attempt: builder.attempt,
          inputHash: builder.inputHash,
          claimToken: claimed.actions.find((action) => action.id === builder.id)!.claim!.token,
          outcomeId: 'builder-api-result',
          status: 'succeeded',
          output: {
            candidateCommit,
            verificationChecks: [
              {
                id: 'api-check',
                name: 'API candidate check',
                executable: process.execPath,
                argv: ['-e', 'process.exit(0)'],
                cwdRef: '.',
                timeoutMs: 10000,
                repeatable: true,
              },
            ],
          },
        },
        context: { requestId: 'builder-api-result', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.checks',
        type: 'call_tool',
        input: { activation: { child: 'api', candidateCommit, worktree: childWorktree } },
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'api-check-execution', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.verifier',
        type: 'handoff',
        input: { activation: { child: 'api', candidateCommit, worktree: childWorktree } },
      });
      const verifier = run.actions.at(-1)!;
      const verifierClaim = await runtime.claim({
        runId: run.runId,
        actionId: verifier.id,
        attempt: verifier.attempt,
        inputHash: verifier.inputHash,
        executorId: 'native-host',
        sessionId: 'verifier-api-session',
        claimToken: 'verifier-api-claim',
        context: { requestId: 'verifier-api-claim', projectRoot: root },
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: verifier.id,
          attempt: verifier.attempt,
          inputHash: verifier.inputHash,
          claimToken: verifierClaim.actions.find((action) => action.id === verifier.id)!.claim!
            .token,
          outcomeId: 'verifier-api-result',
          status: 'succeeded',
          output: {
            candidateCommit,
            verdict: 'pass',
            integrationChecks: [
              {
                id: 'api-integration',
                name: 'API integration check',
                executable: process.execPath,
                argv: [
                  '-e',
                  "const fs=require('node:fs');if(fs.readFileSync('marker.txt','utf8').trim()!=='repaired')process.exit(1)",
                ],
                cwdRef: 'api-subdir',
                timeoutMs: 10000,
                repeatable: true,
              },
            ],
            evidence: {
              summary: 'Independent API review passed.',
              checks: ['api-check'],
              acceptance: [
                { id: 'child:api', result: 'passed', reason: 'Reviewed the API behavior.' },
              ],
            },
          },
        },
        context: { requestId: 'verifier-api-result', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.integrate',
        type: 'call_tool',
        input: { activation: { child: 'api', candidateCommit, worktree: childWorktree } },
      });
      const integration = run.actions.at(-1)!;
      run = await runtime.execute({
        runId: run.runId,
        actionId: integration.id,
        executorId: 'native-supervisor-integrate',
        context: { requestId: 'integrate-api', projectRoot: root },
      });
      expect(run.actions.find((action) => action.id === integration.id)).toMatchObject({
        status: 'succeeded',
        outcome: {
          output: { child: 'api', candidateCommit, integrationCommit: expect.any(String) },
        },
      });
      const integrationWorktree = path.join(root, '.worktrees', 'sdk-shape-integration');
      expect(() =>
        execFileSync('git', ['merge-base', '--is-ancestor', candidateCommit, 'HEAD'], {
          cwd: integrationWorktree,
          stdio: 'ignore',
        }),
      ).not.toThrow();
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.integration-checks',
        type: 'call_tool',
      });
      const integrationChecks = run.actions.at(-1)!;
      run = await runtime.execute({
        runId: run.runId,
        actionId: integrationChecks.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'api-integration-checks', projectRoot: root },
      });
      expect(run.actions.find((action) => action.id === integrationChecks.id)).toMatchObject({
        status: 'failed',
        outcome: { output: { checks: [{ id: 'api-integration', status: 'failed' }] } },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.integration-repair',
        type: 'handoff',
        input: { activation: { child: 'api', failedCheckActionId: integrationChecks.id } },
      });
      await fs.writeFile(path.join(integrationWorktree, 'api-subdir', 'marker.txt'), 'repaired\n');
      execFileSync('git', ['add', 'api-subdir/marker.txt'], {
        cwd: integrationWorktree,
        stdio: 'ignore',
      });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.com',
          'commit',
          '-m',
          'repair api integration',
        ],
        { cwd: integrationWorktree, stdio: 'ignore' },
      );
      const integrationRepairCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: integrationWorktree,
        encoding: 'utf8',
      }).trim();
      run = await succeedLatestAction(
        runtime,
        run,
        {
          summary: 'Fixed API integration behavior.',
          integrationCommit: integrationRepairCommit,
          integrationChecks: [
            {
              id: 'api-integration',
              name: 'API integration check',
              executable: process.execPath,
              argv: [
                '-e',
                "const fs=require('node:fs');if(fs.readFileSync('marker.txt','utf8').trim()!=='repaired')process.exit(1)",
              ],
              cwdRef: 'api-subdir',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        root,
        'api-integration-repair-result',
        'api-integration-repair-session',
      );
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.integration-checks',
        input: {
          activation: {
            child: 'api',
            integrationCommit: integrationRepairCommit,
            repairActionId: expect.any(String),
          },
        },
      });
      const repairedIntegrationChecks = run.actions.at(-1)!;
      run = await runtime.execute({
        runId: run.runId,
        actionId: repairedIntegrationChecks.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'api-integration-repair-checks', projectRoot: root },
      });
      expect(
        run.actions.find((action) => action.id === repairedIntegrationChecks.id),
      ).toMatchObject({
        status: 'succeeded',
        outcome: { output: { checks: [{ id: 'api-integration', status: 'passed' }] } },
      });
      const apiArchive = run.actions.find(
        (action) => action.stepId === 'supervisor.child.archive' && action.status === 'pending',
      )!;
      run = await runtime.execute({
        runId: run.runId,
        actionId: apiArchive.id,
        executorId: 'native-supervisor-child-archive',
        context: { requestId: 'api-child-archive', projectRoot: root },
      });
      expect(run.actions.find((action) => action.id === apiArchive.id)?.status).toBe('succeeded');
      const integratedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: integrationWorktree,
        encoding: 'utf8',
      }).trim();
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.prepare',
        type: 'call_tool',
        input: { activation: { child: 'ui', targetCommit: integratedHead } },
      });
      runtime = createSupervisorRuntime();
      run = await runtime.inspect(run.runId);
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.prepare',
        status: 'pending',
        input: { activation: { child: 'ui', targetCommit: integratedHead } },
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'native-supervisor-child-prepare',
        context: { requestId: 'prepare-ui', projectRoot: root },
      });
      const uiWorktree = path.join(root, '.worktrees', 'sdk-shape-ui');
      await fs.writeFile(path.join(uiWorktree, 'ui.txt'), 'UI implemented\n');
      execFileSync('git', ['add', 'ui.txt'], { cwd: uiWorktree, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'ui candidate'], { cwd: uiWorktree, stdio: 'ignore' });
      const uiCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: uiWorktree,
        encoding: 'utf8',
      }).trim();
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateCommit: uiCommit,
          verificationChecks: [
            {
              id: 'ui-check',
              name: 'UI candidate check',
              executable: process.execPath,
              argv: ['-e', 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        root,
        'ui-builder-result',
        'builder-ui-session',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'ui-checks', projectRoot: root },
      });
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateCommit: uiCommit,
          verdict: 'pass',
          integrationChecks: [
            {
              id: 'ui-integration',
              name: 'UI integration check',
              executable: process.execPath,
              argv: ['-e', 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
          evidence: {
            summary: 'Independent UI review passed.',
            checks: ['ui-check'],
            acceptance: [{ id: 'child:ui', result: 'passed', reason: 'Reviewed UI behavior.' }],
          },
        },
        root,
        'ui-verifier-result',
        'verifier-ui-session',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'native-supervisor-integrate',
        context: { requestId: 'integrate-ui', projectRoot: root },
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'ui-integration-checks', projectRoot: root },
      });
      const uiArchive = run.actions.find(
        (action) => action.stepId === 'supervisor.child.archive' && action.status === 'pending',
      )!;
      run = await runtime.execute({
        runId: run.runId,
        actionId: uiArchive.id,
        executorId: 'native-supervisor-child-archive',
        context: { requestId: 'ui-child-archive', projectRoot: root },
      });
      expect(run.actions.find((action) => action.id === uiArchive.id)?.status).toBe('succeeded');
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.parent.builder',
        type: 'handoff',
        input: { activation: { integrationCommit: expect.any(String) } },
      });
      if (scenario === 'parent-builder-failure') {
        const failedBuilder = run.actions.at(-1)!;
        const integrationWorktree = (
          failedBuilder.input as { activation: { integrationWorktree: string } }
        ).activation.integrationWorktree;
        const partialFile = path.join(integrationWorktree, 'parent-partial.txt');
        await fs.writeFile(partialFile, 'partial parent review\n');
        const failureContext = { requestId: 'parent-builder-failed', projectRoot: root };
        run = await runtime.claim({
          runId: run.runId,
          actionId: failedBuilder.id,
          attempt: failedBuilder.attempt,
          inputHash: failedBuilder.inputHash,
          executorId: 'native-host',
          sessionId: 'parent-builder-failed',
          claimToken: 'parent-builder-failed',
          context: failureContext,
        });
        run = await runtime.recordOutcome({
          runId: run.runId,
          outcome: {
            actionId: failedBuilder.id,
            attempt: failedBuilder.attempt,
            inputHash: failedBuilder.inputHash,
            claimToken: 'parent-builder-failed',
            outcomeId: 'parent-builder-failed',
            status: 'failed',
            output: { summary: 'Parent Builder stopped during review.' },
          },
          context: failureContext,
        });
        const resumeWait = run.waits.at(-1)!;
        expect(resumeWait).toMatchObject({ stepId: 'supervisor.parent.resume', status: 'pending' });
        expect(await fs.readFile(partialFile, 'utf8')).toBe('partial parent review\n');
        run = await runtime.resolveWait({
          runId: run.runId,
          waitId: resumeWait.id,
          proposalHash: resumeWait.proposalHash,
          decisionId: 'continue-parent-builder',
          choice: 'continue',
        });
        expect(run.actions.at(-1)).toMatchObject({
          stepId: 'supervisor.parent.builder',
          status: 'pending',
          input: {
            activation: {
              integrationWorktree,
              failedBuilderActionId: failedBuilder.id,
            },
          },
        });
        await fs.unlink(partialFile);
      }
      run = await succeedLatestAction(
        runtime,
        run,
        {
          summary: 'Integrated API and UI candidates.',
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: '2026-09-26T04:00:00.000Z',
          verificationChecks: [
            {
              id: 'parent-check',
              name: 'Parent integration check',
              executable: process.execPath,
              argv: [
                '-e',
                "const fs=require('node:fs');if(!fs.existsSync('api.txt')||!fs.existsSync('ui.txt'))process.exit(1)",
              ],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        root,
        'parent-builder-result',
        'parent-builder-session',
      );
      expect(run.state).toMatchObject({
        phase: 'verify',
        builder_handoff: { builder_execution_ref: 'parent-builder-session' },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.checks', type: 'call_tool' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'parent-checks', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', type: 'handoff' });
      const parentCandidateId = (run.state as NativePortableState).builder_handoff!.candidate_id;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId: parentCandidateId,
          verifierExecutionRef: 'parent-verifier-session',
          response: {
            kind: 'request-checks',
            iteration: 1,
            attempt: 1,
            checks: [
              {
                id: 'parent-extra',
                name: 'Verifier-requested parent check',
                executable: process.execPath,
                argv: [
                  '-e',
                  "const fs=require('node:fs');if(!fs.existsSync('api.txt')||!fs.existsSync('ui.txt'))process.exit(1)",
                ],
                cwdRef: '.',
                timeoutMs: 10000,
                repeatable: true,
              },
            ],
          },
        },
        root,
        'parent-verifier-request',
        'parent-verifier-session',
      );
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.requested-checks' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'parent-extra-check', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier' });
      const failedParentVerifier = run.actions.at(-1)!;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId: parentCandidateId,
          verifierExecutionRef: 'parent-verifier-session',
          response: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'fail',
              acceptance: [
                { id: 'A1', result: 'failed', reason: 'The parent integration needs a repair.' },
              ],
              risks: [],
              summary: 'Repair the parent integration before delivery.',
            },
          },
        },
        root,
        'parent-verifier-failed',
        'parent-verifier-session',
      );
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.parent.builder',
        type: 'handoff',
        input: { activation: { failedVerifierActionId: failedParentVerifier.id } },
      });
      await fs.writeFile(path.join(integrationWorktree, 'parent-repair.txt'), 'Parent repaired\n');
      execFileSync('git', ['add', 'parent-repair.txt'], {
        cwd: integrationWorktree,
        stdio: 'ignore',
      });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.com',
          'commit',
          '-m',
          'repair parent integration',
        ],
        { cwd: integrationWorktree, stdio: 'ignore' },
      );
      const repairedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: integrationWorktree,
        encoding: 'utf8',
      }).trim();
      run = await succeedLatestAction(
        runtime,
        run,
        {
          summary: 'Repaired the parent integration.',
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: '2026-09-26T05:00:00.000Z',
          candidateCommit: repairedCommit,
          verificationChecks: [
            {
              id: 'parent-repair-check',
              name: 'Parent repair check',
              executable: process.execPath,
              argv: [
                '-e',
                "const fs=require('node:fs');if(!fs.existsSync('parent-repair.txt'))process.exit(1)",
              ],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        root,
        'parent-repair-builder-result',
        'parent-repair-builder-session',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'parent-repair-checks', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier' });
      const repairedState = run.state as NativePortableState;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId: repairedState.builder_handoff!.candidate_id,
          verifierExecutionRef: 'parent-repair-verifier-session',
          response: {
            kind: 'final-result',
            result: {
              iteration: repairedState.loop.iteration,
              attempt: repairedState.loop.attempt,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'API and UI work together.' }],
              risks: [],
              summary: 'Parent integration passed independent verification.',
            },
          },
        },
        root,
        'parent-verifier-result',
        'parent-repair-verifier-session',
      );
      expect(run.state).toMatchObject({
        phase: 'verify',
        status: 'await-user',
        verification_result: 'pass',
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.report', type: 'call_tool' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report',
        context: { requestId: 'parent-report', projectRoot: root },
      });
      expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
      const rejectedConfirmation = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: rejectedConfirmation.id,
        proposalHash: rejectedConfirmation.proposalHash,
        decisionId: 'parent-user-rejected',
        choice: 'rejected',
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.parent.builder',
        type: 'handoff',
        input: {
          activation: {
            integrationCommit: repairedCommit,
            rejectedDecisionId: 'parent-user-rejected',
          },
        },
      });
      run = await succeedLatestAction(
        runtime,
        run,
        {
          summary: 'Updated the parent candidate after user feedback.',
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: '2026-09-26T06:00:00.000Z',
          candidateCommit: repairedCommit,
          verificationChecks: [
            {
              id: 'parent-final-check',
              name: 'Parent final check',
              executable: process.execPath,
              argv: [
                '-e',
                "const fs=require('node:fs');if(!fs.existsSync('parent-repair.txt'))process.exit(1)",
              ],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        root,
        'parent-final-builder-result',
        'parent-final-builder-session',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'parent-final-checks', projectRoot: root },
      });
      const finalParentState = run.state as NativePortableState;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId: finalParentState.builder_handoff!.candidate_id,
          verifierExecutionRef: 'parent-final-verifier-session',
          response: {
            kind: 'final-result',
            result: {
              iteration: finalParentState.loop.iteration,
              attempt: finalParentState.loop.attempt,
              verdict: 'pass',
              acceptance: [
                { id: 'A1', result: 'passed', reason: 'Final parent candidate passed.' },
              ],
              risks: [],
              summary: 'Final parent candidate passed independent verification.',
            },
          },
        },
        root,
        'parent-final-verifier-result',
        'parent-final-verifier-session',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report',
        context: { requestId: 'parent-final-report', projectRoot: root },
      });
      const parentConfirmation = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: parentConfirmation.id,
        proposalHash: parentConfirmation.proposalHash,
        decisionId: 'parent-verification-approved',
        choice: 'approved',
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report-revalidate',
        context: { requestId: 'parent-report-revalidate', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.parent.deliver',
        type: 'call_tool',
      });
      if (scenario === 'delivery-ref-lock') {
        const approvedTargetCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        const branchRefLock = path.resolve(
          root,
          execFileSync('git', ['rev-parse', '--git-path', `refs/heads/${branch}.lock`], {
            cwd: root,
            encoding: 'utf8',
          }).trim(),
        );
        await fs.mkdir(path.dirname(branchRefLock), { recursive: true });
        await fs.writeFile(branchRefLock, 'Simulated concurrent target ref update.\n');
        try {
          await expect(
            runtime.execute({
              runId: run.runId,
              actionId: run.actions.at(-1)!.id,
              executorId: 'native-supervisor-parent-deliver',
              context: { requestId: 'parent-delivery-with-ref-lock', projectRoot: root },
            }),
          ).rejects.toThrow(/已保留执行归属/);
        } finally {
          await fs.unlink(branchRefLock);
        }
        const interrupted = await runtime.inspect(run.runId);
        expect(interrupted.actions.at(-1)).toMatchObject({
          stepId: 'supervisor.parent.deliver',
          status: 'unknown',
          reason: expect.stringMatching(/lock/),
        });
        expect(
          execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        ).toBe(approvedTargetCommit);
        await registerSdkChangeOwner(root, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: 'sdk-shape',
          format: 'sdk',
          application: 'native',
          runId: run.runId,
        });
        const recovery = await nativeDomain.runNativeCliDetailed([
          'archive',
          'sdk-shape',
          '--recover',
          '--json',
          '--project-root',
          root,
        ]);
        expect(recovery.dispatch.exitCode).not.toBe(0);
        expect(recovery.dispatch.error?.message).toMatch(/has not received/);
        expect((await runtime.inspect(run.runId)).actions.at(-1)?.status).toBe('unknown');
        expect(() =>
          execFileSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
            cwd: root,
            stdio: 'ignore',
          }),
        ).toThrow();
        const deliveryAction = interrupted.actions.at(-1)!;
        run = await runtime.retry({
          runId: run.runId,
          actionId: deliveryAction.id,
          attempt: deliveryAction.attempt,
          reconciliation: {
            resolution: 'not-executed',
            evidence: { targetBranch: branch, targetCommit: approvedTargetCommit },
          },
        });
        expect(run.actions.at(-1)).toMatchObject({
          id: deliveryAction.id,
          status: 'pending',
          attempt: deliveryAction.attempt + 1,
        });
        const unrelatedFile = path.join(root, 'unexpected.txt');
        await fs.writeFile(unrelatedFile, 'Unrelated work must survive delivery.\n');
        await expect(
          runtime.execute({
            runId: run.runId,
            actionId: deliveryAction.id,
            executorId: 'native-supervisor-parent-deliver',
            context: { requestId: 'parent-delivery-with-unrelated-file', projectRoot: root },
          }),
        ).rejects.toThrow(/已保留执行归属/);
        const dirtyRetry = await runtime.inspect(run.runId);
        expect(dirtyRetry.actions.at(-1)).toMatchObject({
          status: 'unknown',
          reason: expect.stringMatching(/unrelated changes/),
        });
        expect(await fs.readFile(unrelatedFile, 'utf8')).toBe(
          'Unrelated work must survive delivery.\n',
        );
        await fs.unlink(unrelatedFile);
        run = await runtime.retry({
          runId: run.runId,
          actionId: deliveryAction.id,
          attempt: dirtyRetry.actions.at(-1)!.attempt,
          reconciliation: {
            resolution: 'not-executed',
            evidence: { targetBranch: branch, targetCommit: approvedTargetCommit },
          },
        });
        run = await runtime.execute({
          runId: run.runId,
          actionId: deliveryAction.id,
          executorId: 'native-supervisor-parent-deliver',
          context: { requestId: 'parent-delivery-after-ref-lock', projectRoot: root },
        });
        expect(run.actions.at(-1)?.stepId).toBe('archive.prepare');
        return;
      }
      if (scenario === 'target-drift') {
        const approvedTargetCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        execFileSync('git', ['commit', '--allow-empty', '-m', 'drift before delivery'], {
          cwd: root,
          stdio: 'ignore',
        });
        const concurrentTargetCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        expect(concurrentTargetCommit).not.toBe(approvedTargetCommit);
        await expect(
          runtime.execute({
            runId: run.runId,
            actionId: run.actions.at(-1)!.id,
            executorId: 'native-supervisor-parent-deliver',
            context: { requestId: 'parent-delivery-after-target-drift', projectRoot: root },
          }),
        ).rejects.toThrow(/已保留执行归属/);
        const blockedDelivery = await runtime.inspect(run.runId);
        expect(blockedDelivery.actions.at(-1)).toMatchObject({
          stepId: 'supervisor.parent.deliver',
          status: 'unknown',
          reason: expect.stringMatching(/target branch changed after Shape confirmation/),
        });
        expect(
          execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        ).toBe(concurrentTargetCommit);
        expect(
          execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }),
        ).toContain(integrationWorktree.replaceAll('\\', '/'));
        await registerSdkChangeOwner(root, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: 'sdk-shape',
          format: 'sdk',
          application: 'native',
          runId: run.runId,
        });
        const recoverDelivery = () =>
          nativeDomain.runNativeCliDetailed([
            'archive',
            'sdk-shape',
            '--recover',
            '--json',
            '--project-root',
            root,
          ]);
        const driftedRecovery = await recoverDelivery();
        expect(driftedRecovery.dispatch.exitCode).not.toBe(0);
        expect(driftedRecovery.dispatch.error?.message).toMatch(/target branch changed/);
        execFileSync(
          'git',
          ['update-ref', `refs/heads/${branch}`, approvedTargetCommit, concurrentTargetCommit],
          { cwd: root, stdio: 'ignore' },
        );
        const notDeliveredRecovery = await recoverDelivery();
        expect(notDeliveredRecovery.dispatch.exitCode).not.toBe(0);
        expect(notDeliveredRecovery.dispatch.error?.message).toMatch(/has not received/);
        expect((await runtime.inspect(run.runId)).actions.at(-1)?.status).toBe('unknown');
        return;
      }
      if (scenario === 'delivery-recovery') {
        const deliveryAction = run.actions.at(-1)!;
        const deliveryContext = { requestId: 'parent-delivery', projectRoot: root };
        const claimedDelivery = await runtime.claim({
          runId: run.runId,
          actionId: deliveryAction.id,
          attempt: deliveryAction.attempt,
          inputHash: deliveryAction.inputHash,
          executorId: 'native-supervisor-parent-deliver',
          claimToken: 'parent-delivery-owner',
          context: deliveryContext,
        });
        const deliveryExecutor = application.executors.find(
          (executor) => executor.id === 'native-supervisor-parent-deliver',
        )!;
        const delivered = await deliveryExecutor.execute(
          claimedDelivery.actions.at(-1)!,
          deliveryContext,
          claimedDelivery,
        );
        expect(delivered.status).toBe('succeeded');
        await runtime.markUnknown({
          runId: run.runId,
          actionId: deliveryAction.id,
          attempt: deliveryAction.attempt,
          reason: 'Host stopped after fast-forward delivery',
        });
        await registerSdkChangeOwner(root, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: 'sdk-shape',
          format: 'sdk',
          application: 'native',
          runId: run.runId,
        });
        const recovered = await nativeDomain.runNativeCliDetailed([
          'archive',
          'sdk-shape',
          '--recover',
          '--json',
          '--project-root',
          root,
        ]);
        expect(recovered.dispatch.exitCode, recovered.output).toBe(0);
        runtime = createSupervisorRuntime();
        run = await runtime.inspect(run.runId);
      } else {
        run = await runtime.execute({
          runId: run.runId,
          actionId: run.actions.at(-1)!.id,
          executorId: 'native-supervisor-parent-deliver',
          context: { requestId: 'parent-delivery', projectRoot: root },
        });
      }
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', type: 'call_tool' });
      expect(
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      ).toBe(
        execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: integrationWorktree,
          encoding: 'utf8',
        }).trim(),
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-preflight',
        context: { requestId: 'parent-archive-preflight', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.execute' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-apply',
        context: { requestId: 'parent-archive-apply', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.finalize' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-finalize',
        context: { requestId: 'parent-archive-finalize', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.cleanup',
        type: 'call_tool',
      });
      const cleanupAction = run.actions.at(-1)!;
      if (scenario === 'normal' || scenario === 'delivery-recovery') {
        run = await runtime.execute({
          runId: run.runId,
          actionId: cleanupAction.id,
          executorId: 'native-supervisor-cleanup',
          context: { requestId: 'parent-cleanup', projectRoot: root },
        });
      } else if (scenario === 'branch-lock-recovery') {
        const branchLock = path.join(
          root,
          '.git',
          'refs',
          'heads',
          'comet',
          'supervisor',
          'sdk-shape',
          'api.lock',
        );
        await fs.mkdir(path.dirname(branchLock), { recursive: true });
        await fs.writeFile(branchLock, 'Simulated concurrent Git ref update.\n');
        await expect(
          runtime.execute({
            runId: run.runId,
            actionId: cleanupAction.id,
            executorId: 'native-supervisor-cleanup',
            context: { requestId: 'parent-cleanup-with-ref-lock', projectRoot: root },
          }),
        ).rejects.toThrow(/已保留执行归属/);
        const interrupted = await runtime.inspect(run.runId);
        expect(interrupted.actions.at(-1)).toMatchObject({
          stepId: 'supervisor.cleanup',
          status: 'unknown',
          reason: expect.stringMatching(/lock/),
        });
        expect(
          execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }),
        ).not.toContain(integrationWorktree.replaceAll('\\', '/'));
        expect(
          execFileSync('git', ['branch', '--list', 'comet/supervisor/sdk-shape/api'], {
            cwd: root,
            encoding: 'utf8',
          }).trim(),
        ).toBe('comet/supervisor/sdk-shape/api');
        await fs.unlink(branchLock);
        await registerSdkChangeOwner(root, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: 'sdk-shape',
          format: 'sdk',
          application: 'native',
          runId: run.runId,
        });
        const recovered = await nativeDomain.runNativeCliDetailed([
          'archive',
          'sdk-shape',
          '--recover',
          '--json',
          '--project-root',
          root,
        ]);
        expect(recovered.dispatch.exitCode, recovered.output).toBe(0);
        runtime = createSupervisorRuntime();
        run = await runtime.inspect(run.runId);
      } else {
        const cleanupContext = { requestId: 'parent-cleanup', projectRoot: root };
        const claimedCleanup = await runtime.claim({
          runId: run.runId,
          actionId: cleanupAction.id,
          attempt: cleanupAction.attempt,
          inputHash: cleanupAction.inputHash,
          executorId: 'native-supervisor-cleanup',
          claimToken: 'parent-cleanup-owner',
          context: cleanupContext,
        });
        const cleanupExecutor = application.executors.find(
          (executor) => executor.id === 'native-supervisor-cleanup',
        )!;
        const deliveredCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        execFileSync('git', ['commit', '--allow-empty', '-m', 'simulate target drift'], {
          cwd: root,
          stdio: 'ignore',
        });
        const driftCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        await expect(
          cleanupExecutor.execute(claimedCleanup.actions.at(-1)!, cleanupContext, claimedCleanup),
        ).rejects.toThrow(/verified delivery/);
        execFileSync('git', ['update-ref', `refs/heads/${branch}`, deliveredCommit, driftCommit], {
          cwd: root,
          stdio: 'ignore',
        });
        const untracked = path.join(integrationWorktree, 'preserve-user-work.txt');
        await fs.writeFile(untracked, 'Do not remove this worktree.\n');
        await expect(
          cleanupExecutor.execute(claimedCleanup.actions.at(-1)!, cleanupContext, claimedCleanup),
        ).rejects.toThrow(/changed worktree/);
        expect(
          execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }),
        ).toContain(integrationWorktree.replaceAll('\\', '/'));
        await fs.unlink(untracked);
        const firstChildWorktree = path.join(root, '.worktrees', 'sdk-shape-api');
        await removeNativeWorkspaceConfig(firstChildWorktree);
        execFileSync('git', ['worktree', 'remove', firstChildWorktree], {
          cwd: root,
          stdio: 'ignore',
        });
        expect(
          execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }),
        ).not.toContain(firstChildWorktree.replaceAll('\\', '/'));
        await runtime.markUnknown({
          runId: run.runId,
          actionId: cleanupAction.id,
          attempt: cleanupAction.attempt,
          reason: 'Host stopped after removing the first Child worktree',
        });
        await registerSdkChangeOwner(root, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: 'sdk-shape',
          format: 'sdk',
          application: 'native',
          runId: run.runId,
        });
        execFileSync('git', ['commit', '--allow-empty', '-m', 'drift during cleanup recovery'], {
          cwd: root,
          stdio: 'ignore',
        });
        const concurrentDriftCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        const blockedRecovery = await nativeDomain.runNativeCliDetailed([
          'archive',
          'sdk-shape',
          '--recover',
          '--json',
          '--project-root',
          root,
        ]);
        expect(blockedRecovery.dispatch.exitCode).not.toBe(0);
        expect(blockedRecovery.dispatch.error?.message).toMatch(/verified delivery/);
        expect(
          execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }),
        ).toContain(integrationWorktree.replaceAll('\\', '/'));
        expect((await runtime.inspect(run.runId)).actions.at(-1)?.status).toBe('unknown');
        execFileSync(
          'git',
          ['update-ref', `refs/heads/${branch}`, deliveredCommit, concurrentDriftCommit],
          { cwd: root, stdio: 'ignore' },
        );
        const recovered = await nativeDomain.runNativeCliDetailed([
          'archive',
          'sdk-shape',
          '--recover',
          '--json',
          '--project-root',
          root,
        ]);
        expect(recovered.dispatch.exitCode, recovered.output).toBe(0);
        runtime = createSupervisorRuntime();
        run = await runtime.inspect(run.runId);
      }
      expect(run.status).toBe('completed');
      const remainingWorktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(remainingWorktrees).not.toContain(integrationWorktree);
      expect(remainingWorktrees).not.toContain(path.join(root, '.worktrees', 'sdk-shape-api'));
      expect(remainingWorktrees).not.toContain(path.join(root, '.worktrees', 'sdk-shape-ui'));
      expect(
        execFileSync('git', ['branch', '--list', 'comet/supervisor/sdk-shape/*'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
      ).toBe('');
      expect((await fs.readFile(path.join(root, 'api.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe(
        'API implemented\n',
      );
      expect((await fs.readFile(path.join(root, 'ui.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe(
        'UI implemented\n',
      );
      expect(
        (await fs.readFile(path.join(root, 'parent-repair.txt'), 'utf8')).replaceAll('\r\n', '\n'),
      ).toBe('Parent repaired\n');
      await expect(fs.access(nativeSupervisorStateFile(paths, 'sdk-shape'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
    240_000,
  );

  it('rejects an incomplete formal brief before proposing Shape confirmation', async () => {
    const { paths, changeDir, initialState } = await fixture();
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Scope\nThe selected workflow.\n# Acceptance examples\n- The selected workflow resumes.\n',
    );
    await expect(collectProposal(paths, initialState)).rejects.toThrow(/brief-section-missing/);
  });

  it('retains the v2 document contract for a pending approval but upgrades a fresh proposal', async () => {
    const { paths, changeDir, initialState } = await fixture();
    const brief = path.join(changeDir, 'brief.md');
    await fs.writeFile(
      brief,
      (await fs.readFile(brief, 'utf8')).replace(
        /## Directory structure[\s\S]*?(?=# Non-goals)/u,
        '',
      ),
    );
    const legacyState = { ...initialState, document_constraints_version: 2 as const };
    const pending = prepareNativePortableShapeConfirmation({
      state: legacyState,
      acceptance: [{ id: 'A1', source: 'brief.md', text: 'The selected workflow resumes.' }],
    });
    await expect(collectProposal(paths, pending)).resolves.toMatchObject({
      acceptance: [{ id: 'A1', text: 'The selected workflow resumes.' }],
    });
    await expect(collectProposal(paths, legacyState)).rejects.toThrow(/brief-structure-missing/u);
  });

  it('repairs missing structure in the same SDK Run before confirming the complete Shape', async () => {
    const { root, changeDir, runtime, run: prepared } = await preparedShape('sdk');
    const wait = prepared.waits.at(-1)!;
    const rejected = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-needs-revision',
      choice: 'rejected',
    });
    const brief = path.join(changeDir, 'brief.md');
    const completeBrief = await fs.readFile(brief, 'utf8');
    await fs.writeFile(
      brief,
      completeBrief.replace(/## Directory structure[\s\S]*?(?=# Non-goals)/u, ''),
    );
    await expect(advanceNativeSdkChange(root, 'sdk-shape')).rejects.toThrow(
      /brief-structure-missing/u,
    );
    const afterFailure = await runtime.inspect(prepared.runId);
    expect(afterFailure.state).toEqual(rejected.state);
    expect(afterFailure.actions.at(-1)).toMatchObject({
      id: rejected.actions.at(-1)!.id,
      status: 'pending',
    });
    await fs.writeFile(brief, completeBrief);
    expect(await advanceNativeSdkChange(root, 'sdk-shape')).toMatchObject({ exitCode: 0 });
    const repaired = await runtime.inspect(prepared.runId);
    expect(repaired.state).toMatchObject({
      document_constraints_version: 3,
      phase: 'shape',
      status: 'await-user',
    });
    expect(repaired.waits.at(-1)!.id).not.toBe(wait.id);
    expect(
      await advanceNativeSdkChange(root, 'sdk-shape', {
        expectedAction: 'confirm-shape',
        expectedStateVersion: (repaired.state as NativePortableState).state_version,
        summary: 'Confirm the repaired complete Shape.',
      }),
    ).toMatchObject({ exitCode: 0 });
    const confirmed = await runtime.inspect(prepared.runId);
    expect(confirmed.state).toMatchObject({ phase: 'build', document_constraints_version: 3 });
    expect(confirmed.actions.at(-1)).toMatchObject({ stepId: 'build.builder' });
  });

  it('keeps SDK Shape approval current after formatting-only document edits', async () => {
    const { root, paths, changeDir, runtime, run: prepared } = await preparedShape();
    expect(prepared.state).toMatchObject({ document_constraints_version: 3 });
    const wait = prepared.waits.at(-1)!;
    let run = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    const brief = path.join(changeDir, 'brief.md');
    await fs.writeFile(
      brief,
      (await fs.readFile(brief, 'utf8')).replace(
        'Ship the selected workflow.',
        'Ship the selected workflow.\n',
      ),
    );
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'formatted-shape',
    );
    expect(run.state).toMatchObject({ phase: 'build' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder' });
  });

  it('enters Build through a host handoff only after revalidating the approved Shape', async () => {
    const { root, paths, runtime, run: prepared } = await preparedShape();
    const wait = prepared.waits.at(-1)!;
    let run = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'shape.revalidate', type: 'call_tool' });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-revalidated',
    );
    expect(run.state).toMatchObject({
      phase: 'build',
      status: 'active',
      loop: { stage: 'building' },
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder', type: 'handoff' });
  });

  it('returns an unclaimed Build change to Shape when removing an existing capability', async () => {
    const { root, paths, runtime, run: prepared } = await preparedShape();
    await fs.mkdir(path.join(paths.specsDir, 'retired'), { recursive: true });
    await fs.writeFile(path.join(paths.specsDir, 'retired', 'spec.md'), '# Retired\n');
    const wait = prepared.waits.at(-1)!;
    let run = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-revalidated',
    );
    expect(run.state).toMatchObject({ phase: 'build' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });

    const dispatched = await runtime.dispatchCommand({
      runId: run.runId,
      expectedRevision: run.revision,
      commandId: 'remove-retired',
      name: 'remove-capability',
      input: {
        capability: 'retired',
        expectedStateVersion: (run.state as NativePortableState).state_version,
      },
      context: { requestId: 'remove-retired', projectRoot: root },
    });
    const action = dispatched.actions.at(-1)!;
    const removed = await runtime.execute({
      runId: run.runId,
      actionId: action.id,
      executorId: 'comet-native-remove',
      context: { requestId: 'remove-retired-execute', projectRoot: root },
    });

    expect(
      dispatched.actions.find((candidate) => candidate.stepId === 'build.builder'),
    ).toMatchObject({
      status: 'cancelled',
    });
    expect(removed.state).toMatchObject({
      phase: 'shape',
      status: 'active',
      spec_changes: [
        { capability: 'retired', operation: 'remove', source: null },
        { capability: 'workflow', operation: 'create', source: 'specs/workflow/spec.md' },
      ],
      loop: { stage: 'shape', next_action: 'prepare-shape-confirmation' },
      acceptance: [],
    });
    expect(removed.actions.at(-1)).toMatchObject({ stepId: 'shape.prepare', status: 'pending' });
  });

  it('returns Verify to Shape through a persisted requirements revision command', async () => {
    const { root, runtime, run: verifying } = await dispatchedVerifier([]);
    expect(verifying.state).toMatchObject({ phase: 'verify' });
    const state = verifying.state as NativePortableState;
    const dispatched = await runtime.dispatchCommand({
      runId: verifying.runId,
      expectedRevision: verifying.revision,
      commandId: 'revise-acceptance',
      name: 'revise-requirements',
      input: {
        reason: 'The acceptance criteria changed.',
        expectedStateVersion: state.state_version,
      },
      context: { requestId: 'revise-acceptance', projectRoot: root },
    });
    const revised = await runtime.execute({
      runId: verifying.runId,
      actionId: dispatched.actions.at(-1)!.id,
      executorId: 'comet-native-revise-requirements',
      context: { requestId: 'revise-acceptance-execute', projectRoot: root },
    });

    expect(dispatched.actions.find((action) => action.stepId === 'verify.verifier')).toMatchObject({
      status: 'cancelled',
    });
    expect(revised.state).toMatchObject({
      phase: 'shape',
      status: 'active',
      loop: { stage: 'shape', next_action: 'prepare-shape-confirmation' },
      acceptance: [],
      builder_handoff: null,
      verification: null,
    });
    expect((revised.state as NativePortableState).history.at(-1)?.summary).toMatchObject({
      text: 'The acceptance criteria changed.',
    });
    expect(revised.actions.at(-1)).toMatchObject({ stepId: 'shape.prepare', status: 'pending' });
  });

  it('allows requirements revision before Archive applies Specs but rejects it afterwards', async () => {
    const beforeApply = await awaitingArchiveApplication();
    expect(beforeApply.run.actions.at(-1)).toMatchObject({
      stepId: 'archive.execute',
      status: 'pending',
    });
    const current = beforeApply.run.state as NativePortableState;
    const dispatched = await beforeApply.runtime.dispatchCommand({
      runId: beforeApply.run.runId,
      expectedRevision: beforeApply.run.revision,
      commandId: 'revise-before-archive-apply',
      name: 'revise-requirements',
      input: {
        reason: 'The target behavior changed.',
        expectedStateVersion: current.state_version,
      },
      context: { requestId: 'revise-before-archive-apply', projectRoot: beforeApply.root },
    });
    const revised = await beforeApply.runtime.execute({
      runId: beforeApply.run.runId,
      actionId: dispatched.actions.at(-1)!.id,
      executorId: 'comet-native-revise-requirements',
      context: { requestId: 'revise-before-archive-apply-execute', projectRoot: beforeApply.root },
    });
    expect(revised.state).toMatchObject({ phase: 'shape', status: 'active' });

    const afterApply = await awaitingArchiveFinalization();
    const applied = afterApply.run.state as NativePortableState;
    await expect(
      afterApply.runtime.dispatchCommand({
        runId: afterApply.run.runId,
        expectedRevision: afterApply.run.revision,
        commandId: 'revise-after-archive-apply',
        name: 'revise-requirements',
        input: {
          reason: 'The target behavior changed.',
          expectedStateVersion: applied.state_version,
        },
        context: { requestId: 'revise-after-archive-apply', projectRoot: afterApply.root },
      }),
    ).rejects.toMatchObject({ code: 'COMMAND_REJECTED' });
    expect(await afterApply.runtime.inspect(afterApply.run.runId)).toEqual(afterApply.run);
  });

  it.each([
    undefined,
    [],
    [{ id: 'A1', status: 'not-implemented', evidence: [], note: 'Work remains.' }],
  ])(
    'keeps an incomplete SDK Builder on its claimed Action for correction: %j',
    async (acceptanceReview) => {
      const { root, paths, runtime, run: prepared } = await preparedShape();
      const wait = prepared.waits.at(-1)!;
      let run = await runtime.resolveWait({
        runId: prepared.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'shape-approved',
        choice: 'approved',
      });
      run = await succeedLatestAction(
        runtime,
        run,
        await collectProposal(paths, run.state as NativePortableState),
        root,
        'shape-revalidated',
      );
      const builder = run.actions.at(-1)!;
      await expect(
        succeedLatestAction(
          runtime,
          run,
          {
            summary: 'Incomplete work.',
            addressedAcceptanceIds: ['A1'],
            ...(acceptanceReview === undefined ? {} : { acceptanceReview }),
            checks: [],
            knownLimits: [],
            submittedAt: '2026-09-24T01:00:00.000Z',
          },
          root,
          'incomplete-builder',
          'builder-session',
        ),
      ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
      const current = await runtime.inspect(run.runId);
      expect(current.state).toMatchObject({ phase: 'build', verification_result: 'pending' });
      expect(current.actions.at(-1)).toMatchObject({ id: builder.id, status: 'running' });
      expect(current.actions.some((action) => action.stepId === 'verify.checks')).toBe(false);
    },
  );

  it('records a claimed Builder handoff as a candidate before scheduling independent checks', async () => {
    const { root, paths, runtime, run: prepared } = await preparedShape();
    const wait = prepared.waits.at(-1)!;
    let run = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-revalidated',
    );
    run = await succeedLatestAction(
      runtime,
      run,
      {
        summary: 'Implemented the selected workflow.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-09-24T01:00:00.000Z',
      },
      root,
      'builder-candidate',
      'builder-session-1',
    );
    expect(run.state).toMatchObject({
      phase: 'verify',
      status: 'active',
      builder_handoff: {
        builder_execution_ref: 'builder-session-1',
        identity_provider: 'skill-coordinated',
        addressed_acceptance_ids: ['A1'],
      },
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.checks', type: 'call_tool' });
  });

  it('executes the Builder-bound check plan before dispatching an independent Verifier', async () => {
    const { root, paths, runtime, run: prepared } = await preparedShape();
    const wait = prepared.waits.at(-1)!;
    let run = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-revalidated',
    );
    run = await succeedLatestAction(
      runtime,
      run,
      {
        summary: 'Implemented the selected workflow.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-09-24T01:00:00.000Z',
        verificationChecks: [
          {
            id: 'focused',
            name: 'Focused check',
            executable: process.execPath,
            argv: ['-e', 'process.stdout.write("sdk-check-ok")'],
            cwdRef: '.',
            timeoutMs: 5_000,
            repeatable: true,
          },
        ],
      },
      root,
      'builder-candidate',
      'builder-session-1',
    );
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'native-check-execution', projectRoot: root },
    });
    const output = run.outputs['verify.checks'].value as {
      checks: Array<{ status: string; logRef: string }>;
    };
    expect(output.checks).toMatchObject([{ status: 'passed' }]);
    expect(
      await fs.readFile(
        path.join(resolveWorkspaceRuntimeRootSync(root), output.checks[0].logRef),
        'utf8',
      ),
    ).toContain('sdk-check-ok');
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', type: 'handoff' });
    // 旧日志引用只在访问本机存储时归一化，不改写已保存的执行回执。
    const legacy = structuredClone(run);
    const completedCheck = legacy.actions.find(
      (action) => action.stepId === 'verify.checks' && action.status === 'succeeded',
    )!;
    const saved = completedCheck.outcome!.output as { checks: Array<{ logRef: string }> };
    saved.checks[0].logRef = `.comet/runtime/${saved.checks[0].logRef}`;
    const originalReceipt = JSON.stringify(completedCheck.outcome);
    expect(await nativeSdkCurrentCheckSummaries({ run: legacy, projectRoot: root })).toMatchObject([
      { status: 'passed' },
    ]);
    expect(JSON.stringify(completedCheck.outcome)).toBe(originalReceipt);
  });

  it('continues a healthy previous-definition Run without an upgrade or replacing its claim', async () => {
    const { root, store, run } = await dispatchedVerifier([], 'sdk', preCheckRecoveryApplication());
    const next = await advanceNativeSdkChange(root, run.runId);
    expect(next).toMatchObject({
      exitCode: 0,
      data: { phase: 'verify', pendingAction: { stepId: 'verify.verifier' } },
    });
    const doctor = await nativeDoctorCommand([run.runId], root);
    expect(doctor).toMatchObject({
      exitCode: 0,
      data: { healthy: true, repaired: false },
    });
    const reconciled = (await store.read(run.runId))!;
    expectOriginalActionFacts(reconciled, run.actions);
    expect({
      ...reconciled,
      actions: run.actions,
      revision: run.revision,
    }).toEqual(run);
    expect(reconciled.revision).toBe(run.revision + 1);
    const { runtime } = await loadOwnedNativeSdkRuntime(root, run.runId);
    const action = run.actions.at(-1)!;
    const claimed = await runtime.claim({
      runId: run.runId,
      expectedRevision: reconciled.revision,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: 'existing-verifier',
      claimToken: 'existing-claim',
      context: { requestId: 'existing-claim', projectRoot: root },
    });
    expect((await advanceNativeSdkChange(root, run.runId)).data).toMatchObject({
      phase: 'verify',
      run: { revision: claimed.revision },
      activeActions: [{ id: action.id, status: 'running', claim: { token: 'existing-claim' } }],
    });
    expect((await store.read(run.runId))?.workflow).toEqual(run.workflow);
    expect((await nativeDoctorCommand([run.runId], root)).exitCode).toBe(0);
  });

  it.each([false, true])(
    'upgrades a stopped check Run without replaying its execution (tampered=%s)',
    async (tampered) => {
      const { root, store, run } = await dispatchedVerifier(
        [
          {
            id: 'old-failure',
            name: 'Previously failed check',
            executable: process.execPath,
            argv: ['-e', "throw new Error('saved-check-failure')"],
            cwdRef: '.',
            timeoutMs: 5_000,
            repeatable: true,
          },
        ],
        'sdk',
        preCheckRecoveryApplication(),
      );
      expect(run).toMatchObject({ status: 'failed', state: { phase: 'verify', status: 'active' } });
      const failed = run.actions.at(-1)!;
      const logRef = (failed.outcome!.output as { checks: Array<{ logRef: string }> }).checks[0]
        .logRef;
      const original = await store.read(run.runId);
      const diagnostic = await nativeDoctorCommand([run.runId], root);
      expect(diagnostic).toMatchObject({
        exitCode: 65,
        data: { findings: [{ code: 'sdk-definition-upgrade-required', ready: true }] },
      });
      expect(await store.read(run.runId)).toEqual(original);
      if (tampered) {
        await fs.appendFile(
          path.join(resolveWorkspaceRuntimeRootSync(root), logRef),
          'receipt changed',
        );
        await expect(inspectNativeSdkDefinitionUpgrade(root, run.runId, true)).rejects.toThrow(
          'log changed',
        );
        expect(await store.read(run.runId)).toEqual(original);
        return;
      }
      const repaired = await nativeDoctorCommand([run.runId, '--repair'], root);
      expect(repaired, JSON.stringify(repaired)).toMatchObject({
        exitCode: 0,
        data: { repaired: true, phase: 'build' },
      });
      const recovered = await store.read(run.runId);
      expectOriginalActionFacts(recovered!, original!.actions);
      expect(recovered?.waits).toEqual(original?.waits);
      expect(recovered?.outputs).toEqual(original?.outputs);
      expect(recovered?.revision).toBe(run.revision + 2);
      const next = await advanceNativeSdkChange(root, run.runId);
      expect(next).toMatchObject({
        exitCode: 0,
        data: { phase: 'build', pendingAction: { stepId: 'build.builder' } },
      });
      expectOriginalActionFacts((await store.read(run.runId))!, [failed]);
      expect(await inspectNativeSdkDefinitionUpgrade(root, run.runId, true)).toBeNull();
    },
  );

  it('repairs a real failed Runtime check with a new candidate and preserves receipts through Archive', async () => {
    const {
      root,
      runtime,
      run: failed,
    } = await dispatchedVerifier([
      {
        id: 'focused',
        name: 'Focused check',
        executable: process.execPath,
        argv: ['-e', "throw new Error('controlled-check-failure')"],
        cwdRef: '.',
        timeoutMs: 5_000,
        repeatable: true,
      },
    ]);
    const failedAction = failed.actions.findLast((action) => action.stepId === 'verify.checks')!;
    const failedOutput = failedAction.outcome!.output as {
      candidateId: string;
      checks: Array<{ status: string; exitCode: number; logRef: string; logSha256: string }>;
    };
    expect(failedAction).toMatchObject({ status: 'failed', attempt: 1 });
    expect(failedOutput.checks).toMatchObject([{ status: 'failed', exitCode: 1 }]);
    const log = await fs.readFile(
      path.join(resolveWorkspaceRuntimeRootSync(root), failedOutput.checks[0].logRef),
    );
    expect(log.toString()).toContain('controlled-check-failure');
    expect(createHash('sha256').update(log).digest('hex')).toBe(failedOutput.checks[0].logSha256);
    expect(failed).toMatchObject({
      status: 'running',
      state: {
        phase: 'build',
        status: 'active',
        loop: { failed_iteration_count: 1 },
      },
    });
    expect((failed.state as NativePortableState).history.at(-1)?.summary.text).toContain('focused');
    expect(failed.actions.at(-1)).toMatchObject({
      stepId: 'build.builder',
      status: 'pending',
      input: { activation: { failedCheckActionId: failedAction.id } },
    });
    const shapeDecision = failed.waits.find((wait) => wait.stepId === 'shape.confirm')!;
    const builder = failed.actions.at(-1)!;
    await expect(
      runtime.claim({
        runId: failed.runId,
        expectedRevision: failed.revision - 1,
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        executorId: 'native-host',
        sessionId: 'stale-builder',
        claimToken: 'stale-claim',
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(
      runtime.retry({
        runId: failed.runId,
        expectedRevision: failed.revision,
        actionId: failedAction.id,
        attempt: failedAction.attempt,
      }),
    ).rejects.toMatchObject({ code: 'ACTION_ALREADY_ADVANCED' });
    let run = await succeedLatestAction(
      runtime,
      failed,
      {
        summary: 'Repaired the failed implementation.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        submittedAt: '2026-09-24T02:00:00.000Z',
        verificationChecks: [
          {
            id: 'focused',
            name: 'Focused repaired check',
            executable: process.execPath,
            argv: ['-e', "process.stdout.write('repaired-check-passed')"],
            cwdRef: '.',
            timeoutMs: 5_000,
            repeatable: true,
          },
        ],
      },
      root,
      'repaired-candidate',
      'repair-builder-session',
    );
    const candidate = (run.state as NativePortableState).builder_handoff!.candidate_id;
    expect(candidate).not.toBe(failedOutput.candidateId);
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'repaired-checks', projectRoot: root },
    });
    expect(run.outputs['verify.checks'].value).toMatchObject({
      candidateId: candidate,
      checks: [{ status: 'passed', exitCode: 0 }],
    });
    expect(run.actions.find((action) => action.id === failedAction.id)).toEqual(failedAction);
    const state = run.state as NativePortableState;
    run = await succeedLatestAction(
      runtime,
      run,
      {
        candidateId: candidate,
        verifierExecutionRef: 'repair-verifier-session',
        response: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'pass',
            acceptance: [
              { id: 'A1', result: 'passed', reason: 'Verified the repaired candidate.' },
            ],
            risks: [],
            summary: 'Repaired candidate independently accepted.',
          },
        },
      },
      root,
      'repaired-verification',
      'repair-verifier-session',
    );
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report',
      context: { requestId: 'repaired-report', projectRoot: root },
    });
    const approval = run.waits.at(-1)!;
    expect(approval).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
    expect(run.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: approval.id,
      proposalHash: approval.proposalHash,
      decisionId: 'explicit-repair-approval',
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
        context: { requestId: `repaired-${executorId}`, projectRoot: root },
      });
    }
    expect(run).toMatchObject({ status: 'completed', state: { archived: true, status: 'done' } });
    expect(run.waits.find((wait) => wait.id === shapeDecision.id)).toEqual(shapeDecision);
    expect(run.actions.find((action) => action.id === failedAction.id)).toEqual(failedAction);
    expect(
      await fs.readFile(
        path.join(resolveWorkspaceRuntimeRootSync(root), failedOutput.checks[0].logRef),
      ),
    ).toEqual(log);
  });

  it('recovers a real complete check receipt without running its side effect again', async () => {
    const counterRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-complete-check-counter-'));
    roots.push(counterRoot);
    const counter = path.join(counterRoot, 'check-count');
    const {
      root,
      runtime,
      run: ready,
    } = await dispatchedVerifier(
      [
        {
          id: 'once',
          name: 'Once',
          executable: process.execPath,
          argv: [
            '-e',
            "require('node:fs').appendFileSync(process.argv[1], 'once\\n'); process.stdout.write('receipt')",
            counter,
          ],
          cwdRef: '.',
          timeoutMs: 5000,
          repeatable: false,
        },
      ],
      'sdk',
      nativeApplication(),
      false,
    );
    const pending = ready.actions.at(-1)!;
    const claimed = await runtime.claim({
      runId: ready.runId,
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      executorId: 'comet-native-checks',
      claimToken: 'complete-unsubmitted',

      context: { projectRoot: root, requestId: 'native-check-claim-5081' },
    });
    const action = claimed.actions.at(-1)!;
    const result = await nativeSdkCheckExecutor.execute(
      action,
      { projectRoot: root, requestId: 'complete-without-submit' },
      claimed,
    );
    const log = path.join(
      resolveWorkspaceRuntimeRootSync(root),
      (result.output as { checks: Array<{ logRef: string }> }).checks[0].logRef,
    );
    const originalLog = await fs.readFile(log);
    await fs.appendFile(log, 'tampered');
    const rejected = await recoverNativeSdkChecks(
      root,
      await runtime.inspect(ready.runId),
      runtime,
    );
    expect(rejected.actions.find((entry) => entry.id === action.id)?.status).toBe('running');
    await fs.writeFile(log, originalLog);
    expect((await runtime.inspect(ready.runId)).actions.at(-1)?.status).toBe('running');
    const recovered = await recoverNativeSdkChecks(
      root,
      await runtime.inspect(ready.runId),
      runtime,
    );
    expect(recovered.actions.find((entry) => entry.id === action.id)).toMatchObject({
      status: 'succeeded',
      attempt: 1,
      claim: action.claim,
    });
    expect(recovered.actions.at(-1)).toMatchObject({
      stepId: 'verify.verifier',
      status: 'pending',
    });
    expect(await fs.readFile(counter, 'utf8')).toBe('once\n');
    expect((await recoverNativeSdkChecks(root, recovered, runtime)).revision).toBe(
      recovered.revision,
    );
    expect(await fs.readFile(counter, 'utf8')).toBe('once\n');
  });

  it('requires explicit stopped repair for a completed check whose input drifted, without replaying its result', async () => {
    // 计数只观测执行次数，不是本测试要制造的候选输入漂移。
    const counterRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-check-drift-counter-'));
    roots.push(counterRoot);
    const counter = path.join(counterRoot, 'check-count');
    const {
      root,
      runtime,
      run: ready,
    } = await dispatchedVerifier(
      [
        {
          id: 'once',
          name: 'Once',
          executable: process.execPath,
          argv: ['-e', "require('node:fs').appendFileSync(process.argv[1], 'once\\n')", counter],
          cwdRef: '.',
          timeoutMs: 5000,
          repeatable: false,
        },
      ],
      'sdk',
      nativeApplication(),
      false,
    );
    const pending = ready.actions.at(-1)!;
    let run = await runtime.claim({
      runId: ready.runId,
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      executorId: 'comet-native-checks',
      claimToken: 'completed-drift-original',

      context: { projectRoot: root, requestId: 'native-check-claim-5156' },
    });
    const action = run.actions.at(-1)!;
    const original = await nativeSdkCheckExecutor.execute(
      action,
      { projectRoot: root, requestId: 'completed-drift' },
      run,
    );
    expect(original.status).toBe('succeeded');
    const inspection = (await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0];
    expect(inspection).toMatchObject({ phase: 'completed', quiescent: true, owner: 'alive' });
    const execution = structuredClone(inspection.execution);
    await fs.writeFile(path.join(root, 'new-source.js'), 'export const changed = true;\n');
    run = await recoverNativeSdkChecks(root, run, runtime);
    expect(run.actions.find((entry) => entry.id === action.id)?.status).toBe('running');
    expect(run.waits.filter((wait) => wait.status === 'pending')).toHaveLength(0);
    const projection = await projectNativeSdkContinuation({
      projectRoot: root,
      run,
      state: run.state as NativePortableState,
    });
    expect(projection.continuation).toMatchObject({
      disposition: 'blocked',
      mode: 'reconcile',
      requiresUserDecision: true,
      commandArgs: expect.arrayContaining([
        'doctor',
        '--repair',
        '--confirmed',
        '--stopped-actions',
      ]),
      inputOptions: [
        {
          name: 'stopped-actions-json-file',
          template: [
            {
              actionId: action.id,
              attempt: action.attempt,
              inputHash: action.inputHash,
              claimToken: action.claim!.token,
            },
          ],
        },
      ],
      userCommunication: { agentInstruction: expect.stringContaining('input has changed') },
    });
    const doctor = await nativeDoctorCommand([run.runId], root);
    expect(doctor.data).toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({
          code: 'sdk-check-execution-recovery-required',
          actionId: action.id,
          repairCommand: expect.stringContaining('--confirmed --stopped-actions'),
          message: expect.stringContaining('输入随后变化'),
        }),
      ]),
    });
    const stopped = {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim!.token,
      evidence:
        'The original Node check exited and its process group is quiescent. It started no detached descendants. Retain the original side effect and repair the changed candidate.',
    };
    await expect(
      recoverNativeSdkChecks(root, run, runtime, {
        reconcileInterrupted: true,
        stoppedActions: [{ ...stopped, claimToken: 'wrong-claim' }],
      }),
    ).rejects.toThrow('中断核对需要');
    // 输入变化不能掩盖日志损坏，必须保留原始证据后才可进入修复。
    const log = path.join(
      resolveWorkspaceRuntimeRootSync(root),
      (original.output as { checks: Array<{ logRef: string }> }).checks[0].logRef,
    );
    const originalLog = await fs.readFile(log);
    await fs.appendFile(log, 'tampered');
    const options = { reconcileInterrupted: true, stoppedActions: [stopped] };
    run = await recoverNativeSdkChecks(root, run, runtime, options);
    expect(run.actions.find((entry) => entry.id === action.id)?.status).toBe('running');
    await fs.writeFile(log, originalLog);
    const racingRuntime = {
      ...runtime,
      recordOutcome: async (...args: Parameters<typeof runtime.recordOutcome>) => {
        await fs.rm(path.join(root, 'new-source.js'));
        return runtime.recordOutcome(...args);
      },
    };
    await expect(recoverNativeSdkChecks(root, run, racingRuntime, options)).rejects.toThrow(
      'OUTCOME_REJECTED',
    );
    expect(
      (await runtime.inspect(run.runId)).actions.find((entry) => entry.id === action.id)?.status,
    ).toBe('running');
    await fs.writeFile(path.join(root, 'new-source.js'), 'export const changed = true;\n');
    const stoppedFile = path.join(root, 'stopped-actions.json');
    await fs.writeFile(stoppedFile, JSON.stringify([stopped]));
    const repairDiagnostic = await nativeDoctorCommand(
      [run.runId, '--repair', '--confirmed', '--stopped-actions', stoppedFile],
      root,
    );
    expect(repairDiagnostic, JSON.stringify(repairDiagnostic)).toMatchObject({
      data: { repaired: true },
    });
    const cold = (await loadOwnedNativeSdkRuntime(root, run.runId)).runtime;
    run = await cold.inspect(run.runId);
    const repaired = run.actions.find((entry) => entry.id === action.id)!;
    expect(repaired).toMatchObject({
      status: 'failed',
      attempt: 1,
      claim: action.claim,
      outcome: {
        output: {
          checks: [{ id: 'once', status: 'passed' }],
          interruption: { kind: 'completed-input-drift', unknownCheckIds: [], partialLogs: [] },
        },
      },
    });
    expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.checks-stop', status: 'pending' });
    expect(run.state).toMatchObject({ phase: 'verify', status: 'await-user' });
    expect(hasNativeSdkPortableStopEvidence(run, repaired)).toBe(true);
    const portable = readPortableRunCheckpoint(createPortableRunCheckpoint(run), run.runId)!;
    expect(
      hasNativeSdkPortableStopEvidence(
        portable,
        portable.actions.find((entry) => entry.id === action.id)!,
      ),
    ).toBe(true);
    expect(
      (await inspectNativeSdkCheckExecutions({ projectRoot: root, run, includeSettled: true }))[0]
        .execution,
    ).toEqual(execution);
    expect((await recoverNativeSdkChecks(root, run, cold)).revision).toBe(run.revision);
    await expect(
      cold.retry({ runId: run.runId, actionId: action.id, attempt: action.attempt }),
    ).rejects.toMatchObject({ code: 'ACTION_ALREADY_ADVANCED' });
    const wait = run.waits.at(-1)!;
    run = await cold.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'approve-changed-candidate-repair',
      choice: 'repair',
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });
    run = await succeedLatestAction(
      cold,
      run,
      {
        summary: 'Review the changed implementation and submit a fresh candidate.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        submittedAt: new Date().toISOString(),
        verificationChecks: [
          {
            id: 'fresh',
            name: 'Fresh check',
            executable: process.execPath,
            argv: ['-e', "process.stdout.write('fresh candidate checked')"],
            cwdRef: '.',
            timeoutMs: 5000,
            repeatable: true,
          },
        ],
      },
      root,
      'drift-fresh-candidate',
      'drift-fresh-builder',
    );
    expect((run.state as NativePortableState).builder_handoff!.candidate_id).not.toBe(
      (original.output as { candidateId: string }).candidateId,
    );
    run = await cold.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { projectRoot: root, requestId: 'drift-fresh-check' },
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    expect(run.actions.find((entry) => entry.id === action.id)).toEqual(repaired);
    expect(await fs.readFile(counter, 'utf8')).toBe('once\n');
  });

  it('reconciles an actual dead check owner into a stopped repair and completes a fresh candidate', async () => {
    const controlRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-fresh-check-control-'));
    roots.push(controlRoot);
    const freshChecked = path.join(controlRoot, 'fresh-checked');
    const {
      root,
      runtime,
      run: ready,
    } = await dispatchedVerifier(
      [
        {
          id: 'first',
          name: 'Completed once',
          executable: process.execPath,
          argv: [
            '-e',
            "require('node:fs').appendFileSync('original-count', 'once\\n'); process.stdout.write('first-receipt')",
          ],
          cwdRef: '.',
          timeoutMs: 5000,
          repeatable: false,
        },
        {
          id: 'second',
          name: 'Unknown after owner exit',
          executable: process.execPath,
          argv: [
            '-e',
            "const fs=require('node:fs'); fs.writeFileSync('owner-started','yes'); process.stdout.write('partial-output'); setTimeout(()=>fs.writeFileSync('late-effect','bad'),20000); setTimeout(()=>process.exit(0),30000)",
          ],
          cwdRef: '.',
          timeoutMs: 10000,
          repeatable: false,
        },
      ],
      'sdk',
      nativeApplication(),
      false,
    );
    const action = ready.actions.at(-1)!;
    const ownerModule = pathToFileURL(
      path.resolve('domains/comet-native/native-runtime-ownership.ts'),
    ).href;
    const owner = spawn(
      process.execPath,
      [
        '--import',
        pathToFileURL(path.resolve('test/helpers/native-source-loader.mjs')).href,
        '--input-type=module',
        '-e',
        `import {loadOwnedNativeSdkRuntime} from ${JSON.stringify(ownerModule)}; const {runtime}=await loadOwnedNativeSdkRuntime(${JSON.stringify(root)},'sdk-shape'); await runtime.execute({runId:'sdk-shape',actionId:${JSON.stringify(action.id)},executorId:'comet-native-checks',context:{projectRoot:${JSON.stringify(root)},requestId:'real-owner'}});`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    owner.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    try {
      await waitForCondition(
        () =>
          fs.access(path.join(root, 'owner-started')).then(
            () => true,
            () => false,
          ),
        'owner check did not start',
        // 先为完整源码冷加载预留启动时间，不改变检查自身的时限。
        30000,
      );
      owner.kill('SIGTERM');
      await waitForProcessExit(owner);
      await waitForCondition(async () => {
        const inspection = (
          await inspectNativeSdkCheckExecutions({
            projectRoot: root,
            run: await runtime.inspect(ready.runId),
          })
        )[0];
        // owner 被终止后没有 Windows 整树收据；退出的组长仍需下方人工停止证明。
        return process.platform === 'win32'
          ? inspection?.owner === 'dead' && inspection.process === 'dead' && !inspection.quiescent
          : inspection?.quiescent === true;
      }, 'original process boundary did not stop');
      const diagnostic = await nativeDoctorCommand(['sdk-shape'], root);
      expect(diagnostic).toMatchObject({ exitCode: 65, data: { healthy: false } });
      expect((await runtime.inspect(ready.runId)).actions.at(-1)?.status).toBe('running');
      await nativeDoctorCommand(['sdk-shape', '--repair'], root);
      const unknown = await runtime.inspect(ready.runId);
      const original = unknown.actions.find((entry) => entry.id === action.id)!;
      expect(original.status).toBe('unknown');
      expect(unknown.waits.some((wait) => wait.stepId === 'verify.checks-stop')).toBe(false);
      const stoppedFile = path.join(root, 'stopped-checks.json');
      await fs.writeFile(
        stoppedFile,
        JSON.stringify([
          {
            actionId: original.id,
            attempt: original.attempt,
            inputHash: original.inputHash,
            claimToken: original.claim!.token,
            evidence:
              'Observed the original process group stopped. This fixture command created no detached descendants; its original execution and all child tasks have stopped.',
          },
        ]),
      );
      await expect(
        nativeDoctorCommand(['sdk-shape', '--repair', '--stopped-actions', stoppedFile], root),
      ).rejects.toThrow(/confirmed/u);
      await nativeDoctorCommand(
        ['sdk-shape', '--repair', '--confirmed', '--stopped-actions', stoppedFile],
        root,
      );
      let run = await runtime.inspect(ready.runId);
      const interruptedAction = run.actions.find((entry) => entry.id === action.id)!;
      expect(interruptedAction).toMatchObject({
        status: 'failed',
        attempt: 1,
        outcome: {
          output: {
            checks: [{ id: 'first', status: 'passed' }],
            interruption: {
              kind: 'execution-unknown',
              unknownCheckIds: ['second'],
              partialLogs: [
                { logRef: expect.stringContaining('-second.log'), logSha256: expect.any(String) },
              ],
            },
          },
        },
      });
      expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.checks-stop', status: 'pending' });
      expect(run.state).toMatchObject({ phase: 'verify', status: 'await-user' });
      const checkpoint = createPortableRunCheckpoint(run);
      expect(JSON.stringify(checkpoint)).not.toContain(original.claim!.token);
      const portable = readPortableRunCheckpoint(checkpoint, run.runId)!;
      const restoredStore = createMemoryRuntimeStore<WorkflowRun>();
      await restoredStore.compareAndSwap(portable.runId, null, portable);
      const application = nativeApplication();
      const restoredRuntime = createRuntime({
        store: restoredStore,
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        validators: application.validators,
        stateValidators: application.stateValidators,
        commandValidators: application.commandValidators,
        executors: application.executors,
      });
      const portableWait = portable.waits.at(-1)!;
      const restoredRepair = await restoredRuntime.resolveWait({
        runId: portable.runId,
        waitId: portableWait.id,
        proposalHash: portableWait.proposalHash,
        decisionId: 'portable-explicit-repair',
        choice: 'repair',
      });
      expect(restoredRepair.actions.at(-1)).toMatchObject({
        stepId: 'build.builder',
        status: 'pending',
      });
      await nativeDoctorCommand(['sdk-shape', '--repair'], root);
      expect((await runtime.inspect(run.runId)).revision).toBe(run.revision);
      await expect(
        runtime.retry({ runId: run.runId, actionId: action.id, attempt: 1 }),
      ).rejects.toMatchObject({ code: 'ACTION_ALREADY_ADVANCED' });
      const wait = run.waits.at(-1)!;
      await advanceNativeSdkChange(root, 'sdk-shape', {
        expectedAction: 'revise-implementation',
        expectedStateVersion: (run.state as NativePortableState).state_version,
        proposalHash: wait.proposalHash,
        summary: 'Reviewed retained output and possible effects; repair with a new candidate.',
      });
      run = await runtime.inspect(run.runId);
      run = await succeedLatestAction(
        runtime,
        run,
        {
          summary: 'Fresh repaired candidate.',
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [],
          submittedAt: new Date().toISOString(),
          verificationChecks: [
            {
              id: 'fresh',
              name: 'Fresh check',
              executable: process.execPath,
              argv: ['-e', "require('node:fs').writeFileSync(process.argv[1],'yes')", freshChecked],
              cwdRef: '.',
              timeoutMs: 5000,
              repeatable: true,
            },
          ],
        },
        root,
        'fresh-candidate',
        'fresh-builder',
      );
      const candidate = (run.state as NativePortableState).builder_handoff!.candidate_id;
      expect(candidate).not.toBe(
        (interruptedAction.outcome!.output as { candidateId: string }).candidateId,
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { projectRoot: root, requestId: 'fresh-check' },
      });
      expect(run.outputs['verify.checks'].value).toMatchObject({
        candidateId: candidate,
        checks: [{ id: 'fresh', status: 'passed' }],
      });
      const state = run.state as NativePortableState;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId: candidate,
          verifierExecutionRef: 'fresh-verifier',
          response: {
            kind: 'final-result',
            result: {
              iteration: state.loop.iteration,
              attempt: state.loop.attempt,
              verdict: 'pass',
              acceptance: [
                { id: 'A1', result: 'passed', reason: 'Verified the repaired candidate.' },
              ],
              risks: [],
              summary: 'Fresh candidate accepted.',
            },
          },
        },
        root,
        'fresh-verified',
        'fresh-verifier',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report',
        context: { projectRoot: root, requestId: 'fresh-report' },
      });
      const approval = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: approval.id,
        proposalHash: approval.proposalHash,
        decisionId: 'fresh-approval',
        choice: 'approved',
      });
      for (const executorId of [
        'comet-native-report-revalidate',
        'comet-native-archive-preflight',
        'comet-native-archive-apply',
        'comet-native-archive-finalize',
      ])
        run = await runtime.execute({
          runId: run.runId,
          actionId: run.actions.at(-1)!.id,
          executorId,
          context: { projectRoot: root, requestId: executorId },
        });
      expect(run).toMatchObject({ status: 'completed', state: { archived: true, status: 'done' } });
      expect(run.actions.find((entry) => entry.id === action.id)).toEqual(interruptedAction);
      expect(await fs.readFile(path.join(root, 'original-count'), 'utf8')).toBe('once\n');
      await expect(fs.access(path.join(root, 'late-effect'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await fs.readFile(freshChecked, 'utf8')).toBe('yes');
    } catch (error) {
      throw new Error(`${(error as Error).message}\nOwner stderr: ${stderr}`, { cause: error });
    } finally {
      owner.kill('SIGKILL');
      await waitForProcessExit(owner);
    }
  });

  it.each([false, true])(
    'recovers a real reserved-before-child owner exit without replay (cancel=%s)',
    async (cancel) => {
      const plan = {
        id: 'reserved',
        name: 'Reserved check',
        executable: process.execPath,
        argv: ['-e', "require('node:fs').writeFileSync('reserved-side-effect', 'executed')"],
        cwdRef: '.',
        timeoutMs: 5000,
        repeatable: false,
      };
      const {
        root,
        runtime,
        run: ready,
      } = await dispatchedVerifier([plan], 'sdk', nativeApplication(), false);
      const pending = ready.actions.at(-1)!;
      let run = await runtime.claim({
        runId: ready.runId,
        actionId: pending.id,
        attempt: pending.attempt,
        inputHash: pending.inputHash,
        executorId: 'comet-native-checks',
        claimToken: 'reserved-original-claim',

        context: { projectRoot: root, requestId: 'native-check-claim-5644' },
      });
      const action = run.actions.at(-1)!;
      const bundle = path.join(root, 'reserve-owner.cjs');
      const payload = path.join(root, 'reserve-owner.json');
      await fs.writeFile(
        payload,
        JSON.stringify({
          projectRoot: root,
          run,
          action,
          candidateId: (run.state as NativePortableState).builder_handoff!.candidate_id,
          plansHash: hashRuntimeValue(
            nativeSdkChecks.nativeSdkCheckPlans({ verificationChecks: [plan] }),
          ),
        }),
      );
      await build({
        stdin: {
          contents: `const { createNativeSdkCheckExecution } = require('./domains/comet-native/native-sdk-check-execution.ts'); createNativeSdkCheckExecution(JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'))).then(() => process.exit(0));`,
          resolveDir: process.cwd(),
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: bundle,
        logLevel: 'silent',
      });
      execFileSync(process.execPath, [bundle, payload], { env: process.env });
      await fs.rm(bundle);
      await fs.rm(payload);
      expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0]).toMatchObject({
        owner: 'dead',
        process: 'unknown',
        phase: 'reserved',
        quiescent: false,
      });
      const cold = (await loadOwnedNativeSdkRuntime(root, run.runId)).runtime;
      run = await recoverNativeSdkChecks(root, await cold.inspect(run.runId), cold);
      expect(run.actions.find((entry) => entry.id === action.id)?.status).toBe('unknown');
      if (cancel) run = await cold.cancel({ runId: run.runId, reason: 'Stop reserved execution' });
      if (cancel) {
        const waiting = await inspectNativeSdkCancellation({ projectRoot: root, run });
        expect(waiting?.outstandingActions[0].acknowledgementRequest).toMatchObject({
          operation: 'doctor',
          commandArgs: [
            'comet',
            'native',
            'doctor',
            run.runId,
            '--repair',
            '--confirmed',
            '--stopped-actions',
            '<path-to-stopped-actions-json>',
          ],
          stoppedActions: [{ actionId: action.id, claimToken: action.claim!.token }],
        });
      }
      const options = {
        reconcileInterrupted: true,
        stoppedActions: [
          {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: action.claim!.token,
            evidence:
              'The synchronous parent observed the original reservation owner exit before it launched any child. No command or descendant was started.',
          },
        ],
      };
      run = await recoverNativeSdkChecks(root, run, cold, options);
      const recovered = run.actions.find((entry) => entry.id === action.id)!;
      expect(recovered).toMatchObject({
        status: cancel ? 'cancelled' : 'failed',
        attempt: action.attempt,
        claim: action.claim,
      });
      if (cancel) {
        expect(await inspectNativeSdkCancellation({ projectRoot: root, run })).toMatchObject({
          status: 'cancelled',
          quiescent: true,
        });
        expect(recovered.outcome).toBeUndefined();
      } else {
        expect(recovered.outcome?.output).toMatchObject({
          checks: [],
          interruption: { unknownCheckIds: ['reserved'] },
        });
        expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.checks-stop', status: 'pending' });
      }
      const again = await recoverNativeSdkChecks(root, run, cold, options);
      expect(again.actions.find((entry) => entry.id === action.id)?.outcome).toEqual(
        recovered.outcome,
      );
      expect(
        (
          await inspectNativeSdkCheckExecutions({
            projectRoot: root,
            run: again,
            includeSettled: true,
          })
        )[0],
      ).toMatchObject({ quiescent: true });
      await expect(fs.access(path.join(root, 'reserved-side-effect'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('reconciles a legacy unregistered execution only with original-host stop evidence and keeps every result unknown', async () => {
    const plan = {
      id: 'legacy',
      name: 'Legacy check',
      executable: process.execPath,
      argv: ['-e', "require('node:fs').appendFileSync('legacy-side-effect', 'executed\\n')"],
      cwdRef: '.',
      timeoutMs: 5000,
      repeatable: false,
    };
    const {
      root,
      runtime,
      run: ready,
    } = await dispatchedVerifier([plan], 'sdk', nativeApplication(), false);
    const pending = ready.actions.at(-1)!;
    const run = await runtime.claim({
      runId: ready.runId,
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      executorId: 'comet-native-checks',
      claimToken: 'legacy-original-claim',

      context: { projectRoot: root, requestId: 'native-check-claim-5776' },
    });
    const action = run.actions.at(-1)!;
    // 旧执行器的真实路径：领取后运行命令，退出前未持久登记进程或提交结果。
    execFileSync(plan.executable, plan.argv, { cwd: root, stdio: 'ignore' });
    expect((await inspectNativeSdkCheckExecutions({ projectRoot: root, run }))[0].phase).toBe(
      'missing',
    );
    const unknown = await recoverNativeSdkChecks(root, run, runtime);
    expect(unknown.actions.at(-1)?.status).toBe('unknown');
    const recovered = await recoverNativeSdkChecks(root, unknown, runtime, {
      reconcileInterrupted: true,
      stoppedActions: [
        {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: action.claim!.token,
          evidence:
            'Observed the original Node command exit; it started no child processes. Its file side effect remains and is not treated as undone.',
        },
      ],
    });
    expect(recovered.actions.find((entry) => entry.id === action.id)).toMatchObject({
      status: 'failed',
      outcome: {
        output: {
          checks: [],
          interruption: {
            executionHash: null,
            processBoundary: 'unknown',
            unknownCheckIds: ['legacy'],
          },
        },
      },
    });
    expect(recovered.waits.at(-1)).toMatchObject({
      stepId: 'verify.checks-stop',
      status: 'pending',
    });
    expect(await fs.readFile(path.join(root, 'legacy-side-effect'), 'utf8')).toBe('executed\n');
  });

  it('rejects legacy interruption reconciliation if a late process registration appears before commit', async () => {
    const {
      root,
      runtime,
      run: ready,
    } = await dispatchedVerifier([], 'sdk', nativeApplication(), false);
    const pending = ready.actions.at(-1)!;
    const run = await runtime.claim({
      runId: ready.runId,
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      executorId: 'comet-native-checks',
      claimToken: 'registration-race-claim',

      context: { projectRoot: root, requestId: 'native-check-claim-5832' },
    });
    const action = run.actions.at(-1)!;
    let registration: Awaited<ReturnType<typeof createNativeSdkCheckExecution>> | undefined;
    const racingRuntime = {
      ...runtime,
      recordOutcome: async (...args: Parameters<typeof runtime.recordOutcome>) => {
        registration = await createNativeSdkCheckExecution({
          projectRoot: root,
          run,
          action,
          candidateId: (run.state as NativePortableState).builder_handoff!.candidate_id,
          plansHash: 'late-owner',
        });
        return runtime.recordOutcome(...args);
      },
    };
    await expect(
      recoverNativeSdkChecks(root, run, racingRuntime, {
        reconcileInterrupted: true,
        stoppedActions: [
          {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: action.claim!.token,
            evidence:
              'The original host reported that all execution stopped; registry must still be rechecked at commit.',
          },
        ],
      }),
    ).rejects.toThrow(/OUTCOME_REJECTED/u);
    expect(
      (await runtime.inspect(run.runId)).waits.some((wait) => wait.stepId === 'verify.checks-stop'),
    ).toBe(false);
    await expect(registration!.assertNotStopped()).rejects.toThrow(/取消/u);
  });

  it.each(['missing', 'complete'] as const)(
    'reconciles %s check receipts under the fixed old definition before upgrading it',
    async (receipt) => {
      const plan = {
        id: 'old-check',
        name: 'Old interrupted check',
        executable: process.execPath,
        argv: [
          '-e',
          "require('node:fs').appendFileSync('old-check-count', 'once\\n'); setTimeout(() => {}, 60000)",
        ],
        cwdRef: '.',
        timeoutMs: 10000,
        repeatable: false,
      };
      const {
        root,
        runtime,
        run: ready,
      } = await dispatchedVerifier([plan], 'sdk', preCheckRecoveryApplication(), false);
      const pending = ready.actions.at(-1)!;
      const run = await runtime.claim({
        runId: ready.runId,
        actionId: pending.id,
        attempt: pending.attempt,
        inputHash: pending.inputHash,
        executorId: 'comet-native-checks',
        claimToken: `old-${receipt}-claim`,

        context: { projectRoot: root, requestId: 'native-check-claim-5897' },
      });
      const action = run.actions.at(-1)!;
      if (receipt === 'complete') {
        const result = await nativeSdkCheckExecutor.execute(
          action,
          { projectRoot: root, requestId: 'old-complete-unsubmitted' },
          run,
        );
        expect(result).toMatchObject({
          status: 'failed',
          output: { checks: [{ status: 'interrupted' }] },
        });
      } else {
        expect(() =>
          execFileSync(
            plan.executable,
            [
              '-e',
              "require('node:fs').appendFileSync('old-check-count', 'once\\n'); process.exit(7)",
            ],
            { cwd: root, stdio: 'ignore' },
          ),
        ).toThrow();
        const ordinary = await nativeDoctorCommand(['sdk-shape', '--repair'], root);
        expect(ordinary.exitCode).toBe(65);
        const unchanged = await runtime.inspect(run.runId);
        expect(unchanged.workflow).toEqual(run.workflow);
        expect(unchanged.actions.at(-1)?.status).toBe('unknown');
      }
      const stopped = path.join(root, 'old-stopped-actions.json');
      await fs.writeFile(
        stopped,
        JSON.stringify([
          {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: action.claim!.token,
            evidence:
              'The original self-terminating Node process exited and created no descendants; its one file write remains preserved.',
          },
        ]),
      );
      const repaired = await nativeDoctorCommand(
        ['sdk-shape', '--repair', '--confirmed', '--stopped-actions', stopped],
        root,
      );
      expect(repaired.exitCode, JSON.stringify(repaired)).toBe(0);
      const loaded = await loadOwnedNativeSdkRuntime(root, 'sdk-shape');
      let current = await loaded.runtime.inspect(run.runId);
      expect(current.workflow.hash).not.toBe(run.workflow.hash);
      expect(current.actions.find((entry) => entry.id === action.id)).toMatchObject({
        status: 'failed',
        attempt: 1,
        claim: action.claim,
      });
      expect(current.ready).toMatchObject([{ from: 'verify.checks', to: 'verify.checks-stop' }]);
      expect(await fs.readFile(path.join(root, 'old-check-count'), 'utf8')).toBe('once\n');
      await nativeDoctorCommand(['sdk-shape', '--repair'], root);
      expect((await loaded.runtime.inspect(run.runId)).revision).toBe(current.revision);
      const continued = await advanceNativeSdkChange(root, 'sdk-shape');
      expect(continued).toMatchObject({
        exitCode: 0,
        data: { continuation: { disposition: 'await-user', requiresUserDecision: true } },
      });
      current = await loaded.runtime.inspect(run.runId);
      expect(current.waits.at(-1)).toMatchObject({
        stepId: 'verify.checks-stop',
        status: 'pending',
      });
    },
  );

  it('keeps an interrupted Runtime check stopped until a proposal-bound repair decision', async () => {
    const { root, runtime, run } = await dispatchedVerifier(
      [
        {
          id: 'interrupted',
          name: 'Interrupted check',
          executable: process.execPath,
          argv: ['-e', 'setTimeout(() => {}, 60000)'],
          cwdRef: '.',
          timeoutMs: 10000,
          repeatable: false,
        },
      ],
      'sdk',
    );
    const failedCheck = run.actions.at(-1)!;
    expect(failedCheck).toMatchObject({
      stepId: 'verify.checks',
      status: 'failed',
      outcome: {
        output: { checks: [{ status: 'interrupted' }] },
      },
    });
    const interruptedExit = (
      failedCheck.outcome!.output as { checks: Array<{ exitCode: number | null }> }
    ).checks[0].exitCode;
    // Windows 的进程树终止返回退出码；POSIX 信号终止通常返回 null。
    expect(
      interruptedExit === null || (Number.isInteger(interruptedExit) && interruptedExit !== 0),
    ).toBe(true);
    const stopped = await advanceNativeSdkChange(root, 'sdk-shape');
    expect(stopped.exitCode).toBe(0);
    expect(stopped.data).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      run: { revision: run.revision + 1, status: 'waiting' },
      continuation: { disposition: 'await-user', requiresUserDecision: true },
    });
    const stoppedRun = await runtime.inspect(run.runId);
    expect(
      stoppedRun.actions.find((entry) => entry.id === failedCheck.id)?.executionStop,
    ).toBeDefined();
    expect(stoppedRun.actions.find((entry) => entry.id === failedCheck.id)?.outcome).toEqual(
      failedCheck.outcome,
    );
    const wait = run.waits.at(-1)!;
    expect(wait).toMatchObject({ stepId: 'verify.checks-stop', status: 'pending' });
    const rejected = await advanceNativeSdkChange(root, 'sdk-shape', {
      expectedAction: 'revise-implementation',
      expectedStateVersion: (run.state as NativePortableState).state_version,
      proposalHash: '0'.repeat(64),
      summary: 'Try a safe repair.',
    });
    expect(rejected.exitCode).toBe(73);
    expect(await runtime.inspect(run.runId)).toEqual(stoppedRun);
    const repaired = await advanceNativeSdkChange(root, 'sdk-shape', {
      expectedAction: 'revise-implementation',
      expectedStateVersion: (run.state as NativePortableState).state_version,
      proposalHash: wait.proposalHash,
      summary: 'Try a safe repair.',
    });
    expect(repaired.exitCode).toBe(0);
    expect(repaired.data).toMatchObject({
      phase: 'build',
      pendingAction: { stepId: 'build.builder' },
    });
    expect(
      (await runtime.inspect(run.runId)).actions.find((action) => action.id === failedCheck.id),
    ).toEqual(stoppedRun.actions.find((entry) => entry.id === failedCheck.id));
  });

  it.each(['memory', 'sdk'] as const)(
    'requires user confirmation before Archiving an independently verified Skill-coordinated pass (%s)',
    async (storeKind) => {
      const {
        root,
        paths,
        changeDir,
        runtime,
        run: ready,
      } = await dispatchedVerifier([], storeKind);
      let run = ready;
      if (storeKind === 'sdk') {
        expect((await advanceNativeSdkChange(root, run.runId)).exitCode).toBe(0);
        run = await runtime.inspect(run.runId);
      }
      const candidateId = (run.state as NativePortableState).builder_handoff!.candidate_id;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId,
          verifierExecutionRef: 'verifier-session-1',
          response: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'pass',
              acceptance: [
                { id: 'A1', result: 'passed', reason: 'Verified the selected workflow.' },
              ],
              risks: [],
              summary: 'All acceptance scenarios passed.',
            },
          },
        },
        root,
        'verifier-result',
        'verifier-session-1',
      );
      expect(run.state).toMatchObject({
        phase: 'verify',
        status: 'await-user',
        verification_result: 'pass',
        verification: {
          assurance: 'skill-coordinated',
          verifier_execution_ref: 'verifier-session-1',
          verdict: 'pass',
        },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'verify.report',
        type: 'call_tool',
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report',
        context: { requestId: 'native-report', projectRoot: root },
      });
      expect(await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8')).toContain(
        'All acceptance scenarios passed.',
      );
      expect(run.waits.at(-1)).toMatchObject({
        stepId: 'verify.confirm',
        status: 'pending',
      });
      const approvedReport = await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8');
      const approvedReportHash = createHash('sha256').update(approvedReport).digest('hex');
      const approvedReportStateVersion = (run.state as NativePortableState).state_version;
      expect(run.outputs['verify.report'].value).toMatchObject({
        reportSha256: approvedReportHash,
        stateVersion: approvedReportStateVersion,
      });
      const confirmation = run.waits.at(-1)!;
      expect(confirmation.proposal).toMatchObject({
        outputs: { 'verify.report': { reportSha256: approvedReportHash } },
      });
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: confirmation.id,
        proposalHash: confirmation.proposalHash,
        decisionId: 'verification-approved',
        choice: 'approved',
      });
      expect(run.state).toMatchObject({ phase: 'verify', status: 'await-user' });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'verify.revalidate',
        type: 'call_tool',
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report-revalidate',
        context: { requestId: 'native-report-revalidate', projectRoot: root },
      });
      expect(run.state).toMatchObject({ phase: 'archive', status: 'active' });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', type: 'call_tool' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-preflight',
        context: { requestId: 'native-archive-preflight', projectRoot: root },
      });
      expect(run.outputs['archive.prepare'].value).toMatchObject({
        ready: true,
        reportSha256: approvedReportHash,
        reportStateVersion: approvedReportStateVersion,
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.execute', type: 'call_tool' });
      // 预检保持用户确认的报告不变，最终报告在 committed done state 后生成。
      expect((run.state as NativePortableState).state_version).toBeGreaterThan(
        approvedReportStateVersion,
      );
      expect(await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8')).toBe(
        approvedReport,
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-apply',
        context: { requestId: 'native-archive-apply', projectRoot: root },
      });
      expect(run.state).toMatchObject({ phase: 'archive', status: 'done', archived: true });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.finalize', type: 'call_tool' });
      expect(await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8')).toBe(
        approvedReport,
      );
      expect(run.waits.find((wait) => wait.id === confirmation.id)).toMatchObject({
        status: 'resolved',
        proposalHash: confirmation.proposalHash,
        proposal: { outputs: { 'verify.report': { reportSha256: approvedReportHash } } },
        decision: { choice: 'approved' },
      });
      expect(await fs.readFile(path.join(paths.specsDir, 'workflow', 'spec.md'), 'utf8')).toContain(
        'The selected workflow resumes without losing confirmed work.',
      );
      const archiveRef = (run.outputs['archive.execute'].value as { archiveRef: string })
        .archiveRef;
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-finalize',
        context: { requestId: 'native-archive-finalize', projectRoot: root },
      });
      expect(run.status).toBe('completed');
      expect(await fs.stat(path.join(paths.archiveDir, archiveRef))).toBeDefined();
      await expect(fs.stat(changeDir)).rejects.toMatchObject({ code: 'ENOENT' });
      const finalReport = await fs.readFile(
        path.join(paths.archiveDir, archiveRef, 'verification.md'),
        'utf8',
      );
      expect(finalReport).toContain(
        `generated_from_state_version: ${(run.state as NativePortableState).state_version}`,
      );
      const finalReceipt = await inspectNativeSdkArchiveFinalization({
        paths,
        state: run.state as NativePortableState,
        runId: run.runId,
        archiveRef,
      });
      expect(finalReceipt).toMatchObject({
        stateVersion: (run.state as NativePortableState).state_version,
        reportSha256: createHash('sha256').update(finalReport).digest('hex'),
      });
      expect(run.outputs['archive.finalize'].value).toEqual(finalReceipt);
      if (storeKind === 'sdk') {
        const fileStore = createFileRuntimeStore<WorkflowRun>({
          rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'),
        });
        expect(await fileStore.readDisposition(run.runId)).toBe('closed');
        expect((await nativeDoctorCommand([run.runId], root)).exitCode).toBe(0);
        const target = await fs.mkdtemp(path.join(os.tmpdir(), 'native-archive-other-device-'));
        const data = await fs.mkdtemp(path.join(os.tmpdir(), 'native-archive-other-home-'));
        roots.push(target, data);
        execFileSync('git', ['init', '-b', 'main'], { cwd: target, stdio: 'ignore' });
        await fs.cp(path.join(root, 'docs'), path.join(target, 'docs'), { recursive: true });
        await fs.mkdir(path.join(target, '.comet'));
        await fs.copyFile(
          path.join(root, '.comet/config.yaml'),
          path.join(target, '.comet/config.yaml'),
        );
        const previousData = process.env.COMET_DATA_DIR;
        process.env.COMET_DATA_DIR = data;
        try {
          const restoredStore = createFileRuntimeStore<WorkflowRun>({
            rootDir: path.join(resolveWorkspaceRuntimeRootSync(target), 'sdk-runs/native'),
          });
          expect(await restoredStore.read(run.runId)).toBeNull();
          expect((await nativeDoctorCommand([run.runId], target)).exitCode).not.toBe(0);
          expect(await restoredStore.read(run.runId)).toBeNull();
          const recovered = await nativeDoctorCommand(
            [run.runId, '--repair', '--confirmed'],
            target,
          );
          expect(recovered.exitCode, JSON.stringify(recovered)).toBe(0);
          expect((await restoredStore.read(run.runId))!.status).toBe('completed');
          expect((await restoredStore.read(run.runId))!.revision).toBe(run.revision);
          expect((await restoredStore.read(run.runId))!.actions).toEqual(
            readPortableRunCheckpoint(createPortableRunCheckpoint(run), run.runId, {
              preserveSourceRevision: true,
            })!.actions,
          );
          expect(await restoredStore.readDisposition(run.runId)).toBe('active');
          const sealed = await nativeDoctorCommand([run.runId, '--migrate-history'], target);
          expect(sealed.exitCode, JSON.stringify(sealed)).toBe(0);
          expect(sealed.data).toMatchObject({ migrated: [run.runId], active: [], findings: [] });
          // 新设备使用已持久化且绑定原领取的停止事实，不依赖缺失的本机 PID。
          expect(await restoredStore.readDisposition(run.runId)).toBe('closed');
          const continued = await advanceNativeSdkChange(target, run.runId);
          expect(continued.exitCode, JSON.stringify(continued)).toBe(0);
          expect((await restoredStore.read(run.runId))!.status).toBe('completed');
          expect((await restoredStore.read(run.runId))!.revision).toBe(run.revision);
          const newChange = JSON.parse(
            (
              await runNativeCli([
                'new',
                'after-restored-archive',
                '--isolation',
                'current',
                '--project-root',
                target,
                '--json',
              ])
            ).stdout!,
          );
          expect(newChange.exitCode, JSON.stringify(newChange)).toBe(0);
          expect((await restoredStore.read('after-restored-archive'))!.status).not.toBe(
            'completed',
          );

          expect((await restoredStore.read(run.runId))!.actions).toEqual(
            readPortableRunCheckpoint(createPortableRunCheckpoint(run), run.runId, {
              preserveSourceRevision: true,
            })!.actions,
          );
        } finally {
          if (previousData === undefined) delete process.env.COMET_DATA_DIR;
          else process.env.COMET_DATA_DIR = previousData;
        }
        // 模拟旧终态布局后，迁移必须校验保存的 receipt；后续合法 Spec 更新不影响历史。
        await recoverSdkChangeOwnerToActive(root, 'native', run.runId);
        expect(await fileStore.reopenRun(run.runId, run.revision)).toBe(true);
        const receiptFile = path.join(
          paths.runtimeDir,
          'sdk-archive-receipts',
          `${createHash('sha256').update(run.runId).digest('hex')}.json`,
        );
        const receiptSource = await fs.readFile(receiptFile, 'utf8');
        await fs.writeFile(
          receiptFile,
          JSON.stringify({ ...finalReceipt, transactionId: 'changed-receipt' }),
        );
        expect(
          (await nativeDoctorCommand([run.runId, '--migrate-history'], root)).exitCode,
        ).not.toBe(0);
        expect(await fileStore.readDisposition(run.runId)).toBe('active');
        await fs.writeFile(receiptFile, receiptSource);
        await fs.writeFile(
          path.join(paths.specsDir, 'workflow', 'spec.md'),
          '# Workflow\nA later change updated this capability.\n',
        );
        const migration = await nativeDoctorCommand([run.runId, '--migrate-history'], root);
        expect(migration.exitCode, JSON.stringify(migration)).toBe(0);
        expect(await fileStore.readDisposition(run.runId)).toBe('closed');
      }
    },
  );

  it('recovers a completed Archive move after restart without executing it again', async () => {
    const {
      root,
      paths,
      application,
      runtime,
      run: pending,
    } = await awaitingArchiveFinalization('file');
    const action = pending.actions.at(-1)!;
    const context = { requestId: 'archive-crash', projectRoot: root };
    const claimed = await runtime.claim({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-native-archive-finalize',
      claimToken: 'archive-finalize-owner',
      context,
    });
    const executor = application.executors.find(
      (entry) => entry.id === 'comet-native-archive-finalize',
    )!;
    await executor.execute(claimed.actions.at(-1)!, context, claimed);
    await runtime.markUnknown({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Host stopped after the Archive move',
    });
    const restarted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs'),
      }),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
      executors: application.executors,
    });
    const recover = (nativeDomain as Record<string, unknown>).recoverNativeSdkArchiveOutcome;
    expect(recover).toBeTypeOf('function');
    const recovered = await (
      recover as (options: {
        runtime: typeof restarted;
        runId: string;
        projectRoot: string;
      }) => Promise<WorkflowRun>
    )({
      runtime: restarted,
      runId: pending.runId,
      projectRoot: root,
    });
    expect(recovered.status).toBe('completed');
    expect(recovered.actions.at(-1)).toMatchObject({
      stepId: 'archive.finalize',
      status: 'succeeded',
    });
    const archiveRef = (recovered.outputs['archive.execute'].value as { archiveRef: string })
      .archiveRef;
    expect(await fs.stat(path.join(paths.archiveDir, archiveRef))).toBeDefined();
  });

  it('recovers applied Archive Specs after restart without creating another transaction', async () => {
    const {
      root,
      paths,
      application,
      runtime,
      run: pending,
    } = await awaitingArchiveApplication('file');
    const action = pending.actions.at(-1)!;
    const context = { requestId: 'archive-apply-crash', projectRoot: root };
    const claimed = await runtime.claim({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-native-archive-apply',
      claimToken: 'archive-apply-owner',
      context,
    });
    const executor = application.executors.find(
      (entry) => entry.id === 'comet-native-archive-apply',
    )!;
    const executed = await executor.execute(claimed.actions.at(-1)!, context, claimed);
    await runtime.markUnknown({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Host stopped after applying canonical Specs',
    });
    const restarted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs'),
      }),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
      executors: application.executors,
    });
    const recover = (nativeDomain as Record<string, unknown>)
      .recoverNativeSdkArchiveOutcome as (options: {
      runtime: typeof restarted;
      runId: string;
      projectRoot: string;
    }) => Promise<WorkflowRun>;
    const recovered = await recover({
      runtime: restarted,
      runId: pending.runId,
      projectRoot: root,
    });
    expect(recovered.actions.at(-1)).toMatchObject({
      stepId: 'archive.finalize',
      status: 'pending',
    });
    expect(recovered.outputs['archive.execute'].value).toEqual(executed.output);
    expect(await fs.readFile(path.join(paths.specsDir, 'workflow', 'spec.md'), 'utf8')).toContain(
      'The selected workflow resumes without losing confirmed work.',
    );
  });

  it('resumes the same frozen Archive transaction when its Spec progress write was lost', async () => {
    const {
      root,
      paths,
      application,
      runtime,
      run: pending,
    } = await awaitingArchiveApplication('file');
    const action = pending.actions.at(-1)!;
    const context = { requestId: 'archive-partial-crash', projectRoot: root };
    const claimed = await runtime.claim({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-native-archive-apply',
      claimToken: 'archive-partial-owner',
      context,
    });
    const executor = application.executors.find(
      (entry) => entry.id === 'comet-native-archive-apply',
    )!;
    const completed = await executor.execute(claimed.actions.at(-1)!, context, claimed);
    const [journalName] = (await fs.readdir(paths.transactionsDir)).filter((name) =>
      name.startsWith('portable-archive-'),
    );
    const journalFile = path.join(paths.transactionsDir, journalName);
    const journal = JSON.parse(await fs.readFile(journalFile, 'utf8')) as Record<string, unknown>;
    await fs.writeFile(
      journalFile,
      JSON.stringify({ ...journal, status: 'prepared', next_spec_index: 0 }),
    );
    await runtime.markUnknown({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Host stopped before journaling the applied Spec',
    });
    const restarted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs'),
      }),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
      executors: application.executors,
    });
    const recover = (nativeDomain as Record<string, unknown>)
      .recoverNativeSdkArchiveOutcome as (options: {
      runtime: typeof restarted;
      runId: string;
      projectRoot: string;
    }) => Promise<WorkflowRun>;
    const recovered = await recover({
      runtime: restarted,
      runId: pending.runId,
      projectRoot: root,
    });
    expect(recovered.outputs['archive.execute'].value).toEqual(completed.output);
    expect(recovered.actions.at(-1)).toMatchObject({ stepId: 'archive.finalize' });
    const after = JSON.parse(await fs.readFile(journalFile, 'utf8')) as Record<string, unknown>;
    expect(after).toMatchObject({
      id: journal.id,
      status: 'specs-applied',
      next_spec_index: 1,
    });
  });

  it('returns a failed independent Verifier result to Build for a new candidate', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const run = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'fail',
            acceptance: [{ id: 'A1', result: 'failed', reason: 'Resume lost confirmed work.' }],
            risks: [],
            summary: 'The selected workflow failed acceptance.',
          },
        },
      },
      root,
      'verifier-failed',
      'verifier-session-1',
    );
    expect(run.state).toMatchObject({ phase: 'build', status: 'active' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder', type: 'handoff' });
    expect(run.waits.some((wait) => wait.stepId === 'verify.confirm')).toBe(false);
  });

  it('keeps a stalled Verify Run waiting so the user can revise requirements or implementation', async () => {
    const { root, runtime, run } = await stalledVerifier();
    expect(run.state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      loop: { stop_reason: 'stalled', next_action: 'await-user' },
    });
    expect(run.status).toBe('waiting');
    expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.stop', status: 'pending' });

    const stopped = run.waits.at(-1)!;
    const revised = await runtime.dispatchCommand({
      runId: run.runId,
      expectedRevision: run.revision,
      commandId: 'revise-stalled-requirements',
      name: 'revise-requirements',
      input: {
        reason: 'Correct the impossible acceptance criterion.',
        expectedStateVersion: (run.state as NativePortableState).state_version,
      },
      context: { requestId: 'revise-stalled-requirements', projectRoot: root },
    });
    expect(revised.waits.find((wait) => wait.id === stopped.id)?.status).toBe('cancelled');
    expect(revised.actions.at(-1)).toMatchObject({ stepId: 'shape.revise', status: 'pending' });
  });

  it('returns a stalled Verify Run to Build only after the matching user decision', async () => {
    const { runtime, run } = await stalledVerifier();
    const wait = run.waits.at(-1)!;
    const resumed = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'user-chose-different-repair',
      choice: 'repair',
    });
    expect(resumed.state).toMatchObject({
      phase: 'build',
      status: 'active',
      loop: { next_action: 'submit-builder-candidate' },
    });
    expect((resumed.state as NativePortableState).loop.stop_reason).toBeUndefined();
    expect(resumed.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });
  });

  it('offers a proposal-bound repair command for a persisted stalled SDK Run', async () => {
    const { root, run } = await stalledVerifier('sdk');
    const wait = run.waits.at(-1)!;
    const proposed = await advanceNativeSdkChange(root, 'sdk-shape');
    expect(proposed.exitCode).toBe(0);
    const continuation = (
      proposed.data as {
        continuation?: { commandAlternatives: Array<{ name: string; commandArgs: string[] }> };
      }
    ).continuation;
    const repair = continuation?.commandAlternatives.find(
      (alternative) => alternative.name === 'revise-implementation',
    );
    expect(repair?.commandArgs).toContain(wait.proposalHash);
    const stale = await advanceNativeSdkChange(root, 'sdk-shape', {
      summary: 'Try a different repair.',
      proposalHash: 'a'.repeat(64),
      expectedStateVersion: (run.state as NativePortableState).state_version,
      expectedAction: 'revise-implementation',
    });
    expect(stale.exitCode).toBe(73);
    const command = repair!.commandArgs
      .slice(2)
      .map((arg) => (arg === '<summary>' ? 'Try a different repair.' : arg));
    const resumed = await nativeDomain.runNativeCliDetailed(command);
    expect(resumed.dispatch.exitCode, JSON.stringify(resumed.dispatch.error)).toBe(0);
    expect(resumed.dispatch.data).toMatchObject({ phase: 'build', run: { status: 'running' } });
  });

  it('accepts an independent Verifier for a new candidate after the prior candidate failed', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const failed = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId: (ready.state as NativePortableState).builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'fail',
            acceptance: [{ id: 'A1', result: 'failed', reason: 'First candidate failed.' }],
            risks: [],
            summary: 'Build another candidate.',
          },
        },
      },
      root,
      'first-verifier-failed',
      'verifier-session-1',
    );
    const rebuilt = await succeedLatestAction(
      runtime,
      failed,
      {
        summary: 'Implemented the corrected candidate.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-09-24T02:00:00.000Z',
        verificationChecks: [],
      },
      root,
      'second-builder-candidate',
      'builder-session-2',
    );
    const checked = await runtime.execute({
      runId: rebuilt.runId,
      actionId: rebuilt.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'second-candidate-checks', projectRoot: root },
    });
    const state = checked.state as NativePortableState;
    const verified = await succeedLatestAction(
      runtime,
      checked,
      {
        candidateId: state.builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session-2',
        response: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Corrected candidate passed.' }],
            risks: [],
            summary: 'Passed.',
          },
        },
      },
      root,
      'second-verifier-passed',
      'verifier-session-2',
    );
    expect(verified.actions.at(-1)).toMatchObject({ stepId: 'verify.report' });
    expect(verified.state).toMatchObject({ verification_result: 'pass' });
  });

  it('runs Verifier-requested checks before accepting a final result from the same execution', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'request-checks',
          iteration: 1,
          attempt: 1,
          checks: [
            {
              id: 'requested',
              name: 'Verifier requested check',
              executable: process.execPath,
              argv: ['-e', 'process.stdout.write("verified")'],
              cwdRef: '.',
              timeoutMs: 5_000,
              repeatable: true,
            },
          ],
        },
      },
      root,
      'verifier-requested-checks',
      'verifier-session-1',
    );
    expect(requested.actions.at(-1)).toMatchObject({
      stepId: 'verify.requested-checks',
      type: 'call_tool',
    });
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'verifier-requested-check-execution', projectRoot: root },
    });
    expect(checked.actions.at(-1)).toMatchObject({
      stepId: 'verify.verifier',
      type: 'handoff',
    });
    const verified = await succeedLatestAction(
      runtime,
      checked,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Requested check passed.' }],
            risks: [],
            summary: 'Passed with the requested check.',
          },
        },
      },
      root,
      'verifier-final-after-checks',
      'verifier-session-1',
    );
    expect(verified.state).toMatchObject({ phase: 'verify', verification_result: 'pass' });
    expect(verified.actions.at(-1)).toMatchObject({ stepId: 'verify.report' });
    expect(verified.actions.filter((action) => action.stepId === 'verify.verifier')).toHaveLength(
      2,
    );
  });

  it('rejects a Verifier pass after a requested Runtime check failed', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'request-checks',
          iteration: 1,
          attempt: 1,
          checks: [
            {
              id: 'failing',
              name: 'Failing Runtime check',
              executable: process.execPath,
              argv: ['-e', 'process.exit(1)'],
              cwdRef: '.',
              timeoutMs: 5_000,
              repeatable: true,
            },
          ],
        },
      },
      root,
      'verifier-failing-request',
      'verifier-session-1',
    );
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'verifier-failing-check', projectRoot: root },
    });
    expect(checked.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier' });
    await expect(
      succeedLatestAction(
        runtime,
        checked,
        {
          candidateId,
          verifierExecutionRef: 'verifier-session-1',
          response: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Claimed pass.' }],
              risks: [],
              summary: 'Claimed pass despite failed check.',
            },
          },
        },
        root,
        'verifier-invalid-pass',
        'verifier-session-1',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
  });

  it('rejects a conflicting command reused under the same Verifier check ID', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const check = {
      id: 'requested',
      name: 'Verifier requested check',
      executable: process.execPath,
      argv: ['-e', 'process.stdout.write("first")'],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: true,
    };
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'request-checks',
          iteration: 1,
          attempt: 1,
          checks: [check],
        },
      },
      root,
      'verifier-first-request',
      'verifier-session-1',
    );
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'verifier-first-request-execution', projectRoot: root },
    });
    await expect(
      succeedLatestAction(
        runtime,
        checked,
        {
          candidateId,
          verifierExecutionRef: 'verifier-session-1',
          response: {
            kind: 'request-checks',
            iteration: 1,
            attempt: 1,
            checks: [{ ...check, argv: ['-e', 'process.stdout.write("different")'] }],
          },
        },
        root,
        'verifier-conflicting-request',
        'verifier-session-1',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
  });

  it('does not reserve a check ID or command from a rejected Verifier request', async () => {
    const { root, runtime, store, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const action = ready.actions.at(-1)!;
    const context = { requestId: 'rejected-request', projectRoot: root };
    await runtime.claim({
      runId: ready.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: 'verifier-session-1',
      claimToken: 'original-verifier-claim',
      context,
    });
    const submit = (outcomeId: string, attempt: number, code: string) =>
      runtime.recordOutcome({
        runId: ready.runId,
        context,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'original-verifier-claim',
          outcomeId,
          status: 'succeeded',
          output: {
            candidateId,
            verifierExecutionRef: 'verifier-session-1',
            response: {
              kind: 'request-checks',
              iteration: 1,
              attempt,
              checks: [
                {
                  id: 'corrected-check',
                  name: 'Check',
                  executable: process.execPath,
                  argv: ['-e', code],
                  cwdRef: '.',
                  timeoutMs: 5000,
                  repeatable: true,
                },
              ],
            },
          },
        },
      });
    await expect(submit('rejected-plan', 999, 'process.exit(1)')).rejects.toThrow(
      /expected iteration=1, attempt=1; received iteration=1, attempt=999/u,
    );
    const corrected = await submit('corrected-plan', 1, 'process.exit(0)');
    expect(corrected.actions.at(-1)).toMatchObject({
      stepId: 'verify.requested-checks',
      status: 'pending',
    });
    expect(
      (await store.read(ready.runId))!.actions.find(({ id }) => id === action.id)!.receipts,
    ).toHaveLength(2);
    const checked = await runtime.execute({
      runId: corrected.runId,
      actionId: corrected.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context,
    });
    expect(checked.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    expect(
      (checked.outputs['verify.requested-checks'].value as { checks: { status: string }[] })
        .checks[0].status,
    ).toBe('passed');
  });

  it('rejects a Verifier check ID that conflicts with a required Runtime check', async () => {
    const {
      root,
      runtime,
      run: ready,
    } = await dispatchedVerifier([
      {
        id: 'required',
        name: 'Required check',
        executable: process.execPath,
        argv: ['-e', 'process.stdout.write("required")'],
        cwdRef: '.',
        timeoutMs: 5_000,
        repeatable: true,
      },
    ]);
    await expect(
      succeedLatestAction(
        runtime,
        ready,
        {
          candidateId: (ready.state as NativePortableState).builder_handoff!.candidate_id,
          verifierExecutionRef: 'verifier-session-1',
          response: {
            kind: 'request-checks',
            iteration: 1,
            attempt: 1,
            checks: [
              {
                id: 'required',
                name: 'Different check',
                executable: process.execPath,
                argv: ['-e', 'process.stdout.write("different")'],
                cwdRef: '.',
                timeoutMs: 5_000,
                repeatable: true,
              },
            ],
          },
        },
        root,
        'verifier-conflicts-with-required',
        'verifier-session-1',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
  });

  it('rejects a second Verifier request that contains no new checks', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const check = {
      id: 'requested',
      name: 'Verifier requested check',
      executable: process.execPath,
      argv: ['-e', 'process.stdout.write("verified")'],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: true,
    };
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
      },
      root,
      'verifier-first-equivalent-request',
      'verifier-session-1',
    );
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'verifier-first-equivalent-check', projectRoot: root },
    });
    await expect(
      succeedLatestAction(
        runtime,
        checked,
        {
          candidateId,
          verifierExecutionRef: 'verifier-session-1',
          response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
        },
        root,
        'verifier-repeated-equivalent-request',
        'verifier-session-1',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
  });

  it('refreshes byte-bound SDK checks in Verify after a non-behavioral edit', async () => {
    const check = {
      id: 'required',
      name: 'Required check',
      executable: process.execPath,
      argv: ['-e', 'process.stdout.write("checked")'],
      cwdRef: '.',
      timeoutMs: 5000,
      repeatable: true,
    };
    const prepared = await dispatchedVerifier(
      [check],
      'sdk',
      undefined,
      false,
      undefined,
      async (root) => {
        await allowAgentDocumentReview(root);
        await fs.writeFile(path.join(root, 'settings.json'), '{"enabled":true}');
      },
    );
    const { root, runtime } = prepared;
    const ready = await runtime.execute({
      runId: prepared.run.runId,
      actionId: prepared.run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'initial-format-check', projectRoot: root },
    });
    const state = ready.state as unknown as NativePortableState;
    const candidateId = state.builder_handoff!.candidate_id;
    await fs.writeFile(path.join(root, 'settings.json'), '{\n "enabled": true\n}');
    await expect(nativeSdkCurrentCheckSummaries({ run: ready, projectRoot: root })).rejects.toThrow(
      '检查输入已变化',
    );
    await recordNonBehavioralEdit(
      root,
      ready.runId,
      'Only JSON whitespace changed; enabled remains true.',
    );
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        refreshChecks: true,
        response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
      },
      root,
      'refresh-request',
      'verifier-session-1',
    );
    const refreshed = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'refresh-execution', projectRoot: root },
    });
    expect((refreshed.state as unknown as NativePortableState).phase).toBe('verify');
    expect((refreshed.state as unknown as NativePortableState).builder_handoff?.candidate_id).toBe(
      candidateId,
    );
    expect(
      await nativeSdkCurrentCheckSummaries({ run: refreshed, projectRoot: root }),
    ).toHaveLength(1);
    await fs.writeFile(path.join(root, 'settings.json'), '{\n    "enabled": true\n}\n');
    await expect(
      nativeSdkCurrentCheckSummaries({ run: refreshed, projectRoot: root }),
    ).rejects.toThrow('检查输入已变化');
    await recordNonBehavioralEdit(
      root,
      refreshed.runId,
      'A second JSON format change preserves enabled=true.',
    );
    const requestedAgain = await succeedLatestAction(
      runtime,
      refreshed,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        refreshChecks: true,
        response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
      },
      root,
      'refresh-second-request',
      'verifier-session-1',
    );
    const latest = await runtime.execute({
      runId: requestedAgain.runId,
      actionId: requestedAgain.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'refresh-second-execution', projectRoot: root },
    });
    expect(await nativeSdkCurrentCheckSummaries({ run: latest, projectRoot: root })).toHaveLength(
      1,
    );
    await fs.writeFile(path.join(root, 'settings.json'), '{"enabled":false}');
    await expect(
      succeedLatestAction(
        runtime,
        latest,
        {
          candidateId,
          verifierExecutionRef: 'verifier-session-1',
          refreshChecks: true,
          response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
        },
        root,
        'reject-code-rebind',
        'verifier-session-1',
      ),
    ).rejects.toThrow('OUTCOME_REJECTED');
  });

  it('refreshes the same SDK candidate after its independent Verifier approves a structural edit', async () => {
    const check = {
      id: 'required',
      name: 'Required check',
      executable: process.execPath,
      argv: ['-e', 'process.stdout.write("checked")'],
      cwdRef: '.',
      timeoutMs: 5000,
      repeatable: true,
    };
    const before = 'export function value() { return 1; }';
    const after = 'export function value() { const result = 1; return result; }';
    const prepared = await dispatchedVerifier(
      [check],
      'memory',
      undefined,
      false,
      undefined,
      async (root) => {
        await fs.writeFile(path.join(root, 'value.ts'), before);
      },
    );
    const { root, paths, runtime } = prepared;
    const target = path.join(root, 'value.ts');
    const ready = await runtime.execute({
      runId: prepared.run.runId,
      actionId: prepared.run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'structural-initial-check', projectRoot: root },
    });
    const state = ready.state as NativePortableState;
    const { nativeEditReviewScope } =
      await import('../../../domains/comet-native/native-edit-review.js');
    const {
      prepareEditReview,
      recordEditReview,
      claimedEditReviewAuthority,
      assertEditReviewsComplete,
    } = await import('../../../domains/workflow-contract/edit-review.js');
    const scope = { ...nativeEditReviewScope(paths, state), judgment: 'agent' as const };
    const proposal = await prepareEditReview(scope, {
      intent: 'write',
      toolName: 'Write',
      targets: ['value.ts'],
      writes: [{ path: 'value.ts', content: after }],
    });
    await expect(assertEditReviewsComplete(scope)).rejects.toThrow('待复核');
    const action = ready.actions.at(-1)!;
    const context = { requestId: 'structural-review', projectRoot: root };
    const claim = {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'structural-review',
      sessionId: 'verifier-session-1',
    };
    const claimed = await runtime.claim({
      runId: ready.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: claim.sessionId,
      claimToken: claim.claimToken,
      context,
    });
    await recordEditReview(
      scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'non-behavioral',
        summary:
          'The local constant preserves the returned value; callers and acceptance behavior are unchanged.',
      },
      claimedEditReviewAuthority(claimed.actions, 'verify.verifier', 'builder-session-1', claim),
    );
    await fs.writeFile(target, after);
    await expect(nativeSdkCurrentCheckSummaries({ run: ready, projectRoot: root })).rejects.toThrow(
      '检查输入已变化',
    );
    const requested = await runtime.recordOutcome({
      runId: ready.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: claim.claimToken,
        outcomeId: 'structural-refresh',
        status: 'succeeded',
        output: {
          candidateId: state.builder_handoff!.candidate_id,
          verifierExecutionRef: claim.sessionId,
          refreshChecks: true,
          response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
        },
      },
      context,
    });
    const refreshed = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'structural-refreshed-check', projectRoot: root },
    });
    expect(refreshed.state).toMatchObject({
      phase: 'verify',
      builder_handoff: { candidate_id: state.builder_handoff!.candidate_id },
    });
    expect(
      await nativeSdkCurrentCheckSummaries({ run: refreshed, projectRoot: root }),
    ).toHaveLength(1);
    await fs.writeFile(target, after.replace('result = 1', 'result = 2'));
    await expect(assertEditReviewsComplete(scope)).rejects.toThrow('不匹配');
    await expect(
      succeedLatestAction(
        runtime,
        refreshed,
        {
          candidateId: state.builder_handoff!.candidate_id,
          verifierExecutionRef: claim.sessionId,
          refreshChecks: true,
          response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
        },
        root,
        'unreviewed-structural-change',
        claim.sessionId,
      ),
    ).rejects.toThrow('OUTCOME_REJECTED');
  });

  it('lets a new Verifier session reuse requested checks after the prior session fails', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const check = {
      id: 'requested',
      name: 'Verifier requested check',
      executable: process.execPath,
      argv: ['-e', 'process.stdout.write("verified")'],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: true,
    };
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
      },
      root,
      'verifier-request-before-failure',
      'verifier-session-1',
    );
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'requested-check-before-failure', projectRoot: root },
    });
    const action = checked.actions.at(-1)!;
    const context = { requestId: 'verifier-failed-after-request', projectRoot: root };
    const claimed = await runtime.claim({
      runId: checked.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: 'verifier-session-1',
      claimToken: 'verifier-failed-after-request',
      context,
    });
    const failed = await runtime.recordOutcome({
      runId: checked.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: claimed.actions.find((entry) => entry.id === action.id)!.claim!.token,
        outcomeId: 'verifier-failed-after-request',
        status: 'failed',
        output: { summary: 'The host confirmed this Verifier session failed.' },
      },
      context,
    });
    expect(failed.outputs['verify.requested-checks']).toMatchObject({
      value: { candidateId, checks: [{ id: 'requested', status: 'passed' }] },
    });
    const resumed = await succeedLatestAction(
      runtime,
      failed,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-2',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: (failed.state as NativePortableState).loop.attempt,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Checked by the new Verifier.' }],
            risks: [],
            summary: 'The new Verifier accepted the candidate.',
          },
        },
      },
      root,
      'verifier-after-request-retry',
      'verifier-session-2',
    );
    expect(resumed.actions.at(-1)).toMatchObject({ stepId: 'verify.report', status: 'pending' });
  });

  it('reuses a completed non-repeatable Runtime check requested by the Verifier', async () => {
    const counterRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-one-shot-counter-'));
    roots.push(counterRoot);
    const counter = path.join(counterRoot, 'sdk-check-count.txt');
    const check = {
      id: 'required',
      name: 'One-shot check',
      executable: process.execPath,
      argv: ['-e', 'require("node:fs").appendFileSync(process.argv[1], "x")', counter],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: false,
    };
    const { root, runtime, run: ready } = await dispatchedVerifier([check]);
    expect(await fs.readFile(counter, 'utf8')).toBe('x');
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId: (ready.state as NativePortableState).builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session-1',
        response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
      },
      root,
      'verifier-reuses-required-check',
      'verifier-session-1',
    );
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'verifier-reused-check', projectRoot: root },
    });
    expect(checked.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier' });
    expect(await fs.readFile(counter, 'utf8')).toBe('x');
  });

  it('asks for fresh approval when the verification report changes before revalidation', async () => {
    const { root, changeDir, runtime, run: ready } = await dispatchedVerifier();
    let run = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId: (ready.state as NativePortableState).builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified.' }],
            risks: [],
            summary: 'Passed.',
          },
        },
      },
      root,
      'verifier-result',
      'verifier-session-1',
    );
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report',
      context: { requestId: 'native-report', projectRoot: root },
    });
    await fs.appendFile(path.join(changeDir, 'verification.md'), '\nUnexpected edit.\n');
    const confirmation = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: confirmation.id,
      proposalHash: confirmation.proposalHash,
      decisionId: 'verification-approved',
      choice: 'approved',
    });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report-revalidate',
      context: { requestId: 'native-report-revalidate', projectRoot: root },
    });
    expect(run.state).toMatchObject({ phase: 'verify', status: 'await-user' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.report', type: 'call_tool' });
    expect(run.actions.some((action) => action.stepId === 'archive.prepare')).toBe(false);
  });

  it('accepts a legacy candidate binding only while its original environment and source remain current', async () => {
    const { root, paths, run } = await dispatchedVerifier();
    const state = run.state as NativePortableState;
    const check = run.actions.find((action) => action.stepId === 'verify.checks')!;
    const legacy = await nativeCandidateInputGate({
      projectRoot: root,
      candidateId: state.builder_handoff!.candidate_id,
      plans: [],
      managedArtifactRoot: paths.artifactRoot,
      editReviewScope: nativeEditReviewScope(paths, state),
      shapeSemanticSnapshot: state.shape_semantic_snapshot,
      legacyExecutionBinding: true,
    });
    const legacyRun = structuredClone(run);
    const legacyOutput = legacyRun.actions.find((action) => action.id === check.id)!.outcome!
      .output as Record<string, unknown>;
    // 旧绑定使用执行环境摘要，没有现代 rawInput 与分离的 v2 输入快照。
    const legacyInputs = await nativePortableChecks.nativeCheckInputSnapshot({
      projectRoot: root,
      state,
      plans: [],
      managedArtifactRoot: paths.artifactRoot,
    });
    legacyOutput.candidateInputFingerprintGate = legacy;
    delete legacyOutput.rawInput;
    delete legacyOutput.inputSnapshot;
    legacyOutput.inputBefore = legacyInputs.fingerprint;
    legacyOutput.inputAfter = legacyInputs.fingerprint;
    await expect(
      assertNativeSdkCandidateUnchanged({ run: legacyRun, projectRoot: root }),
    ).resolves.toMatchObject({ complete: true, projectRoot: await fs.realpath(root) });
    vi.stubEnv('NODE_ENV', 'legacy-context-changed');
    await expect(
      assertNativeSdkCandidateUnchanged({ run: legacyRun, projectRoot: root }),
    ).rejects.toThrow('候选实现已变化');
  });

  it.each([
    'environment-only',
    'generated-input',
    'input',
    'non-repeatable',
    'unknown-revalidation',
    'missing-report',
    'legacy-definition',
  ] as const)(
    'revalidates approved report %s changes without losing valid evidence',
    async (kind) => {
      const application = nativeApplication();
      if (kind === 'legacy-definition') {
        application.workflow = nativeSdkBeforeReportRecovery(application.workflow);
        application.transitionHandler = nativeSdkLegacyTransitionHandler(
          application.workflow,
          application.transitionHandler,
        );
      }
      const {
        root,
        changeDir,
        runtime,
        run: ready,
      } = await dispatchedVerifier(
        [
          {
            id: 'required',
            name: 'Runtime check',
            executable: process.execPath,
            argv: [
              '-e',
              'process.stdout.write(require("node:fs").readFileSync("dist/check-input.txt", "utf8"))',
            ],
            cwdRef: '.',
            timeoutMs: 5000,
            repeatable: kind !== 'non-repeatable',
          },
        ],
        kind === 'legacy-definition' ? 'sdk' : 'memory',
        application,
        true,
        undefined,
        async (root) => {
          await fs.mkdir(path.join(root, 'dist'), { recursive: true });
          await fs.writeFile(path.join(root, 'dist', 'check-input.txt'), 'checked input');
        },
      );
      let run = await succeedLatestAction(
        runtime,
        ready,
        {
          candidateId: (ready.state as NativePortableState).builder_handoff!.candidate_id,
          verifierExecutionRef: 'verifier-session-1',
          response: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified.' }],
              risks: [],
              summary: 'Passed.',
            },
          },
        },
        root,
        'verifier-result',
        'verifier-session-1',
      );
      const submitted = { actionId: ready.actions.at(-1)!.id, outcomeId: 'verifier-result' };
      expect(nativeSdkAutomaticReportAction(run, submitted)?.stepId).toBe('verify.report');
      expect(nativeSdkAutomaticReportAction(run, { ...submitted, outcomeId: 'wrong' })).toBeNull();
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report',
        context: { requestId: 'native-report', projectRoot: root },
      });
      if (kind === 'missing-report') await fs.rm(path.join(changeDir, 'verification.md'));
      else if (kind === 'input')
        await fs.writeFile(path.join(root, 'changed-input.txt'), 'new input');
      else if (kind !== 'environment-only')
        await fs.writeFile(path.join(root, 'dist', 'check-input.txt'), 'changed generated input');
      const confirmation = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: confirmation.id,
        proposalHash: confirmation.proposalHash,
        decisionId: 'verification-approved',
        choice: 'approved',
      });
      if (kind === 'environment-only') vi.stubEnv('NODE_ENV', 'changed-after-approval');
      if (kind === 'missing-report') {
        await expect(
          runtime.execute({
            runId: run.runId,
            actionId: run.actions.at(-1)!.id,
            executorId: 'comet-native-report-revalidate',
            context: { requestId: 'missing-report', projectRoot: root },
          }),
        ).rejects.toThrow('EXECUTION_UNKNOWN');
        const unknown = await runtime.inspect(run.runId);
        expect(await recoverNativeSdkReportRevalidation(root, unknown, runtime)).toEqual(unknown);
        expect(unknown.actions.at(-1)).toMatchObject({ status: 'unknown', reconciliations: [] });
        return;
      }
      if (kind === 'unknown-revalidation') {
        const action = run.actions.at(-1)!;
        run = await runtime.claim({
          runId: run.runId,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'comet-native-report-revalidate',
          claimToken: 'old-check',
          context: { requestId: 'old-check', projectRoot: root },
        });
        run = await runtime.markUnknown({
          runId: run.runId,
          actionId: action.id,
          attempt: action.attempt,
          reason: 'Native 检查输入已变化',
        });
        run = await recoverNativeSdkReportRevalidation(root, run, runtime);
        expect(run.actions.find((entry) => entry.id === action.id)).toMatchObject({
          attempt: 1,
          reconciliations: [],
          claim: { token: 'old-check' },
        });
      } else
        run = await runtime.execute({
          runId: run.runId,
          actionId: run.actions.at(-1)!.id,
          executorId: 'comet-native-report-revalidate',
          context: { requestId: 'native-report-revalidate', projectRoot: root },
        });
      if (kind === 'environment-only') {
        expect(run.state).toMatchObject({
          phase: 'archive',
          status: 'active',
          verification_result: 'pass',
        });
        expect(run.actions.find((action) => action.stepId === 'verify.revalidate')).toMatchObject({
          status: 'succeeded',
        });
        expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', status: 'pending' });
        expect(run.actions.filter((action) => action.stepId === 'verify.checks')).toHaveLength(1);
        expect(run.actions.filter((action) => action.stepId === 'verify.verifier')).toHaveLength(1);
        return;
      }
      if (kind === 'legacy-definition') {
        expect(run.status).toBe('failed');
        expect(await nativeDoctorCommand([run.runId, '--repair'], root)).toMatchObject({
          exitCode: 0,
        });
        const next = await advanceNativeSdkChange(root, run.runId);
        expect(next.exitCode).toBe(0);
        const loaded = await loadOwnedNativeSdkRuntime(root, run.runId);
        const recovered = await loaded.runtime.inspect(run.runId);
        expect(recovered.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier' });
        expect(recovered.waits.find((wait) => wait.id === confirmation.id)).toMatchObject({
          status: 'resolved',
        });
        return;
      }
      expect(run.state).toMatchObject({
        phase: 'verify',
        status: ['input', 'non-repeatable'].includes(kind) ? 'await-user' : 'active',
        verification_result: 'pending',
      });
      expect(run.actions.find((action) => action.stepId === 'verify.revalidate')).toMatchObject({
        status: 'failed',
        outcome: { output: { reason: 'check-input-drift' } },
      });
      expect(run.actions.some((action) => action.stepId === 'archive.prepare')).toBe(false);
      if (['input', 'non-repeatable'].includes(kind)) {
        expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.stop', status: 'pending' });
        return;
      }
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.checks', type: 'call_tool' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'refreshed-checks', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
      expect((run.state as NativePortableState).builder_handoff).toEqual(
        (ready.state as NativePortableState).builder_handoff,
      );
      expect(run.waits.find((wait) => wait.id === confirmation.id)).toMatchObject({
        status: 'resolved',
        decision: { choice: 'approved' },
      });
      expect(
        run.actions.filter(
          (action) => action.stepId === 'verify.checks' && action.status === 'succeeded',
        ),
      ).toHaveLength(2);
      const freshState = run.state as NativePortableState;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId: freshState.builder_handoff!.candidate_id,
          verifierExecutionRef: 'verifier-session-2',
          response: {
            kind: 'final-result',
            result: {
              iteration: freshState.loop.iteration,
              attempt: freshState.loop.attempt,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Rechecked current context.' }],
              risks: [],
              summary: 'Fresh independent verification.',
            },
          },
        },
        root,
        'fresh-verifier-result',
        'verifier-session-2',
      );
      expect(nativeSdkAutomaticReportAction(run, submitted)).toBeNull();
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report',
        context: { requestId: 'fresh-report', projectRoot: root },
      });
      expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
      expect(run.waits.at(-1)!.proposalHash).not.toBe(confirmation.proposalHash);
      expect(run.actions.some((action) => action.stepId === 'archive.prepare')).toBe(false);
      vi.unstubAllEnvs();
    },
  );

  it('rejects a Verifier pass when a required check log changed after dispatch', async () => {
    const { root, runtime, run } = await dispatchedVerifier([
      {
        id: 'focused',
        name: 'Focused check',
        executable: process.execPath,
        argv: ['-e', 'process.stdout.write("sdk-check-ok")'],
        cwdRef: '.',
        timeoutMs: 5_000,
        repeatable: true,
      },
    ]);
    const checkOutput = run.outputs['verify.checks'].value as {
      checks: Array<{ logRef: string }>;
    };
    await fs.appendFile(
      path.join(resolveWorkspaceRuntimeRootSync(root), checkOutput.checks[0].logRef),
      'tampered',
    );
    await expect(
      succeedLatestAction(
        runtime,
        run,
        {
          candidateId: (run.state as NativePortableState).builder_handoff!.candidate_id,
          verifierExecutionRef: 'verifier-session-1',
          response: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified.' }],
              risks: [],
              summary: 'Passed.',
            },
          },
        },
        root,
        'verifier-after-tamper',
        'verifier-session-1',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
  });

  it('reverifies the same candidate after a passed result without returning to Build', async () => {
    const prepared = await dispatchedVerifier(
      [
        {
          id: 'required',
          name: 'Required check',
          executable: process.execPath,
          argv: ['-e', 'process.stdout.write("checked")'],
          cwdRef: '.',
          timeoutMs: 5000,
          repeatable: true,
        },
      ],
      'sdk',
      undefined,
      false,
      undefined,
      async (root) => {
        await allowAgentDocumentReview(root);
        await fs.writeFile(path.join(root, 'settings.json'), '{"enabled":true}');
      },
    );
    const { root, runtime } = prepared;
    const ready = await runtime.execute({
      runId: prepared.run.runId,
      actionId: prepared.run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'initial-reverify-check', projectRoot: root },
    });
    const candidateId = (ready.state as unknown as NativePortableState).builder_handoff!
      .candidate_id;
    let run = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified.' }],
            risks: [],
            summary: 'Passed.',
          },
        },
      },
      root,
      'before-edit-pass',
      'verifier-session-1',
    );
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report',
      context: { requestId: 'before-edit-report', projectRoot: root },
    });
    await fs.writeFile(path.join(root, 'settings.json'), '{\n  "enabled": true\n}');
    await recordNonBehavioralEdit(
      root,
      run.runId,
      'Only JSON whitespace changed; enabled remains true.',
    );
    const wait = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'reverify-after-edit',
      choice: 'reverify',
    });
    expect(run.state).toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      builder_handoff: { candidate_id: candidateId },
    });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'after-edit-checks', projectRoot: root },
    });
    expect(run.state).toMatchObject({ phase: 'verify', loop: { iteration: 1, attempt: 2 } });
    const verified = await succeedLatestAction(
      runtime,
      run,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-2',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 2,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified current bytes.' }],
            risks: [],
            summary: 'Passed current candidate.',
          },
        },
      },
      root,
      'after-edit-pass',
      'verifier-session-2',
    );
    expect(verified.state).toMatchObject({
      phase: 'verify',
      verification_result: 'pass',
      builder_handoff: { candidate_id: candidateId },
    });
  });

  it('does not enter Build when Shape documents change after approval', async () => {
    const { root, paths, changeDir, runtime, run: prepared } = await preparedShape();
    const wait = prepared.waits.at(-1)!;
    const approved = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    const briefFile = path.join(changeDir, 'brief.md');
    const brief = await fs.readFile(briefFile, 'utf8');
    await fs.writeFile(
      briefFile,
      brief.replace('Preserve the selected workflow.', 'Preserve a different workflow.'),
    );
    await expect(
      succeedLatestAction(
        runtime,
        approved,
        await collectProposal(paths, approved.state as NativePortableState),
        root,
        'shape-stale',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
    const current = await runtime.inspect(approved.runId);
    expect(current.state).toMatchObject({ phase: 'shape', status: 'await-user' });
    expect(current.actions.some((action) => action.stepId === 'build.builder')).toBe(false);
  });

  it('rejects an incomplete Native state before the SDK Run is created', async () => {
    const { initialState } = await fixture();
    const application = nativeApplication();
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
    });
    const invalid = { ...initialState } as Record<string, unknown>;
    delete invalid.brief;
    await expect(
      runtime.start({
        runId: 'native-sdk-invalid-state',
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { name: 'sdk-shape', artifactRootRef: 'docs' },
        initialState: invalid,
      }),
    ).rejects.toThrow(/INITIAL_STATE_INVALID/);
  });
});

async function passedOneShotReverify(legacy = false) {
  const application = nativeApplication();
  const counterRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'native-reverify-one-shot-'));
  roots.push(counterRoot);
  const counter = path.join(counterRoot, 'executions.txt');
  const {
    root,
    runtime,
    store,
    run: ready,
  } = await dispatchedVerifier([], 'sdk', application, true, undefined, initializeArchiveGit);
  const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
  let run = await succeedLatestAction(
    runtime,
    ready,
    {
      candidateId,
      verifierExecutionRef: 'v1',
      response: {
        kind: 'request-checks',
        iteration: 1,
        attempt: 1,
        checks: [
          {
            id: 'oneshot',
            name: 'oneshot',
            executable: process.execPath,
            argv: ['-e', 'require("fs").appendFileSync(process.argv[1],"once\\n")', counter],
            cwdRef: '.',
            timeoutMs: 5000,
            repeatable: false,
          },
        ],
      },
    },
    root,
    'request',
    'v1',
  );
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'comet-native-checks',
    context: { requestId: 'checks', projectRoot: root },
  });
  run = await succeedLatestAction(
    runtime,
    run,
    {
      candidateId,
      verifierExecutionRef: 'v1',
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'pass',
          acceptance: [{ id: 'A1', result: 'passed', reason: 'Passed.' }],
          risks: [],
          summary: 'Passed.',
        },
      },
    },
    root,
    'pass',
    'v1',
  );
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'comet-native-report',
    context: { requestId: 'report', projectRoot: root },
  });
  if (legacy) {
    // 构造缺少原始输入证明的兼容快照；不伪造批准或正常阶段推进。
    const snapshot = structuredClone(run);
    for (const action of snapshot.actions) {
      if (action.stepId !== 'verify.requested-checks' || !action.outcome) continue;
      delete (action.outcome.output as Record<string, unknown>).rawInput;
      const receipt = action.receipts.find(
        ({ outcomeId }) => outcomeId === action.outcome!.outcomeId,
      )!;
      receipt.hash = hashRuntimeValue(action.outcome);
    }
    snapshot.revision += 1;
    expect(await store.compareAndSwap(run.runId, run.revision, snapshot)).toBe(true);
    run = await runtime.inspect(run.runId);
  }
  return { root, runtime, store, run, counter };
}

it('preserves the original pass and Wait when reverify includes a Verifier-added non-repeatable check', async () => {
  const { root, store, run, counter } = await passedOneShotReverify(true);
  const wait = run.waits.at(-1)!;
  const rejected = await advanceNativeSdkChange(root, run.runId, {
    expectedAction: 'retry-verifier',
    expectedStateVersion: (run.state as NativePortableState).state_version,
    proposalHash: wait.proposalHash,
    summary: 'Please reverify',
  });
  expect(rejected.exitCode).toBe(73);
  expect(rejected.data.continuation).not.toBeNull();
  expect(rejected.data.continuation.commandAlternatives.map(({ name }) => name)).not.toContain(
    'retry-verifier',
  );
  const final = await store.read(run.runId);
  expect(final).toEqual(run);
  expect(final!.waits.at(-1)).toMatchObject({ id: wait.id, status: 'pending' });
  expect((final!.state as NativePortableState).verification_result).toBe('pass');
  expect(await fs.readFile(counter, 'utf8')).toBe('once\n');
});

it('reuses a proven Verifier-added one-shot receipt during explicit reverify without replaying its effect', async () => {
  const { root, runtime, run, counter } = await passedOneShotReverify();
  const wait = run.waits.at(-1)!;
  const result = await advanceNativeSdkChange(root, run.runId, {
    expectedAction: 'retry-verifier',
    expectedStateVersion: (run.state as NativePortableState).state_version,
    proposalHash: wait.proposalHash,
    summary: 'User explicitly requests another independent review.',
  });
  expect(result.exitCode, JSON.stringify(result)).toBe(0);
  const current = await runtime.inspect(run.runId);
  expect(current.state).toMatchObject({
    phase: 'verify',
    archived: false,
    verification_result: 'pending',
    builder_handoff: {
      candidate_id: (run.state as NativePortableState).builder_handoff!.candidate_id,
    },
    loop: { iteration: 1, attempt: 2 },
  });
  expect(current.waits.find(({ id }) => id === wait.id)).toMatchObject({
    status: 'resolved',
    decision: { choice: 'reverify' },
  });
  expect(current.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
  for (const original of run.actions.filter(({ stepId }) => stepId === 'verify.requested-checks'))
    expect(current.actions.find(({ id }) => id === original.id)?.outcome).toEqual(original.outcome);
  expect(await fs.readFile(counter, 'utf8')).toBe('once\n');
  expect(current.actions.some(({ stepId }) => stepId.startsWith('archive.'))).toBe(false);
});

it('blocks tracked implementation drift at Archive preflight and offers the original Verify repair path', async () => {
  const prepared = await awaitingArchiveApplication('sdk', undefined, true, initializeArchiveGit);
  const { root, runtime } = prepared;
  await fs.writeFile(path.join(root, 'implementation.js'), 'throw new Error("unverified");');
  const result = await runNativeCli(['archive', 'sdk-shape', '--project-root', root, '--json']);
  const run = await runtime.inspect(prepared.run.runId);
  expect(run.state).toMatchObject({
    phase: 'verify',
    status: 'await-user',
    archived: false,
    verification_result: 'pending',
  });
  expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.stop', status: 'pending' });
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', status: 'failed' });
  expect(result.exitCode).toBe(73);
  const wait = run.waits.at(-1)!;
  const repaired = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    choice: 'repair',
    decisionId: 'repair-drift',
  });
  expect(repaired.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });
});

it.each(['archive.execute', 'archive.finalize', 'archive.finalize-before-move'] as const)(
  'recovers a returned but rejected %s through the public Archive command',
  async (scenario) => {
    const stepId = scenario === 'archive.finalize-before-move' ? 'archive.finalize' : scenario;
    const application = nativeApplication();
    const validatorId =
      stepId === 'archive.execute'
        ? 'comet-native-archive-apply-outcome'
        : 'comet-native-archive-finalize-outcome';
    application.validators = application.validators.map((validator) =>
      validator.id !== validatorId
        ? validator
        : {
            ...validator,
            validate: () => ({ accepted: false, reason: 'Simulated historical outcome rejection' }),
          },
    );
    const f = await awaitingArchiveApplication(
      'sdk',
      undefined,
      false,
      initializeArchiveGit,
      application,
    );
    let run = f.run;
    if (stepId === 'archive.finalize') {
      run = await f.runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-apply',
        context: { requestId: 'apply-before-rejection', projectRoot: f.root },
      });
    }
    const action = run.actions.at(-1)!;
    const implementation = path.join(f.root, 'implementation.js');
    const implementationBefore = await fs.readFile(implementation, 'utf8');
    if (scenario === 'archive.finalize-before-move')
      await fs.writeFile(implementation, 'throw new Error("unverified before finalize");');
    await expect(
      f.runtime.execute({
        runId: run.runId,
        actionId: action.id,
        executorId:
          stepId === 'archive.execute'
            ? 'comet-native-archive-apply'
            : 'comet-native-archive-finalize',
        context: { requestId: 'historical-rejection', projectRoot: f.root },
      }),
    ).rejects.toThrow('OUTCOME_REJECTED');
    const rejected = await f.runtime.inspect(run.runId);
    const original = rejected.actions.at(-1)!;
    expect(original.status).toBe('running');
    expect(original.rejectedOutcomes).toHaveLength(1);
    if (scenario === 'archive.finalize-before-move') {
      expect(original.rejectedOutcomes![0].outcome).toMatchObject({
        status: 'failed',
        output: { reason: 'candidate-drift' },
      });
      await fs.writeFile(implementation, implementationBefore);
      expect(await fs.readdir(f.paths.transactionsDir)).toContain(
        `portable-archive-${run.runId}.json`,
      );
    }
    const specFile = path.join(f.paths.specsDir, 'workflow/spec.md');
    const specStat = await fs.stat(specFile);
    expect(
      execFileSync(
        'git',
        ['ls-files', '--others', '--exclude-standard', '--', 'docs/comet/specs/workflow/spec.md'],
        {
          cwd: f.root,
          encoding: 'utf8',
        },
      ).trim(),
    ).toBe('docs/comet/specs/workflow/spec.md');
    const args = ['archive', run.runId, '--project-root', f.root, '--json'];
    if (stepId === 'archive.execute') {
      const implementation = path.join(f.root, 'implementation.js');
      const before = await fs.readFile(implementation, 'utf8');
      await fs.writeFile(implementation, 'throw new Error("unverified");');
      const blocked = await runNativeCli([...args, '--recover']);
      expect(blocked.exitCode).toBe(73);
      expect((await f.runtime.inspect(run.runId)).actions.at(-1)!.status).not.toBe('succeeded');
      expect((await fs.stat(specFile)).mtimeMs).toBe(specStat.mtimeMs);
      await fs.writeFile(implementation, before);
    }
    const recovered =
      stepId === 'archive.execute'
        ? await runNativeCli([...args, '--recover'])
        : (() => {
            const result = spawnSync(
              process.execPath,
              [
                path.resolve('assets/skills/comet-native/scripts/comet-native-archive.mjs'),
                run.runId,
                '--project-root',
                f.root,
                '--recover',
                '--json',
              ],
              { encoding: 'utf8', timeout: 30000 },
            );
            return { exitCode: result.status, stdout: result.stdout || result.stderr };
          })();
    expect(recovered.exitCode, recovered.stdout).toBe(0);
    const finished = await runNativeCli(args);
    expect(finished.exitCode, finished.stdout).toBe(0);
    const current = (await loadOwnedNativeSdkRuntime(f.root, run.runId)).runtime;
    const completed = await current.inspect(run.runId);
    expect(completed.status).toBe('completed');
    expect(completed.actions.find(({ id }) => id === action.id)).toMatchObject({
      status: 'succeeded',
      attempt: original.attempt,
      claim: original.claim,
      rejectedOutcomes: original.rejectedOutcomes,
    });
    expect(completed.actions.filter(({ stepId }) => stepId === 'archive.execute')).toHaveLength(1);
    expect((await fs.stat(specFile)).mtimeMs).toBe(specStat.mtimeMs);
    expect((await runNativeCli([...args, '--recover'])).exitCode).toBe(0);
  },
);

it('archives a real Git candidate through canonical writes and directory relocation', async () => {
  const {
    root,
    runtime,
    run: prepared,
  } = await awaitingArchiveApplication('sdk', undefined, true, initializeArchiveGit);
  const beforeHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const result = await runNativeCli(['archive', 'sdk-shape', '--project-root', root, '--json']);
  expect(result.exitCode, JSON.stringify(result)).toBe(0);
  expect((await runtime.inspect(prepared.runId)).state).toMatchObject({
    archived: true,
    status: 'done',
  });
  expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(
    beforeHead,
  );
  const completed = JSON.parse(result.stdout!).data;
  expect(completed.continuation.userCommunication.agentInstruction).toContain(
    'Run completion alone does not prove commit, push, or PR delivery',
  );
  expect(completed.continuation.userCommunication.agentInstruction).toContain(
    'Git delivery already authorized by the user',
  );
});

it.each(['source', 'bundle'] as const)(
  'bounds Git work for public next and archive without skipping candidate validation (%s)',
  async (entry) => {
    const { root, runtime, run } = await awaitingArchiveApplication(
      'sdk',
      undefined,
      true,
      initializeArchiveGit,
    );
    const invoke = async (command: 'next' | 'archive') => {
      if (entry === 'source')
        return withCometRuntimeMetrics(() =>
          runNativeCli([command, 'sdk-shape', '--project-root', root, '--json']),
        );
      const stdout = execFileSync(
        process.execPath,
        [
          path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'),
          command,
          'sdk-shape',
          '--project-root',
          root,
          '--json',
        ],
        { cwd: root, encoding: 'utf8', timeout: 60_000 },
      );
      const record = (await readRuntimePerformanceRecords(root)).records.find(
        (record) => record.command === command,
      )!;
      expect(record).toBeDefined();
      return { result: { exitCode: 0, stdout }, metrics: record };
    };
    const next = await invoke('next');
    expect(next.result.exitCode, JSON.stringify(next.result)).toBe(0);
    const archive = await invoke('archive');
    expect(archive.result.exitCode, JSON.stringify(archive.result)).toBe(0);
    expect((await runtime.inspect(run.runId)).state).toMatchObject({
      archived: true,
      status: 'done',
    });
    expect(next.metrics.gitCommands).toBeLessThanOrEqual(40);
    expect(archive.metrics.gitCommands).toBeLessThanOrEqual(46);
  },
);

it('keeps Archive next pending on a renamed branch and resumes the original Run after restoration', async () => {
  const { root, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    true,
    initializeArchiveGit,
  );
  const bound = await runNativeCli([
    'select',
    run.runId,
    '--rebind',
    '--project-root',
    root,
    '--json',
  ]);
  expect(bound.exitCode, bound.stdout).toBe(0);
  const before = await runtime.inspect(run.runId);
  expect((before.state as NativePortableState).workspace.change_branch).toBe('main');
  execFileSync('git', ['branch', '-m', 'renamed'], { cwd: root });
  const blocked = await runNativeCli(['next', run.runId, '--project-root', root, '--json']);
  expect(blocked.exitCode, blocked.stdout).toBe(0);
  expect(JSON.parse(blocked.stdout!).data.continuation.disposition).toBe('blocked');
  const retained = await runtime.inspect(run.runId);
  expectOriginalActionFacts(retained, before.actions);
  expect(retained.state).toEqual(before.state);
  expect(retained.waits).toEqual(before.waits);
  expect(retained.outputs).toEqual(before.outputs);
  await expect(fs.stat(path.join(root, 'docs/comet/specs/workflow/spec.md'))).rejects.toThrow();
  execFileSync('git', ['branch', '-m', 'main'], { cwd: root });
  const resumed = await runNativeCli(['next', run.runId, '--project-root', root, '--json']);
  expect(resumed.exitCode, resumed.stdout).toBe(0);
  const completed = await runtime.inspect(run.runId);
  expect(completed.status).toBe('completed');
  expect(completed.actions.filter((action) => action.stepId === 'archive.execute')).toHaveLength(1);
});

it.each([
  'implementation.js',
  'docs/comet/specs/workflow/hidden.js',
  'docs/comet/changes/sdk-shape/hidden.js',
])('blocks unapproved %s changes after Archive preflight', async (ref) => {
  const { root, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    initializeArchiveGit,
  );
  await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
  await fs.writeFile(path.join(root, ref), 'throw new Error("unverified");');
  const stopped = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'comet-native-archive-apply',
    context: { requestId: 'drift-apply', projectRoot: root },
  });
  expect(stopped.waits.at(-1)).toMatchObject({ stepId: 'verify.stop', status: 'pending' });
  expect((await runtime.inspect(run.runId)).state).toMatchObject({ archived: false });
  await expect(fs.stat(path.join(root, 'docs/comet/specs/workflow/spec.md'))).rejects.toThrow();
});

it('continues an authorized implementation edit without requesting the same decision again', async () => {
  const { root, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    initializeArchiveGit,
  );
  await fs.writeFile(path.join(root, 'implementation.js'), 'export const result = "user edit";');
  const result = await runNativeCli(['archive', run.runId, '--project-root', root, '--json']);
  expect(result.exitCode).toBe(73);
  const data = JSON.parse(result.stdout!).data;
  expect(data.recovery.code).toBe('candidate-drift');
  expect(data.continuation.requiresUserDecision).toBe(false);
  expect(data.continuation.userCommunication.agentInstruction).toMatch(
    /已有授权|already authorized/iu,
  );
  expect(data.continuation.userCommunication.agentInstruction).toMatch(/需求|requirements/iu);
  expect(data.continuation.userCommunication.agentInstruction).toMatch(/一次性|one-shot/iu);
  expect(data.continuation.userCommunication.agentInstruction).toMatch(
    /缺少继续授权|not authorized/iu,
  );
  expect(data.continuation.userCommunication.agentInstruction).toMatch(
    /不得自动接受|Do not automatically accept/iu,
  );
  expect(
    data.continuation.commandAlternatives.find(
      (option: { name: string }) => option.name === 'revise-implementation',
    ).requiredInputs,
  ).not.toContain('user-decision');
  const preserved = await runtime.inspect(run.runId);
  expect(preserved.state).toMatchObject({ archived: false });
  expect(await fs.readFile(path.join(root, 'implementation.js'), 'utf8')).toBe(
    'export const result = "user edit";',
  );
  const resumeArgs = (data.recovery.recoveryArgs as string[])
    .slice(2)
    .map((arg) => (arg === '<summary>' ? 'Continue the authorized implementation edit.' : arg));
  const resumed = await runNativeCli(resumeArgs);
  expect(resumed.exitCode, resumed.stdout).toBe(0);
  const continuing = await runtime.inspect(run.runId);
  expect(continuing.state).toMatchObject({ archived: false, phase: 'build' });
  expect(continuing.runId).toBe(run.runId);
  expect(await fs.readFile(path.join(root, 'implementation.js'), 'utf8')).toBe(
    'export const result = "user edit";',
  );
});

it('reports edited Archive-ready code before any Archive write and continues the same Run', async () => {
  const { root, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    initializeArchiveGit,
  );
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.execute', status: 'pending' });
  const ref = path.join(root, 'implementation.js');
  await fs.writeFile(ref, 'export const result = "user edit";');
  await runNativeCli(['doctor', run.runId, '--repair', '--project-root', root, '--json']);
  const before = await runtime.inspect(run.runId);
  const status = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
  expect(status.exitCode, status.stdout).toBe(0);
  const data = JSON.parse(status.stdout!).data;
  expect(data.recovery.code).toBe('candidate-drift');
  expect(data.continuation.requiresUserDecision).toBe(false);
  const doctor = await runNativeCli(['doctor', run.runId, '--project-root', root, '--json']);
  expect(JSON.parse(doctor.stdout!).data.continuation.recovery.code).toBe('candidate-drift');
  expect(await runtime.inspect(run.runId)).toEqual(before);
  expect(await fs.readFile(ref, 'utf8')).toBe('export const result = "user edit";');
  await expect(fs.stat(path.join(root, 'docs/comet/specs/workflow/spec.md'))).rejects.toThrow();
  const args = (data.recovery.recoveryArgs as string[])
    .slice(2)
    .map((arg) => (arg === '<summary>' ? 'Continue from the user edit.' : arg));
  await fs.writeFile(ref, 'export const result = true;');
  const restored = await runNativeCli(args);
  expect(restored.exitCode).not.toBe(0);
  expect(await runtime.inspect(run.runId)).toEqual(before);
  await expect(fs.stat(path.join(root, 'docs/comet/specs/workflow/spec.md'))).rejects.toThrow();
  await fs.writeFile(ref, 'export const result = "user edit";');
  const resumed = await runNativeCli(args);
  expect(resumed.exitCode, resumed.stdout).toBe(0);
  const after = await runtime.inspect(run.runId);
  expect(after.runId).toBe(run.runId);
  expect(after.state).toMatchObject({ phase: 'build', archived: false });
  expect(after.actions.find((action) => action.id === run.actions.at(-1)!.id)).toMatchObject({
    stepId: 'archive.execute',
    status: 'cancelled',
  });
  expect(
    after.actions.find((action) => action.id === run.actions.at(-1)!.id)?.claim,
  ).toBeUndefined();
  expect(
    after.actions.find((action) => action.id === run.actions.at(-1)!.id)?.outcome,
  ).toBeUndefined();
  expect(after.actions.find((action) => action.stepId === 'repair.implementation')).toMatchObject({
    status: 'succeeded',
    outcome: { output: { drift: true, archiveStep: 'archive.execute' } },
  });
  expect(await fs.readFile(ref, 'utf8')).toBe('export const result = "user edit";');
  await expect(fs.stat(path.join(root, 'docs/comet/specs/workflow/spec.md'))).rejects.toThrow();
  const repeated = await runNativeCli(args);
  expect(repeated.exitCode, repeated.stdout).toBe(0);
  expect((await runtime.inspect(run.runId)).revision).toBe(after.revision);
});

it.each(['report', 'requirements-and-code'] as const)(
  'retains a user-edited %s at Archive-ready and chooses the appropriate revision',
  async (kind) => {
    const { root, changeDir, runtime, run } = await awaitingArchiveApplication(
      'sdk',
      undefined,
      false,
      initializeArchiveGit,
    );
    await reconcileNativeSdkExecutionStops(root, run, runtime);
    const code = path.join(root, 'implementation.js');
    const edited =
      kind === 'report'
        ? path.join(changeDir, 'verification.md')
        : path.join(changeDir, 'specs/workflow/spec.md');
    const original = await fs.readFile(edited, 'utf8');
    const changed =
      kind === 'report'
        ? `${original}\nUser added verification notes.\n`
        : original.replace('without losing confirmed work', 'without losing the user changes');
    expect(changed).not.toBe(original);
    await fs.writeFile(edited, changed);
    if (kind !== 'report') await fs.writeFile(code, 'export const result = "user edit";');
    const before = await runtime.inspect(run.runId);
    const status = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
    expect(status.exitCode, status.stdout).toBe(0);
    const data = JSON.parse(status.stdout!).data;
    expect(data.recovery.code).toBe(
      kind === 'report' ? 'verification-report-drift' : 'shape-drift',
    );
    const args = (data.recovery.recoveryArgs as string[])
      .slice(2)
      .map((arg) => (arg === '<summary>' ? 'Continue with the user changes.' : arg));
    expect(args).toContain(kind === 'report' ? '--revise-implementation' : '--revise-requirements');
    expect(await runtime.inspect(run.runId)).toEqual(before);
    const resumed = await runNativeCli(args);
    expect(resumed.exitCode, resumed.stdout).toBe(0);
    const after = await runtime.inspect(run.runId);
    expect(after.runId).toBe(run.runId);
    expect(after.state).toMatchObject({
      phase: kind === 'report' ? 'build' : 'shape',
      archived: false,
    });
    expect(await fs.readFile(edited, 'utf8')).toBe(changed);
    if (kind !== 'report')
      expect(await fs.readFile(code, 'utf8')).toBe('export const result = "user edit";');
    await expect(fs.stat(path.join(root, 'docs/comet/specs/workflow/spec.md'))).rejects.toThrow();
  },
);

async function reviewAppliedCommentAtArchive(
  preparePending: boolean,
  decision: 'non-behavioral' | 'requirements-changed' = 'non-behavioral',
) {
  const { root, paths, changeDir, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    preparePending,
    initializeArchiveGit,
    nativeApplication(),
    decision === 'requirements-changed' ? allowAgentDocumentReview : undefined,
  );
  await reconcileNativeSdkExecutionStops(root, run, runtime);
  const before = await runtime.inspect(run.runId);
  await captureApprovedShapeOriginals(paths, before.state as NativePortableState);
  const brief = path.join(changeDir, 'brief.md');
  const modified = `${await fs.readFile(brief, 'utf8')}\n<!-- The user clarified this example. -->\n`;
  await fs.writeFile(brief, modified);
  const status = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
  expect(status.exitCode, status.stdout).toBe(0);
  const data = JSON.parse(status.stdout!).data;
  expect(data.continuation.commandArgs).toEqual(
    expect.arrayContaining(['edit-review', 'prepare-applied']),
  );
  expect(await runtime.inspect(run.runId)).toEqual(before);
  const prepared = (await runNativeEditReviewCommand({
    projectRoot: root,
    name: run.runId,
    operation: 'prepare-applied',
  })) as { proposal: { proposalHash: string } };
  const claimed = (await runNativeEditReviewCommand({
    projectRoot: root,
    name: run.runId,
    operation: 'claim',
    proposalHash: prepared.proposal.proposalHash,
    sessionId: 'archive-comment-reviewer',
  })) as { recordTemplate: Record<string, unknown> };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-archive-review-'));
  roots.push(directory);
  const receipt = path.join(directory, 'review.json');
  await fs.writeFile(
    receipt,
    JSON.stringify({
      ...claimed.recordTemplate,
      decision,
      summary: 'Review the user clarification.',
    }),
  );
  await runNativeEditReviewCommand({
    projectRoot: root,
    name: run.runId,
    operation: 'record',
    file: receipt,
  });
  const ready = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
  if (decision === 'requirements-changed') {
    const continuation = JSON.parse(ready.stdout!).data.continuation;
    expect(continuation.action).toBe('repair');
    expect(continuation.commandArgs).toContain('--revise-requirements');
    const args = (continuation.commandArgs as string[])
      .slice(2)
      .map((arg) => (arg === '<summary>' ? 'Revise the user clarification.' : arg));
    const resumed = await runNativeCli(args);
    expect(resumed.exitCode, resumed.stdout).toBe(0);
    const after = await runtime.inspect(run.runId);
    expect(after.runId).toBe(before.runId);
    expect(after.state).toMatchObject({ phase: 'shape', archived: false });
    expect(await fs.readFile(brief, 'utf8')).toBe(modified);
    expect(
      after.waits.filter((wait) => wait.stepId === 'shape.confirm' && wait.status === 'pending'),
    ).toHaveLength(0);
    return;
  }
  expect(JSON.parse(ready.stdout!).data.continuation.action).toBe('archive');
  expect((await runtime.inspect(run.runId)).state).toMatchObject({
    phase: 'archive',
    archived: false,
  });
  const archived = await runNativeCli(['archive', run.runId, '--project-root', root, '--json']);
  expect(archived.exitCode, archived.stdout).toBe(0);
  const after = await runtime.inspect(run.runId);
  expect(after.runId).toBe(before.runId);
  expect(after.state).toMatchObject({ phase: 'archive', archived: true });
  const ref = (after.outputs['archive.execute'].value as { archiveRef: string }).archiveRef;
  expect(await fs.readFile(path.join(paths.archiveDir, ref, 'brief.md'), 'utf8')).toBe(modified);
}

it('reviews a user-applied formal comment at Archive-ready and continues without revising Shape', async () => {
  await reviewAppliedCommentAtArchive(false);
});

it('reviews a user-applied formal comment before Archive preflight and continues', async () => {
  await reviewAppliedCommentAtArchive(true);
});

it('continues a user-applied requirements change through the original Shape confirmation', async () => {
  await reviewAppliedCommentAtArchive(false, 'requirements-changed');
});

it.each(['archive.prepare', 'archive.execute'] as const)(
  'offers revalidation when the user moved the report before %s',
  async (stage) => {
    const { root, changeDir, runtime, run } = await awaitingArchiveApplication(
      'sdk',
      undefined,
      stage === 'archive.prepare',
      initializeArchiveGit,
    );
    await reconcileNativeSdkExecutionStops(root, run, runtime);
    const report = path.join(changeDir, 'verification.md');
    const moved = path.join(changeDir, 'user-moved-report.md');
    const text = await fs.readFile(report, 'utf8');
    await fs.rename(report, moved);
    const before = await runtime.inspect(run.runId);
    const status = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
    expect(status.exitCode, status.stdout).toBe(0);
    const data = JSON.parse(status.stdout!).data;
    expect(data.recovery.code).toBe('verification-report-drift');
    expect(await runtime.inspect(run.runId)).toEqual(before);
    const args = (data.recovery.recoveryArgs as string[])
      .slice(2)
      .map((arg) => (arg === '<summary>' ? 'Revalidate after the report was moved.' : arg));
    const resumed = await runNativeCli(args);
    expect(resumed.exitCode, resumed.stdout).toBe(0);
    const after = await runtime.inspect(run.runId);
    expect(after.state).toMatchObject({ phase: 'build', archived: false });
    expect(
      after.actions.find((action) => action.id === before.actions.at(-1)!.id)?.claim,
    ).toBeUndefined();
    expect(await fs.readFile(moved, 'utf8')).toBe(text);
    await expect(fs.stat(report)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(root, 'docs/comet/specs/workflow/spec.md'))).rejects.toThrow();
  },
);

it('reports a non-file verification path without offering Archive or changing the Run', async () => {
  const { root, changeDir, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    initializeArchiveGit,
  );
  await reconcileNativeSdkExecutionStops(root, run, runtime);
  const report = path.join(changeDir, 'verification.md');
  await fs.rename(report, path.join(changeDir, 'user-moved-report.md'));
  await fs.mkdir(report);
  const before = await runtime.inspect(run.runId);
  const status = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
  expect(status.exitCode, status.stdout).toBe(0);
  const data = JSON.parse(status.stdout!).data;
  expect(data.recovery.code).toBe('archive-blocked');
  expect(data.recovery.reason).toMatch(/file|文件/iu);
  expect(data.recovery.recoveryArgs).toBeNull();
  expect(data.continuation.commandArgs).toBeNull();
  expect(await runtime.inspect(run.runId)).toEqual(before);
});

it('generates a missing report without overwriting a user-moved file or inventing a backup', async () => {
  const { root, changeDir, runtime, run } = await dispatchedVerifier(
    [],
    'sdk',
    nativeApplication(),
    true,
    undefined,
    async (projectRoot) => {
      await fs.writeFile(
        path.join(projectRoot, 'docs/comet/changes/sdk-shape/user-moved-report.md'),
        'User retained report content.\n',
      );
    },
  );
  const moved = path.join(changeDir, 'user-moved-report.md');
  const state = run.state as NativePortableState;
  let verified = await succeedLatestAction(
    runtime,
    run,
    {
      candidateId: state.builder_handoff!.candidate_id,
      verifierExecutionRef: 'missing-report-verifier',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'pass',
          acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified the candidate.' }],
          risks: [],
          summary: 'Independently verified.',
        },
      },
    },
    root,
    'missing-report-verifier',
    'missing-report-verifier',
  );
  verified = await runtime.execute({
    runId: run.runId,
    actionId: verified.actions.at(-1)!.id,
    executorId: 'comet-native-report',
    context: { requestId: 'new-report-after-move', projectRoot: root },
  });
  const output = verified.outputs['verify.report'].value as { preservedReportRef?: string };
  expect(output.preservedReportRef).toBeUndefined();
  expect(await fs.readFile(moved, 'utf8')).toBe('User retained report content.\n');
  expect(await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8')).toContain('Verified');
});

it('retains the user-edited verification report when the successor report is generated', async () => {
  const { root, changeDir, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    initializeArchiveGit,
  );
  await reconcileNativeSdkExecutionStops(root, run, runtime);
  const report = path.join(changeDir, 'verification.md');
  const edited = `${await fs.readFile(report, 'utf8')}\nUser note: check the export behavior.\n`;
  await fs.writeFile(report, edited);
  const status = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
  const data = JSON.parse(status.stdout!).data;
  const args = (data.recovery.recoveryArgs as string[])
    .slice(2)
    .map((arg) => (arg === '<summary>' ? 'Review the user report notes.' : arg));
  expect((await runNativeCli(args)).exitCode).toBe(0);
  let current = await runtime.inspect(run.runId);
  expect(current.actions.at(-1)?.input).toMatchObject({
    activation: {
      repairContext: { userEditedReport: { ref: 'docs/comet/changes/sdk-shape/verification.md' } },
    },
  });
  current = await succeedLatestAction(
    runtime,
    current,
    {
      summary: 'Reviewed the preserved work.',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [],
      knownLimits: [],
      review: null,
      submittedAt: new Date().toISOString(),
      verificationChecks: [],
    },
    root,
    'report-revision-builder',
    'report-revision-builder-session',
  );
  current = await runtime.execute({
    runId: run.runId,
    actionId: current.actions.at(-1)!.id,
    executorId: 'comet-native-checks',
    context: { requestId: 'report-revision-checks', projectRoot: root },
  });
  expect(current.actions.at(-1)?.input).toMatchObject({
    activation: { userEditedReport: { ref: 'docs/comet/changes/sdk-shape/verification.md' } },
  });
  const state = current.state as NativePortableState;
  current = await succeedLatestAction(
    runtime,
    current,
    {
      candidateId: state.builder_handoff!.candidate_id,
      verifierExecutionRef: 'report-revision-verifier-session',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'pass',
          acceptance: [
            { id: 'A1', result: 'passed', reason: 'Verified the candidate and user notes.' },
          ],
          risks: [],
          summary: 'Independently verified.',
        },
      },
    },
    root,
    'report-revision-verifier',
    'report-revision-verifier-session',
  );
  current = await runtime.execute({
    runId: run.runId,
    actionId: current.actions.at(-1)!.id,
    executorId: 'comet-native-report',
    context: { requestId: 'successor-report', projectRoot: root },
  });
  const output = current.outputs['verify.report'].value as { preservedReportRef?: string };
  expect(output.preservedReportRef).toEqual(expect.any(String));
  expect(
    await fs.readFile(
      path.join(resolveWorkspaceRuntimeRootSync(root), output.preservedReportRef!),
      'utf8',
    ),
  ).toBe(edited);
  expect(await fs.readFile(report, 'utf8')).not.toBe(edited);
  const after = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
  expect(JSON.stringify(JSON.parse(after.stdout!).data)).toContain(output.preservedReportRef);
});

it('preserves completed one-shot checks while revising edited Archive-ready code', async () => {
  const counterRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-archive-revision-check-'));
  roots.push(counterRoot);
  const counter = path.join(counterRoot, 'count');
  const checks = [
    {
      id: 'once',
      name: 'one-shot',
      executable: process.execPath,
      argv: ['-e', 'require("fs").appendFileSync(process.argv[1],"once\\n")', counter],
      cwdRef: '.',
      timeoutMs: 5000,
      repeatable: false,
    },
    {
      id: 'regular',
      name: 'repeatable',
      executable: process.execPath,
      argv: ['-e', 'process.stdout.write("checked")'],
      cwdRef: '.',
      timeoutMs: 5000,
      repeatable: true,
    },
  ];
  const { root, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    initializeArchiveGit,
    nativeApplication(),
    undefined,
    checks,
  );
  await runNativeCli(['doctor', run.runId, '--repair', '--project-root', root, '--json']);
  const code = path.join(root, 'implementation.js');
  await fs.writeFile(code, 'export const result = "user edit";');
  const status = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
  const data = JSON.parse(status.stdout!).data;
  expect(data.recovery.code).toBe('candidate-drift');
  const args = (data.recovery.recoveryArgs as string[])
    .slice(2)
    .map((arg) => (arg === '<summary>' ? 'Continue the user edit.' : arg));
  const resumed = await runNativeCli(args);
  expect(resumed.exitCode, resumed.stdout).toBe(0);
  const after = await runtime.inspect(run.runId);
  expect(after.state).toMatchObject({ phase: 'build', archived: false });
  expect(await fs.readFile(counter, 'utf8')).toBe('once\n');
  expect(after.actions.filter((action) => action.stepId === 'verify.checks')).toHaveLength(1);
  expect(after.actions.find((action) => action.stepId === 'verify.checks')?.outcome).toEqual(
    run.actions.find((action) => action.stepId === 'verify.checks')?.outcome,
  );
  expect(await fs.readFile(code, 'utf8')).toBe('export const result = "user edit";');
});

it('revises a previous-definition Archive-ready Run without executing its Archive Action', async () => {
  const application = nativeApplication();
  application.workflow = nativeSdkBeforeImplementationRevision(application.workflow);
  application.transitionHandler = nativeSdkLegacyTransitionHandler(
    application.workflow,
    application.transitionHandler,
  );
  const { root, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    initializeArchiveGit,
    application,
  );
  const settled = await reconcileNativeSdkExecutionStops(root, run, runtime);
  const originalHash = settled.workflow.hash;
  const originalArchive = settled.actions.at(-1)!;
  expect(originalArchive).toMatchObject({ stepId: 'archive.execute', status: 'pending' });
  const ref = path.join(root, 'implementation.js');
  await fs.writeFile(ref, 'export const result = "legacy user edit";');
  const status = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
  expect(status.exitCode, status.stdout).toBe(0);
  const data = JSON.parse(status.stdout!).data;
  expect(data.recovery.code).toBe('candidate-drift');
  const args = (data.recovery.recoveryArgs as string[])
    .slice(2)
    .map((arg) => (arg === '<summary>' ? 'Continue the existing work.' : arg));
  const resumed = await runNativeCli(args);
  expect(resumed.exitCode, resumed.stdout).toBe(0);
  const current = (await loadOwnedNativeSdkRuntime(root, run.runId)).runtime;
  const repaired = await current.inspect(run.runId);
  expect(repaired.workflow.hash).not.toBe(originalHash);
  expect(repaired.state).toMatchObject({ phase: 'build', archived: false });
  expect(repaired.actions.find((action) => action.id === originalArchive.id)).toMatchObject({
    status: 'cancelled',
  });
  expect(
    repaired.actions.find((action) => action.id === originalArchive.id)?.claim,
  ).toBeUndefined();
  expect(await fs.readFile(ref, 'utf8')).toBe('export const result = "legacy user edit";');
  await expect(fs.stat(path.join(root, 'docs/comet/specs/workflow/spec.md'))).rejects.toThrow();
});

it('continues a read-only revision after its claiming process exits without reporting an outcome', async () => {
  const { root, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    initializeArchiveGit,
  );
  const settled = await reconcileNativeSdkExecutionStops(root, run, runtime);
  const ref = path.join(root, 'implementation.js');
  await fs.writeFile(ref, 'export const result = "user edit";');
  const status = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
  const data = JSON.parse(status.stdout!).data;
  const args = (data.recovery.recoveryArgs as string[])
    .slice(2)
    .map((arg) => (arg === '<summary>' ? 'Continue after process exit.' : arg));
  const proposalHash = settled.waits.findLast(
    (wait) => wait.stepId === 'verify.confirm' && wait.status === 'resolved',
  )!.proposalHash;
  const expectedStateVersion = (settled.state as NativePortableState).state_version;
  const reason = 'Continue after process exit.';
  const commandId = hashRuntimeValue({
    name: 'revise-implementation',
    runId: run.runId,
    expectedStateVersion,
    proposalHash,
    reason,
  });
  const dispatched = await runtime.dispatchCommand({
    runId: run.runId,
    expectedRevision: settled.revision,
    commandId,
    name: 'revise-implementation',
    input: {
      reason,
      expectedStateVersion,
      proposalHash,
      archiveActionId: settled.actions.at(-1)!.id,
    },
    context: { requestId: 'dispatch-before-process-exit', projectRoot: root },
  });
  const pending = dispatched.actions.at(-1)!;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-revision-owner-'));
  roots.push(directory);
  const bundle = path.join(directory, 'owner.cjs');
  const payload = path.join(directory, 'owner.json');
  await fs.writeFile(
    payload,
    JSON.stringify({
      root,
      runId: run.runId,
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
    }),
  );
  await build({
    stdin: {
      contents: `const fs = require('node:fs'); const { loadOwnedNativeSdkRuntime } = require('./domains/comet-native/native-runtime-ownership.ts'); const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); loadOwnedNativeSdkRuntime(p.root, p.runId).then(({ runtime }) => runtime.claim({ runId: p.runId, actionId: p.actionId, attempt: p.attempt, inputHash: p.inputHash, executorId: 'comet-native-revise-implementation', claimToken: 'exited-readonly-owner', context: { requestId: 'exited-readonly-owner', projectRoot: p.root } })).catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'silent',
  });
  execFileSync(process.execPath, [bundle, payload], { env: process.env, timeout: 60_000 });
  const claimed = await runtime.inspect(run.runId);
  const original = claimed.actions.find((action) => action.id === pending.id)!;
  expect(original).toMatchObject({ status: 'running', claim: { token: 'exited-readonly-owner' } });
  const resumedStatus = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
  expect(JSON.parse(resumedStatus.stdout!).data.continuation.commandArgs).toContain('next');
  const resumed = await runNativeCli(args);
  expect(resumed.exitCode, resumed.stdout).toBe(0);
  const after = await runtime.inspect(run.runId);
  expect(after.state).toMatchObject({ phase: 'build', archived: false });
  expect(after.actions.find((action) => action.id === pending.id)).toMatchObject({
    status: 'succeeded',
    claim: original.claim,
  });
  expect(
    after.actions.find((action) => action.id === settled.actions.at(-1)!.id)?.claim,
  ).toBeUndefined();
  expect(await fs.readFile(ref, 'utf8')).toBe('export const result = "user edit";');
  await expect(fs.stat(path.join(root, 'docs/comet/specs/workflow/spec.md'))).rejects.toThrow();
});

it.each(['unknown', 'rejected'] as const)(
  'reconciles a %s read-only implementation revision using the original claim',
  async (kind) => {
    const { root, runtime, run } = await awaitingArchiveApplication(
      'sdk',
      undefined,
      false,
      initializeArchiveGit,
    );
    const settled = await reconcileNativeSdkExecutionStops(root, run, runtime);
    const ref = path.join(root, 'implementation.js');
    await fs.writeFile(ref, 'export const result = "user edit";');
    const status = await runNativeCli(['status', run.runId, '--project-root', root, '--json']);
    const data = JSON.parse(status.stdout!).data;
    expect(data.recovery.code).toBe('candidate-drift');
    const args = (data.recovery.recoveryArgs as string[])
      .slice(2)
      .map((arg) => (arg === '<summary>' ? 'Continue the original work.' : arg));
    const proposalHash = settled.waits.findLast(
      (wait) => wait.stepId === 'verify.confirm' && wait.status === 'resolved',
    )!.proposalHash;
    const expectedStateVersion = (settled.state as NativePortableState).state_version;
    const reason = 'Continue the original work.';
    const commandId = hashRuntimeValue({
      name: 'revise-implementation',
      runId: run.runId,
      expectedStateVersion,
      proposalHash,
      reason,
    });
    const dispatched = await runtime.dispatchCommand({
      runId: run.runId,
      expectedRevision: settled.revision,
      commandId,
      name: 'revise-implementation',
      input: {
        reason,
        expectedStateVersion,
        proposalHash,
        archiveActionId: settled.actions.at(-1)!.id,
      },
      context: { requestId: 'dispatch-readonly-revision', projectRoot: root },
    });
    const pending = dispatched.actions.at(-1)!;
    const claimed = await runtime.claim({
      runId: run.runId,
      expectedRevision: dispatched.revision,
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      executorId: 'comet-native-revise-implementation',
      claimToken: 'original-readonly-claim',
      context: { requestId: 'claim-readonly-revision', projectRoot: root },
    });
    const action = claimed.actions.at(-1)!;
    if (kind === 'unknown') {
      await runtime.markUnknown({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        reason: 'Read-only executor stopped.',
      });
    } else {
      const context = { projectRoot: root, requestId: 'changed-readonly-revision' };
      const output = await nativeSdkImplementationRevisionExecutor.execute(
        action,
        context,
        claimed,
      );
      await fs.writeFile(ref, 'export const result = true;');
      await expect(
        runtime.recordOutcome({
          runId: run.runId,
          context,
          outcome: {
            ...output,
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: action.claim!.token,
            outcomeId: 'rejected-readonly-revision',
          },
        }),
      ).rejects.toThrow();
      await fs.writeFile(ref, 'export const result = "user edit";');
    }
    const resumed = await runNativeCli(args);
    expect(resumed.exitCode, resumed.stdout).toBe(0);
    const after = await runtime.inspect(run.runId);
    expect(after.state).toMatchObject({ phase: 'build', archived: false });
    expect(after.actions.find((entry) => entry.id === action.id)).toMatchObject({
      status: 'succeeded',
      attempt: action.attempt,
      claim: action.claim,
    });
    expect(
      after.actions.find((entry) => entry.id === settled.actions.at(-1)!.id)?.claim,
    ).toBeUndefined();
    expect(await fs.readFile(ref, 'utf8')).toBe('export const result = "user edit";');
    await expect(fs.stat(path.join(root, 'docs/comet/specs/workflow/spec.md'))).rejects.toThrow();
  },
);

it('keeps a recovered unknown preflight blocked when the original candidate has drifted', async () => {
  const { root, runtime, run } = await awaitingArchiveApplication(
    'sdk',
    undefined,
    true,
    initializeArchiveGit,
  );
  const action = run.actions.at(-1)!;
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-native-archive-preflight',
    claimToken: 'stopped-preflight',
    context: { requestId: 'stopped-preflight', projectRoot: root },
  });
  await runtime.markUnknown({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: 'The original executor has stopped.',
  });
  await fs.writeFile(path.join(root, 'implementation.js'), 'throw new Error("unverified");');
  const result = await runNativeCli([
    'archive',
    run.runId,
    '--project-root',
    root,
    '--recover',
    '--json',
  ]);
  expect(result.exitCode).toBe(73);
  const recovered = await runtime.inspect(run.runId);
  expect(recovered.actions.at(-1)).toMatchObject({
    id: action.id,
    status: 'failed',
    outcome: { output: { reason: 'candidate-drift' } },
  });
  expect(recovered.waits.at(-1)).toMatchObject({ stepId: 'verify.stop', status: 'pending' });
  expect(recovered.state).toMatchObject({ archived: false, verification_result: 'pending' });
});

it.each(['archive.prepare', 'archive.execute', 'archive.finalize'])(
  'rejects implementation drift between %s execution and commit and recovers the original Action',
  async (stepId) => {
    const prepared = await awaitingArchiveApplication('sdk', undefined, true, initializeArchiveGit);
    const { root, runtime, application } = prepared;
    let run = prepared.run;
    const executorIds = [
      'comet-native-archive-preflight',
      'comet-native-archive-apply',
      'comet-native-archive-finalize',
    ];
    const steps = ['archive.prepare', 'archive.execute', 'archive.finalize'];
    for (let i = 0; i < steps.indexOf(stepId); i++) {
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: executorIds[i],
        context: { requestId: `before-${stepId}-${i}`, projectRoot: root },
      });
    }
    const pending = run.actions.at(-1)!;
    const executor = application.executors.find(
      (entry) => entry.id === executorIds[steps.indexOf(stepId)],
    )!;
    const context = { requestId: `commit-boundary-${stepId}`, projectRoot: root };
    run = await runtime.claim({
      runId: run.runId,
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      executorId: executor.id,
      claimToken: `owner-${stepId}`,
      context,
    });
    const action = run.actions.at(-1)!;
    const executed = await executor.execute(action, context, run);
    await fs.writeFile(path.join(root, 'implementation.js'), 'throw new Error("unverified");');
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        context,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: action.claim!.token,
          outcomeId: `${action.id}:${action.attempt}:executor-result`,
          status: executed.status,
          output: executed.output,
        },
      }),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
    expect((await runtime.inspect(run.runId)).actions.at(-1)).toMatchObject({
      id: action.id,
      status: 'running',
    });
    await runtime.markUnknown({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'The test host has stopped after its rejected result.',
    });
    await fs.writeFile(path.join(root, 'implementation.js'), 'export const result = true;');
    const recovered = await archiveNativeSdkChange({
      projectRoot: root,
      name: run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    });
    expect(recovered.exitCode).toBe(0);
    const completed = await runtime.inspect(run.runId);
    expect(completed.actions.find((entry) => entry.id === action.id)).toMatchObject({
      status: 'succeeded',
      attempt: 1,
    });
    expect(completed.actions.filter((entry) => entry.stepId === stepId)).toHaveLength(1);
  },
);

it('blocks implementation drift before finalization and resumes its existing Spec transaction after restoration', async () => {
  const {
    root,
    runtime,
    run: prepared,
  } = await awaitingArchiveApplication('sdk', undefined, false, initializeArchiveGit);
  const run = await runtime.execute({
    runId: prepared.runId,
    actionId: prepared.actions.at(-1)!.id,
    executorId: 'comet-native-archive-apply',
    context: { requestId: 'apply-before-finalize-drift', projectRoot: root },
  });
  const action = run.actions.at(-1)!;
  await fs.writeFile(path.join(root, 'implementation.js'), 'throw new Error("unverified");');
  const stopped = await runtime.execute({
    runId: run.runId,
    actionId: action.id,
    executorId: 'comet-native-archive-finalize',
    context: { requestId: 'finalize-drift', projectRoot: root },
  });
  expect(stopped.actions.at(-1)).toMatchObject({
    status: 'failed',
    outcome: { output: { reason: 'candidate-drift' } },
  });
  await fs.writeFile(path.join(root, 'implementation.js'), 'export const result = true;');
  const result = await archiveNativeSdkChange({
    projectRoot: root,
    name: run.runId,
    dryRun: false,
    recover: false,
    confirmed: false,
  });
  expect(result.exitCode).toBe(0);
  const restored = await runtime.inspect(run.runId);
  expect(restored.status).toBe('completed');
  expect(restored.actions.filter((entry) => entry.stepId === 'archive.execute')).toHaveLength(1);
});

function legacyArchiveApplication() {
  const application = nativeApplication();
  const workflow = nativeSdkBeforeArchiveCandidateRecovery(application.workflow);
  return {
    ...application,
    workflow,
    transitionHandler: nativeSdkLegacyTransitionHandler(workflow, application.transitionHandler),
    executors: application.executors.map((executor) =>
      executor.id !== nativeSdkArchivePreflightExecutor.id
        ? executor
        : {
            ...executor,
            async execute(...args: Parameters<RuntimeExecutor['execute']>) {
              const result = await executor.execute(...args);
              const output = { ...(result.output as Record<string, never>) };
              delete output.candidateBinding;
              delete output.recoveryBinding;
              return { ...result, output };
            },
          },
    ),
    validators: application.validators.map((validator) =>
      validator.id !== nativeSdkArchivePreflightValidator.id
        ? validator
        : {
            ...validator,
            async validate(args: Parameters<RuntimeValidator['validate']>[0]) {
              const expected = await nativeSdkArchivePreflightExecutor.execute(
                args.action,
                args.context,
                args.run,
              );
              const output = { ...(expected.output as Record<string, never>) };
              delete output.candidateBinding;
              delete output.recoveryBinding;
              return {
                accepted:
                  expected.status === args.outcome.status &&
                  hashRuntimeValue(output) === hashRuntimeValue(args.outcome.output),
              };
            },
          },
    ),
  };
}

async function interruptedLegacyArchive(kind: string) {
  const original = '# Existing workflow\nPreserve the old acceptance.\n';
  const prepared = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    undefined,
    legacyArchiveApplication(),
    async (root) => {
      if (kind === 'non-git-update')
        await fs.writeFile(path.join(root, 'implementation.js'), 'export const result = true;');
      else await initializeArchiveGit(root);
      if (kind !== 'create') {
        const file = path.join(root, 'docs/comet/specs/workflow/spec.md');
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, original);
        if (kind === 'untracked-update' || kind === 'non-git-update') {
          for (const [ref, content] of [
            ['docs/comet/specs/secondary/spec.md', original],
            [
              'docs/comet/changes/sdk-shape/specs/secondary/spec.md',
              '# Secondary\nThe selected workflow resumes.\n',
            ],
          ]) {
            await fs.mkdir(path.dirname(path.join(root, ref!)), { recursive: true });
            await fs.writeFile(path.join(root, ref!), content!);
          }
        }
        if (kind === 'tracked-update') {
          execFileSync('git', ['add', 'docs/comet/specs/workflow/spec.md'], { cwd: root });
          execFileSync('git', ['commit', '-m', 'existing spec'], { cwd: root, stdio: 'ignore' });
        }
      }
    },
  );
  const { root, runtime, run } = prepared;
  expect(run.outputs['archive.prepare'].value).not.toHaveProperty('candidateBinding');
  const action = run.actions.at(-1)!;
  // 旧实现已完成 apply 的事实由原事务保存；新 Runtime 不重放已经写入的 Spec。
  const context = { requestId: 'legacy-apply', projectRoot: root };
  const claimed = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-native-archive-apply',
    claimToken: 'legacy-apply-owner',
    context,
  });
  const { applyNativeSdkArchiveSpecs, inspectNativeSdkArchiveSpecs } =
    await import('../../../domains/comet-native/native-portable-archive.js');
  const state = claimed.state as NativePortableState;
  await applyNativeSdkArchiveSpecs({
    paths: prepared.paths,
    state,
    verificationReportStateVersion: (
      run.outputs['archive.prepare'].value as { reportStateVersion: number }
    ).reportStateVersion,
  });
  await runtime.markUnknown({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: 'The legacy host stopped after applying its frozen transaction.',
  });
  const options = {
    projectRoot: root,
    name: run.runId,
    dryRun: false,
    recover: true,
    confirmed: false,
  };
  return { ...prepared, state, options, original, inspectNativeSdkArchiveSpecs };
}

async function legacyArchiveOriginalsBackup(
  fixture: Awaited<ReturnType<typeof interruptedLegacyArchive>>,
) {
  const { readNativePortableTransaction } =
    await import('../../../domains/comet-native/native-portable-transactions.js');
  const transaction = await readNativePortableTransaction(fixture.paths, {
    kind: 'archive',
    change: fixture.state.name,
  });
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-archive-originals-'));
  roots.push(backupRoot);
  const backupRef = path.join(backupRoot, 'archive-originals.json');
  await fs.writeFile(
    backupRef,
    JSON.stringify({
      schema: 'comet.native.archive-originals.v1',
      runId: fixture.run.runId,
      transactionId: transaction!.journal.id,
      files: [
        { ref: 'docs/comet/specs/workflow/spec.md', content: fixture.original },
        { ref: 'docs/comet/specs/secondary/spec.md', content: fixture.original },
      ],
    }),
  );
  return backupRef;
}

it.for(['untracked-update', 'non-git-update'])(
  'rejects a file symlink backup for an old Archive %s transaction',
  async (kind, context) => {
    await requireFileSymlink(context);
    const fixture = await interruptedLegacyArchive(kind);
    const backupRef = await legacyArchiveOriginalsBackup(fixture);
    const linked = path.join(path.dirname(backupRef), 'linked.json');
    await fs.symlink(backupRef, linked, 'file');
    await expectArchiveFailure(
      archiveNativeSdkChange({ ...fixture.options, legacySpecBackup: linked }),
      /symbolic|symlink/i,
    );
  },
);

it.each(['create', 'tracked-update', 'untracked-update', 'non-git-update'])(
  'recovers an old Archive %s transaction by matching its original candidate evidence',
  async (kind) => {
    const prepared = await interruptedLegacyArchive(kind);
    const { root, runtime, run, state, options, original, inspectNativeSdkArchiveSpecs } = prepared;
    if (kind === 'untracked-update' || kind === 'non-git-update') {
      await expectArchiveFailure(archiveNativeSdkChange(options), /原文/);
      const backupRef = await legacyArchiveOriginalsBackup(prepared);
      const validBackup = await fs.readFile(backupRef, 'utf8');
      const parsedBackup = JSON.parse(validBackup);
      for (const invalid of [
        { ...parsedBackup, unknown: true },
        { ...parsedBackup, runId: 'another-run' },
        { ...parsedBackup, transactionId: 'another-transaction' },
        { ...parsedBackup, files: [...parsedBackup.files, ...parsedBackup.files] },
        { ...parsedBackup, files: [{ ref: '../escape/spec.md', content: original }] },
        { ...parsedBackup, files: [{ ref: 'docs/comet/specs/extra/spec.md', content: original }] },
        { ...parsedBackup, files: [{ ref: parsedBackup.files[0].ref, content: 'wrong original' }] },
      ]) {
        await fs.writeFile(backupRef, JSON.stringify(invalid));
        await expectArchiveFailure(
          archiveNativeSdkChange({ ...options, legacySpecBackup: backupRef }),
        );
        expect(await fs.readFile(backupRef, 'utf8')).toBe(JSON.stringify(invalid));
      }
      await fs.writeFile(backupRef, ' '.repeat(8 * 1024 * 1024 + 1));
      await expectArchiveFailure(
        archiveNativeSdkChange({ ...options, legacySpecBackup: backupRef }),
      );
      await fs.writeFile(backupRef, validBackup);
      await expectArchiveFailure(
        archiveNativeSdkChange({ ...options, legacySpecBackup: '../outside.json' }),
      );
      await fs.writeFile(path.join(root, 'implementation.js'), 'throw new Error("changed");');
      await expectArchiveFailure(
        archiveNativeSdkChange({ ...options, legacySpecBackup: backupRef }),
        /候选实现/,
      );
      await fs.writeFile(path.join(root, 'implementation.js'), 'export const result = true;');
      const { importNativeSdkArchiveOriginals } =
        await import('../../../domains/comet-native/native-sdk-archive-originals.js');
      await importNativeSdkArchiveOriginals({
        projectRoot: root,
        run: await runtime.inspect(run.runId),
        ref: backupRef,
      });
      await importNativeSdkArchiveOriginals({
        projectRoot: root,
        run: await runtime.inspect(run.runId),
        ref: backupRef,
      });
      await fs.writeFile(
        backupRef,
        JSON.stringify({ ...parsedBackup, files: [...parsedBackup.files].reverse() }),
      );
      await importNativeSdkArchiveOriginals({
        projectRoot: root,
        run: await runtime.inspect(run.runId),
        ref: backupRef,
      });
      await fs.writeFile(
        backupRef,
        JSON.stringify({
          ...parsedBackup,
          files: parsedBackup.files.map((entry: { ref: string; content: string }) => ({
            ...entry,
            content: 'different original',
          })),
        }),
      );
      await expect(
        importNativeSdkArchiveOriginals({
          projectRoot: root,
          run: await runtime.inspect(run.runId),
          ref: backupRef,
        }),
      ).rejects.toThrow();
      await fs.writeFile(backupRef, validBackup);
      expect(
        (
          await runNativeCli([
            'archive',
            run.runId,
            '--project-root',
            root,
            '--recover',
            '--legacy-spec-backup',
            backupRef,
            '--json',
          ])
        ).exitCode,
      ).toBe(0);
      expect(await fs.readFile(backupRef, 'utf8')).toBe(validBackup);
    } else {
      await fs.writeFile(path.join(root, 'implementation.js'), 'throw new Error("changed");');
      await expectArchiveFailure(archiveNativeSdkChange(options), /候选实现/);
      await fs.writeFile(path.join(root, 'implementation.js'), 'export const result = true;');
      expect((await archiveNativeSdkChange(options)).exitCode).toBe(0);
    }
    const restored = await runtime.inspect(run.runId);
    expect(restored.outputs['archive.execute'].value).toEqual(
      await inspectNativeSdkArchiveSpecs({ paths: prepared.paths, state }),
    );
    const result = await archiveNativeSdkChange({ ...options, recover: false });
    expect(result.exitCode).toBe(0);
    expect((await runtime.inspect(run.runId)).status).toBe('completed');
    expect(
      (await runtime.inspect(run.runId)).actions.filter(
        (entry) => entry.stepId === 'archive.execute',
      ),
    ).toHaveLength(1);
  },
);

it('upgrades a legacy failed Archive drift into the original Verify repair Wait', async () => {
  const prepared = await awaitingArchiveApplication(
    'sdk',
    async ({ root }) => {
      await fs.writeFile(path.join(root, 'implementation.js'), 'throw new Error("changed");');
    },
    false,
    initializeArchiveGit,
    legacyArchiveApplication(),
  );
  expect(prepared.run.status).toBe('failed');
  expect(prepared.run.state).toMatchObject({ phase: 'archive', archived: false });
  expect(
    await inspectNativeSdkDefinitionUpgrade(prepared.root, prepared.run.runId, true),
  ).toMatchObject({ ready: true, repaired: true });
  await advanceNativeSdkChange(prepared.root, prepared.run.runId);
  // load 会预读首个快照；跨另一条 command 推进后应重新加载，不能拿旧实例作最新查询。
  const { runtime } = await loadOwnedNativeSdkRuntime(prepared.root, prepared.run.runId);
  const run = await runtime.inspect(prepared.run.runId);
  expect(run.state).toMatchObject({
    phase: 'verify',
    status: 'await-user',
    verification_result: 'pending',
  });
  expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.stop', status: 'pending' });
});

it('requires fresh verification instead of trusting a legacy check without a candidate digest', async () => {
  const countDir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-check-proof-'));
  roots.push(countDir);
  const counter = path.join(countDir, 'executions');
  const f = await dispatchedVerifier(
    [
      {
        id: 'one-shot',
        name: 'One-shot proof',
        executable: process.execPath,
        argv: ['-e', "require('node:fs').appendFileSync(process.argv[1], 'once\\n')", counter],
        cwdRef: '.',
        timeoutMs: 10_000,
        repeatable: false,
      },
    ],
    'memory',
    nativeApplication(),
    false,
    undefined,
    initializeArchiveGit,
  );
  const action = f.run.actions.at(-1)!;
  const context = { projectRoot: f.root, requestId: 'original-check-proof' };
  const claimed = await f.runtime.claim({
    runId: f.run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: nativeSdkCheckExecutor.id,
    claimToken: 'original-check-proof',
    context,
  });
  const original = claimed.actions.at(-1)!;
  const result = await nativeSdkCheckExecutor.execute(original, context, claimed);
  const incomplete = { ...(result.output as Record<string, RuntimeValue>) };
  delete incomplete.inputSnapshot;
  delete incomplete.candidateInputFingerprintGate;
  delete incomplete.rawInput;
  const outcome = {
    ...result,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: original.claim!.token,
    outcomeId: 'missing-check-proof',
    output: incomplete,
  };
  await expect(f.runtime.recordOutcome({ runId: f.run.runId, outcome, context })).rejects.toThrow(
    'OUTCOME_REJECTED',
  );
  const rejected = await f.runtime.inspect(f.run.runId);
  expect(rejected.actions.at(-1)).toMatchObject({
    id: action.id,
    status: 'running',
    claim: original.claim,
    rejectedOutcomes: [
      expect.objectContaining({
        outcome: expect.objectContaining({ outcomeId: outcome.outcomeId }),
      }),
    ],
  });
  expect(rejected.state).toMatchObject({
    phase: 'verify',
    archived: false,
    verification_result: 'pending',
  });
  expect(rejected.actions.some((a) => a.stepId === 'verify.verifier')).toBe(false);
  const corrected = await f.runtime.recordOutcome({
    runId: f.run.runId,
    context,
    outcome: { ...outcome, ...result, outcomeId: 'complete-original-check-proof' },
  });
  expect(corrected.actions.find((a) => a.id === action.id)).toMatchObject({
    status: 'succeeded',
    claim: original.claim,
    rejectedOutcomes: rejected.actions.at(-1)!.rejectedOutcomes,
  });
  expect(corrected.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
  expect(corrected.actions.some((a) => a.stepId.startsWith('archive.'))).toBe(false);
  await expect(f.runtime.recordOutcome({ runId: f.run.runId, outcome, context })).rejects.toThrow();
  expect(await f.runtime.inspect(f.run.runId)).toEqual(corrected);
  expect(await fs.readFile(counter, 'utf8')).toBe('once\n');
});

it.each(['legacy', 'current'])(
  'records an already-finalized %s receipt as history without revalidating changed implementation',
  async (kind) => {
    const prepared = await awaitingArchiveApplication(
      'sdk',
      undefined,
      false,
      initializeArchiveGit,
      kind === 'legacy' ? legacyArchiveApplication() : undefined,
    );
    const { root, runtime, application } = prepared;
    let run = await runtime.execute({
      runId: prepared.run.runId,
      actionId: prepared.run.actions.at(-1)!.id,
      executorId: 'comet-native-archive-apply',
      context: { requestId: 'legacy-completed-apply', projectRoot: root },
    });
    const action = run.actions.at(-1)!;
    const context = { requestId: 'legacy-completed-finalize', projectRoot: root };
    run = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-native-archive-finalize',
      claimToken: 'legacy-finalize-owner',
      context,
    });
    const executor = application.executors.find(
      (entry) => entry.id === 'comet-native-archive-finalize',
    )!;
    const executed = await executor.execute(run.actions.at(-1)!, context, run);
    expect(executed.status).toBe('succeeded');
    await runtime.markUnknown({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'The legacy host stopped after persisting the finalization receipt.',
    });
    await fs.writeFile(path.join(root, 'implementation.js'), 'throw new Error("later work");');
    const result = await archiveNativeSdkChange({
      projectRoot: root,
      name: run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({
      historicalRecovery: true,
      currentImplementationRevalidated: false,
    });
    expect((await runtime.inspect(run.runId)).actions.at(-1)).toMatchObject({
      id: action.id,
      status: 'succeeded',
      attempt: 1,
    });
    expect(await fs.readFile(path.join(root, 'implementation.js'), 'utf8')).toContain('later work');
  },
);

it.each([1, 2])(
  'rejects candidate drift after original gate observation %i before archive binding capture',
  async (observation) => {
    const { root, runtime, run } = await awaitingArchiveApplication(
      'sdk',
      undefined,
      true,
      initializeArchiveGit,
    );
    const original = nativeSdkChecks.assertNativeSdkCandidateUnchanged;
    let calls = 0;
    vi.spyOn(nativeSdkChecks, 'assertNativeSdkCandidateUnchanged').mockImplementation(
      async (options) => {
        await original(options);
        if (++calls === observation)
          await fs.writeFile(
            path.join(root, 'implementation.js'),
            'throw new Error("between observations");',
          );
      },
    );
    await expect(
      runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-preflight',
        context: { requestId: `observation-drift-${observation}`, projectRoot: root },
      }),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
    const stopped = await runtime.inspect(run.runId);
    expect(stopped.state).toMatchObject({ archived: false });
    expect(stopped.actions.some((action) => action.stepId === 'archive.execute')).toBe(false);
  },
);

async function interruptArchiveFinalization(
  point:
    | 'report'
    | 'report-journal'
    | 'move'
    | 'move-journal'
    | 'portable-receipt'
    | 'runtime-receipt'
    | 'cleanup',
  legacy = false,
) {
  const prepared = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    initializeArchiveGit,
    legacy ? legacyArchiveApplication() : undefined,
  );
  const { root, paths, runtime } = prepared;
  let run = await runtime.execute({
    runId: prepared.run.runId,
    actionId: prepared.run.actions.at(-1)!.id,
    executorId: 'comet-native-archive-apply',
    context: { requestId: 'interrupt-finalize-apply', projectRoot: root },
  });
  const action = run.actions.at(-1)!;
  const context = { requestId: 'interrupt-finalize', projectRoot: root };
  run = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-native-archive-finalize',
    claimToken: 'original-finalize-owner',
    context,
  });
  const applied = run.outputs['archive.execute'].value as {
    transactionId: string;
    archiveRef: string;
  };
  const archiveDir = path.join(paths.archiveDir, applied.archiveRef);
  const transactionFile = path.join(paths.transactionsDir, `portable-archive-${run.runId}.json`);
  const atomic = await import('../../../domains/comet-native/native-atomic-file.js');
  const originalJson = atomic.atomicWriteJson;
  const originalText = atomic.atomicWriteText;
  const originalRename = fs.rename;
  const originalRm = fs.rm;
  let interrupted = false;
  const fail = () => {
    interrupted = true;
    throw Object.assign(new Error(`Injected finalize interruption: ${point}`), { code: 'EIO' });
  };
  vi.spyOn(atomic, 'atomicWriteJson').mockImplementation(async (file, value, options) => {
    const status = (value as { status?: string }).status;
    if (
      !interrupted &&
      ((file === transactionFile && point === 'report-journal' && status === 'report-aligned') ||
        (file === transactionFile && point === 'move-journal' && status === 'moved') ||
        (point === 'runtime-receipt' &&
          file.includes(`${path.sep}sdk-archive-receipts${path.sep}`)))
    )
      fail();
    return originalJson(file, value, options);
  });
  vi.spyOn(atomic, 'atomicWriteText').mockImplementation(async (file, text, options) => {
    if (
      !interrupted &&
      ((point === 'report' && file === path.join(prepared.changeDir, 'verification.md')) ||
        (point === 'portable-receipt' &&
          file === path.join(archiveDir, 'comet-state.yaml') &&
          text.includes('archive_receipt:')))
    )
      fail();
    return originalText(file, text, options);
  });
  vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    if (!interrupted && point === 'move' && source === prepared.changeDir) fail();
    return originalRename(source, target);
  });
  vi.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
    if (!interrupted && point === 'cleanup' && file === transactionFile) fail();
    return originalRm(file, options);
  });
  await expect(
    nativeSdkArchiveFinalizeExecutor.execute(run.actions.at(-1)!, context, run),
  ).rejects.toThrow('Injected finalize interruption');
  expect(interrupted).toBe(true);
  vi.restoreAllMocks();
  run = await runtime.markUnknown({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: `Original host exited at ${point}`,
  });
  return { ...prepared, run, action: run.actions.at(-1)!, applied, archiveDir, transactionFile };
}

it.each([
  'report',
  'report-journal',
  'move',
  'move-journal',
  'portable-receipt',
  'runtime-receipt',
  'cleanup',
] as const)(
  'resumes the original finalize after interruption at %s without replaying applied side effects',
  async (point) => {
    const f = await interruptArchiveFinalization(point);
    const originalTransaction = JSON.parse(await fs.readFile(f.transactionFile, 'utf8'));
    const specFile = path.join(f.paths.specsDir, 'workflow/spec.md');
    const spec = await fs.readFile(specFile, 'utf8');
    const specStat = await fs.stat(specFile);
    const originalRename = fs.rename;
    const moves: unknown[] = [];
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (source === f.changeDir) moves.push([source, target]);
      return originalRename(source, target);
    });
    const recovered = await archiveNativeSdkChange({
      projectRoot: f.root,
      name: f.run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    });
    expect(recovered.exitCode, JSON.stringify(recovered)).toBe(0);
    expect(recovered.data).toMatchObject({
      historicalRecovery: false,
      resumedFinalization: true,
      currentImplementationRevalidated: false,
    });
    const completed = await f.runtime.inspect(f.run.runId);
    expect(completed.status).toBe('completed');
    expect(completed.actions.at(-1)).toMatchObject({
      id: f.action.id,
      attempt: f.action.attempt,
      inputHash: f.action.inputHash,
      claim: f.action.claim,
      status: 'succeeded',
    });
    expect(completed.actions.filter((action) => action.stepId === 'archive.execute')).toHaveLength(
      1,
    );
    expect(completed.outputs['archive.finalize'].value).toMatchObject({
      transactionId: originalTransaction.id,
    });
    expect(moves).toHaveLength(['report', 'report-journal', 'move'].includes(point) ? 1 : 0);
    expect(await fs.readFile(specFile, 'utf8')).toBe(spec);
    expect((await fs.stat(specFile)).mtimeMs).toBe(specStat.mtimeMs);
    await expect(fs.access(f.transactionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    const again = await archiveNativeSdkChange({
      projectRoot: f.root,
      name: f.run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    });
    expect(again.exitCode).toBe(0);
    expect(again.data).toMatchObject({ alreadyArchived: true, historicalRecovery: true });
    expect((await f.runtime.inspect(f.run.runId)).revision).toBe(completed.revision);
  },
);

it.each(['implementation', 'material', 'spec', 'report', 'transaction-id', 'spec-cursor'])(
  'preserves the interrupted finalize when %s no longer matches its original evidence',
  async (drift) => {
    const f = await interruptArchiveFinalization('move-journal');
    const transaction = await fs.readFile(f.transactionFile, 'utf8');
    const files: Record<string, string> = {
      implementation: path.join(f.root, 'implementation.js'),
      material: path.join(f.archiveDir, 'brief.md'),
      spec: path.join(f.paths.specsDir, 'workflow/spec.md'),
      report: path.join(f.archiveDir, 'verification.md'),
      'transaction-id': f.transactionFile,
      'spec-cursor': f.transactionFile,
    };
    const file = files[drift];
    const original = await fs.readFile(file, 'utf8');
    const changed =
      drift === 'transaction-id'
        ? JSON.stringify({ ...JSON.parse(original), id: '00000000-0000-4000-8000-000000000000' })
        : drift === 'spec-cursor'
          ? JSON.stringify({ ...JSON.parse(original), next_spec_index: 0 })
          : `${original}\nChanged after interruption.\n`;
    await fs.writeFile(file, changed);
    await expectArchiveFailure(
      archiveNativeSdkChange({
        projectRoot: f.root,
        name: f.run.runId,
        dryRun: false,
        recover: true,
        confirmed: false,
      }),
    );
    expect(await fs.readFile(file, 'utf8')).toBe(changed);
    expect(await fs.readFile(f.transactionFile, 'utf8')).toBe(
      file === f.transactionFile ? changed : transaction,
    );
    expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)).toEqual(f.action);
    await fs.writeFile(file, original);
    expect(
      (
        await archiveNativeSdkChange({
          projectRoot: f.root,
          name: f.run.runId,
          dryRun: false,
          recover: true,
          confirmed: false,
        })
      ).exitCode,
    ).toBe(0);
  },
);

it('resumes a legacy finalize after rename using the original candidate evidence', async () => {
  const f = await interruptArchiveFinalization('move-journal', true);
  expect(f.run.outputs['archive.prepare'].value).not.toHaveProperty('candidateBinding');
  expect(
    (
      await archiveNativeSdkChange({
        projectRoot: f.root,
        name: f.run.runId,
        dryRun: false,
        recover: true,
        confirmed: false,
      })
    ).exitCode,
  ).toBe(0);
  const completed = await f.runtime.inspect(f.run.runId);
  expect(completed.status).toBe('completed');
  expect(completed.actions.at(-1)).toMatchObject({
    id: f.action.id,
    claim: f.action.claim,
    attempt: 1,
    status: 'succeeded',
  });
});

it('does not overwrite a changed pre-finalization report while resuming the original finalize', async () => {
  const f = await interruptArchiveFinalization('report');
  const reportFile = path.join(f.changeDir, 'verification.md');
  const changed = `${await fs.readFile(reportFile, 'utf8')}\nUnconfirmed report change.\n`;
  await fs.writeFile(reportFile, changed);
  await expectArchiveFailure(
    archiveNativeSdkChange({
      projectRoot: f.root,
      name: f.run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    }),
    /报告/,
  );
  expect(await fs.readFile(reportFile, 'utf8')).toBe(changed);
  expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)).toEqual(f.action);
});

it('rejects a rewritten frozen transaction even when the canonical Spec matches that rewrite', async () => {
  const f = await interruptArchiveFinalization('move-journal');
  const specFile = path.join(f.paths.specsDir, 'workflow/spec.md');
  const transaction = JSON.parse(await fs.readFile(f.transactionFile, 'utf8'));
  const content = '# Workflow\nThis replacement was never confirmed.\n';
  transaction.spec_changes[0].content = content;
  transaction.spec_changes[0].result_hash = createHash('sha256').update(content).digest('hex');
  await fs.writeFile(f.transactionFile, JSON.stringify(transaction));
  await fs.writeFile(specFile, content);
  await expectArchiveFailure(
    archiveNativeSdkChange({
      projectRoot: f.root,
      name: f.run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    }),
    /冻结 Spec/,
  );
  expect(await fs.readFile(specFile, 'utf8')).toBe(content);
  expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)).toEqual(f.action);
});

it('rejects a changed aligned report before moving the active change during recovery', async () => {
  const f = await interruptArchiveFinalization('move');
  const reportFile = path.join(f.changeDir, 'verification.md');
  const report = `${await fs.readFile(reportFile, 'utf8')}\nUnconfirmed report change.\n`;
  await fs.writeFile(reportFile, report);
  await expectArchiveFailure(
    archiveNativeSdkChange({
      projectRoot: f.root,
      name: f.run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    }),
    /报告/,
  );
  expect(await fs.readFile(reportFile, 'utf8')).toBe(report);
  await expect(fs.access(f.archiveDir)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)).toEqual(f.action);
});

it('keeps recovery blocked when neither the original transaction nor a complete receipt survived', async () => {
  const f = await interruptArchiveFinalization('move-journal');
  await fs.rm(f.transactionFile);
  await expectArchiveFailure(
    archiveNativeSdkChange({
      projectRoot: f.root,
      name: f.run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    }),
    /receipt/,
  );
  expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)).toEqual(f.action);
  await expect(fs.access(f.transactionFile)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('recovers original archive history after a subsequent legitimate archive changes canonical Specs', async () => {
  const f = await awaitingArchiveApplication('sdk', undefined, false, initializeArchiveGit);
  let a = await f.runtime.execute({
    runId: f.run.runId,
    actionId: f.run.actions.at(-1)!.id,
    executorId: 'comet-native-archive-apply',
    context: { requestId: 'a-apply', projectRoot: f.root },
  });
  const action = a.actions.at(-1)!;
  const context = { requestId: 'a-finalize', projectRoot: f.root };
  a = await f.runtime.claim({
    runId: a.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-native-archive-finalize',
    claimToken: 'a-finalize',
    context,
  });
  await nativeSdkArchiveFinalizeExecutor.execute(a.actions.at(-1)!, context, a);
  a = await f.runtime.markUnknown({
    runId: a.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: 'Host exited after complete durable finalization.',
  });
  await createLegacyNativeSdkChange(f.root, 'second-work');
  const { runtime } = await loadOwnedNativeSdkRuntime(f.root, 'second-work');
  const change = path.join(f.paths.changesDir, 'second-work');
  const archiveRef = (a.outputs['archive.execute'].value as { archiveRef: string }).archiveRef;
  await fs.copyFile(
    path.join(f.paths.archiveDir, archiveRef, 'brief.md'),
    path.join(change, 'brief.md'),
  );
  await fs.mkdir(path.join(change, 'specs/workflow'), { recursive: true });
  await fs.writeFile(
    path.join(change, 'specs/workflow/spec.md'),
    '# Workflow\nThe second approved workflow adds safe recovery for the user.\n',
  );
  let b = await runtime.inspect('second-work');
  b = await succeedLatestAction(
    runtime,
    b,
    await collectProposal(f.paths, b.state as NativePortableState),
    f.root,
    'b-shape',
  );
  const wait = b.waits.at(-1)!;
  b = await runtime.resolveWait({
    runId: b.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'b-shape-approved',
    choice: 'approved',
  });
  b = await succeedLatestAction(
    runtime,
    b,
    await collectProposal(f.paths, b.state as NativePortableState),
    f.root,
    'b-revalidate',
  );
  b = await succeedLatestAction(
    runtime,
    b,
    {
      summary: 'Implement the second workflow.',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [],
      knownLimits: [],
      review: null,
      submittedAt: '2026-10-20T00:00:00.000Z',
      verificationChecks: [],
    },
    f.root,
    'b-builder',
    'b-builder-session',
  );
  b = await runtime.execute({
    runId: b.runId,
    actionId: b.actions.at(-1)!.id,
    executorId: 'comet-native-checks',
    context: { requestId: 'b-checks', projectRoot: f.root },
  });
  b = await succeedLatestAction(
    runtime,
    b,
    {
      candidateId: (b.state as NativePortableState).builder_handoff!.candidate_id,
      verifierExecutionRef: 'b-verifier-session',
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'pass',
          acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified second work.' }],
          risks: [],
          summary: 'Second workflow passed.',
        },
      },
    },
    f.root,
    'b-verifier',
    'b-verifier-session',
  );
  for (const executorId of [
    'comet-native-report',
    'comet-native-report-revalidate',
    'comet-native-archive-preflight',
    'comet-native-archive-apply',
    'comet-native-archive-finalize',
  ]) {
    if (b.waits.at(-1)?.stepId === 'verify.confirm' && b.waits.at(-1)?.status === 'pending') {
      const w = b.waits.at(-1)!;
      b = await runtime.resolveWait({
        runId: b.runId,
        waitId: w.id,
        proposalHash: w.proposalHash,
        decisionId: 'b-verify-approved',
        choice: 'approved',
      });
    }
    b = await runtime.execute({
      runId: b.runId,
      actionId: b.actions.at(-1)!.id,
      executorId,
      context: { requestId: `b-${executorId}`, projectRoot: f.root },
    });
  }
  expect(b.status).toBe('completed');
  const doctor = await nativeDomain.runNativeCliDetailed([
    'doctor',
    a.runId,
    '--repair',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(doctor.dispatch.exitCode).not.toBe(0);
  const reportFile = path.join(f.paths.archiveDir, archiveRef, 'verification.md');
  const report = await fs.readFile(reportFile, 'utf8');
  await fs.writeFile(reportFile, report + '\nChanged historical evidence.\n');
  const tampered = await nativeDomain.runNativeCliDetailed([
    'archive',
    a.runId,
    '--recover',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(tampered.dispatch.exitCode).not.toBe(0);
  expect((await f.runtime.inspect(a.runId)).actions.at(-1)?.status).toBe('unknown');
  await fs.writeFile(reportFile, report);
  const recover = await nativeDomain.runNativeCliDetailed([
    'archive',
    a.runId,
    '--recover',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(recover.dispatch.exitCode, JSON.stringify(recover.dispatch)).toBe(0);
});

it('rejects cancellation before committing when applied Archive Specs still have a transaction', async () => {
  const f = await awaitingArchiveApplication('sdk', undefined, false, initializeArchiveGit);
  const run = await f.runtime.execute({
    runId: f.run.runId,
    actionId: f.run.actions.at(-1)!.id,
    executorId: 'comet-native-archive-apply',
    context: { requestId: 'cancel-archive-apply', projectRoot: f.root },
  });
  const before = await f.runtime.inspect(run.runId);
  const preview = await nativeDomain.runNativeCliDetailed([
    'cancel',
    run.runId,
    '--dry-run',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(preview.dispatch.exitCode).not.toBe(0);
  const result = await nativeDomain.runNativeCliDetailed([
    'cancel',
    run.runId,
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(result.dispatch.exitCode).not.toBe(0);
  expect(await f.runtime.inspect(run.runId)).toEqual(before);
  await expect(f.runtime.cancel({ runId: run.runId, reason: 'SDK cancellation' })).rejects.toThrow(
    'transaction must finish',
  );
  expect(await f.runtime.inspect(run.runId)).toEqual(before);
  expect(
    (
      await archiveNativeSdkChange({
        projectRoot: f.root,
        name: run.runId,
        dryRun: false,
        recover: false,
        confirmed: false,
      })
    ).exitCode,
  ).toBe(0);
  expect((await f.runtime.inspect(run.runId)).status).toBe('completed');
});

it('recovers the durable transaction left by legacy cancellation without restarting the cancelled Run', async () => {
  const f = await awaitingArchiveApplication('sdk', undefined, false, initializeArchiveGit);
  const run = await f.runtime.execute({
    runId: f.run.runId,
    actionId: f.run.actions.at(-1)!.id,
    executorId: 'comet-native-archive-apply',
    context: { requestId: 'legacy-cancel-apply', projectRoot: f.root },
  });
  // 通过原 SDK 取消语义注入旧版本故障：绕过新增领域存储保护，保留真实 CAS 与取消记录。
  const legacyRuntime = createRuntime({
    store: createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs', 'native'),
    }),
    workflows: [f.application.workflow],
    transitionHandlers: [f.application.transitionHandler],
    validators: f.application.validators,
    stateValidators: f.application.stateValidators,
    commandValidators: f.application.commandValidators,
  });
  await legacyRuntime.cancel({
    runId: run.runId,
    reason: 'Legacy cancellation after Specs applied',
  });
  const cancelled = await f.runtime.inspect(run.runId);
  expect(cancelled.status).toBe('cancelled');
  const { readCometCurrentSelection, writeCometCurrentSelection } =
    await import('../../../domains/workflow-contract/current-selection.js');
  await writeCometCurrentSelection(f.root, {
    schema: 'comet.selection.v2',
    workflow: 'native',
    change: run.runId,
    branch: null,
  });
  const selected = await readCometCurrentSelection(f.root);
  const stopped = await reconcileNativeSdkExecutionStops(f.root, cancelled, f.runtime);
  expect(stopped.status).toBe('cancelled');
  expectOriginalActionFacts(stopped, cancelled.actions);
  expect(await readCometCurrentSelection(f.root)).toEqual(selected);
  const durableStore = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs/native'),
  });
  expect(await durableStore.readPartitionMetadata(run.runId)).toBe('active');
  expect(await fs.readdir(f.paths.transactionsDir)).toContain(`portable-archive-${run.runId}.json`);
  const result = await nativeDomain.runNativeCliDetailed([
    'archive',
    run.runId,
    '--recover',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(result.dispatch.exitCode, JSON.stringify(result.dispatch)).toBe(0);
  expect(result.dispatch.data).toMatchObject({ recoveredCancelledArchive: true, cancelled: true });
  const after = await f.runtime.inspect(run.runId);
  expect(after.status).toBe('cancelled');
  expect(after.actions.at(-1)?.status).toBe('cancelled');
  expect(await durableStore.readPartitionMetadata(run.runId)).toBe('closed');
  expect(await readCometCurrentSelection(f.root)).toEqual({
    status: 'missing',
  });
  await fs.writeFile(path.join(f.root, 'implementation.js'), 'export const later = true;');
  const repeated = await nativeDomain.runNativeCliDetailed([
    'archive',
    run.runId,
    '--recover',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(repeated.dispatch.exitCode, JSON.stringify(repeated.dispatch)).toBe(0);
  expect(await fs.readdir(f.paths.transactionsDir)).not.toContain(
    `portable-archive-${run.runId}.json`,
  );
  const next = await nativeDomain.runNativeCliDetailed([
    'new',
    'after-recovered-cancel',
    '--isolation',
    'current',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(next.dispatch.exitCode, JSON.stringify(next.dispatch)).toBe(0);
});

it('rejects cancellation of a claimed Archive writer before it creates its transaction', async () => {
  const f = await awaitingArchiveApplication('sdk', undefined, false, initializeArchiveGit);
  const action = f.run.actions.at(-1)!;
  const run = await f.runtime.claim({
    runId: f.run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-native-archive-apply',
    claimToken: 'inflight-archive',
    context: { requestId: 'inflight-archive', projectRoot: f.root },
  });
  await expect(
    f.runtime.cancel({ runId: run.runId, reason: 'Cancel in-flight writer' }),
  ).rejects.toThrow('execution must finish or recover');
  expect(await f.runtime.inspect(run.runId)).toEqual(run);
});

it('keeps real check stop proof through cancel and cold copy without replay', async () => {
  const plan = {
    id: 'once',
    name: 'Real original execution',
    executable: process.execPath,
    argv: [
      '-e',
      "const fs=require('node:fs'); fs.mkdirSync('dist',{recursive:true}); fs.appendFileSync('dist/cold-stop-count', 'once\\n')",
    ],
    cwdRef: '.',
    timeoutMs: 5000,
    repeatable: false,
  };
  const f = await dispatchedVerifier([plan], 'sdk');
  expect(await fs.readFile(path.join(f.root, 'dist', 'cold-stop-count'), 'utf8')).toBe('once\n');
  const cancelled = await runNativeCli(['cancel', f.run.runId, '--project-root', f.root, '--json']);
  expect(cancelled.exitCode, cancelled.stderr).toBe(0);
  const original = await f.runtime.inspect(f.run.runId);
  const check = original.actions.find((action) => action.ref === 'native-required-checks')!;
  expect(check.executionStop).toBeDefined();
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cold-stop-project-'));
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cold-stop-data-'));
  roots.push(target, data);
  await fs.cp(f.root, target, { recursive: true });
  const previous = process.env.COMET_DATA_DIR;
  process.env.COMET_DATA_DIR = data;
  try {
    const repair = await nativeDoctorCommand([f.run.runId, '--repair', '--confirmed'], target);
    expect(repair.exitCode, JSON.stringify(repair)).toBe(0);
    const doctor = await nativeDoctorCommand([f.run.runId], target);
    expect(doctor.exitCode, JSON.stringify(doctor)).toBe(0);
    const next = await runNativeCli(['next', f.run.runId, '--project-root', target, '--json']);
    expect(next.exitCode, next.stderr).toBe(0);
    expect(JSON.parse(next.stdout!).data).toMatchObject({
      status: 'cancelled',
      diagnostics: { healthy: true },
    });
    expect(await fs.readFile(path.join(target, 'dist', 'cold-stop-count'), 'utf8')).toBe('once\n');
  } finally {
    if (previous === undefined) delete process.env.COMET_DATA_DIR;
    else process.env.COMET_DATA_DIR = previous;
  }
});

it.each(['generated-output', 'implementation', 'material', 'transaction'] as const)(
  'recovers an applied unknown Archive through the public CLI with %s changes',
  async (change) => {
    const f = await awaitingArchiveApplication('sdk', undefined, false, async (root) => {
      await initializeArchiveGit(root);
      await fs.writeFile(path.join(root, '.gitignore'), '.next/\n');
      await fs.mkdir(path.join(root, '.next/server'), { recursive: true });
      await fs.writeFile(path.join(root, '.next/server/output.js'), 'original generated output');
    });
    const action = f.run.actions.at(-1)!;
    const context = { requestId: 'lost-apply', projectRoot: f.root };
    const claimed = await f.runtime.claim({
      runId: f.run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: nativeSdkArchiveApplyExecutor.id,
      claimToken: 'original-apply-claim',
      context,
    });
    if (process.env.COMET_TEST_PACKAGE_ROOT) {
      const input = path.join(f.paths.runtimeDir, 'interrupted-archive-input.json');
      await fs.writeFile(input, JSON.stringify({ run: claimed, context }));
      const worker = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import fs from 'node:fs';
        const input=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
        const {nativeSdkArchiveApplyExecutor}=await import(process.argv[2]);
        await nativeSdkArchiveApplyExecutor.execute(input.run.actions.at(-1),input.context,input.run);
        process.stdout.write('SPECS_APPLIED\\n');
        setInterval(()=>{},1000);
      `,
          input,
          pathToFileURL(
            path.join(
              process.env.COMET_TEST_PACKAGE_ROOT,
              'dist/domains/comet-native/native-sdk-archive.js',
            ),
          ).href,
        ],
        {
          cwd: f.root,
          env: { ...process.env, COMET_DAEMON: 'off' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      await new Promise<void>((resolve, reject) => {
        let output = '';
        let errors = '';
        let applied = false;
        const timer = setTimeout(() => {
          worker.kill('SIGKILL');
          reject(new Error('Archive worker did not reach applied Specs'));
        }, 30_000);
        worker.stdout.on('data', (chunk) => {
          output += chunk.toString();
          if (output.includes('SPECS_APPLIED') && !applied) {
            applied = true;
            worker.kill('SIGKILL');
          }
        });
        worker.stderr.on('data', (chunk) => {
          errors += chunk.toString();
        });
        worker.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        worker.once('close', () => {
          clearTimeout(timer);
          if (applied) resolve();
          else reject(new Error(`Archive worker stopped before applying Specs: ${errors}`));
        });
      });
    } else await nativeSdkArchiveApplyExecutor.execute(claimed.actions.at(-1)!, context, claimed);
    const unknown = await f.runtime.markUnknown({
      runId: f.run.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Original Archive process stopped after writing Specs',
    });
    const lost = await reconcileNativeSdkExecutionStops(f.root, unknown, f.runtime);
    const cli = async (args: string[]) => {
      if (!process.env.COMET_TEST_PACKAGE_ROOT) return nativeDomain.runNativeCliDetailed(args);
      const result = spawnSync(
        process.execPath,
        [path.join(process.env.COMET_TEST_PACKAGE_ROOT, 'bin/comet.js'), 'native', ...args],
        { cwd: f.root, encoding: 'utf8', env: { ...process.env, COMET_DAEMON: 'off' } },
      );
      expect(result.error).toBeUndefined();
      return { dispatch: JSON.parse(result.stdout) };
    };
    const transactionFile = path.join(
      f.paths.transactionsDir,
      `portable-archive-${f.run.runId}.json`,
    );
    const transaction = await fs.readFile(transactionFile, 'utf8');
    const specFile = path.join(f.paths.specsDir, 'workflow/spec.md');
    const spec = await fs.readFile(specFile);
    const specStat = await fs.stat(specFile);
    if (change === 'generated-output')
      await fs.writeFile(path.join(f.root, '.next/server/output.js'), 'rebuilt output');
    if (change === 'implementation')
      await fs.appendFile(path.join(f.root, 'implementation.js'), '\nexport const unsafe = true;');
    if (change === 'material')
      await fs.appendFile(path.join(f.changeDir, 'brief.md'), '\nUnapproved scope.');
    if (change === 'transaction') {
      const value = JSON.parse(transaction);
      value.spec_changes[0].content = '# Workflow\nUnconfirmed replacement.\n';
      value.spec_changes[0].result_hash = createHash('sha256')
        .update(value.spec_changes[0].content)
        .digest('hex');
      await fs.writeFile(transactionFile, JSON.stringify(value));
      await fs.writeFile(specFile, value.spec_changes[0].content);
    }
    const recovered = await cli([
      'archive',
      f.run.runId,
      '--recover',
      '--project-root',
      f.root,
      '--json',
    ]);
    if (change !== 'generated-output') {
      expect(recovered.dispatch.exitCode).not.toBe(0);
      expect(await f.runtime.inspect(f.run.runId)).toEqual(lost);
      return;
    }
    expect(recovered.dispatch.exitCode, JSON.stringify(recovered.dispatch)).toBe(0);
    expect(recovered.dispatch.data).toMatchObject({
      historicalRecovery: true,
      currentImplementationRevalidated: false,
    });
    const completed = await cli(['archive', f.run.runId, '--project-root', f.root, '--json']);
    expect(completed.dispatch.exitCode, JSON.stringify(completed.dispatch)).toBe(0);
    const run = await f.runtime.inspect(f.run.runId);
    expect(run.status).toBe('completed');
    expect(run.actions.find((entry) => entry.id === action.id)).toMatchObject({
      attempt: action.attempt,
      inputHash: action.inputHash,
      status: 'succeeded',
    });
    expect(run.actions.filter((entry) => entry.stepId === 'archive.execute')).toHaveLength(1);
    expect(await fs.readFile(specFile)).toEqual(spec);
    expect((await fs.stat(specFile)).mtimeMs).toBe(specStat.mtimeMs);
    await expect(fs.access(transactionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    const again = await cli([
      'archive',
      f.run.runId,
      '--recover',
      '--project-root',
      f.root,
      '--json',
    ]);
    expect(again.dispatch.exitCode, JSON.stringify(again.dispatch)).toBe(0);
    expect((await f.runtime.inspect(f.run.runId)).revision).toBe(run.revision);
    const next = await cli([
      'new',
      'after-recovery',
      '--isolation',
      'current',
      '--project-root',
      f.root,
      '--json',
    ]);
    expect(next.dispatch.exitCode, JSON.stringify(next.dispatch)).toBe(0);
  },
);

describe('Native streamlined verification', () => {
  it('uses the current session for v2 acceptance through the public continuation', async () => {
    const {
      root,
      runtime,
      run: prepared,
    } = await dispatchedVerifier([], 'sdk', nativeApplication('2'), false);
    const next = await runNativeCli(['next', prepared.runId, '--project-root', root, '--json']);
    expect(next.exitCode).toBe(0);
    const run = await runtime.inspect(prepared.runId);
    const pending = await projectNativeSdkContinuation({
      run,
      state: run.state as NativePortableState,
      projectRoot: root,
    });
    expect(pending.pendingAction?.sessionRequirements).toMatchObject({
      independent: false,
      readOnly: true,
      mustDifferFromSessionId: null,
    });
    const finished = await succeedLatestAction(
      runtime,
      run,
      {
        candidateId: (run.state as NativePortableState).builder_handoff!.candidate_id,
        verifierExecutionRef: 'builder-session-1',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [
              {
                id: 'A1',
                result: 'passed',
                reason: 'Checked the approved behavior against the implementation.',
              },
            ],
            risks: [],
            summary: 'Acceptance completed in the actual current session.',
          },
        },
      },
      root,
      'current-session-verification',
      'builder-session-1',
    );
    expect(finished.actions.at(-1)?.stepId).toBe('verify.report');
    expect(finished.waits.some((wait) => wait.stepId === 'verify.confirm')).toBe(false);
    const reported = await runtime.execute({
      runId: run.runId,
      actionId: finished.actions.at(-1)!.id,
      executorId: 'comet-native-report',
      context: { requestId: 'current-session-report', projectRoot: root },
    });
    expect(reported.waits.at(-1)).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
  });

  it('rejects one-time check plans before v2 verification execution', async () => {
    await expect(
      dispatchedVerifier(
        [
          {
            id: 'one-time',
            name: 'One-time mutation',
            executable: process.execPath,
            argv: ['-e', 'process.exit(0)'],
            cwdRef: '.',
            timeoutMs: 5000,
            repeatable: false,
          },
        ],
        'memory',
        nativeApplication('2'),
      ),
    ).rejects.toThrow(/repeatable/i);
  });
});

it('returns one receipt result template for a claimed v2 Verifier', async () => {
  const { root, runtime, run } = await dispatchedVerifier([], 'memory', nativeApplication('2'));
  const action = run.actions.at(-1)!;
  const claimed = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: 'builder-session-1',
    claimToken: 'compact-verifier',
    context: { requestId: 'compact-claim', projectRoot: root },
  });
  const response = await projectNativeSdkDispatchResult({
    run: claimed,
    state: claimed.state as NativePortableState,
    actionId: action.id,
    projectRoot: root,
  });
  expect(response.resultRequest).toMatchObject({
    operation: 'record-outcome',
    receipt: expect.any(String),
    result: { status: 'succeeded' },
  });
  expect(response).not.toHaveProperty('outcomeRequest');
  expect(response.checkRequestTemplate).toMatchObject({ repeatable: true });
  expect(response.activeActions?.[0]).not.toHaveProperty('outcomeRequest');
  expect(response.activeActions?.[0]).not.toHaveProperty('resultRequest');
});

describe('Native v3 Build check reuse', () => {
  it.each([false, true, 'failed-later'])(
    'reuses a Build check only while inputs match (edited=%s)',
    async (edited) => {
      const f = await preparedShape('sdk', nativeApplication('3'));
      const wait = f.run.waits.at(-1)!;
      let run = await f.runtime.resolveWait({
        runId: f.run.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'build-check-shape',
        choice: 'approved',
      });
      run = await succeedLatestAction(
        f.runtime,
        run,
        await collectProposal(f.paths, run.state as NativePortableState),
        f.root,
        'shape-checked',
      );
      const plans = [
        {
          id: 'unit',
          name: 'Unit',
          executable: process.execPath,
          argv: ['-e', "process.exit(require('fs').existsSync('fail-marker') ? 1 : 0)"],
          cwdRef: '.',
          timeoutMs: 10000,
          repeatable: true,
        },
      ];
      run = await succeedLatestAction(
        f.runtime,
        run,
        { response: { kind: 'request-checks', checks: plans } },
        f.root,
        'build-check-request',
        'builder-session-1',
      );
      expect(run.actions.at(-1)?.stepId).toBe('build.checks');
      run = await f.runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'build-check-execute', projectRoot: f.root },
      });
      const original = run.actions.find((action) => action.stepId === 'build.checks')!;
      expect(original.status).toBe('succeeded');
      expect(run.actions.at(-1)?.stepId).toBe('build.builder');
      expect(
        (
          nativeSdkTaskResultTemplate(run, run.actions.at(-1)!).output as {
            verificationChecks: unknown;
          }
        ).verificationChecks,
      ).toEqual(plans);
      if (edited === 'failed-later') {
        await fs.writeFile(path.join(f.root, 'fail-marker'), 'fail');
        run = await succeedLatestAction(
          f.runtime,
          run,
          { response: { kind: 'request-checks', checks: plans } },
          f.root,
          'failed-check-request',
          'builder-session-1',
        );
        run = await f.runtime.execute({
          runId: run.runId,
          actionId: run.actions.at(-1)!.id,
          executorId: 'comet-native-checks',
          context: { requestId: 'failed-build-check', projectRoot: f.root },
        });
        expect(
          run.actions.filter((action) => action.stepId === 'build.checks').at(-1)?.status,
        ).toBe('failed');
        await fs.unlink(path.join(f.root, 'fail-marker'));
      }
      if (edited === true)
        await fs.writeFile(path.join(f.root, 'implementation.ts'), 'export const value = 1;');
      run = await succeedLatestAction(
        f.runtime,
        run,
        { summary: 'Implementation ready', checks: [], knownLimits: [], verificationChecks: plans },
        f.root,
        'builder-final',
        'builder-session-1',
      );
      expect(run.actions.at(-1)?.stepId).toBe('verify.checks');
      run = await f.runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'verify-reuse', projectRoot: f.root },
      });
      const result = run.actions.find((action) => action.stepId === 'verify.checks')!.outcome!
        .output as { checks: Array<{ reusedFrom?: { actionId: string } }> };
      if (edited) expect(result.checks[0].reusedFrom).toBeUndefined();
      else expect(result.checks[0].reusedFrom?.actionId).toBe(original.id);
      expect(
        (run.state as NativePortableState).acceptance.every((item) => item.result === 'pending'),
      ).toBe(true);
    },
  );
});

it('omits unused recovery and failure templates for a healthy v3 Verifier', async () => {
  const { root, runtime, run } = await dispatchedVerifier([], 'memory', nativeApplication('3'));
  const action = run.actions.at(-1)!;
  const claimed = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: 'builder-session-1',
    claimToken: 'compact-verifier',
    context: { requestId: 'compact-claim', projectRoot: root },
  });
  const response = await projectNativeSdkDispatchResult({
    run: claimed,
    state: claimed.state as NativePortableState,
    actionId: action.id,
    projectRoot: root,
  });
  expect(response.resultRequest).toMatchObject({
    operation: 'record-outcome',
    receipt: expect.any(String),
    result: { status: 'succeeded' },
  });
  expect(response).not.toHaveProperty('outcomeRequest');
  expect(response.checkRequestTemplate).toMatchObject({ repeatable: true });
  expect(response.activeActions?.[0]).not.toHaveProperty('outcomeRequest');
  expect(response.activeActions?.[0]).not.toHaveProperty('resultRequest');
  expect(response).not.toHaveProperty('failureOutcomeRequest');
  expect(response).not.toHaveProperty('requestChecksOutcomeRequest');
  expect(response).not.toHaveProperty('markUnknownRequest');
  expect(response.activeActions?.[0]).not.toHaveProperty('failureOutcomeRequestRef');
  expect(response.activeActions?.[0]).not.toHaveProperty('requestChecksOutcomeRequestRef');
});

async function verifiedV3Candidate(application = nativeApplication('3')) {
  const prepared = await dispatchedVerifier(
    [],
    'sdk',
    application,
    true,
    undefined,
    allowAgentDocumentReview,
  );
  const { root, runtime } = prepared;
  const state = prepared.run.state as NativePortableState;
  const run = await succeedLatestAction(
    runtime,
    prepared.run,
    {
      candidateId: state.builder_handoff!.candidate_id,
      verifierExecutionRef: 'v3-verifier',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'pass',
          acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified the approved criterion.' }],
          risks: [],
          summary: 'The candidate satisfies the approved requirement.',
        },
      },
    },
    root,
    'v3-verified',
    'v3-verifier',
  );
  return { ...prepared, run };
}

describe('Native SDK v3 checkpoint and report boundaries', () => {
  it('commits acceptance without report Actions and retries a failed view without changing the decision', async () => {
    const { root, runtime, run, changeDir } = await verifiedV3Candidate();
    expect(run.actions.some((action) => action.stepId === 'verify.report')).toBe(false);
    const wait = run.waits.at(-1)!;
    expect(wait).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
    const report = path.join(changeDir, 'verification.md');
    await fs.mkdir(report);
    const failedView = await runNativeCli(['next', run.runId, '--project-root', root, '--json']);
    expect(failedView.exitCode, failedView.stderr).toBe(0);
    expect(JSON.parse(failedView.stdout).data).toMatchObject({
      warning: { code: 'NATIVE_REPORT_PENDING' },
    });
    const committed = await runtime.inspect(run.runId);
    expect(committed.actions).toHaveLength(run.actions.length);
    expect(committed.waits.at(-1)).toEqual(wait);
    expect(committed.state).toMatchObject({ verification_result: 'pass' });
    await fs.rmdir(report);
    const retry = await runNativeCli(['next', run.runId, '--project-root', root, '--json']);
    expect(retry.exitCode, retry.stderr).toBe(0);
    expect(JSON.parse(retry.stdout).data).not.toHaveProperty('warning');
    expect(await fs.readFile(report, 'utf8')).toContain('Verified the approved criterion.');
    expect((await runtime.inspect(run.runId)).revision).toBe(committed.revision);
  });

  it('combines approved report validation with preflight and checkpoints only the next external boundary', async () => {
    const { root, runtime, run, changeDir } = await verifiedV3Candidate();
    const stateFile = path.join(changeDir, 'comet-state.yaml');
    const checkpoint = await fs.readFile(stateFile, 'utf8');
    const wait = run.waits.at(-1)!;
    const approved = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'v3-approved',
      choice: 'approved',
    });
    expect(approved.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', status: 'pending' });
    expect(approved.actions.some((action) => action.stepId === 'verify.revalidate')).toBe(false);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(checkpoint);
    const encodes = vi.spyOn(portableCheckpoints, 'encodePortableRunCheckpoint');
    const prepared = await runtime.execute({
      runId: run.runId,
      actionId: approved.actions.at(-1)!.id,
      executorId: 'comet-native-archive-preflight',
      context: { requestId: 'v3-preflight', projectRoot: root },
    });
    expect(prepared.actions.at(-1)).toMatchObject({ stepId: 'archive.execute', status: 'pending' });
    expect(encodes).toHaveBeenCalledTimes(1);
    const portable = parseYaml(await fs.readFile(stateFile, 'utf8'));
    expect(portable.run_checkpoint.sourceRevision).toBe(prepared.revision);
    expect(portable.phase).toBe('archive');
    const archived = await runNativeCli(['archive', run.runId, '--project-root', root, '--json']);
    expect(archived.exitCode, archived.stderr).toBe(0);
    expect((await runtime.inspect(run.runId)).status).toBe('completed');
    const repeated = await runNativeCli([
      'archive',
      run.runId,
      '--recover',
      '--project-root',
      root,
      '--json',
    ]);
    expect(repeated.exitCode, repeated.stderr).toBe(0);
  });

  it('reads the SDK authority without portable repairs and guards its newer phase', async () => {
    const { root, runtime, run, changeDir } = await verifiedV3Candidate();
    const wait = run.waits.at(-1)!;
    const approved = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'v3-authority-approved',
      choice: 'approved',
    });
    const stateFile = path.join(changeDir, 'comet-state.yaml');
    const source = await fs.readFile(stateFile, 'utf8');
    expect(parseYaml(source).phase).toBe('verify');
    const encodes = vi.spyOn(portableCheckpoints, 'encodePortableRunCheckpoint');
    const locks = vi.spyOn(checkpointLocks, 'withRecoverableFileLock');
    const store = createNativeSdkStateStore(root, { readOnly: true });
    expect((await store.read(run.runId))?.state).toEqual(approved.state);
    const guarded = await inspectNativeHookGuard(
      root,
      {
        intent: 'write',
        targets: ['src/index.ts'],
      },
      run.runId,
    );
    expect(guarded).toMatchObject({ allowed: true, phase: 'archive' });
    expect(guarded.reason).toContain('edit-review observe native');
    expect(encodes).not.toHaveBeenCalled();
    expect(locks).not.toHaveBeenCalled();
    expect(await fs.readFile(stateFile, 'utf8')).toBe(source);
    expect(
      await fs
        .stat(
          path.join(
            resolveWorkspaceRuntimeRootSync(root),
            'state-projections/native',
            `${run.runId}.json`,
          ),
        )
        .catch(() => null),
    ).toBeNull();
  });

  it('recovers an external claim as unknown from its boundary checkpoint', async () => {
    const { root, runtime, run, changeDir } = await dispatchedVerifier(
      [],
      'sdk',
      nativeApplication('3'),
    );
    const action = run.actions.at(-1)!;
    const claimed = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: 'v3-active-verifier',
      claimToken: 'v3-claim',
      context: { requestId: 'v3-claim', projectRoot: root },
    });
    const checkpoint = parseYaml(
      await fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8'),
    );
    expect(checkpoint.run_checkpoint.sourceRevision).toBe(claimed.revision);
    const runDirectory = path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native');
    expect(path.relative(resolveWorkspaceRuntimeRootSync(root), runDirectory)).toBe(
      path.join('sdk-runs', 'native'),
    );
    await fs.rm(runDirectory, { recursive: true });
    await expect(
      createNativeSdkStateStore(root, { readOnly: true }).read(run.runId),
    ).rejects.toThrow(/checkpoint recovery/);
    const repair = await runNativeCli([
      'doctor',
      run.runId,
      '--repair',
      '--confirmed',
      '--project-root',
      root,
      '--json',
    ]);
    expect(repair.exitCode, repair.stderr || repair.stdout).toBe(65);
    expect(JSON.parse(repair.stdout).data).toMatchObject({
      repaired: true,
      healthy: false,
      findings: expect.arrayContaining([
        expect.objectContaining({
          code: 'sdk-action-outcome-unresolved',
          actionId: action.id,
          status: 'unknown',
        }),
      ]),
    });
    const restored = await createNativeSdkStateStore(root, { readOnly: true }).read(run.runId);
    expect(restored?.revision).toBe(claimed.revision);
    expect(restored?.actions.at(-1)).toMatchObject({
      id: action.id,
      status: 'unknown',
      attempt: action.attempt,
    });
    expect(restored?.actions.at(-1)?.claim?.sessionId).toBe('v3-active-verifier');
  });

  it('preserves edited report text while regenerating its derived reading view', async () => {
    const { root, run, changeDir } = await verifiedV3Candidate();
    const original = '# Human notes\nKeep this exact original text.\n';
    await fs.writeFile(path.join(changeDir, 'verification.md'), original);
    await refreshNativeSdkVerificationReport(root, run);
    const hash = createHash('sha256').update(original).digest('hex');
    const backup = path.join(
      resolveWorkspaceRuntimeRootSync(root),
      'native/preserved-verification',
      hashRuntimeValue(run.runId),
      `${hash}.md`,
    );
    expect(await fs.readFile(backup, 'utf8')).toBe(original);
    expect(await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8')).toContain(
      'Verified the approved criterion.',
    );
  });
});

it.each(['missing', 'edited'] as const)(
  'completes v3 Archive with a %s report when view rendering fails and preserves its receipt',
  async (view) => {
    const { root, runtime, run, changeDir, paths } = await verifiedV3Candidate();
    const original = '# Human report\nKeep this original despite a rendering failure.\n';
    if (view === 'edited') await fs.writeFile(path.join(changeDir, 'verification.md'), original);
    vi.spyOn(nativeReportView, 'writeNativeVerificationReport').mockRejectedValue(
      new Error('Simulated reading-view write failure'),
    );
    const wait = run.waits.at(-1)!;
    await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: `v3-optional-view-${view}`,
      choice: 'approved',
    });
    const result = await runNativeCli(['archive', run.runId, '--project-root', root, '--json']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      warning: { code: 'NATIVE_REPORT_PENDING' },
    });
    const completed = await runtime.inspect(run.runId);
    expect(completed.status).toBe('completed');
    const receipt = completed.outputs['archive.finalize'].value as {
      reportSha256: string | null;
      archiveRef: string;
      verificationResultHash: string;
    };
    expect(receipt.verificationResultHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.reportSha256).toBe(
      view === 'edited' ? createHash('sha256').update(original).digest('hex') : null,
    );
    if (view === 'edited')
      expect(
        await fs.readFile(
          path.join(paths.archiveDir, receipt.archiveRef, 'verification.md'),
          'utf8',
        ),
      ).toBe(original);
    const recovered = await runNativeCli([
      'archive',
      run.runId,
      '--recover',
      '--project-root',
      root,
      '--json',
    ]);
    expect(recovered.exitCode, recovered.stderr).toBe(0);
    expect((await runtime.inspect(run.runId)).outputs['archive.finalize'].value).toEqual(receipt);
  },
);

it('rejects candidate drift before v3 Archive publication after merging the revalidation Action', async () => {
  const prepared = await dispatchedVerifier(
    [],
    'sdk',
    nativeApplication('3'),
    true,
    undefined,
    async (root) => {
      await fs.writeFile(path.join(root, 'implementation.js'), 'export const value = true;');
    },
  );
  const { root, runtime, paths } = prepared;
  const state = prepared.run.state as NativePortableState;
  const run = await succeedLatestAction(
    runtime,
    prepared.run,
    {
      candidateId: state.builder_handoff!.candidate_id,
      verifierExecutionRef: 'v3-drift-verifier',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'pass',
          acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified original implementation.' }],
          risks: [],
          summary: 'Original candidate passed.',
        },
      },
    },
    root,
    'v3-drift-result',
    'v3-drift-verifier',
  );
  await fs.writeFile(path.join(root, 'implementation.js'), 'export const value = false;');
  const wait = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'v3-drift-approved',
    choice: 'approved',
  });
  const archived = await runNativeCli(['archive', run.runId, '--project-root', root, '--json']);
  expect(archived.exitCode).toBe(73);
  expect((await runtime.inspect(run.runId)).state).toMatchObject({
    phase: 'verify',
    verification_result: 'pending',
  });
  expect(
    await fs.stat(path.join(paths.specsDir, 'workflow', 'spec.md')).catch(() => null),
  ).toBeNull();
});

it('uses the shared default transition handler for v3 acceptance and Archive preflight', async () => {
  const application = nativeApplication('3');
  application.transitionHandler = nativeApplication('1').transitionHandler;
  const { runtime, run } = await verifiedV3Candidate(application);
  const wait = run.waits.at(-1)!;
  expect(wait).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
  expect(run.actions.some((action) => action.stepId === 'verify.report')).toBe(false);
  const approved = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'shared-handler-approved',
    choice: 'approved',
  });
  expect(approved.state).toMatchObject({ phase: 'archive', verification_result: 'pass' });
  expect(approved.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', status: 'pending' });
  expect(approved.actions.some((action) => action.stepId === 'verify.revalidate')).toBe(false);
});

async function nativeTaskBuilderFixture(git = true) {
  const prepared = await preparedShape(
    'sdk',
    nativeApplication('3'),
    git ? initializeArchiveGit : undefined,
  );
  const wait = prepared.run.waits.at(-1)!;
  let run = await prepared.runtime.resolveWait({
    runId: prepared.run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'native-task-shape',
    choice: 'approved',
  });
  run = await succeedLatestAction(
    prepared.runtime,
    run,
    await collectProposal(prepared.paths, run.state as NativePortableState),
    prepared.root,
    'native-task-shape-current',
  );
  const action = run.actions.at(-1)!;
  run = await prepared.runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: 'task-builder',
    claimToken: 'native-task-builder',
    context: { requestId: 'native-task-builder', projectRoot: prepared.root },
  });
  const resultDirectory = git
    ? prepared.root
    : await fs.mkdtemp(path.join(os.tmpdir(), 'comet-task-result-'));
  if (!git) roots.push(resultDirectory);
  const resultFile = path.join(resultDirectory, 'task-result.json');
  await fs.writeFile(
    resultFile,
    JSON.stringify({
      status: 'succeeded',
      output: {
        summary: 'Implemented approved behavior.',
        addressedAcceptanceIds: ['A1'],
        checks: [],
        knownLimits: [],
        verificationChecks: [],
      },
    }),
  );
  return { ...prepared, run, action, resultFile };
}

describe('Native high-level task continuation', () => {
  it('submits Build and claims same-session Verify in one call, then completes authorized Archive in one result call', async () => {
    const f = await nativeTaskBuilderFixture();
    const builder = await runNativeCli([
      'next',
      f.run.runId,
      '--result',
      f.resultFile,
      '--action',
      f.action.id,
      '--session',
      'task-builder',
      '--review',
      'current-session',
      '--project-root',
      f.root,
      '--json',
    ]);
    expect(builder.exitCode, builder.stderr || builder.stdout).toBe(0);
    const view = JSON.parse(builder.stdout).data;
    expect(view).toMatchObject({
      schema: 'comet.native.task-result.v1',
      phase: 'verify',
      task: {
        role: 'verify',
        session: 'task-builder',
        acceptance: [{ id: 'A1', text: expect.any(String) }],
      },
      resultTemplate: { status: 'succeeded' },
    });
    expect(view).not.toHaveProperty('state');
    expect(view).not.toHaveProperty('activeActions');
    const verified = await f.runtime.inspect(f.run.runId);
    const verifier = verified.actions.at(-1)!;
    expect(verifier).toMatchObject({
      stepId: 'verify.verifier',
      status: 'running',
      claim: { sessionId: 'task-builder' },
    });
    const state = verified.state as NativePortableState;
    await fs.writeFile(
      f.resultFile,
      JSON.stringify({
        status: 'succeeded',
        output: {
          candidateId: state.builder_handoff!.candidate_id,
          verifierExecutionRef: 'task-builder',
          response: {
            kind: 'final-result',
            result: {
              iteration: state.loop.iteration,
              attempt: state.loop.attempt,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Observed approved behavior.' }],
              risks: [],
              summary: 'Acceptance passed.',
            },
          },
        },
      }),
    );
    const complete = await runNativeCli([
      'next',
      f.run.runId,
      '--result',
      f.resultFile,
      '--action',
      verifier.id,
      '--session',
      'task-builder',
      '--accept-on-pass',
      'The user explicitly delegated acceptance and Archive after all criteria pass.',
      '--project-root',
      f.root,
      '--json',
    ]);
    expect(complete.exitCode, complete.stderr || complete.stdout).toBe(0);
    const completed = await f.runtime.inspect(f.run.runId);
    expect(completed.status).toBe('completed');
    expect(
      completed.waits.find((entry) => entry.stepId === 'verify.confirm')?.decision?.reason,
    ).toContain('explicitly delegated');
    expect(JSON.parse(complete.stdout).data).toMatchObject({
      status: 'completed',
      result: { verdict: 'pass' },
    });
  });
});

async function submitNativeTaskBuilder(
  f: Awaited<ReturnType<typeof nativeTaskBuilderFixture>>,
  review = 'current-session',
) {
  const result = await runNativeCli([
    'next',
    f.run.runId,
    '--result',
    f.resultFile,
    '--action',
    f.action.id,
    '--session',
    'task-builder',
    '--review',
    review,
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(result.exitCode, result.stderr || result.stdout).toBe(0);
  return {
    result,
    data: JSON.parse(result.stdout).data,
    run: await f.runtime.inspect(f.run.runId),
  };
}

async function writeNativeTaskVerdict(
  f: Awaited<ReturnType<typeof nativeTaskBuilderFixture>>,
  run: WorkflowRun,
  sessionId: string,
  verdict: 'pass' | 'fail' = 'pass',
) {
  const state = run.state as NativePortableState;
  await fs.writeFile(
    f.resultFile,
    JSON.stringify({
      status: 'succeeded',
      output: {
        candidateId: state.builder_handoff!.candidate_id,
        verifierExecutionRef: sessionId,
        response: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict,
            acceptance: [
              {
                id: 'A1',
                result: verdict === 'pass' ? 'passed' : 'failed',
                reason: 'Observed the actual acceptance scenario.',
              },
            ],
            risks: [],
            summary: 'Actual review conclusion.',
          },
        },
      },
    }),
  );
}

describe('Native high-level task safeguards', () => {
  it('waits for acceptance without delegated approval and replays the same result without duplicate progression', async () => {
    const f = await nativeTaskBuilderFixture();
    const built = await submitNativeTaskBuilder(f);
    const verifier = built.run.actions.at(-1)!;
    await writeNativeTaskVerdict(f, built.run, 'task-builder');
    const args = [
      'next',
      f.run.runId,
      '--result',
      f.resultFile,
      '--action',
      verifier.id,
      '--session',
      'task-builder',
      '--project-root',
      f.root,
      '--json',
    ];
    const reported = await runNativeCli(args);
    expect(reported.exitCode, reported.stderr || reported.stdout).toBe(0);
    const data = JSON.parse(reported.stdout).data;
    expect(data, JSON.stringify(data)).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      result: {
        verdict: 'pass',
        summary: 'Actual review conclusion.',
        acceptance: [
          { id: 'A1', result: 'passed', reason: 'Observed the actual acceptance scenario.' },
        ],
      },
      next: { askUser: expect.any(String) },
    });
    const accepted = await f.runtime.inspect(f.run.runId);
    expect(accepted.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
    const replay = await runNativeCli(args);
    expect(replay.exitCode, replay.stderr || replay.stdout).toBe(0);
    expect(await f.runtime.inspect(f.run.runId)).toEqual(accepted);
    const changed = JSON.parse(await fs.readFile(f.resultFile, 'utf8'));
    changed.output.response.result.summary = 'A conflicting second result.';
    await fs.writeFile(f.resultFile, JSON.stringify(changed));
    const conflicting = await runNativeCli(args);
    expect(conflicting.exitCode).not.toBe(0);
    expect((await f.runtime.inspect(f.run.runId)).waits).toEqual(accepted.waits);
  });

  it('hands independent Verify to its actual receiver and rejects the Builder session', async () => {
    const f = await nativeTaskBuilderFixture();
    const built = await submitNativeTaskBuilder(f, 'independent');
    const verifier = built.run.actions.at(-1)!;
    expect(verifier).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    expect(built.data.task.session).toBeNull();
    const args = [
      'next',
      f.run.runId,
      '--action',
      verifier.id,
      '--review',
      'independent',
      '--project-root',
      f.root,
      '--json',
    ];
    const denied = await runNativeCli([...args, '--session', 'task-builder']);
    expect(denied.exitCode).toBe(64);
    expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)?.status).toBe('pending');
    const received = await runNativeCli([...args, '--session', 'actual-reviewer']);
    expect(received.exitCode, received.stderr || received.stdout).toBe(0);
    expect(JSON.parse(received.stdout).data).toMatchObject({
      task: { role: 'verify', session: 'actual-reviewer', readOnly: true },
      resultTemplate: { output: { verifierExecutionRef: 'actual-reviewer' } },
    });
    await writeNativeTaskVerdict(
      f,
      await f.runtime.inspect(f.run.runId),
      'actual-reviewer',
      'fail',
    );
    const failed = await runNativeCli([
      'next',
      f.run.runId,
      '--result',
      f.resultFile,
      '--action',
      verifier.id,
      '--session',
      'actual-reviewer',
      '--accept-on-pass',
      'User delegated only passing acceptance.',
      '--project-root',
      f.root,
      '--json',
    ]);
    expect(failed.exitCode, failed.stderr || failed.stdout).toBe(0);
    const current = await f.runtime.inspect(f.run.runId);
    expect(current.state).toMatchObject({ phase: 'build' });
    expect(current.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });
    expect(current.waits.some((wait) => wait.stepId === 'verify.confirm')).toBe(false);
    expect(current.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
  });

  it('rejects a wrong result session and candidate drift before accepting Verify', async () => {
    const f = await nativeTaskBuilderFixture();
    const built = await submitNativeTaskBuilder(f);
    const verifier = built.run.actions.at(-1)!;
    await writeNativeTaskVerdict(f, built.run, 'task-builder');
    const args = [
      'next',
      f.run.runId,
      '--result',
      f.resultFile,
      '--action',
      verifier.id,
      '--project-root',
      f.root,
      '--json',
    ];
    const wrong = await runNativeCli([...args, '--session', 'other-session']);
    expect(wrong.exitCode).toBe(64);
    expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)?.status).toBe('running');
    await fs.writeFile(path.join(f.root, 'implementation.js'), 'export const result = false;');
    const drift = await runNativeCli([
      ...args,
      '--session',
      'task-builder',
      '--accept-on-pass',
      'User delegated passing acceptance only.',
    ]);
    expect(drift.exitCode).not.toBe(0);
    const current = await f.runtime.inspect(f.run.runId);
    expect(current.waits.some((wait) => wait.stepId === 'verify.confirm')).toBe(false);
    expect(current.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
  });

  it('keeps complete acceptance content while reducing normal output below full SDK details', async () => {
    const f = await nativeTaskBuilderFixture();
    const built = await submitNativeTaskBuilder(f);
    const details = await runNativeCli([
      'next',
      f.run.runId,
      '--session',
      'task-builder',
      '--details',
      '--project-root',
      f.root,
      '--json',
    ]);
    expect(details.exitCode, details.stderr || details.stdout).toBe(0);
    const full = JSON.parse(details.stdout).data;
    expect(full.details.run.actions.length).toBeGreaterThan(0);
    expect(built.data.task.acceptance).toEqual((built.run.state as NativePortableState).acceptance);
    expect(built.data.task.artifacts.specs).toContain(
      'docs/comet/changes/sdk-shape/specs/workflow/spec.md',
    );
    expect(Buffer.byteLength(built.result.stdout!)).toBeLessThan(
      Buffer.byteLength(details.stdout!),
    );
    expect(built.data).not.toHaveProperty('details');
    expect(built.data.resultTemplate).not.toHaveProperty('receipt');
    expect(built.data.task).not.toHaveProperty('inputHash');
  });
});

it('skips unrelated recovery handlers while the ordinary Verifier is running', async () => {
  const f = await nativeTaskBuilderFixture();
  const built = await submitNativeTaskBuilder(f);
  const checks = vi.spyOn(nativeSdkChecks, 'recoverNativeSdkChecks');
  const reports = vi.spyOn(nativeSdkReportRecovery, 'recoverNativeSdkReportRevalidation');
  const revisions = vi.spyOn(nativeSdkRevisionRecovery, 'recoverNativeSdkImplementationRevision');
  const next = await runNativeCli(['next', f.run.runId, '--project-root', f.root, '--json']);
  expect(next.exitCode, next.stderr || next.stdout).toBe(0);
  expect(checks).not.toHaveBeenCalled();
  expect(reports).not.toHaveBeenCalled();
  expect(revisions).not.toHaveBeenCalled();
  expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)?.id).toBe(
    built.run.actions.at(-1)?.id,
  );
});

it('keeps non-Git result transport outside candidate inputs through the high-level task path', async () => {
  const f = await nativeTaskBuilderFixture(false);
  const built = await submitNativeTaskBuilder(f);
  await writeNativeTaskVerdict(f, built.run, 'task-builder');
  const reported = await runNativeCli([
    'next',
    f.run.runId,
    '--result',
    f.resultFile,
    '--action',
    built.run.actions.at(-1)!.id,
    '--session',
    'task-builder',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(reported.exitCode, reported.stderr || reported.stdout).toBe(0);
  expect((await f.runtime.inspect(f.run.runId)).state).toMatchObject({
    phase: 'verify',
    verification_result: 'pass',
    status: 'await-user',
  });
});

it('preserves a committed Builder result when its internal check cannot start', async () => {
  const f = await nativeTaskBuilderFixture();
  vi.spyOn(nativeSdkChecks.nativeSdkCheckExecutor, 'execute').mockRejectedValueOnce(
    new Error('Simulated check start failure'),
  );
  const result = await runNativeCli([
    'next',
    f.run.runId,
    '--result',
    f.resultFile,
    '--action',
    f.action.id,
    '--session',
    'task-builder',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(result.exitCode).toBe(73);
  expect(JSON.parse(result.stdout).error.message).toContain('本次结果已保存');
  const current = await f.runtime.inspect(f.run.runId);
  expect(current.actions.find((action) => action.id === f.action.id)?.status).toBe('succeeded');
  expect(current.actions.some((action) => action.stepId === 'verify.verifier')).toBe(false);
  expect(current.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
});

it('rejects incomplete or forged high-level results without completing the original Verify task', async () => {
  const f = await nativeTaskBuilderFixture();
  const built = await submitNativeTaskBuilder(f);
  const verifier = built.run.actions.at(-1)!;
  await fs.writeFile(
    f.resultFile,
    JSON.stringify({ status: 'succeeded', output: { summary: 'Unsupported pass claim.' } }),
  );
  const invalid = await runNativeCli([
    'next',
    f.run.runId,
    '--result',
    f.resultFile,
    '--action',
    verifier.id,
    '--session',
    'task-builder',
    '--accept-on-pass',
    'User delegated only passing results.',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(invalid.exitCode).not.toBe(0);
  const current = await f.runtime.inspect(f.run.runId);
  expect(current.actions.at(-1)).toMatchObject({ id: verifier.id, status: 'running' });
  expect(current.waits.some((wait) => wait.stepId === 'verify.confirm')).toBe(false);
});

it('keeps the selected independent review when the next claim omits review options', async () => {
  const f = await nativeTaskBuilderFixture();
  const built = await submitNativeTaskBuilder(f, 'independent');
  expect(
    built.run.actions.find((action) => action.id === f.action.id)?.outcome?.output,
  ).toMatchObject({ requireIndependentReview: true });
  const verifier = built.run.actions.at(-1)!;
  for (const reviewArgs of [[], ['--review', 'current-session']]) {
    const denied = await runNativeCli([
      'next',
      f.run.runId,
      '--action',
      verifier.id,
      '--session',
      'task-builder',
      '--project-root',
      f.root,
      '--json',
      ...reviewArgs,
    ]);
    expect(denied.exitCode).toBe(64);
    expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)?.status).toBe('pending');
  }
  const received = await runNativeCli([
    'next',
    f.run.runId,
    '--action',
    verifier.id,
    '--session',
    'actual-reviewer',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(received.exitCode, received.stderr || received.stdout).toBe(0);
  expect(JSON.parse(received.stdout).data.task).toMatchObject({
    session: 'actual-reviewer',
    readOnly: true,
    requireIndependentReview: true,
  });
});

it('completes Archive on the returned third call after the user accepts the current result', async () => {
  const f = await nativeTaskBuilderFixture();
  const built = await submitNativeTaskBuilder(f);
  await writeNativeTaskVerdict(f, built.run, 'task-builder');
  const second = await runNativeCli([
    'next',
    f.run.runId,
    '--result',
    f.resultFile,
    '--action',
    built.run.actions.at(-1)!.id,
    '--session',
    'task-builder',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(second.exitCode, second.stderr || second.stdout).toBe(0);
  const command = JSON.parse(second.stdout).data.next.commandArgs as string[];
  expect(command).toContain('--accept-result');
  const args = command.slice(2);
  args[args.indexOf('--summary') + 1] = 'The user accepted this displayed result.';
  const third = await runNativeCli(args);
  expect(third.exitCode, third.stderr || third.stdout).toBe(0);
  expect((await f.runtime.inspect(f.run.runId)).status).toBe('completed');
});

async function nativeSupervisorReviewFixture(
  version: '2' | '3',
  requireIndependentReview: boolean,
) {
  const f = await fixture();
  await fs.writeFile(
    path.join(f.changeDir, 'children.yaml'),
    'schema: comet.native.children.v2\nchildren:\n  - name: api\n    summary: Build the API\n    depends_on: []\n  - name: ui\n    summary: Build the UI\n    depends_on: [api]\n',
  );
  await initializeArchiveGit(f.root);
  execFileSync('git', ['add', '-A'], { cwd: f.root });
  execFileSync('git', ['commit', '-m', 'Supervisor materials'], { cwd: f.root, stdio: 'ignore' });
  const application = nativeApplication(version);
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    validators: application.validators,
    stateValidators: application.stateValidators,
    commandValidators: application.commandValidators,
    executors: application.executors,
  });
  const initialState = createNativePortableState({
    name: 'sdk-shape',
    language: 'en',
    workspace: { isolation: 'current', change_branch: 'main', target_branch: 'main', finish: null },
  });
  let run = await runtime.start({
    runId: 'sdk-shape',
    workflow: { id: application.workflow.id, version },
    input: { name: 'sdk-shape', artifactRootRef: 'docs' },
    initialState,
  });
  run = await succeedLatestAction(
    runtime,
    run,
    await collectProposal(f.paths, initialState),
    f.root,
    'review-shape',
  );
  const wait = run.waits.at(-1)!;
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'review-shape-approved',
    choice: 'multi-session',
  });
  run = await succeedLatestAction(
    runtime,
    run,
    await collectProposal(f.paths, run.state as NativePortableState),
    f.root,
    'review-shape-current',
  );
  for (const executorId of ['native-supervisor-prepare', 'native-supervisor-child-prepare']) {
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId,
      context: { requestId: executorId, projectRoot: f.root },
    });
  }
  const childWorktree = path.join(f.root, '.worktrees', 'sdk-shape-api');
  await fs.writeFile(path.join(childWorktree, 'api.txt'), 'API implemented\n');
  execFileSync('git', ['add', 'api.txt'], { cwd: childWorktree });
  execFileSync('git', ['commit', '-m', 'API candidate'], { cwd: childWorktree, stdio: 'ignore' });
  const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: childWorktree,
    encoding: 'utf8',
  }).trim();
  const check = {
    id: 'api-check',
    name: 'API check',
    executable: process.execPath,
    argv: ['-e', 'process.exit(0)'],
    cwdRef: '.',
    timeoutMs: 10000,
    repeatable: true,
  };
  if (version === '3') {
    await expect(
      succeedLatestAction(
        runtime,
        run,
        { candidateCommit, verificationChecks: [check], requireIndependentReview: 'false' },
        f.root,
        'invalid-review-type',
        'child-builder',
      ),
    ).rejects.toThrow('requireIndependentReview must be a boolean');
    run = await runtime.inspect(run.runId);
  }
  const builder = run.actions.at(-1)!;
  if (!builder.claim)
    run = await runtime.claim({
      runId: run.runId,
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      executorId: 'native-host',
      sessionId: 'child-builder',
      claimToken: 'child-builder',
      context: { requestId: 'child-builder', projectRoot: f.root },
    });
  run = await runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      claimToken: run.actions.at(-1)!.claim!.token,
      outcomeId: 'child-built',
      status: 'succeeded',
      output: { candidateCommit, verificationChecks: [check], requireIndependentReview },
    },
    context: { requestId: 'child-built', projectRoot: f.root },
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'comet-native-checks',
    context: { requestId: 'child-checks', projectRoot: f.root },
  });
  return { ...f, runtime, run, childWorktree, candidateCommit, check };
}

it.each([
  { version: '2', required: false, session: 'child-builder', accepted: false },
  { version: '3', required: false, session: 'child-builder', accepted: true },
  { version: '3', required: true, session: 'child-builder', accepted: false },
  { version: '3', required: true, session: 'actual-child-reviewer', accepted: true },
] as const)(
  'preserves Supervisor review policy and archived assurance ($version, required=$required, session=$session)',
  async ({ version, required, session, accepted }) => {
    const f = await nativeSupervisorReviewFixture(version, required);
    const projection = await projectNativeSdkContinuation({
      run: f.run,
      state: f.run.state as NativePortableState,
      projectRoot: f.root,
    });
    expect(projection.pendingActions.at(-1)?.sessionRequirements).toMatchObject({
      independent: version === '2' || required,
      readOnly: true,
    });
    const output = {
      candidateCommit: f.candidateCommit,
      verdict: 'pass',
      evidence: {
        summary: 'Reviewed actual API behavior.',
        checks: ['api-check'],
        acceptance: [{ id: 'child:api', result: 'passed', reason: 'The API scenario passed.' }],
      },
      integrationChecks: [{ ...f.check, id: 'api-integration' }],
    };
    const operation = succeedLatestAction(
      f.runtime,
      f.run,
      output,
      f.root,
      'child-reviewed',
      session,
    );
    if (!accepted) {
      await expect(operation).rejects.toThrow(/required independent session/);
      expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.verifier',
        status: 'running',
      });
      return;
    }
    let run = await operation;
    for (const executorId of [
      'native-supervisor-integrate',
      'comet-native-checks',
      'native-supervisor-child-archive',
    ]) {
      run = await f.runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId,
        context: { requestId: executorId, projectRoot: f.root },
      });
    }
    const receipt = run.outputs['supervisor.child.archive'].value as { archiveRef: string };
    const archived = parseYaml(
      await fs.readFile(
        path.join(f.childWorktree, 'docs/comet/archive', receipt.archiveRef, 'comet-state.yaml'),
        'utf8',
      ),
    );
    expect(archived.verification).toMatchObject({
      verifier_execution_ref: session,
      assurance: session === 'child-builder' ? 'self-reviewed' : 'skill-coordinated',
    });
  },
);
