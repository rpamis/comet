import path from 'node:path';
import { createFileRuntimeStore, type WorkflowRun } from '../engine/runtime.js';
import {
  listSdkChangePartitions,
  readSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { resolveWorkspaceRuntimeRootSync } from '../workflow-contract/workspace-runtime.js';
import { mapWithConcurrency } from './native-concurrency.js';

/** 历史 owner 只提供身份；Store 的封存元数据决定是否可以跳过历史正文。 */
export async function listNativeSdkHistoryPartitions(
  projectRoot: string,
): Promise<{ active: string[]; history: string[] }> {
  const partitions = await listSdkChangePartitions(projectRoot, 'native', { readOnly: true });
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'native'),
  });
  const dispositions = await mapWithConcurrency(partitions.history, 4, (name) =>
    store.readPartitionMetadata(name),
  );
  for (const [index, name] of partitions.history.entries()) {
    if (dispositions[index] !== 'closed')
      throw new Error(
        `Native history partition for ${name} is ${dispositions[index]}; run comet native doctor ${name} --migrate-history --json to inspect and finish migration`,
      );
  }
  // 活动 owner 可能处于关闭事务的中断点；不能再被旧的“取消已完成”过滤隐藏。
  await mapWithConcurrency(partitions.active, 4, async (name) => {
    const owner = await readSdkChangeOwner(projectRoot, 'native', name, { readOnly: true });
    if (owner?.application !== 'native') return;
    const disposition = await store.readPartitionMetadata(name);
    if (disposition === 'closing' || disposition === 'reopening')
      throw new Error(
        `Native Run ${name} has an unfinished ${disposition} transaction; run comet native doctor ${name} --migrate-history --json`,
      );
  });
  return partitions;
}
