import { describe, expect, it } from 'vitest';

import {
  compareNativeReceiptBindings,
  loadNativeVerificationReceiptContext,
  nativeReceiptBindingsMatch,
} from '../../../domains/comet-native/native-verification-receipt-runtime.js';
import type { NativeVerificationReceiptBindings } from '../../../domains/comet-native/native-verification-receipt.js';
import { buildNativeVerificationReceipt } from '../../../domains/comet-native/native-verification-receipt.js';
import {
  nativeRepairFailedCheckIdsFromReceipts,
  projectNativeRepairDecision,
} from '../../../domains/comet-native/native-repair-integration.js';

const hash = (character: string) => character.repeat(64);
const baseBindings: NativeVerificationReceiptBindings = {
  change: 'typed-evidence',
  sourceRevision: 3,
  contractHash: hash('1'),
  scopeHash: hash('2'),
  snapshotHash: hash('3'),
  artifactHash: hash('4'),
};

describe('compareNativeReceiptBindings', () => {
  it('reports ok with no mismatches when bindings are identical', () => {
    const result = compareNativeReceiptBindings({ bindings: baseBindings }, baseBindings);
    expect(result).toEqual({ ok: true, mismatches: [] });
  });

  it('nativeReceiptBindingsMatch stays a boolean wrapper over the comparison', () => {
    expect(nativeReceiptBindingsMatch({ bindings: baseBindings }, baseBindings)).toBe(true);
    expect(
      nativeReceiptBindingsMatch(
        { bindings: { ...baseBindings, sourceRevision: 5 } },
        baseBindings,
      ),
    ).toBe(false);
  });

  it.each([
    ['change', 'typed-evidence', 'other-change'],
    ['sourceRevision', 3, 6],
    ['contractHash', hash('1'), hash('9')],
    ['scopeHash', hash('2'), hash('8')],
    ['snapshotHash', hash('3'), hash('7')],
    ['artifactHash', hash('4'), hash('6')],
  ] as const)(
    'reports a per-field mismatch for %s with expected/got values',
    (field, expected, actual) => {
      const divergent: NativeVerificationReceiptBindings = {
        ...baseBindings,
        [field]: actual,
      } as NativeVerificationReceiptBindings;
      const result = compareNativeReceiptBindings({ bindings: divergent }, baseBindings);
      expect(result.ok).toBe(false);
      expect(result.mismatches).toEqual([
        `${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      ]);
    },
  );

  it('collects every diverging field at once rather than the first', () => {
    const divergent: NativeVerificationReceiptBindings = {
      ...baseBindings,
      sourceRevision: 6,
      artifactHash: hash('6'),
    };
    const result = compareNativeReceiptBindings({ bindings: divergent }, baseBindings);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      'sourceRevision: expected 3, got 6',
      `artifactHash: expected ${JSON.stringify(hash('4'))}, got ${JSON.stringify(hash('6'))}`,
    ]);
  });

  it('rejects receipt context creation before reading files when Verify prerequisites are absent', async () => {
    const paths = {} as never;
    await expect(
      loadNativeVerificationReceiptContext(paths, {
        phase: 'shape',
      } as never),
    ).rejects.toThrow(/requires Verify/u);
    await expect(
      loadNativeVerificationReceiptContext(paths, {
        phase: 'verify',
        implementation_scope: null,
      } as never),
    ).rejects.toThrow(/implementation scope/u);
  });

  it('projects repair decisions and derives stable failed-check identifiers', () => {
    const bindings = { ...baseBindings };
    const acceptanceId = `acceptance-${'a'.repeat(64)}`;
    const failedManual = buildNativeVerificationReceipt({
      kind: 'manual-evidence',
      role: 'acceptance-evidence',
      status: 'failed',
      bindings,
      acceptanceIds: [acceptanceId],
      actor: 'native-runtime:test',
      issuedAt: '2026-08-12T00:00:00.000Z',
      evidence: { steps: ['step'], observations: ['failed'] },
    });
    const passedManual = buildNativeVerificationReceipt({
      kind: 'manual-evidence',
      role: 'acceptance-evidence',
      status: 'passed',
      bindings,
      acceptanceIds: [acceptanceId],
      actor: 'native-runtime:test',
      issuedAt: '2026-08-12T00:00:00.000Z',
      evidence: { steps: ['step'], observations: ['passed'] },
    });
    const failedIds = nativeRepairFailedCheckIdsFromReceipts([failedManual, passedManual]);
    expect(failedIds).toHaveLength(1);
    expect(failedIds[0]).toMatch(/^manual:/u);
    expect(
      projectNativeRepairDecision({
        decision: {
          disposition: 'manual-stop',
          reasonCode: 'repeated-failure-stop',
          signature: { signatureHash: 'f'.repeat(64) },
          consecutiveFailures: 2,
          totalRepairFailures: 3,
          remainingIterations: 2,
          overrideAccepted: false,
        },
      } as never),
    ).toEqual({
      disposition: 'manual-stop',
      reasonCode: 'repeated-failure-stop',
      signatureHash: 'f'.repeat(64),
      consecutiveFailures: 2,
      totalRepairFailures: 3,
      remainingIterations: 2,
      overrideAccepted: false,
    });
  });
});
