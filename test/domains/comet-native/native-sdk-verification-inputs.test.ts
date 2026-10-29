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
  assertNativeSdkCandidateUnchanged,
  observeNativeSdkInputs,
  assertNativeSdkArchiveCheckInputs,
} from '../../../domains/comet-native/native-sdk-checks.js';
import { inspectNativeSdkRunDiagnostics } from '../../../domains/comet-native/native-sdk-diagnostics.js';
import { inspectNativeSdkCheckExecutions } from '../../../domains/comet-native/native-sdk-check-execution.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import type { NativeCheckPlan } from '../../../domains/comet-native/native-check-executor.js';
import { nativeEditReviewScope } from '../../../domains/comet-native/native-edit-review-scope.js';
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

it.each([false, true])(
  'rejects changed gitlink generated inputs and archives restored inputs (dirty=%s)',
  async (dirty) => {
    const prepared = await checkedCandidate({
      prepareProject: async (root) => {
        const child = path.join(root, 'dependency');
        await fs.mkdir(child);
        const git = (cwd: string, args: string[]) =>
          execFileSync(
            'git',
            ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
            { cwd, stdio: 'pipe' },
          );
        git(child, ['init', '--quiet']);
        await writeProjectFile(child, '.gitignore', 'dist/\n');
        await writeProjectFile(child, 'source.js', 'source\n');
        git(child, ['add', '.']);
        git(child, ['commit', '-qm', 'child']);
        git(root, ['add', 'dependency']);
        git(root, ['commit', '-qm', 'gitlink']);
        if (dirty) await writeProjectFile(child, 'source.js', 'dirty source\n');
        await writeProjectFile(child, 'dist/output.txt', 'good');
      },
      verificationChecks: [gitlinkOutputCheck],
    });
    const child = path.join(prepared.root, 'dependency');
    await writeProjectFile(child, 'dist/output.txt', 'bad');
    expect(() =>
      execFileSync(gitlinkOutputCheck.executable, gitlinkOutputCheck.argv, { cwd: child }),
    ).toThrow();
    await expect(submitVerifierResult(prepared)).rejects.toThrow(/检查输入已变化/);
    await writeProjectFile(child, 'dist/output.txt', 'good');
    const run = await prepared.runtime.inspect(prepared.run.runId);
    const verified = await submitVerifierResult(
      { ...prepared, run },
      'pass',
      'verifier-restored-result',
    );
    await completeArchive(prepared, verified);
  },
);

async function writeProjectFile(root: string, relative: string, content: string) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

it('archives ignored build artifact roots without treating its own moved documents as generated drift', async () => {
  const prepared = await checkedCandidate({
    artifactRootRef: 'build',
    prepareProject: async (root) => {
      await fs.appendFile(path.join(root, '.git/info/exclude'), '\nbuild/\n');
    },
  });
  await completeArchive(prepared, await submitVerifierResult(prepared));
});

it('diagnoses a failed candidate capture before Archive without mislabeling it as legacy evidence', async () => {
  const prepared = await checkedCandidate();
  // 模拟旧执行留下的空摘要收据；不通过此损坏收据推进正常流程。
  const run = structuredClone(prepared.run);
  const check = run.actions.findLast((action) => action.stepId === 'verify.checks')!;
  const output = check.outcome!.output as Record<string, RuntimeValue>;
  output.candidateInputFingerprintGate = null;
  output.inputSnapshot = {
    ...(output.inputSnapshot as Record<string, RuntimeValue>),
    complete: false,
    diagnostics: ['工作区输入无法完整读取：client/.env.development（文件无法读取）'],
  };
  await expect(
    assertNativeSdkCandidateUnchanged({ run, projectRoot: prepared.root, requireEvidence: true }),
  ).rejects.toThrow(/本次检查未建立候选实现摘要.*client\/\.env\.development/u);
  const before = JSON.stringify(run);
  const diagnosis = await inspectNativeSdkRunDiagnostics(prepared.root, run);
  expect(diagnosis.healthy).toBe(false);
  expect(diagnosis.issues).toContainEqual(
    expect.objectContaining({
      code: 'native-check-candidate-unavailable',
      message: expect.stringContaining('client/.env.development'),
      nextCommand: `comet native status ${run.runId} --json`,
    }),
  );
  expect(JSON.stringify(diagnosis)).not.toContain('旧检查');
  expect(JSON.stringify(run)).toBe(before);
});

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
    artifactRootRef?: string;
    receiptFault?: ReceiptFault;
    checkSource?: string;
    executeChecks?: boolean;
    verificationChecks?: NativeCheckPlan[];
    files?: Record<string, string>;
    prepareProject?: (root: string) => Promise<void>;
    builderOverrides?: Record<string, unknown>;
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
  await writeProjectConfig(root, defaultProjectConfig(artifactRootRef, 'en'));
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
                    const oldState = args[2]!.state as unknown as NativePortableState;
                    const oldInput = {
                      state: oldState,
                      projectRoot: root,
                      plans: options.verificationChecks ?? [check],
                      managedArtifactRoot: paths.artifactRoot,
                    };
                    const oldBefore = options.legacyReceipt
                      ? await nativeCheckInputSnapshot(oldInput)
                      : null;
                    const result = await executor.execute(...args);
                    const output = { ...(result.output as Record<string, RuntimeValue>) };
                    // 通过真实执行器生成结果，只改变被测收据格式，不伪造状态推进。
                    if (options.legacyReceipt) {
                      // 0.5.0 没有 rawInput；用当时的真实输入绑定协议重建收据，不能混入新格式。
                      delete output.inputSnapshot;
                      delete output.rawInput;
                      output.inputBefore = oldBefore!.fingerprint;
                      output.inputAfter = (await nativeCheckInputSnapshot(oldInput)).fingerprint;
                      output.candidateInputFingerprintGate = await nativeCandidateInputGate({
                        projectRoot: root,
                        candidateId: oldState.builder_handoff!.candidate_id,
                        plans: oldInput.plans,
                        managedArtifactRoot: paths.artifactRoot,
                        editReviewScope: nativeEditReviewScope(paths, oldState),
                        shapeSemanticSnapshot: (
                          await readNativeApprovedShapeSemanticSnapshot({ paths, state: oldState })
                        )?.snapshot,
                        legacyShapeSemanticSnapshot: oldState.shape_semantic_snapshot === undefined,
                      });
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
      'submittedAt',
      { submittedAt: '2026-10-23T01:00:00.00Z' },
      /submittedAt.*2026-10-23T01:00:00\.000Z/u,
    ],
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

  it('archives a verified dirty embedded repository and rejects subsequent dirty content drift', async () => {
    const prepared = await checkedCandidate({
      prepareProject: async (root) => {
        const child = path.join(root, 'dependency');
        await fs.mkdir(child);
        execFileSync('git', ['init', '--quiet'], { cwd: child });
        await fs.writeFile(path.join(child, 'value.txt'), 'baseline\n');
        execFileSync('git', ['add', '.'], { cwd: child });
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
            'child',
          ],
          { cwd: child },
        );
        execFileSync('git', ['add', 'dependency'], { cwd: root, stdio: 'pipe' });
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
            'gitlink',
          ],
          { cwd: root },
        );
        await fs.appendFile(path.join(root, '.gitignore'), '.pnpm-store\n');
        await fs.symlink(
          child,
          path.join(root, '.pnpm-store'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        expect(
          execFileSync('git', ['check-ignore', '--', '.pnpm-store'], {
            cwd: root,
            encoding: 'utf8',
          }).trim(),
        ).toBe('.pnpm-store');
        await fs.writeFile(path.join(child, 'value.txt'), 'verified dirty value\n');
      },
    });
    const output = prepared.run.outputs['verify.checks'].value as {
      candidateInputFingerprintGate: string | null;
      inputSnapshot: { complete: boolean };
    };
    expect(output.candidateInputFingerprintGate).toMatch(/^[a-f0-9]{64}$/u);
    expect(output.inputSnapshot.complete).toBe(true);
    const dirty = path.join(prepared.root, 'dependency/value.txt');
    await fs.writeFile(dirty, 'unverified dirty value\n');
    await expect(submitVerifierResult(prepared)).rejects.toThrow(/候选|输入|candidate|input/iu);
    await fs.writeFile(dirty, 'verified dirty value\n');
    prepared.run = (await prepared.store.read(prepared.run.runId))!;
    const verified = await submitVerifierResult(prepared, 'pass', 'restored-verifier-result');
    await completeArchive(prepared, verified);
    expect(await fs.readFile(dirty, 'utf8')).toBe('verified dirty value\n');
  });

  it.each(['package-declaration', 'execution-environment', 'tampered-log', 'unproven-command'])(
    'does not reuse stale or unproven check evidence for a successor candidate: %s',
    async (fault) => {
      const plans = ['left', 'right'].map((name) => ({
        id: name,
        name: `Check ${name}`,
        executable: process.execPath,
        argv:
          fault === 'unproven-command'
            ? ['-e', `require('node:fs').readFileSync('${name}.mjs')`]
            : ['--check', `${name}.mjs`],
        cwdRef: '.',
        timeoutMs: 5_000,
        repeatable: true,
      }));
      const prepared = await checkedCandidate({
        verificationChecks: plans,
        files: { 'left.mjs': 'export const left = 1;\n', 'right.mjs': 'export const right = 1;\n' },
      });
      const original = prepared.run.outputs['verify.checks'].value as {
        checks: Array<{ logRef: string }>;
      };
      let run = await submitVerifierResult(prepared, 'fail');
      await writeProjectFile(prepared.root, 'left.mjs', 'export const left = 2;\n');
      if (fault === 'package-declaration')
        await writeProjectFile(prepared.root, 'package.json', '{"type":"module"}');
      if (fault === 'execution-environment')
        vi.stubEnv(
          'PATH',
          `${process.env.PATH}${path.delimiter}${path.join(prepared.root, 'other-tools')}`,
        );
      if (fault === 'tampered-log')
        await fs.appendFile(
          path.join(resolveWorkspaceRuntimeRootSync(prepared.root), original.checks[1].logRef),
          'changed original log',
        );
      run = await succeedLatestAction(
        prepared.runtime,
        run,
        prepared.root,
        'fresh-builder',
        {
          summary: 'Review the changed candidate.',
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: '2026-10-23T02:00:00.000Z',
          verificationChecks: plans,
        },
        'fresh-builder-session',
      );
      run = await prepared.runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'fresh-checks', projectRoot: prepared.root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
      const current = run.outputs['verify.checks'].value as {
        checks: Array<{ logRef: string; reusedFrom?: unknown }>;
      };
      expect(
        current.checks.every(
          (check, index) => !check.reusedFrom && check.logRef !== original.checks[index].logRef,
        ),
      ).toBe(true);
      expect(
        await nativeSdkCurrentCheckSummaries({ run, projectRoot: prepared.root }),
      ).toHaveLength(2);
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

  it('reuses only unchanged Runtime-proven check inputs across a repaired candidate and retains the approved Shape', async () => {
    // Python CI 的动态库路径不属于这个隔离执行样例；注入环境另测拒绝复用。
    vi.stubEnv('LD_LIBRARY_PATH', undefined);
    const plans = ['left', 'right'].map((name) => ({
      id: name,
      name: `Check ${name} syntax`,
      executable: process.execPath,
      argv: ['--check', `${name}.mjs`],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: true,
    }));
    const prepared = await checkedCandidate({
      files: { 'left.mjs': 'export const left = 1;\n', 'right.mjs': 'export const right = 1;\n' },
      verificationChecks: plans,
    });
    const originalState = prepared.run.state as unknown as NativePortableState;
    const originalChecks = prepared.run.outputs['verify.checks'].value as {
      checks: Array<{ id: string; logRef: string }>;
    };
    let run = await submitVerifierResult(prepared, 'fail');
    expect(run.state).toMatchObject({
      phase: 'build',
      shape_confirmation_hash: originalState.shape_confirmation_hash,
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });
    expect(run.actions.at(-1)!.input).toMatchObject({
      activation: {
        repairContext: {
          previousCandidateId: originalState.builder_handoff!.candidate_id,
          shapeConfirmationHash: originalState.shape_confirmation_hash,
          unresolvedAcceptanceIds: ['A1'],
        },
      },
    });
    const reviewScope = {
      ...nativeEditReviewScope(prepared.paths, run.state as unknown as NativePortableState),
      judgment: 'agent' as const,
    };
    const originalAction = prepared.run.actions.find(
      (action) => action.stepId === 'verify.checks',
    )!;
    const review = await prepareEditReview(reviewScope, {
      intent: 'write',
      toolName: 'Write',
      targets: ['left.mjs'],
      writes: [{ path: 'left.mjs', content: 'export const left = 2;\n' }],
    });
    await recordEditReview(
      reviewScope,
      {
        proposalHash: review.proposalHash,
        decision: 'implementation-changed',
        summary:
          'Current Agent retains the right check after inspecting the left-only repair and the full input changes.',
        retainedChecks: [{ actionId: originalAction.id, checkId: 'right' }],
      },
      { kind: 'runtime-agent', executionRef: 'repaired-builder-session' },
    );
    await writeProjectFile(prepared.root, 'left.mjs', 'export const left = 2;\n');
    run = await succeedLatestAction(
      prepared.runtime,
      run,
      prepared.root,
      'repaired-builder',
      {
        summary: 'Repair the left implementation while preserving the right module.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-10-23T02:00:00.000Z',
        verificationChecks: plans,
      },
      'repaired-builder-session',
    );
    run = await prepared.runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'incremental-repair-checks', projectRoot: prepared.root },
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    const refreshed = run.outputs['verify.checks'].value as {
      checks: Array<{
        id: string;
        logRef: string;
        reusedFrom?: { actionId: string; candidateId: string };
      }>;
    };
    expect(refreshed.checks[0].logRef).not.toBe(originalChecks.checks[0].logRef);
    expect(refreshed.checks[0].reusedFrom).toBeUndefined();
    expect(refreshed.checks[1]).toMatchObject({
      logRef: originalChecks.checks[1].logRef,
      reusedFrom: { candidateId: originalState.builder_handoff!.candidate_id },
    });
    expect(run.state).toMatchObject({
      shape_confirmation_hash: originalState.shape_confirmation_hash,
    });
    const completed = await submitVerifierResult({ ...prepared, run });
    await completeArchive(prepared, completed);
  });

  it('completes Archive after the Builder, Runtime checks and Verifier finish normally', async () => {
    const prepared = await checkedCandidate();
    const completed = await submitVerifierResult(prepared);
    await completeArchive(prepared, completed);
  });

  it('archives with unrelated ignored cache links while keeping generated inputs bound', async () => {
    const prepared = await checkedCandidate({
      prepareProject: async (root) => {
        await fs.appendFile(path.join(root, '.gitignore'), '.cache/\n');
        const target = path.join(root, 'cache-target');
        await fs.mkdir(target);
        await fs.mkdir(path.join(root, '.cache'));
        await fs.symlink(
          target,
          path.join(root, '.cache', 'ordinary-link'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      },
    });
    const check = prepared.run.actions.find((action) => action.stepId === 'verify.checks')!;
    await writeProjectFile(prepared.root, '.next/server/app/page.js', 'changed');
    await expect(submitVerifierResult(prepared)).rejects.toThrow('OUTCOME_REJECTED');
    await writeProjectFile(prepared.root, '.next/server/app/page.js', 'good');
    const current = { ...prepared, run: (await prepared.store.read(prepared.run.runId))! };
    const verified = await submitVerifierResult(current, 'pass', 'restored-cache-link-input');
    expect(verified.actions.find((action) => action.id === check.id)).toEqual(check);
    await completeArchive(current, verified);
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
    const open = fs.open;
    vi.spyOn(fs, 'open').mockImplementation((file, flags, mode) => {
      if (path.resolve(String(file)) === path.join(root, 'dist/.env'))
        return Promise.reject(
          Object.assign(new Error('fixture access denied'), { code: 'EACCES' }),
        );
      return open(file, flags, mode);
    });
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
    const originalState = prepared.run.state;
    await expect(
      assertNativeSdkCandidateUnchanged({ run: prepared.run, projectRoot: prepared.root }),
    ).rejects.toThrow('候选内容');
    const observation = await observeNativeSdkInputs(prepared.run, prepared.root);
    expect(observation.changedDuringCheck.map((change) => change.path)).toEqual(
      expect.arrayContaining(['.next/types/routes.d.ts', '.next/dev/types/routes.d.ts']),
    );
    expect(observation.changesSinceCheck).toEqual([]);
    const scope = {
      ...nativeEditReviewScope(
        prepared.paths,
        prepared.run.state as unknown as NativePortableState,
      ),
      judgment: 'agent' as const,
    };
    const proposal = await prepareObservedEditReview(scope, observation.changes);
    await recordEditReview(
      scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'non-behavioral',
        summary:
          'The actual generated type output was checked in this execution and preserves the submitted behavior.',
      },
      { kind: 'runtime-agent', executionRef: 'verifier-session' },
    );
    expect(prepared.run.state).toEqual(originalState);
    const completed = await submitVerifierResult(prepared);
    await completeArchive(prepared, completed);
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

  it('keeps completed check results but rejects unjudged source writes during the check', async () => {
    const prepared = await checkedCandidate({
      checkSource:
        'require("node:fs").writeFileSync("value.ts", "changed implementation"); process.stdout.write("check completed");',
    });
    expect(prepared.run.actions.find((action) => action.stepId === 'verify.checks')).toMatchObject({
      status: 'succeeded',
    });
    await expect(submitVerifierResult(prepared)).rejects.toThrow('OUTCOME_REJECTED');
    const observation = await observeNativeSdkInputs(prepared.run, prepared.root);
    expect(observation.changedDuringCheck).toMatchObject([{ path: 'value.ts' }]);
    expect(await fs.readFile(path.join(prepared.root, 'value.ts'), 'utf8')).toBe(
      'changed implementation',
    );
  });

  it.each([false, true])(
    'refreshes only the affected check after approval and preserves the report and decision (failure=%s)',
    async (failure) => {
      const plans = ['a', 'b'].map((id) => ({
        id,
        name: `Check ${id}`,
        executable: process.execPath,
        argv: [
          '-e',
          `const fs=require('node:fs'); fs.appendFileSync('.git/check-${id}', '1'); ${id === 'a' ? 'if(fs.readFileSync("handbook.md", "utf8").includes("bad"))process.exit(1);' : 'fs.readFileSync("value.ts", "utf8");'}`,
        ],
        cwdRef: '.',
        timeoutMs: 5000,
        repeatable: true,
      }));
      const prepared = await checkedCandidate({
        files: { 'handbook.md': 'original explanation' },
        verificationChecks: plans,
      });
      let run = await submitVerifierResult(prepared);
      for (const executorId of ['comet-native-report'])
        run = await prepared.runtime.execute({
          runId: run.runId,
          actionId: run.actions.at(-1)!.id,
          executorId,
          context: { requestId: executorId, projectRoot: prepared.root },
        });
      const approval = run.waits.at(-1)!;
      run = await prepared.runtime.resolveWait({
        runId: run.runId,
        waitId: approval.id,
        proposalHash: approval.proposalHash,
        decisionId: 'approved-before-edit',
        choice: 'approved',
      });
      run = await prepared.runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report-revalidate',
        context: { requestId: 'pre-edit-revalidation', projectRoot: prepared.root },
      });
      expect(run.actions.at(-1)?.stepId).toBe('archive.prepare');
      const originalState = run.state;
      const originalWaits = run.waits;
      const originalReport = run.outputs['verify.report'];
      const originalChecks = run.actions.find((action) => action.stepId === 'verify.checks')!;
      await writeProjectFile(
        prepared.root,
        'handbook.md',
        failure ? 'bad spelling' : 'clarified explanation',
      );
      const observed = await observeNativeSdkInputs(run, prepared.root);
      const scope = {
        ...nativeEditReviewScope(prepared.paths, run.state as unknown as NativePortableState),
        judgment: 'agent' as const,
      };
      const proposal = await prepareObservedEditReview(scope, observed.changes);
      await recordEditReview(
        scope,
        {
          proposalHash: proposal.proposalHash,
          decision: 'non-behavioral',
          summary:
            'Only the prose check needs refreshing; implementation and the B check remain applicable.',
          retainedChecks: [{ actionId: originalChecks.id, checkId: 'b' }],
        },
        { kind: 'runtime-agent', executionRef: 'current-agent-after-approval' },
      );
      const request = observed.refreshInputTemplate!;
      expect(request).toBeDefined();
      const { expectedRevision: observedRevision, ...refreshInput } = request;
      expect(observedRevision).toBe(run.revision);
      const command = {
        runId: run.runId,
        expectedRevision: run.revision,
        commandId: 'post-approval-refresh',
        name: 'refresh-checks',
        input: {
          ...refreshInput,
          checkIds: ['a'],
          summary: 'Refresh only the prose check.',
        } as unknown as RuntimeValue,
        context: { requestId: 'refresh-command', projectRoot: prepared.root },
      };
      run = await prepared.runtime.dispatchCommand(command);
      expect((await prepared.runtime.dispatchCommand(command)).revision).toBe(run.revision);
      try {
        run = await prepared.runtime.execute({
          runId: run.runId,
          actionId: run.actions.at(-1)!.id,
          executorId: 'comet-native-checks',
          context: { requestId: 'supplemental-checks', projectRoot: prepared.root },
        });
      } catch (error) {
        throw new Error(
          (await prepared.runtime.inspect(run.runId)).actions.at(-1)?.reason ?? String(error),
          { cause: error },
        );
      }
      expect(run.state).toEqual(originalState);
      expect(run.waits).toEqual(originalWaits);
      expect(run.outputs['verify.report']).toEqual(originalReport);
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', status: 'pending' });
      expect(await fs.readFile(path.join(prepared.root, '.git/check-a'), 'utf8')).toBe('11');
      expect(await fs.readFile(path.join(prepared.root, '.git/check-b'), 'utf8')).toBe('1');
      if (failure)
        await expect(
          assertNativeSdkArchiveCheckInputs({ run, projectRoot: prepared.root }),
        ).rejects.toThrow('最新检查');
      else await assertNativeSdkArchiveCheckInputs({ run, projectRoot: prepared.root });
    },
  );

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

  it('rejects stale verification for generated input inside an entirely ignored parent and archives restored input', async () => {
    const prepared = await checkedCandidate({
      files: { 'scratch/app/dist/input.json': 'original' },
      prepareProject: async (root) => {
        await fs.appendFile(path.join(root, '.gitignore'), 'scratch/\n');
      },
      checkSource:
        'require("node:fs").readFileSync("scratch/app/dist/input.json", "utf8"); process.stdout.write("verified");',
    });
    const check = prepared.run.actions.find((action) => action.stepId === 'verify.checks')!;
    await writeProjectFile(prepared.root, 'scratch/app/dist/input.json', 'changed');
    await expect(submitVerifierResult(prepared)).rejects.toThrow('OUTCOME_REJECTED');
    await writeProjectFile(prepared.root, 'scratch/app/dist/input.json', 'original');
    const current = { ...prepared, run: (await prepared.store.read(prepared.run.runId))! };
    const verified = await submitVerifierResult(current, 'pass', 'restored-generated-input');
    expect(verified.actions.find((action) => action.id === check.id)).toEqual(check);
    await completeArchive(current, verified);
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
    const originalShape = (prepared.run.state as unknown as NativePortableState)
      .shape_confirmation_hash;
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
    const observed = await observeNativeSdkInputs(run, root);
    expect(observed.changes.map((change) => change.path)).toContain('value.ts');
    const scope = {
      ...nativeEditReviewScope(paths, run.state as unknown as NativePortableState),
      judgment: 'agent' as const,
    };
    const proposal = await prepareObservedEditReview(scope, observed.changes);
    expect(proposal.applied).toBe(true);
    expect(
      (
        await projectNativeSdkContinuation({
          run,
          state: run.state as unknown as NativePortableState,
          projectRoot: root,
        })
      ).continuation.action,
    ).toBe('review-edit');
    await recordEditReview(
      scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'implementation-changed',
        summary:
          'The selected value now produces 2; the approved requirement still applies. A needs a new result. The unrelated B data, command and original side effect remain valid.',
        retainedChecks: [{ actionId: originalCheckAction.id, checkId: 'b' }],
      },
      { kind: 'runtime-agent', executionRef: 'a4-current-agent' },
    );
    await expect(assertNativeSdkCandidateUnchanged({ run, projectRoot: root })).rejects.toThrow();
    await writeProjectFile(root, 'value.ts', '3\n');
    const unjudged = await observeNativeSdkInputs(run, root);
    expect(
      await isCheckInputRetained(scope, originalCheckAction.id, unjudged.changes, [], 'b'),
    ).toBe(false);
    expect(await fs.readFile(path.join(root, '.git/a4-check-b'), 'utf8')).toBe('once');
    await writeProjectFile(root, 'value.ts', '2\n');
    const project = (current: WorkflowRun) =>
      projectNativeSdkContinuation({
        run: current,
        state: current.state as unknown as NativePortableState,
        projectRoot: root,
      });
    const revision = await project(run);
    expect(revision.continuation).toMatchObject({
      action: 'repair',
      mode: 'execute',
      requiresUserDecision: false,
    });
    expect(revision.continuation.commandArgs).toContain('--revise-implementation');
    expect(revision.continuation.commandAlternatives?.map((option) => option.name)).toEqual([
      'revise-implementation',
    ]);
    expect(revision.continuation.requiredInputs).not.toContain('user-decision');

    // 沿投影选中的原 Runtime 修订操作；不让旧报告接受新实现。
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
    expect(run.state).toMatchObject({ phase: 'build', shape_confirmation_hash: originalShape });
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
        verificationChecks: plans,
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
    expect(done.state).toMatchObject({ archived: true, shape_confirmation_hash: originalShape });
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
    logSha256: string;
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
  const observed = await observeNativeSdkInputs(run, root);
  expect(observed.changes).toEqual([]);
  expect(observed.changedDuringCheck).toEqual([]);
  expect(observed.contextChanged).toBe(false);
  expect(observed.git.before).not.toBeNull();
  expect(observed.git.current).not.toBeNull();
  expect(observed.git.current!.head).toBe(observed.git.before!.head);
  expect(observed.git.current!.index).not.toBe(observed.git.before!.index);
  expect(observed.git.current).not.toEqual(observed.git.before);
  expect(observed.refreshInputTemplate).toBeDefined();

  // Agent 从实际 git.before/current 和原命令判断 A 依赖 index；没有文件变化，
  // 不伪造 non-behavioral/implementation-changed 或空 changes 的语义收据。
  const { expectedRevision, ...refreshInput } = observed.refreshInputTemplate!;
  run = await runtime.dispatchCommand({
    runId: run.runId,
    expectedRevision,
    commandId: 'a9-explicit-git-index-refresh',
    name: 'refresh-checks',
    input: {
      ...refreshInput,
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
    logSha256: originalB.logSha256,
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
        reason: 'candidate-drift',
        message: expect.stringContaining('最新检查'),
      },
    },
  });
  expect(rejected.state).not.toMatchObject({ archived: true });
  expect(rejected.actions.some((action) => action.stepId === 'archive.execute')).toBe(false);
  expect(rejected.waits).toEqual(originalWaits);
  expect(rejected.outputs['verify.report']).toEqual(originalReport);
  expect(await fs.readFile(path.join(root, '.git/a9-once'), 'utf8')).toBe('once');
});
