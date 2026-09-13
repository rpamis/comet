import { promises as fs } from 'node:fs';
import path from 'node:path';
import { currentGitBranch, inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { readNativeLocalExecution } from './native-local-execution.js';
import {
  compareAndSwapNativePortableState,
  readNativePortableState,
} from './native-portable-state.js';
import type {
  NativeLocalExecutionState,
  NativePortableState,
  NativePortableWorkspace,
} from './native-portable-types.js';
import {
  isInsidePath,
  nativePreferredChangeRuntimeDir,
  resolveContainedNativePath,
} from './native-paths.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativeWorkspaceBinding } from './native-workspace.js';

export const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export const NATIVE_PORTABLE_STATE_FILE = 'comet-state.yaml';

export const NATIVE_LOCAL_EXECUTION_FILE = 'state.json';

export function nativePortableChangeDir(paths: NativeProjectPaths, name: string): string {
  if (!NAME_PATTERN.test(name)) throw new Error(`Invalid Native change name: ${name}`);
  const target = path.join(paths.changesDir, name);
  if (!isInsidePath(paths.changesDir, target)) throw new Error('Native change path escaped');
  return target;
}

export function nativePortableStateFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativePortableChangeDir(paths, name), NATIVE_PORTABLE_STATE_FILE);
}

export function nativeLocalExecutionFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativePreferredChangeRuntimeDir(paths, name), NATIVE_LOCAL_EXECUTION_FILE);
}

export async function isNativePortableChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  try {
    const source = await fs.readFile(nativePortableStateFile(paths, name), 'utf8');
    return /^schema:\s*comet\.native\.v4\s*$/mu.test(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function portableWorkspace(binding?: NativeWorkspaceBinding): NativePortableWorkspace {
  return {
    isolation: binding?.isolation ?? 'current',
    change_branch: binding?.changeBranch ?? null,
    target_branch: binding?.targetBranch ?? null,
    finish: null,
  };
}

export function currentBranch(projectRoot: string): string | null {
  return currentGitBranch(projectRoot);
}

export function assertPortableWorkspaceBindingCurrent(
  projectRoot: string,
  binding: NativeWorkspaceBinding | undefined,
): void {
  if (!binding) return;
  const inspection = inspectGitWorktree(projectRoot);
  if (
    binding.changeBranch !== null &&
    (!inspection.isGitWorktree || inspection.currentBranch !== binding.changeBranch)
  ) {
    throw new Error(
      `Native workspace binding ${binding.changeBranch ?? '(missing)'} does not match the current branch ${inspection.currentBranch ?? '(detached)'}`,
    );
  }
  if (binding.isolation === 'worktree' && !inspection.isSecondaryWorktree) {
    throw new Error('Native worktree isolation must use a linked Git worktree');
  }
}

export async function readNativePortableChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativePortableState> {
  return readNativePortableState(nativePortableStateFile(paths, name));
}

export async function writePortableMutation(options: {
  paths: NativeProjectPaths;
  previous: NativePortableState;
  next: NativePortableState;
}): Promise<NativePortableState> {
  const written = await compareAndSwapNativePortableState({
    file: nativePortableStateFile(options.paths, options.previous.name),
    expectedStateVersion: options.previous.state_version,
    next: options.next,
    containedRoot: options.paths.nativeRoot,
  });
  if (written.verification === null && written.verification_report === null) {
    const report = path.join(
      nativePortableChangeDir(options.paths, written.name),
      'verification.md',
    );
    await resolveContainedNativePath(options.paths.nativeRoot, report);
    await fs.rm(report, { force: true });
  }
  return written;
}

export async function readNativePortableRuntime(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<{
  state: NativePortableState;
  local: NativeLocalExecutionState | null;
  localStatus: 'available' | 'missing' | 'invalid' | 'stale';
}> {
  const state = await readNativePortableChange(options.paths, options.name);
  const file = nativeLocalExecutionFile(options.paths, options.name);
  try {
    const local = await readNativeLocalExecution(file);
    if (local === null) return { state, local: null, localStatus: 'missing' };
    if (local.change !== state.name || local.basedOnStateVersion !== state.state_version) {
      return { state, local: null, localStatus: 'stale' };
    }
    return { state, local, localStatus: 'available' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state, local: null, localStatus: 'missing' };
    }
    return { state, local: null, localStatus: 'invalid' };
  }
}
