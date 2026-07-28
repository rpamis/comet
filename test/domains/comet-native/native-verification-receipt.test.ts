import { describe, expect, it } from 'vitest';

import {
  buildNativeReviewEvidenceGraph,
  buildNativeVerificationReceipt,
  buildNativeWaiverReceipt,
  nativeIndependentReviewAttestationHash,
  nativeReviewAcceptanceMatrixHash,
  nativeWaiverAttestationHash,
  parseNativeVerificationReceipt,
  parseNativeWaiverReceipt,
} from '../../../domains/comet-native/native-verification-receipt.js';
import {
  generateNativeReviewKeyPair,
  signNativeReviewPayloadHash,
} from '../../../domains/comet-native/native-review-identity.js';

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
const implementation = generateNativeReviewKeyPair();
const reviewer = generateNativeReviewKeyPair();
const issuedAt = '2026-07-28T00:00:02.000Z';

function reviewEvidence(
  status: 'passed' | 'blocked',
  findings: Array<{
    severity: 'P0' | 'P1' | 'P2';
    status: 'resolved' | 'open';
    summary: string;
  }> = [],
  implementationKeyId = implementation.identity.keyId,
  acceptanceIds: readonly string[] = [acceptanceA, acceptanceB],
) {
  const evidence = {
    preparationHash: hash('0'),
    implementationKeyId,
    implementationReceiptRef: `runtime/evidence/receipts/${hash('7')}.json`,
    reviewPolicyHash: hash('8'),
    reviewerIdentity: reviewer.identity,
    matrixHash: nativeReviewAcceptanceMatrixHash(
      acceptanceIds.map((acceptance_id) => ({
        acceptance_id,
        status: 'passed',
        evidence_refs: [`runtime/evidence/receipts/${hash('6')}.json`],
      })),
    ),
    checked: {
      acceptanceApplicability: true as const,
      unifiedIo: null,
      adversarialPaths: null,
      generatedAssets: null,
      lifecycleEval: null,
    },
    evidenceGraph: buildNativeReviewEvidenceGraph({
      reviewedReceiptRefs: [],
      reviewedWaiverRefs: [],
      automatedReplays: [],
      staticReplays: [],
      manualAttestationRefs: [],
    }),
    findings,
  };
  return {
    ...evidence,
    attestation: signNativeReviewPayloadHash({
      identity: reviewer.identity,
      privateKey: reviewer.privateKey,
      payloadHash: nativeIndependentReviewAttestationHash({
        bindings,
        status,
        acceptanceIds,
        issuedAt,
        evidence,
      }),
    }),
  };
}

describe('Native verification receipt v2', () => {
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
        responsible: 'manual-reviewer',
      },
    ],
    ['independent-review', reviewEvidence('passed')],
  ] as const)('round-trips a bound %s receipt', (kind, evidence) => {
    const receipt = buildNativeVerificationReceipt({
      kind,
      role: 'acceptance-evidence',
      status: 'passed',
      bindings,
      acceptanceIds: [acceptanceB, acceptanceA],
      actor:
        kind === 'independent-review'
          ? `review-key:${reviewer.identity.keyId}`
          : kind === 'manual-evidence'
            ? 'manual-reviewer'
            : 'verification-agent',
      issuedAt,
      evidence,
    });

    expect(parseNativeVerificationReceipt(receipt)).toEqual(receipt);
    expect(receipt).toMatchObject({
      schema: 'comet.native.verification-receipt.v2',
      acceptanceIds: [acceptanceA, acceptanceB],
      bindings,
    });
  });

  it('rejects an independent review that is not bound to a different reviewer', () => {
    expect(() =>
      buildNativeVerificationReceipt({
        kind: 'independent-review',
        role: 'acceptance-evidence',
        status: 'passed',
        bindings,
        acceptanceIds: [acceptanceA],
        actor: `review-key:${reviewer.identity.keyId}`,
        issuedAt,
        evidence: reviewEvidence('passed', [], reviewer.identity.keyId, [acceptanceA]),
      }),
    ).toThrow('reviewer must differ');
  });

  it('records unresolved P1 findings only on a non-passing review receipt', () => {
    const findings = [
      { severity: 'P1' as const, status: 'open' as const, summary: 'Missing Eval.' },
    ];
    const evidence = reviewEvidence('blocked', findings, implementation.identity.keyId, [
      acceptanceA,
    ]);
    expect(
      parseNativeVerificationReceipt(
        buildNativeVerificationReceipt({
          kind: 'independent-review',
          role: 'acceptance-evidence',
          status: 'blocked',
          bindings,
          acceptanceIds: [acceptanceA],
          actor: `review-key:${reviewer.identity.keyId}`,
          issuedAt,
          evidence,
        }),
      ),
    ).toMatchObject({ status: 'blocked', evidence: { findings } });
    expect(() =>
      buildNativeVerificationReceipt({
        kind: 'independent-review',
        role: 'acceptance-evidence',
        status: 'passed',
        bindings,
        acceptanceIds: [acceptanceA],
        actor: `review-key:${reviewer.identity.keyId}`,
        issuedAt,
        evidence: reviewEvidence('passed', findings, implementation.identity.keyId, [acceptanceA]),
      }),
    ).toThrow('unresolved P0/P1');
  });

  it('supports a full independent review beyond the former 256-item list limit', () => {
    const acceptanceIds = Array.from(
      { length: 257 },
      (_, index) => `acceptance-${index.toString(16).padStart(64, '0')}`,
    );
    const receipt = buildNativeVerificationReceipt({
      kind: 'independent-review',
      role: 'acceptance-evidence',
      status: 'passed',
      bindings,
      acceptanceIds,
      actor: `review-key:${reviewer.identity.keyId}`,
      issuedAt,
      evidence: reviewEvidence('passed', [], implementation.identity.keyId, acceptanceIds),
    });

    expect(parseNativeVerificationReceipt(receipt).acceptanceIds).toHaveLength(257);
  });

  it('builds an explicit, content-addressed waiver confirmation', () => {
    const unsigned = {
      bindings,
      acceptanceId: acceptanceA,
      blockedReceiptRef: `runtime/evidence/receipts/${hash('7')}.json`,
      blockedCheckId: `receipt:${hash('7')}`,
      reason: 'The local Python runtime is unavailable.',
      risk: 'The platform-specific Eval has not run locally.',
      alternativeReceiptRefs: [`runtime/evidence/receipts/${hash('6')}.json`],
      reviewPolicyHash: hash('8'),
      signerIdentity: reviewer.identity,
      confirmedAt: '2026-07-28T00:00:03.000Z',
    };
    const waiver = buildNativeWaiverReceipt({
      ...unsigned,
      attestation: signNativeReviewPayloadHash({
        identity: reviewer.identity,
        privateKey: reviewer.privateKey,
        payloadHash: nativeWaiverAttestationHash(unsigned),
      }),
    });

    expect(parseNativeWaiverReceipt(waiver)).toEqual(waiver);
    expect(waiver).toMatchObject({
      schema: 'comet.native.waiver-receipt.v2',
      acceptanceId: acceptanceA,
      signerIdentity: reviewer.identity,
      bindings,
    });
  });

  it('allows a required built-in static receipt for a zero-file no-code scope', () => {
    expect(
      buildNativeVerificationReceipt({
        kind: 'static-inspection',
        role: 'required-check',
        status: 'passed',
        bindings,
        acceptanceIds: [],
        actor: 'native-runtime:scoped-text-safety',
        issuedAt: '2026-07-28T00:00:02.000Z',
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
