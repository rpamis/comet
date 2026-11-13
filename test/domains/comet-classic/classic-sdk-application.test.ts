import * as childProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { annotatedMarkdown } from '../../../domains/comet-classic/classic-archive-annotation.js';
import { classicArchiveCommand } from '../../../domains/comet-classic/classic-archive.js';
import { recordClassicArchiveRequirements } from '../../../domains/comet-classic/classic-artifact-requirements.js';
import { classicCheckCommand } from '../../../domains/comet-classic/classic-check-command.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { classicGuardCommand } from '../../../domains/comet-classic/classic-guard.js';
import { resolveClassicDesignContext } from '../../../domains/comet-classic/classic-handoff.js';
import { resolveClassicChangeRuntimeOwner } from '../../../domains/comet-classic/classic-runtime-ownership.js';
import { resolveClassicLocalTarget } from '../../../domains/comet-classic/classic-runtime-paths.js';
import { classicOpenEvidenceReceipt } from '../../../domains/comet-classic/classic-sdk-application.js';
import {
  captureClassicArchiveInputs,
  recordClassicArchiveManifest,
} from '../../../domains/comet-classic/classic-sdk-archive-manifest.js';
import {
  assertClassicSdkDeliveryInputs,
  collectClassicSdkDeliveryInputs,
} from '../../../domains/comet-classic/classic-sdk-delivery-inputs.js';
import { classicSdkRevisionApplication } from '../../../domains/comet-classic/classic-sdk-revision-application.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { classicStateCommand } from '../../../domains/comet-classic/classic-state-command.js';
import {
  parseClassicStateDocument,
  type ClassicState,
} from '../../../domains/comet-classic/classic-state.js';
import * as classicDomain from '../../../domains/comet-classic/index.js';
import {
  createFileRuntimeStore,
  createMemoryRuntimeStore,
  createRuntime,
  defineWorkflow,
  hashRuntimeValue,
  type DefineWorkflowOptions,
  type RuntimeEvidenceValidator,
  type RuntimeValidator,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowRuntime,
  type WorkflowTransitionHandler,
} from '../../../domains/engine/runtime.js';
import { registerSdkChangeOwner } from '../../../domains/workflow-contract/change-runtime-owner.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, execFileSync: vi.fn(original.execFileSync) };
});
const actualChildProcess =
  await vi.importActual<typeof import('node:child_process')>('node:child_process');

/** Real evidence is bound to its completed Action, not to document bytes. */
function completedActionHash(run: WorkflowRun, suffix: string): string {
  const action = run.actions.findLast(
    (action) => action.stepId.endsWith(suffix) && action.status === 'succeeded',
  );
  expect(action).toBeDefined();
  return action!.inputHash;
}

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
it('captures implementation for the first commit without including installation metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-unborn-delivery-'));
  temporaryRoots.push(root);
  await fs.mkdir(path.join(root, '.comet'));
  await fs.writeFile(
    path.join(root, '.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n',
  );
  const source = 'export const ready = true;\n';
  const metadata = 'SIMULATED package manager installation metadata\n';
  await fs.writeFile(path.join(root, 'source.js'), source);
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules/.modules.yaml'), metadata);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  expect(await collectClassicSdkDeliveryInputs(root)).toEqual(['source.js']);
  await expect(
    collectClassicSdkDeliveryInputs(root, undefined, ['source.js', 'node_modules/.modules.yaml']),
  ).rejects.toThrow('workflow metadata or another change');
  expect(await fs.readFile(path.join(root, 'source.js'), 'utf8')).toBe(source);
  expect(await fs.readFile(path.join(root, 'node_modules/.modules.yaml'), 'utf8')).toBe(metadata);
});

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
  if (
    output &&
    typeof output === 'object' &&
    !Array.isArray(output) &&
    ['build-complete', 'verification-ready'].includes(String(output.event)) &&
    !Object.hasOwn(output, 'checks')
  ) {
    actualChildProcess.execFileSync(process.execPath, ['-e', 'process.exit(0)'], {
      cwd: options.projectRoot,
      stdio: 'ignore',
      windowsHide: true,
    });
    output = {
      ...output,
      checks: [
        {
          name: 'Actual harmless Node fixture command',
          result: 'passed',
          note: 'Actual exit 0; simulated Agent protocol fixture, no model acceptance.',
        },
      ],
    };
  }
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
    ? await resolveClassicDesignContext({
        projectRoot,
        run,
        changeDir: path.join(projectRoot, 'docs/openspec/changes/example'),
        change: 'example',
        contextCompression: null,
      })
    : {};
  const designHash = 'b'.repeat(64);
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
    contentHash: projectRoot ? run.actions.at(-1)!.inputHash : designHash,
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

async function reachFullBuildExecution(
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
    contentHash: projectRoot ? run.actions.at(-1)!.inputHash : planHash,
    submissionId: `${runId}-plan-evidence`,
    expectedRevision: run.revision,
  });
  return run;
}

async function fullBuildFixture(
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
  const runtime = createRuntime({
    store: options.projectedStore
      ? createClassicSdkStateStore(projectRoot)
      : options.fileStore
        ? createFileRuntimeStore<WorkflowRun>({
            rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'classic'),
          })
        : createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    evidenceValidators: testEvidenceValidators(application),
    validators: testOutcomeValidators(application),
  });
  await classicDomain.classicPlanEvidenceReceipt(
    projectRoot,
    'docs/superpowers/plans/2026-09-24-example.md',
    'docs/openspec/changes/example',
  );
  const ready = await reachFullBuildExecution(
    runtime,
    application,
    runId,
    options.boundBranch,
    undefined,
    projectRoot,
  );
  const run = ready;
  return { runtime, run, projectRoot };
}

async function submitBuildReport(
  runtime: WorkflowRuntime,
  run: WorkflowRun,
  projectRoot: string,
): Promise<WorkflowRun> {
  return completeLatestAction(
    runtime,
    run,
    { event: 'build-complete' },
    run.runId + '-build-report',
    { projectRoot },
  );
}

async function fullVerifyFixture(
  runId: string,
  options: {
    gitBranch?: string;
    boundBranch?: string;
    fileStore?: boolean;
    projectedStore?: boolean;
  } = {},
) {
  const { runtime, run, projectRoot } = await fullBuildFixture(runId, true, options);
  return { runtime, run: await submitBuildReport(runtime, run, projectRoot), projectRoot };
}

async function reachFullArchivePrepareAction(
  runId: string,
  options: {
    fileStore?: boolean;
    projectedStore?: boolean;
    withoutGit?: boolean;
    implementationChange?: 'delete' | 'rename';
  } = {},
): Promise<{ runtime: WorkflowRuntime; run: WorkflowRun; projectRoot: string }> {
  const { runtime, run, projectRoot } = await fullVerifyFixture(runId, {
    gitBranch: options.withoutGit ? undefined : 'sdk-build',
    boundBranch: options.withoutGit ? undefined : 'sdk-build',
    fileStore: options.fileStore,
    projectedStore: options.projectedStore,
  });
  if (options.implementationChange) {
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
        'test: initial source',
      ],
      { cwd: projectRoot },
    );
    if (options.implementationChange === 'delete')
      execFileSync('git', ['rm', '--', 'source.js'], { cwd: projectRoot });
    else execFileSync('git', ['mv', '--', 'source.js', 'renamed.js'], { cwd: projectRoot });
  }
  const reportRef = 'docs/superpowers/reports/2026-09-24-example-verify.md';
  await fs.mkdir(path.dirname(path.join(projectRoot, reportRef)), { recursive: true });
  await fs.writeFile(path.join(projectRoot, reportRef), '# Verification\nPASS\n');
  const reported = await completeLatestAction(
    runtime,
    run,
    { event: 'verification-ready', verificationReport: reportRef },
    runId + '-verify-report',
    { projectRoot },
  );
  const archived = await runtime.recordEvidence({
    runId: reported.runId,
    evidenceId: reported.evidenceWaits!.at(-1)!.id,
    kind: 'classic-verification-report',
    ref: reportRef,
    contentHash: completedActionHash(reported, '.verify.run'),
    submissionId: runId + '-report-evidence',
    expectedRevision: reported.revision,
    context: { requestId: runId + '-report-evidence', projectRoot },
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
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'classic'),
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
    implementationChange?: 'delete' | 'rename';
  } = {},
): Promise<{ runtime: WorkflowRuntime; run: WorkflowRun; projectRoot: string }> {
  const { runtime, run, projectRoot } = await reachFullArchivePrepareAction(runId, {
    projectedStore: options.projectedStore,
    implementationChange: options.implementationChange,
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

/** 归档样例经过真实的输入与输出收据边界，不再只凭目录自报成功。 */
async function archiveWithReceipt(
  runtime: WorkflowRuntime,
  run: WorkflowRun,
  projectRoot: string,
  recordOutcome = true,
) {
  const action = run.actions.at(-1)!;
  const claimToken = `${run.runId}-archive-fixture`;
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-archive',
    claimToken,
    context: { requestId: claimToken, projectRoot },
  });
  const claimed = await runtime.inspect(run.runId);
  const claimedAction = claimed.actions.at(-1)!;
  const activeRef = (run.input as { changeDir: string }).changeDir;
  const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
  await recordClassicArchiveRequirements(projectRoot, path.join(projectRoot, activeRef));
  const before = await captureClassicArchiveInputs(projectRoot, claimed, 'docs/openspec/specs');
  await fs.mkdir(path.dirname(path.join(projectRoot, archivedRef)), { recursive: true });
  await fs.rename(path.join(projectRoot, activeRef), path.join(projectRoot, archivedRef));
  const state = run.state as unknown as ClassicState;
  for (const [ref, extra] of [
    [state.designDoc, 'status: final'],
    [state.plan, ''],
  ] as const) {
    if (!ref) continue;
    const file = path.join(projectRoot, ref.replace(activeRef + '/', archivedRef + '/'));
    await fs.writeFile(
      file,
      annotatedMarkdown(await fs.readFile(file, 'utf8'), '2026-09-24-example', extra),
    );
  }
  const artifacts = await recordClassicArchiveManifest(
    projectRoot,
    claimed,
    claimedAction,
    archivedRef,
    before,
  );
  if (!recordOutcome) return claimed;
  return runtime.recordOutcome({
    runId: run.runId,
    context: { requestId: claimToken, projectRoot },
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken,
      outcomeId: claimToken,
      status: 'succeeded',
      output: { archiveDirectory: archivedRef },
      artifacts,
    },
  });
}

async function commitValidLocalArchive(
  runtime: WorkflowRuntime,
  run: WorkflowRun,
  projectRoot: string,
  implementationFiles: string[] = ['source.js'],
  includeReport = true,
): Promise<{ pending: WorkflowRun; commit: string }> {
  const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
  const pending = run.actions.at(-1)!.stepId.endsWith('.archive.deliver')
    ? run
    : await archiveWithReceipt(runtime, run, projectRoot);
  const designDocRef = 'docs/superpowers/specs/design.md';
  const planRef = 'docs/superpowers/plans/2026-09-24-example.md';
  const reportRef = (pending.state as ClassicState).verificationReport!;
  execFileSync(
    'git',
    [
      'add',
      '--',
      archivedRef,
      designDocRef,
      planRef,
      ...(includeReport ? [reportRef] : []),
      ...implementationFiles,
    ],
    {
      cwd: projectRoot,
    },
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

async function classicFixtureOwner(run: WorkflowRun, projectRoot: string) {
  await registerSdkChangeOwner(projectRoot, {
    schema: 'comet.change-owner.v1',
    workflow: 'classic',
    change: 'example',
    format: 'sdk',
    application: 'classic-full',
    runId: run.runId,
  });
  return { json: true, invocationCwd: projectRoot, projectRoot };
}
async function platformCheckFile(projectRoot: string, exitCode: number) {
  const result = actualChildProcess.spawnSync(
    process.execPath,
    ['-e', 'process.exit(' + exitCode + ')'],
    { cwd: projectRoot, windowsHide: true },
  );
  expect(result.status).toBe(exitCode);
  const file = path.join(
    resolveWorkspaceRuntimeRootSync(projectRoot),
    'fixture-reports',
    'checks.json',
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      checks: [
        {
          name: 'Actual platform fixture command',
          result: result.status === 0 ? 'passed' : 'failed',
          note: 'Actual exit ' + result.status,
        },
      ],
    }),
  );
  return file;
}
async function submitVerifyReport(runtime: WorkflowRuntime, run: WorkflowRun, projectRoot: string) {
  const reportRef = 'docs/superpowers/reports/2026-09-24-example-verify.md';
  await fs.mkdir(path.dirname(path.join(projectRoot, reportRef)), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, reportRef),
    '# Verification\nActual harmless Node check passed.\n',
  );
  const reported = await completeLatestAction(
    runtime,
    run,
    { event: 'verification-ready', verificationReport: reportRef },
    run.runId + '-verification',
    { projectRoot },
  );
  return runtime.recordEvidence({
    runId: reported.runId,
    evidenceId: reported.evidenceWaits!.at(-1)!.id,
    kind: 'classic-verification-report',
    ref: reportRef,
    contentHash: completedActionHash(reported, '.verify.run'),
    submissionId: run.runId + '-verify-evidence',
    expectedRevision: reported.revision,
    context: { projectRoot },
  });
}
describe('Classic workflow application through the public Runtime SDK', () => {
  it('keeps original business task inputs unchanged when adopting a raw SDK Run', async () => {
    const { run, projectRoot } = await fullBuildFixture('example', true, {
      gitBranch: 'sdk-build',
      fileStore: true,
    });
    const change = path.join(projectRoot, 'docs/openspec/changes/example');
    await expect(fs.access(path.join(change, '.comet.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const handoffFile = path.join(
      projectRoot,
      (run.state as unknown as ClassicState).handoffContext!,
    );
    const handoff = await fs.readFile(handoffFile, 'utf8');
    await expect(
      resolveClassicDesignContext({
        projectRoot,
        changeDir: change,
        change: 'example',
        contextCompression: null,
        run: { ...run, input: { change: 'other', changeDir: 'docs/openspec/changes/other' } },
      }),
    ).rejects.toThrow('Classic Design context belongs to a different Run');
    expect(await fs.readFile(handoffFile, 'utf8')).toBe(handoff);
    const original = run.actions.at(-1)!;
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'example',
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    const adopted = (await inspectClassicSdkRun(projectRoot, 'example')).run;
    const action = adopted.actions.find((action) => action.id === original.id)!;
    expect(action.input).toEqual(original.input);
    expect(action.inputHash).toBe(original.inputHash);
    expect(action).toEqual(original);
    await fs.appendFile(
      path.join(projectRoot, 'source.js'),
      '\n// Agent accepted an explanatory edit\n',
    );
    const after = (await inspectClassicSdkRun(projectRoot, 'example')).run;
    expect(after.runId).toBe(adopted.runId);
    expect(after.state).toMatchObject({ phase: 'build' });
    expect(after.actions.find((entry) => entry.id === action.id)).toEqual(action);
  });

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
    const completed = await archiveWithReceipt(runtime, run, projectRoot);
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
    const pending = await archiveWithReceipt(runtime, run, projectRoot);
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
    await fs.writeFile(
      path.join(projectRoot, 'unrelated.txt'),
      'Not part of the verified change.\n',
    );
    const { pending, commit } = await commitValidLocalArchive(runtime, run, projectRoot, [
      'source.js',
      'unrelated.txt',
    ]);
    await expect(
      completeLatestAction(
        runtime,
        pending,
        { action: 'local', targetBranch: 'sdk-build', commit },
        'archive-delivery-unrelated-outcome',
        { projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    const rejected = await runtime.inspect(run.runId);
    expect(rejected.status).toBe('running');
    expect(rejected.actions.at(-1)?.rejectedOutcomes?.at(-1)?.reason).toContain('unrelated.txt');
  });

  it('accepts full delivery with separate approved implementation and annotated archive commits', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-delivery-linear-commits',
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
        'fix: verified implementation',
      ],
      { cwd: projectRoot },
    );
    const { pending, commit } = await commitValidLocalArchive(runtime, run, projectRoot, []);
    const delivered = await completeLatestAction(
      runtime,
      pending,
      { action: 'local', targetBranch: 'sdk-build', commit },
      'archive-delivery-linear-outcome',
      { projectRoot },
    );
    expect(delivered.status).toBe('completed');
  });

  it('rejects a local archive commit that omitted Design Doc and Plan annotations', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-delivery-missing-annotations',
    );
    const pending = await archiveWithReceipt(runtime, run, projectRoot);
    const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
    for (const ref of [
      'docs/superpowers/specs/design.md',
      'docs/superpowers/plans/2026-09-24-example.md',
    ])
      await fs.writeFile(path.join(projectRoot, ref), '# Missing annotation\n');
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

  it.each([
    {
      name: 'includes verified implementation',
      files: ['source.js'],
      accepted: true,
      changed: false,
    },
    { name: 'omits verified implementation', files: [], accepted: false, changed: false },
  ])('checks archive delivery that $name', async ({ files, accepted, changed }) => {
    const { runtime, run, projectRoot } =
      await reachFullArchiveExecuteAction('archive-implementation');
    if (changed) await fs.writeFile(path.join(projectRoot, 'source.js'), 'const ready = false;\n');
    const { pending, commit } = await commitValidLocalArchive(runtime, run, projectRoot, files);
    const delivery = completeLatestAction(
      runtime,
      pending,
      { action: 'local', targetBranch: 'sdk-build', commit },
      'archive-implementation-outcome',
      { projectRoot },
    );
    if (accepted) expect((await delivery).status).toBe('completed');
    else await expect(delivery).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
  });

  it.each(['delete', 'rename'] as const)(
    'delivers verified implementation %s operations',
    async (implementationChange) => {
      const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
        'archive-source-operation',
        { implementationChange },
      );
      const files = implementationChange === 'rename' ? ['renamed.js'] : [];
      const { pending, commit } = await commitValidLocalArchive(runtime, run, projectRoot, files);
      const delivered = await completeLatestAction(
        runtime,
        pending,
        { action: 'local', targetBranch: 'sdk-build', commit },
        'source-operation-delivered',
        { projectRoot },
      );
      expect(delivered.status).toBe('completed');
      expect(
        execFileSync('git', ['ls-tree', '--name-only', 'HEAD', '--', 'source.js'], {
          cwd: projectRoot,
          encoding: 'utf8',
        }).trim(),
      ).toBe('');
    },
  );

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

  it('rejects delivery that omits its accepted report from the archive commit', async () => {
    const { runtime, run, projectRoot } =
      await reachFullArchiveExecuteAction('archive-report-omitted');
    const reportRef = (run.state as ClassicState).verificationReport!;
    const { pending, commit } = await commitValidLocalArchive(
      runtime,
      run,
      projectRoot,
      ['source.js'],
      false,
    );
    await expect(
      completeLatestAction(
        runtime,
        pending,
        { action: 'local', targetBranch: 'sdk-build', commit },
        'omitted-report-outcome',
        { projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    expect(
      (await runtime.inspect(run.runId)).actions.at(-1)?.rejectedOutcomes?.at(-1)?.reason,
    ).toContain(reportRef);
  });

  it('rejects an unbound report next to the accepted report and identifies its exact path', async () => {
    const { runtime, run, projectRoot } =
      await reachFullArchiveExecuteAction('archive-report-unbound');
    const extraRef = 'docs/superpowers/reports/unbound.md';
    await fs.writeFile(path.join(projectRoot, extraRef), '# Unbound report\n');
    const { pending, commit } = await commitValidLocalArchive(runtime, run, projectRoot, [
      'source.js',
      extraRef,
    ]);
    await expect(
      completeLatestAction(
        runtime,
        pending,
        { action: 'local', targetBranch: 'sdk-build', commit },
        'unbound-report-outcome',
        { projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    expect(
      (await runtime.inspect(run.runId)).actions.at(-1)?.rejectedOutcomes?.at(-1)?.reason,
    ).toContain(extraRef);
  });

  it('recovers an interrupted Archive outcome from the original executor receipt without replay', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction('example', {
      projectedStore: true,
    });
    await registerSdkChangeOwner(projectRoot, {
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'example',
      format: 'sdk',
      application: 'classic-full',
      runId: run.runId,
    });
    const claimed = await archiveWithReceipt(runtime, run, projectRoot, false);
    const action = claimed.actions.at(-1)!;
    await runtime.markUnknown({
      runId: claimed.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Executor stopped after recording the original Archive receipt.',
    });
    const unknown = await runtime.inspect(run.runId);
    const previous = process.env.COMET_OPENSPEC;
    process.env.COMET_OPENSPEC = path.join(projectRoot, 'must-not-execute-openspec');
    try {
      const recovered = await withClassicCommandContext(
        { projectRoot, invocationCwd: projectRoot },
        () => classicArchiveCommand(['example', '--recover']),
      );
      expect(recovered.exitCode, recovered.stderr).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.COMET_OPENSPEC;
      else process.env.COMET_OPENSPEC = previous;
    }
    const completed = await runtime.inspect(run.runId);
    expect(
      completed.actions.filter((entry) => entry.stepId === 'full.archive.execute'),
    ).toHaveLength(1);
    expect(
      completed.actions.find((entry) => entry.id === action.id)?.outcome?.output,
    ).toMatchObject({ archiveDirectory: expect.stringContaining('/archive/') });
    expect(completed.waits).toEqual(unknown.waits);
    expect(completed.evidenceWaits).toEqual(unknown.evidenceWaits);
    expect(completed.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.deliver',
      status: 'pending',
    });
  });

  it('keeps a copied unknown Archive blocked when no original execution receipt survives', async () => {
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
    await expect(
      withClassicCommandContext({ projectRoot: restoredRoot, invocationCwd: restoredRoot }, () =>
        classicArchiveCommand(['example', '--recover']),
      ),
    ).rejects.toThrow('原 Archive 准备记录缺失');
    const continued = await inspectClassicSdkRun(restoredRoot, 'example');
    expect(continued.run).toEqual(restored.run);
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

  it('rejects a directory-only Archive outcome without the original executor receipt', async () => {
    const { runtime, run, projectRoot } = await reachFullArchiveExecuteAction(
      'archive-missing-original-receipt',
    );
    const activeRef = (run.input as { changeDir: string }).changeDir;
    const archivedRef = 'docs/openspec/changes/archive/2026-09-24-example';
    await fs.mkdir(path.dirname(path.join(projectRoot, archivedRef)), { recursive: true });
    await fs.rename(path.join(projectRoot, activeRef), path.join(projectRoot, archivedRef));
    await expect(
      completeLatestAction(
        runtime,
        run,
        { archiveDirectory: archivedRef },
        'unproven-archive-outcome',
        { executorId: 'comet-classic-archive', projectRoot },
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    const rejected = await runtime.inspect(run.runId);
    expect(rejected.state).toMatchObject({ archived: false });
    expect(rejected.actions.at(-1)?.rejectedOutcomes?.at(-1)?.reason).toContain(
      '原 Archive 执行收据缺失',
    );
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

  it('enters Verify only after a current check and completed mapped tasks', async () => {
    const { runtime, run, projectRoot } = await fullBuildFixture('complete-build-tasks', true);
    const accepted = await submitBuildReport(runtime, run, projectRoot);
    expect(accepted.state).toMatchObject({ phase: 'verify' });
    expect(accepted.evidenceWaits?.at(-1)).toMatchObject({
      stepId: 'full.build.plan.evidence',
      status: 'resolved',
    });
    expect(accepted.actions.at(-1)).toMatchObject({
      stepId: 'full.verify.run',
      status: 'pending',
    });
  });

  it('accepts a Build configuration bound to the current Git branch', async () => {
    const { runtime, run, projectRoot } = await fullBuildFixture('bound-build-branch', true, {
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
    });
    const accepted = await submitBuildReport(runtime, run, projectRoot);
    expect(accepted.state).toMatchObject({ phase: 'verify', boundBranch: 'sdk-build' });
  });

  it('waits for the selected Verify report before running verification checks', async () => {
    const { runtime, run, projectRoot } = await fullBuildFixture('verify-report-wait', true);
    const verifying = await submitBuildReport(runtime, run, projectRoot);
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
    const { runtime, run, projectRoot } = await fullBuildFixture('verify-needs-build', true);
    const verifying = await submitBuildReport(runtime, run, projectRoot);
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
    const { runtime, run, projectRoot } = await fullBuildFixture(change, true, {
      gitBranch: 'sdk-verify',
      boundBranch: 'sdk-verify',
      fileStore: true,
    });
    await submitBuildReport(runtime, run, projectRoot);
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

  it('enters Archive only after the Agent Verify report is accepted', async () => {
    const { runtime, run, projectRoot } = await fullVerifyFixture('verify-report-accepted');
    expect(run.state).toMatchObject({ phase: 'verify', verifyResult: 'pending' });
    const accepted = await submitVerifyReport(runtime, run, projectRoot);
    expect(accepted.state).toMatchObject({
      phase: 'archive',
      verifyResult: 'pass',
      archiveConfirmation: 'pending',
    });
    expect(accepted.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.prepare',
      status: 'pending',
    });
    expect(accepted.actions.some((action) => action.stepId.endsWith('.verify.check'))).toBe(false);
  });

  it('records an actual failed Verify assessment before returning to Build', async () => {
    const { runtime, run, projectRoot } = await fullVerifyFixture('verify-command-failed');
    const check = actualChildProcess.spawnSync(process.execPath, ['-e', 'process.exit(7)'], {
      cwd: projectRoot,
      windowsHide: true,
    });
    expect(check.status).toBe(7);
    const failed = await completeLatestAction(
      runtime,
      run,
      { event: 'verify-fail', reason: 'Actual platform command exited 7.' },
      'verify-failed',
      { projectRoot },
    );
    expect(failed.state).toMatchObject({ phase: 'build', verifyResult: 'fail', verifyFailures: 1 });
    expect(failed.actions.at(-1)).toMatchObject({ stepId: 'full.build.plan', status: 'pending' });
    expect(failed.actions.at(-2)).toMatchObject({
      stepId: 'full.verify.run',
      outcome: { output: { event: 'verify-fail', reason: 'Actual platform command exited 7.' } },
    });
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
      contentHash: completedActionHash(run, '.open'),
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
    const handoff = await resolveClassicDesignContext({
      projectRoot: root,
      run,
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
      contentHash: completedActionHash(run, '.design.document'),
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
        contentHash: '0'.repeat(64),
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
      contentHash: completedActionHash(run, '.build.plan'),
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
    const { run, projectRoot } = await fullVerifyFixture('example', {
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

  it('keeps Build authoritative until the Agent submits actual checks after reviewing an edit', async () => {
    const { runtime, run, projectRoot } = await fullBuildFixture('classic-build-report', true);
    const approved = structuredClone(run.waits.filter((wait) => wait.status === 'resolved'));
    expect(run.state).toMatchObject({ phase: 'build' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'full.build.execute', status: 'pending' });
    await fs.writeFile(path.join(projectRoot, 'source.js'), 'const ready = false;\n');
    const accepted = await submitBuildReport(runtime, run, projectRoot);
    expect(accepted.state).toMatchObject({ phase: 'verify' });
    expect(accepted.waits.filter((wait) => wait.status === 'resolved')).toEqual(approved);
    expect(accepted.actions.find((action) => action.id === run.actions.at(-1)!.id)).toMatchObject({
      status: 'succeeded',
      outcome: { output: { event: 'build-complete', checks: [{ result: 'passed' }] } },
    });
  });

  it('rejects a failed Agent Build report before claiming or advancing the original task', async () => {
    const { runtime, run, projectRoot } = await fullBuildFixture('example', true, {
      fileStore: true,
    });
    const options = await classicFixtureOwner(run, projectRoot);
    const report = await platformCheckFile(projectRoot, 7);
    const rejected = await classicStateCommand(
      ['complete-build', 'example', '--checks', report],
      options,
    );
    expect(rejected.exitCode).not.toBe(0);
    expect(await runtime.inspect(run.runId)).toEqual(run);
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'full.build.execute', status: 'pending' });
  });

  it('routes Classic SDK Verify Guard through a platform check report without running commands', async () => {
    const { runtime, run, projectRoot } = await fullVerifyFixture('example', {
      fileStore: true,
      gitBranch: 'sdk-build',
      boundBranch: 'sdk-build',
    });
    const options = await classicFixtureOwner(run, projectRoot);
    const reportRef = 'docs/superpowers/reports/2026-09-24-example.md';
    await fs.mkdir(path.dirname(path.join(projectRoot, reportRef)), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, reportRef),
      '# Verification\nActual platform check passed.\n',
    );
    const checks = await platformCheckFile(projectRoot, 0);
    const preview = await classicGuardCommand(
      ['example', 'verify', '--report', reportRef, '--checks', checks],
      options,
    );
    expect(preview.exitCode, preview.stderr).toBe(0);
    expect(await runtime.inspect(run.runId)).toEqual(run);
    const applied = await classicGuardCommand(
      ['example', 'verify', '--report', reportRef, '--checks', checks, '--apply'],
      options,
    );
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(applied.data).toMatchObject({ change: 'example', phase: 'archive' });
    const current = await runtime.inspect(run.runId);
    expect(current.actions.filter((action) => action.stepId === 'full.verify.run')).toHaveLength(1);
    expect(current.actions.some((action) => action.stepId === 'full.verify.check')).toBe(false);
    expect(
      current.evidenceWaits?.some(
        (wait) => wait.stepId === 'full.verify.report.evidence' && wait.status === 'resolved',
      ),
    ).toBe(true);
    expect(
      await fs.readFile(
        path.join(projectRoot, 'docs/openspec/changes/example/comet-state.yaml'),
        'utf8',
      ),
    ).toContain('phase: archive');
  });

  it('rejects a failed platform Verify report then records the explicit return to Build', async () => {
    const { runtime, run, projectRoot } = await fullVerifyFixture('example', { fileStore: true });
    const options = await classicFixtureOwner(run, projectRoot);
    const reportRef = 'docs/superpowers/reports/2026-09-24-example-verify.md';
    await fs.mkdir(path.dirname(path.join(projectRoot, reportRef)), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, reportRef),
      '# Verification\nActual command failed.\n',
    );
    const checks = await platformCheckFile(projectRoot, 7);
    await expect(
      classicGuardCommand(
        ['example', 'verify', '--report', reportRef, '--checks', checks, '--apply'],
        options,
      ),
    ).rejects.toThrow(/failed|actual check reports/u);
    expect(await runtime.inspect(run.runId)).toEqual(run);
    const failed = await classicStateCommand(
      ['transition', 'example', 'verify-fail', '--reason', 'Actual platform command exited 7.'],
      options,
    );
    expect(failed.exitCode, failed.stderr).toBe(0);
    expect(failed.data).toMatchObject({
      phase: 'build',
      nextAction: { kind: 'action', stepId: 'full.build.plan' },
    });
    expect(
      (await runtime.inspect(run.runId)).actions.find(
        (action) => action.stepId === 'full.verify.run',
      )?.outcome?.output,
    ).toMatchObject({ event: 'verify-fail', reason: 'Actual platform command exited 7.' });
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
      const checks = await platformCheckFile(projectRoot, 0);
      const verified = await classicGuardCommand(
        [
          'example',
          'verify',
          '--report',
          'docs/superpowers/reports/2026-09-24-example-verify.md',
          '--apply',
          '--checks',
          checks,
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
      const persisted = createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'classic'),
      });
      const beforeDrift = await persisted.read(run.runId);
      const preview = await classicGuardCommand(['example', 'archive'], options);
      expect(preview.exitCode, preview.stderr).toBe(0);
      expect((await classicStateCommand(['next', 'example'], options)).data).toMatchObject({
        nextAction: { stepId: 'full.archive.preflight' },
      });
      expect(await persisted.read(run.runId)).toEqual(beforeDrift);

      const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-archive-guard-'));
      temporaryRoots.push(fakeRoot);
      const executable = path.join(fakeRoot, 'openspec-fake.mjs');
      const invocations = path.join(fakeRoot, 'archive-invocations.jsonl');
      await fs.writeFile(
        executable,
        [
          '#!/usr/bin/env node',
          "import { promises as fs } from 'node:fs';",
          "import path from 'node:path';",
          `await fs.appendFile(${JSON.stringify(invocations)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
          "const active = path.join(process.cwd(), 'openspec', 'changes', 'example');",
          "const archived = path.join(process.cwd(), 'openspec', 'changes', 'archive', '2026-09-26-example');",
          'await fs.mkdir(path.dirname(archived), { recursive: true });',
          'await fs.rename(active, archived);',
        ].join('\n'),
      );
      await fs.chmod(executable, 0o755);
      const archiveInvocation = JSON.stringify(['archive', 'example', '--yes']) + '\n';
      const previousCommand = process.env.COMET_OPENSPEC;
      process.env.COMET_OPENSPEC = executable;
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
        const archivedRun = await persisted.read(run.runId);
        expect(
          archivedRun!.actions.filter((action) => action.stepId.startsWith('full.verify.')),
        ).toEqual(
          beforeDrift!.actions.filter((action) => action.stepId.startsWith('full.verify.')),
        );
        const execution = archivedRun!.actions.filter(
          (action) => action.stepId === 'full.archive.execute',
        );
        expect(execution).toHaveLength(1);
        expect(execution[0]).toMatchObject({
          status: 'succeeded',
          claim: { executorId: 'comet-classic-archive' },
          outcome: { status: 'succeeded' },
        });
        expect(execution[0].outcome!.claimToken).toBe(execution[0].claim!.token);
        expect(await fs.readFile(invocations, 'utf8')).toBe(archiveInvocation);
        const repeated =
          command === 'guard'
            ? await classicGuardCommand(['example', 'archive', '--apply'], options)
            : await classicArchiveCommand(['example'], options);
        expect(repeated.exitCode).not.toBe(0);
        expect(repeated.stderr).toContain('already archived');
        expect(await persisted.read(run.runId)).toEqual(archivedRun);
        expect(await fs.readFile(invocations, 'utf8')).toBe(archiveInvocation);
      } finally {
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
      execFileSync(
        'git',
        [
          'add',
          '-A',
          '--',
          'docs/openspec/changes',
          'docs/superpowers/specs/design.md',
          'docs/superpowers/plans/2026-09-24-example.md',
          (run.state as ClassicState).verificationReport!,
          'source.js',
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
        'docs/openspec/changes/archive/2026-09-26-example/comet-state.yaml',
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
      const original = structuredClone(run);
      const command = actualChildProcess.spawnSync(process.execPath, ['-e', 'process.exit(7)'], {
        windowsHide: true,
      });
      expect(command.status).toBe(7);
      const action = run.actions.at(-1)!;
      const token = profile + '-failed-build';
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'actual-agent',
        claimToken: token,
      });
      await expect(
        runtime.recordOutcome({
          runId: run.runId,
          outcome: {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: token,
            outcomeId: token,
            status: 'succeeded',
            output: {
              event: 'build-complete',
              checks: [{ name: 'Actual command', result: 'failed', note: 'Actual exit 7.' }],
            },
          },
        }),
      ).rejects.toThrow(/failed|actual check reports|OUTPUT_INVALID/u);
      run = await runtime.inspect(run.runId);
      expect(run.state).toEqual(claimed.state);
      expect(run.actions.at(-1)).toMatchObject({
        claim: claimed.actions.at(-1)!.claim,
        input: action.input,
        inputHash: action.inputHash,
        rejectedOutcomes: [{ outcome: { output: { checks: [{ result: 'failed' }] } } }],
      });
      expect(run.actions.at(-1)!.outcome).toBeUndefined();
      expect(run.status).toBe('running');
      expect(run.state).toEqual(original.state);
      expect(run.actions.at(-1)).toMatchObject({
        id: action.id,
        stepId: profile + '.build.execute',
        status: 'running',
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
      const command = actualChildProcess.spawnSync(process.execPath, ['-e', 'process.exit(7)'], {
        windowsHide: true,
      });
      expect(command.status).toBe(7);
      run = await completeLatestAction(
        runtime,
        run,
        { event: 'verify-fail', reason: 'Actual platform command exited 7.' },
        profile + '-failed-verify-command',
      );
      expect(run.actions.at(-2)).toMatchObject({
        stepId: profile + '.verify.run',
        outcome: { output: { event: 'verify-fail', reason: 'Actual platform command exited 7.' } },
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
      // 后续校验读取真实文件，Open 也绑定同一份实际产物，不能沿用纯状态机测试的占位摘要。
      run = await runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits!.at(-1)!.id,
        kind: 'classic-open-artifacts',
        ...(await classicOpenEvidenceReceipt(projectRoot, 'docs/openspec/changes/example')),
        contentHash: completedActionHash(run, '.open'),
        submissionId: `${profile}-open-evidence`,
        expectedRevision: run.revision,
      });
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
        contentHash: completedActionHash(run, '.verify.run'),
        submissionId: `${profile}-verify-report-evidence`,
        expectedRevision: run.revision,
        context: { requestId: `${profile}-verify-report-evidence`, projectRoot },
      });
      expect(run.actions.some((action) => /\.(build|verify)\.check$/.test(action.stepId))).toBe(
        false,
      );
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

it('reopens the original full definition after approved Archive without reusing its authorization (legacy revision=false)', async () => {
  const { run: original, projectRoot } = await reachFullArchiveExecuteAction('example', {
    projectedStore: true,
  });
  const run = original;
  await registerSdkChangeOwner(projectRoot, {
    schema: 'comet.change-owner.v1',
    workflow: 'classic',
    change: 'example',
    format: 'sdk',
    application: 'classic-full',
    runId: run.runId,
  });
  const result = await classicStateCommand(
    ['reopen-verification', 'example', '--expected-revision', String(run.revision)],
    { json: true, invocationCwd: projectRoot, projectRoot },
  );
  expect(result.exitCode, result.stderr).toBe(0);
  const current = await inspectClassicSdkRun(projectRoot, 'example');
  expect(current.state).toMatchObject({
    phase: 'verify',
    archiveConfirmation: null,
    verifyResult: 'pending',
  });
  expect(current.run.actions.at(-1)?.stepId).toBe('full.verify.run');
  expect(current.run.waits).toEqual(run.waits);
});

it('rejects a current Classic definition with the verification capability removed', async () => {
  const { run, projectRoot } = await reachFullArchiveExecuteAction('example', {
    projectedStore: true,
  });
  const definition = defineWorkflow(classicSdkRevisionApplication('full', false).workflow);
  const changed = structuredClone(run);
  changed.workflow.hash = hashRuntimeValue(definition);
  changed.definitionHashes[JSON.stringify([definition.id, definition.version])] =
    changed.workflow.hash;
  changed.revision += 1;
  const store = createClassicSdkStateStore(projectRoot);
  expect(await store.compareAndSwap(run.runId, run.revision, changed)).toBe(true);
  await registerSdkChangeOwner(projectRoot, {
    schema: 'comet.change-owner.v1',
    workflow: 'classic',
    change: 'example',
    format: 'sdk',
    application: 'classic-full',
    runId: run.runId,
  });
  const result = await classicStateCommand(
    ['reopen-verification', 'example', '--expected-revision', String(changed.revision)],
    { json: true, invocationCwd: projectRoot, projectRoot },
  );
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toMatch(/definition|定义|hash/u);
  expect(await store.read(run.runId)).toEqual(changed);
});

it('does not reopen a Classic Run owned by a fixed custom application', async () => {
  const { run, projectRoot } = await reachFullArchiveExecuteAction('example', {
    projectedStore: true,
  });
  await registerSdkChangeOwner(projectRoot, {
    schema: 'comet.change-owner.v1',
    workflow: 'classic',
    change: 'example',
    format: 'sdk',
    application: 'custom-classic',
    runId: run.runId,
  });
  const result = await classicStateCommand(
    ['reopen-verification', 'example', '--expected-revision', String(run.revision)],
    { json: true, invocationCwd: projectRoot, projectRoot },
  );
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain('custom-classic');
  const saved = await createClassicSdkStateStore(projectRoot).read(run.runId);
  expect(saved?.revision).toBe(run.revision);
});
