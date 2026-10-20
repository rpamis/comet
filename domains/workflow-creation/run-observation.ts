import path from 'node:path';
import {
  listFileRuntimeStoreRuns,
  iterateFileRuntimeStoreRunSources,
  createFileRuntimeStore,
  readRuntimeProjection,
  parseWorkflowRun,
  type WorkflowRun,
} from '../engine/runtime.js';
import { readWorkspaceRuntimeRoots } from '../workflow-contract/workspace-runtime.js';

export interface CreatorRunObservation {
  storageKey: string;
  runId: string | null;
  run: WorkflowRun | null;
  error: { code: string; message: string } | null;
}

export async function* iterateCreatorRunSources(projectRoot: string) {
  for (const root of await readWorkspaceRuntimeRoots(projectRoot)) {
    for await (const source of iterateFileRuntimeStoreRunSources({
      rootDir: path.join(root, 'creator'),
    }))
      yield { ...source, rootDir: path.join(root, 'creator') };
  }
}

export async function listCreatorRunSources(projectRoot: string) {
  const result = [];
  for await (const source of iterateCreatorRunSources(projectRoot)) result.push(source);
  return result;
}

/** 观测不创建 Creator Runtime，避免 inspect 触发工作区迁移。 */
export async function listCreatorRunRecords(projectRoot: string): Promise<CreatorRunObservation[]> {
  const roots = (await readWorkspaceRuntimeRoots(projectRoot)).map((root) =>
    path.join(root, 'creator'),
  );
  const entries = new Map<string, CreatorRunObservation>();
  for (const rootDir of roots)
    for (const item of await listFileRuntimeStoreRuns<WorkflowRun>({ rootDir })) {
      const key = item.runId ?? item.storageKey;
      const previous = entries.get(key);
      let error = item.error;
      let run = item.record;
      try {
        if (previous) throw new Error('新旧 Creator Runtime 同时存在，拒绝选择写入权威');
        if (run) {
          run = parseWorkflowRun(run, item.runId!);
          if (run.workflow.id !== 'comet-creator') throw new Error('记录不是 Creator Run');
        }
      } catch (cause) {
        error = {
          code: 'CREATOR_UNREADABLE',
          message: cause instanceof Error ? cause.message : String(cause),
        };
        run = null;
      }
      entries.set(key, { storageKey: item.storageKey, runId: item.runId, run, error });
    }
  return [...entries.values()];
}

export async function readCreatorRunRecord(
  projectRoot: string,
  runId: string,
): Promise<WorkflowRun | null> {
  const roots = await readWorkspaceRuntimeRoots(projectRoot);
  const found = (
    await Promise.all(
      roots.map((root) =>
        createFileRuntimeStore<WorkflowRun>({ rootDir: path.join(root, 'creator') }).read(runId),
      ),
    )
  ).filter((r): r is WorkflowRun => r !== null);
  if (found.length > 1) throw new Error('新旧 Creator Runtime 同时存在，拒绝选择写入权威');
  const run = found[0] ? parseWorkflowRun(found[0], runId) : null;
  if (run && run.workflow.id !== 'comet-creator') throw new Error('记录不是 Creator Run');
  return run;
}

/** 只读紧凑投影，历史载荷按需物化。 */
export async function readCreatorRunProjection(projectRoot: string, runId: string) {
  const found = [];
  for (const root of await readWorkspaceRuntimeRoots(projectRoot)) {
    const projection = await readRuntimeProjection(
      createFileRuntimeStore<WorkflowRun>({ rootDir: path.join(root, 'creator') }),
      runId,
    ).catch((error) => {
      if (error?.code === 'RUN_NOT_FOUND') return null;
      throw error;
    });
    if (projection) found.push(projection);
  }
  if (found.length > 1) throw new Error('新旧 Creator Runtime 同时存在，拒绝选择读取权威');
  const projection = found[0] ?? null;
  if (projection && projection.run.workflow.id !== 'comet-creator')
    throw new Error('记录不是 Creator Run');
  return projection;
}
