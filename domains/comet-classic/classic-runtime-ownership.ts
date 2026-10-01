import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { parseDocument } from 'yaml';

import { withRecoverableFileLock } from '../../platform/fs/plugin-store.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  readChangeRuntimeOwner,
  registerCompatChangeOwner,
  registerSdkChangeOwner,
  type ChangeRuntimeOwner,
  type SdkApplication,
} from '../workflow-contract/change-runtime-owner.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import { assertOpenSpecChangeName, resolveClassicChangeDirectory } from './classic-paths.js';
import { createClassicSdkRun } from './classic-sdk-create.js';
import {
  createClassicSdkStateStore,
  hasClassicManagedRunMarker,
  readClassicSdkRunRecord,
} from './classic-sdk-state-store.js';
import { parseClassicStateDocument, type ClassicState } from './classic-state.js';
import { readClassicProjectFile } from './classic-protected-path.js';
import { liveGitBranch } from './classic-branch-binding.js';
import type { WorkflowRun } from '../engine/runtime.js';

/** A copied initial change can recreate its Run; any existing work needs its Action history. */
export async function inspectPristineClassicSdkState(
  directory: string,
  source: string,
): Promise<ClassicState | null> {
  if (!hasClassicManagedRunMarker(source)) return null;
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0)
    throw new Error(`Invalid Classic state: ${document.errors[0].message}`);
  const initial = parseClassicStateDocument(document.toJS() as Record<string, unknown>).classic;
  const contents = await fs.readdir(directory);
  return initial?.phase === 'open' &&
    initial.designDoc === null &&
    initial.plan === null &&
    initial.verifyResult === 'pending' &&
    initial.verifyFailures === 0 &&
    !initial.archived &&
    contents.every((name) => name === '.comet.yaml' || name === '.openspec.yaml')
    ? initial
    : null;
}

/** Restore a portable Run when present; older states explicitly restart at Open. */
export async function restoreClassicSdkChange(
  projectRoot: string,
  change: string,
): Promise<WorkflowRun> {
  return withClassicChangeOwnershipLock(projectRoot, change, async () => {
    const owner = await readChangeRuntimeOwner(projectRoot, 'classic', change);
    if (
      owner &&
      (owner.format !== 'sdk' ||
        owner.runId !== change ||
        (await readClassicSdkRunRecord(projectRoot, change)) !== null)
    ) {
      throw new Error(`Classic change ${change} already has Runtime ownership`);
    }
    const resumed = await createClassicSdkStateStore(projectRoot).read(change);
    if (resumed) return resumed;
    const directory = (await resolveClassicChangeDirectory(change, projectRoot)).directory;
    const file = path.join(directory, '.comet.yaml');
    const source = await readClassicProjectFile(projectRoot, file, {
      label: 'Classic change state',
    });
    if (!hasClassicManagedRunMarker(source)) {
      throw new Error(`Classic change ${change} is not a managed Run`);
    }
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length > 0)
      throw new Error(`Invalid Classic state: ${document.errors[0].message}`);
    const state = parseClassicStateDocument(document.toJS() as Record<string, unknown>).classic;
    if (!state || state.archived || state.phase === 'archive')
      throw new Error(`Classic change ${change} cannot be restored from this state file`);
    if (owner && owner.application !== `classic-${state.workflow}`) {
      throw new Error(`Classic change ${change} has a conflicting Runtime application`);
    }
    if (state.boundBranch !== null && state.boundBranch !== liveGitBranch(projectRoot)) {
      throw new Error(`Classic change ${change} is bound to branch ${state.boundBranch}`);
    }
    const initialState: ClassicState = {
      ...state,
      phase: 'open',
      buildPause: null,
      subagentDispatch: null,
      designDoc: null,
      plan: null,
      verifyResult: 'pending',
      verifyFailures: 0,
      checkEpoch: 0,
      verificationReport: null,
      branchStatus: 'pending',
      verifiedAt: null,
      archiveConfirmation: null,
      archived: false,
      directOverride: null,
      handoffContext: null,
      handoffHash: null,
    };
    const run = await createClassicSdkRun({
      projectRoot,
      name: change,
      profile: state.workflow,
      changeDir: directory,
      initialState,
      recoverySourceHash: createHash('sha256').update(source).digest('hex'),
      recoverySource: source,
    });
    await createClassicSdkStateStore(projectRoot).read(run.runId);
    return run;
  });
}

export async function withClassicChangeOwnershipLock<T>(
  projectRoot: string,
  change: string,
  work: () => Promise<T>,
): Promise<T> {
  assertOpenSpecChangeName(change);
  const directory = '.comet/runtime/change-owners/classic';
  await ensureProtectedProjectDirectory(projectRoot, directory, {
    label: 'Classic change ownership directory',
  });
  const ref = `${directory}/${change}.lock`;
  const lock = await inspectProtectedProjectPath(projectRoot, ref, {
    label: 'Classic change ownership lock',
    expected: 'file',
  });
  return withRecoverableFileLock(lock.target, work, { timeoutMs: 5_000 });
}

export async function assertClassicSdkStartAvailable(options: {
  projectRoot: string;
  changeDirRef: string;
}): Promise<void> {
  const ref = path.posix.join(options.changeDirRef.replaceAll('\\', '/'), '.comet.yaml');
  const state = await inspectProtectedProjectPath(options.projectRoot, ref, {
    label: 'Classic legacy change state',
    expected: 'file',
  });
  if (state.exists) {
    throw new Error(
      `Classic change ${path.posix.basename(options.changeDirRef)} already has legacy Runtime state`,
    );
  }
}

export async function registerClassicSdkStartOwner(options: {
  projectRoot: string;
  change: string;
  changeDirRef: string;
  application: Extract<SdkApplication, `classic-${string}`>;
}): Promise<void> {
  const { projectRoot, change, changeDirRef, application } = options;
  await withClassicChangeOwnershipLock(projectRoot, change, async () => {
    await assertClassicSdkStartAvailable({ projectRoot, changeDirRef });
    await registerSdkChangeOwner(projectRoot, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'classic',
      change,
      format: 'sdk',
      application,
      runId: change,
    });
  });
}

export async function resolveClassicChangeRuntimeOwner(
  projectRoot: string,
  change: string,
): Promise<ChangeRuntimeOwner | null> {
  const current = await readChangeRuntimeOwner(projectRoot, 'classic', change);
  if (current) return current;
  return withClassicChangeOwnershipLock(projectRoot, change, async () => {
    const bound = await readChangeRuntimeOwner(projectRoot, 'classic', change);
    if (bound) return bound;
    const directory = (await resolveClassicChangeDirectory(change, projectRoot)).directory;
    const stateRef = path.relative(projectRoot, path.join(directory, '.comet.yaml'));
    const state = await inspectProtectedProjectPath(projectRoot, stateRef, {
      label: 'Classic legacy change state',
      expected: 'file',
    });
    if (!state.exists) return null;
    const source = await readClassicProjectFile(projectRoot, state.target, {
      label: 'Classic change state',
    });
    if (hasClassicManagedRunMarker(source)) {
      if (await createClassicSdkStateStore(projectRoot).read(change)) {
        const recovered = await readChangeRuntimeOwner(projectRoot, 'classic', change);
        if (!recovered || recovered.format !== 'sdk') {
          throw new Error(`Recovered Classic change ${change} has no Run ownership`);
        }
        return recovered;
      }
      const initial = await inspectPristineClassicSdkState(directory, source);
      if (initial) {
        await createClassicSdkRun({
          projectRoot,
          name: change,
          profile: initial.workflow,
          changeDir: directory,
          initialState: initial,
        });
        const recovered = await readChangeRuntimeOwner(projectRoot, 'classic', change);
        if (!recovered || recovered.format !== 'sdk') {
          throw new Error(`Recovered Classic change ${change} has no Run ownership`);
        }
        return recovered;
      }
      throw new Error(
        `Classic change ${change} has a state file but lost its local Run history; after confirming the original process stopped, use comet state restore ${change} --confirmed to restart at Open`,
      );
    }
    return registerCompatChangeOwner(projectRoot, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'classic',
      change,
      format: 'compat',
    });
  });
}
