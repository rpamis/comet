import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as childProcess from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as classicDomain from '../../../domains/comet-classic/index.js';
import { classicStateCommand } from '../../../domains/comet-classic/classic-state-command.js';
import { classicCheckCommand } from '../../../domains/comet-classic/classic-check-command.js';
import * as checkSnapshots from '../../../domains/comet-classic/classic-check-snapshot.js';
import { classicGuardCommand } from '../../../domains/comet-classic/classic-guard.js';
import { classicArchiveCommand } from '../../../domains/comet-classic/classic-archive.js';
import { writeClassicSdkDesignContext } from '../../../domains/comet-classic/classic-handoff.js';
import {
  parseClassicStateDocument,
  type ClassicState,
} from '../../../domains/comet-classic/classic-state.js';
import {
  createMemoryRuntimeStore,
  createFileRuntimeStore,
  createRuntime,
  type DefineWorkflowOptions,
  type RuntimeEvidenceValidator,
  type RuntimeValidator,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowRuntime,
  type WorkflowTransitionHandler,
} from '../../../domains/engine/runtime.js';
import { registerSdkChangeOwner } from '../../../domains/workflow-contract/change-runtime-owner.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { resolveClassicChangeRuntimeOwner } from '../../../domains/comet-classic/classic-runtime-ownership.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { recordClassicArchiveRequirements } from '../../../domains/comet-classic/classic-artifact-requirements.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, execFileSync: vi.fn(original.execFileSync) };
});
const actualChildProcess =
  await vi.importActual<typeof import('node:child_process')>('node:child_process');

function initialClassicState(workflow: ClassicState['workflow']): ClassicState {
  const projection = parseClassicStateDocument({
    workflow,
    phase: 'open',
    design_doc: null,
    plan: null,
    build_mode: null,
    isolation: null,
    verify_mode: null,
    verify_result: 'pending',
    verified_at: null,
    archived: false,
  });
  if (!projection.classic) throw new Error('Expected a complete Classic state fixture');
  return projection.classic;
}

type ClassicApplication = {
  workflow: DefineWorkflowOptions;
  transitionHandler: WorkflowTransitionHandler;
  evidenceValidators?: readonly RuntimeEvidenceValidator[];
  validators?: readonly RuntimeValidator[];
};

const temporaryRoots: string[] = [];
afterEach(async () => {
  vi.mocked(childProcess.execFileSync)
    .mockReset()
    .mockImplementation(actualChildProcess.execFileSync);
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true })));
});

const openEvidenceValidator = {
  id: 'comet-classic-open-artifacts',
  version: '1',
  validate: ({
    run,
    ref,
    contentHash,
  }: {
    run: Readonly<WorkflowRun>;
    ref: string;
    contentHash: string;
  }) => ({
    accepted: (run.input as { changeDir: string }).changeDir === ref,
    actualHash: contentHash,
  }),
};

const designEvidenceValidator = {
  id: 'comet-classic-design-document',
  version: '1',
  validate: ({
    run,
    ref,
    contentHash,
  }: {
    run: Readonly<WorkflowRun>;
    ref: string;
    contentHash: string;
  }) => ({
    accepted: (run.state as { designDoc: string }).designDoc === ref,
    actualHash: contentHash,
  }),
};

const planEvidenceValidator = {
  id: 'comet-classic-build-plan',
  version: '1',
  validate: ({
    run,
    ref,
    contentHash,
  }: {
    run: Readonly<WorkflowRun>;
    ref: string;
    contentHash: string;
  }) => ({
    accepted: (run.state as { plan: string }).plan === ref,
    actualHash: contentHash,
  }),
};

function testEvidenceValidators(application: ClassicApplication): RuntimeEvidenceValidator[] {
  return [
    openEvidenceValidator,
    designEvidenceValidator,
    planEvidenceValidator,
    ...(application.evidenceValidators?.filter(
      (validator) =>
        validator.id === 'comet-classic-build-check' ||
        validator.id === 'comet-classic-verification-report' ||
        validator.id === 'comet-classic-verify-check',
    ) ?? []),
  ];
}

function testOutcomeValidators(application: ClassicApplication): RuntimeValidator[] {
  return [
    ...(application.validators?.filter(
      (validator) =>
        validator.id !== 'comet-classic-open-revalidation' &&
        validator.id !== 'comet-classic-design-handoff' &&
        validator.id !== 'comet-classic-build-configuration',
    ) ?? []),
    {
      id: 'comet-classic-design-handoff',
      version: '1',
      validate: () => ({ accepted: true }),
    },
    {
      id: 'comet-classic-build-configuration',
      version: '1',
      validate: () => ({ accepted: true }),
    },
    {
      id: 'comet-classic-open-revalidation',
      version: '1',
      validate: ({ action, outcome }) => ({
        accepted:
          action.claim?.executorId === 'comet-classic-open-revalidate' &&
          outcome.status === 'succeeded' &&
          (outcome.output as { contentHash?: unknown } | null)?.contentHash === 'a'.repeat(64),
      }),
    },
  ];
}

async function recordOpenEvidence(
  runtime: WorkflowRuntime,
  run: WorkflowRun,
): Promise<WorkflowRun> {
  return runtime.recordEvidence({
    runId: run.runId,
    evidenceId: run.evidenceWaits![0].id,
    kind: 'classic-open-artifacts',
    ref: 'docs/openspec/changes/example',
    contentHash: 'a'.repeat(64),
    submissionId: 'open-artifacts-1',
    expectedRevision: run.revision,
  });
}

async function acceptOpenEvidence(
  runtime: WorkflowRuntime,
  run: WorkflowRun,
): Promise<WorkflowRun> {
  run = await recordOpenEvidence(runtime, run);
  if ((run.state as { workflow: string }).workflow !== 'full') return run;
  const confirmation = run.waits.at(-1)!;
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: confirmation.id,
    proposalHash: confirmation.proposalHash,
    decisionId: `${run.runId}-open-approved`,
    choice: 'approved',
  });
  return completeLatestAction(
    runtime,
    run,
    { contentHash: 'a'.repeat(64) },
    `${run.runId}-open-revalidated`,
    { executorId: 'comet-classic-open-revalidate' },
  );
}

async function completeLatestAction(
  runtime: WorkflowRuntime,
  run: WorkflowRun,
  output: RuntimeValue,
  receiptId: string,
  options: { executorId?: string; projectRoot?: string } = {},
): Promise<WorkflowRun> {
  const action = run.actions.at(-1)!;
  const claimed = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: options.executorId ?? 'classic-host',
    claimToken: receiptId,
    ...(options.projectRoot
      ? { context: { requestId: receiptId, projectRoot: options.projectRoot } }
      : {}),
  });
  return runtime.recordOutcome({
    runId: claimed.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: receiptId,
      outcomeId: receiptId,
      status: 'succeeded',
      output,
    },
    ...(options.projectRoot
      ? { context: { requestId: receiptId, projectRoot: options.projectRoot } }
      : {}),
  });
}

async function reachFullBuildConfigurationDecision(
  runtime: WorkflowRuntime,
  application: ClassicApplication,
  runId: string,
  boundBranch?: string,
  projectRoot?: string,
): Promise<WorkflowRun> {
  let run = await runtime.start({
    runId,
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
    initialState: initialClassicState('full'),
  });
  run = await completeLatestAction(runtime, run, { event: 'open-complete' }, `${runId}-open`);
  run = await acceptOpenEvidence(runtime, run);
  const handoff = projectRoot
    ? await writeClassicSdkDesignContext({
        projectRoot,
        changeDir: path.join(projectRoot, 'docs/openspec/changes/example'),
        change: 'example',
        contextCompression: null,
      })
    : {};
  const designHash = projectRoot
    ? (
        await classicDomain.classicDesignEvidenceReceipt(
          projectRoot,
          'docs/superpowers/specs/design.md',
        )
      ).contentHash
    : 'b'.repeat(64);
  run = await completeLatestAction(
    runtime,
    run,
    { proposal: 'Use the documented design', ...handoff },
    `${runId}-handoff`,
  );
  const designDecision = run.waits.at(-1)!;
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: designDecision.id,
    proposalHash: designDecision.proposalHash,
    decisionId: `${runId}-design-approved`,
    choice: 'approved',
  });
  run = await completeLatestAction(
    runtime,
    run,
    { designDoc: 'docs/superpowers/specs/design.md' },
    `${runId}-design-document`,
  );
  run = await runtime.recordEvidence({
    runId: run.runId,
    evidenceId: run.evidenceWaits!.at(-1)!.id,
    kind: 'classic-design-document',
    ref: 'docs/superpowers/specs/design.md',
    contentHash: designHash,
    submissionId: `${runId}-design-evidence`,
    expectedRevision: run.revision,
  });
  return completeLatestAction(
    runtime,
    run,
    {
      buildMode: 'executing-plans',
      tddMode: 'tdd',
      reviewMode: 'standard',
      isolation: 'current',
      ...(boundBranch ? { boundBranch } : {}),
    },
    `${runId}-configure`,
  );
}

async function reachFullBuildCheckAction(
  runtime: WorkflowRuntime,
  application: ClassicApplication,
  runId: string,
  boundBranch?: string,
  planHash = 'c'.repeat(64),
  projectRoot?: string,
): Promise<WorkflowRun> {
  let run = await reachFullBuildConfigurationDecision(
    runtime,
    application,
    runId,
    boundBranch,
    projectRoot,
  );
  const configuration = run.waits.at(-1)!;
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: configuration.id,
    proposalHash: configuration.proposalHash,
    decisionId: `${runId}-config-approved`,
    choice: 'approved',
  });
  run = await completeLatestAction(
    runtime,
    run,
    { plan: 'docs/superpowers/plans/2026-09-24-example.md' },
    `${runId}-plan`,
  );
  run = await runtime.recordEvidence({
    runId: run.runId,
    evidenceId: run.evidenceWaits!.at(-1)!.id,
    kind: 'classic-build-plan',
    ref: 'docs/superpowers/plans/2026-09-24-example.md',
    contentHash: planHash,
    submissionId: `${runId}-plan-evidence`,
    expectedRevision: run.revision,
  });
  return completeLatestAction(runtime, run, { event: 'build-complete' }, `${runId}-execution`);
}

async function checkedFullBuildRun(
  runId: string,
  taskCompleted: boolean,
  options: {
    gitBranch?: string;
    boundBranch?: string;
    fileStore?: boolean;
    projectedStore?: boolean;
  } = {},
): Promise<{ runtime: WorkflowRuntime; run: WorkflowRun; projectRoot: string }> {
  const application = classicDomain.defineClassicWorkflowApplication('full');
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-build-accept-'));
  temporaryRoots.push(projectRoot);
  const runtime = createRuntime({
    store: options.projectedStore
      ? createClassicSdkStateStore(projectRoot)
      : options.fileStore
        ? createFileRuntimeStore<WorkflowRun>({
            rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
          })
        : createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    evidenceValidators: testEvidenceValidators(application),
    validators: testOutcomeValidators(application),
  });
  const changeDir = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
  const planFile = path.join(projectRoot, 'docs', 'superpowers', 'plans', '2026-09-24-example.md');
  await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
  await fs.mkdir(changeDir, { recursive: true });
  await fs.mkdir(path.dirname(planFile), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'docs', 'superpowers', 'specs'), { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n',
    ),
    fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n'),
    fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n'),
    fs.writeFile(
      path.join(changeDir, 'tasks.md'),
      `- [${taskCompleted ? 'x' : ' '}] Build <!-- comet-task:build -->\n`,
    ),
    fs.writeFile(
      planFile,
      '<!-- comet-task-authority: docs/openspec/changes/example/tasks.md -->\n# Plan\n<!-- comet-task-ref:build -->\n',
    ),
    fs.writeFile(path.join(projectRoot, 'source.js'), 'const ready = true;\n'),
    fs.writeFile(
      path.join(projectRoot, 'docs', 'openspec', 'config.yaml'),
      'schema: spec-driven\n',
    ),
    fs.writeFile(path.join(projectRoot, 'docs', 'superpowers', 'specs', 'design.md'), '# Design\n'),
  ]);
  if (options.gitBranch) {
    execFileSync('git', ['init', '-b', options.gitBranch], { cwd: projectRoot });
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: projectRoot });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.invalid',
        'commit',
        '--allow-empty',
        '-m',
        'initial',
      ],
      { cwd: projectRoot },
    );
  }
  const planReceipt = await classicDomain.classicPlanEvidenceReceipt(
    projectRoot,
    'docs/superpowers/plans/2026-09-24-example.md',
    'docs/openspec/changes/example',
  );
  const ready = await reachFullBuildCheckAction(
    runtime,
    application,
    runId,
    options.boundBranch,
    planReceipt.contentHash,
    projectRoot,
  );
  const run = await classicDomain.executeClassicSdkCommandCheck(runtime, {
    runId: ready.runId,
    projectRoot,
    argv: [process.execPath, '-e', 'console.log("sdk-check-ok")'],
    cwd: '.',
  });
  return { runtime, run, projectRoot };
}

async function acceptBuildCheckEvidence(
  runtime: WorkflowRuntime,
  run: WorkflowRun,
  projectRoot: string,
): Promise<WorkflowRun> {
  const output = run.actions.at(-1)!.outcome!.output as {
    receiptRef: string;
    contentHash: string;
  };
  return runtime.recordEvidence({
    runId: run.runId,
    evidenceId: run.evidenceWaits!.at(-1)!.id,
    kind: 'classic-build-check',
    ref: output.receiptRef,
    contentHash: output.contentHash,
    submissionId: `${run.runId}-build-check-evidence`,
    expectedRevision: run.revision,
    context: { requestId: `${run.runId}-build-check-evidence`, projectRoot },
  });
}

async function reachFullVerifyCheckAction(
  runId: string,
  options: {
    gitBranch?: string;
    boundBranch?: string;
    fileStore?: boolean;
    projectedStore?: boolean;
  } = {},
): Promise<{ runtime: WorkflowRuntime; run: WorkflowRun; projectRoot: string }> {
  const { runtime, run, projectRoot } = await checkedFullBuildRun(runId, true, options);
  const verifying = await acceptBuildCheckEvidence(runtime, run, projectRoot);
  const reportRef = 'docs/superpowers/reports/2026-09-24-example-verify.md';
  const reportPath = path.join(projectRoot, ...reportRef.split('/'));
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const report = '# Verification\nPASS\n';
  await fs.writeFile(reportPath, report);
  const reported = await completeLatestAction(
    runtime,
    verifying,
    { event: 'verification-ready', verificationReport: reportRef },
    `${runId}-verify-ready`,
  );
  const ready = await runtime.recordEvidence({
    runId: reported.runId,
    evidenceId: reported.evidenceWaits!.at(-1)!.id,
    kind: 'classic-verification-report',
    ref: reportRef,
    contentHash: createHash('sha256').update(report).digest('hex'),
    submissionId: `${runId}-report-evidence`,
    expectedRevision: reported.revision,
    context: { requestId: `${runId}-report-evidence`, projectRoot },
  });
  return { runtime, run: ready, projectRoot };
}

async function reachFullArchivePrepareAction(
  runId: string,
  options: { fileStore?: boolean; projectedStore?: boolean; withoutGit?: boolean } = {},
): Promise<{ runtime: WorkflowRuntime; run: WorkflowRun; projectRoot: string }> {
  const { runtime, run, projectRoot } = await reachFullVerifyCheckAction(runId, {
    gitBranch: options.withoutGit ? undefined : 'sdk-build',
    boundBranch: options.withoutGit ? undefined : 'sdk-build',
    fileStore: options.fileStore,
    projectedStore: options.projectedStore,
  });
  const checked = await classicDomain.executeClassicSdkCommandCheck(runtime, {
    runId: run.runId,
    projectRoot,
    argv: [process.execPath, '-e', 'console.log("sdk-verify-ok")'],
    cwd: '.',
  });
  const output = checked.actions.at(-1)!.outcome!.output as {
    receiptRef: string;
    contentHash: string;
  };
  const archived = await runtime.recordEvidence({
    runId: checked.runId,
    evidenceId: checked.evidenceWaits!.at(-1)!.id,
    kind: 'classic-verify-check',
    ref: output.receiptRef,
    contentHash: output.contentHash,
    submissionId: `${runId}-verify-check-evidence`,
    expectedRevision: checked.revision,
    context: { requestId: `${runId}-verify-check-evidence`, projectRoot },
  });
  return { runtime, run: archived, projectRoot };
}

async function inspectPersistedSdkEntry(
  run: WorkflowRun,
  projectRoot: string,
  phase: 'verify' | 'archive',
) {
  await registerSdkChangeOwner(projectRoot, {
    schema: 'comet.change-owner.v1',
    workflow: 'classic',
    change: 'example',
    format: 'sdk',
    application: 'classic-full',
    runId: run.runId,
  });
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
  });
  expect(await store.read(run.runId)).toEqual(run);
  return classicStateCommand(['check', 'example', phase], {
    json: true,
    invocationCwd: projectRoot,
    projectRoot,
  });
}

async function reachFullArchiveExecuteAction(
  runId: string,
  options: {
    deliveryAction?: 'local' | 'push' | 'pr';
    remotePath?: string;
    prBaseBranch?: string;
    projectedStore?: boolean;
  } = {},
): Promise<{ runtime: WorkflowRuntime; run: WorkflowRun; projectRoot: string }> {
  const { runtime, run, projectRoot } = await reachFullArchivePrepareAction(runId, {
    projectedStore: options.projectedStore,
  });
  if (options.remotePath) {
    execFileSync('git', ['remote', 'add', 'origin', options.remotePath], { cwd: projectRoot });
  }
  const prepared = await completeLatestAction(
    runtime,
    run,
    {
      targetBranch: 'sdk-build',
      ...(options.deliveryAction && options.deliveryAction !== 'local' ? { remote: 'origin' } : {}),
      ...(options.prBaseBranch ? { prBaseBranch: options.prBaseBranch } : {}),
      summary: 'Archive example change',
    },
    `${runId}-prepared`,
  );
  const decision = prepared.waits.at(-1)!;
  const approved = await runtime.resolveWait({
    runId: prepared.runId,
    waitId: decision.id,
    proposalHash: decision.proposalHash,
    decisionId: `${runId}-approved`,
    choice: options.deliveryAction ?? 'local',
  });
  const preflighted = await classicDomain.executeClassicSdkArchivePreflight(runtime, {
    runId: approved.runId,
    projectRoot,
  });
  return { runtime, run: preflighted, projectRoot };
}

async function commitValidLocalArchive(
  runtime: WorkflowRuntime,
  run: WorkflowRun,
  projectRoot: string,
): Promise<{ pending: WorkflowRun; commit: string }> {
  const active = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
  const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
  const archived = path.join(projectRoot, ...archivedRef.split('/'));
  await fs.mkdir(path.dirname(archived), { recursive: true });
  await fs.rename(active, archived);
  const pending = await completeLatestAction(
    runtime,
    run,
    { archiveDirectory: archivedRef },
    `${run.runId}-archive-files`,
    { executorId: 'comet-classic-archive', projectRoot },
  );
  const designDocRef = 'docs/superpowers/specs/design.md';
  const planRef = 'docs/superpowers/plans/2026-09-24-example.md';
  await fs.writeFile(
    path.join(projectRoot, ...designDocRef.split('/')),
    '---\narchived-with: 2026-09-24-example\nstatus: final\n---\n# Design\n',
  );
  await fs.writeFile(
    path.join(projectRoot, ...planRef.split('/')),
    '---\narchived-with: 2026-09-24-example\nstatus: final\n---\n# Plan\n',
  );
  execFileSync('git', ['add', '--', archivedRef, designDocRef, planRef], { cwd: projectRoot });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Comet Test',
      '-c',
      'user.email=comet-test@example.invalid',
      'commit',
      '-m',
      'chore: archive example',
    ],
    { cwd: projectRoot },
  );
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim();
  return { pending, commit };
}

function mockSdkPullRequest(commit: string, pr: Record<string, unknown>): void {
  vi.mocked(childProcess.execFileSync).mockImplementation(((
    command: string,
    args: string[],
    options: unknown,
  ) => {
    if (command === 'git' && args.includes('ls-remote')) {
      return `${commit}\trefs/heads/sdk-build`;
    }
    if (command === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify(pr);
    }
    return actualChildProcess.execFileSync(command, args, options as never);
  }) as typeof childProcess.execFileSync);
}

describe('Classic workflow application through the public Runtime SDK', () => {
  it('rejects an Archive completion claim while the change is still active', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-forged-completion',
    );
    await expect(
      completeLatestAction(
        runtime,
        run,
        { archiveDirectory: 'docs/openspec/changes/archive/2026-09-24-example' },
        'archive-forged-completion-outcome',
        { executorId: 'comet-classic-archive', projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    const current = await runtime.inspect(run.runId);
    expect(current.state).toMatchObject({ archived: false });
  });

  it('keeps delivery pending after the archived change passes Archive outcome validation', async () => {
    const { runtime, run, projectRoot } =
      await reachFullArchiveExecuteAction('archive-completed-run');
    const active = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
    const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
    const archived = path.join(projectRoot, ...archivedRef.split('/'));
    await fs.mkdir(path.dirname(archived), { recursive: true });
    await fs.rename(active, archived);
    const completed = await completeLatestAction(
      runtime,
      run,
      { archiveDirectory: archivedRef },
      'archive-completed-run-outcome',
      { executorId: 'comet-classic-archive', projectRoot },
    );
    expect(completed.status).toBe('running');
    expect(completed.state).toMatchObject({ archived: true, phase: 'archive' });
    expect(completed.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.deliver',
      status: 'pending',
    });
  });

  it('rejects local delivery that has no real archive commit', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-delivery-no-commit',
    );
    const active = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
    const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
    const archived = path.join(projectRoot, ...archivedRef.split('/'));
    await fs.mkdir(path.dirname(archived), { recursive: true });
    await fs.rename(active, archived);
    const pending = await completeLatestAction(
      runtime,
      run,
      { archiveDirectory: archivedRef },
      'archive-delivery-files',
      { executorId: 'comet-classic-archive', projectRoot },
    );
    await expect(
      completeLatestAction(
        runtime,
        pending,
        { action: 'local', targetBranch: 'sdk-build', commit: 'a'.repeat(40) },
        'archive-delivery-forged',
        { projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    const current = await runtime.inspect(run.runId);
    expect(current.status).toBe('running');
    expect(current.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.deliver',
      status: 'running',
    });
  });

  it('rejects an archive commit that includes unrelated user files', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-delivery-unrelated-file',
    );
    const active = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
    const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
    const archived = path.join(projectRoot, ...archivedRef.split('/'));
    await fs.mkdir(path.dirname(archived), { recursive: true });
    await fs.rename(active, archived);
    const pending = await completeLatestAction(
      runtime,
      run,
      { archiveDirectory: archivedRef },
      'archive-delivery-unrelated-files',
      { executorId: 'comet-classic-archive', projectRoot },
    );
    execFileSync('git', ['add', '--', archivedRef, 'source.js'], { cwd: projectRoot });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.invalid',
        'commit',
        '-m',
        'chore: archive example',
      ],
      { cwd: projectRoot },
    );
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    await expect(
      completeLatestAction(
        runtime,
        pending,
        { action: 'local', targetBranch: 'sdk-build', commit },
        'archive-delivery-unrelated-outcome',
        { projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    expect((await runtime.inspect(run.runId)).status).toBe('running');
  });

  it('rejects delivery when another commit intervened after Archive preflight', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-delivery-intervening-commit',
    );
    execFileSync('git', ['add', '--', 'source.js'], { cwd: projectRoot });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.invalid',
        'commit',
        '-m',
        'chore: unrelated work',
      ],
      { cwd: projectRoot },
    );
    const active = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
    const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
    const archived = path.join(projectRoot, ...archivedRef.split('/'));
    await fs.mkdir(path.dirname(archived), { recursive: true });
    await fs.rename(active, archived);
    const pending = await completeLatestAction(
      runtime,
      run,
      { archiveDirectory: archivedRef },
      'archive-delivery-intervening-files',
      { executorId: 'comet-classic-archive', projectRoot },
    );
    execFileSync('git', ['add', '--', archivedRef], { cwd: projectRoot });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.invalid',
        'commit',
        '-m',
        'chore: archive example',
      ],
      { cwd: projectRoot },
    );
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    await expect(
      completeLatestAction(
        runtime,
        pending,
        { action: 'local', targetBranch: 'sdk-build', commit },
        'archive-delivery-intervening-outcome',
        { projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
  });

  it('rejects a local archive commit that omitted Design Doc and Plan annotations', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-delivery-missing-annotations',
    );
    const active = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
    const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
    const archived = path.join(projectRoot, ...archivedRef.split('/'));
    await fs.mkdir(path.dirname(archived), { recursive: true });
    await fs.rename(active, archived);
    const pending = await completeLatestAction(
      runtime,
      run,
      { archiveDirectory: archivedRef },
      'archive-delivery-unannotated-files',
      { executorId: 'comet-classic-archive', projectRoot },
    );
    execFileSync('git', ['add', '--', archivedRef], { cwd: projectRoot });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.invalid',
        'commit',
        '-m',
        'chore: archive example',
      ],
      { cwd: projectRoot },
    );
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    await expect(
      completeLatestAction(
        runtime,
        pending,
        { action: 'local', targetBranch: 'sdk-build', commit },
        'archive-delivery-unannotated-outcome',
        { projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
  });

  it('completes local delivery only after the scoped archive commit is verified', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-delivery-local-complete',
    );
    const { pending, commit } = await commitValidLocalArchive(runtime, run, projectRoot);
    const delivered = await completeLatestAction(
      runtime,
      pending,
      { action: 'local', targetBranch: 'sdk-build', commit },
      'archive-delivery-local-outcome',
      { projectRoot },
    );
    expect(delivered.status).toBe('completed');
    expect(delivered.state).toMatchObject({ archived: true, branchStatus: 'handled' });
  });

  it('restores a moved Archive with its claimed Action unknown on another device', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction('example', {
      projectedStore: true,
    });
    const action = run.actions.at(-1)!;
    expect(action.stepId).toBe('full.archive.execute');
    await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-classic-archive',
      claimToken: 'archive-moved-before-outcome',
      context: { requestId: 'archive-moved-before-outcome', projectRoot },
    });
    const active = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
    await recordClassicArchiveRequirements(projectRoot, active);
    const archived = path.join(
      projectRoot,
      'docs',
      'openspec',
      'changes',
      'archive',
      '2026-09-24-example',
    );
    await fs.mkdir(path.dirname(archived), { recursive: true });
    await fs.rename(active, archived);

    const restoredRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-archive-copy-'));
    temporaryRoots.push(restoredRoot);
    await fs.mkdir(path.join(restoredRoot, '.comet'));
    await fs.cp(
      path.join(projectRoot, '.comet', 'config.yaml'),
      path.join(restoredRoot, '.comet', 'config.yaml'),
    );
    await fs.cp(path.join(projectRoot, 'docs'), path.join(restoredRoot, 'docs'), {
      recursive: true,
    });
    execFileSync('git', ['init', '-b', 'sdk-build'], { cwd: restoredRoot });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.invalid',
        'commit',
        '--allow-empty',
        '-m',
        'initial',
      ],
      { cwd: restoredRoot },
    );

    expect(await resolveClassicChangeRuntimeOwner(restoredRoot, 'example')).toMatchObject({
      format: 'sdk',
    });
    const restored = await inspectClassicSdkRun(restoredRoot, 'example');
    expect(restored.state).toMatchObject({ phase: 'archive', archived: false });
    expect(restored.run.actions.at(-1)).toMatchObject({
      id: action.id,
      stepId: 'full.archive.execute',
      status: 'unknown',
    });
    await expect(
      fs.stat(path.join(restoredRoot, 'docs', 'openspec', 'changes', 'example')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      await fs.stat(
        path.join(restoredRoot, 'docs', 'openspec', 'changes', 'archive', '2026-09-24-example'),
      ),
    ).toBeDefined();
    const reconciled = await withClassicCommandContext(
      { projectRoot: restoredRoot, invocationCwd: restoredRoot },
      () => classicArchiveCommand(['example', '--recover']),
    );
    expect(reconciled.exitCode, reconciled.stderr).toBe(0);
    const continued = await inspectClassicSdkRun(restoredRoot, 'example');
    expect(continued.state.archived).toBe(true);
    expect(continued.run.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.deliver',
      status: 'pending',
    });
  });

  it('restores an archived change awaiting delivery from the copied state file', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction('example', {
      projectedStore: true,
    });
    const { pending } = await commitValidLocalArchive(runtime, run, projectRoot);
    expect(pending.state).toMatchObject({ phase: 'archive', archived: true });
    expect(pending.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.deliver',
      status: 'pending',
    });

    const restoredRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-delivery-copy-'));
    temporaryRoots.push(restoredRoot);
    await fs.mkdir(path.join(restoredRoot, '.comet'));
    await fs.cp(
      path.join(projectRoot, '.comet', 'config.yaml'),
      path.join(restoredRoot, '.comet', 'config.yaml'),
    );
    await fs.cp(path.join(projectRoot, 'docs'), path.join(restoredRoot, 'docs'), {
      recursive: true,
    });
    execFileSync('git', ['init', '-b', 'sdk-build'], { cwd: restoredRoot });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.invalid',
        'commit',
        '--allow-empty',
        '-m',
        'initial',
      ],
      { cwd: restoredRoot },
    );

    expect(await resolveClassicChangeRuntimeOwner(restoredRoot, 'example')).toMatchObject({
      format: 'sdk',
    });
    const restored = await inspectClassicSdkRun(restoredRoot, 'example');
    expect(restored.state).toMatchObject({ phase: 'archive', archived: true });
    expect(restored.run.actions.at(-1)).toMatchObject({
      id: pending.actions.at(-1)!.id,
      stepId: 'full.archive.deliver',
      status: 'pending',
    });
  });

  it('completes push delivery only after the approved remote branch contains the archive commit', async () => {
    const remoteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-remote-'));
    temporaryRoots.push(remoteRoot);
    execFileSync('git', ['init', '--bare', remoteRoot]);
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-delivery-push-complete',
      { deliveryAction: 'push', remotePath: remoteRoot },
    );
    const { pending, commit } = await commitValidLocalArchive(runtime, run, projectRoot);
    execFileSync('git', ['push', 'origin', 'sdk-build'], { cwd: projectRoot });
    const delivered = await completeLatestAction(
      runtime,
      pending,
      { action: 'push', targetBranch: 'sdk-build', remote: 'origin', commit },
      'archive-delivery-push-outcome',
      { projectRoot },
    );
    expect(delivered.status).toBe('completed');
    expect(delivered.state).toMatchObject({ archived: true, branchStatus: 'handled' });
  });

  it('completes PR delivery only when the hosted PR matches the approved repository and archive head', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-delivery-pr-complete',
      {
        deliveryAction: 'pr',
        remotePath: 'https://github.com/example/project.git',
        prBaseBranch: 'main',
      },
    );
    const { pending, commit } = await commitValidLocalArchive(runtime, run, projectRoot);
    const prUrl = 'https://github.com/example/project/pull/42';
    mockSdkPullRequest(commit, {
      url: prUrl,
      headRefName: 'sdk-build',
      headRefOid: commit,
      baseRefName: 'main',
      state: 'OPEN',
    });
    const delivered = await completeLatestAction(
      runtime,
      pending,
      { action: 'pr', targetBranch: 'sdk-build', remote: 'origin', commit, prUrl },
      'archive-delivery-pr-outcome',
      { projectRoot },
    );
    expect(delivered.status).toBe('completed');
    expect(delivered.state).toMatchObject({ archived: true, branchStatus: 'handled' });
  });

  it('rejects a PR whose base branch differs from the approved target', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-delivery-pr-wrong-base',
      {
        deliveryAction: 'pr',
        remotePath: 'https://github.com/example/project.git',
        prBaseBranch: 'main',
      },
    );
    const { pending, commit } = await commitValidLocalArchive(runtime, run, projectRoot);
    const prUrl = 'https://github.com/example/project/pull/42';
    mockSdkPullRequest(commit, {
      url: prUrl,
      headRefName: 'sdk-build',
      headRefOid: commit,
      baseRefName: 'develop',
      state: 'OPEN',
    });
    await expect(
      completeLatestAction(
        runtime,
        pending,
        { action: 'pr', targetBranch: 'sdk-build', remote: 'origin', commit, prUrl },
        'archive-delivery-pr-wrong-base-outcome',
        { projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    expect((await runtime.inspect(run.runId)).status).toBe('running');
  });

  it('rejects an Archive result that moves this change under another change name', async () => {
    const { runtime, run, projectRoot } =
      await reachFullArchiveExecuteAction('archive-wrong-change');
    const active = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
    const archivedRef = 'docs/openspec/changes/archive/2026-09-24-other';
    const archived = path.join(projectRoot, ...archivedRef.split('/'));
    await fs.mkdir(path.dirname(archived), { recursive: true });
    await fs.rename(active, archived);
    await expect(
      completeLatestAction(
        runtime,
        run,
        { archiveDirectory: archivedRef },
        'archive-wrong-change-outcome',
        { executorId: 'comet-classic-archive', projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    expect((await runtime.inspect(run.runId)).state).toMatchObject({ archived: false });
  });

  it('rejects an Archive result when required archived artifacts are missing', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-missing-artifact',
    );
    const active = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
    const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
    const archived = path.join(projectRoot, ...archivedRef.split('/'));
    await fs.mkdir(path.dirname(archived), { recursive: true });
    await fs.rename(active, archived);
    await fs.rm(path.join(archived, 'design.md'));
    await expect(
      completeLatestAction(
        runtime,
        run,
        { archiveDirectory: archivedRef },
        'archive-missing-artifact-outcome',
        { executorId: 'comet-classic-archive', projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    expect((await runtime.inspect(run.runId)).state).toMatchObject({ archived: false });
  });

  it('archives the approved change through a claimed SDK Action', async () => {
    const { runtime, run, projectRoot } =
      await reachFullArchiveExecuteAction('archive-execute-current');
    const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-openspec-'));
    temporaryRoots.push(fakeRoot);
    const executable = path.join(fakeRoot, 'openspec-fake.mjs');
    const invocation = path.join(fakeRoot, 'invocation.txt');
    await fs.writeFile(
      executable,
      [
        '#!/usr/bin/env node',
        "import { promises as fs } from 'node:fs';",
        "import path from 'node:path';",
        `await fs.writeFile(${JSON.stringify(invocation)}, process.argv.slice(2).join(' '));`,
        "const active = path.join(process.cwd(), 'openspec', 'changes', 'example');",
        "const archived = path.join(process.cwd(), 'openspec', 'changes', 'archive', '2026-09-24-example');",
        'await fs.mkdir(path.dirname(archived), { recursive: true });',
        'await fs.rename(active, archived);',
      ].join('\n'),
    );
    await fs.chmod(executable, 0o755);
    const previousCommand = process.env.COMET_OPENSPEC;
    process.env.COMET_OPENSPEC = executable;
    let completed: WorkflowRun;
    try {
      completed = await classicDomain.executeClassicSdkArchive(runtime, {
        runId: run.runId,
        projectRoot,
      });
    } finally {
      if (previousCommand === undefined) delete process.env.COMET_OPENSPEC;
      else process.env.COMET_OPENSPEC = previousCommand;
    }
    expect(completed.status).toBe('running');
    expect(completed.state).toMatchObject({ archived: true });
    expect(completed.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.deliver',
      status: 'pending',
    });
    expect(await fs.readFile(invocation, 'utf8')).toBe('archive example --yes');
    expect(
      await fs.readFile(
        path.join(
          projectRoot,
          'docs',
          'openspec',
          'changes',
          'archive',
          '2026-09-24-example',
          'proposal.md',
        ),
        'utf8',
      ),
    ).toBe('# Proposal\n');
  });

  it('waits for the user delivery choice before scheduling Archive side effects', async () => {
    const { runtime, run } = await reachFullArchivePrepareAction('archive-user-choice');
    expect(run.state).toMatchObject({ phase: 'archive', archiveConfirmation: 'pending' });
    const prepared = await completeLatestAction(
      runtime,
      run,
      { targetBranch: 'sdk-build', remote: 'origin', summary: 'Archive example change' },
      'archive-choice-prepared',
    );
    expect(prepared.waits.at(-1)).toMatchObject({
      stepId: 'full.archive.confirm',
      status: 'pending',
      choices: ['local', 'push', 'pr', 'reverify', 'later'],
    });
    expect(prepared.state).toMatchObject({ phase: 'archive', archiveConfirmation: 'pending' });
    expect(prepared.actions.at(-1)?.stepId).toBe('full.archive.prepare');
  });

  it('reopens Verify when the user requests changes before archiving', async () => {
    const { runtime, run } = await reachFullArchivePrepareAction('archive-reverify');
    const prepared = await completeLatestAction(
      runtime,
      run,
      { targetBranch: 'sdk-build', remote: 'origin', summary: 'Archive example change' },
      'archive-reverify-prepared',
    );
    const decision = prepared.waits.at(-1)!;
    const reopened = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'archive-reverify-requested',
      choice: 'reverify',
    });
    expect(reopened.state).toMatchObject({ phase: 'verify', archiveConfirmation: null });
    expect(reopened.actions.at(-1)).toMatchObject({
      stepId: 'full.verify.run',
      status: 'pending',
    });
  });

  it('records local-only authorization before scheduling Archive preflight', async () => {
    const { runtime, run } = await reachFullArchivePrepareAction('archive-local-choice');
    const prepared = await completeLatestAction(
      runtime,
      run,
      { targetBranch: 'sdk-build', remote: 'origin', summary: 'Archive example change' },
      'archive-local-prepared',
    );
    const decision = prepared.waits.at(-1)!;
    const authorized = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'archive-local-approved',
      choice: 'local',
    });
    expect(authorized.state).toMatchObject({
      phase: 'archive',
      archiveConfirmation: 'confirmed',
    });
    expect(authorized.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.preflight',
      status: 'pending',
    });
    expect(authorized.actions.some((action) => action.stepId === 'full.archive.execute')).toBe(
      false,
    );
  });

  it('keeps Archive unexecuted until its preflight Action succeeds', async () => {
    const { runtime, run, projectRoot } = await reachFullArchivePrepareAction(
      'archive-preflight-required',
    );
    const prepared = await completeLatestAction(
      runtime,
      run,
      { targetBranch: 'sdk-build', summary: 'Archive example change' },
      'archive-preflight-prepared',
    );
    const decision = prepared.waits.at(-1)!;
    const authorized = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'archive-preflight-approved',
      choice: 'local',
    });
    const preflighted = await completeLatestAction(
      runtime,
      authorized,
      {
        deliveryAction: 'local',
        targetBranch: 'sdk-build',
        verifiedBranch: 'sdk-build',
        baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: projectRoot,
          encoding: 'utf8',
        }).trim(),
      },
      'archive-preflight-passed',
    );
    expect(preflighted.state).toMatchObject({
      phase: 'archive',
      archived: false,
      archiveConfirmation: 'confirmed',
    });
    expect(preflighted.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.execute',
      status: 'pending',
    });
  });

  it('runs Archive preflight against the approved branch before dispatching Archive', async () => {
    const executePreflight = (classicDomain as Record<string, unknown>)[
      'executeClassicSdkArchivePreflight'
    ] as
      | ((
          runtime: WorkflowRuntime,
          input: { runId: string; projectRoot: string },
        ) => Promise<WorkflowRun>)
      | undefined;
    expect(executePreflight).toBeTypeOf('function');
    const { runtime, run, projectRoot } = await reachFullArchivePrepareAction(
      'archive-preflight-current',
    );
    const prepared = await completeLatestAction(
      runtime,
      run,
      { targetBranch: 'sdk-build', summary: 'Archive example change' },
      'archive-preflight-current-prepared',
    );
    const decision = prepared.waits.at(-1)!;
    const authorized = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'archive-preflight-current-approved',
      choice: 'local',
    });
    const checked = await executePreflight!(runtime, {
      runId: authorized.runId,
      projectRoot,
    });
    expect(checked.actions.at(-2)).toMatchObject({
      stepId: 'full.archive.preflight',
      status: 'succeeded',
      outcome: {
        output: {
          deliveryAction: 'local',
          targetBranch: 'sdk-build',
          verifiedBranch: 'sdk-build',
        },
      },
    });
    expect(checked.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.execute',
      status: 'pending',
    });
  });

  it('keeps Archive preflight pending when the branch changes after approval', async () => {
    const executePreflight = (classicDomain as Record<string, unknown>)[
      'executeClassicSdkArchivePreflight'
    ] as
      | ((
          runtime: WorkflowRuntime,
          input: { runId: string; projectRoot: string },
        ) => Promise<WorkflowRun>)
      | undefined;
    expect(executePreflight).toBeTypeOf('function');
    const { runtime, run, projectRoot } =
      await reachFullArchivePrepareAction('archive-preflight-drift');
    const prepared = await completeLatestAction(
      runtime,
      run,
      { targetBranch: 'sdk-build', summary: 'Archive example change' },
      'archive-preflight-drift-prepared',
    );
    const decision = prepared.waits.at(-1)!;
    const authorized = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'archive-preflight-drift-approved',
      choice: 'local',
    });
    execFileSync('git', ['checkout', '-b', 'other-branch'], { cwd: projectRoot });
    await expect(
      executePreflight!(runtime, { runId: authorized.runId, projectRoot }),
    ).rejects.toThrow(/branch/u);
    const current = await runtime.inspect(authorized.runId);
    expect(current.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.preflight',
      status: 'pending',
    });
    expect(current.actions.some((action) => action.stepId === 'full.archive.execute')).toBe(false);
  });

  it('keeps Build active when a successful check leaves tasks unfinished', async () => {
    const { runtime, run, projectRoot } = await checkedFullBuildRun(
      'unfinished-build-tasks',
      false,
    );
    await expect(acceptBuildCheckEvidence(runtime, run, projectRoot)).rejects.toThrow(
      /EVIDENCE_REJECTED/,
    );
    expect((await runtime.inspect(run.runId)).state).toMatchObject({ phase: 'build' });
  });

  it('enters Verify only after a current check and completed mapped tasks', async () => {
    const { runtime, run, projectRoot } = await checkedFullBuildRun('complete-build-tasks', true);
    const accepted = await acceptBuildCheckEvidence(runtime, run, projectRoot);
    expect(accepted.state).toMatchObject({ phase: 'verify' });
    expect(accepted.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.build.check.evidence',
      status: 'resolved',
    });
    expect(accepted.actions.at(-1)).toMatchObject({
      stepId: 'full.verify.run',
      status: 'pending',
    });
  });

  it('rejects an unbound Git branch before leaving Build', async () => {
    const { runtime, run, projectRoot } = await checkedFullBuildRun('unbound-build-branch', true, {
      gitBranch: 'sdk-build',
    });
    await expect(acceptBuildCheckEvidence(runtime, run, projectRoot)).rejects.toThrow(
      /EVIDENCE_REJECTED/,
    );
    expect((await runtime.inspect(run.runId)).state).toMatchObject({ phase: 'build' });
  });

  it('accepts a Build configuration bound to the current Git branch', async () => {
    const { runtime, run, projectRoot } = await checkedFullBuildRun('bound-build-branch', true, {
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
    });
    const accepted = await acceptBuildCheckEvidence(runtime, run, projectRoot);
    expect(accepted.state).toMatchObject({ phase: 'verify', boundBranch: 'sdk-build' });
  });

  it('waits for the selected Verify report before running verification checks', async () => {
    const { runtime, run, projectRoot } = await checkedFullBuildRun('verify-report-wait', true);
    const verifying = await acceptBuildCheckEvidence(runtime, run, projectRoot);
    const reportRef = 'docs/superpowers/reports/2026-09-24-example-verify.md';
    const reported = await completeLatestAction(
      runtime,
      verifying,
      { event: 'verification-ready', verificationReport: reportRef },
      'verify-report-ready',
    );
    expect(reported.state).toMatchObject({
      phase: 'verify',
      verificationReport: reportRef,
      verifyResult: 'pending',
    });
    expect(reported.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.verify.report.evidence',
      kind: 'classic-verification-report',
      status: 'pending',
    });
    expect(reported.actions.at(-1)?.stepId).toBe('full.verify.run');
  });

  it('returns a failed Verify assessment to Build without claiming a pass', async () => {
    const { runtime, run, projectRoot } = await checkedFullBuildRun('verify-needs-build', true);
    const verifying = await acceptBuildCheckEvidence(runtime, run, projectRoot);
    const returned = await completeLatestAction(
      runtime,
      verifying,
      { event: 'verify-fail', reason: 'Final assessment found a missing case' },
      'verify-needs-build-result',
    );
    expect(returned.state).toMatchObject({
      phase: 'build',
      verifyResult: 'fail',
      verifyFailures: 1,
    });
    expect(returned.actions.at(-1)).toMatchObject({
      stepId: 'full.build.plan',
      status: 'pending',
    });
  });

  it('records a public SDK Verify failure with its reason before returning to Build', async () => {
    const change = 'example';
    const { runtime, run, projectRoot } = await checkedFullBuildRun(change, true, {
      gitBranch: 'sdk-verify',
      boundBranch: 'sdk-verify',
      fileStore: true,
    });
    await acceptBuildCheckEvidence(runtime, run, projectRoot);
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change,
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    const options = { json: true, invocationCwd: projectRoot, projectRoot };
    const missingReason = await classicStateCommand(['transition', change, 'verify-fail'], options);
    expect(missingReason.exitCode).not.toBe(0);
    const failed = await classicStateCommand(
      ['transition', change, 'verify-fail', '--reason', 'Final review found an unsafe path'],
      options,
    );
    expect(failed.exitCode, failed.stderr).toBe(0);
    expect(failed.data).toMatchObject({
      runtimeFormat: 'sdk',
      phase: 'build',
      nextAction: { kind: 'action', stepId: 'full.build.plan' },
    });
    const persisted = await runtime.inspect(run.runId);
    expect(
      persisted.actions.find((action) => action.stepId === 'full.verify.run')?.outcome?.output,
    ).toMatchObject({
      event: 'verify-fail',
      reason: 'Final review found an unsafe path',
    });
  });

  it('rejects a changed Verify report before scheduling its command check', async () => {
    const { runtime, run, projectRoot } = await checkedFullBuildRun('verify-report-drift', true);
    const verifying = await acceptBuildCheckEvidence(runtime, run, projectRoot);
    const reportRef = 'docs/superpowers/reports/2026-09-24-example-verify.md';
    const reportPath = path.join(projectRoot, ...reportRef.split('/'));
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, '# Verification\nPASS\n');
    const reported = await completeLatestAction(
      runtime,
      verifying,
      { event: 'verification-ready', verificationReport: reportRef },
      'verify-report-drift-ready',
    );
    const priorHash = createHash('sha256').update('# Verification\nPASS\n').digest('hex');
    await fs.writeFile(reportPath, '# Verification\nFAIL\n');
    await expect(
      runtime.recordEvidence({
        runId: reported.runId,
        evidenceId: reported.evidenceWaits!.at(-1)!.id,
        kind: 'classic-verification-report',
        ref: reportRef,
        contentHash: priorHash,
        submissionId: 'stale-verify-report',
        expectedRevision: reported.revision,
        context: { requestId: 'stale-verify-report', projectRoot },
      }),
    ).rejects.toThrow(/EVIDENCE_REJECTED/);
    expect((await runtime.inspect(reported.runId)).state).toMatchObject({ phase: 'verify' });
  });

  it('executes a separate Verify check Action before accepting verification', async () => {
    const { runtime, run, projectRoot } = await reachFullVerifyCheckAction('verify-check-action');
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'full.verify.check',
      status: 'pending',
    });
    const checked = await classicDomain.executeClassicSdkCommandCheck(runtime, {
      runId: run.runId,
      projectRoot,
      argv: [process.execPath, '-e', 'console.log("sdk-verify-ok")'],
      cwd: '.',
    });
    expect(checked.state).toMatchObject({ phase: 'verify', verifyResult: 'pending' });
    expect(checked.actions.at(-1)).toMatchObject({
      stepId: 'full.verify.check',
      status: 'succeeded',
      outcome: { output: { scope: 'verify', exitCode: 0 } },
    });
    expect(checked.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.verify.check.evidence',
      status: 'pending',
    });
  });

  it('enters Archive only after current Verify command evidence is accepted', async () => {
    const { runtime, run, projectRoot } = await reachFullVerifyCheckAction('verify-check-evidence');
    const checked = await classicDomain.executeClassicSdkCommandCheck(runtime, {
      runId: run.runId,
      projectRoot,
      argv: [process.execPath, '-e', 'console.log("sdk-verify-ok")'],
      cwd: '.',
    });
    const output = checked.actions.at(-1)!.outcome!.output as {
      receiptRef: string;
      contentHash: string;
    };
    const accepted = await runtime.recordEvidence({
      runId: checked.runId,
      evidenceId: checked.evidenceWaits!.at(-1)!.id,
      kind: 'classic-verify-check',
      ref: output.receiptRef,
      contentHash: output.contentHash,
      submissionId: 'verify-check-accepted',
      expectedRevision: checked.revision,
      context: { requestId: 'verify-check-accepted', projectRoot },
    });
    expect(accepted.state).toMatchObject({
      phase: 'archive',
      verifyResult: 'pass',
      archiveConfirmation: 'pending',
    });
    expect(accepted.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.prepare',
      status: 'pending',
    });
  });

  it('returns a failed Verify command to Build with its failed Action recorded', async () => {
    const { runtime, run, projectRoot } = await reachFullVerifyCheckAction('verify-command-failed');
    const failed = await classicDomain.executeClassicSdkCommandCheck(runtime, {
      runId: run.runId,
      projectRoot,
      argv: [process.execPath, '-e', 'process.exit(7)'],
      cwd: '.',
    });
    expect(failed.state).toMatchObject({
      phase: 'build',
      verifyResult: 'fail',
      verifyFailures: 1,
    });
    expect(failed.actions.at(-1)).toMatchObject({
      stepId: 'full.build.plan',
      status: 'pending',
    });
    expect(failed.actions.at(-2)).toMatchObject({
      stepId: 'full.verify.check',
      status: 'failed',
      outcome: { output: { scope: 'verify', exitCode: 7 } },
    });
  });

  it('rejects Verify check evidence when the excluded report changes afterward', async () => {
    const { runtime, run, projectRoot } = await reachFullVerifyCheckAction(
      'verify-report-after-check',
    );
    const checked = await classicDomain.executeClassicSdkCommandCheck(runtime, {
      runId: run.runId,
      projectRoot,
      argv: [process.execPath, '-e', 'console.log("sdk-verify-ok")'],
      cwd: '.',
    });
    const reportPath = path.join(
      projectRoot,
      'docs',
      'superpowers',
      'reports',
      '2026-09-24-example-verify.md',
    );
    await fs.writeFile(reportPath, '# Verification\nCHANGED AFTER CHECK\n');
    const output = checked.actions.at(-1)!.outcome!.output as {
      receiptRef: string;
      contentHash: string;
    };
    await expect(
      runtime.recordEvidence({
        runId: checked.runId,
        evidenceId: checked.evidenceWaits!.at(-1)!.id,
        kind: 'classic-verify-check',
        ref: output.receiptRef,
        contentHash: output.contentHash,
        submissionId: 'verify-report-after-check-evidence',
        expectedRevision: checked.revision,
        context: { requestId: 'verify-report-after-check-evidence', projectRoot },
      }),
    ).rejects.toThrow(/EVIDENCE_REJECTED/);
    expect((await runtime.inspect(checked.runId)).state).toMatchObject({ phase: 'verify' });
  });

  it('rejects a Build plan whose task authority belongs to another change', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-plan-owner-'));
    temporaryRoots.push(root);
    const changeRef = 'docs/openspec/changes/example';
    const planRef = 'docs/superpowers/plans/2026-09-24-example.md';
    await Promise.all([
      fs.mkdir(path.join(root, '.comet'), { recursive: true }),
      fs.mkdir(path.join(root, ...changeRef.split('/')), { recursive: true }),
      fs.mkdir(path.join(root, 'docs', 'superpowers', 'plans'), { recursive: true }),
    ]);
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n',
    );
    await fs.writeFile(
      path.join(root, ...changeRef.split('/'), 'tasks.md'),
      '- [ ] Build <!-- comet-task:build -->\n',
    );
    await fs.writeFile(
      path.join(root, ...planRef.split('/')),
      '<!-- comet-task-authority: docs/openspec/changes/other/tasks.md -->\n<!-- comet-task-ref:build -->\n',
    );
    await expect(
      classicDomain.classicPlanEvidenceReceipt(root, planRef, changeRef),
    ).rejects.toThrow(/authority|change/u);
  });

  it('keeps accepted Build plan authority stable across task completion, but detects changed requirements', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-plan-authority-'));
    temporaryRoots.push(root);
    const changeRef = 'docs/openspec/changes/example';
    const planRef = 'docs/superpowers/plans/2026-09-24-example.md';
    const tasksFile = path.join(root, changeRef, 'tasks.md');
    const planFile = path.join(root, planRef);
    await fs.mkdir(path.dirname(tasksFile), { recursive: true });
    await fs.mkdir(path.dirname(planFile), { recursive: true });
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n',
    );
    await fs.writeFile(tasksFile, '- [ ] Build <!-- comet-task:build -->\n');
    await fs.writeFile(
      planFile,
      `<!-- comet-task-authority: ${changeRef}/tasks.md -->\n# Plan\n<!-- comet-task-ref:build -->\n`,
    );
    const accepted = await classicDomain.classicPlanEvidenceReceipt(root, planRef, changeRef);
    await fs.writeFile(tasksFile, '- [x] Build <!-- comet-task:build -->\n');
    expect(await classicDomain.classicPlanEvidenceReceipt(root, planRef, changeRef)).toEqual(
      accepted,
    );
    await fs.writeFile(tasksFile, '- [x] Different work <!-- comet-task:build -->\n');
    expect(
      (await classicDomain.classicPlanEvidenceReceipt(root, planRef, changeRef)).contentHash,
    ).not.toBe(accepted.contentHash);
  });

  it('rejects a new Classic Run whose business state omits required fields', async () => {
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
    });
    await expect(
      runtime.start({
        runId: 'classic-incomplete-state',
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
        initialState: { workflow: 'full', phase: 'open' },
      }),
    ).rejects.toThrow(/INITIAL_STATE_INVALID/);
  });

  it('holds a user-requested plan-ready pause until the user explicitly continues', async () => {
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: testOutcomeValidators(application),
    });
    let run = await runtime.start({
      runId: 'classic-plan-pause',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
      initialState: initialClassicState('full'),
    });
    run = await completeLatestAction(runtime, run, { event: 'open-complete' }, 'pause-open');
    run = await acceptOpenEvidence(runtime, run);
    run = await completeLatestAction(
      runtime,
      run,
      { proposal: 'Use this design' },
      'pause-handoff',
    );
    const designDecision = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: designDecision.id,
      proposalHash: designDecision.proposalHash,
      decisionId: 'pause-design-approved',
      choice: 'approved',
    });
    run = await completeLatestAction(
      runtime,
      run,
      { designDoc: 'docs/superpowers/specs/design.md' },
      'pause-design',
    );
    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: run.evidenceWaits!.at(-1)!.id,
      kind: 'classic-design-document',
      ref: 'docs/superpowers/specs/design.md',
      contentHash: 'b'.repeat(64),
      submissionId: 'pause-design-evidence',
      expectedRevision: run.revision,
    });
    run = await completeLatestAction(
      runtime,
      run,
      {
        buildMode: 'executing-plans',
        tddMode: 'tdd',
        reviewMode: 'standard',
        isolation: 'current',
      },
      'pause-configure',
    );
    const pauseConfiguration = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: pauseConfiguration.id,
      proposalHash: pauseConfiguration.proposalHash,
      decisionId: 'pause-configuration-approved',
      choice: 'approved',
    });
    run = await completeLatestAction(
      runtime,
      run,
      { plan: 'docs/superpowers/plans/2026-09-24-example.md', buildPause: 'plan-ready' },
      'pause-plan',
    );
    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: run.evidenceWaits!.at(-1)!.id,
      kind: 'classic-build-plan',
      ref: 'docs/superpowers/plans/2026-09-24-example.md',
      contentHash: 'c'.repeat(64),
      submissionId: 'pause-plan-evidence',
      expectedRevision: run.revision,
    });
    expect((run.state as ClassicState).buildPause).toBe('plan-ready');
    expect(run.waits.at(-1)).toMatchObject({
      stepId: 'full.build.plan-ready',
      status: 'pending',
      choices: ['continue'],
    });
    expect(run.actions.at(-1)?.stepId).toBe('full.build.plan');

    const continuation = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: continuation.id,
      proposalHash: continuation.proposalHash,
      decisionId: 'user-continued-build',
      choice: 'continue',
    });
    expect((run.state as ClassicState).buildPause).toBeNull();
    expect(run.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.build.plan.evidence',
      status: 'pending',
    });
    expect(run.actions.at(-1)?.stepId).toBe('full.build.plan');
    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: run.evidenceWaits!.at(-1)!.id,
      kind: 'classic-build-plan',
      ref: 'docs/superpowers/plans/2026-09-24-example.md',
      contentHash: 'c'.repeat(64),
      submissionId: 'resumed-plan-evidence',
      expectedRevision: run.revision,
    });
    expect(run.actions.at(-1)?.stepId).toBe('full.build.execute');
  });

  it('waits for a current Build plan receipt before dispatching execution', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-plan-'));
    temporaryRoots.push(root);
    const changeRef = 'docs/openspec/changes/example';
    const designRef = 'docs/superpowers/specs/design.md';
    const planRef = 'docs/superpowers/plans/2026-09-24-example.md';
    const changeDir = path.join(root, ...changeRef.split('/'));
    const designFile = path.join(root, ...designRef.split('/'));
    const planFile = path.join(root, ...planRef.split('/'));
    await Promise.all([
      fs.mkdir(path.join(root, '.comet'), { recursive: true }),
      fs.mkdir(changeDir, { recursive: true }),
      fs.mkdir(path.dirname(designFile), { recursive: true }),
      fs.mkdir(path.dirname(planFile), { recursive: true }),
    ]);
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n',
    );
    await Promise.all([
      fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n'),
      fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n'),
      fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] Build <!-- comet-task:build -->\n'),
      fs.writeFile(
        designFile,
        '---\ncomet_change: example\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\n',
      ),
      fs.writeFile(
        planFile,
        `<!-- comet-task-authority: ${changeRef}/tasks.md -->\n# Initial plan\n<!-- comet-task-ref:build -->\n`,
      ),
    ]);

    const application = classicDomain.defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
      executors: application.executors,
    });
    let run = await runtime.start({
      runId: 'classic-plan-evidence',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: changeRef },
      initialState: { ...initialClassicState('full'), language: 'en', isolation: 'current' },
    });
    run = await completeLatestAction(runtime, run, { event: 'open-complete' }, 'plan-open');
    const openReceipt = await classicDomain.classicOpenEvidenceReceipt(root, changeRef);
    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: run.evidenceWaits!.at(-1)!.id,
      kind: 'classic-open-artifacts',
      ...openReceipt,
      submissionId: 'plan-open-evidence',
      expectedRevision: run.revision,
      context: { requestId: 'plan-open-evidence', projectRoot: root },
    });
    const openConfirmation = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: openConfirmation.id,
      proposalHash: openConfirmation.proposalHash,
      decisionId: 'plan-open-approved',
      choice: 'approved',
    });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-classic-open-revalidate',
      context: { requestId: 'plan-open-revalidation', projectRoot: root },
    });
    const handoff = await writeClassicSdkDesignContext({
      projectRoot: root,
      changeDir,
      change: 'example',
      contextCompression: null,
    });
    run = await completeLatestAction(
      runtime,
      run,
      { proposal: 'Use the design', ...handoff },
      'plan-handoff',
      { projectRoot: root },
    );
    const decision = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'plan-design-approved',
      choice: 'approved',
    });
    run = await completeLatestAction(runtime, run, { designDoc: designRef }, 'plan-design');
    const designReceipt = await classicDomain.classicDesignEvidenceReceipt(root, designRef);
    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: run.evidenceWaits!.at(-1)!.id,
      kind: 'classic-design-document',
      ...designReceipt,
      submissionId: 'plan-design-evidence',
      expectedRevision: run.revision,
      context: { requestId: 'plan-design-evidence', projectRoot: root },
    });
    run = await completeLatestAction(
      runtime,
      run,
      {
        buildMode: 'executing-plans',
        tddMode: 'tdd',
        reviewMode: 'standard',
        isolation: 'current',
        boundBranch: null,
        subagentDispatch: null,
        directOverride: false,
      },
      'plan-configure',
    );
    const planConfiguration = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: planConfiguration.id,
      proposalHash: planConfiguration.proposalHash,
      decisionId: 'plan-configuration-approved',
      choice: 'approved',
    });
    run = await completeLatestAction(runtime, run, { plan: planRef }, 'plan-written');
    expect((run.state as ClassicState).plan).toBe(planRef);
    expect(run.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.build.plan.evidence',
      kind: 'classic-build-plan',
      status: 'pending',
    });
    expect(run.actions.at(-1)?.stepId).toBe('full.build.plan');

    const staleReceipt = await classicDomain.classicPlanEvidenceReceipt(root, planRef, changeRef);
    await fs.writeFile(
      planFile,
      `<!-- comet-task-authority: ${changeRef}/tasks.md -->\n# Revised plan\n<!-- comet-task-ref:build -->\n`,
    );
    await expect(
      runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits!.at(-1)!.id,
        kind: 'classic-build-plan',
        ...staleReceipt,
        submissionId: 'stale-plan',
        expectedRevision: run.revision,
        context: { requestId: 'stale-plan', projectRoot: root },
      }),
    ).rejects.toThrow(/EVIDENCE_REJECTED/);
    expect((await runtime.inspect(run.runId)).actions.at(-1)?.stepId).toBe('full.build.plan');

    const currentReceipt = await classicDomain.classicPlanEvidenceReceipt(root, planRef, changeRef);
    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: run.evidenceWaits!.at(-1)!.id,
      kind: 'classic-build-plan',
      ...currentReceipt,
      submissionId: 'current-plan',
      expectedRevision: run.revision,
      context: { requestId: 'current-plan', projectRoot: root },
    });
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'full.build.execute',
      ref: 'comet-build',
      status: 'pending',
    });
  });

  it('accepts the public Classic SDK Verify entry while verification is pending', async () => {
    const { run, projectRoot } = await reachFullVerifyCheckAction('example', {
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
      fileStore: true,
    });
    expect(run.state).toMatchObject({ phase: 'verify', verifyResult: 'pending' });
    const entry = await inspectPersistedSdkEntry(run, projectRoot, 'verify');
    expect(entry.exitCode, entry.stderr).toBe(0);
    expect(entry.data).toMatchObject({
      phase: 'verify',
      checks: { blocked: false },
    });
  });

  it('accepts the public Classic SDK Archive entry after verification passes', async () => {
    const { run, projectRoot } = await reachFullArchivePrepareAction('example', {
      fileStore: true,
    });
    expect(run.state).toMatchObject({ phase: 'archive', verifyResult: 'pass' });
    const entry = await inspectPersistedSdkEntry(run, projectRoot, 'archive');
    expect(entry.exitCode, entry.stderr).toBe(0);
    expect(entry.data).toMatchObject({
      phase: 'archive',
      checks: { blocked: false },
    });
  });

  it('keeps Build authoritative until Runtime check evidence is accepted', async () => {
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: testOutcomeValidators(application),
    });
    const executeCheck = (classicDomain as Record<string, unknown>)[
      'executeClassicSdkCommandCheck'
    ] as
      | ((
          runtime: WorkflowRuntime,
          input: { runId: string; projectRoot: string; argv: string[]; cwd: string },
        ) => Promise<WorkflowRun>)
      | undefined;
    expect(executeCheck).toBeTypeOf('function');
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-check-'));
    temporaryRoots.push(projectRoot);
    const changeDir = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
    const planFile = path.join(
      projectRoot,
      'docs',
      'superpowers',
      'plans',
      '2026-09-24-example.md',
    );
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.mkdir(changeDir, { recursive: true });
    await fs.mkdir(path.dirname(planFile), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n',
    );
    await fs.writeFile(path.join(changeDir, '.comet.yaml'), 'invalid: [yaml');
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n');
    await fs.mkdir(path.join(projectRoot, 'docs/superpowers/specs'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'docs/superpowers/specs/design.md'),
      '# Technical design\n',
    );
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Build <!-- comet-task:build -->\n');
    await fs.writeFile(
      planFile,
      '<!-- comet-task-authority: docs/openspec/changes/example/tasks.md -->\n# Plan\n<!-- comet-task-ref:build -->\n',
    );
    await fs.writeFile(path.join(projectRoot, 'source.js'), 'const ready = true;\n');
    const planReceipt = await classicDomain.classicPlanEvidenceReceipt(
      projectRoot,
      'docs/superpowers/plans/2026-09-24-example.md',
      'docs/openspec/changes/example',
    );
    let run = await reachFullBuildCheckAction(
      runtime,
      application,
      'classic-build-check',
      undefined,
      planReceipt.contentHash,
      projectRoot,
    );
    expect((run.state as ClassicState).phase).toBe('build');
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'full.build.check',
      type: 'call_tool',
      ref: 'classic-check',
      status: 'pending',
    });
    run = await executeCheck!(runtime, {
      runId: run.runId,
      projectRoot,
      argv: [process.execPath, '-e', 'console.log("sdk-check-ok")'],
      cwd: '.',
    });
    expect(run.actions.at(-1)).toMatchObject({
      status: 'succeeded',
      claim: { executorId: 'comet-classic-check' },
      outcome: { output: { scope: 'build', exitCode: 0 } },
    });
    const checkOutput = run.actions.at(-1)!.outcome!.output as {
      receiptRef: string;
      contentHash: string;
    };
    expect(await fs.readFile(path.join(projectRoot, checkOutput.receiptRef), 'utf8')).toContain(
      'sdk-check-ok',
    );
    expect((run.state as ClassicState).phase).toBe('build');
    expect(run.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.build.check.evidence',
      kind: 'classic-build-check',
      status: 'pending',
    });
    const buildValidator = application.evidenceValidators.find(
      (validator) => validator.id === 'comet-classic-build-check',
    )!;
    const validation = await buildValidator.validate({
      run,
      kind: 'classic-build-check',
      ref: checkOutput.receiptRef,
      contentHash: checkOutput.contentHash,
      context: { requestId: 'verify-check-result', projectRoot },
    });
    expect(validation, validation.reason).toMatchObject({
      accepted: true,
      actualHash: checkOutput.contentHash,
    });
    await fs.writeFile(path.join(projectRoot, 'source.js'), 'const ready = false;\n');
    await expect(
      runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits!.at(-1)!.id,
        kind: 'classic-build-check',
        ref: checkOutput.receiptRef,
        contentHash: checkOutput.contentHash,
        submissionId: 'unverified-build-check',
        expectedRevision: run.revision,
        context: { requestId: 'stale-check-result', projectRoot },
      }),
    ).rejects.toThrow(/EVIDENCE_REJECTED/);
    expect((await runtime.inspect(run.runId)).state).toMatchObject({ phase: 'build' });
  });

  it('returns a failed SDK Build check to Build work without leaving its claimed Action unknown', async () => {
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: testOutcomeValidators(application),
    });
    const run = await reachFullBuildCheckAction(runtime, application, 'classic-failed-build-check');
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-failed-check-'));
    temporaryRoots.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec', 'changes', 'example'), {
      recursive: true,
    });
    await fs.writeFile(path.join(projectRoot, 'source.js'), 'const ready = false;\n');

    const failed = await classicDomain.executeClassicSdkCommandCheck(runtime, {
      runId: run.runId,
      projectRoot,
      argv: [process.execPath, '-e', 'process.exit(7)'],
      cwd: '.',
    });

    expect(failed.status).toBe('running');
    expect((failed.state as ClassicState).phase).toBe('build');
    expect(failed.actions.at(-2)).toMatchObject({
      status: 'failed',
      outcome: { status: 'failed', output: { exitCode: 7, scope: 'build' } },
    });
    expect(failed.actions.at(-1)).toMatchObject({
      stepId: 'full.build.execute',
      status: 'pending',
    });
  });

  it('recovers a successful SDK check receipt without rerunning the check after interruption', async () => {
    const { run, projectRoot } = await checkedFullBuildRun('example', true, {
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
      fileStore: true,
    });
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'example',
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    const checkAction = run.actions.at(-1)!;
    expect(run.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.build.check.evidence',
      status: 'pending',
    });
    await inspectClassicSdkRun(projectRoot, 'example');
    const stateReads = vi.spyOn(fs, 'open');
    try {
      await expect(
        classicCheckCommand(
          ['run', 'example', 'build', '--', process.execPath, '-e', 'console.log("different")'],
          { invocationCwd: projectRoot, projectRoot },
        ),
      ).rejects.toThrow(/does not match the recorded command/u);
      expect(
        stateReads.mock.calls.filter(
          ([file]) =>
            String(file) === path.join(projectRoot, 'docs/openspec/changes/example/.comet.yaml'),
        ),
      ).toHaveLength(1);
    } finally {
      stateReads.mockRestore();
    }
    const resumed = await classicCheckCommand(
      ['run', 'example', 'build', '--', process.execPath, '-e', 'console.log("sdk-check-ok")'],
      { invocationCwd: projectRoot, projectRoot },
    );
    expect(resumed.exitCode, resumed.stderr).toBe(0);
    const recovered = await classicStateCommand(['next', 'example'], {
      json: true,
      invocationCwd: projectRoot,
      projectRoot,
    });
    expect(recovered.data).toMatchObject({
      phase: 'verify',
      nextAction: { kind: 'action', stepId: 'full.verify.run' },
    });
    const persisted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
      }),
      workflows: [],
    });
    const current = await persisted.inspect(run.runId);
    expect(current.actions.filter((action) => action.stepId === 'full.build.check')).toHaveLength(
      1,
    );
    expect(current.actions.find((action) => action.id === checkAction.id)?.outcome?.outcomeId).toBe(
      checkAction.outcome?.outcomeId,
    );
  });

  it('recovers a pending Classic SDK Build receipt through the public Guard without rerunning the check', async () => {
    const { run, projectRoot } = await checkedFullBuildRun('example', true, {
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
      fileStore: true,
    });
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'example',
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    const checkAction = run.actions.at(-1)!;
    const options = { json: false, invocationCwd: projectRoot, projectRoot };
    const preview = await classicGuardCommand(['example', 'build'], options);
    expect(preview.exitCode, preview.stderr).toBe(0);
    const resumed = await classicGuardCommand(['example', 'build', '--apply'], options);
    expect(resumed.exitCode, resumed.stderr).toBe(0);
    expect(resumed.data).toMatchObject({ change: 'example', phase: 'verify' });
    const persisted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
      }),
      workflows: [],
    });
    const current = await persisted.inspect(run.runId);
    expect(current.actions.filter((action) => action.stepId === 'full.build.check')).toHaveLength(
      1,
    );
    expect(current.actions.find((action) => action.id === checkAction.id)?.outcome?.outcomeId).toBe(
      checkAction.outcome?.outcomeId,
    );
  });

  it('routes Classic SDK Verify Guard through report evidence and a real check', async () => {
    const { runtime, run, projectRoot } = await checkedFullBuildRun('example', true, {
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
      fileStore: true,
    });
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'example',
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    const verified = await acceptBuildCheckEvidence(runtime, run, projectRoot);
    expect((verified.state as ClassicState).phase).toBe('verify');
    const reportRef = 'docs/superpowers/reports/2026-09-24-example.md';
    await fs.mkdir(path.join(projectRoot, 'docs', 'superpowers', 'reports'), {
      recursive: true,
    });
    await fs.writeFile(path.join(projectRoot, reportRef), '# Verification\nAll checks passed.\n');
    const options = { json: false, invocationCwd: projectRoot, projectRoot };
    const preview = await classicGuardCommand(
      ['example', 'verify', '--report', reportRef],
      options,
    );
    expect(preview.exitCode, preview.stderr).toBe(0);
    const applied = await classicGuardCommand(
      [
        'example',
        'verify',
        '--report',
        reportRef,
        '--apply',
        '--',
        process.execPath,
        '-e',
        'console.log("verified")',
      ],
      options,
    );
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(applied.data).toMatchObject({ change: 'example', phase: 'archive' });
    const persisted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
      }),
      workflows: [],
    });
    const current = await persisted.inspect(run.runId);
    expect(current.actions.filter((action) => action.stepId === 'full.verify.run')).toHaveLength(1);
    expect(current.actions.filter((action) => action.stepId === 'full.verify.check')).toHaveLength(
      1,
    );
    expect(
      current.evidenceWaits?.some(
        (wait) => wait.stepId === 'full.verify.report.evidence' && wait.status === 'resolved',
      ),
    ).toBe(true);
    expect(
      current.evidenceWaits?.some(
        (wait) => wait.stepId === 'full.verify.check.evidence' && wait.status === 'resolved',
      ),
    ).toBe(true);
    expect(
      await fs.readFile(
        path.join(projectRoot, 'docs/openspec/changes/example/.comet.yaml'),
        'utf8',
      ),
    ).toContain('phase: archive');
  });

  it('recovers a pending Classic SDK Verify receipt through the public Guard without rerunning the check', async () => {
    const { runtime, run, projectRoot } = await reachFullVerifyCheckAction('example', {
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
      fileStore: true,
    });
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'example',
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    const checked = await classicDomain.executeClassicSdkCommandCheck(runtime, {
      runId: run.runId,
      projectRoot,
      argv: [process.execPath, '-e', 'console.log("verify-once")'],
      cwd: '.',
    });
    const checkAction = checked.actions.at(-1)!;
    expect(checked.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.verify.check.evidence',
      status: 'pending',
    });
    const options = { json: false, invocationCwd: projectRoot, projectRoot };
    const resumed = await classicGuardCommand(
      [
        'example',
        'verify',
        '--report',
        'docs/superpowers/reports/2026-09-24-example-verify.md',
        '--apply',
      ],
      options,
    );
    expect(resumed.exitCode, resumed.stderr).toBe(0);
    expect(resumed.data).toMatchObject({ change: 'example', phase: 'archive' });
    const persisted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
      }),
      workflows: [],
    });
    const current = await persisted.inspect(run.runId);
    expect(current.actions.filter((action) => action.stepId === 'full.verify.check')).toHaveLength(
      1,
    );
    expect(current.actions.find((action) => action.id === checkAction.id)?.outcome?.outcomeId).toBe(
      checkAction.outcome?.outcomeId,
    );
  });

  it('blocks Verify Guard when an accepted report changes before the real check', async () => {
    const { run, projectRoot } = await reachFullVerifyCheckAction('example', {
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
      fileStore: true,
    });
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'example',
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    const reportRef = 'docs/superpowers/reports/2026-09-24-example-verify.md';
    await fs.writeFile(
      path.join(projectRoot, reportRef),
      '# Verification\nChanged after acceptance.\n',
    );
    const blocked = await classicGuardCommand(['example', 'verify', '--report', reportRef], {
      json: false,
      invocationCwd: projectRoot,
      projectRoot,
    });
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('changed after accepted evidence');
    const current = await classicStateCommand(['next', 'example'], {
      json: true,
      invocationCwd: projectRoot,
      projectRoot,
    });
    expect(current.data).toMatchObject({
      phase: 'verify',
      nextAction: { kind: 'action', stepId: 'full.verify.check' },
    });
  });

  it('returns a failed Verify check to Build without accepting the Guard transition', async () => {
    const { run, projectRoot } = await reachFullVerifyCheckAction('example', {
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
      fileStore: true,
    });
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'example',
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    const failed = await classicGuardCommand(
      [
        'example',
        'verify',
        '--report',
        'docs/superpowers/reports/2026-09-24-example-verify.md',
        '--apply',
        '--',
        process.execPath,
        '-e',
        'process.exit(7)',
      ],
      { json: false, invocationCwd: projectRoot, projectRoot },
    );
    expect(failed.exitCode).not.toBe(0);
    const current = await classicStateCommand(['next', 'example'], {
      json: true,
      invocationCwd: projectRoot,
      projectRoot,
    });
    expect(current.data).toMatchObject({
      phase: 'build',
      nextAction: { kind: 'action', stepId: 'full.build.plan' },
    });
  });

  it('records a Classic SDK Archive proposal and accepts only its current user decision', async () => {
    const { run, projectRoot } = await reachFullArchivePrepareAction('example', {
      fileStore: true,
    });
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'example',
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    const options = { json: true, invocationCwd: projectRoot, projectRoot };
    const proposed = await classicStateCommand(
      ['propose-archive', 'example', '--summary', 'Archive the verified change'],
      options,
    );
    expect(proposed.exitCode, proposed.stderr).toBe(0);
    expect(proposed.data).toMatchObject({
      change: 'example',
      phase: 'archive',
      wait: {
        proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        choices: ['local', 'push', 'pr', 'reverify', 'later'],
      },
    });
    const proposalHash = (proposed.data as { wait: { proposalHash: string } }).wait.proposalHash;
    const stale = await classicStateCommand(
      ['decide-archive', 'example', '--proposal-hash', 'a'.repeat(64), '--choice', 'local'],
      options,
    );
    expect(stale.exitCode).not.toBe(0);
    const unsupportedPush = await classicStateCommand(
      ['decide-archive', 'example', '--proposal-hash', proposalHash, '--choice', 'push'],
      options,
    );
    expect(unsupportedPush.exitCode).not.toBe(0);
    expect(
      (await classicStateCommand(['get', 'example', 'archive_confirmation'], options)).stdout,
    ).toBe('pending\n');
    const decided = await classicStateCommand(
      ['decide-archive', 'example', '--proposal-hash', proposalHash, '--choice', 'local'],
      options,
    );
    expect(decided.exitCode, decided.stderr).toBe(0);
    expect(decided.data).toMatchObject({
      phase: 'archive',
      nextAction: { kind: 'action', stepId: 'full.archive.preflight' },
    });
    expect(
      (await classicStateCommand(['get', 'example', 'archive_confirmation'], options)).stdout,
    ).toBe('confirmed\n');
  });

  it.each(['source-change', 'late-git-init'] as const)(
    'allows revalidation from Archive after %s without authorizing delivery',
    async (drift) => {
      const { run, projectRoot } = await reachFullArchivePrepareAction('example', {
        fileStore: true,
        withoutGit: drift === 'late-git-init',
        projectedStore: drift === 'late-git-init',
      });
      await registerSdkChangeOwner(projectRoot, {
        schema: 'comet.change-owner.v1',
        workflow: 'classic',
        change: 'example',
        format: 'sdk',
        application: 'classic-full',
        runId: run.runId,
      });
      if (drift === 'late-git-init') {
        execFileSync('git', ['init', '-b', 'sdk-build'], { cwd: projectRoot });
        execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: projectRoot });
      } else {
        await fs.writeFile(path.join(projectRoot, 'changed-after-verify.txt'), 'new input\n');
      }
      const options = { json: true, invocationCwd: projectRoot, projectRoot };
      const proposed = await classicStateCommand(
        ['propose-archive', 'example', '--summary', 'Review delivery or revalidate'],
        options,
      );
      expect(proposed.exitCode, proposed.stderr).toBe(0);
      const proposalHash = (proposed.data as { wait: { proposalHash: string } }).wait.proposalHash;
      const blocked = await classicStateCommand(
        ['decide-archive', 'example', '--proposal-hash', proposalHash, '--choice', 'local'],
        options,
      );
      expect(blocked.exitCode).not.toBe(0);
      expect(blocked.stderr).toContain('check inputs changed');
      expect(blocked.stderr).toContain(
        `comet state decide-archive example --proposal-hash ${proposalHash} --choice reverify`,
      );
      const reopened = await classicStateCommand(
        ['decide-archive', 'example', '--proposal-hash', proposalHash, '--choice', 'reverify'],
        options,
      );
      expect(reopened.exitCode, reopened.stderr).toBe(0);
      expect(reopened.data).toMatchObject({
        phase: 'verify',
        nextAction: { kind: 'action', stepId: 'full.verify.run' },
      });
      expect((await classicStateCommand(['get', 'example', 'verify_result'], options)).stdout).toBe(
        'pending\n',
      );
      await expect(
        fs.access(path.join(projectRoot, 'docs/openspec/changes/example')),
      ).resolves.toBeUndefined();
      const verified = await classicGuardCommand(
        [
          'example',
          'verify',
          '--report',
          'docs/superpowers/reports/2026-09-24-example-verify.md',
          '--apply',
          '--',
          process.execPath,
          '-e',
          'console.log("reverified")',
        ],
        options,
      );
      expect(verified.exitCode, verified.stderr).toBe(0);
      const fresh = await classicStateCommand(
        ['propose-archive', 'example', '--summary', 'Archive the reverified change'],
        options,
      );
      expect(fresh.exitCode, fresh.stderr).toBe(0);
      const freshHash = (fresh.data as { wait: { proposalHash: string } }).wait.proposalHash;
      expect(freshHash).not.toBe(proposalHash);
      const approved = await classicStateCommand(
        ['decide-archive', 'example', '--proposal-hash', freshHash, '--choice', 'local'],
        options,
      );
      expect(approved.exitCode, approved.stderr).toBe(0);
      expect(approved.data).toMatchObject({
        phase: 'archive',
        nextAction: { kind: 'action', stepId: 'full.archive.preflight' },
      });
    },
  );

  it.each(['guard', 'archive'] as const)(
    'routes approved Classic SDK Archive through the public %s command without rerunning it',
    async (command) => {
      const { run, projectRoot } = await reachFullArchivePrepareAction('example', {
        fileStore: true,
      });
      await registerSdkChangeOwner(projectRoot, {
        schema: 'comet.change-owner.v1',
        workflow: 'classic',
        change: 'example',
        format: 'sdk',
        application: 'classic-full',
        runId: run.runId,
      });
      const options = { json: true, invocationCwd: projectRoot, projectRoot };
      const blocked = await classicGuardCommand(['example', 'archive', '--apply'], options);
      expect(blocked.exitCode).not.toBe(0);
      await expect(
        fs.access(path.join(projectRoot, 'docs/openspec/changes/example')),
      ).resolves.toBeUndefined();
      const proposed = await classicStateCommand(
        ['propose-archive', 'example', '--summary', 'Archive the verified change'],
        options,
      );
      expect(proposed.exitCode, proposed.stderr).toBe(0);
      const proposalHash = (proposed.data as { wait: { proposalHash: string } }).wait.proposalHash;
      expect(
        (
          await classicStateCommand(
            ['decide-archive', 'example', '--proposal-hash', proposalHash, '--choice', 'local'],
            options,
          )
        ).exitCode,
      ).toBe(0);
      const sourcePath = path.join(projectRoot, 'source.js');
      const originalSource = await fs.readFile(sourcePath);
      const persisted = createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
      });
      const beforeDrift = await persisted.read(run.runId);
      await fs.appendFile(sourcePath, '\nchanged after delivery approval\n');
      for (const flags of [[], ['--apply']]) {
        const stale = await classicGuardCommand(['example', 'archive', ...flags], options);
        expect(stale.exitCode).toBe(1);
        expect(stale.data).toMatchObject({
          checks: { blocked: true },
          issues: [expect.any(Object)],
        });
        expect(stale.stderr).toContain('check inputs changed');
        expect(await persisted.read(run.runId)).toEqual(beforeDrift);
      }
      await fs.writeFile(sourcePath, originalSource);
      const preview = await classicGuardCommand(['example', 'archive'], options);
      expect(preview.exitCode, preview.stderr).toBe(0);
      expect((await classicStateCommand(['next', 'example'], options)).data).toMatchObject({
        nextAction: { stepId: 'full.archive.preflight' },
      });

      const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-archive-guard-'));
      temporaryRoots.push(fakeRoot);
      const executable = path.join(fakeRoot, 'openspec-fake.mjs');
      await fs.writeFile(
        executable,
        [
          '#!/usr/bin/env node',
          "import { promises as fs } from 'node:fs';",
          "import path from 'node:path';",
          "const active = path.join(process.cwd(), 'openspec', 'changes', 'example');",
          "const archived = path.join(process.cwd(), 'openspec', 'changes', 'archive', '2026-09-26-example');",
          'await fs.mkdir(path.dirname(archived), { recursive: true });',
          'await fs.rename(active, archived);',
        ].join('\n'),
      );
      await fs.chmod(executable, 0o755);
      const previousCommand = process.env.COMET_OPENSPEC;
      process.env.COMET_OPENSPEC = executable;
      const snapshots = vi.spyOn(checkSnapshots, 'collectCheckSnapshot');
      try {
        const applied =
          command === 'guard'
            ? await classicGuardCommand(['example', 'archive', '--apply'], options)
            : await classicArchiveCommand(['example'], options);
        expect(applied.exitCode, applied.stderr).toBe(0);
        expect(applied.data).toMatchObject({
          change: 'example',
          phase: 'archive',
          nextAction: { kind: 'action', stepId: 'full.archive.deliver' },
        });
        // 保留 preflight 与 archive.execute 两个独立的新鲜性边界。
        expect(snapshots).toHaveBeenCalledTimes(2);
      } finally {
        snapshots.mockRestore();
        if (previousCommand === undefined) delete process.env.COMET_OPENSPEC;
        else process.env.COMET_OPENSPEC = previousCommand;
      }
      await expect(
        fs.access(path.join(projectRoot, 'docs/openspec/changes/example')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        fs.access(path.join(projectRoot, 'docs/openspec/changes/archive/2026-09-26-example')),
      ).resolves.toBeUndefined();
      const next = await classicStateCommand(['next', 'example'], options);
      expect(next.data).toMatchObject({
        phase: 'archive',
        nextAction: { kind: 'action', stepId: 'full.archive.deliver' },
      });
      const repeated =
        command === 'guard'
          ? await classicGuardCommand(['example', 'archive', '--apply'], options)
          : await classicArchiveCommand(['example'], options);
      expect(repeated.exitCode).not.toBe(0);
      await expect(
        fs.access(path.join(projectRoot, 'docs/openspec/changes/archive/2026-09-26-example')),
      ).resolves.toBeUndefined();
      execFileSync(
        'git',
        [
          'add',
          '-A',
          '--',
          'docs/openspec/changes',
          'docs/superpowers/specs/design.md',
          'docs/superpowers/plans/2026-09-24-example.md',
        ],
        { cwd: projectRoot },
      );
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.invalid',
          'commit',
          '-m',
          'archive example',
        ],
        { cwd: projectRoot },
      );
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
      }).trim();
      const archivedState = path.join(
        projectRoot,
        'docs/openspec/changes/archive/2026-09-26-example/.comet.yaml',
      );
      const committedState = await fs.readFile(archivedState, 'utf8');
      const wrongCommit = await classicStateCommand(
        ['complete-delivery', 'example', '--commit', 'a'.repeat(40)],
        options,
      );
      expect(wrongCommit.exitCode).not.toBe(0);
      expect(await fs.readFile(archivedState, 'utf8')).toBe(committedState);
      const delivered = await classicStateCommand(
        ['complete-delivery', 'example', '--commit', commit],
        options,
      );
      expect(delivered.exitCode, delivered.stderr).toBe(0);
      expect(delivered.data).toMatchObject({ phase: 'archive', run: { status: 'completed' } });
      const finishedNext = await classicStateCommand(['next', 'example'], options);
      expect(finishedNext.exitCode, finishedNext.stderr).toBe(0);
      expect(finishedNext.data).toMatchObject({
        runtimeFormat: 'sdk',
        nextAction: { kind: 'done' },
        run: { status: 'completed' },
      });
    },
  );

  it('returns stale SDK Build check evidence to Build without replaying the successful check', async () => {
    const { run, projectRoot } = await checkedFullBuildRun('example', true, {
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
      fileStore: true,
    });
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'example',
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    await fs.writeFile(path.join(projectRoot, 'source.js'), 'const ready = false;\n');
    await expect(
      classicCheckCommand(
        ['run', 'example', 'build', '--', process.execPath, '-e', 'console.log("sdk-check-ok")'],
        { invocationCwd: projectRoot, projectRoot },
      ),
    ).rejects.toThrow(/changed|invalidated|EVIDENCE_REJECTED/u);
    const recovery = await classicStateCommand(['next', 'example'], {
      json: true,
      invocationCwd: projectRoot,
      projectRoot,
    });
    expect(recovery.data).toMatchObject({
      phase: 'build',
      nextAction: { kind: 'action', stepId: 'full.build.execute' },
    });
    const persisted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
      }),
      workflows: [],
    });
    const current = await persisted.inspect(run.runId);
    expect(current.actions.filter((action) => action.stepId === 'full.build.check')).toHaveLength(
      1,
    );
    expect(current.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.build.check.evidence',
      status: 'invalidated',
    });
  });

  it('resumes a change with the same Classic workflow definition after process restart', async () => {
    const firstState = initialClassicState('full');
    const firstApplication = classicDomain.defineClassicWorkflowApplication('full');
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({
      store,
      workflows: [firstApplication.workflow],
      transitionHandlers: [firstApplication.transitionHandler],
      evidenceValidators: testEvidenceValidators(firstApplication),
    });
    const run = await runtime.start({
      runId: 'classic-stable-definition',
      workflow: { id: firstApplication.workflow.id, version: firstApplication.workflow.version },
      input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
      initialState: firstState,
    });
    expect(run.state).toEqual(firstState);

    const restartedApplication = classicDomain.defineClassicWorkflowApplication('full');
    const restarted = createRuntime({
      store,
      workflows: [restartedApplication.workflow],
      transitionHandlers: [restartedApplication.transitionHandler],
      evidenceValidators: testEvidenceValidators(restartedApplication),
    });
    expect((await restarted.inspect(run.runId)).state).toEqual(firstState);
  });

  it('persists accepted full Build choices before scheduling plan work', async () => {
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: testOutcomeValidators(application),
    });
    let run = await reachFullBuildConfigurationDecision(
      runtime,
      application,
      'classic-build-configuration',
    );
    expect((run.state as ClassicState).buildMode).toBeNull();
    const configurationDecision = run.waits.at(-1)!;
    expect(configurationDecision).toMatchObject({
      stepId: 'full.build.confirm',
      status: 'pending',
      choices: ['approved', 'rejected'],
    });
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: configurationDecision.id,
      proposalHash: configurationDecision.proposalHash,
      decisionId: 'user-approved-build-configuration',
      choice: 'approved',
    });
    expect(run.state).toMatchObject({
      phase: 'build',
      buildMode: 'executing-plans',
      tddMode: 'tdd',
      reviewMode: 'standard',
      isolation: 'current',
    });
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'full.build.plan',
      ref: 'comet-build',
      status: 'pending',
    });
  });

  it('keeps Build choices uncommitted when the user rejects the configuration', async () => {
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: testOutcomeValidators(application),
    });
    let run = await reachFullBuildConfigurationDecision(
      runtime,
      application,
      'classic-build-config-rejected',
    );
    const decision = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'user-rejected-build-configuration',
      choice: 'rejected',
    });
    expect((run.state as ClassicState).buildMode).toBeNull();
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'full.build.configure',
      status: 'pending',
    });
  });

  it('rejects approval if the displayed Build choices drift from the recorded proposal', async () => {
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: testOutcomeValidators(application),
    });
    const run = await reachFullBuildConfigurationDecision(
      runtime,
      application,
      'classic-build-config-drift',
    );
    const decision = run.waits.at(-1)!;
    const revisedProposal = structuredClone(decision.proposal) as {
      input: RuntimeValue;
      outputs: { 'full.build.configure': { buildMode: string } };
    };
    revisedProposal.outputs['full.build.configure'].buildMode = 'autonomous';
    const revised = await runtime.reviseWait({
      runId: run.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      proposal: revisedProposal,
    });
    const revisedWait = revised.waits.at(-1)!;
    await expect(
      runtime.resolveWait({
        runId: run.runId,
        waitId: revisedWait.id,
        proposalHash: revisedWait.proposalHash,
        decisionId: 'user-approved-drifted-configuration',
        choice: 'approved',
      }),
    ).rejects.toThrow(/no longer matches/);
    expect((await runtime.inspect(run.runId)).state).toMatchObject({ buildMode: null });
  });

  it('captures the current Design document digest for later validation', async () => {
    const receiptFor = (classicDomain as Record<string, unknown>)[
      'classicDesignEvidenceReceipt'
    ] as ((root: string, ref: string) => Promise<{ ref: string; contentHash: string }>) | undefined;
    expect(receiptFor).toBeTypeOf('function');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-design-'));
    temporaryRoots.push(root);
    const ref = 'docs/superpowers/specs/design.md';
    const file = path.join(root, ...ref.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '# Design A\n');
    expect(await receiptFor!(root, ref)).toEqual({
      ref,
      contentHash: createHash('sha256').update('# Design A\n').digest('hex'),
    });
    await fs.writeFile(file, '# Design B\n');
    expect((await receiptFor!(root, ref)).contentHash).toBe(
      createHash('sha256').update('# Design B\n').digest('hex'),
    );
  });

  it('keeps Design authoritative until its document receipt is accepted', async () => {
    const defineApplication = (classicDomain as Record<string, unknown>)[
      'defineClassicWorkflowApplication'
    ] as (profile: ClassicState['workflow']) => ClassicApplication;
    const application = defineApplication('full');
    const designRef = 'docs/superpowers/specs/design.md';
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: testOutcomeValidators(application),
    });
    let run = await runtime.start({
      runId: 'classic-design-evidence',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
      initialState: initialClassicState('full'),
    });
    run = await completeLatestAction(runtime, run, { event: 'open-complete' }, 'design-open');
    run = await acceptOpenEvidence(runtime, run);
    run = await completeLatestAction(
      runtime,
      run,
      { proposal: 'Use design option A' },
      'design-handoff',
    );
    const decision = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'design-decision',
      choice: 'approved',
    });
    run = await completeLatestAction(runtime, run, { designDoc: designRef }, 'design-document');
    expect((run.state as { phase: string }).phase).toBe('design');
    expect(run.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.design.evidence',
      kind: 'classic-design-document',
      status: 'pending',
    });

    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: run.evidenceWaits!.at(-1)!.id,
      kind: 'classic-design-document',
      ref: designRef,
      contentHash: 'b'.repeat(64),
      submissionId: 'design-document-receipt',
      expectedRevision: run.revision,
    });
    expect((run.state as { phase: string }).phase).toBe('build');
    expect(run.actions.at(-1)?.stepId).toBe('full.build.configure');
  });

  it('rejects a direct SDK Build proposal that changes the Open workspace binding', async () => {
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const bindingValidator = application.validators.find(
      (validator) => validator.id === 'comet-classic-build-configuration',
    )!;
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: [
        ...testOutcomeValidators(application).filter(
          (validator) => validator.id !== 'comet-classic-build-configuration',
        ),
        bindingValidator,
      ],
    });
    let run = await runtime.start({
      runId: 'classic-build-binding',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
      initialState: { ...initialClassicState('full'), isolation: 'current', boundBranch: 'main' },
    });
    run = await completeLatestAction(runtime, run, { event: 'open-complete' }, 'binding-open');
    run = await acceptOpenEvidence(runtime, run);
    run = await completeLatestAction(
      runtime,
      run,
      { proposal: 'Use this design' },
      'binding-handoff',
    );
    const designDecision = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: designDecision.id,
      proposalHash: designDecision.proposalHash,
      decisionId: 'binding-design-approved',
      choice: 'approved',
    });
    run = await completeLatestAction(
      runtime,
      run,
      { designDoc: 'docs/superpowers/specs/design.md' },
      'binding-design-doc',
    );
    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: run.evidenceWaits!.at(-1)!.id,
      kind: 'classic-design-document',
      ref: 'docs/superpowers/specs/design.md',
      contentHash: 'b'.repeat(64),
      submissionId: 'binding-design-evidence',
      expectedRevision: run.revision,
    });
    expect(run.actions.at(-1)?.stepId).toBe('full.build.configure');
    await expect(
      completeLatestAction(
        runtime,
        run,
        {
          buildMode: 'autonomous',
          tddMode: 'tdd',
          reviewMode: 'standard',
          isolation: 'worktree',
          boundBranch: 'other',
          subagentDispatch: null,
          directOverride: false,
        },
        'binding-forged-build',
      ),
    ).rejects.toThrow(/binding|isolation/i);
    expect(
      (await runtime.inspect(run.runId)).waits.some((wait) => wait.stepId === 'full.build.confirm'),
    ).toBe(false);
  });

  it('rejects a direct SDK Design handoff without a source-bound context pack', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-handoff-outcome-'));
    temporaryRoots.push(root);
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const handoffValidator = application.validators.find(
      (validator) => validator.id === 'comet-classic-design-handoff',
    )!;
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: [
        ...testOutcomeValidators(application).filter(
          (validator) => validator.id !== 'comet-classic-design-handoff',
        ),
        handoffValidator,
      ],
    });
    let run = await runtime.start({
      runId: 'classic-source-bound-handoff',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
      initialState: initialClassicState('full'),
    });
    run = await completeLatestAction(runtime, run, { event: 'open-complete' }, 'source-bound-open');
    run = await acceptOpenEvidence(runtime, run);
    await expect(
      completeLatestAction(
        runtime,
        run,
        {
          proposal: 'Use this design',
          handoffContext: 'docs/openspec/changes/example/.comet/handoff/design-context.json',
          handoffHash: 'a'.repeat(64),
        },
        'source-bound-handoff',
        { projectRoot: root },
      ),
    ).rejects.toThrow(/handoff|source|OpenSpec/i);
    expect(
      (await runtime.inspect(run.runId)).waits.some(
        (wait) => wait.stepId === 'full.design.confirm',
      ),
    ).toBe(false);
  });

  it('rejects direct SDK Design evidence when the document lacks change metadata', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-design-metadata-'));
    temporaryRoots.push(root);
    const designRef = 'docs/design/example.md';
    await fs.mkdir(path.join(root, 'docs', 'design'), { recursive: true });
    await fs.writeFile(path.join(root, designRef), '# Design without metadata\n');
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: [
        openEvidenceValidator,
        ...application.evidenceValidators.filter(
          (validator) => validator.id !== 'comet-classic-open-artifacts',
        ),
      ],
      validators: testOutcomeValidators(application),
    });
    let run = await runtime.start({
      runId: 'classic-design-metadata',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
      initialState: { ...initialClassicState('full'), language: 'en' },
    });
    run = await completeLatestAction(runtime, run, { event: 'open-complete' }, 'metadata-open');
    run = await acceptOpenEvidence(runtime, run);
    run = await completeLatestAction(
      runtime,
      run,
      { proposal: 'Use a versioned adapter' },
      'metadata-proposal',
    );
    const decision = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'metadata-approved',
      choice: 'approved',
    });
    run = await completeLatestAction(runtime, run, { designDoc: designRef }, 'metadata-document');
    const receipt = await classicDomain.classicDesignEvidenceReceipt(root, designRef);
    await expect(
      runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits!.at(-1)!.id,
        kind: 'classic-design-document',
        ...receipt,
        submissionId: 'metadata-missing',
        expectedRevision: run.revision,
        context: { requestId: 'metadata-missing', projectRoot: root },
      }),
    ).rejects.toThrow(/EVIDENCE_REJECTED/);
    expect((await runtime.inspect(run.runId)).state).toMatchObject({ phase: 'design' });
  });

  it('holds Design at a persistent user decision before dispatching document work', async () => {
    const defineApplication = (classicDomain as Record<string, unknown>)[
      'defineClassicWorkflowApplication'
    ] as (profile: ClassicState['workflow']) => ClassicApplication;
    const application = defineApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: testOutcomeValidators(application),
    });
    let run = await runtime.start({
      runId: 'classic-design-decision',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
      initialState: initialClassicState('full'),
    });
    const open = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: open.id,
      attempt: open.attempt,
      inputHash: open.inputHash,
      executorId: 'classic-host',
      claimToken: 'design-open-claim',
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: open.id,
        attempt: open.attempt,
        inputHash: open.inputHash,
        claimToken: 'design-open-claim',
        outcomeId: 'design-open-outcome',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    run = await acceptOpenEvidence(runtime, run);
    const handoff = run.actions.at(-1)!;
    run = await runtime.claim({
      runId: run.runId,
      actionId: handoff.id,
      attempt: handoff.attempt,
      inputHash: handoff.inputHash,
      executorId: 'classic-host',
      claimToken: 'design-handoff-claim',
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: handoff.id,
        attempt: handoff.attempt,
        inputHash: handoff.inputHash,
        claimToken: 'design-handoff-claim',
        outcomeId: 'design-handoff-outcome',
        status: 'succeeded',
        output: { proposal: 'Use design option A' },
      },
    });
    expect(run.waits.at(-1)).toMatchObject({
      stepId: 'full.design.confirm',
      status: 'pending',
      choices: ['approved', 'rejected'],
    });
    expect(run.actions.at(-1)?.stepId).toBe('full.design.handoff');

    const decision = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'design-approved',
      choice: 'approved',
    });
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'full.design.document',
      ref: 'comet-design',
      status: 'pending',
    });
  });

  it('rejects Open evidence if a required artifact changed after its digest was captured', async () => {
    const receiptFor = (classicDomain as Record<string, unknown>)['classicOpenEvidenceReceipt'] as
      ((root: string, ref: string) => Promise<{ ref: string; contentHash: string }>) | undefined;
    expect(receiptFor).toBeTypeOf('function');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-evidence-'));
    temporaryRoots.push(root);
    const ref = 'docs/openspec/changes/example';
    const changeDir = path.join(root, ...ref.split('/'));
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] Build\n');

    const defineApplication = (classicDomain as Record<string, unknown>)[
      'defineClassicWorkflowApplication'
    ] as (profile: ClassicState['workflow']) => ClassicApplication;
    const application = defineApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
    });
    let run = await runtime.start({
      runId: 'classic-real-open-evidence',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: ref },
      initialState: { ...initialClassicState('full'), language: 'en' },
    });
    const open = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: open.id,
      attempt: open.attempt,
      inputHash: open.inputHash,
      executorId: 'classic-host',
      claimToken: 'real-open-claim',
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: open.id,
        attempt: open.attempt,
        inputHash: open.inputHash,
        claimToken: 'real-open-claim',
        outcomeId: 'real-open-outcome',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    const captured = await receiptFor!(root, ref);
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Build\n');
    await expect(
      runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits![0].id,
        kind: 'classic-open-artifacts',
        ...captured,
        submissionId: 'stale-open-artifacts',
        expectedRevision: run.revision,
        context: { requestId: 'stale', projectRoot: root },
      }),
    ).rejects.toThrow(/EVIDENCE_REJECTED/);
    expect((await runtime.inspect(run.runId)).state).toMatchObject({ phase: 'open' });

    const current = await receiptFor!(root, ref);
    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: run.evidenceWaits![0].id,
      kind: 'classic-open-artifacts',
      ...current,
      submissionId: 'current-open-artifacts',
      expectedRevision: run.revision,
      context: { requestId: 'current', projectRoot: root },
    });
    const confirmation = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: confirmation.id,
      proposalHash: confirmation.proposalHash,
      decisionId: 'real-open-approved',
      choice: 'approved',
    });
    const revalidation = run.actions.at(-1)!;
    await runtime.claim({
      runId: run.runId,
      actionId: revalidation.id,
      attempt: revalidation.attempt,
      inputHash: revalidation.inputHash,
      executorId: 'comet-classic-open-revalidate',
      claimToken: 'real-open-revalidation',
    });
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Build after approval\n');
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: revalidation.id,
          attempt: revalidation.attempt,
          inputHash: revalidation.inputHash,
          claimToken: 'real-open-revalidation',
          outcomeId: 'forged-open-revalidated',
          status: 'succeeded',
          output: { contentHash: current.contentHash },
        },
        context: { requestId: 'forged-open-revalidated', projectRoot: root },
      }),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
    expect((await runtime.inspect(run.runId)).state).toMatchObject({ phase: 'open' });
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Build\n');
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: revalidation.id,
        attempt: revalidation.attempt,
        inputHash: revalidation.inputHash,
        claimToken: 'real-open-revalidation',
        outcomeId: 'real-open-revalidated',
        status: 'succeeded',
        output: { contentHash: current.contentHash },
      },
      context: { requestId: 'real-open-revalidated', projectRoot: root },
    });
    expect((run.state as { phase: string }).phase).toBe('design');
    expect(run.actions.at(-1)?.stepId).toBe('full.design.handoff');
  });

  it('rejects direct SDK Open evidence when an artifact violates the Run language', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-language-'));
    temporaryRoots.push(root);
    const ref = 'docs/openspec/changes/example';
    const changeDir = path.join(root, ...ref.split('/'));
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'proposal.md'),
      '# 变更提案\n本次变更需要验证文档语言保持一致，并且在用户确认之前阻止错误语言的提案进入下一个阶段。\n',
    );
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] Implement the change\n');
    const application = classicDomain.defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
    });
    let run = await runtime.start({
      runId: 'classic-language-evidence',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: ref },
      initialState: { ...initialClassicState('full'), language: 'en' },
    });
    const open = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: open.id,
      attempt: open.attempt,
      inputHash: open.inputHash,
      executorId: 'classic-host',
      claimToken: 'language-open-claim',
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: open.id,
        attempt: open.attempt,
        inputHash: open.inputHash,
        claimToken: 'language-open-claim',
        outcomeId: 'language-open-outcome',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    const receipt = await classicDomain.classicOpenEvidenceReceipt(root, ref);
    await expect(
      runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits![0].id,
        kind: 'classic-open-artifacts',
        ...receipt,
        submissionId: 'wrong-language',
        expectedRevision: run.revision,
        context: { requestId: 'wrong-language', projectRoot: root },
      }),
    ).rejects.toThrow(/EVIDENCE_REJECTED/);
    expect((await runtime.inspect(run.runId)).state).toMatchObject({ phase: 'open' });
  });

  it('keeps full Open authoritative until verified artifacts are approved', async () => {
    const defineApplication = (classicDomain as Record<string, unknown>)[
      'defineClassicWorkflowApplication'
    ] as (profile: ClassicState['workflow']) => ClassicApplication;
    const application = defineApplication('full');
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
    });
    let run = await runtime.start({
      runId: 'classic-full-evidence',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
      initialState: initialClassicState('full'),
    });
    const open = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: open.id,
      attempt: open.attempt,
      inputHash: open.inputHash,
      executorId: 'classic-host',
      claimToken: 'open-evidence-claim',
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: open.id,
        attempt: open.attempt,
        inputHash: open.inputHash,
        claimToken: 'open-evidence-claim',
        outcomeId: 'open-evidence-outcome',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    expect((run.state as { phase: string }).phase).toBe('open');
    expect(run.evidenceWaits?.[0]).toMatchObject({
      kind: 'classic-open-artifacts',
      status: 'pending',
    });
    expect(run.actions).toHaveLength(1);

    run = await recordOpenEvidence(runtime, run);
    expect((run.state as { phase: string }).phase).toBe('open');
    expect(run.actions).toHaveLength(1);
    expect(run.waits.at(-1)).toMatchObject({
      stepId: 'full.open.confirm',
      status: 'pending',
      choices: ['approved', 'rejected'],
      proposal: {
        outputs: {
          'full.open.evidence': {
            ref: 'docs/openspec/changes/example',
            contentHash: 'a'.repeat(64),
          },
        },
      },
    });
    const confirmation = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: confirmation.id,
      proposalHash: confirmation.proposalHash,
      decisionId: 'open-approved',
      choice: 'approved',
    });
    expect((run.state as { phase: string }).phase).toBe('open');
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'full.open.revalidate',
      ref: 'classic-open-revalidate',
      status: 'pending',
    });
  });

  it.each(['hotfix', 'tweak'] as const)(
    'returns a failed %s Build check to implementation work',
    async (profile) => {
      const application = classicDomain.defineClassicWorkflowApplication(profile);
      const runtime = createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        evidenceValidators: [
          openEvidenceValidator,
          ...application.evidenceValidators.filter(
            (validator) => validator.id !== 'comet-classic-open-artifacts',
          ),
        ],
        validators: application.validators,
      });
      let run = await runtime.start({
        runId: `${profile}-failed-build-check`,
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
        initialState: initialClassicState(profile),
      });
      run = await completeLatestAction(runtime, run, { event: 'open-complete' }, `${profile}-open`);
      run = await acceptOpenEvidence(runtime, run);
      run = await completeLatestAction(
        runtime,
        run,
        { event: 'build-complete' },
        `${profile}-build`,
      );
      const check = run.actions.at(-1)!;
      run = await runtime.claim({
        runId: run.runId,
        actionId: check.id,
        attempt: check.attempt,
        inputHash: check.inputHash,
        executorId: 'classic-host',
        claimToken: `${profile}-failed-check`,
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: check.id,
          attempt: check.attempt,
          inputHash: check.inputHash,
          claimToken: `${profile}-failed-check`,
          outcomeId: `${profile}-failed-check`,
          status: 'failed',
          output: { scope: 'build', exitCode: 7 },
        },
      });
      expect(run.status).toBe('running');
      expect((run.state as ClassicState).phase).toBe('build');
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.build.execute`,
        status: 'pending',
      });
    },
  );

  it.each(['hotfix', 'tweak'] as const)(
    'keeps a confirmed %s escalation to full Design in the same SDK Run',
    async (profile) => {
      const application = classicDomain.defineClassicWorkflowApplication(profile);
      const runtime = createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        evidenceValidators: testEvidenceValidators(application),
        validators: testOutcomeValidators(application),
      });
      let run = await runtime.start({
        runId: `${profile}-escalate`,
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
        initialState: {
          ...initialClassicState(profile),
          isolation: 'worktree',
          boundBranch: 'preset-change',
        },
      });
      run = await completeLatestAction(runtime, run, { event: 'open-complete' }, `${profile}-open`);
      run = await acceptOpenEvidence(runtime, run);
      const runId = run.runId;
      run = await completeLatestAction(
        runtime,
        run,
        { event: 'escalation-requested', proposal: 'The fix requires a new public API' },
        `${profile}-escalation-proposal`,
      );
      const firstWait = run.waits.at(-1)!;
      expect(firstWait).toMatchObject({
        stepId: `${profile}.build.escalation-confirm`,
        status: 'pending',
        choices: ['continue', 'upgrade'],
      });
      run = await runtime.resolveWait({
        runId,
        waitId: firstWait.id,
        proposalHash: firstWait.proposalHash,
        decisionId: `${profile}-escalation-continue`,
        choice: 'continue',
      });
      expect(run.state).toMatchObject({ workflow: profile, phase: 'build' });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.build.execute`,
        status: 'pending',
      });
      run = await completeLatestAction(
        runtime,
        run,
        { event: 'escalation-requested', proposal: 'The fix now requires a new public API' },
        `${profile}-escalation-reproposal`,
      );
      const wait = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: `${profile}-escalation-approved`,
        choice: 'upgrade',
      });
      expect(run.runId).toBe(runId);
      expect(run.state).toMatchObject({
        workflow: 'full',
        phase: 'design',
        isolation: 'worktree',
        boundBranch: 'preset-change',
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'full.design.handoff',
        status: 'pending',
      });
      run = await completeLatestAction(
        runtime,
        run,
        {
          proposal: 'Build a full design',
          handoffContext: 'docs/openspec/changes/example',
          handoffHash: 'a'.repeat(64),
        },
        `${profile}-design-handoff`,
      );
      expect(run.waits.at(-1)).toMatchObject({
        stepId: 'full.design.confirm',
        status: 'pending',
      });
    },
  );

  it.each(['hotfix', 'tweak'] as const)(
    'returns a failed %s Verify assessment to Build without claiming completion',
    async (profile) => {
      const application = classicDomain.defineClassicWorkflowApplication(profile);
      const runtime = createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        evidenceValidators: [
          openEvidenceValidator,
          {
            id: 'comet-classic-build-check',
            version: '1',
            validate: ({ contentHash }) => ({ accepted: true, actualHash: contentHash }),
          },
          ...application.evidenceValidators.filter(
            (validator) =>
              validator.id !== 'comet-classic-open-artifacts' &&
              validator.id !== 'comet-classic-build-check',
          ),
        ],
        validators: application.validators,
      });
      let run = await runtime.start({
        runId: `${profile}-failed-verify`,
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
        initialState: initialClassicState(profile),
      });
      run = await completeLatestAction(runtime, run, { event: 'open-complete' }, `${profile}-open`);
      run = await acceptOpenEvidence(runtime, run);
      run = await completeLatestAction(
        runtime,
        run,
        { event: 'build-complete' },
        `${profile}-build`,
      );
      run = await completeLatestAction(
        runtime,
        run,
        { scope: 'build', receiptRef: 'checks/build.log', contentHash: 'a'.repeat(64) },
        `${profile}-check`,
      );
      run = await runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits!.at(-1)!.id,
        kind: 'classic-build-check',
        ref: 'checks/build.log',
        contentHash: 'a'.repeat(64),
        submissionId: `${profile}-check-evidence`,
        expectedRevision: run.revision,
      });
      run = await completeLatestAction(
        runtime,
        run,
        { event: 'verify-fail', reason: 'Final assessment found a missing case' },
        `${profile}-verify-failed`,
      );
      expect(run.state).toMatchObject({ phase: 'build', verifyResult: 'fail', verifyFailures: 1 });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.build.execute`,
        status: 'pending',
      });
    },
  );

  it.each(['hotfix', 'tweak'] as const)(
    'returns a failed %s Verify command to Build with its failure recorded',
    async (profile) => {
      const application = classicDomain.defineClassicWorkflowApplication(profile);
      const runtime = createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        evidenceValidators: [
          openEvidenceValidator,
          ...['comet-classic-build-check', 'comet-classic-verification-report'].map((id) => ({
            id,
            version: '1',
            validate: ({ contentHash }: { contentHash: string }) => ({
              accepted: true,
              actualHash: contentHash,
            }),
          })),
          ...application.evidenceValidators.filter(
            (validator) =>
              ![
                'comet-classic-open-artifacts',
                'comet-classic-build-check',
                'comet-classic-verification-report',
              ].includes(validator.id),
          ),
        ],
        validators: application.validators,
      });
      let run = await runtime.start({
        runId: `${profile}-failed-verify-command`,
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
        initialState: initialClassicState(profile),
      });
      run = await completeLatestAction(runtime, run, { event: 'open-complete' }, `${profile}-open`);
      run = await acceptOpenEvidence(runtime, run);
      run = await completeLatestAction(
        runtime,
        run,
        { event: 'build-complete' },
        `${profile}-build`,
      );
      run = await completeLatestAction(
        runtime,
        run,
        { scope: 'build', receiptRef: 'checks/build.log', contentHash: 'a'.repeat(64) },
        `${profile}-build-check`,
      );
      run = await runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits!.at(-1)!.id,
        kind: 'classic-build-check',
        ref: 'checks/build.log',
        contentHash: 'a'.repeat(64),
        submissionId: `${profile}-build-check-evidence`,
        expectedRevision: run.revision,
      });
      run = await completeLatestAction(
        runtime,
        run,
        { event: 'verification-ready', verificationReport: 'docs/report.md' },
        `${profile}-verify-ready`,
      );
      run = await runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits!.at(-1)!.id,
        kind: 'classic-verification-report',
        ref: 'docs/report.md',
        contentHash: 'b'.repeat(64),
        submissionId: `${profile}-verify-report-evidence`,
        expectedRevision: run.revision,
      });
      const check = run.actions.at(-1)!;
      run = await runtime.claim({
        runId: run.runId,
        actionId: check.id,
        attempt: check.attempt,
        inputHash: check.inputHash,
        executorId: 'classic-host',
        claimToken: `${profile}-failed-verify-check`,
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: check.id,
          attempt: check.attempt,
          inputHash: check.inputHash,
          claimToken: `${profile}-failed-verify-check`,
          outcomeId: `${profile}-failed-verify-check`,
          status: 'failed',
          output: { scope: 'verify', exitCode: 7 },
        },
      });
      expect(run.state).toMatchObject({ phase: 'build', verifyResult: 'fail', verifyFailures: 1 });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.build.execute`,
        status: 'pending',
      });
    },
  );

  it.each(['hotfix', 'tweak'] as const)(
    'completes %s through checked SDK Actions and a scoped archive commit',
    async (profile) => {
      const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), `classic-sdk-${profile}-`));
      temporaryRoots.push(projectRoot);
      const changeDir = path.join(projectRoot, 'docs', 'openspec', 'changes', 'example');
      const reportRef = 'docs/superpowers/reports/2026-09-24-example-verify.md';
      const reportText = '# Verification\nPASS\n';
      await fs.mkdir(changeDir, { recursive: true });
      await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
      await fs.mkdir(path.join(projectRoot, 'docs', 'superpowers', 'reports'), {
        recursive: true,
      });
      await Promise.all([
        fs.writeFile(
          path.join(projectRoot, '.comet', 'config.yaml'),
          'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n',
        ),
        fs.writeFile(
          path.join(projectRoot, 'docs', 'openspec', 'config.yaml'),
          'schema: spec-driven\n',
        ),
        fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n'),
        fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n'),
        fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Build\n'),
        fs.writeFile(path.join(projectRoot, 'source.js'), 'const ready = true;\n'),
        fs.writeFile(path.join(projectRoot, ...reportRef.split('/')), reportText),
      ]);
      execFileSync('git', ['init', '-b', 'sdk-preset'], { cwd: projectRoot });
      execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: projectRoot });
      execFileSync('git', ['add', '.'], { cwd: projectRoot });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.invalid',
          'commit',
          '-m',
          'initial',
        ],
        { cwd: projectRoot },
      );
      const defineApplication = (classicDomain as Record<string, unknown>)[
        'defineClassicWorkflowApplication'
      ] as (profile: ClassicState['workflow']) => ClassicApplication;
      const application = defineApplication(profile);
      const runtime = createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        evidenceValidators: testEvidenceValidators(application),
        validators: application.validators,
      });
      let run = await runtime.start({
        runId: `classic-${profile}-application`,
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
        initialState: {
          ...initialClassicState(profile),
          isolation: 'current',
          boundBranch: 'sdk-preset',
        },
      });
      expect(run.actions.map((action) => [action.stepId, action.ref])).toEqual([
        [`${profile}.open`, profile === 'hotfix' ? 'comet-hotfix' : 'comet-tweak'],
      ]);
      const open = run.actions[0];
      run = await runtime.claim({
        runId: run.runId,
        actionId: open.id,
        attempt: open.attempt,
        inputHash: open.inputHash,
        executorId: 'classic-host',
        claimToken: `${profile}-claim`,
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: open.id,
          attempt: open.attempt,
          inputHash: open.inputHash,
          claimToken: `${profile}-claim`,
          outcomeId: `${profile}-open-complete`,
          status: 'succeeded',
          output: { event: 'open-complete' },
        },
      });
      run = await acceptOpenEvidence(runtime, run);
      expect((run.state as { phase: string }).phase).toBe('build');
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.build.execute`,
        ref: 'comet-build',
        status: 'pending',
      });
      run = await completeLatestAction(
        runtime,
        run,
        { event: 'build-complete' },
        `${profile}-build-complete`,
      );
      expect((run.state as { phase: string }).phase).toBe('build');
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.build.check`,
        ref: 'classic-check',
        status: 'pending',
      });
      run = await classicDomain.executeClassicSdkCommandCheck(runtime, {
        runId: run.runId,
        projectRoot,
        argv: [process.execPath, '-e', 'console.log("preset-check-ok")'],
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.build.check`,
        status: 'succeeded',
      });
      expect(run.evidenceWaits?.at(-1)).toMatchObject({
        stepId: `${profile}.build.check.evidence`,
        status: 'pending',
      });
      const check = run.actions.at(-1)!.outcome!.output as {
        receiptRef: string;
        contentHash: string;
      };
      run = await runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits!.at(-1)!.id,
        kind: 'classic-build-check',
        ref: check.receiptRef,
        contentHash: check.contentHash,
        submissionId: `${profile}-build-check-evidence`,
        expectedRevision: run.revision,
        context: { requestId: `${profile}-build-check-evidence`, projectRoot },
      });
      expect((run.state as { phase: string }).phase).toBe('verify');
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.verify.run`,
        ref: 'comet-verify',
        status: 'pending',
      });
      run = await completeLatestAction(
        runtime,
        run,
        {
          event: 'verification-ready',
          verificationReport: reportRef,
        },
        `${profile}-verify-ready`,
      );
      expect(run.evidenceWaits?.at(-1)).toMatchObject({
        stepId: `${profile}.verify.report.evidence`,
        kind: 'classic-verification-report',
        status: 'pending',
      });
      run = await runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits!.at(-1)!.id,
        kind: 'classic-verification-report',
        ref: reportRef,
        contentHash: createHash('sha256').update(reportText).digest('hex'),
        submissionId: `${profile}-verify-report-evidence`,
        expectedRevision: run.revision,
        context: { requestId: `${profile}-verify-report-evidence`, projectRoot },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.verify.check`,
        ref: 'classic-check',
        status: 'pending',
      });
      run = await classicDomain.executeClassicSdkCommandCheck(runtime, {
        runId: run.runId,
        projectRoot,
        argv: [process.execPath, '-e', 'console.log("preset-verify-ok")'],
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.verify.check`,
        status: 'succeeded',
      });
      expect(run.evidenceWaits?.at(-1)).toMatchObject({
        stepId: `${profile}.verify.check.evidence`,
        kind: 'classic-verify-check',
        status: 'pending',
      });
      const verifyCheck = run.actions.at(-1)!.outcome!.output as {
        receiptRef: string;
        contentHash: string;
      };
      run = await runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits!.at(-1)!.id,
        kind: 'classic-verify-check',
        ref: verifyCheck.receiptRef,
        contentHash: verifyCheck.contentHash,
        submissionId: `${profile}-verify-check-evidence`,
        expectedRevision: run.revision,
        context: { requestId: `${profile}-verify-check-evidence`, projectRoot },
      });
      expect((run.state as { phase: string }).phase).toBe('archive');
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.archive.prepare`,
        ref: 'comet-archive',
        status: 'pending',
      });
      run = await completeLatestAction(
        runtime,
        run,
        { targetBranch: 'sdk-preset', summary: `Archive ${profile} change` },
        `${profile}-archive-prepare`,
      );
      expect(run.waits.at(-1)).toMatchObject({
        stepId: `${profile}.archive.confirm`,
        choices: ['local', 'push', 'pr', 'reverify', 'later'],
        status: 'pending',
      });
      const archiveDecision = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: archiveDecision.id,
        proposalHash: archiveDecision.proposalHash,
        decisionId: `${profile}-archive-approved`,
        choice: 'local',
      });
      expect((run.state as { archiveConfirmation: string }).archiveConfirmation).toBe('confirmed');
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.archive.preflight`,
        ref: 'classic-archive-preflight',
        status: 'pending',
      });
      run = await classicDomain.executeClassicSdkArchivePreflight(runtime, {
        runId: run.runId,
        projectRoot,
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.archive.execute`,
        ref: 'classic-archive',
        status: 'pending',
      });
      const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), `classic-sdk-${profile}-openspec-`));
      temporaryRoots.push(fakeRoot);
      const executable = path.join(fakeRoot, 'openspec-fake.mjs');
      await fs.writeFile(
        executable,
        [
          '#!/usr/bin/env node',
          "import { promises as fs } from 'node:fs';",
          "import path from 'node:path';",
          "const active = path.join(process.cwd(), 'openspec', 'changes', 'example');",
          "const archived = path.join(process.cwd(), 'openspec', 'changes', 'archive', '2026-09-24-example');",
          'await fs.mkdir(path.dirname(archived), { recursive: true });',
          'await fs.rename(active, archived);',
        ].join('\n'),
      );
      await fs.chmod(executable, 0o755);
      const previousCommand = process.env.COMET_OPENSPEC;
      process.env.COMET_OPENSPEC = executable;
      try {
        run = await classicDomain.executeClassicSdkArchive(runtime, {
          runId: run.runId,
          projectRoot,
        });
      } finally {
        if (previousCommand === undefined) delete process.env.COMET_OPENSPEC;
        else process.env.COMET_OPENSPEC = previousCommand;
      }
      expect(run.state).toMatchObject({ archived: true });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.archive.deliver`,
        status: 'pending',
      });
      // 归档提交只暂存 OpenSpec 产物；独立 Runtime 收据不属于交付变更。
      execFileSync('git', ['add', '-A', '--', 'docs/openspec'], { cwd: projectRoot });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.invalid',
          'commit',
          '-m',
          `archive ${profile}`,
        ],
        { cwd: projectRoot },
      );
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
      }).trim();
      expect(
        execFileSync('git', ['ls-files', '--', '.comet/runtime'], {
          cwd: projectRoot,
          encoding: 'utf8',
        }).trim(),
      ).toBe('');
      run = await completeLatestAction(
        runtime,
        run,
        { action: 'local', targetBranch: 'sdk-preset', commit },
        `${profile}-archive-delivered`,
        { projectRoot },
      );
      expect(run.status).toBe('completed');
      expect(run.state).toMatchObject({ archived: true, branchStatus: 'handled' });
    },
  );

  it('advances full Open to Design only after evidence, approval, and revalidation', async () => {
    const defineApplication = (classicDomain as Record<string, unknown>)[
      'defineClassicWorkflowApplication'
    ] as ((profile: ClassicState['workflow']) => ClassicApplication) | undefined;
    expect(defineApplication).toBeTypeOf('function');

    const application = defineApplication!('full');
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({
      store,
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: testEvidenceValidators(application),
      validators: testOutcomeValidators(application),
    });
    let run = await runtime.start({
      runId: 'classic-full-application',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: 'example', changeDir: 'docs/openspec/changes/example' },
      initialState: initialClassicState('full'),
    });
    expect(run.actions.map((action) => [action.stepId, action.ref, action.status])).toEqual([
      ['full.open', 'comet-open', 'pending'],
    ]);
    const open = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: open.id,
      attempt: open.attempt,
      inputHash: open.inputHash,
      executorId: 'classic-host',
      claimToken: 'open-claim',
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: open.id,
        attempt: open.attempt,
        inputHash: open.inputHash,
        claimToken: 'open-claim',
        outcomeId: 'open-complete-1',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });

    expect((run.state as { phase: string }).phase).toBe('open');
    const waitingRevision = run.revision;
    run = await acceptOpenEvidence(runtime, run);

    expect(run.revision).toBe(waitingRevision + 4);
    expect((run.state as { phase: string }).phase).toBe('design');
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'full.design.handoff',
      ref: 'comet-design',
      status: 'pending',
    });
    expect(await store.read(run.runId)).toEqual(run);
  });
});

describe('Classic SDK check commit freshness', () => {
  it.each(['same-size-edit', 'added-input', 'deleted-input'] as const)(
    'rejects %s between command completion and evidence submission',
    async (mutation) => {
      const { runtime, run, projectRoot } = await checkedFullBuildRun(`commit-${mutation}`, true);
      const source = path.join(projectRoot, 'source.js');
      if (mutation === 'same-size-edit') {
        const stat = await fs.stat(source);
        await fs.writeFile(source, 'const ready = null;\n');
        await fs.utimes(source, stat.atime, stat.mtime);
      } else if (mutation === 'added-input') {
        await fs.writeFile(path.join(projectRoot, 'added.js'), 'new input');
      } else {
        await fs.unlink(source);
      }
      await expect(acceptBuildCheckEvidence(runtime, run, projectRoot)).rejects.toThrow(
        /EVIDENCE_REJECTED/,
      );
      expect((await runtime.inspect(run.runId)).state).toMatchObject({ phase: 'build' });
    },
  );
});
