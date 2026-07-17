import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  buildNativeArchivePreflight,
  type NativeArchivePreflight,
  type NativeArchiveSpecFact,
} from './native-archive-preflight.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { inspectNativeChangeConflicts } from './native-conflict-inspection.js';
import {
  hasPendingNativeCheckpointRecovery,
  hasPendingNativeSchemaMigration,
  nativeChangeDir,
  readNativeChange,
} from './native-change.js';
import { canonicalSpecPath } from './native-artifacts.js';
import { isInsidePath } from './native-paths.js';
import { nativeTransitionJournalFile } from './native-transition-journal.js';
import type { NativeProjectPaths, NativeSpecChange } from './native-types.js';
import { inspectNativeVerificationFreshness } from './native-verification-runtime.js';

function archiveTargetRef(name: string, now: Date): string {
  return `archive/${now.toISOString().slice(0, 10)}-${name}`;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function optionalBoundedHash(root: string, ref: string): Promise<string | null> {
  try {
    return (await readNativeBoundedTextFile({ root, ref })).hash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function specFact(
  paths: NativeProjectPaths,
  name: string,
  change: NativeSpecChange,
): Promise<NativeArchiveSpecFact> {
  const canonical = canonicalSpecPath(paths, change.capability);
  if (!isInsidePath(paths.nativeRoot, canonical)) {
    throw new Error(`Native canonical spec escapes its root: ${change.capability}`);
  }
  const canonicalRef = path.relative(paths.nativeRoot, canonical).replaceAll('\\', '/');
  const actualBaseHash = await optionalBoundedHash(paths.nativeRoot, canonicalRef);
  let proposedHash: string | null = null;
  if (change.operation !== 'remove') {
    if (!change.source) throw new Error(`Native proposed spec is missing: ${change.capability}`);
    proposedHash = (
      await readNativeBoundedTextFile({
        root: nativeChangeDir(paths, name),
        ref: change.source,
      })
    ).hash;
  }
  return {
    capability: change.capability,
    operation: change.operation,
    expectedBaseHash: change.operation === 'create' ? null : change.base_hash,
    actualBaseHash,
    proposedHash,
  };
}

async function hasPendingTransition(paths: NativeProjectPaths, name: string): Promise<boolean> {
  return exists(nativeTransitionJournalFile(paths, name));
}

/** Collect the single read-only Archive view reused by CLI, commit, status, and Dashboard. */
export async function inspectNativeArchivePreflight(options: {
  paths: NativeProjectPaths;
  name: string;
  now?: Date;
}): Promise<NativeArchivePreflight> {
  const now = options.now ?? new Date();
  const state = await readNativeChange(options.paths, options.name);
  const targetRef = archiveTargetRef(state.name, now);
  const target = path.resolve(options.paths.nativeRoot, ...targetRef.split('/'));
  if (!isInsidePath(options.paths.nativeRoot, target)) {
    throw new Error('Native archive target escapes its root');
  }
  const [
    specs,
    evidence,
    conflicts,
    pendingSchema,
    pendingCheckpoint,
    pendingTransition,
    targetExists,
  ] = await Promise.all([
    Promise.all(state.spec_changes.map((change) => specFact(options.paths, state.name, change))),
    inspectNativeVerificationFreshness({ paths: options.paths, state, now }),
    inspectNativeChangeConflicts(options.paths, state.name),
    hasPendingNativeSchemaMigration(options.paths, state.name),
    hasPendingNativeCheckpointRecovery(options.paths, state.name),
    hasPendingTransition(options.paths, state.name),
    exists(target),
  ]);
  return buildNativeArchivePreflight({
    change: state.name,
    stateSchema: state.schema,
    revision: state.revision,
    phase: state.phase,
    archived: state.archived,
    pendingJournal: pendingSchema || pendingCheckpoint || pendingTransition,
    targetRef,
    targetExists,
    specs,
    evidence: evidence.evidence,
    findingCodes: [...evidence.findingCodes, ...conflicts.findingCodes],
  });
}
