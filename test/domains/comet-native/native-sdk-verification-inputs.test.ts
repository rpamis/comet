import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryRuntimeStore,
  createFileRuntimeStore,
  createRuntime,
  hashRuntimeValue,
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
  assertNativeSdkCandidateUnchanged,
  observeNativeSdkInputs,
  assertNativeSdkArchiveCheckInputs,
} from '../../../domains/comet-native/native-sdk-checks.js';
import { inspectNativeSdkRunDiagnostics } from '../../../domains/comet-native/native-sdk-diagnostics.js';
import { inspectNativeSdkCheckExecutions } from '../../../domains/comet-native/native-sdk-check-execution.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import type { NativeCheckPlan } from '../../../domains/comet-native/native-check-executor.js';
import {
  nativeEditReviewScope,
  nativeFormalEditReviewScope,
} from '../../../domains/comet-native/native-edit-review-scope.js';
import { prepareNativeAppliedFormalReview } from '../../../domains/comet-native/native-edit-review.js';
import { captureApprovedShapeOriginals } from '../../../domains/comet-native/native-shape-review-evidence.js';
import {
  prepareEditReview,
  prepareObservedEditReview,
  recordEditReview,
  isCheckInputRetained,
} from '../../../domains/workflow-contract/edit-review.js';
import {
  nativeRawInputSnapshot,
  nativeCheckInputSnapshot,
  nativeCandidateInputGate,
} from '../../../domains/comet-native/native-portable-checks.js';
import { readNativeApprovedShapeSemanticSnapshot } from '../../../domains/comet-native/native-portable-requirements.js';

type ReceiptFault = 'null-snapshot' | 'unknown-schema' | 'missing-candidate' | 'incomplete';

const gitlinkOutputCheck: NativeCheckPlan = {
  id: 'gitlink-output',
  name: 'Read generated output in the child repository',
  executable: process.execPath,
  argv: [
    '-e',
    'if (require("node:fs").readFileSync("dist/output.txt", "utf8") !== "good") process.exit(1)',
  ],
  cwdRef: 'dependency',
  timeoutMs: 5_000,
  repeatable: true,
};

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
    legacyArchivePreflight?: boolean;
    artifactRootRef?: string;
    receiptFault?: ReceiptFault;
    checkSource?: string;
    executeChecks?: boolean;
    verificationChecks?: NativeCheckPlan[];
    files?: Record<string, string>;
    prepareProject?: (root: string) => Promise<void>;
    builderOverrides?: Record<string, unknown>;
    documentWrites?: 'allow' | 'revert';
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-verification-inputs-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeProjectFile(root, '.gitignore', '.next/\n');
  await writeProjectFile(root, 'value.ts', 'export const value = 1;\n');
  for (const [file, content] of Object.entries(options.files ?? {}))
    await writeProjectFile(root, file, content);
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
  const artifactRootRef = options.artifactRootRef ?? 'docs';
  const config = defaultProjectConfig(artifactRootRef, 'en');
  await writeProjectConfig(root, {
    ...config,
    native: {
      ...config.native,
      ...(options.documentWrites ? { document_writes: options.documentWrites } : {}),
    },
  });
  await options.prepareProject?.(root);
  const paths = await nativeProjectPaths(root, artifactRootRef);
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
  let application = defineNativeWorkflowApplication();
  if (options.legacyArchivePreflight) {
    const original = application.executors.find(
      (entry) => entry.id === 'comet-native-archive-preflight',
    )!;
    const strip = (result: Awaited<ReturnType<typeof original.execute>>) => {
      const output = { ...(result.output as Record<string, RuntimeValue>) };
      delete output.recoveryBinding;
      return { ...result, output };
    };
    application = {
      ...application,
      executors: application.executors.map((executor) =>
        executor === original
          ? {
              ...executor,
              execute: async (...args: Parameters<typeof original.execute>) =>
                strip(await original.execute(...args)),
            }
          : executor,
      ),
      validators: application.validators.map((validator) =>
        validator.id === 'comet-native-archive-preflight-outcome'
          ? {
              ...validator,
              validate: async (args: Parameters<typeof validator.validate>[0]) => {
                const expected = strip(await original.execute(args.action, args.context, args.run));
                return {
                  accepted:
                    expected.status === args.outcome.status &&
                    hashRuntimeValue(expected.output!) === hashRuntimeValue(args.outcome.output),
                };
              },
            }
          : validator,
      ),
    };
  }
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
                    if (options.legacyReceipt) {
                      // 历史证明值故意过期；实际命令仍由当前 Runtime 执行，旧字段只作历史读取。
                      output.inputBefore = '0'.repeat(64);
                      output.inputAfter = '1'.repeat(64);
                      output.candidateInputFingerprintGate = {
                        schema: 'comet.native.candidate-input.v1',
                        fingerprint: '2'.repeat(64),
                      };
                    } else if (options.receiptFault === 'null-snapshot')
                      output.inputSnapshot = null;
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
    input: { name: 'verification-inputs', artifactRootRef },
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
      verificationChecks: options.verificationChecks ?? [check],
      ...options.builderOverrides,
    },
    'builder-session',
  );
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.checks', status: 'pending' });
  if (options.executeChecks === false)
    return { root, paths, changeDir, runtime, store, run, check };
  try {
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'runtime-checks', projectRoot: root },
    });
  } catch (error) {
    const failed = await store.read(run.runId);
    const executions = failed
      ? (await inspectNativeSdkCheckExecutions({ projectRoot: root, run: failed })).map(
          ({ actionId, owner, process, phase, quiescent, reason, execution }) => ({
            actionId,
            owner,
            process,
            phase,
            quiescent,
            reason,
            child: execution?.child,
            terminationUnconfirmed: execution?.terminationUnconfirmed,
            inputSnapshot: (execution?.outcome?.output as { inputSnapshot?: unknown } | undefined)
              ?.inputSnapshot,
            candidateGate: (
              execution?.outcome?.output as { candidateInputFingerprintGate?: unknown } | undefined
            )?.candidateInputFingerprintGate,
          }),
        )
      : [];
    throw new Error(
      `Native fixture check execution failed: ${String(error)}; ${failed?.actions.at(-1)?.reason ?? 'no persisted reason'}; executions: ${JSON.stringify(executions)}`,
      { cause: error },
    );
  }
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
  expect(await nativeSdkCurrentCheckSummaries({ run, projectRoot: root })).toMatchObject(
    (options.verificationChecks ?? [check]).map(({ id }) => ({ id, status: 'passed' })),
  );
  if (options.legacyReceipt) {
    const restartedStore = createFileRuntimeStore<WorkflowRun>(storeOptions);
    runtime = createRuntime({ ...runtimeOptions, store: restartedStore });
    run = (await restartedStore.read(run.runId))!;
  }
  return { root, paths, changeDir, runtime, store, run, check };
}

async function submitVerifierResult(
  prepared: Awaited<ReturnType<typeof checkedCandidate>>,
  verdict: 'pass' | 'fail' = 'pass',
  receipt = 'verifier-final-result',
) {
  const { root, runtime, run } = prepared;
  const state = run.state as unknown as NativePortableState;
  return succeedLatestAction(
    runtime,
    run,
    root,
    receipt,
    {
      candidateId: state.builder_handoff!.candidate_id,
      verifierExecutionRef: 'verifier-session',
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
              reason: 'The selected value requires review.',
            },
          ],
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
    try {
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId,
        context: { requestId: executorId, projectRoot: root },
      });
    } catch (error) {
      const failed = await runtime.inspect(run.runId);
      throw new Error(`${executorId}: ${failed.actions.at(-1)?.reason ?? failed.reason}`, {
        cause: error,
      });
    }
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
  it.each([
    [
      'checks.result',
      { checks: [{ name: 'check', result: 'pass' }] },
      /checks\[0\]\.result.*passed.*failed.*not-run.*pass/u,
    ],
    [
      'acceptanceReview.evidence',
      {
        acceptanceReview: [
          { id: 'A1', status: 'implemented-with-evidence', evidence: 'proof', note: 'Done.' },
        ],
      },
      /acceptance_review\[0\].*A1.*evidence.*array.*string/u,
    ],
    [
      'acceptanceReview.note',
      {
        acceptanceReview: [
          { id: 'A1', status: 'implemented-with-evidence', evidence: ['proof'], note: '' },
        ],
      },
      /acceptance_review\[0\].*A1.*note.*concrete/u,
    ],
  ])(
    'reports the exact invalid Builder field without misleading claim diagnostics: %s',
    async (_field, builderOverrides, expected) => {
      await expect(
        checkedCandidate({ builderOverrides: builderOverrides as Record<string, unknown> }),
      ).rejects.toThrow(expected as RegExp);
    },
  );

  it('retains only the Agent-selected arbitrary check across a repaired candidate without language detection', async () => {
    const plans = ['left.unknown', 'right.py'].map((file, index) => ({
      id: index === 0 ? 'left' : 'right',
      name: `Read ${file}`,
      executable: process.execPath,
      argv: ['-e', `process.stdout.write(require('node:fs').readFileSync('${file}', 'utf8'))`],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: true,
    }));
    const prepared = await checkedCandidate({
      files: { 'left.unknown': 'original left', 'right.py': 'uncompiled right' },
      verificationChecks: plans,
    });
    const originalAction = prepared.run.actions.find(
      (action) => action.stepId === 'verify.checks',
    )!;
    const original = originalAction.outcome!.output as unknown as {
      checks: Array<{ logRef: string }>;
    };
    let run = await submitVerifierResult(prepared, 'fail');
    const scope = {
      ...nativeEditReviewScope(prepared.paths, run.state as unknown as NativePortableState),
      judgment: 'agent' as const,
    };
    const proposal = await prepareEditReview(scope, {
      intent: 'write',
      toolName: 'Write',
      targets: ['left.unknown'],
      writes: [{ path: 'left.unknown', content: 'repaired left' }],
    });
    await recordEditReview(
      scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'implementation-changed',
        summary: 'The left input changed; the right command and its inputs remain applicable.',
        retainedChecks: [{ actionId: originalAction.id, checkId: 'right' }],
      },
      { kind: 'runtime-agent', executionRef: 'current-repair-builder' },
    );
    await writeProjectFile(prepared.root, 'left.unknown', 'repaired left');
    const beforeRef = (originalAction.outcome!.output as { rawInput: { afterRef: string } })
      .rawInput.afterRef;
    const observedBefore = JSON.parse(
      await fs.readFile(path.join(prepared.paths.workspaceRuntimeRoot, beforeRef), 'utf8'),
    ) as { files: Array<{ path: string; hash: string }> };
    const observedAfter = await nativeRawInputSnapshot({
      projectRoot: prepared.root,
      managedArtifactRoot: prepared.paths.artifactRoot,
    });
    const originals = new Map(observedBefore.files.map((file) => [file.path, file.hash]));
    const changes = observedAfter.files
      .filter((file) => originals.get(file.path) !== file.hash)
      .map((file) => ({
        path: file.path,
        beforeHash: originals.get(file.path) ?? 'missing',
        afterHash: file.hash,
      }));
    expect(
      await isCheckInputRetained(scope, originalAction.id, changes, [], 'right'),
      JSON.stringify(changes),
    ).toBe(true);
    run = await succeedLatestAction(
      prepared.runtime,
      run,
      prepared.root,
      'raw-repair-builder',
      {
        summary: 'Repair the left input.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-10-23T02:00:00.000Z',
        verificationChecks: plans,
      },
      'current-repair-builder',
    );
    run = await prepared.runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'raw-reviewed-checks', projectRoot: prepared.root },
    });
    const refreshed = run.outputs['verify.checks'].value as unknown as {
      checks: Array<{ logRef: string; reusedFrom?: { actionId: string; checkId: string } }>;
    };
    expect(refreshed.checks[0].logRef).not.toBe(original.checks[0].logRef);
    expect(refreshed.checks[0].reusedFrom).toBeUndefined();
    expect(refreshed.checks[1]).toMatchObject({
      logRef: original.checks[1].logRef,
      reusedFrom: { actionId: originalAction.id, checkId: 'right' },
    });
    expect(await nativeSdkCurrentCheckSummaries({ run, projectRoot: prepared.root })).toMatchObject(
      [
        { id: 'left', status: 'passed' },
        { id: 'right', status: 'passed' },
      ],
    );
    await submitVerifierResult({ ...prepared, run });
  });

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

  it('does not replay a one-shot SDK command after the Verifier changes its ID and repeatable flag', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-once-only-'));
    roots.push(directory);
    const counter = path.join(directory, 'counter');
    const plan = {
      id: 'once',
      name: 'One-shot operation',
      executable: process.execPath,
      argv: ['-e', `require('node:fs').appendFileSync(${JSON.stringify(counter)}, 'x')`],
      cwdRef: '.',
      timeoutMs: 5000,
      repeatable: false,
    };
    const prepared = await checkedCandidate({ verificationChecks: [plan] });
    const state = prepared.run.state as unknown as NativePortableState;
    const requested = await succeedLatestAction(
      prepared.runtime,
      prepared.run,
      prepared.root,
      'alias-once-request',
      {
        candidateId: state.builder_handoff!.candidate_id,
        verifierExecutionRef: 'alias-verifier',
        refreshChecks: true,
        response: {
          kind: 'request-checks',
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          checks: [{ ...plan, id: 'alias', repeatable: true }],
        },
      },
      'alias-verifier',
    );
    const action = requested.actions.at(-1)!;
    await expect(
      prepared.runtime.execute({
        runId: requested.runId,
        actionId: action.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'alias-once-execute', projectRoot: prepared.root },
      }),
    ).rejects.toThrow();
    const current = await prepared.store.read(requested.runId);
    expect(current!.actions.find((entry) => entry.id === action.id)?.reason).toContain(
      '不可重复执行',
    );
    expect((current!.state as unknown as NativePortableState).builder_handoff?.candidate_id).toBe(
      state.builder_handoff!.candidate_id,
    );
    expect(await fs.readFile(counter, 'utf8')).toBe('x');
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

  it('accepts original Runtime checks across shells while reading legacy content-proof fields as history', async () => {
    const prepared = await checkedCandidate({ legacyReceipt: true });
    const original = prepared.run.actions.find((action) => action.stepId === 'verify.checks')!;
    vi.stubEnv('HTTP_PROXY', 'http://different-verifier-proxy.invalid:3128');
    vi.stubEnv('TEMP', path.join(prepared.root, 'another-verifier-temp'));
    const accepted = await submitVerifierResult(prepared);
    expect(accepted.actions.find((action) => action.id === original.id)).toEqual(original);
    expect(accepted.actions.filter((action) => action.stepId === 'verify.checks')).toHaveLength(1);
    const completed = await completeArchive(prepared, accepted);
    expect(completed.status).toBe('completed');
    expect(completed.runId).toBe(prepared.run.runId);
  });
});

it.each(['verify', 'archive'] as const)(
  'A4 continues an Agent-reviewed behavior change from %s and retains only the unaffected one-shot check',
  async (editPhase) => {
    const { projectNativeSdkContinuation } =
      await import('../../../domains/comet-native/native-sdk-continuation.js');
    const { reconcileNativeSdkExecutionStops } =
      await import('../../../domains/comet-native/native-sdk-check-execution.js');
    const plans: NativeCheckPlan[] = [
      {
        id: 'a',
        name: 'Observe the selected application value',
        executable: process.execPath,
        argv: [
          '-e',
          'const fs=require("node:fs"); const value=Number(fs.readFileSync("value.ts","utf8")); if(![1,2].includes(value))process.exit(1); fs.appendFileSync(".git/a4-check-a",String(value)); process.stdout.write("selected="+value);',
        ],
        cwdRef: '.',
        timeoutMs: 5000,
        repeatable: true,
      },
      {
        id: 'b',
        name: 'Read unrelated data and perform one original operation',
        executable: process.execPath,
        argv: [
          '-e',
          'const fs=require("node:fs"); if(fs.readFileSync("right.unknown","utf8")!=="stable")process.exit(1); fs.writeFileSync(".git/a4-check-b","once",{flag:"wx"}); process.stdout.write("right=stable");',
        ],
        cwdRef: '.',
        timeoutMs: 5000,
        repeatable: false,
      },
    ];
    const prepared = await checkedCandidate({
      verificationChecks: plans,
      files: { 'right.unknown': 'stable' },
      // 文件扩展名不决定其语义。检查只是读取实际数值，不调用编译器或语法分类器。
      prepareProject: async (root) => writeProjectFile(root, 'value.ts', '1\n'),
    });
    const { root, runtime, paths } = prepared;
    const originalCandidate = (prepared.run.state as unknown as NativePortableState)
      .builder_handoff!.candidate_id;
    const shapeWaits = structuredClone(
      prepared.run.waits.filter((wait) => wait.stepId === 'shape.confirm'),
    );
    let originalCheckAction = structuredClone(
      prepared.run.actions.find((action) => action.stepId === 'verify.checks')!,
    );
    const originalChecks = originalCheckAction.outcome!.output as unknown as {
      checks: Array<{ id: string; logRef: string }>;
    };
    expect(await fs.readFile(path.join(root, '.git/a4-check-a'), 'utf8')).toBe('1');
    expect(await fs.readFile(path.join(root, '.git/a4-check-b'), 'utf8')).toBe('once');

    let run = await submitVerifierResult(prepared, 'pass', 'a4-original-verifier');
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report',
      context: { requestId: 'a4-original-report', projectRoot: root },
    });
    const originalReportAction = structuredClone(
      run.actions.findLast((action) => action.stepId === 'verify.report')!,
    );
    const originalReportText = await fs.readFile(
      path.join(prepared.changeDir, 'verification.md'),
      'utf8',
    );
    const originalAccept = run.waits.at(-1)!;
    expect(originalAccept).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
    if (editPhase === 'archive') {
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: originalAccept.id,
        proposalHash: originalAccept.proposalHash,
        decisionId: 'a4-original-acceptance',
        choice: 'approved',
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report-revalidate',
        context: { requestId: 'a4-original-revalidation', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', status: 'pending' });
    }
    run = await reconcileNativeSdkExecutionStops(root, run, runtime);
    // 停止证据是合法的原执行补充；之后才冻结完整 Action，避免把补证误判为重跑。
    originalCheckAction = structuredClone(
      run.actions.find((action) => action.id === originalCheckAction.id)!,
    );
    const oldAcceptance = structuredClone(run.waits.find((wait) => wait.id === originalAccept.id)!);

    // 已批准需求是“selected value remains available”；1→2 改变真实可观察输出，仍在原范围内。
    await writeProjectFile(root, 'value.ts', '2\n');
    const project = (current: WorkflowRun) =>
      projectNativeSdkContinuation({
        run: current,
        state: current.state as unknown as NativePortableState,
        projectRoot: root,
      });
    if (editPhase === 'verify') {
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: originalAccept.id,
        proposalHash: originalAccept.proposalHash,
        decisionId: 'a4-authorized-implementation-revision',
        choice: 'rejected',
        reason: 'Continue the already authorized implementation change.',
      });
    } else {
      const state = run.state as unknown as NativePortableState;
      run = await runtime.dispatchCommand({
        runId: run.runId,
        expectedRevision: run.revision,
        commandId: 'a4-authorized-implementation-revision',
        name: 'revise-implementation',
        input: {
          reason: 'Continue the already authorized implementation change.',
          expectedStateVersion: state.state_version,
          proposalHash: originalAccept.proposalHash,
          archiveActionId: run.actions.at(-1)!.id,
        },
        context: { requestId: 'a4-revision-command', projectRoot: root },
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-revise-implementation',
        context: { requestId: 'a4-revision-execution', projectRoot: root },
      });
    }
    expect(run.runId).toBe(prepared.run.runId);
    expect(run.state).toMatchObject({ phase: 'build' });
    expect(run.waits.filter((wait) => wait.stepId === 'shape.confirm')).toEqual(shapeWaits);
    expect(await fs.readFile(path.join(prepared.changeDir, 'verification.md'), 'utf8')).toBe(
      originalReportText,
    );
    expect((await project(run)).continuation.action).toBe('builder-handoff');
    const builder = run.actions.at(-1)!;
    expect(builder).toMatchObject({ stepId: 'build.builder', status: 'pending' });
    run = await runtime.claim({
      runId: run.runId,
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      executorId: 'native-host',
      sessionId: 'a4-successor-builder',
      claimToken: 'a4-successor-builder',
      context: { requestId: 'a4-builder-claim', projectRoot: root },
    });
    const active = await project(run);
    expect(active.continuation.mode).toBe('wait');
    expect(active.continuation.action).not.toBe('review-edit');
    expect(active.activeActions?.[0]).toMatchObject({ id: builder.id, status: 'running' });
    run = await succeedLatestAction(
      runtime,
      run,
      root,
      'a4-successor-builder-result',
      {
        summary: 'Preserved existing work and verified the selected value now produces 2.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-10-23T02:00:00.000Z',
        verificationChecks: plans.map((plan) => ({ ...plan, reusable: plan.id === 'b' })),
      },
      'a4-successor-builder',
    );
    const successorCandidate = (run.state as unknown as NativePortableState).builder_handoff!
      .candidate_id;
    expect(successorCandidate).not.toBe(originalCandidate);
    expect((await project(run)).continuation.action).not.toBe('review-edit');
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.checks', status: 'pending' });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'a4-successor-checks', projectRoot: root },
    });
    const checks = (
      run.outputs['verify.checks'].value as unknown as {
        checks: Array<{
          id: string;
          logRef: string;
          reusedFrom?: { actionId: string; checkId: string };
        }>;
      }
    ).checks;
    expect(checks.find((check) => check.id === 'a')!.reusedFrom).toBeUndefined();
    expect(checks.find((check) => check.id === 'b')).toMatchObject({
      logRef: originalChecks.checks.find((check) => check.id === 'b')!.logRef,
      reusedFrom: { actionId: originalCheckAction.id, checkId: 'b' },
    });
    expect(await fs.readFile(path.join(root, '.git/a4-check-a'), 'utf8')).toBe('12');
    expect(await fs.readFile(path.join(root, '.git/a4-check-b'), 'utf8')).toBe('once');
    expect((await project(run)).continuation.action).toBe('dispatch-verifier');
    run = await submitVerifierResult({ ...prepared, run }, 'pass', 'a4-successor-verifier');
    const done = await completeArchive(prepared, run);
    expect(done.runId).toBe(prepared.run.runId);
    expect(done.state).toMatchObject({ archived: true });
    expect(done.actions.find((action) => action.id === originalCheckAction.id)).toEqual(
      originalCheckAction,
    );
    expect(done.actions.find((action) => action.id === originalReportAction.id)).toEqual(
      originalReportAction,
    );
    expect(
      done.actions.filter(
        (action) => action.stepId === 'build.builder' && action.status === 'succeeded',
      ),
    ).toHaveLength(2);
    expect(
      done.actions.filter(
        (action) => action.stepId === 'verify.verifier' && action.status === 'succeeded',
      ),
    ).toHaveLength(2);
    expect(
      done.actions.filter(
        (action) => action.stepId === 'verify.report' && action.status === 'succeeded',
      ),
    ).toHaveLength(2);
    expect(
      done.actions.filter(
        (action) => action.stepId === 'archive.execute' && action.status === 'succeeded',
      ),
    ).toHaveLength(1);
    expect(done.waits.filter((wait) => wait.stepId === 'shape.confirm')).toEqual(shapeWaits);
    const newestAcceptance = done.waits.findLast((wait) => wait.stepId === 'verify.confirm')!;
    expect(newestAcceptance).toMatchObject({
      status: 'resolved',
      decision: { choice: 'approved' },
    });
    expect(newestAcceptance.id).not.toBe(originalAccept.id);
    expect(newestAcceptance.proposalHash).not.toBe(originalAccept.proposalHash);
    if (editPhase === 'archive')
      expect(done.waits.find((wait) => wait.id === originalAccept.id)).toEqual(oldAcceptance);
    expect(await fs.readFile(path.join(root, '.git/a4-check-a'), 'utf8')).toBe('12');
    expect(await fs.readFile(path.join(root, '.git/a4-check-b'), 'utf8')).toBe('once');
  },
);

it('refreshes an explicitly selected Git check after byte-identical staging and preserves one-time evidence and approval', async () => {
  const gitCheck: NativeCheckPlan = {
    id: 'git-index',
    name: 'The Git index is empty',
    executable: 'git',
    argv: ['diff', '--cached', '--quiet'],
    cwdRef: '.',
    timeoutMs: 5_000,
    repeatable: true,
  };
  const onceCheck: NativeCheckPlan = {
    id: 'b',
    name: 'Create the unrelated one-time receipt',
    executable: process.execPath,
    argv: ['-e', 'require("node:fs").writeFileSync(".git/a9-once", "once", {flag:"wx"});'],
    cwdRef: '.',
    timeoutMs: 5_000,
    repeatable: false,
  };
  const prepared = await checkedCandidate({
    verificationChecks: [gitCheck, onceCheck],
    prepareProject: async (root) => {
      // 真实历史：HEAD/index 是 0，候选 working tree 是 1；初次 cached diff 必须通过。
      await writeProjectFile(root, 'value.ts', 'export const value = 0;\n');
      execFileSync('git', ['add', '--', 'value.ts'], { cwd: root });
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
          'A9 committed value zero',
        ],
        { cwd: root },
      );
      await writeProjectFile(root, 'value.ts', 'export const value = 1;\n');
    },
  });
  const { root, runtime } = prepared;
  const originalCheckAction = prepared.run.actions.find(
    (action) => action.stepId === 'verify.checks',
  )!;
  type CheckReceipt = {
    id: string;
    status: string;
    exitCode: number | null;
    logRef: string;
    reusedFrom?: { actionId: string; checkId: string };
  };
  const originalChecks = (
    originalCheckAction.outcome!.output as unknown as { checks: CheckReceipt[] }
  ).checks;
  expect(originalChecks.find((check) => check.id === 'git-index')).toMatchObject({
    status: 'passed',
    exitCode: 0,
  });
  expect(await fs.readFile(path.join(root, '.git/a9-once'), 'utf8')).toBe('once');

  let run = await submitVerifierResult(prepared, 'pass', 'a9-original-verifier');
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'comet-native-report',
    context: { requestId: 'a9-original-report', projectRoot: root },
  });
  const approval = run.waits.at(-1)!;
  expect(approval).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: approval.id,
    proposalHash: approval.proposalHash,
    decisionId: 'a9-approved-before-staging',
    choice: 'approved',
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'comet-native-report-revalidate',
    context: { requestId: 'a9-before-staging-revalidation', projectRoot: root },
  });
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', status: 'pending' });
  const originalState = structuredClone(run.state);
  const originalWaits = structuredClone(run.waits);
  const originalReport = structuredClone(run.outputs['verify.report']);
  const originalReportText = await fs.readFile(
    path.join(prepared.changeDir, 'verification.md'),
    'utf8',
  );
  const originalBytes = await fs.readFile(path.join(root, 'value.ts'));
  const originalHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });

  execFileSync('git', ['add', '--', 'value.ts'], { cwd: root });
  expect(await fs.readFile(path.join(root, 'value.ts'))).toEqual(originalBytes);
  expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })).toBe(
    originalHead,
  );
  run = await runtime.dispatchCommand({
    runId: run.runId,
    expectedRevision: run.revision,
    commandId: 'a9-explicit-git-index-refresh',
    name: 'refresh-checks',
    input: {
      archiveActionId: run.actions.at(-1)!.id,
      approvalWaitId: approval.id,
      proposalHash: approval.proposalHash,
      checkIds: ['git-index'],
      summary:
        'The worktree bytes are unchanged, but the index now contains value.ts. Rerun the original repeatable cached-diff check. The unrelated one-time check remains applicable.',
    } as unknown as RuntimeValue,
    context: { requestId: 'a9-git-refresh-command', projectRoot: root },
  });
  const supplementalActionId = run.actions.at(-1)!.id;
  run = await runtime.execute({
    runId: run.runId,
    actionId: supplementalActionId,
    executorId: 'comet-native-checks',
    context: { requestId: 'a9-git-refresh-execution', projectRoot: root },
  });
  const supplemental = run.actions.find((action) => action.id === supplementalActionId)!;
  const checks = (supplemental.outcome!.output as unknown as { checks: CheckReceipt[] }).checks;
  const latestGit = checks.find((check) => check.id === 'git-index')!;
  expect(latestGit).toMatchObject({ status: 'failed', exitCode: 1 });
  expect(latestGit.reusedFrom).toBeUndefined();
  expect(latestGit.logRef).not.toBe(
    originalChecks.find((check) => check.id === 'git-index')!.logRef,
  );
  const originalB = originalChecks.find((check) => check.id === 'b')!;
  expect(checks.find((check) => check.id === 'b')).toMatchObject({
    status: 'passed',
    exitCode: originalB.exitCode,
    logRef: originalB.logRef,
    reusedFrom: { actionId: originalCheckAction.id, checkId: 'b' },
  });
  expect(await fs.readFile(path.join(root, '.git/a9-once'), 'utf8')).toBe('once');
  expect(await fs.readFile(path.join(root, 'value.ts'))).toEqual(originalBytes);
  expect(run.runId).toBe(prepared.run.runId);
  expect(run.state).toEqual(originalState);
  expect(run.waits).toEqual(originalWaits);
  expect(run.outputs['verify.report']).toEqual(originalReport);
  expect(await fs.readFile(path.join(prepared.changeDir, 'verification.md'), 'utf8')).toBe(
    originalReportText,
  );
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', status: 'pending' });
  await expect(assertNativeSdkArchiveCheckInputs({ run, projectRoot: root })).rejects.toThrow(
    '最新检查',
  );
  // 再从真实 Archive 执行边界拒绝，不能只凭观察接口的摘要宣称被阻断。
  const archiveActionId = run.actions.at(-1)!.id;
  const rejected = await runtime.execute({
    runId: run.runId,
    actionId: archiveActionId,
    executorId: 'comet-native-archive-preflight',
    context: { requestId: 'a9-archive-must-reject-newest-failure', projectRoot: root },
  });
  expect(rejected.actions.find((action) => action.id === archiveActionId)).toMatchObject({
    stepId: 'archive.prepare',
    status: 'failed',
    outcome: {
      status: 'failed',
      output: {
        ready: false,
        reason: 'check-failed',
        message: expect.stringContaining('最新检查'),
      },
    },
  });
  expect(rejected.state).not.toMatchObject({ archived: true });
  expect(rejected.actions.some((action) => action.stepId === 'archive.execute')).toBe(false);
  expect(rejected.waits).toEqual(originalWaits);
  expect(rejected.state).toEqual(originalState);
  expect(rejected.outputs['verify.report']).toEqual(originalReport);
  expect(await fs.readFile(path.join(root, '.git/a9-once'), 'utf8')).toBe('once');

  // 修复 index 后沿原只读预检重试，再显式补相同 Git 检查；不重开验收或重放 B。
  execFileSync('git', ['restore', '--staged', '--', 'value.ts'], { cwd: root });
  expect(await fs.readFile(path.join(root, 'value.ts'))).toEqual(originalBytes);
  let resumed = await runtime.retry({
    runId: rejected.runId,
    actionId: archiveActionId,
    attempt: rejected.actions.find((action) => action.id === archiveActionId)!.attempt,
  });
  resumed = await runtime.dispatchCommand({
    runId: resumed.runId,
    expectedRevision: resumed.revision,
    commandId: 'a9-refresh-repaired-git-index',
    name: 'refresh-checks',
    input: {
      archiveActionId: resumed.actions.at(-1)!.id,
      approvalWaitId: approval.id,
      proposalHash: approval.proposalHash,
      checkIds: ['git-index'],
      summary:
        'The index is restored. Recheck the cached diff and retain the unrelated one-time receipt.',
    } as unknown as RuntimeValue,
    context: { requestId: 'a9-repaired-git-command', projectRoot: root },
  });
  resumed = await runtime.execute({
    runId: resumed.runId,
    actionId: resumed.actions.at(-1)!.id,
    executorId: 'comet-native-checks',
    context: { requestId: 'a9-repaired-git-execution', projectRoot: root },
  });
  expect(resumed.state).toEqual(originalState);
  expect(resumed.waits).toEqual(originalWaits);
  expect(resumed.outputs['verify.report']).toEqual(originalReport);
  await assertNativeSdkArchiveCheckInputs({ run: resumed, projectRoot: root });
  for (const executorId of [
    'comet-native-archive-preflight',
    'comet-native-archive-apply',
    'comet-native-archive-finalize',
  ]) {
    resumed = await runtime.execute({
      runId: resumed.runId,
      actionId: resumed.actions.at(-1)!.id,
      executorId,
      context: { requestId: `a9-repaired-${executorId}`, projectRoot: root },
    });
  }
  expect(resumed.status).toBe('completed');
  expect(resumed.runId).toBe(prepared.run.runId);
  expect(resumed.actions.filter((action) => action.stepId === 'archive.execute')).toHaveLength(1);
  expect(resumed.waits).toEqual(originalWaits);
  expect(resumed.actions.find((action) => action.id === supplementalActionId)).toEqual(
    supplemental,
  );
  expect(await fs.readFile(path.join(root, '.git/a9-once'), 'utf8')).toBe('once');
  expect(await fs.readFile(path.join(root, 'value.ts'))).toEqual(originalBytes);
});
