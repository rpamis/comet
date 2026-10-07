import path from 'node:path';
import {
  diagnoseRecoverableFileLock,
  repairRecoverableFileLock,
} from '../../platform/fs/recoverable-file-lock.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';

async function projectionLockPath(projectRoot: string, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name))
    throw new Error(`Invalid Native change name: ${name}`);
  const inspected = await inspectProtectedProjectPath(
    projectRoot,
    `.comet/runtime/state-projections/native/${name}.lock`,
    { label: 'Native SDK projection lock', expected: 'file' },
  );
  return inspected.target;
}

export async function inspectNativeSdkProjectionLock(projectRoot: string, name: string) {
  const file = await projectionLockPath(projectRoot, name);
  const lock = await diagnoseRecoverableFileLock(file);
  return { ...lock, file, path: path.relative(projectRoot, file) };
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
