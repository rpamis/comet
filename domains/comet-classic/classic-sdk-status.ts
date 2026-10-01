import { promises as fs } from 'node:fs';
import path from 'node:path';

import { listGitWorktrees, samePath } from '../../platform/paths/git-worktree.js';
import { createRuntime, type WorkflowRun, type WorkflowRuntime } from '../engine/runtime.js';
import {
  readChangeRuntimeOwner,
  readSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { resolveClassicChangeRuntimeOwner } from './classic-runtime-ownership.js';
import { defineClassicWorkflowApplication } from './classic-sdk-application.js';
import { createClassicSdkStateStore } from './classic-sdk-state-store.js';
import { resolveClassicChangeDirectory } from './classic-paths.js';
import type { ClassicProfile, ClassicState } from './classic-state.js';

export async function inspectClassicSdkRun(
  projectRoot: string,
  name: string,
): Promise<{
  run: WorkflowRun;
  state: ClassicState;
  runtime: WorkflowRuntime;
  profile: ClassicProfile;
}> {
  const owner = await readSdkChangeOwner(projectRoot, 'classic', name);
  if (!owner) throw new Error(`Classic change ${name} is not owned by an SDK Run`);
  const profile = owner.application.slice('classic-'.length) as ClassicProfile;
  const application = defineClassicWorkflowApplication(profile);
  const runtime = createRuntime({
    store: createClassicSdkStateStore(projectRoot),
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    evidenceValidators: application.evidenceValidators,
    validators: application.validators,
    executors: application.executors,
  });
  const run = await runtime.inspect(owner.runId);
  const directory = (await resolveClassicChangeDirectory(name, projectRoot)).directory;
  const state = run.state as ClassicState | undefined;
  const expectedActive =
    run.input &&
    typeof run.input === 'object' &&
    !Array.isArray(run.input) &&
    typeof run.input.changeDir === 'string'
      ? path.resolve(projectRoot, run.input.changeDir)
      : null;
  const archiveDir = expectedActive ? path.join(path.dirname(expectedActive), 'archive') : null;
  const archiveMoveUnresolved = run.actions.some(
    (action) =>
      action.stepId === `${profile}.archive.execute` &&
      (action.status === 'running' || action.status === 'unknown'),
  );
  const directoryMatches =
    expectedActive !== null &&
    (directory === expectedActive ||
      ((state?.archived === true || archiveMoveUnresolved) &&
        path.dirname(directory) === archiveDir &&
        /^\d{4}-\d{2}-\d{2}-/u.test(path.basename(directory)) &&
        path.basename(directory).slice(11) === name));
  const upgradedFromPreset =
    profile !== 'full' &&
    state?.workflow === 'full' &&
    state.classicProfile === 'full' &&
    run.waits.some(
      (wait) =>
        wait.stepId === `${profile}.build.escalation-confirm` &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'upgrade',
    );
  if (
    run.workflow.id !== application.workflow.id ||
    run.workflow.version !== application.workflow.version ||
    !run.input ||
    typeof run.input !== 'object' ||
    Array.isArray(run.input) ||
    run.input.change !== name ||
    !directoryMatches ||
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    (state.workflow !== profile && !upgradedFromPreset)
  ) {
    throw new Error(`Classic SDK Run ${name} does not match its change ownership`);
  }
  return { run, state, runtime, profile: upgradedFromPreset ? 'full' : profile };
}

export async function findClassicSdkWorkspace(
  projectRoot: string,
  name: string,
): Promise<{ projectRoot: string; run: WorkflowRun; state: ClassicState } | null> {
  const requestedRoot = path.resolve(projectRoot);
  if (await readSdkChangeOwner(requestedRoot, 'classic', name)) {
    return { projectRoot: requestedRoot, ...(await inspectClassicSdkRun(requestedRoot, name)) };
  }
  const candidates: Array<{ projectRoot: string; run: WorkflowRun; state: ClassicState }> = [];
  for (const worktree of listGitWorktrees(requestedRoot)) {
    if (samePath(worktree.root, requestedRoot)) continue;
    if (!(await readSdkChangeOwner(worktree.root, 'classic', name))) continue;
    const inspected = await inspectClassicSdkRun(worktree.root, name);
    if (
      inspected.state.isolation !== 'worktree' ||
      !inspected.state.boundBranch ||
      inspected.state.boundBranch !== worktree.branch
    ) {
      throw new Error(`Classic SDK change '${name}' is not bound to its registered worktree`);
    }
    candidates.push({ projectRoot: worktree.root, ...inspected });
  }
  if (candidates.length > 1) {
    throw new Error(`Classic SDK change '${name}' exists in multiple registered worktrees`);
  }
  return candidates[0] ?? null;
}

export async function resolveClassicSdkCommandRoot(
  projectRoot: string,
  name: string,
): Promise<string> {
  const requestedRoot = path.resolve(projectRoot);
  let localOwner = await readChangeRuntimeOwner(requestedRoot, 'classic', name);
  if (!localOwner) {
    const configAvailable = await fs.access(path.join(requestedRoot, '.comet', 'config.yaml')).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (configAvailable) {
      localOwner = await resolveClassicChangeRuntimeOwner(requestedRoot, name);
    }
  }
  if (localOwner) return requestedRoot;
  return (await findClassicSdkWorkspace(requestedRoot, name))?.projectRoot ?? requestedRoot;
}
