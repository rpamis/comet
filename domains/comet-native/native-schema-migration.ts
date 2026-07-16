import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { stringify } from 'yaml';

import { atomicWriteJson, atomicWriteText } from './native-atomic-file.js';
import {
  inspectNativeChange,
  nativeChangeDir,
  nativeChangeDocument,
  parseNativeChangeValue,
} from './native-change.js';
import { sha256File, sha256Text } from './native-hash.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { resolveContainedNativePath } from './native-paths.js';
import {
  createNativeContentSnapshot,
  readNativeBaselineManifest,
  writeNativeBaselineManifest,
} from './native-snapshot.js';
import {
  inspectPendingNativeTransitionSchema,
  nativeTransitionJournalFile,
  parseNativeTransitionJournalValue,
  withNativeTransitionLock,
} from './native-transition-journal.js';
import type {
  NativeChangeState,
  NativeLegacyChangeState,
  NativeLegacyTransitionJournal,
  NativeProjectPaths,
  NativeSchemaMigrationHooks,
  NativeSchemaMigrationJournal,
  NativeTransitionJournal,
} from './native-types.js';
import {
  NATIVE_CHANGE_SCHEMA,
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_TRANSITION_SCHEMA,
  NATIVE_RUNTIME_PROTOCOL_VERSION,
} from './native-types.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function transitionContent(journal: NativeTransitionJournal): string {
  return JSON.stringify(journal, null, 2) + '\n';
}

function upgradeLegacyState(state: NativeLegacyChangeState, revision: number): NativeChangeState {
  return {
    ...state,
    schema: NATIVE_CHANGE_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision,
  };
}

function upgradeLegacyTransition(journal: NativeLegacyTransitionJournal): NativeTransitionJournal {
  return {
    ...journal,
    schema: NATIVE_TRANSITION_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision: 1,
    previousState: upgradeLegacyState(journal.previousState, 1),
    nextState: upgradeLegacyState(journal.nextState, 2),
  };
}

function sameLegacyState(left: NativeLegacyChangeState, right: NativeLegacyChangeState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameCurrentState(left: NativeChangeState, right: NativeChangeState): boolean {
  return JSON.stringify(nativeChangeDocument(left)) === JSON.stringify(nativeChangeDocument(right));
}

export function nativeSchemaMigrationJournalFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativeChangeDir(paths, name), 'runtime', 'schema-migration.json');
}

function parseMigrationJournal(value: unknown, expectedName: string): NativeSchemaMigrationJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native schema migration journal must be an object');
  }
  const journal = value as Partial<NativeSchemaMigrationJournal>;
  if (journal.schema !== 'comet.native.schema-migration.v1') {
    throw new Error('Unsupported Native schema migration journal');
  }
  if (journal.change !== expectedName) throw new Error('Schema migration change mismatch');
  if (
    journal.fromSchema !== NATIVE_LEGACY_CHANGE_SCHEMA ||
    journal.toSchema !== NATIVE_CHANGE_SCHEMA
  ) {
    throw new Error('Schema migration route is unsupported');
  }
  if (typeof journal.id !== 'string' || journal.id.length === 0) {
    throw new Error('Schema migration id is invalid');
  }
  if (
    typeof journal.sourceHash !== 'string' ||
    !HASH_PATTERN.test(journal.sourceHash) ||
    typeof journal.targetHash !== 'string' ||
    !HASH_PATTERN.test(journal.targetHash)
  ) {
    throw new Error('Schema migration hash is invalid');
  }
  if (typeof journal.createdAt !== 'string' || Number.isNaN(Date.parse(journal.createdAt))) {
    throw new Error('Schema migration timestamp is invalid');
  }
  const nextState = parseNativeChangeValue(journal.nextState);
  let transition: NativeSchemaMigrationJournal['transition'];
  if (journal.transition !== undefined) {
    if (!journal.transition || typeof journal.transition !== 'object') {
      throw new Error('Schema migration transition target is invalid');
    }
    const transitionValue = journal.transition as Partial<
      NonNullable<NativeSchemaMigrationJournal['transition']>
    >;
    if (
      typeof transitionValue.sourceHash !== 'string' ||
      !HASH_PATTERN.test(transitionValue.sourceHash) ||
      typeof transitionValue.targetHash !== 'string' ||
      !HASH_PATTERN.test(transitionValue.targetHash)
    ) {
      throw new Error('Schema migration transition hash is invalid');
    }
    const nextJournal = parseNativeTransitionJournalValue(
      transitionValue.nextJournal,
      expectedName,
    );
    if (
      !sameCurrentState(nextState, nextJournal.previousState) &&
      !sameCurrentState(nextState, nextJournal.nextState)
    ) {
      throw new Error('Schema migration state/transition target mismatch');
    }
    transition = {
      sourceHash: transitionValue.sourceHash,
      targetHash: transitionValue.targetHash,
      nextJournal,
    };
  }
  if (
    nextState.name !== expectedName ||
    (!transition && nextState.revision !== 1) ||
    (transition && nextState.revision !== 1 && nextState.revision !== 2)
  ) {
    throw new Error('Schema migration target state is invalid');
  }
  return {
    schema: 'comet.native.schema-migration.v1',
    id: journal.id,
    change: expectedName,
    fromSchema: NATIVE_LEGACY_CHANGE_SCHEMA,
    toSchema: NATIVE_CHANGE_SCHEMA,
    sourceHash: journal.sourceHash,
    targetHash: journal.targetHash,
    createdAt: journal.createdAt,
    nextState,
    ...(transition ? { transition } : {}),
  };
}

export async function inspectPendingNativeSchemaMigration(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeSchemaMigrationJournal | null> {
  const file = nativeSchemaMigrationJournalFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    return parseMigrationJournal(JSON.parse(await fs.readFile(file, 'utf8')), name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureMigrationBaseline(
  paths: NativeProjectPaths,
  name: string,
  createdAt: string,
): Promise<void> {
  if (await readNativeBaselineManifest(paths, name)) return;
  const baseline = await createNativeContentSnapshot(paths, {
    now: new Date(createdAt),
    origin: 'legacy-migration',
  });
  await writeNativeBaselineManifest(paths, name, baseline);
}

async function continueNativeSchemaMigrationLocked(
  paths: NativeProjectPaths,
  name: string,
  hooks?: NativeSchemaMigrationHooks,
): Promise<NativeChangeState | null> {
  const journal = await inspectPendingNativeSchemaMigration(paths, name);
  if (!journal) return null;
  const changeFile = path.join(nativeChangeDir(paths, name), 'change.yaml');
  const actualHash = await sha256File(changeFile);
  if (actualHash !== journal.targetHash) {
    if (actualHash !== journal.sourceHash) {
      throw new Error(
        `Native schema migration source changed for ${name}: expected ${journal.sourceHash}, actual ${actualHash}`,
      );
    }
    await atomicWriteText(changeFile, stringify(nativeChangeDocument(journal.nextState)));
    await hooks?.afterStateWritten?.(journal);
  }
  if (journal.transition) {
    const transitionFile = nativeTransitionJournalFile(paths, name);
    const actualTransitionHash = await sha256File(transitionFile);
    if (actualTransitionHash !== journal.transition.targetHash) {
      if (actualTransitionHash !== journal.transition.sourceHash) {
        throw new Error(
          `Native transition migration source changed for ${name}: expected ${journal.transition.sourceHash}, actual ${actualTransitionHash}`,
        );
      }
      await atomicWriteJson(transitionFile, journal.transition.nextJournal);
      await hooks?.afterTransitionWritten?.(journal);
    }
  }
  await ensureMigrationBaseline(paths, name, journal.createdAt);
  await fs.rm(nativeSchemaMigrationJournalFile(paths, name), { force: true });
  return journal.nextState;
}

export async function migrateNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
  now?: Date;
  id?: () => string;
  hooks?: NativeSchemaMigrationHooks;
}): Promise<NativeChangeState> {
  return withNativeMutationLock(options.paths, `migrate schema for ${options.name}`, () =>
    withNativeTransitionLock(
      options.paths,
      options.name,
      `migrate schema for ${options.name}`,
      async () => {
        const continued = await continueNativeSchemaMigrationLocked(
          options.paths,
          options.name,
          options.hooks,
        );
        if (continued) return continued;
        const pendingTransition = await inspectPendingNativeTransitionSchema(
          options.paths,
          options.name,
        );
        if (pendingTransition?.status === 'current') {
          throw new Error(
            `Native change ${options.name} has a pending transition; recover it before schema migration`,
          );
        }
        const inspection = await inspectNativeChange(options.paths, options.name);
        if (inspection.status === 'current' && inspection.state) {
          return inspection.state as NativeChangeState;
        }
        if (inspection.status !== 'migration-required' || !inspection.state) {
          throw new Error(inspection.message ?? `Native change ${options.name} cannot be migrated`);
        }
        const legacyState = inspection.state as NativeLegacyChangeState;
        let nextState = upgradeLegacyState(legacyState, 1);
        let transition: NativeSchemaMigrationJournal['transition'];
        if (pendingTransition?.status === 'migration-required') {
          const nextJournal = upgradeLegacyTransition(pendingTransition.journal);
          if (sameLegacyState(legacyState, pendingTransition.journal.previousState)) {
            nextState = nextJournal.previousState;
          } else if (sameLegacyState(legacyState, pendingTransition.journal.nextState)) {
            nextState = nextJournal.nextState;
          } else {
            throw new Error(
              `Native change ${options.name} does not match either state in its legacy transition journal`,
            );
          }
          const transitionFile = nativeTransitionJournalFile(options.paths, options.name);
          transition = {
            sourceHash: await sha256File(transitionFile),
            targetHash: sha256Text(transitionContent(nextJournal)),
            nextJournal,
          };
        }
        const changeFile = path.join(nativeChangeDir(options.paths, options.name), 'change.yaml');
        const targetContent = stringify(nativeChangeDocument(nextState));
        const journal: NativeSchemaMigrationJournal = {
          schema: 'comet.native.schema-migration.v1',
          id: options.id?.() ?? randomUUID(),
          change: options.name,
          fromSchema: NATIVE_LEGACY_CHANGE_SCHEMA,
          toSchema: NATIVE_CHANGE_SCHEMA,
          sourceHash: await sha256File(changeFile),
          targetHash: sha256Text(targetContent),
          createdAt: (options.now ?? new Date()).toISOString(),
          nextState,
          ...(transition ? { transition } : {}),
        };
        const journalFile = nativeSchemaMigrationJournalFile(options.paths, options.name);
        await resolveContainedNativePath(options.paths.nativeRoot, journalFile);
        await atomicWriteJson(journalFile, journal);
        await options.hooks?.afterPrepared?.(journal);
        const migrated = await continueNativeSchemaMigrationLocked(
          options.paths,
          options.name,
          options.hooks,
        );
        if (!migrated) throw new Error('Native schema migration journal disappeared');
        return migrated;
      },
    ),
  );
}
