import { describe, expect, it } from 'vitest';
import {
  cancelRuntimeAction,
  claimRuntimeAction,
  createRuntimeAction,
  markRuntimeActionUnknown,
  parseRuntimeAction,
  recordRuntimeOutcome,
  retryRuntimeAction,
} from '../../../domains/engine/runtime-action.js';
import { canonicalRuntimeJson } from '../../../domains/engine/runtime-json.js';

function pending(input: unknown = { document: 'draft', version: 1 }) {
  return createRuntimeAction({
    id: 'review-1',
    runId: 'report-1',
    stepId: 'review',
    type: 'invoke_skill',
    ref: 'review@1',
    input,
    retry: 'reconcile',
  });
}

function running() {
  const action = pending();
  return claimRuntimeAction(action, {
    attempt: 1,
    inputHash: action.inputHash,
    executorId: 'agent-1',
    sessionId: 'session-1',
    token: 'claim-1',
  });
}

function outcome(action = running()) {
  return {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: 'claim-1',
    outcomeId: 'result-1',
    status: 'succeeded' as const,
    output: { verdict: 'fail', reason: '缺少来源' },
    artifacts: [{ uri: 'report.md', sha256: 'a'.repeat(64) }],
  };
}

describe('durable Action protocol', () => {
  it('uses locale-independent JSON key order for portable input bindings', () => {
    expect(canonicalRuntimeJson({ ä: 1, z: 2, a: 3 })).toBe('{"a":3,"z":2,"ä":1}');
  });

  it('binds an isolated input snapshot with an order-independent hash', () => {
    const input = { document: 'draft', version: 1 };
    const action = pending(input);
    input.version = 2;
    expect(action).toMatchObject({
      protocolVersion: 1,
      id: 'review-1',
      runId: 'report-1',
      stepId: 'review',
      attempt: 1,
      status: 'pending',
      input: { document: 'draft', version: 1 },
    });
    expect(action.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pending({ version: 1, document: 'draft' }).inputHash).toBe(action.inputHash);
    expect(pending(input).inputHash).not.toBe(action.inputHash);
  });

  it.each([undefined, NaN, Infinity, new Date(), { nested: undefined }, [undefined], 1n])(
    'rejects input that cannot round-trip as JSON: %s',
    (input) => {
      expect(() => pending(input === undefined ? { value: undefined } : input)).toThrow(
        /INVALID_JSON/,
      );
    },
  );

  it('keeps a repeated claim idempotent and rejects a competing executor', () => {
    const action = running();
    const claim = {
      attempt: 1,
      inputHash: action.inputHash,
      executorId: 'agent-1',
      sessionId: 'session-1',
      token: 'claim-1',
    };
    expect(claimRuntimeAction(action, claim)).toEqual(action);
    expect(() => claimRuntimeAction(action, { ...claim, token: 'claim-2' })).toThrow(
      /ACTION_ALREADY_CLAIMED/,
    );
    expect(() => claimRuntimeAction(action, { ...claim, attempt: 2 })).toThrow(/STALE_ACTION/);
  });

  it('records execution success without converting a business failure into execution failure', () => {
    const action = running();
    const result = recordRuntimeOutcome(action, outcome(action));
    expect(result.duplicate).toBe(false);
    expect(result.action.status).toBe('succeeded');
    expect(result.action.outcome?.output).toEqual({ verdict: 'fail', reason: '缺少来源' });
    expect(action.status).toBe('running');
  });

  it('deduplicates an identical terminal receipt and rejects conflicting reuse', () => {
    const receipt = outcome();
    const accepted = recordRuntimeOutcome(running(), receipt).action;
    expect(recordRuntimeOutcome(accepted, structuredClone(receipt))).toEqual({
      action: accepted,
      duplicate: true,
    });
    expect(() =>
      recordRuntimeOutcome(accepted, { ...receipt, output: { verdict: 'pass' } }),
    ).toThrow(/OUTCOME_CONFLICT/);
    expect(() =>
      recordRuntimeOutcome(accepted, { ...receipt, outcomeId: 'different-result' }),
    ).toThrow(/ACTION_TERMINAL/);
  });

  it.each([
    { actionId: 'another-action' },
    { inputHash: 'outdated-input' },
    { claimToken: 'another-claim' },
  ])('rejects a result with a stale identity or input binding: %j', (patch) => {
    const action = running();
    expect(() => recordRuntimeOutcome(action, { ...outcome(action), ...patch })).toThrow(
      /STALE_ACTION/,
    );
  });

  it('does not accept a result before the executor has claimed the action', () => {
    expect(() => recordRuntimeOutcome(pending(), outcome())).toThrow(/ACTION_NOT_RUNNING/);
  });

  it('preserves an uncertain execution until reconciliation or a matching result', () => {
    const action = running();
    const unknown = markRuntimeActionUnknown(action, '宿主断开，执行结果尚未核对');
    expect(unknown.status).toBe('unknown');
    expect(unknown.claim).toEqual(action.claim);
    expect(() => retryRuntimeAction(unknown)).toThrow(/RECONCILIATION_REQUIRED/);
    expect(recordRuntimeOutcome(unknown, outcome(action)).action.status).toBe('succeeded');
  });

  it('rejects an old attempt after an explicit not-executed reconciliation', () => {
    const action = running();
    const unknown = markRuntimeActionUnknown(action, '宿主已停止');
    const retried = retryRuntimeAction(unknown, {
      resolution: 'not-executed',
      evidence: { operationId: 'remote-1', observedStatus: 'not-found' },
    });
    expect(retried).toMatchObject({ id: action.id, attempt: 2, status: 'pending' });
    expect(retried.claim).toBeUndefined();
    expect(() => recordRuntimeOutcome(retried, outcome(action))).toThrow(/STALE_ACTION/);
    expect(() => retryRuntimeAction(action)).toThrow(/ACTION_ACTIVE/);
  });

  it('allows retrying an idempotent failure without forgetting its accepted receipt', () => {
    const base = createRuntimeAction({
      id: 'read-1',
      runId: 'report-1',
      stepId: 'read',
      type: 'call_tool',
      input: null,
      retry: 'idempotent',
    });
    const action = claimRuntimeAction(base, {
      attempt: 1,
      inputHash: base.inputHash,
      executorId: 'agent-1',
      token: 'claim-1',
    });
    const failedReceipt = { ...outcome(action), status: 'failed' as const, output: null };
    const failed = recordRuntimeOutcome(action, failedReceipt).action;
    const retried = retryRuntimeAction(failed);
    expect(retried.attempt).toBe(2);
    expect(recordRuntimeOutcome(retried, failedReceipt)).toEqual({
      action: retried,
      duplicate: true,
    });
  });

  it('cancels a task without claiming its external side effects have stopped', () => {
    const cancelled = cancelRuntimeAction(running(), '用户取消');
    expect(cancelled).toMatchObject({ status: 'cancelled', reason: '用户取消' });
    expect(cancelled.claim?.executorId).toBe('agent-1');
    expect(() => recordRuntimeOutcome(cancelled, outcome())).toThrow(/ACTION_TERMINAL/);
    expect(cancelRuntimeAction(cancelled, '用户取消')).toEqual(cancelled);
  });

  it('permits an explicit manual retry only after a not-executed reconciliation', () => {
    const base = createRuntimeAction({
      id: 'manual',
      runId: 'r',
      stepId: 's',
      type: 'handoff',
      input: null,
    });
    const started = claimRuntimeAction(base, {
      attempt: 1,
      inputHash: base.inputHash,
      executorId: 'agent',
      token: 'claim-1',
    });
    const failed = recordRuntimeOutcome(started, { ...outcome(started), status: 'failed' }).action;
    expect(() => retryRuntimeAction(failed)).toThrow(/RECONCILIATION_REQUIRED/);
    expect(
      retryRuntimeAction(failed, {
        resolution: 'not-executed',
        evidence: { checked: 'no operation exists' },
      }).attempt,
    ).toBe(2);
  });

  it('round-trips a persisted action and rejects altered input, terminal state or protocol', () => {
    const completed = recordRuntimeOutcome(running(), outcome()).action;
    expect(parseRuntimeAction(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
    expect(() => parseRuntimeAction({ ...completed, protocolVersion: 2 })).toThrow(
      /UNSUPPORTED_PROTOCOL/,
    );
    expect(() => parseRuntimeAction({ ...completed, input: 'altered' })).toThrow(/INVALID_ACTION/);
    expect(() => parseRuntimeAction({ ...completed, outcome: null })).toThrow(/INVALID_ACTION/);
    expect(() => parseRuntimeAction({ ...completed, receipts: [] })).toThrow(/INVALID_ACTION/);
    expect(() => parseRuntimeAction({ ...completed, unexpectedField: true })).toThrow(
      /INVALID_ACTION/,
    );
  });

  it('rejects missing or lossy result output and invalid artifact references', () => {
    expect(() =>
      recordRuntimeOutcome(running(), { ...outcome(), output: undefined } as never),
    ).toThrow(/INVALID_JSON/);
    expect(() =>
      recordRuntimeOutcome(running(), { ...outcome(), artifacts: [{ uri: 'x', sha256: 'bad' }] }),
    ).toThrow(/INVALID_OUTCOME/);
  });

  it('rejects an empty optional summary consistently with the JSON command', () => {
    expect(() => recordRuntimeOutcome(running(), { ...outcome(), summary: '' })).toThrow(
      /INVALID_OUTCOME/,
    );
  });

  it('rejects a non-positive result attempt as an invalid Outcome', () => {
    expect(() => recordRuntimeOutcome(running(), { ...outcome(), attempt: 0 })).toThrow(
      /INVALID_OUTCOME/,
    );
  });
});
