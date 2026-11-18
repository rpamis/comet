import path from 'node:path';
import {
  createFileRuntimeStore,
  parseWorkflowRun,
  RuntimeProtocolError,
  type WorkflowRun,
} from '../engine/runtime.js';
import { fileRuntimeStoreRunPaths } from '../engine/runtime-store.js';
import { resolveWorkspaceRuntimeRootSync } from '../workflow-contract/workspace-runtime.js';
import { requireWorkflowApplicationId } from './application-manifest.js';
import type { ApplicationIdentity } from './types.js';

export interface ApplicationRunRecord {
  runId: string;
  revision: number;
  application: ApplicationIdentity;
  run: WorkflowRun;
}

export function applicationRunStoreOptions(runtimeRoot: string, applicationId: string) {
  return {
    rootDir: path.join(runtimeRoot, 'applications', requireWorkflowApplicationId(applicationId)),
    mirroredRevisionPaths: ['run.revision'] as const,
  };
}

export function assertWorkflowApplicationRuntimeRoot(projectRoot: string, root: string): void {
  if (resolveWorkspaceRuntimeRootSync(projectRoot) !== root)
    throw new RuntimeProtocolError('WORKFLOW_CHANGED', '工作区身份已改变，请重新加载应用 Runtime');
}

/** 应用一个 Run 的存储位置；只读缓存据此判断应用所属的 Run 记录是否变化。 */
export function workflowApplicationRunPaths(
  projectRoot: string,
  applicationId: string,
  runId: string,
): string[] {
  return fileRuntimeStoreRunPaths(
    applicationRunStoreOptions(resolveWorkspaceRuntimeRootSync(projectRoot), applicationId).rootDir,
    runId,
  );
}

/** 只读分区状态，不执行存储恢复或加载应用模块。 */
export async function readWorkflowApplicationStorageDisposition(
  projectRoot: string,
  applicationId: string,
  runId: string,
) {
  return createFileRuntimeStore<ApplicationRunRecord>(
    applicationRunStoreOptions(resolveWorkspaceRuntimeRootSync(projectRoot), applicationId),
  ).readPartitionMetadata(runId);
}

/** 只读取保存的进度；不加载应用代码、不恢复记录，也不更新领域投影。 */
export async function readWorkflowApplicationRun(
  projectRoot: string,
  applicationId: string,
  runId: string,
): Promise<WorkflowRun | null> {
  return (await readWorkflowApplicationRunRecord(projectRoot, applicationId, runId))?.run ?? null;
}

/** 只读返回保存的固定身份；不加载应用模块或修复状态。 */
export async function readWorkflowApplicationRunRecord(
  projectRoot: string,
  applicationId: string,
  runId: string,
): Promise<ApplicationRunRecord | null> {
  const root = resolveWorkspaceRuntimeRootSync(projectRoot);
  const store = createFileRuntimeStore<ApplicationRunRecord>(
    applicationRunStoreOptions(root, applicationId),
  );
  assertWorkflowApplicationRuntimeRoot(projectRoot, root);
  const record = await store.read(runId);
  return record ? parseApplicationRunRecord(record, applicationId, runId) : null;
}

export function parseApplicationRunRecord(
  record: ApplicationRunRecord,
  applicationId: string,
  runId: string,
): ApplicationRunRecord {
  if (
    record.application.id !== applicationId ||
    record.runId !== record.run.runId ||
    record.revision !== record.run.revision
  )
    throw new RuntimeProtocolError('INVALID_RUN', '应用归属与 SDK Run 不一致');
  record.run = parseWorkflowRun(record.run, runId);
  return record;
}
