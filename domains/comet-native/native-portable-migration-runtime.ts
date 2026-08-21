import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';

import { atomicWriteJson } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { inspectNativeChangeStateDocument, nativeChangeDir } from './native-change.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  migrateNativeLegacyStateToPortable,
  NATIVE_PORTABLE_MIGRATION_TRANSACTION_SCHEMA,
  nextNativePortableMigrationStep,
  type NativePortableMigrationTransaction,
} from './native-portable-migration.js';
import {
  nativePortableTransactionFile,
  readNativePortableTransaction,
} from './native-portable-transactions.js';
import {
  buildNativePortableAcceptance,
  type NativePortableAcceptanceCriterion,
} from './native-portable-acceptance.js';
import {
  isNativePortableChange,
  nativeLocalExecutionFile,
  nativePortableStateFile,
} from './native-portable-runtime.js';
import { readNativePortableState, writeNativePortableState } from './native-portable-state.js';
import {
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import { nativeLegacyChangeRuntimeDir, nativePreferredChangeRuntimeDir } from './native-paths.js';
import type { NativePortableState, NativePortableWorkspace } from './native-portable-types.js';
import type { NativeProjectPaths, NativeReadableChangeState } from './native-types.js';
import { readNativeWorkspaceIdentity } from './native-workspace.js';

const LEGACY_PROJECTION_FILES = [
  'evidence.md',
  'repair.md',
  'archive.md',
  'checkpoint.md',
] as const;

const LEGACY_VERIFICATION_REPORT = 'verification.md';

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function hasIncompleteNativePortableMigration(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  const changeDir = nativeChangeDir(paths, name);
  const artifacts = [
    nativePortableTransactionFile(paths, { kind: 'migration', change: name }),
    nativeLegacyChangeRuntimeDir(paths, name),
    ...LEGACY_PROJECTION_FILES.map((file) => path.join(changeDir, file)),
  ];
  return (await Promise.all(artifacts.map(exists))).some(Boolean);
}

async function readTransaction(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativePortableMigrationTransaction | null> {
  const transaction = await readNativePortableTransaction(paths, {
    kind: 'migration',
    change: name,
  });
  return transaction?.kind === 'migration' ? transaction.journal : null;
}

async function writeTransaction(
  paths: NativeProjectPaths,
  transaction: NativePortableMigrationTransaction,
): Promise<void> {
  await fs.mkdir(paths.transactionsDir, { recursive: true });
  await atomicWriteJson(
    nativePortableTransactionFile(paths, { kind: 'migration', change: transaction.change }),
    transaction,
    { containedRoot: paths.runtimeDir },
  );
}

async function cleanupLegacyMigrationArtifacts(
  paths: NativeProjectPaths,
  name: string,
  options: { removeVerificationReport?: boolean } = {},
): Promise<void> {
  const projectionFiles =
    options.removeVerificationReport === false
      ? LEGACY_PROJECTION_FILES
      : [...LEGACY_PROJECTION_FILES, LEGACY_VERIFICATION_REPORT];
  await Promise.all([
    fs.rm(nativePreferredChangeRuntimeDir(paths, name), {
      recursive: true,
      force: true,
    }),
    fs.rm(nativeLegacyChangeRuntimeDir(paths, name), {
      recursive: true,
      force: true,
    }),
    ...projectionFiles.map((file) =>
      fs.rm(path.join(nativeChangeDir(paths, name), file), { force: true }),
    ),
  ]);
}

async function rebuildLocalExecution(
  paths: NativeProjectPaths,
  portable: NativePortableState,
): Promise<void> {
  await writeNativeLocalExecution(
    nativeLocalExecutionFile(paths, portable.name),
    rebuildNativeLocalExecution({
      portableState: portable,
      projectRoot: paths.projectRoot,
    }),
    { containedRoot: paths.runtimeDir },
  );
}

async function legacyWorkspace(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativePortableWorkspace> {
  try {
    const workspace = await readNativeWorkspaceIdentity(paths, name);
    if (workspace?.schema === 'comet.native.workspace.v3') {
      return {
        isolation: workspace.isolation,
        change_branch: workspace.changeBranch,
        target_branch: workspace.targetBranch,
        finish: workspace.finish,
      };
    }
  } catch {
    // Legacy Runtime is optional migration input. Missing or malformed local
    // identity cannot block deterministic portable recovery.
  }
  return { isolation: 'current', change_branch: null, target_branch: null, finish: null };
}

function assertMigrationWorkspaceCurrent(
  paths: NativeProjectPaths,
  workspace: NativePortableWorkspace,
): void {
  if (workspace.isolation === 'current' && workspace.change_branch === null) return;
  const inspection = inspectGitWorktree(paths.projectRoot);
  if (!inspection.isGitWorktree) {
    throw new Error('Native legacy migration requires its bound Git branch or worktree');
  }
  if (inspection.currentBranch !== workspace.change_branch) {
    throw new Error(
      `Native legacy migration expected branch ${workspace.change_branch ?? '(missing)'}, current branch is ${inspection.currentBranch ?? '(detached)'}`,
    );
  }
  if (workspace.isolation === 'worktree' && !inspection.isSecondaryWorktree) {
    throw new Error('Native legacy migration requires its bound linked worktree');
  }
}

async function migrationAcceptance(options: {
  paths: NativeProjectPaths;
  state: NativeReadableChangeState;
}): Promise<NativePortableAcceptanceCriterion[]> {
  const changeDir = nativeChangeDir(options.paths, options.state.name);
  const brief = await readNativeBoundedTextFile({
    root: changeDir,
    ref: options.state.brief,
    maxBytes: null,
    includeHash: false,
  });
  const specs = [];
  for (const change of options.state.spec_changes) {
    if (change.operation === 'remove' || !change.source) continue;
    const source = await readNativeBoundedTextFile({
      root: changeDir,
      ref: change.source,
      maxBytes: null,
      includeHash: false,
    });
    specs.push({ capability: change.capability, source: source.ref, markdown: source.text });
  }
  try {
    return buildNativePortableAcceptance({ briefMarkdown: brief.text, specs });
  } catch (error) {
    if (
      options.state.phase === 'shape' &&
      (error as Error).message.includes('at least one acceptance')
    ) {
      return [];
    }
    throw error;
  }
}

async function inspectLegacyState(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeReadableChangeState> {
  const inspection = await inspectNativeChangeStateDocument(paths, name);
  if (!inspection.state) throw new Error(`Native legacy change ${name} is unreadable`);
  return inspection.state;
}

export async function migrateNativeLegacyChangeToPortable(options: {
  paths: NativeProjectPaths;
  name: string;
  now?: Date;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `migrate ${options.name} to portable Native`,
    async () => {
      let transaction = await readTransaction(options.paths, options.name);
      let portable = (await isNativePortableChange(options.paths, options.name))
        ? await readNativePortableState(nativePortableStateFile(options.paths, options.name))
        : null;
      if (!transaction && portable) {
        // The portable YAML is the durable migration boundary. If its journal was
        // lost after that write, finish the deterministic cleanup and recreate the
        // disposable local overlay instead of mistaking the migration for complete.
        await cleanupLegacyMigrationArtifacts(options.paths, options.name, {
          removeVerificationReport: false,
        });
        await rebuildLocalExecution(options.paths, portable);
        return portable;
      }

      let legacy: NativeReadableChangeState | null = null;
      let workspace: NativePortableWorkspace | null = null;
      if (!transaction) {
        legacy = await inspectLegacyState(options.paths, options.name);
        workspace = await legacyWorkspace(options.paths, options.name);
        assertMigrationWorkspaceCurrent(options.paths, workspace);
        transaction = {
          schema: NATIVE_PORTABLE_MIGRATION_TRANSACTION_SCHEMA,
          id: randomUUID(),
          change: legacy.name,
          fromSchema: legacy.schema,
          status: 'prepared',
          createdAt: (options.now ?? new Date()).toISOString(),
        };
        await writeTransaction(options.paths, transaction);
      }

      for (;;) {
        const step = nextNativePortableMigrationStep(transaction);
        if (step.action === 'done') break;
        if (step.action === 'commit-portable-yaml') {
          if (!portable) {
            legacy ??= await inspectLegacyState(options.paths, options.name);
            workspace ??= await legacyWorkspace(options.paths, options.name);
            assertMigrationWorkspaceCurrent(options.paths, workspace);
            portable = migrateNativeLegacyStateToPortable({
              state: legacy,
              acceptance: await migrationAcceptance({ paths: options.paths, state: legacy }),
              workspace,
              migratedAt: options.now,
            });
            await writeNativePortableState(
              nativePortableStateFile(options.paths, options.name),
              portable,
              {
                containedRoot: options.paths.nativeRoot,
              },
            );
          }
        } else if (step.action === 'cleanup-legacy-runtime') {
          await cleanupLegacyMigrationArtifacts(options.paths, options.name);
        } else if (step.action === 'commit-transaction') {
          portable ??= await readNativePortableState(
            nativePortableStateFile(options.paths, options.name),
          );
          await rebuildLocalExecution(options.paths, portable);
        }
        transaction = {
          ...transaction,
          status: step.nextStatus!,
        };
        await writeTransaction(options.paths, transaction);
      }

      await fs.rm(
        nativePortableTransactionFile(options.paths, {
          kind: 'migration',
          change: options.name,
        }),
        { force: true },
      );
      return (
        portable ?? readNativePortableState(nativePortableStateFile(options.paths, options.name))
      );
    },
    { allowedPortableTransaction: { kind: 'migration', change: options.name } },
  );
}
