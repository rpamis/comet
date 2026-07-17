import { promises as fs } from 'fs';
import path from 'path';

import { canonicalSpecPath } from './native-artifacts.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { settleNativeChangeJournalsLocked } from './native-change-recovery.js';
import { readNativeRunState } from './native-run-store.js';
import {
  assertNativeName,
  compareAndSwapNativeChangeLocked,
  nativeChangeDir,
  readNativeChange,
} from './native-change.js';
import { sha256File, sha256Text } from './native-hash.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { captureNativeProtectedDirectoryGuard } from './native-protected-file.js';
import { redactNativeCredentialText } from './native-redaction.js';
import { resolveContainedNativePath } from './native-paths.js';
import {
  continueNativeTransitionLocked,
  prepareNativeTransition,
  withNativeTransitionLock,
} from './native-transition-journal.js';
import { assertNativeTrajectoryText } from './native-trajectory-limits.js';
import { NATIVE_CONTRACT_FILE_LIMITS } from './native-contract-files.js';
import type { NativeChangeState, NativeProjectPaths, NativeSpecChange } from './native-types.js';

const MAX_NATIVE_PROPOSED_SPEC_DIRECTORY_ENTRIES = NATIVE_CONTRACT_FILE_LIMITS.maxSpecs * 4;

async function optionalHash(file: string): Promise<string | null> {
  try {
    return await sha256File(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function proposedCapabilities(paths: NativeProjectPaths, name: string): Promise<string[]> {
  const specsDir = path.join(nativeChangeDir(paths, name), 'specs');
  let guard: Awaited<ReturnType<typeof captureNativeProtectedDirectoryGuard>>;
  try {
    guard = await captureNativeProtectedDirectoryGuard({
      root: paths.nativeRoot,
      directory: specsDir,
      label: 'Native proposed specs directory',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const capabilities: string[] = [];
  let entryCount = 0;
  const directory = await fs.opendir(specsDir);
  try {
    for await (const entry of directory) {
      entryCount += 1;
      if (entryCount > MAX_NATIVE_PROPOSED_SPEC_DIRECTORY_ENTRIES) {
        throw new Error(
          `Native proposed specs directory exceeds ${MAX_NATIVE_PROPOSED_SPEC_DIRECTORY_ENTRIES} entries`,
        );
      }
      if (entry.isSymbolicLink()) {
        throw new Error(`Proposed spec capability must not be a symbolic link: ${entry.name}`);
      }
      if (!entry.isDirectory()) continue;
      assertNativeName(entry.name);
      const source = path.join(specsDir, entry.name, 'spec.md');
      await resolveContainedNativePath(paths.nativeRoot, source);
      let stat;
      try {
        stat = await fs.lstat(source);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Proposed spec must be a regular file: ${entry.name}`);
      }
      capabilities.push(entry.name);
      if (capabilities.length > NATIVE_CONTRACT_FILE_LIMITS.maxSpecs) {
        throw new Error('Native proposed specs exceed the spec-count budget');
      }
    }
  } finally {
    await directory.close().catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED') throw error;
    });
  }
  await guard.verify();
  return capabilities.sort();
}

export async function reconcileNativeSpecChanges(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeSpecChange[]> {
  const previous = new Map(state.spec_changes.map((change) => [change.capability, change]));
  const proposed = await proposedCapabilities(paths, state.name);
  const changes: NativeSpecChange[] = [];
  for (const capability of proposed) {
    const existing = previous.get(capability);
    if (existing?.operation === 'remove') {
      throw new Error(`Capability ${capability} has both a proposed spec and a remove intent`);
    }
    if (existing) {
      changes.push({
        ...existing,
        source: `specs/${capability}/spec.md`,
      });
      continue;
    }
    const canonical = canonicalSpecPath(paths, capability);
    await resolveContainedNativePath(paths.nativeRoot, canonical);
    const baseHash = await optionalHash(canonical);
    changes.push({
      capability,
      operation: baseHash === null ? 'create' : 'replace',
      source: `specs/${capability}/spec.md`,
      base_hash: baseHash,
    });
  }
  for (const change of state.spec_changes) {
    if (change.operation === 'remove' && !proposed.includes(change.capability)) {
      changes.push(change);
    }
  }
  return changes.sort((left, right) => left.capability.localeCompare(right.capability));
}

async function refreshNativeSpecChanges(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeSpecChange[]> {
  const proposed = await proposedCapabilities(paths, state.name);
  const changes: NativeSpecChange[] = [];
  for (const capability of proposed) {
    const existing = state.spec_changes.find((change) => change.capability === capability);
    if (existing?.operation === 'remove') {
      throw new Error(`Capability ${capability} has both a proposed spec and a remove intent`);
    }
    const canonical = canonicalSpecPath(paths, capability);
    await resolveContainedNativePath(paths.nativeRoot, canonical);
    const baseHash = await optionalHash(canonical);
    changes.push({
      capability,
      operation: baseHash === null ? 'create' : 'replace',
      source: `specs/${capability}/spec.md`,
      base_hash: baseHash,
    });
  }
  for (const change of state.spec_changes) {
    if (change.operation !== 'remove' || proposed.includes(change.capability)) continue;
    const canonical = canonicalSpecPath(paths, change.capability);
    await resolveContainedNativePath(paths.nativeRoot, canonical);
    const baseHash = await optionalHash(canonical);
    if (baseHash !== null) {
      changes.push({ ...change, base_hash: baseHash });
    }
  }
  return changes.sort((left, right) => left.capability.localeCompare(right.capability));
}

export async function rebaseNativeSpecChanges(options: {
  paths: NativeProjectPaths;
  name: string;
  summary: string;
  now?: Date;
  transitionId?: () => string;
}): Promise<NativeChangeState> {
  assertNativeName(options.name);
  const summary = redactNativeCredentialText(options.summary);
  assertNativeTrajectoryText(summary, 'Spec rebase summary');
  return withNativeMutationLock(options.paths, `rebase specs for ${options.name}`, () =>
    withNativeTransitionLock(
      options.paths,
      options.name,
      `rebase specs for ${options.name}`,
      async () => {
        await settleNativeChangeJournalsLocked(options.paths, options.name);
        const state = await readNativeChange(options.paths, options.name);
        if (state.phase === 'shape') {
          throw new Error('Shape spec metadata is refreshed by the next command');
        }
        if (state.archived) throw new Error(`Native change ${state.name} is already archived`);
        const changeDir = nativeChangeDir(options.paths, options.name);
        const run = await readNativeRunState(changeDir);
        if (!run || run.runId !== state.run_id || run.currentStep !== state.phase || run.pending) {
          throw new Error(`Native Run state is missing or inconsistent for ${state.name}`);
        }
        const specChanges = await refreshNativeSpecChanges(options.paths, state);
        const nextState: NativeChangeState = {
          ...state,
          revision: state.revision + 1,
          phase: 'build',
          spec_changes: specChanges,
          verification_result: 'pending',
          verification_report: null,
          implementation_scope: null,
          verification_evidence: null,
          partial_allowance: null,
        };
        const nextRun = {
          ...run,
          currentStep: 'build',
          iteration: run.iteration + 1,
          pending: null,
          status: 'running' as const,
        };
        const evidenceHash = sha256Text(
          JSON.stringify({
            operation: 'spec-rebase',
            change: state.name,
            summary,
            specChanges,
          }),
        );
        await prepareNativeTransition({
          paths: options.paths,
          previousState: state,
          nextState,
          previousRun: run,
          nextRun,
          evidenceHash,
          eventData: {
            previousPhase: state.phase,
            nextPhase: 'build',
            evidenceHash,
            summary,
            artifacts: [],
            noCodeReason: null,
            verificationResult: null,
          },
          operation: 'spec-rebase',
          now: options.now,
          transitionId: options.transitionId,
        });
        const rebased = await continueNativeTransitionLocked(options.paths, options.name);
        if (!rebased) throw new Error('Native spec rebase journal disappeared before completion');
        return rebased;
      },
    ),
  );
}

export async function markNativeSpecRemoval(
  paths: NativeProjectPaths,
  name: string,
  capability: string,
): Promise<NativeChangeState> {
  assertNativeName(name);
  assertNativeName(capability);
  return withNativeMutationLock(paths, `remove spec ${capability} from ${name}`, () =>
    withNativeTransitionLock(paths, name, `remove spec ${capability} from ${name}`, async () => {
      await settleNativeChangeJournalsLocked(paths, name);
      return markNativeSpecRemovalLocked(paths, name, capability);
    }),
  );
}

async function markNativeSpecRemovalLocked(
  paths: NativeProjectPaths,
  name: string,
  capability: string,
): Promise<NativeChangeState> {
  const state = await readNativeChange(paths, name);
  if (state.phase === 'archive' || state.archived) {
    throw new Error(`Native change ${name} no longer accepts spec changes`);
  }
  const proposed = await proposedCapabilities(paths, name);
  if (proposed.includes(capability)) {
    throw new Error(`Capability ${capability} has both a proposed spec and a remove intent`);
  }
  const previous = state.spec_changes.find((change) => change.capability === capability);
  if (previous?.operation === 'remove') return state;
  const canonical = canonicalSpecPath(paths, capability);
  await resolveContainedNativePath(paths.nativeRoot, canonical);
  const baseHash = await optionalHash(canonical);
  if (baseHash === null) throw new Error(`Canonical spec is missing: ${capability}`);
  const updated = {
    ...state,
    spec_changes: [
      ...state.spec_changes.filter((change) => change.capability !== capability),
      { capability, operation: 'remove' as const, base_hash: baseHash },
    ].sort((left, right) => left.capability.localeCompare(right.capability)),
  };
  await compareAndSwapNativeChangeLocked(paths, updated, state.revision);
  return updated;
}

export async function readNativeProposedSpecs(
  paths: NativeProjectPaths,
  name: string,
): Promise<Record<string, string>> {
  const changeDir = nativeChangeDir(paths, name);
  const result: Record<string, string> = {};
  let totalBytes = 0;
  for (const capability of await proposedCapabilities(paths, name)) {
    const source = await readNativeBoundedTextFile({
      root: changeDir,
      ref: `specs/${capability}/spec.md`,
      maxBytes: NATIVE_CONTRACT_FILE_LIMITS.maxFileBytes,
    });
    totalBytes += source.size;
    if (totalBytes > NATIVE_CONTRACT_FILE_LIMITS.maxTotalBytes) {
      throw new Error('Native proposed specs exceed the total byte budget');
    }
    result[capability] = source.text;
  }
  return result;
}
