import { promises as fs } from 'fs';
import path from 'path';

import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { readRunStateAt } from '../engine/storage-run.js';
import { canonicalSpecPath } from './native-artifacts.js';
import {
  assertNativeName,
  nativeChangeDir,
  readNativeChange,
  writeNativeChange,
} from './native-change.js';
import { sha256File, sha256Text } from './native-hash.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { resolveContainedNativePath } from './native-paths.js';
import {
  continueNativeTransitionLocked,
  prepareNativeTransition,
  withNativeTransitionLock,
} from './native-transition-journal.js';
import type { NativeChangeState, NativeProjectPaths, NativeSpecChange } from './native-types.js';

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
  let entries;
  try {
    entries = await fs.readdir(specsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const capabilities: string[] = [];
  for (const entry of entries) {
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
  }
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
  if (options.summary.trim().length === 0) throw new Error('Spec rebase requires a summary');
  return withNativeMutationLock(options.paths, `rebase specs for ${options.name}`, () =>
    withNativeTransitionLock(
      options.paths,
      options.name,
      `rebase specs for ${options.name}`,
      async () => {
        await continueNativeTransitionLocked(options.paths, options.name);
        const state = await readNativeChange(options.paths, options.name);
        if (state.phase === 'shape') {
          throw new Error('Shape spec metadata is refreshed by the next command');
        }
        if (state.archived) throw new Error(`Native change ${state.name} is already archived`);
        const changeDir = nativeChangeDir(options.paths, options.name);
        const run = await readRunStateAt(changeDir, NATIVE_RUN_STORAGE);
        if (!run || run.runId !== state.run_id || run.currentStep !== state.phase || run.pending) {
          throw new Error(`Native Run state is missing or inconsistent for ${state.name}`);
        }
        const specChanges = await refreshNativeSpecChanges(options.paths, state);
        const nextState: NativeChangeState = {
          ...state,
          phase: 'build',
          spec_changes: specChanges,
          verification_result: 'pending',
          verification_report: null,
        };
        const nextRun = {
          ...run,
          currentStep: 'build',
          iteration: run.iteration + 1,
          pending: null,
          status: 'running' as const,
        };
        const evidenceHash = sha256Text(`spec-rebase:${state.name}:${options.summary}`);
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
            summary: options.summary,
            reason: 'spec-rebase',
          },
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
      await continueNativeTransitionLocked(paths, name);
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
  await writeNativeChange(paths, updated);
  return updated;
}

export async function readNativeProposedSpecs(
  paths: NativeProjectPaths,
  name: string,
): Promise<Record<string, string>> {
  const changeDir = nativeChangeDir(paths, name);
  const result: Record<string, string> = {};
  for (const capability of await proposedCapabilities(paths, name)) {
    result[capability] = await fs.readFile(
      path.join(changeDir, 'specs', capability, 'spec.md'),
      'utf8',
    );
  }
  return result;
}
