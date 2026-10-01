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
  return { schema: SCHEMA, hash: hashRuntimeValue(portable), run: portable };
}

export function readPortableRunCheckpoint(value: unknown, runId: string): WorkflowRun | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Portable Run checkpoint for ${runId} is invalid`);
  }
  const checkpoint = value as Record<string, unknown>;
  if (
    checkpoint.schema !== SCHEMA ||
    typeof checkpoint.hash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(checkpoint.hash) ||
    Object.keys(checkpoint).some((key) => !['schema', 'hash', 'run'].includes(key)) ||
    hashRuntimeValue(checkpoint.run) !== checkpoint.hash
  ) {
    throw new Error(`Portable Run checkpoint for ${runId} is invalid or changed`);
  }
  return parseWorkflowRun(checkpoint.run, runId);
}
