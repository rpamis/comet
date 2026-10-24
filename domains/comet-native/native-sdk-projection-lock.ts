import {
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../workflow-contract/workspace-runtime.js';
import {
  diagnoseRecoverableFileLock,
  repairRecoverableFileLock,
} from '../../platform/fs/recoverable-file-lock.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { inspectFileRuntimeStoreLock, repairFileRuntimeStoreLock } from '../engine/runtime.js';
import {
  inspectWorkflowApplicationLocks,
  repairWorkflowApplicationLock,
} from '../workflow-application/index.js';
import path from 'node:path';

async function projectionLockPath(projectRoot: string, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name))
    throw new Error(`Invalid Native change name: ${name}`);
  const inspected = await inspectProtectedProjectPath(
    resolveWorkspaceRuntimeRootSync(projectRoot),
    `state-projections/native/${name}.lock`,
    { label: 'Native SDK projection lock', expected: 'file' },
  );
  return inspected.target;
}

export async function inspectNativeSdkProjectionLock(projectRoot: string, name: string) {
  const file = await projectionLockPath(projectRoot, name);
  const lock = await diagnoseRecoverableFileLock(file);
  return { ...lock, file, path: file };
}

export async function repairNativeSdkProjectionLock(
  projectRoot: string,
  name: string,
  token: string,
  confirmedOwnerStopped = false,
) {
  const file = await projectionLockPath(projectRoot, name);
  return repairRecoverableFileLock(file, token, { confirmedOwnerStopped });
}

export async function inspectNativeSdkLocks(projectRoot: string, name: string) {
  const projection = await inspectNativeSdkProjectionLock(projectRoot, name);
  const owner = await readSdkChangeOwner(projectRoot, 'native', name, { readOnly: true });
  const writerLocks =
    owner && owner.application !== 'native'
      ? await inspectWorkflowApplicationLocks(projectRoot, owner.application, owner.runId)
      : [
          {
            ...(await inspectFileRuntimeStoreLock(
              {
                rootDir: path.join(
                  resolveWorkspaceRuntimeRootSync(projectRoot),
                  'sdk-runs',
                  'native',
                ),
              },
              name,
            )),
            kind: 'run-store',
          },
        ];
  return [{ ...projection, kind: 'projection' }, ...writerLocks];
}

export async function repairNativeSdkLock(
  projectRoot: string,
  name: string,
  token: string,
  confirmedOwnerStopped = false,
) {
  const locks = await inspectNativeSdkLocks(projectRoot, name);
  const lock = locks.find(
    (entry) => entry.token === token || entry.coordinator?.some((ticket) => ticket.token === token),
  );
  if (!lock) throw new Error('Native SDK writer lock changed; inspect doctor again');
  if (lock.kind === 'projection')
    return repairNativeSdkProjectionLock(projectRoot, name, token, confirmedOwnerStopped);
  const owner = await readSdkChangeOwner(projectRoot, 'native', name);
  if (owner && owner.application !== 'native')
    return repairWorkflowApplicationLock(
      projectRoot,
      owner.application,
      owner.runId,
      token,
      confirmedOwnerStopped,
    );
  return repairFileRuntimeStoreLock(
    { rootDir: path.join(await resolveWorkspaceRuntimeRoot(projectRoot), 'sdk-runs', 'native') },
    name,
    token,
    confirmedOwnerStopped,
  );
}
