import { promises as fs } from 'node:fs';
import path from 'node:path';

import { listGitWorktrees, samePath } from '../../platform/paths/git-worktree.js';
import {
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../engine/runtime.js';
import {
  readChangeRuntimeOwner,
  readSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import {
  assertClassicSdkStartAvailable,
  resolveClassicChangeRuntimeOwner,
} from './classic-runtime-ownership.js';
import { defineClassicWorkflowApplication } from './classic-sdk-application.js';
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
    store: createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
    }),
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    evidenceValidators: application.evidenceValidators,
    validators: application.validators,
    executors: application.executors,
  });
  const run = await runtime.inspect(owner.runId);
  const directory = (await resolveClassicChangeDirectory(name, projectRoot)).directory;
  const state = run.state as ClassicState | undefined;
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
    run.input.changeDir !== path.relative(projectRoot, directory).replaceAll('\\', '/') ||
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    (state.workflow !== profile && !upgradedFromPreset)
  ) {
    throw new Error(`Classic SDK Run ${name} does not match its change ownership`);
  }
  await assertClassicSdkStartAvailable({
    projectRoot,
    changeDirRef: run.input.changeDir,
  });
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
