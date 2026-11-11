import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { importLegacyBusinessFile } from '../workflow-contract/legacy-runtime-import.js';
import { ensureWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import { atomicWriteJson } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import {
  inspectNativeChangeStateDocument,
  nativeChangeDir,
  NativeRuntimeCompatibilityError,
} from './native-change.js';
import { withNativeMutation } from './native-mutation.js';
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
import { isNativePortableChange, nativePortableStateFile } from './native-portable-storage.js';
import { readNativePortableState, writeNativePortableState } from './native-portable-state.js';
import { nativeLegacyChangeRuntimeDir, nativePreferredChangeRuntimeDir } from './native-paths.js';
import type { NativePortableState, NativePortableWorkspace } from './native-portable-types.js';
import type { NativeProjectPaths, NativeReadableChangeState } from './native-types.js';
import { readNativeWorkspaceIdentity } from './native-workspace.js';
import { continueNativeTransitionLocked } from './native-transition-journal.js';
export async function hasIncompleteNativePortableMigration(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  return (await readTransaction(paths, name)) !== null;
}
export async function importLegacyNativeChangeBusinessData(
  paths: NativeProjectPaths,
  name: string,
): Promise<void> {
  await ensureWorkspaceRuntimeRoot(paths.projectRoot);
  const source = nativeLegacyChangeRuntimeDir(paths, name),
    target = nativePreferredChangeRuntimeDir(paths, name);
  for (const file of ['workspace.json', 'supervisor/state.json'])
    await importLegacyBusinessFile(
      paths.projectRoot,
      path.relative(paths.projectRoot, path.join(source, file)).replaceAll('\\', '/'),
      paths.workspaceRuntimeRoot,
      path.relative(paths.workspaceRuntimeRoot, path.join(target, file)).replaceAll('\\', '/'),
    );
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
  if (inspection.status === 'runtime-incompatible') {
    throw new NativeRuntimeCompatibilityError(inspection.schema, inspection.minimumRuntimeVersion);
  }
  if (!inspection.state) throw new Error(`Native legacy change ${name} is unreadable`);
  return inspection.state;
}
export async function migrateNativeLegacyChangeToPortable(options: {
  paths: NativeProjectPaths;
  name: string;
  now?: Date;
}): Promise<NativePortableState> {
  await importLegacyNativeChangeBusinessData(options.paths, options.name);
  return withNativeMutation(
    options.paths,
    async () => {
      let transaction = await readTransaction(options.paths, options.name);
      let portable = (await isNativePortableChange(options.paths, options.name))
        ? await readNativePortableState(nativePortableStateFile(options.paths, options.name))
        : null;
      if (!transaction && !portable)
        await (() => continueNativeTransitionLocked(options.paths, options.name))();
      if (!transaction && portable) {
        // 已提交的业务状态直接复用；保留原文件，不按名称删除正文。

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
          portable ??= await readNativePortableState(
            nativePortableStateFile(options.paths, options.name),
          );
        } else if (step.action === 'commit-transaction') {
          portable ??= await readNativePortableState(
            nativePortableStateFile(options.paths, options.name),
          );
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
