import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import {
  readPortableRunCheckpoint,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../engine/runtime.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import {
  classicArchivedRequirementsProblems,
  recordClassicArchiveRequirements,
} from './classic-artifact-requirements.js';
import { annotatedMarkdown } from './classic-archive-annotation.js';
import { assertClassicSdkArchiveReady } from './classic-sdk-archive-preflight.js';
import { classicSdkRemoteIdentity } from './classic-sdk-remote.js';
import { resolveClassicLayout } from './classic-layout.js';
import { executeClassicOpenSpec } from './classic-openspec-command.js';
import { readClassicProjectFile, writeClassicProjectText } from './classic-protected-path.js';
import { hasClassicManagedRunMarker, type ClassicState } from './classic-state.js';

interface ClassicSdkArchiveInput {
  runId: string;
  projectRoot: string;
}

function archiveNameMatches(name: string, change: string): boolean {
  return /^\d{4}-\d{2}-\d{2}-/u.test(name) && name.slice(11) === change;
}

async function archiveEntries(directory: string, change: string): Promise<Set<string>> {
  try {
    return new Set(
      (await fs.readdir(directory)).filter((name) => archiveNameMatches(name, change)),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
}

async function annotateIfPresent(
  projectRoot: string,
  pointer: string | null,
  archiveName: string,
  extraFields: string,
): Promise<void> {
  if (!pointer) return;
  const file = await inspectProtectedProjectPath(projectRoot, pointer, {
    label: 'Classic Archive document',
    expected: 'file',
  });
  if (!file.exists) return;
  const original = await readClassicProjectFile(projectRoot, file.target, {
    label: 'Classic Archive document',
  });
  await writeClassicProjectText(
    projectRoot,
    file.target,
    annotatedMarkdown(original, archiveName, extraFields),
    { label: 'Classic Archive document' },
  );
}

/** Execute only the filesystem Archive action. Commit/push/PR remain a later SDK delivery Action. */
export async function executeClassicSdkArchive(
  runtime: Pick<WorkflowRuntime, 'inspect' | 'claim' | 'recordOutcome' | 'markUnknown'>,
  input: ClassicSdkArchiveInput,
): Promise<WorkflowRun> {
  const projectRoot = path.resolve(input.projectRoot);
  const run = await runtime.inspect(input.runId);
  const profile = (run.state as ClassicState | undefined)?.workflow;
  const action = run.actions
    .slice()
    .reverse()
    .find(
      (candidate) =>
        candidate.stepId === `${profile}.archive.execute` && candidate.status === 'pending',
    );
  const preflight = run.actions
    .slice()
    .reverse()
    .find((candidate) => candidate.stepId === `${profile}.archive.preflight`);
  if (!action || preflight?.status !== 'succeeded') {
    throw new Error('Classic SDK Run has no preflighted Archive Action');
  }
  const approved = await assertClassicSdkArchiveReady(run, projectRoot);
  const approvedPreflight = preflight.outcome?.output as
    | {
        deliveryAction?: unknown;
        targetBranch?: unknown;
        verifiedBranch?: unknown;
        baseCommit?: unknown;
        remote?: unknown;
        remoteIdentity?: unknown;
        prBaseBranch?: unknown;
      }
    | undefined;
  if (
    approvedPreflight?.deliveryAction !== approved.action ||
    approvedPreflight.targetBranch !== approved.targetBranch ||
    approvedPreflight.verifiedBranch !== approved.targetBranch ||
    (approved.action === 'pr' && approvedPreflight.prBaseBranch !== approved.prBaseBranch) ||
    typeof approvedPreflight.baseCommit !== 'string' ||
    (approved.remote !== undefined &&
      (approvedPreflight.remote !== approved.remote ||
        approvedPreflight.remoteIdentity !==
          classicSdkRemoteIdentity(projectRoot, approved.remote))) ||
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim() !==
      approvedPreflight.baseCommit
  ) {
    throw new Error('Classic Archive preflight no longer matches the approved delivery');
  }
  const runInput = run.input as { change?: unknown; changeDir?: unknown } | null;
  if (typeof runInput?.change !== 'string' || typeof runInput.changeDir !== 'string') {
    throw new Error('Classic Archive change identity is missing');
  }
  const layout = await resolveClassicLayout(projectRoot);
  const active = await inspectProtectedProjectPath(projectRoot, runInput.changeDir, {
    label: 'Classic active change',
    expected: 'directory',
  });
  if (!active.exists || active.target !== path.join(layout.changesDir, runInput.change)) {
    throw new Error('Classic Archive active change differs from the SDK Run');
  }
  const before = await archiveEntries(layout.archiveDir, runInput.change);
  const token = randomUUID();
  const requestId = randomUUID();
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-archive',
    claimToken: token,
    expectedRevision: run.revision,
    context: { requestId, projectRoot },
  });
  try {
    await recordClassicArchiveRequirements(projectRoot, active.target);
    const result = await executeClassicOpenSpec(['archive', runInput.change, '--yes'], projectRoot);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr ?? `OpenSpec Archive exited with code ${result.exitCode}`);
    }
    const after = await archiveEntries(layout.archiveDir, runInput.change);
    const created = [...after].filter((name) => !before.has(name));
    if (created.length !== 1) {
      throw new Error('OpenSpec Archive did not produce one unambiguous archived change');
    }
    const archiveName = created[0];
    const archiveDirectory = path.join(layout.archiveDir, archiveName);
    const archived = await inspectProtectedProjectPath(
      projectRoot,
      path.relative(projectRoot, archiveDirectory).replaceAll('\\', '/'),
      {
        label: 'Classic archived change',
        expected: 'directory',
      },
    );
    const remaining = await inspectProtectedProjectPath(projectRoot, runInput.changeDir, {
      label: 'Classic active change',
      expected: 'directory',
    });
    if (!archived.exists || remaining.exists) {
      throw new Error('OpenSpec Archive left the change in an inconsistent location');
    }
    const problems = await classicArchivedRequirementsProblems(projectRoot, archived.target);
    if (problems.length) throw new Error(problems.join('\n'));
    const state = run.state as unknown as ClassicState;
    await annotateIfPresent(projectRoot, state.designDoc, archiveName, 'status: final');
    await annotateIfPresent(projectRoot, state.plan, archiveName, '');
    return await runtime.recordOutcome({
      runId: run.runId,
      context: { requestId, projectRoot },
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: token,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output: {
          archiveDirectory: path.relative(projectRoot, archived.target).replaceAll('\\', '/'),
        },
      },
    });
  } catch (error) {
    const current = await runtime.inspect(run.runId);
    const latest = current.actions.find((candidate) => candidate.id === action.id);
    if (latest?.status === 'running' && latest.attempt === action.attempt) {
      await runtime.markUnknown({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

/** Reconcile a moved Archive only when its portable checkpoint binds the original claim. */
export async function recoverClassicSdkArchive(
  runtime: Pick<WorkflowRuntime, 'inspect' | 'recordOutcome'>,
  input: ClassicSdkArchiveInput,
): Promise<WorkflowRun> {
  const projectRoot = path.resolve(input.projectRoot);
  const run = await runtime.inspect(input.runId);
  const state = run.state as unknown as ClassicState;
  const action = run.actions.filter((candidate) => candidate.status === 'unknown');
  const lost = action.length === 1 ? action[0] : null;
  if (
    state.phase !== 'archive' ||
    state.archived ||
    !lost ||
    lost.stepId !== `${state.workflow}.archive.execute` ||
    lost.claim?.executorId !== 'comet-classic-archive'
  ) {
    throw new Error('Classic SDK Archive has no single moved Action to recover');
  }
  const identity = run.input as { change?: unknown; changeDir?: unknown } | null;
  if (typeof identity?.change !== 'string' || typeof identity.changeDir !== 'string') {
    throw new Error('Classic SDK Archive change identity is missing');
  }
  const layout = await resolveClassicLayout(projectRoot);
  const active = await inspectProtectedProjectPath(projectRoot, identity.changeDir, {
    label: 'Classic active change',
    expected: 'directory',
  });
  if (active.exists) throw new Error('Classic SDK Archive still has its active change');
  const names = await archiveEntries(layout.archiveDir, identity.change);
  if (names.size !== 1) throw new Error('Classic SDK Archive destination is ambiguous');
  const archiveName = [...names][0];
  const archiveDirectory = path.join(layout.archiveDir, archiveName);
  const archived = await inspectProtectedProjectPath(
    projectRoot,
    path.relative(projectRoot, archiveDirectory),
    { label: 'Classic archived change', expected: 'directory' },
  );
  if (!archived.exists) throw new Error('Classic SDK Archive destination is missing');
  const source = await readClassicProjectFile(
    projectRoot,
    path.join(archived.target, '.comet.yaml'),
    {
      label: 'Classic archived state',
    },
  );
  if (!hasClassicManagedRunMarker(source)) {
    throw new Error('Classic archived state is not managed by the SDK');
  }
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error('Classic archived state is invalid');
  const saved = readPortableRunCheckpoint(
    (document.toJS() as Record<string, unknown>).run_checkpoint,
    run.runId,
  );
  const savedAction = saved?.actions.find((candidate) => candidate.id === lost.id);
  if (
    !savedAction ||
    savedAction.status !== 'unknown' ||
    savedAction.inputHash !== lost.inputHash ||
    savedAction.claim?.token !== lost.claim.token
  ) {
    throw new Error('Classic archived state does not match the lost Archive Action');
  }
  const problems = await classicArchivedRequirementsProblems(projectRoot, archived.target);
  if (problems.length) throw new Error(problems.join('\n'));
  await annotateIfPresent(projectRoot, state.designDoc, archiveName, 'status: final');
  await annotateIfPresent(projectRoot, state.plan, archiveName, '');
  return runtime.recordOutcome({
    runId: run.runId,
    context: { requestId: `classic-sdk-archive-recovery:${run.runId}:${lost.id}`, projectRoot },
    outcome: {
      actionId: lost.id,
      attempt: lost.attempt,
      inputHash: lost.inputHash,
      claimToken: lost.claim.token,
      outcomeId: `${lost.id}:${lost.attempt}:recovered`,
      status: 'succeeded',
      output: {
        archiveDirectory: path.relative(projectRoot, archived.target).replaceAll('\\', '/'),
      },
    },
  });
}
