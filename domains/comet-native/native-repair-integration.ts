import { nativeChangeDir } from './native-change.js';
import {
  readNativeImplementationScopeBundle,
  readNativeVerificationEvidence,
  readNativeVerificationReceipt,
} from './native-evidence-storage.js';
import {
  acceptLatestNativeRepairOverride,
  inspectLatestNativeRepairProjection,
  inspectNativeRepairFailure,
  nativeRepairScopeHash,
  rebuildNativeRepairHistory,
  type NativeCommittedRepairTrajectory,
  type NativeRepairRuntimeResult,
  type NativeRepairTrajectoryProjection,
} from './native-repair-runtime.js';
import {
  nativeRepairConsecutiveFailures,
  normalizeNativeRepairFailedCheckIds,
  type NativeRepairHistoryRecord,
} from './native-repair-stagnation.js';
import {
  readNativeCheckpoint,
  readNativeRunState,
  readNativeTrajectory,
} from './native-run-store.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
  NativeRepairDecisionProjection,
  NativeRepairStatusProjection,
} from './native-types.js';
import type { NativeVerificationEvidenceEnvelope } from './native-verification-evidence.js';
import {
  nativeFailedCheckId,
  type NativeVerificationReceipt,
} from './native-verification-receipt.js';
import {
  parseNativeImplementationScopeBundle,
  type NativeImplementationScopeBundle,
} from './native-verification-scope.js';

export interface NativeRepairHistoryInspection {
  committed: NativeCommittedRepairTrajectory;
  latest: NativeRepairTrajectoryProjection | null;
  history: NativeRepairHistoryRecord[];
}

export type NativeRepairBuildGuard =
  | { disposition: 'proceed'; eventProjection: NativeRepairTrajectoryProjection | null }
  | {
      disposition: 'manual-stop' | 'hard-stop';
      signatureHash: string;
      overrideRecorded: boolean;
    };

function assertRepairableBuildState(state: NativeChangeState): void {
  if (
    state.phase !== 'build' ||
    state.verification_result !== 'fail' ||
    !state.implementation_scope ||
    !state.verification_evidence
  ) {
    throw new Error('Native repair guard requires a failed Verify-to-Build state');
  }
}

/** Read only the checkpoint-committed trajectory prefix used as repair history authority. */
export async function readNativeCommittedRepairTrajectory(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeCommittedRepairTrajectory> {
  const changeDir = nativeChangeDir(paths, state.name);
  const run = await readNativeRunState(changeDir);
  if (!run || !state.run_id || run.runId !== state.run_id) {
    throw new Error('Native repair history Run state is missing or mismatched');
  }
  const checkpoint = await readNativeCheckpoint(changeDir, run.checkpointRef);
  if (!checkpoint || checkpoint.runId !== run.runId || checkpoint.stateVersion !== run.iteration) {
    throw new Error('Native repair history checkpoint is missing or mismatched');
  }
  return {
    trajectory: await readNativeTrajectory(changeDir, run.trajectoryRef),
    committedTrajectoryOffset: checkpoint.trajectoryOffset,
    runId: run.runId,
  };
}

export async function inspectNativeRepairHistory(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeRepairHistoryInspection> {
  const committed = await readNativeCommittedRepairTrajectory(paths, state);
  return {
    committed,
    latest: inspectLatestNativeRepairProjection(committed),
    history: rebuildNativeRepairHistory(committed),
  };
}

function decisionFromInspection(
  inspection: NativeRepairHistoryInspection,
  maxVerifyFailures: number,
): NativeRepairDecisionProjection | null {
  const latest = inspection.latest;
  if (!latest) return null;
  const failures = inspection.history.filter((entry) => entry.kind === 'failure');
  const consecutiveFailures =
    failures.length === 0
      ? 0
      : nativeRepairConsecutiveFailures(
          {
            signatureHash: latest.signatureHash,
            ...(latest.contractHash === null
              ? {}
              : {
                  failedAcceptanceIds: latest.failedAcceptanceIds,
                  failedCheckIds: latest.failedCheckIds,
                }),
          },
          failures.slice(0, -1),
        );
  const overrideAccepted = latest.overrideSummaryHash !== null;
  const overrideAlreadyUsed = inspection.history.some(
    (entry) => entry.kind === 'override' && entry.signatureHash === latest.signatureHash,
  );
  const hardStop = failures.length >= maxVerifyFailures;
  const effectiveDisposition =
    latest.disposition === 'hard-stop' && !hardStop ? 'continue' : latest.disposition;
  return {
    disposition: hardStop ? 'hard-stop' : effectiveDisposition,
    reasonCode: overrideAccepted
      ? 'override-accepted'
      : overrideAlreadyUsed && latest.disposition === 'manual-stop'
        ? 'override-already-used'
        : hardStop
          ? 'repair-iteration-limit'
          : latest.disposition === 'manual-stop'
            ? 'repeated-failure-stop'
            : latest.disposition === 'warn'
              ? 'repeated-failure-warning'
              : 'new-failure-signature',
    signatureHash: latest.signatureHash,
    consecutiveFailures,
    totalRepairFailures: failures.length,
    remainingIterations: Math.max(0, maxVerifyFailures - failures.length),
    overrideAccepted,
  };
}

export async function inspectLatestNativeRepairDecision(
  paths: NativeProjectPaths,
  state: NativeChangeState,
  maxVerifyFailures: number,
): Promise<NativeRepairDecisionProjection | null> {
  return decisionFromInspection(await inspectNativeRepairHistory(paths, state), maxVerifyFailures);
}

export function projectNativeRepairDecision(
  result: NativeRepairRuntimeResult,
): NativeRepairDecisionProjection {
  return {
    disposition: result.decision.disposition,
    reasonCode: result.decision.reasonCode,
    signatureHash: result.decision.signature.signatureHash,
    consecutiveFailures: result.decision.consecutiveFailures,
    totalRepairFailures: result.decision.totalRepairFailures,
    remainingIterations: result.decision.remainingIterations,
    overrideAccepted: result.decision.overrideAccepted,
  };
}

export function nativeRepairFailedCheckIdsFromReceipts(
  receipts: readonly NativeVerificationReceipt[],
): string[] {
  return normalizeNativeRepairFailedCheckIds(
    receipts
      .filter((receipt) => receipt.status !== 'passed')
      .map((receipt) => nativeFailedCheckId(receipt)),
  );
}

export async function inspectNativeRepairFailureForTransition(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  envelope: NativeVerificationEvidenceEnvelope;
  maxVerifyFailures: number;
}): Promise<NativeRepairRuntimeResult> {
  if (!options.state.implementation_scope) {
    throw new Error('Native repair failure has no implementation scope');
  }
  const receiptRefs = [
    ...new Set([...options.envelope.requiredReceiptRefs, ...options.envelope.receiptRefs]),
  ];
  const [committed, implementationScope, receipts] = await Promise.all([
    readNativeCommittedRepairTrajectory(options.paths, options.state),
    readNativeImplementationScopeBundle(
      options.paths,
      options.state.name,
      options.state.implementation_scope,
    ),
    Promise.all(
      receiptRefs.map((ref) =>
        readNativeVerificationReceipt(options.paths, options.state.name, ref),
      ),
    ),
  ]);
  const failedCheckIds = nativeRepairFailedCheckIdsFromReceipts(receipts);
  return inspectNativeRepairFailure({
    ...committed,
    envelope: options.envelope,
    implementationScope,
    maxVerifyFailures: options.maxVerifyFailures,
    ...(failedCheckIds.length > 0 ? { failedCheckIds } : {}),
  });
}

/** Decide whether a stopped repair may leave Build, without trusting caller-supplied history. */
export async function inspectNativeRepairBuildGuard(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  currentImplementationScope: NativeImplementationScopeBundle;
  maxVerifyFailures: number;
  override?: { expectedSignatureHash: string; summary: string };
}): Promise<NativeRepairBuildGuard> {
  const inspection = await inspectNativeRepairHistory(options.paths, options.state);
  const latest = inspection.latest;
  const currentContractHash = parseNativeImplementationScopeBundle(
    options.currentImplementationScope,
  ).scope.contractHash;
  if (latest?.contractHash !== null && latest?.contractHash !== currentContractHash) {
    if (options.override) {
      throw new Error('Native repair override cannot cross a confirmed contract change');
    }
    return { disposition: 'proceed', eventProjection: null };
  }
  const totalFailures = inspection.history.filter((entry) => entry.kind === 'failure').length;
  if (latest && totalFailures >= options.maxVerifyFailures) {
    if (options.override) {
      throw new Error('Native repair hard stop cannot be overridden');
    }
    return {
      disposition: 'hard-stop',
      signatureHash: latest.signatureHash,
      overrideRecorded: inspection.history.some(
        (entry) => entry.kind === 'override' && entry.signatureHash === latest.signatureHash,
      ),
    };
  }
  const effectiveDisposition =
    latest?.disposition === 'hard-stop' && totalFailures < options.maxVerifyFailures
      ? 'continue'
      : latest?.disposition;
  if (!latest || (effectiveDisposition !== 'manual-stop' && effectiveDisposition !== 'hard-stop')) {
    if (options.override) {
      throw new Error('Native repair override requires the latest manual stop');
    }
    return { disposition: 'proceed', eventProjection: null };
  }

  const overrideRecorded = inspection.history.some(
    (entry) => entry.kind === 'override' && entry.signatureHash === latest.signatureHash,
  );
  const activeFailedRepair =
    options.state.phase === 'build' &&
    options.state.verification_result === 'fail' &&
    options.state.implementation_scope !== null &&
    options.state.verification_evidence !== null;
  if (!activeFailedRepair) {
    if (options.override) {
      throw new Error('Native repair override requires an active failed Verify-to-Build state');
    }
    return { disposition: 'proceed', eventProjection: null };
  }
  assertRepairableBuildState(options.state);
  const [previousEnvelope, previousImplementationScope] = await Promise.all([
    readNativeVerificationEvidence(
      options.paths,
      options.state.name,
      options.state.verification_evidence!,
    ),
    readNativeImplementationScopeBundle(
      options.paths,
      options.state.name,
      options.state.implementation_scope!,
    ),
  ]);
  if (previousImplementationScope.scope.scopeHash !== previousEnvelope.implementationScopeHash) {
    throw new Error('Native repair verification evidence does not match its implementation scope');
  }
  if (
    latest.contractHash === null &&
    nativeRepairScopeHash(options.currentImplementationScope) !==
      nativeRepairScopeHash(previousImplementationScope)
  ) {
    if (options.override) {
      throw new Error('Native repair override is not valid after implementation scope progress');
    }
    return { disposition: 'proceed', eventProjection: null };
  }
  if (latest.disposition === 'hard-stop') {
    if (options.override) {
      throw new Error(
        'Native repair hard stop cannot be overridden without implementation progress',
      );
    }
    return {
      disposition: 'hard-stop',
      signatureHash: latest.signatureHash,
      overrideRecorded,
    };
  }
  if (overrideRecorded) {
    return {
      disposition: 'hard-stop',
      signatureHash: latest.signatureHash,
      overrideRecorded,
    };
  }
  if (!options.override) {
    return {
      disposition: 'manual-stop',
      signatureHash: latest.signatureHash,
      overrideRecorded: false,
    };
  }
  return {
    disposition: 'proceed',
    eventProjection: acceptLatestNativeRepairOverride({
      ...inspection.committed,
      override: options.override,
    }).eventProjection,
  };
}

export async function inspectNativeRepairStatus(
  paths: NativeProjectPaths,
  state: NativeChangeState,
  maxVerifyFailures: number,
): Promise<NativeRepairStatusProjection | null> {
  if (state.phase !== 'build' || state.verification_result !== 'fail') return null;
  const inspection = await inspectNativeRepairHistory(paths, state);
  const latest = inspection.latest;
  if (!latest) return null;
  const failures = inspection.history.filter((entry) => entry.kind === 'failure');
  const hardStop = failures.length >= maxVerifyFailures;
  const effectiveDisposition =
    latest.disposition === 'hard-stop' && !hardStop ? 'continue' : latest.disposition;
  return {
    disposition: hardStop ? 'hard-stop' : effectiveDisposition,
    signatureHash: latest.signatureHash,
    overrideRecorded: inspection.history.some(
      (entry) => entry.kind === 'override' && entry.signatureHash === latest.signatureHash,
    ),
    failedAcceptanceIds: [...latest.failedAcceptanceIds],
    failedCheckIds: [...latest.failedCheckIds],
    totalVerifyFailures: failures.length,
    maxVerifyFailures,
    remainingVerifyFailures: Math.max(0, maxVerifyFailures - failures.length),
  };
}
