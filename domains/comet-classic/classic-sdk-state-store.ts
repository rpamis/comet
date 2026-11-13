import { AsyncLocalStorage } from 'node:async_hooks';
import { readClassicSdkDeliveryCheckpoint } from './classic-sdk-delivery-checkpoint.js';
import { runWithoutClassicOperationObservations } from './classic-command-context.js';
import { isClassicSdkApprovedUpgrade } from './classic-sdk-profile.js';
import {
  isClassicSdkCancellationComplete,
  isUnresolvedClassicArchiveAction,
} from './classic-sdk-run-lifecycle.js';
import { clearCometCurrentSelectionIf } from '../workflow-contract/current-selection.js';
import { observeWorkflowRunStore } from '../workflow-application/run-trace.js';
import { resolveClassicStateFile } from './classic-state-file.js';
import {
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
  ensureWorkspaceRuntimeRoot,
} from '../workflow-contract/workspace-runtime.js';
import { promises as fs } from 'node:fs';

import type { ApplicationIdentity } from '../workflow-application/index.js';
import { hashRuntimeValue } from '../engine/runtime.js';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Document, parseDocument } from 'yaml';
import {
  createFileRuntimeStore,
  createPortableRunCheckpoint,
  portableRunCheckpointProjectionMatches,
  encodePortableRunCheckpoint,
  portableRunCheckpointMatches,
  PORTABLE_RUN_CHECKPOINT_KEY,
  readPortableRunCheckpoint,
  readRuntimeProjection,
  type RuntimeStore,
  type WorkflowRun,
} from '../engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { readClassicProjectFile, writeClassicProjectText } from './classic-protected-path.js';
import {
  inspectClassicArchiveChangeNames,
  inspectClassicStateFileCandidates,
} from './classic-paths.js';
import {
  classicStateToDocument,
  CLASSIC_MANAGED_RUN_MARKER,
  hasClassicManagedRunMarker,
  parseClassicStateDocument,
  type ClassicState,
} from './classic-state.js';
import {
  evaluateBranchBinding,
  liveGitBranch,
  requiresBranchBinding,
} from './classic-branch-binding.js';
const USER_CONFIG_FIELDS = new Set<keyof ClassicState>([
  'language',
  'contextCompression',
  'autoTransition',
  'reviewMode',
]);
export { CLASSIC_MANAGED_RUN_MARKER, hasClassicManagedRunMarker } from './classic-state.js';
/** Read the unprojected local record when repairing an interrupted Run creation. */
export async function readClassicSdkRunRecord(
  projectRoot: string,
  runId: string,
): Promise<WorkflowRun | null> {
  return createFileRuntimeStore<WorkflowRun>({
    singleWriter: true,
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(projectRoot), 'sdk-runs', 'classic'),
  }).read(runId);
}
const deferredProjections = new AsyncLocalStorage<Map<string, () => Promise<unknown>>>();
/** Batch internal SDK transitions; publish before external work and when the CLI returns. */
export async function withClassicStateProjections<T>(work: () => Promise<T>): Promise<T> {
  if (deferredProjections.getStore()) return work();
  const pending = new Map<string, () => Promise<unknown>>();
  return deferredProjections.run(pending, async () => {
    const flush = async () => {
      const errors: unknown[] = [];
      for (const publish of pending.values()) {
        try {
          await publish();
        } catch (error) {
          errors.push(error);
        }
      }
      return errors;
    };
    let result: T;
    try {
      result = await work();
    } catch (error) {
      for (const failure of await flush())
        process.stderr.write(
          '[comet] projection cleanup failed; preserved the original operation error: ' +
            String(failure) +
            '\n',
        );
      throw error;
    }
    const errors = await flush();
    for (const failure of errors.slice(1))
      process.stderr.write('[comet] projection publish failed: ' + String(failure) + '\n');
    if (errors.length) throw errors[0];
    return result;
  });
}
function classicProjectionBoundary(run: WorkflowRun): boolean {
  return (
    ['completed', 'cancelled', 'failed'].includes(run.status) ||
    run.waits.some((wait) => wait.status === 'pending') ||
    run.actions.some(
      (action) =>
        ['pending', 'running', 'unknown'].includes(action.status) &&
        (action.type === 'invoke_skill' ||
          action.status === 'unknown' ||
          (action.type === 'call_tool' &&
            !['classic-open-revalidate', 'classic-archive-preflight'].includes(action.ref ?? ''))),
    )
  );
}
function equal(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}
function changedFields(before: ClassicState, after: ClassicState): Array<keyof ClassicState> {
  return (Object.keys(before) as Array<keyof ClassicState>).filter(
    (field) => !equal(before[field], after[field]),
  );
}
function archiveMoveIsUnresolved(run: WorkflowRun): boolean {
  return run.actions.some(isUnresolvedClassicArchiveAction);
}
/** Keep Classic's user-editable YAML at its established path while the SDK owns transitions. */
export function createClassicSdkStateStore(
  projectRoot: string,
  options: {
    store?: RuntimeStore<WorkflowRun>;
    identity?: ApplicationIdentity;
    readOnly?: boolean;
    allowBranchRebind?: boolean;
  } = {},
  projectionRead = false,
): RuntimeStore<WorkflowRun> {
  const initialRuntimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
  let runtimePrepared = false;
  const boundRuntimeRoot = async (readOnly = options.readOnly) => {
    if (!readOnly && resolveWorkspaceRuntimeRootSync(projectRoot) !== initialRuntimeRoot)
      throw new Error(
        'Classic SDK workspace identity changed; reload the store in the current workspace',
      );
    if (!readOnly && !runtimePrepared) {
      await ensureWorkspaceRuntimeRoot(projectRoot);
      runtimePrepared = true;
    }
    return initialRuntimeRoot;
  };
  const store = observeWorkflowRunStore(
    projectRoot,
    'classic',
    options.store ??
      createFileRuntimeStore<WorkflowRun>({
        singleWriter: true,
        rootDir: path.join(initialRuntimeRoot, 'sdk-runs', 'classic'),
      }),
  );
  const projectionKey = (runId: string) => JSON.stringify([initialRuntimeRoot, runId]);
  function recoveryRequired(runId: string, reason: string): never {
    if (options.identity) {
      const argv = [
        'runtime',
        'dispatch',
        '--application-file',
        path.join(options.identity.packageRoot, 'application.json'),
        '--project-root',
        projectRoot,
        '--request',
        '<recovery-request.json>',
        '--json',
      ];
      throw new Error(
        `Classic SDK Run ${runId} requires recovery: ${reason}. Save the recovery request JSON to a file and replace <recovery-request.json> with its path. Run comet with the exact argument array below to restore the recorded state and advance only the Runtime, without executing host work.\nRecovery argv: ${JSON.stringify(argv)}\nRecovery request: ${JSON.stringify({ operation: 'next', runId })}`,
      );
    }
    const recovery = `Run comet state next ${runId} --json`;
    throw new Error(
      `Classic SDK Run ${runId} requires recovery: ${reason}. ${recovery} in ${projectRoot} to restore or synchronize its recorded state.`,
    );
  }
  async function recoverFromPortableFile(
    runId: string,
    interrupted?: WorkflowRun,
  ): Promise<WorkflowRun | null> {
    let found: {
      file: string;
      source: string;
    } | null = null;
    for (const file of await inspectClassicStateFileCandidates(projectRoot, runId)) {
      let source: string;
      try {
        source = await readClassicProjectFile(projectRoot, file, { label: 'Classic state file' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (!hasClassicManagedRunMarker(source)) continue;
      if (found) throw new Error(`Classic change ${runId} has multiple SDK state files`);
      found = { file, source };
    }
    if (!found) return null;
    const document = parseDocument(found.source, { uniqueKeys: true });
    if (document.errors.length > 0) {
      throw new Error(`Invalid Classic state file: ${document.errors[0].message}`);
    }
    const data = document.toJS() as Record<string, unknown>;
    const saved = readPortableRunCheckpoint(data[PORTABLE_RUN_CHECKPOINT_KEY], runId, {
      preserveSourceRevision: true,
    });
    if (!saved) return null;
    if (
      hashRuntimeValue((data.application_checkpoint ?? null) as never) !==
      hashRuntimeValue((options.identity ?? null) as never)
    ) {
      throw new Error(
        'Classic portable checkpoint requires its original fixed Application package',
      );
    }
    const state = parseClassicStateDocument(data).classic;
    const input = saved.input as {
      change?: unknown;
      changeDir?: unknown;
    } | null;
    const profile = saved.workflow.id.replace(/^comet-classic-/u, '');
    const edits = state ? changedFields(saved.state as unknown as ClassicState, state) : [];
    const expectedActive =
      typeof input?.changeDir === 'string'
        ? await resolveClassicStateFile(path.join(projectRoot, ...input.changeDir.split('/')))
        : null;
    const archivedLocation = expectedActive !== null && found.file !== expectedActive;
    if (
      !state ||
      edits.some((field) => !USER_CONFIG_FIELDS.has(field)) ||
      input?.change !== runId ||
      (input.changeDir !== `openspec/changes/${runId}` &&
        input.changeDir !== `docs/openspec/changes/${runId}`) ||
      (archivedLocation && !state.archived && !archiveMoveIsUnresolved(saved)) ||
      !['full', 'hotfix', 'tweak'].includes(profile) ||
      saved.workflow.id !== `comet-classic-${profile}` ||
      (state.workflow !== profile && !isClassicSdkApprovedUpgrade(saved, profile)) ||
      (!options.allowBranchRebind &&
        state.boundBranch !== null &&
        state.boundBranch !== liveGitBranch(projectRoot))
    ) {
      throw new Error(`Classic portable Run checkpoint for ${runId} does not match its state`);
    }
    const revision = saved.revision;
    const restored: WorkflowRun = {
      ...saved,
      revision,
      ...(interrupted ? { state: state as unknown as WorkflowRun['state'] } : {}),
    };
    if (
      interrupted &&
      hashRuntimeValue(interrupted) !== hashRuntimeValue({ ...restored, revision: 1 })
    ) {
      throw new Error(
        `Classic SDK Run ${runId} differs from the interrupted checkpoint import; preserve the local records and restore matching Run history before continuing`,
      );
    }
    if ((revision > 1 || interrupted) && !store.restoreCheckpoint) {
      throw new Error(
        `Classic RuntimeStore cannot restore checkpoint revision ${revision}; use a store with restoreCheckpoint support or restore the original Run history`,
      );
    }
    await registerSdkChangeOwner(projectRoot, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'classic',
      change: runId,
      format: 'sdk',
      application: options.identity?.id ?? `classic-${profile}`,
      runId,
    });
    if (revision === 1 && !interrupted) await store.compareAndSwap(runId, null, restored);
    else await store.restoreCheckpoint!(runId, interrupted ? 1 : null, restored);
    return store.read(runId);
  }
  async function stateFile(run: WorkflowRun): Promise<string | null> {
    const input = run.input as {
      change?: unknown;
      changeDir?: unknown;
    } | null;
    if (input?.change !== run.runId || typeof input.changeDir !== 'string') {
      throw new Error(`Classic SDK Run ${run.runId} has invalid change identity`);
    }
    const relative = input.changeDir.replaceAll('\\', '/');
    if (
      relative !== `openspec/changes/${run.runId}` &&
      relative !== `docs/openspec/changes/${run.runId}`
    ) {
      throw new Error(`Classic SDK Run ${run.runId} has invalid change directory`);
    }
    const active = path.join(projectRoot, ...relative.split('/'));
    try {
      if ((await fs.stat(active)).isDirectory()) return resolveClassicStateFile(active);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!(run.state as unknown as ClassicState).archived && !archiveMoveIsUnresolved(run))
      return null;
    const archiveDir = path.join(path.dirname(active), 'archive');
    const entries = await inspectClassicArchiveChangeNames(projectRoot, archiveDir, run.runId);
    if (entries === null) return null;
    const archives = entries.filter((name) => name !== run.runId);
    if (archives.length !== 1) throw new Error(`Classic SDK Archive ${run.runId} is ambiguous`);
    return resolveClassicStateFile(path.join(archiveDir, archives[0]));
  }
  async function syncStateFile(
    runId: string,
    importUserEdits: boolean,
  ): Promise<WorkflowRun | null> {
    await inspectClassicStateFileCandidates(projectRoot, runId);
    await boundRuntimeRoot();
    const synchronize = async () => {
      let loaded: WorkflowRun | null;
      if (projectionRead) {
        try {
          loaded = (await readRuntimeProjection(store, runId)).record;
        } catch (error) {
          if (
            (
              error as {
                code?: string;
              }
            ).code !== 'RUN_NOT_FOUND'
          )
            throw error;
          loaded = null;
        }
      } else loaded = await store.read(runId);
      if (!loaded) {
        if (options.readOnly) recoveryRequired(runId, 'the recorded Run is missing or incomplete');
        const recovered = await runWithoutClassicOperationObservations(() =>
          recoverFromPortableFile(runId, loaded ?? undefined),
        );
        if (loaded && !recovered) {
          throw new Error(
            `Classic SDK Run ${runId} requires its matching portable checkpoint or original Run history before completing recovery`,
          );
        }
        loaded = recovered;
      }
      if (!loaded) return null;
      let run: WorkflowRun = loaded;
      let state = run.state as unknown as ClassicState;
      const file = await stateFile(run);
      const unpublishedStart =
        run.revision === 1 &&
        run.actions.every((action) => action.status === 'pending' && !action.claim);
      if (!file) {
        // 原始 SDK start 尚未创建文档目录时允许只读查看；已有投影仍需显式恢复。
        if (options.readOnly && !unpublishedStart)
          recoveryRequired(runId, 'the change directory is missing');
        return run; // Creation can commit before the change directory exists.
      }
      let source: string | null;
      try {
        source = await readClassicProjectFile(projectRoot, file, { label: 'Classic state file' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        source = null;
      }
      const document =
        source === null ? new Document() : parseDocument(source, { uniqueKeys: true });
      if (document.errors.length > 0)
        throw new Error(`Invalid Classic state file: ${document.errors[0].message}`);
      const documentData = document.toJS() as Record<string, unknown>;
      const fileState = source === null ? null : parseClassicStateDocument(documentData).classic;
      const deliveryCheckpoint = readClassicSdkDeliveryCheckpoint(
        documentData?.[PORTABLE_RUN_CHECKPOINT_KEY],
        run,
        { projection: projectionRead },
      );
      if (deliveryCheckpoint) {
        // Git 已交付的归档保存交付前基线；最终 commit 不能写回它自己的提交内容。
        // 只有完整历史与原基线一致的 delivery 后续状态才使用权威 Runtime 回执。
        if (
          source === null ||
          !hasClassicManagedRunMarker(source) ||
          !equal(fileState, deliveryCheckpoint.state) ||
          (options.identity && !equal(documentData.application_checkpoint, options.identity))
        ) {
          recoveryRequired(runId, 'the immutable archived delivery checkpoint has changed');
        }
        return run;
      }
      if (fileState) {
        const checkpoint = readPortableRunCheckpoint(
          documentData?.[PORTABLE_RUN_CHECKPOINT_KEY],
          runId,
          { preserveSourceRevision: true },
        );
        if (run.revision === 1 && checkpoint && checkpoint.revision > run.revision) {
          if (options.readOnly)
            recoveryRequired(runId, 'the initial checkpoint import is incomplete');
          const recovered = await recoverFromPortableFile(runId, run);
          if (!recovered) recoveryRequired(runId, 'the initial checkpoint import is incomplete');
          run = recovered;
          state = run.state as unknown as ClassicState;
        }
        const base = (checkpoint?.state as unknown as ClassicState | undefined) ?? state;
        const edits = changedFields(base, fileState);
        if (edits.some((field) => !USER_CONFIG_FIELDS.has(field))) {
          const recoveryHash = (
            run.input as {
              recoverySourceHash?: unknown;
            } | null
          )?.recoverySourceHash;
          const matchesRecoverySource =
            run.revision === 1 &&
            typeof recoveryHash === 'string' &&
            source !== null &&
            createHash('sha256').update(source).digest('hex') === recoveryHash;
          if (!equal(fileState, state) && !matchesRecoverySource) {
            throw new Error(`Classic state file ${file} changed a Runtime-owned field`);
          }
        } else if (edits.some((field) => !equal(state[field], fileState[field]))) {
          if (!importUserEdits) {
            throw new Error(`Classic state file ${file} changed during an SDK transition`);
          }
          for (const field of edits) {
            if (!equal(state[field], base[field]) && !equal(state[field], fileState[field])) {
              throw new Error(`Classic state file ${file} conflicts with SDK field ${field}`);
            }
          }
          if (options.readOnly)
            recoveryRequired(runId, 'state file settings have not been imported');
          state = { ...state };
          for (const field of edits) {
            (state as unknown as Record<string, unknown>)[field] = fileState[field];
          }
          const next: WorkflowRun = {
            ...run,
            revision: run.revision + 1,
            state: state as unknown as WorkflowRun['state'],
          };
          await runWithoutClassicOperationObservations(() =>
            inspectClassicStateFileCandidates(projectRoot, runId),
          );
          if (!(await store.compareAndSwap(runId, run.revision, next))) {
            throw new Error(`Classic SDK Run ${runId} changed while importing state file settings`);
          }
          run = next;
        }
      }
      // A change created outside Git can acquire a branch later. Bind the
      // SDK Run itself before projecting YAML; healing only .comet.yaml would
      // leave the portable checkpoint and all SDK guards out of agreement.
      // This block only heals missing bindings. Guards still probe the live
      // branch separately when rejecting drift; projection reads do not.
      if (
        fileState &&
        state.boundBranch === null &&
        requiresBranchBinding(state.isolation) &&
        !state.archived &&
        ['running', 'waiting'].includes(run.status) &&
        !run.actions.some((action) => ['running', 'unknown'].includes(action.status))
      ) {
        const binding = evaluateBranchBinding({
          isolation: state.isolation,
          boundBranch: state.boundBranch,
          currentBranch: liveGitBranch(projectRoot),
        });
        if (binding.status === 'needs-heal') {
          if (options.readOnly)
            recoveryRequired(runId, 'the Git branch binding has not been recorded');
          state = { ...state, boundBranch: binding.branch };
          const next: WorkflowRun = {
            ...run,
            revision: run.revision + 1,
            state: state as unknown as WorkflowRun['state'],
          };
          await runWithoutClassicOperationObservations(() =>
            inspectClassicStateFileCandidates(projectRoot, runId),
          );
          if (!(await store.compareAndSwap(runId, run.revision, next))) {
            throw new Error(`Classic SDK Run ${runId} changed while binding its Git branch`);
          }
          run = next;
        }
      }
      if (options.readOnly) {
        const checkpoint = documentData?.[PORTABLE_RUN_CHECKPOINT_KEY];
        let checkpointMatches = checkpoint === undefined;
        if (checkpoint !== undefined && projectionRead) {
          checkpointMatches = portableRunCheckpointProjectionMatches(checkpoint, run);
        } else if (checkpoint !== undefined) {
          checkpointMatches = portableRunCheckpointMatches(
            checkpoint,
            createPortableRunCheckpoint(run),
          );
        }
        // 初次创建尚未写入辅助 checkpoint 时，直接核对权威 Run 与状态文件。
        // 已存在的 checkpoint 仍需一致；诊断读取不补写缺失内容。
        if (
          source === null ||
          !hasClassicManagedRunMarker(source) ||
          !fileState ||
          !equal(fileState, state) ||
          !checkpointMatches ||
          (options.identity &&
            documentData.application_checkpoint !== undefined &&
            !equal(documentData.application_checkpoint, options.identity))
        ) {
          recoveryRequired(
            runId,
            'the state projection or portable checkpoint is missing or stale',
          );
        }
        return run;
      }
      const target = classicStateToDocument(state);
      const current = documentData ?? {};
      for (const [key, value] of Object.entries(target)) {
        if (equal(current[key], value)) continue;
        if (value === undefined) document.delete(key);
        else document.set(key, value);
      }
      const encodedCheckpoint = encodePortableRunCheckpoint(createPortableRunCheckpoint(run));
      if (!equal(current[PORTABLE_RUN_CHECKPOINT_KEY], encodedCheckpoint))
        document.set(PORTABLE_RUN_CHECKPOINT_KEY, encodedCheckpoint);
      if (options.identity && !equal(current.application_checkpoint, options.identity))
        document.set('application_checkpoint', options.identity);
      const raw = document.toString();
      const rendered = hasClassicManagedRunMarker(raw) ? raw : CLASSIC_MANAGED_RUN_MARKER + raw;
      if (source !== rendered) {
        await writeClassicProjectText(projectRoot, file, rendered, {
          label: 'Classic state file',
        });
      }
      if (isClassicSdkCancellationComplete(run)) {
        if (!options.identity)
          await clearCometCurrentSelectionIf(projectRoot, 'classic', run.runId);
      }
      return run;
    };
    return synchronize();
  }
  return {
    queryScope: store.queryScope,
    async read(runId) {
      if (!options.identity && deferredProjections.getStore()?.has(projectionKey(runId))) {
        await boundRuntimeRoot(true);
        return store.read(runId);
      }
      if (!options.readOnly) {
        await boundRuntimeRoot(true);
        try {
          const run = await createClassicSdkStateStore(projectRoot, {
            ...options,
            store,
            readOnly: true,
          }).read(runId);
          if (run && !isClassicSdkCancellationComplete(run)) {
            return run;
          }
        } catch {
          // 需要修复或导入设置时，在写锁内重新读取并执行原校验。
        }
      }
      return syncStateFile(runId, true);
    },
    async readProjection(runId) {
      await boundRuntimeRoot(true);
      const run = await createClassicSdkStateStore(
        projectRoot,
        { ...options, store, readOnly: true },
        true,
      ).read(runId);
      await boundRuntimeRoot(true);
      return run;
    },
    async compareAndSwap(runId, expectedRevision, next) {
      return runWithoutClassicOperationObservations(async () => {
        if (options.readOnly) throw new Error('Classic SDK read-only store cannot change a Run');
        if (next.status === 'cancelled' && expectedRevision !== null) {
          const original = await store.read(runId);
          if (original && archiveMoveIsUnresolved(original)) {
            throw new Error(
              `Classic Archive must finish or recover before cancelling this Run; preserve its original Action and use comet state check ${runId} archive --recover --json to inspect the recovery path.`,
            );
          }
        }
        await inspectClassicStateFileCandidates(projectRoot, runId);
        // 原始 SDK start 允许省略 input.change；后续投影仍校验完整身份。
        if (expectedRevision !== null) await stateFile(next);
        await boundRuntimeRoot();
        const committed = await store.compareAndSwap(runId, expectedRevision, next);
        if (committed && expectedRevision !== null) {
          const deferred = deferredProjections.getStore();
          const key = projectionKey(runId);
          if (
            deferred &&
            !options.identity &&
            next.workflow.version === '2' &&
            !classicProjectionBoundary(next)
          ) {
            deferred.set(key, () => syncStateFile(runId, false));
          } else {
            deferred?.delete(key);
            await syncStateFile(runId, false);
          }
        }
        return committed;
      });
    },
  };
}
