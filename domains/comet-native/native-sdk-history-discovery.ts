import { promises as fs } from 'node:fs';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import path from 'node:path';
import {
  runWithHookReadCache,
  runWithoutHookReadCache,
} from '../../platform/process/hook-read-cache.js';
import { createFileRuntimeStore, type WorkflowRun } from '../engine/runtime.js';
import {
  listSdkChangePartitions,
  inspectSdkChangeOwnerPartitions,
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
    singleWriter: true,
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'native'),
  });
  // 每次重新观察封存元数据，仅在本批内部共享路径校验。owner 的已验证结果仍
  // 留在调用方请求中供后续活动任务检查复用，不把整次发现隔离到另一个缓存。
  const dispositions = await runWithoutHookReadCache(() =>
    runWithHookReadCache(() =>
      mapWithConcurrency(partitions.history, 4, (name) => store.readPartitionMetadata(name)),
    ),
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

/** 项目总览只排除当前文档范围内已严格封存的内置 Native Run。 */
export function inspectNativeSdkClosedHistory(
  projectRoot: string,
  names: readonly string[],
): Promise<Map<string, PromiseSettledResult<boolean>>> {
  let store: ReturnType<typeof createFileRuntimeStore<WorkflowRun>> | undefined;
  return inspectSdkChangeOwnerPartitions(projectRoot, 'native', names, async (owner, partition) => {
    if (partition !== 'history' || owner?.format !== 'sdk' || owner.application !== 'native')
      return false;
    // 根解析与 Store 构造只做一次；各条记录仍在 owner 的稳定代次内独立校验。
    store ??= createFileRuntimeStore<WorkflowRun>({
      singleWriter: true,
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'native'),
    });
    const disposition = await store.readPartitionMetadata(owner.runId);
    if (disposition !== 'closed')
      throw new Error(
        `Native history partition for ${owner.change} is ${disposition}; run comet native doctor ${owner.change} --migrate-history --json to inspect and finish migration`,
      );
    return true;
  });
}

/** 当前工作区的历史名字；只观察 Store 元数据，正文和 owner 错误交给逐项状态检查。 */
export async function listNativeSdkHistoryNames(projectRoot: string): Promise<string[]> {
  const runtimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
  const volume = path.parse(runtimeRoot).root;
  const directory = await inspectProtectedProjectPath(
    volume,
    path.relative(volume, path.join(runtimeRoot, 'change-owner-history/native')),
    { label: 'Native history owners', expected: 'directory' },
  );
  if (!directory.exists) return [];
  const names = (await fs.readdir(directory.target, { withFileTypes: true }))
    .filter((entry) => entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -5))
    .filter((name) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name));
  const store = createFileRuntimeStore<WorkflowRun>({
    singleWriter: true,
    rootDir: path.join(runtimeRoot, 'sdk-runs/native'),
  });
  const partitions = await mapWithConcurrency(names, 4, (name) =>
    store.readPartitionMetadata(name).catch(() => 'invalid' as const),
  );
  return names.filter((_, index) => partitions[index] !== 'missing').sort();
}
