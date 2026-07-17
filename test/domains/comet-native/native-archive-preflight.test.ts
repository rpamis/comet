import { describe, expect, it } from 'vitest';

import {
  buildNativeArchivePreflight,
  type NativeArchivePreflightInput,
} from '../../../domains/comet-native/native-archive-preflight.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const E = 'e'.repeat(64);

function input(): NativeArchivePreflightInput {
  return {
    change: 'secure-login',
    stateSchema: 'comet.native.v3',
    revision: 5,
    phase: 'archive',
    archived: false,
    pendingJournal: false,
    targetRef: 'archive/2026-07-17-secure-login',
    targetExists: false,
    specs: [
      {
        capability: 'authentication',
        operation: 'replace',
        expectedBaseHash: A,
        actualBaseHash: A,
        proposedHash: B,
      },
    ],
    evidence: {
      result: 'pass',
      freshness: 'complete',
      contractHash: A,
      acceptanceHash: B,
      implementationScopeHash: C,
      reportHash: D,
      envelopeHash: E,
      partialAllowanceHash: null,
      skippedAcceptanceCount: 0,
    },
  };
}

describe('Native Archive preflight', () => {
  it('is deterministic across spec order and previews the exact content-bound operations', () => {
    const original = input();
    original.specs = [
      ...original.specs,
      {
        capability: 'sessions',
        operation: 'create',
        expectedBaseHash: null,
        actualBaseHash: null,
        proposedHash: C,
      },
    ];
    const first = buildNativeArchivePreflight(original);
    const reordered = buildNativeArchivePreflight({
      ...original,
      specs: [...original.specs].reverse(),
    });

    expect(reordered).toEqual(first);
    expect(first).toMatchObject({ ready: true, operationCount: 2, findingCodes: [] });
    expect(first.operations.map(({ capability }) => capability)).toEqual([
      'authentication',
      'sessions',
    ]);
    expect(first.preflightHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    ['revision', (value: NativeArchivePreflightInput) => (value.revision += 1)],
    ['target', (value: NativeArchivePreflightInput) => (value.targetRef += '-next')],
    ['target existence', (value: NativeArchivePreflightInput) => (value.targetExists = true)],
    ['base', (value: NativeArchivePreflightInput) => (value.specs[0].actualBaseHash = C)],
    ['proposal', (value: NativeArchivePreflightInput) => (value.specs[0].proposedHash = C)],
    ['contract', (value: NativeArchivePreflightInput) => (value.evidence.contractHash = C)],
    ['scope', (value: NativeArchivePreflightInput) => (value.evidence.implementationScopeHash = D)],
    ['report', (value: NativeArchivePreflightInput) => (value.evidence.reportHash = E)],
    ['envelope', (value: NativeArchivePreflightInput) => (value.evidence.envelopeHash = A)],
  ])('changes the preflight hash when %s changes', (_label, mutate) => {
    const baseline = buildNativeArchivePreflight(input());
    const changed = input();
    mutate(changed);
    expect(buildNativeArchivePreflight(changed).preflightHash).not.toBe(baseline.preflightHash);
  });

  it('blocks stale evidence, canonical drift, a pending journal, or an existing target', () => {
    const changed = input();
    changed.pendingJournal = true;
    changed.targetExists = true;
    changed.specs[0].actualBaseHash = C;
    changed.evidence.freshness = 'stale';
    const result = buildNativeArchivePreflight(changed);

    expect(result.ready).toBe(false);
    expect(result.findingCodes).toEqual([
      'archive-target-exists',
      'pending-journal',
      'spec-base-conflict',
      'verification-evidence-stale',
    ]);
  });

  it('accepts partial evidence only when it binds an exact allowance hash', () => {
    const partial = input();
    partial.evidence.freshness = 'partial';
    partial.evidence.partialAllowanceHash = A;
    expect(buildNativeArchivePreflight(partial)).toMatchObject({
      ready: true,
      evidenceFreshness: 'partial',
    });

    partial.evidence.partialAllowanceHash = null;
    expect(() => buildNativeArchivePreflight(partial)).toThrow('allowance state');
  });

  it('rejects unsafe target refs and malformed operation/base combinations', () => {
    expect(() =>
      buildNativeArchivePreflight({ ...input(), targetRef: 'C:/archive/escape' }),
    ).toThrow('Native-relative');
    const invalid = input();
    invalid.specs[0] = {
      capability: 'authentication',
      operation: 'create',
      expectedBaseHash: A,
      actualBaseHash: null,
      proposedHash: B,
    };
    expect(() => buildNativeArchivePreflight(invalid)).toThrow('expect no canonical base');
  });
});
