import { readNativeChange } from './native-change.js';
import {
  buildNativeConflictRadar,
  NATIVE_CONFLICT_RADAR_LIMITS,
  type NativeConflictRadarChangeInput,
  type NativeConflictRadarSnapshot,
} from './native-conflict-radar.js';
import { readNativeImplementationScope } from './native-evidence-storage.js';
import { readNativeProtectedDirectory } from './native-protected-file.js';
import type { NativeProjectPaths } from './native-types.js';
import { readNativeWorkspaceIdentity } from './native-workspace.js';

const NATIVE_TARGETED_CONFLICT_MAX_CHANGES = 4_096;

async function visibleChangeEntries(
  paths: NativeProjectPaths,
  maxEntries: number = NATIVE_CONFLICT_RADAR_LIMITS.maxChanges,
) {
  try {
    const directory = await readNativeProtectedDirectory({
      root: paths.nativeRoot,
      directory: paths.changesDir,
      label: 'Native conflict changes directory',
      maxEntries,
    });
    await directory.verify();
    return directory.entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function collectConflictInput(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeConflictRadarChangeInput> {
  const state = await readNativeChange(paths, name);
  const [scope, workspace] = await Promise.all([
    state.implementation_scope
      ? readNativeImplementationScope(paths, name, state.implementation_scope)
      : null,
    // Workspace identity is advisory. A malformed advisory must not suppress deterministic
    // capability/artifact conflict facts.
    readNativeWorkspaceIdentity(paths, name).catch(() => null),
  ]);
  return {
    name: state.name,
    revision: state.revision,
    specs: state.spec_changes.map((spec) => ({
      capability: spec.capability,
      operation: spec.operation,
      baseHash: spec.base_hash,
    })),
    declaredArtifacts: scope?.declaredArtifacts ?? [],
    workspaceIdentityHash: workspace?.nativeRootId ?? null,
  };
}

async function collectConflictInputs(
  paths: NativeProjectPaths,
): Promise<NativeConflictRadarChangeInput[]> {
  const entries = await visibleChangeEntries(paths);
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(names.map((name) => collectConflictInput(paths, name)));
}

export interface NativeChangeConflictInspection {
  definiteConflictCount: number;
  possibleOverlapCount: number;
  findingCodes: Array<'native-change-conflict' | 'native-change-overlap'>;
}

/**
 * Recompute conflicts from every currently visible change in one physical Native root.
 *
 * Invalid state or evidence fails the whole inspection closed so Archive cannot silently omit a
 * competing change. Workspace metadata alone remains advisory and may be ignored when invalid.
 */
export async function inspectNativeConflictRadar(
  paths: NativeProjectPaths,
): Promise<NativeConflictRadarSnapshot> {
  return buildNativeConflictRadar(await collectConflictInputs(paths));
}

/** Compute every relationship for one change even when the global radar detail view is truncated. */
export async function inspectNativeChangeConflicts(
  paths: NativeProjectPaths,
  name: string,
  options: { tolerateInvalidSiblings?: boolean } = {},
): Promise<NativeChangeConflictInspection> {
  const entries = await visibleChangeEntries(paths, NATIVE_TARGETED_CONFLICT_MAX_CHANGES);
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  if (!names.includes(name)) throw new Error(`Native conflict target is not visible: ${name}`);
  const target = await collectConflictInput(paths, name);
  let definiteConflictCount = 0;
  let possibleOverlapCount = 0;
  for (const otherName of names) {
    if (otherName === name) continue;
    const other = await collectConflictInput(paths, otherName).catch((error: unknown) => {
      if (options.tolerateInvalidSiblings) return null;
      throw error;
    });
    if (!other) continue;
    const relationship = buildNativeConflictRadar([target, other]).relationships[0];
    if (relationship.classification === 'definite-conflict') definiteConflictCount += 1;
    if (relationship.classification === 'possible-overlap') possibleOverlapCount += 1;
  }
  return {
    definiteConflictCount,
    possibleOverlapCount,
    findingCodes: [
      ...(definiteConflictCount > 0 ? (['native-change-conflict'] as const) : []),
      ...(possibleOverlapCount > 0 ? (['native-change-overlap'] as const) : []),
    ],
  };
}
