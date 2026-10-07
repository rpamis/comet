import path from 'node:path';
import {
  createFileRuntimeStore,
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeOutcome,
  type WorkflowRun,
} from '../engine/runtime.js';

type CheckResult = Pick<RuntimeOutcome, 'status' | 'output'>;
interface ClassicCheckReceipt {
  runId: string;
  revision: number;
  schema: 'comet.classic-sdk-check-receipt.v1';
  result: CheckResult;
  resultHash: string;
}

function receiptIdentity(run: Readonly<WorkflowRun>, action: Readonly<RuntimeAction>) {
  if (!action.claim) throw new Error('Classic check receipt requires the original claim');
  return hashRuntimeValue({
    workflow: run.workflow,
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claim: action.claim,
  });
}

function receiptStore(projectRoot: string) {
  return createFileRuntimeStore<ClassicCheckReceipt>({
    rootDir: path.join(projectRoot, '.comet/runtime/check-receipts/classic'),
  });
}

/** 原始执行结果写入 Runtime 追加式存储；change 内恢复 JSON 只是可重新生成的副本。 */
export async function recordClassicSdkCheckReceipt(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  result: CheckResult,
) {
  const runId = receiptIdentity(run, action);
  const store = receiptStore(projectRoot);
  const next: ClassicCheckReceipt = {
    runId,
    revision: 1,
    schema: 'comet.classic-sdk-check-receipt.v1',
    result,
    resultHash: hashRuntimeValue(result),
  };
  if (!(await store.compareAndSwap(runId, null, next))) {
    const existing = await store.read(runId);
    if (hashRuntimeValue(existing) !== hashRuntimeValue(next))
      throw new Error('Classic check already has a different original execution receipt');
  }
}

export async function assertClassicSdkCheckReceipt(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  result: CheckResult,
) {
  const receipt = await receiptStore(projectRoot).read(receiptIdentity(run, action));
  if (
    !receipt ||
    receipt.schema !== 'comet.classic-sdk-check-receipt.v1' ||
    receipt.revision !== 1 ||
    receipt.resultHash !== hashRuntimeValue(receipt.result)
  )
    throw new Error(
      'Classic check original Runtime execution receipt is unavailable; an editable recovery file or stdout cannot establish success',
    );
  if (hashRuntimeValue(receipt.result) !== hashRuntimeValue(result))
    throw new Error('Classic check result does not match the original Runtime execution receipt');
}

/** 按原领取身份定位检查记录，不把同一阶段的其他轮次当作本次结果。 */
export function classicSdkCheckRecordRef(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
) {
  const input = run.input as { changeDir?: unknown } | null;
  if (typeof input?.changeDir !== 'string' || !action.claim)
    throw new Error('Classic check recovery requires the original change and claim');
  return `${input.changeDir}/.comet/checks/sdk-${hashRuntimeValue({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claim: action.claim,
  })}.json`;
}
