import {
  claimRuntimeAction,
  createRuntimeAction,
  parseRuntimeAction,
  recordRuntimeOutcome,
  type RuntimeAction,
} from '../engine/runtime-action.js';
import { hashRuntimeValue } from '../engine/runtime-json.js';
import type { RunState } from '../engine/types.js';
import type { CommandCheckScope } from './classic-command-checks.js';

export function startClassicCheckAction(options: {
  run: RunState;
  id: string;
  scope: CommandCheckScope;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  tier: 'full' | 'incremental';
  checkEpoch: number;
}): RuntimeAction {
  const action = createRuntimeAction({
    id: options.id,
    runId: options.run.runId,
    stepId: options.run.currentStep ?? `classic-check-${options.scope}`,
    type: 'call_tool',
    ref: 'classic-check',
    retry: 'manual',
    input: {
      scope: options.scope,
      argv: options.argv,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      tier: options.tier,
      checkEpoch: options.checkEpoch,
    },
  });
  return claimRuntimeAction(action, {
    executorId: 'comet-classic-check',
    token: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
  });
}

export function completeClassicCheckAction(
  action: RuntimeAction,
  evidence: {
    exitCode: number;
    inputBefore: string;
    inputAfter: string;
    logHash: string;
    manifestHash: string | null;
  },
): RuntimeAction {
  return recordRuntimeOutcome(action, {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: action.claim!.token,
    outcomeId: hashRuntimeValue({ actionId: action.id, evidence }),
    status:
      evidence.exitCode === 0 && evidence.inputBefore === evidence.inputAfter
        ? 'succeeded'
        : 'failed',
    output: evidence,
  }).action;
}

export function completedClassicCheckAction(
  value: unknown,
  record: {
    runId: string;
    scope: CommandCheckScope;
    argv: unknown;
    cwd: string;
    timeoutMs: unknown;
    tier: unknown;
    checkEpoch: unknown;
    exitCode: number;
    inputBefore: unknown;
    inputAfter: unknown;
    logHash: unknown;
    manifestHash: unknown;
  },
): RuntimeAction | null {
  try {
    const action = parseRuntimeAction(value);
    if (
      !Array.isArray(record.argv) ||
      record.argv.some((entry) => typeof entry !== 'string') ||
      !Number.isSafeInteger(record.timeoutMs) ||
      !Number.isSafeInteger(record.checkEpoch) ||
      typeof record.inputBefore !== 'string' ||
      typeof record.inputAfter !== 'string' ||
      typeof record.logHash !== 'string' ||
      (record.manifestHash !== undefined && typeof record.manifestHash !== 'string')
    )
      return null;
    const evidence = {
      exitCode: record.exitCode,
      inputBefore: record.inputBefore,
      inputAfter: record.inputAfter,
      logHash: record.logHash,
      manifestHash: record.manifestHash ?? null,
    };
    const status =
      record.exitCode === 0 && record.inputBefore === record.inputAfter ? 'succeeded' : 'failed';
    return action.runId === record.runId &&
      action.type === 'call_tool' &&
      action.ref === 'classic-check' &&
      action.status === status &&
      action.claim?.executorId === 'comet-classic-check' &&
      action.claim.token === action.id &&
      action.outcome?.status === status &&
      action.outcome.outcomeId === hashRuntimeValue({ actionId: action.id, evidence }) &&
      hashRuntimeValue(action.input) ===
        hashRuntimeValue({
          scope: record.scope,
          argv: record.argv,
          cwd: record.cwd,
          timeoutMs: record.timeoutMs,
          tier: record.tier === 'incremental' ? 'incremental' : 'full',
          checkEpoch: record.checkEpoch,
        }) &&
      hashRuntimeValue(action.outcome.output) === hashRuntimeValue(evidence)
      ? action
      : null;
  } catch {
    return null;
  }
}

export function runningClassicCheckAction(
  value: unknown,
  attempt: {
    runId: string;
    scope: CommandCheckScope;
    argv: string[];
    cwd: string;
    timeoutMs: number;
    tier: 'full' | 'incremental';
    checkEpoch: unknown;
  },
): RuntimeAction | null {
  try {
    if (!Number.isSafeInteger(attempt.checkEpoch)) return null;
    const action = parseRuntimeAction(value);
    return action.runId === attempt.runId &&
      action.type === 'call_tool' &&
      action.ref === 'classic-check' &&
      action.status === 'running' &&
      action.claim?.executorId === 'comet-classic-check' &&
      action.claim.token === action.id &&
      hashRuntimeValue(action.input) ===
        hashRuntimeValue({
          scope: attempt.scope,
          argv: attempt.argv,
          cwd: attempt.cwd,
          timeoutMs: attempt.timeoutMs,
          tier: attempt.tier,
          checkEpoch: attempt.checkEpoch,
        })
      ? action
      : null;
  } catch {
    return null;
  }
}
