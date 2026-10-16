import { parseWorkflowRun } from './workflow-run-validation.js';
import { hashRuntimeValue } from './runtime-json.js';
import type { WorkflowRun } from './workflow-run.js';
import { isDeepStrictEqual } from 'node:util';
import { encodeRuntimeHistory } from './runtime-history-storage.js';
import { decodeJsonValueMaps } from '../../platform/fs/json-value-pool.js';

export const PORTABLE_RUN_CHECKPOINT_KEY = 'run_checkpoint';
const SCHEMA = 'comet.workflow-run-checkpoint.v1';
const PORTABLE_TOKEN = /^portable-[a-f0-9]{64}$/u;

function portableToken(token: string): string {
  return PORTABLE_TOKEN.test(token) ? token : `portable-${hashRuntimeValue(token)}`;
}

export interface PortableRunCheckpoint {
  schema: typeof SCHEMA;
  hash: string;
  run: WorkflowRun;
  /** 原本地 CAS revision，与稳定的 portable 进度 hash 分开保存。 */
  sourceRevision?: number;
  /** 绑定 portable hash 与 sourceRevision，拒绝单独修改恢复版本。 */
  sourceHash?: string;
}

/** 文件投影压缩历史引用；createPortableRunCheckpoint 的公共 Run 保持完整。 */
export function encodePortableRunCheckpoint(checkpoint: PortableRunCheckpoint) {
  const encoded = encodeRuntimeHistory(checkpoint.run);
  return encoded.pool
    ? {
        ...checkpoint,
        schema: 'comet.workflow-run-checkpoint.v2',
        run: encoded.record,
        pool: encoded.pool,
        storageHash: hashRuntimeValue(encoded),
      }
    : checkpoint;
}

export function portableRunCheckpointMatches(
  value: unknown,
  expected: PortableRunCheckpoint,
): boolean {
  return (
    isDeepStrictEqual(value, expected) ||
    isDeepStrictEqual(value, encodePortableRunCheckpoint(expected))
  );
}

/** A copied checkout must never inherit a live executor claim as executable work. */
export function createPortableRunCheckpoint(run: WorkflowRun): PortableRunCheckpoint {
  // 在一次完整校验中生成隔离副本，避免先复制整个 Run 再丢弃校验器的副本。
  const portable = parseWorkflowRun(
    {
      ...run,
      revision: 1,
      actions: run.actions.map((action) => {
        const rejectedIds = new Set(
          (action.rejectedOutcomes ?? []).map((item) => item.outcome.outcomeId),
        );
        const next = {
          ...action,
          receipts: action.receipts
            .filter((item) => !rejectedIds.has(item.outcomeId))
            .map((item) => ({ ...item })),
        };
        delete next.rejectedOutcomes;
        if (action.claim) {
          const token = portableToken(action.claim.token);
          next.claim = { ...action.claim, token };
          if (action.cancellation) {
            next.cancellation = { ...action.cancellation, claimToken: token };
          }
          if (action.outcome) {
            next.outcome = { ...action.outcome, claimToken: token };
            const receipt = next.receipts.find(
              (item) => item.outcomeId === action.outcome!.outcomeId,
            );
            if (receipt) receipt.hash = hashRuntimeValue(next.outcome);
          }
        }
        if (action.status === 'running') {
          next.status = 'unknown';
          next.reason = 'Portable recovery requires reconciliation of external execution';
        }
        return next;
      }),
    },
    run.runId,
  );
  const hash = hashRuntimeValue(portable);
  return {
    schema: SCHEMA,
    hash,
    run: portable,
    sourceRevision: run.revision,
    sourceHash: hashRuntimeValue({ hash, sourceRevision: run.revision }),
  };
}

export function readPortableRunCheckpoint(
  value: unknown,
  runId: string,
  options: { preserveSourceRevision?: boolean } = {},
): WorkflowRun | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Portable Run checkpoint for ${runId} is invalid`);
  }
  const checkpoint = value as Record<string, unknown>;
  if (
    ![SCHEMA, 'comet.workflow-run-checkpoint.v2'].includes(String(checkpoint.schema)) ||
    typeof checkpoint.hash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(checkpoint.hash) ||
    Object.keys(checkpoint).some(
      (key) =>
        ![
          'schema',
          'hash',
          'run',
          'sourceRevision',
          'sourceHash',
          ...(checkpoint.schema === 'comet.workflow-run-checkpoint.v2'
            ? ['pool', 'storageHash']
            : []),
        ].includes(key),
    ) ||
    (checkpoint.schema === 'comet.workflow-run-checkpoint.v2'
      ? hashRuntimeValue({ record: checkpoint.run, pool: checkpoint.pool }) !==
        checkpoint.storageHash
      : hashRuntimeValue(checkpoint.run) !== checkpoint.hash)
  ) {
    throw new Error(`Portable Run checkpoint for ${runId} is invalid or changed`);
  }
  const restored =
    checkpoint.schema === 'comet.workflow-run-checkpoint.v2'
      ? decodeJsonValueMaps(checkpoint.run, checkpoint.pool)
      : checkpoint.run;
  if (hashRuntimeValue(restored) !== checkpoint.hash)
    throw new Error(`Portable Run checkpoint for ${runId} is invalid or changed`);
  const run = parseWorkflowRun(restored, runId);
  if (checkpoint.sourceRevision !== undefined || checkpoint.sourceHash !== undefined) {
    if (
      !Number.isSafeInteger(checkpoint.sourceRevision) ||
      (checkpoint.sourceRevision as number) < 1 ||
      checkpoint.sourceHash !==
        hashRuntimeValue({ hash: checkpoint.hash, sourceRevision: checkpoint.sourceRevision })
    ) {
      throw new Error(`Portable Run checkpoint revision for ${runId} is invalid or changed`);
    }
    if (options.preserveSourceRevision)
      return { ...run, revision: checkpoint.sourceRevision as number };
  }
  return run;
}
