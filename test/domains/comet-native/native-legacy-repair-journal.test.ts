import { expect, it } from 'vitest';
import { startNativeRun } from '../../../domains/comet-native/native-run-store.js';
import {
  NATIVE_RUNTIME_PACKAGE,
  NATIVE_RUNTIME_HASH,
} from '../../../domains/comet-native/native-runtime-package.js';
import { parseLegacyNativeTransitionJournalValue } from '../../../domains/comet-native/native-transition-journal.js';
import {
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_LEGACY_TRANSITION_SCHEMA,
} from '../../../domains/comet-native/native-types.js';

const signature = 'a'.repeat(64),
  contract = 'b'.repeat(64),
  acceptance = 'acceptance-' + 'c'.repeat(64);
function projection() {
  return {
    signatureHash: signature,
    disposition: 'continue',
    overrideSummaryHash: null,
    contractHash: contract,
    failedAcceptanceIds: [acceptance],
    failedCheckIds: ['focused-test'],
    maxVerifyFailures: 5,
  };
}
function read(value: unknown, override = false) {
  const name = 'legacy-repair',
    previousPhase = override ? 'build' : 'verify',
    nextPhase = override ? 'verify' : 'build';
  const state = {
    schema: NATIVE_LEGACY_CHANGE_SCHEMA,
    name,
    language: 'en',
    phase: previousPhase,
    brief: 'brief.md',
    approval: 'confirmed',
    spec_changes: [],
    verification_result: 'pending',
    verification_report: null,
    archived: false,
    created_at: '2026-07-20',
    run_id: 'legacy-run',
  };
  const previousRun = {
    ...startNativeRun(NATIVE_RUNTIME_PACKAGE, 'legacy-run', NATIVE_RUNTIME_HASH),
    currentStep: previousPhase,
    iteration: 2,
    pending: null,
    status: 'running',
  };
  return parseLegacyNativeTransitionJournalValue(
    {
      schema: NATIVE_LEGACY_TRANSITION_SCHEMA,
      id: 'recorded-transition',
      change: name,
      evidenceHash: signature,
      createdAt: state.created_at,
      previousState: state,
      nextState: {
        ...state,
        phase: nextPhase,
        verification_result: override ? 'pending' : 'fail',
        verification_report: override ? null : 'verification.md',
      },
      previousRun,
      nextRun: { ...previousRun, currentStep: nextPhase, iteration: 3 },
      eventData: {
        previousPhase,
        nextPhase,
        evidenceHash: signature,
        summary: 'Original recorded repair transition.',
        artifacts: [],
        noCodeReason: override ? 'Recorded documentation-only repair.' : null,
        verificationResult: override ? null : 'fail',
        repairStagnation: value,
      },
    },
    name,
  ).eventData.repairStagnation;
}
it('reads original legacy and extended repair projections through the retained transaction reader', () => {
  const legacy = {
    signatureHash: signature,
    disposition: 'manual-stop',
    overrideSummaryHash: null,
  };
  expect(read(legacy)).toMatchObject({
    ...legacy,
    contractHash: null,
    failedAcceptanceIds: [],
    failedCheckIds: [],
    maxVerifyFailures: null,
  });
  expect(read(projection())).toEqual(projection());
  expect(read({ ...projection(), overrideSummaryHash: 'd'.repeat(64) }, true)).toMatchObject({
    overrideSummaryHash: 'd'.repeat(64),
    failedAcceptanceIds: [acceptance],
  });
});
it('rejects forged or malformed repair projection fields through the retained transaction reader', () => {
  for (const value of [
    {
      signatureHash: signature,
      disposition: 'manual-stop',
      overrideSummaryHash: null,
      output: 'must never be persisted',
    },
    { ...projection(), output: 'must never be persisted' },
    { ...projection(), signatureHash: 'invalid' },
    { ...projection(), failedAcceptanceIds: ['A1'] },
    { ...projection(), failedCheckIds: ['contains space'] },
    { ...projection(), maxVerifyFailures: 0 },
    { ...projection(), disposition: 'warn', overrideSummaryHash: 'd'.repeat(64) },
  ])
    expect(() => read(value)).toThrow();
  expect(() => read({ ...projection(), overrideSummaryHash: 'd'.repeat(64) })).toThrow(
    'does not match its phase',
  );
  expect(() => read(projection(), true)).toThrow('does not match its phase');
});
