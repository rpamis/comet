import { parseWorkflowRun } from './workflow-run-validation.js';
import { hashRuntimeValue } from './runtime-json.js';
import type { WorkflowRun } from './workflow-run.js';

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

/** A copied checkout must never inherit a live executor claim as executable work. */
export function createPortableRunCheckpoint(run: WorkflowRun): PortableRunCheckpoint {
  const portable = structuredClone(run);
  // Local CAS revisions and rejected submissions do not advance resumable workflow progress.
  portable.revision = 1;
  for (const action of portable.actions) {
    const rejectedIds = new Set(
      (action.rejectedOutcomes ?? []).map((item) => item.outcome.outcomeId),
    );
    action.receipts = action.receipts.filter((item) => !rejectedIds.has(item.outcomeId));
    delete action.rejectedOutcomes;
    if (action.claim) {
      const originalToken = action.claim.token;
      const token = portableToken(originalToken);
      action.claim.token = token;
      if (action.outcome) {
        const oldOutcomeId = action.outcome.outcomeId;
        action.outcome.claimToken = token;
        const receipt = action.receipts.find((item) => item.outcomeId === oldOutcomeId);
        if (receipt) receipt.hash = hashRuntimeValue(action.outcome);
      }
    }
    if (action.status === 'running') {
      action.status = 'unknown';
      action.reason = 'Portable recovery requires reconciliation of external execution';
    }
  }
  parseWorkflowRun(portable, run.runId);
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
    checkpoint.schema !== SCHEMA ||
    typeof checkpoint.hash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(checkpoint.hash) ||
    Object.keys(checkpoint).some(
      (key) => !['schema', 'hash', 'run', 'sourceRevision', 'sourceHash'].includes(key),
    ) ||
    hashRuntimeValue(checkpoint.run) !== checkpoint.hash
  ) {
    throw new Error(`Portable Run checkpoint for ${runId} is invalid or changed`);
  }
  const run = parseWorkflowRun(checkpoint.run, runId);
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
