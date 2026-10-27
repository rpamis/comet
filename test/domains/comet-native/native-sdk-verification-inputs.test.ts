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
} from '../../../domains/comet-native/native-sdk-checks.js';
import { inspectNativeSdkRunDiagnostics } from '../../../domains/comet-native/native-sdk-diagnostics.js';
import { inspectNativeSdkCheckExecutions } from '../../../domains/comet-native/native-sdk-check-execution.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import type { NativeCheckPlan } from '../../../domains/comet-native/native-check-executor.js';

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
    throw new Error(
      `Native fixture check execution failed: ${failed?.actions.at(-1)?.reason ?? 'no persisted reason'}`,
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

  it('reuses only unchanged Runtime-proven check inputs across a repaired candidate and retains the approved Shape', async () => {
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
