import { describe, expect, it } from 'vitest';

import { buildNativeContractSnapshot } from '../../../domains/comet-native/native-contract.js';
import {
  acceptLatestNativeRepairOverride,
  acceptNativeRepairOverride,
  buildNativeRepairSignatureFromEvidence,
  inspectLatestNativeRepairProjection,
  inspectNativeRepairFailure,
  inspectNativeRepairResume,
  nativeRepairFailureFacts,
  nativeRepairScopeHash,
  NATIVE_REPAIR_TRAJECTORY_FIELD,
  NATIVE_REPAIR_TRAJECTORY_LIMITS,
  parseNativeRepairTrajectoryProjection,
  rebuildNativeRepairHistory,
  type NativeRepairEvidenceInput,
  type NativeRepairTrajectoryProjection,
} from '../../../domains/comet-native/native-repair-runtime.js';
import { NATIVE_REPAIR_STAGNATION_LIMITS } from '../../../domains/comet-native/native-repair-stagnation.js';
import {
  buildNativeAcceptanceEvidenceTrace,
  buildNativeVerificationEvidenceEnvelope,
} from '../../../domains/comet-native/native-verification-evidence.js';
import type { NativeContentSnapshotManifest } from '../../../domains/comet-native/native-types.js';
import { buildNativeImplementationScopeBundle } from '../../../domains/comet-native/native-verification-scope.js';

const RUN_ID = 'repair-run';
const NOW = new Date('2026-07-17T00:00:00.000Z');

function snapshot(hash: string): NativeContentSnapshotManifest {
  return {
    schema: 'comet.native.content-snapshot.v1',
    origin: 'explicit',
    createdAt: NOW.toISOString(),
    complete: true,
    limits: {
      maxFiles: 10,
      maxFileBytes: 1_024,
      maxTotalBytes: 4_096,
      maxManifestBytes: 4_096,
    },
    entries: [{ path: 'src/feature.ts', hash, size: 10, type: 'file' }],
    omitted: [],
    omittedCount: 0,
  };
}

function evidenceInput(
  result: 'pass' | 'fail' = 'fail',
  currentHash = 'b'.repeat(64),
): NativeRepairEvidenceInput {
  const contract = buildNativeContractSnapshot({
    briefMarkdown: '# Acceptance examples\n- The repaired behavior works.\n',
    specs: [],
  });
  const implementationScope = buildNativeImplementationScopeBundle({
    baseline: snapshot('a'.repeat(64)),
    current: snapshot(currentHash),
    contractHash: contract.contractHash,
    declaredArtifacts: [{ path: 'src/feature.ts', kind: 'file' }],
  });
  const acceptanceTrace = buildNativeAcceptanceEvidenceTrace(
    contract.acceptance,
    contract.acceptance.map((criterion) => ({
      acceptance_id: criterion.id,
      evidence_refs: ['verification.md'],
    })),
    { nativeRootRef: 'comet' },
  );
  const envelope = buildNativeVerificationEvidenceEnvelope({
    change: 'repair-loop',
    sourceRevision: 3,
    result,
    contractHash: contract.contractHash,
    acceptanceHash: contract.acceptanceHash,
    implementationScope: {
      ref: `runtime/evidence/scopes/${implementationScope.scope.scopeHash}.json`,
      bundle: implementationScope,
    },
    reportRef: 'verification.md',
    reportHash: 'c'.repeat(64),
    acceptanceTrace,
    now: NOW,
  });
  return { envelope, implementationScope };
}

function unchangedEvidenceInput(noCodeReason: string): NativeRepairEvidenceInput {
  const contract = buildNativeContractSnapshot({
    briefMarkdown: '# Acceptance examples\n- The no-code behavior remains valid.\n',
    specs: [],
  });
  const baseline = snapshot('a'.repeat(64));
  const implementationScope = buildNativeImplementationScopeBundle({
    baseline,
    current: { ...baseline, createdAt: new Date(NOW.valueOf() + 1_000).toISOString() },
    contractHash: contract.contractHash,
    declaredArtifacts: [],
    noCodeReason,
  });
  const acceptanceTrace = buildNativeAcceptanceEvidenceTrace(
    contract.acceptance,
    contract.acceptance.map((criterion) => ({
      acceptance_id: criterion.id,
      evidence_refs: ['verification.md'],
    })),
    { nativeRootRef: 'comet' },
  );
  const envelope = buildNativeVerificationEvidenceEnvelope({
    change: 'repair-loop',
    sourceRevision: 3,
    result: 'fail',
    contractHash: contract.contractHash,
    acceptanceHash: contract.acceptanceHash,
    implementationScope: {
      ref: `runtime/evidence/scopes/${implementationScope.scope.scopeHash}.json`,
      bundle: implementationScope,
    },
    reportRef: 'verification.md',
    reportHash: 'c'.repeat(64),
    acceptanceTrace,
    now: NOW,
  });
  return { envelope, implementationScope };
}

function event(
  sequence: number,
  data: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    sequence,
    timestamp: new Date(NOW.valueOf() + sequence * 1_000).toISOString(),
    type: 'state_transitioned',
    runId: RUN_ID,
    data,
    ...overrides,
  };
}

function repairEvent(
  sequence: number,
  projection: NativeRepairTrajectoryProjection,
  implementationScopeHash?: string,
): unknown {
  return event(sequence, {
    previousPhase: 'verify',
    nextPhase: 'build',
    verificationResult: 'fail',
    ...(implementationScopeHash ? { implementationScopeHash } : {}),
    [NATIVE_REPAIR_TRAJECTORY_FIELD]: projection,
  });
}

function overrideEvent(sequence: number, projection: NativeRepairTrajectoryProjection): unknown {
  return event(sequence, {
    previousPhase: 'build',
    nextPhase: 'verify',
    verificationResult: null,
    [NATIVE_REPAIR_TRAJECTORY_FIELD]: projection,
  });
}

function committed(trajectory: readonly unknown[]) {
  return {
    trajectory,
    committedTrajectoryOffset: trajectory.length,
    runId: RUN_ID,
  };
}

describe('Native repair runtime integration', () => {
  it('derives a lightweight default signature from failed, content-bound evidence', () => {
    const input = evidenceInput();
    const facts = nativeRepairFailureFacts(input);
    const signature = buildNativeRepairSignatureFromEvidence(input);

    expect(facts).toMatchObject({
      contractHash: input.envelope.contractHash,
      implementationScopeHash: nativeRepairScopeHash(input.implementationScope),
      artifactSnapshotHash: input.implementationScope.scope.currentProjectionHash,
      categories: ['verification-failed'],
      failedCheckIds: [],
    });
    expect(signature.signatureHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('keeps one repair episode when only the no-code explanation is reworded', () => {
    const first = unchangedEvidenceInput('No project edit is required.');
    const reworded = unchangedEvidenceInput('The project intentionally remains unchanged.');
    const firstSignature = buildNativeRepairSignatureFromEvidence(first).signatureHash;
    const rewordedSignature = buildNativeRepairSignatureFromEvidence(reworded).signatureHash;
    const repairScopeHash = nativeRepairScopeHash(reworded.implementationScope);

    expect(reworded.implementationScope.scope.scopeHash).not.toBe(
      first.implementationScope.scope.scopeHash,
    );
    expect(rewordedSignature).toBe(firstSignature);
    expect(
      rebuildNativeRepairHistory(
        committed([
          repairEvent(1, {
            signatureHash: firstSignature,
            disposition: 'continue',
            overrideSummaryHash: null,
          }),
          event(2, {
            previousPhase: 'build',
            nextPhase: 'verify',
            verificationResult: null,
            implementationScopeHash: reworded.implementationScope.scope.scopeHash,
            repairScopeHash,
          }),
          repairEvent(3, {
            signatureHash: rewordedSignature,
            disposition: 'warn',
            overrideSummaryHash: null,
          }),
        ]),
      ),
    ).toMatchObject([
      { kind: 'failure', iteration: 1, signatureHash: firstSignature },
      { kind: 'failure', iteration: 2, signatureHash: firstSignature },
    ]);

    expect(
      inspectNativeRepairResume({
        ...first,
        ...committed([
          repairEvent(1, {
            signatureHash: firstSignature,
            disposition: 'continue',
            overrideSummaryHash: null,
          }),
          repairEvent(2, {
            signatureHash: firstSignature,
            disposition: 'warn',
            overrideSummaryHash: null,
          }),
          repairEvent(3, {
            signatureHash: firstSignature,
            disposition: 'manual-stop',
            overrideSummaryHash: null,
          }),
        ]),
        currentImplementationScope: reworded.implementationScope,
      }),
    ).toMatchObject({ disposition: 'override-required', reason: 'override-required' });
  });

  it('continues once, warns on the repeat, then persists a manual stop', () => {
    const evidence = evidenceInput();
    const first = inspectNativeRepairFailure({ ...evidence, ...committed([]) });
    expect(first).toMatchObject({
      decision: { disposition: 'continue', consecutiveFailures: 1 },
      eventProjection: { disposition: 'continue', overrideSummaryHash: null },
    });

    const firstEvent = repairEvent(1, first.eventProjection!);
    const second = inspectNativeRepairFailure({ ...evidence, ...committed([firstEvent]) });
    expect(second).toMatchObject({
      decision: { disposition: 'warn', consecutiveFailures: 2 },
      eventProjection: { disposition: 'warn', overrideSummaryHash: null },
    });

    const third = inspectNativeRepairFailure({
      ...evidence,
      ...committed([firstEvent, repairEvent(2, second.eventProjection!)]),
    });
    expect(third).toMatchObject({
      decision: { disposition: 'manual-stop', consecutiveFailures: 3 },
      eventProjection: { disposition: 'manual-stop', overrideSummaryHash: null },
    });
  });

  it('accepts one matching override on the latest manual stop and rejects a second one', () => {
    const evidence = evidenceInput();
    const first = inspectNativeRepairFailure({ ...evidence, ...committed([]) });
    const one = repairEvent(1, first.eventProjection!);
    const second = inspectNativeRepairFailure({ ...evidence, ...committed([one]) });
    const two = repairEvent(2, second.eventProjection!);
    const third = inspectNativeRepairFailure({ ...evidence, ...committed([one, two]) });
    const three = repairEvent(3, third.eventProjection!);
    const expectedSignatureHash = first.decision.signature.signatureHash;

    expect(
      inspectNativeRepairResume({
        ...evidence,
        ...committed([one, two, three]),
        currentImplementationScope: evidence.implementationScope,
      }),
    ).toMatchObject({
      disposition: 'override-required',
      reason: 'override-required',
      signatureHash: expectedSignatureHash,
    });

    const historyOnly = acceptLatestNativeRepairOverride({
      ...committed([one, two, three]),
      override: {
        expectedSignatureHash,
        summary: 'Try the independent compatibility path once.',
      },
    });
    const accepted = acceptNativeRepairOverride({
      ...evidence,
      ...committed([one, two, three]),
      override: {
        expectedSignatureHash,
        summary: 'Try the independent compatibility path once.',
      },
    });
    expect(accepted).toMatchObject({
      decision: { disposition: 'continue', reasonCode: 'override-accepted' },
      eventProjection: {
        signatureHash: expectedSignatureHash,
        disposition: 'continue',
      },
    });
    expect(historyOnly.eventProjection).toEqual(accepted.eventProjection);
    expect(accepted.eventProjection?.overrideSummaryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.keys(accepted.eventProjection!).sort()).toEqual([
      'disposition',
      'overrideSummaryHash',
      'signatureHash',
    ]);

    const four = overrideEvent(4, accepted.eventProjection!);
    expect(inspectLatestNativeRepairProjection(committed([one, two, three, four]))).toEqual(
      accepted.eventProjection,
    );
    const refused = acceptNativeRepairOverride({
      ...evidence,
      ...committed([one, two, three, four]),
      override: {
        expectedSignatureHash,
        summary: 'A second override must not be accepted.',
      },
    });
    expect(refused).toMatchObject({
      decision: { disposition: 'manual-stop', reasonCode: 'override-already-used' },
      eventProjection: null,
    });
    expect(refused.history.slice(-2)).toEqual([
      {
        kind: 'failure',
        revision: 3,
        iteration: 3,
        signatureHash: expectedSignatureHash,
      },
      {
        kind: 'override',
        revision: 4,
        iteration: 3,
        signatureHash: expectedSignatureHash,
        summaryHash: accepted.eventProjection!.overrideSummaryHash,
      },
    ]);
    expect(() =>
      acceptLatestNativeRepairOverride({
        ...committed([one, two, three, four]),
        override: {
          expectedSignatureHash,
          summary: 'No repeated override.',
        },
      }),
    ).toThrow('latest manual stop');

    const five = repairEvent(5, {
      signatureHash: expectedSignatureHash,
      disposition: 'manual-stop',
      overrideSummaryHash: null,
    });
    expect(() =>
      acceptLatestNativeRepairOverride({
        ...committed([one, two, three, four, five]),
        override: {
          expectedSignatureHash,
          summary: 'The signature already used its only override.',
        },
      }),
    ).toThrow('already overridden');
    expect(
      inspectNativeRepairResume({
        ...evidence,
        ...committed([one, two, three, four, five]),
        currentImplementationScope: evidence.implementationScope,
      }),
    ).toMatchObject({ disposition: 'hard-stop', reason: 'override-already-applied' });
  });

  it('treats a new Build scope as progress without requiring an override', () => {
    const evidence = evidenceInput();
    const signature = buildNativeRepairSignatureFromEvidence(evidence).signatureHash;
    const trajectory = [
      repairEvent(1, {
        signatureHash: signature,
        disposition: 'continue',
        overrideSummaryHash: null,
      }),
      repairEvent(2, {
        signatureHash: signature,
        disposition: 'warn',
        overrideSummaryHash: null,
      }),
      repairEvent(3, {
        signatureHash: signature,
        disposition: 'manual-stop',
        overrideSummaryHash: null,
      }),
    ];
    const progressed = evidenceInput('fail', 'd'.repeat(64));

    expect(
      inspectNativeRepairResume({
        ...evidence,
        ...committed(trajectory),
        currentImplementationScope: progressed.implementationScope,
      }),
    ).toMatchObject({ disposition: 'proceed', reason: 'scope-progress' });
  });

  it('starts a fresh episode after scope progress following an ordinary failure', () => {
    const first = evidenceInput('fail', 'b'.repeat(64));
    const progressed = evidenceInput('fail', 'd'.repeat(64));
    const firstSignature = buildNativeRepairSignatureFromEvidence(first).signatureHash;
    const progressedSignature = buildNativeRepairSignatureFromEvidence(progressed).signatureHash;
    const trajectory = [
      repairEvent(
        1,
        {
          signatureHash: firstSignature,
          disposition: 'continue',
          overrideSummaryHash: null,
        },
        first.implementationScope.scope.scopeHash,
      ),
      event(2, {
        previousPhase: 'build',
        nextPhase: 'verify',
        verificationResult: null,
        implementationScopeHash: progressed.implementationScope.scope.scopeHash,
      }),
      repairEvent(
        3,
        {
          signatureHash: progressedSignature,
          disposition: 'continue',
          overrideSummaryHash: null,
        },
        progressed.implementationScope.scope.scopeHash,
      ),
    ];

    expect(rebuildNativeRepairHistory(committed(trajectory))).toEqual([
      {
        kind: 'failure',
        revision: 3,
        iteration: 1,
        signatureHash: progressedSignature,
      },
    ]);
  });

  it('hard-stops the twelfth total failure and never applies an override there', () => {
    const evidence = evidenceInput();
    const trajectory = Array.from(
      { length: NATIVE_REPAIR_STAGNATION_LIMITS.maxRepairIterations - 1 },
      (_, index) =>
        repairEvent(index + 1, {
          signatureHash: index.toString(16).padStart(64, '0'),
          disposition: 'continue',
          overrideSummaryHash: null,
        }),
    );
    const currentSignature = buildNativeRepairSignatureFromEvidence(evidence).signatureHash;
    const stopped = inspectNativeRepairFailure({ ...evidence, ...committed(trajectory) });
    expect(stopped).toMatchObject({
      decision: { disposition: 'hard-stop', totalRepairFailures: 12 },
      eventProjection: { disposition: 'hard-stop', overrideSummaryHash: null },
    });
    const persisted = [...trajectory, repairEvent(12, stopped.eventProjection!)];
    expect(inspectLatestNativeRepairProjection(committed(persisted))).toEqual(
      stopped.eventProjection,
    );
    const progressed = evidenceInput('fail', 'e'.repeat(64));
    expect(
      inspectNativeRepairResume({
        ...evidence,
        ...committed(persisted),
        currentImplementationScope: progressed.implementationScope,
      }),
    ).toMatchObject({ disposition: 'proceed', reason: 'scope-progress' });
    const result = acceptNativeRepairOverride({
      ...evidence,
      ...committed(persisted),
      override: {
        expectedSignatureHash: currentSignature,
        summary: 'The hard stop must win.',
      },
    });

    expect(result).toMatchObject({
      decision: { disposition: 'hard-stop', totalRepairFailures: 12 },
      eventProjection: null,
    });
    expect(() =>
      acceptLatestNativeRepairOverride({
        ...committed(persisted),
        override: {
          expectedSignatureHash: currentSignature,
          summary: 'The hard stop must still win.',
        },
      }),
    ).toThrow('hard stop cannot be overridden');
  });

  it('uses only the committed prefix and ignores ordinary transition events', () => {
    const signature = buildNativeRepairSignatureFromEvidence(evidenceInput()).signatureHash;
    const ordinary = event(1, {
      previousPhase: 'shape',
      nextPhase: 'build',
      verificationResult: null,
    });
    const projected = repairEvent(2, {
      signatureHash: signature,
      disposition: 'continue',
      overrideSummaryHash: null,
    });
    const uncommitted = repairEvent(3, {
      signatureHash: signature,
      disposition: 'warn',
      overrideSummaryHash: null,
    });

    expect(
      rebuildNativeRepairHistory({
        trajectory: [ordinary, projected, uncommitted],
        committedTrajectoryOffset: 2,
        runId: RUN_ID,
      }),
    ).toEqual([{ kind: 'failure', revision: 2, iteration: 1, signatureHash: signature }]);
  });

  it('fails closed on forged projections and malformed or unbounded trajectory data', () => {
    const signature = buildNativeRepairSignatureFromEvidence(evidenceInput()).signatureHash;
    const firstWarn = repairEvent(1, {
      signatureHash: signature,
      disposition: 'warn',
      overrideSummaryHash: null,
    });
    expect(() => rebuildNativeRepairHistory(committed([firstWarn]))).toThrow('expected continue');

    const wrongTransition = event(1, {
      previousPhase: 'build',
      nextPhase: 'verify',
      verificationResult: null,
      [NATIVE_REPAIR_TRAJECTORY_FIELD]: {
        signatureHash: signature,
        disposition: 'continue',
        overrideSummaryHash: null,
      },
    });
    expect(() => rebuildNativeRepairHistory(committed([wrongTransition]))).toThrow(
      'failed Verify-to-Build',
    );

    const forgedOverride = overrideEvent(1, {
      signatureHash: signature,
      disposition: 'continue',
      overrideSummaryHash: 'd'.repeat(64),
    });
    expect(() => rebuildNativeRepairHistory(committed([forgedOverride]))).toThrow(
      'latest manual stop',
    );

    expect(() =>
      parseNativeRepairTrajectoryProjection({
        signatureHash: signature,
        disposition: 'manual-stop',
        overrideSummaryHash: null,
        output: 'must never be persisted',
      }),
    ).toThrow('fields are invalid');

    const unknownOuterField = event(
      1,
      {},
      {
        forged: true,
      },
    );
    expect(() => rebuildNativeRepairHistory(committed([unknownOuterField]))).toThrow(
      'fields are invalid',
    );

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => rebuildNativeRepairHistory(committed([event(1, cycle)]))).toThrow('cycle');

    const tooMany = Array.from(
      { length: NATIVE_REPAIR_TRAJECTORY_LIMITS.maxEvents + 1 },
      () => null,
    );
    expect(() => rebuildNativeRepairHistory(committed(tooMany))).toThrow('event boundary');
  });

  it('rejects pass evidence and content authorities that do not match the envelope', () => {
    const evidence = evidenceInput();
    expect(() => nativeRepairFailureFacts(evidenceInput('pass'))).toThrow(
      'requires a failed verification envelope',
    );

    const different = evidenceInput('fail', 'd'.repeat(64));
    expect(() =>
      nativeRepairFailureFacts({
        envelope: evidence.envelope,
        implementationScope: different.implementationScope,
        categories: ['verification-failed'],
      }),
    ).toThrow('does not match');

    const forgedScope = structuredClone(evidence.implementationScope);
    forgedScope.scope.scopeHash = 'f'.repeat(64);
    expect(() =>
      nativeRepairFailureFacts({ envelope: evidence.envelope, implementationScope: forgedScope }),
    ).toThrow();
  });
});
