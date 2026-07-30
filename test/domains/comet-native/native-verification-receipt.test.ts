import { describe, expect, it } from 'vitest';

import {
  buildNativeVerificationReceipt,
  parseNativeVerificationReceipt,
} from '../../../domains/comet-native/native-verification-receipt.js';

const acceptanceA = `acceptance-${'a'.repeat(64)}`;
const acceptanceB = `acceptance-${'b'.repeat(64)}`;
const hash = (character: string) => character.repeat(64);
const bindings = {
  change: 'typed-evidence',
  sourceRevision: 3,
  contractHash: hash('1'),
  scopeHash: hash('2'),
  snapshotHash: hash('3'),
  artifactHash: hash('4'),
};
const issuedAt = '2026-07-28T00:00:02.000Z';

describe('Native verification receipt v3', () => {
  it.each([
    [
      'automated-check',
      {
        executable: 'pnpm',
        args: ['test', '--', 'focused.test.ts'],
        cwd: '.',
        exitCode: 0,
        signal: null,
        timedOut: false,
        timeoutMs: 120_000,
        startedAt: '2026-07-28T00:00:00.000Z',
        endedAt: '2026-07-28T00:00:01.000Z',
        worktree: {
          provider: 'git',
          root: '.',
          beforeCommit: 'a'.repeat(40),
          afterCommit: 'a'.repeat(40),
        },
        afterFence: {
          snapshotHash: bindings.snapshotHash,
          scopeHash: bindings.scopeHash,
          matched: true,
        },
        outputHash: hash('9'),
        outputSummary: 'Focused test passed.',
        outputTruncated: false,
      },
    ],
    [
      'static-inspection',
      {
        subjects: ['domains/comet-native/native-verification-runtime.ts'],
        rule: 'scoped-text-safety',
        resultSummary: 'No blocking issue.',
        checkReceiptRef: `runtime/evidence/check-receipts/${hash('5')}.json`,
        checkReceiptHash: hash('5'),
      },
    ],
    [
      'manual-evidence',
      {
        steps: ['Open the generated archive.'],
        observations: ['The receipt graph is present.'],
      },
    ],
  ] as const)('round-trips a bound %s receipt', (kind, evidence) => {
    const receipt = buildNativeVerificationReceipt({
      kind,
      role: 'acceptance-evidence',
      status: 'passed',
      bindings,
      acceptanceIds: [acceptanceB, acceptanceA],
      actor: kind === 'manual-evidence' ? 'manual-reviewer' : 'verification-agent',
      issuedAt,
      evidence,
    });

    expect(parseNativeVerificationReceipt(receipt)).toEqual(receipt);
    expect(receipt).toMatchObject({
      schema: 'comet.native.verification-receipt.v3',
      acceptanceIds: [acceptanceA, acceptanceB],
      bindings,
    });
  });

  it.each(['implementation-attestation', 'independent-review'])(
    'rejects the removed %s receipt kind',
    (kind) => {
      expect(() =>
        parseNativeVerificationReceipt({
          schema: 'comet.native.verification-receipt.v3',
          receiptHash: hash('f'),
          kind,
          role: 'acceptance-evidence',
          status: 'passed',
          bindings,
          acceptanceIds: [acceptanceA],
          actor: 'removed-role',
          issuedAt,
          evidence: {},
        }),
      ).toThrow('kind or status is invalid');
    },
  );

  it('allows a required built-in static receipt for a zero-file no-code scope', () => {
    expect(
      buildNativeVerificationReceipt({
        kind: 'static-inspection',
        role: 'required-check',
        status: 'passed',
        bindings,
        acceptanceIds: [],
        actor: 'native-runtime:scoped-text-safety',
        issuedAt,
        evidence: {
          subjects: [],
          rule: 'scoped-text-safety',
          resultSummary: 'Zero selected files; the complete no-code scope remained current.',
          checkReceiptRef: `runtime/evidence/check-receipts/${hash('9')}.json`,
          checkReceiptHash: hash('9'),
        },
      }),
    ).toMatchObject({ role: 'required-check', acceptanceIds: [] });
  });
});
