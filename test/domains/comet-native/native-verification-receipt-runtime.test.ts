import { describe, expect, it } from 'vitest';

import {
  compareNativeReceiptBindings,
  nativeReceiptBindingsMatch,
} from '../../../domains/comet-native/native-verification-receipt-runtime.js';
import type { NativeVerificationReceiptBindings } from '../../../domains/comet-native/native-verification-receipt.js';

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
});
