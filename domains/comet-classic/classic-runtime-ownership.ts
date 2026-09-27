import path from 'node:path';

import { withRecoverableFileLock } from '../../platform/fs/plugin-store.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  readChangeRuntimeOwner,
  registerLegacyChangeOwner,
  registerSdkChangeOwner,
  type ChangeRuntimeOwner,
  type SdkApplication,
} from '../workflow-contract/change-runtime-owner.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import { assertOpenSpecChangeName, resolveClassicChangeDirectory } from './classic-paths.js';

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
    return registerLegacyChangeOwner(projectRoot, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'classic',
      change,
      format: 'legacy',
    });
  });
}
