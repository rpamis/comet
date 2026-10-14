import path from 'node:path';
import {
  listFileRuntimeStoreRuns,
  listFileRuntimeStoreRunSources,
  createFileRuntimeStore,
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

export async function listCreatorRunSources(projectRoot: string) {
  const result = [];
  for (const root of await readWorkspaceRuntimeRoots(projectRoot)) {
    for (const source of await listFileRuntimeStoreRunSources({
      rootDir: path.join(root, 'creator'),
    }))
      result.push({ ...source, rootDir: path.join(root, 'creator') });
  }
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
