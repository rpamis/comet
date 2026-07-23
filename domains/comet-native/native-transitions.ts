import { randomUUID } from 'crypto';

import { decideWithResolver, recordOutcomeWithResolver } from '../engine/loop.js';
import { inspectNativeGuard } from './native-guards.js';
import { projectNativeAcceptancePage } from './native-acceptance.js';
import { nativeChangeDir, readNativeChange } from './native-change.js';
import { collectNativeContractFiles } from './native-contract-files.js';
import { inspectNativeBuildEvidence, persistNativeBuildEvidence } from './native-build-evidence.js';
import { nativeContinuation } from './native-continuation.js';
import { structureNativeFindings } from './native-findings.js';
import { settleNativeChangeJournalsLocked } from './native-change-recovery.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { redactNativeCredentialText } from './native-redaction.js';
import {
  inspectLatestNativeRepairDecision,
  inspectNativeRepairBuildGuard,
  inspectNativeRepairFailureForTransition,
  projectNativeRepairDecision,
} from './native-repair-integration.js';
import {
  nativeRepairScopeHash,
  type NativeRepairTrajectoryProjection,
} from './native-repair-runtime.js';
import {
  hashNativeRepairOverrideSummary,
  normalizeNativeRepairFailureTokens,
} from './native-repair-stagnation.js';
import {
  NATIVE_RUNTIME_HASH,
  NATIVE_RUNTIME_PACKAGE,
  nativePhaseResolver,
} from './native-runtime-package.js';
import { readNativeRunState, readNativeTrajectory, startNativeRun } from './native-run-store.js';
import { reconcileNativeSpecChanges } from './native-specs.js';
import {
  inspectNativeImplementationScopeFreshness,
  inspectNativeVerificationEvidence,
  inspectNativeVerificationFreshness,
  persistNativeVerificationEvidence,
} from './native-verification-runtime.js';
import {
  continueNativeTransitionLocked,
  prepareNativeTransition,
  withNativeTransitionLock,
} from './native-transition-journal.js';
import { nativeAdvanceEvidenceHash } from './native-transition-evidence.js';
import { assertNativeTrajectoryText } from './native-trajectory-limits.js';
import type {
  NativeAdvanceEvidence,
  NativeAdvanceResult,
  NativeChangeState,
  NativeClarificationMode,
  NativePhase,
  NativeProjectPaths,
  NativeRepairDecisionProjection,
  NativeTransitionHooks,
} from './native-types.js';

interface AdvanceNativeChangeOptions {
  paths: NativeProjectPaths;
  name: string;
  evidence: NativeAdvanceEvidence;
  clarificationMode: NativeClarificationMode;
  now?: Date;
  runId?: () => string;
  transitionId?: () => string;
  hooks?: NativeTransitionHooks;
}

function hasEvidenceRetreatExtras(evidence: NativeAdvanceEvidence): boolean {
  return (
    evidence.confirmed !== undefined ||
    evidence.artifacts !== undefined ||
    evidence.noCodeReason !== undefined ||
    evidence.allowPartialScopeHash !== undefined ||
    evidence.partialReason !== undefined ||
    evidence.verificationResult !== undefined ||
    evidence.verificationReport !== undefined ||
    evidence.verificationReceipt !== undefined ||
    evidence.repairFailureCategories !== undefined ||
    evidence.repairFailedCheckIds !== undefined ||
    evidence.repairOverrideSignature !== undefined ||
    evidence.repairOverrideSummary !== undefined
  );
}

function repairFinding(
  decision: Pick<NativeRepairDecisionProjection, 'disposition' | 'reasonCode' | 'signatureHash'>,
): { code: string; message: string } {
  if (decision.reasonCode === 'override-already-used') {
    return {
      code: 'repair-override-exhausted',
      message: `Native repair already used its override for signature: ${decision.signatureHash}`,
    };
  }
  if (decision.disposition === 'warn') {
    return {
      code: 'repair-stagnation-warning',
      message: `Native repair repeated the same failure signature: ${decision.signatureHash}`,
    };
  }
  if (decision.disposition === 'manual-stop') {
    return {
      code: 'repair-stagnation-stop',
      message: `Native repair stopped after repeated failure signature: ${decision.signatureHash}`,
    };
  }
  return {
    code: 'repair-iteration-limit',
    message: `Native repair reached its total iteration limit at signature: ${decision.signatureHash}`,
  };
}

function validateNativeAdvanceEvidence(evidence: NativeAdvanceEvidence): void {
  assertNativeTrajectoryText(evidence.summary, 'Native transition summary');
  if (evidence.noCodeReason !== undefined) {
    assertNativeTrajectoryText(evidence.noCodeReason, 'Native transition no-code reason');
  }
  if (
    evidence.repairFailureCategories !== undefined ||
    evidence.repairFailedCheckIds !== undefined
  ) {
    normalizeNativeRepairFailureTokens({
      categories: evidence.repairFailureCategories,
      failedCheckIds: evidence.repairFailedCheckIds,
    });
  }
  if (
    evidence.repairOverrideSignature !== undefined &&
    !/^[a-f0-9]{64}$/u.test(evidence.repairOverrideSignature)
  ) {
    throw new Error('Native repair override signature must be a SHA-256 hash');
  }
  if (evidence.repairOverrideSummary !== undefined) {
    hashNativeRepairOverrideSummary(evidence.repairOverrideSummary);
  }
}

function normalizeNativeAdvanceEvidence(evidence: NativeAdvanceEvidence): NativeAdvanceEvidence {
  return {
    ...evidence,
    summary: redactNativeCredentialText(evidence.summary),
    ...(evidence.noCodeReason === undefined
      ? {}
      : { noCodeReason: redactNativeCredentialText(evidence.noCodeReason) }),
    ...(evidence.partialReason === undefined
      ? {}
      : { partialReason: redactNativeCredentialText(evidence.partialReason) }),
    ...(evidence.repairOverrideSummary === undefined
      ? {}
      : { repairOverrideSummary: redactNativeCredentialText(evidence.repairOverrideSummary) }),
  };
}

function validateRepairEvidence(state: NativeChangeState, evidence: NativeAdvanceEvidence): void {
  const hasFailureFacts =
    evidence.repairFailureCategories !== undefined || evidence.repairFailedCheckIds !== undefined;
  if (hasFailureFacts && (state.phase !== 'verify' || evidence.verificationResult !== 'fail')) {
    throw new Error('Native repair failure facts are only valid for a failed Verify outcome');
  }
  const hasOverrideSignature = evidence.repairOverrideSignature !== undefined;
  const hasOverrideSummary = evidence.repairOverrideSummary !== undefined;
  if (hasOverrideSignature !== hasOverrideSummary) {
    throw new Error('Native repair override signature and summary must be provided together');
  }
  if ((hasOverrideSignature || hasOverrideSummary) && state.phase !== 'build') {
    throw new Error('Native repair override is only valid while leaving Build');
  }
}

async function retreatStaleNativeEvidence(options: {
  transition: AdvanceNativeChangeOptions;
  state: NativeChangeState;
  run: NonNullable<Awaited<ReturnType<typeof readNativeRunState>>>;
  evidenceHash: string;
}): Promise<NativeAdvanceResult> {
  if (hasEvidenceRetreatExtras(options.transition.evidence)) {
    throw new Error('Native evidence retreat only accepts a transition summary');
  }
  const previousPhase = options.state.phase;
  if (
    (previousPhase !== 'verify' && previousPhase !== 'archive') ||
    options.run.currentStep !== previousPhase ||
    options.run.pending !== null
  ) {
    throw new Error('Native Verify/Archive Run cannot retreat evidence safely');
  }
  const evidenceIsFresh =
    previousPhase === 'archive'
      ? ['complete', 'partial'].includes(
          (
            await inspectNativeVerificationFreshness({
              paths: options.transition.paths,
              state: options.state,
              now: options.transition.now,
            })
          ).freshness,
        )
      : (
          await inspectNativeImplementationScopeFreshness({
            paths: options.transition.paths,
            state: options.state,
            now: options.transition.now,
          })
        ).freshness === 'fresh';
  if (evidenceIsFresh) {
    const findings = structureNativeFindings({
      paths: options.transition.paths,
      state: options.state,
      findings: [
        previousPhase === 'archive'
          ? {
              code: 'archive-command-required',
              message: 'Current verification evidence is fresh; use Native Archive preview',
            }
          : {
              code: 'verification-result-missing',
              message:
                'Current implementation scope is fresh; complete Verify with a result and report',
            },
      ],
    });
    return {
      change: options.state,
      previousPhase,
      next: 'manual',
      nextCommand:
        previousPhase === 'archive' ? `comet native archive ${options.state.name} --dry-run` : null,
      findings,
      continuation: nativeContinuation({
        state: options.state,
        archiveReady: previousPhase === 'archive',
        clarificationMode: options.transition.clarificationMode,
      }),
    };
  }
  const nextState: NativeChangeState = {
    ...options.state,
    revision: options.state.revision + 1,
    phase: 'build',
    verification_result: 'pending',
    verification_report: null,
    implementation_scope: null,
    verification_evidence: null,
    partial_allowance: null,
  };
  const nextRun = {
    ...options.run,
    currentStep: 'build',
    iteration: options.run.iteration + 1,
    pending: null,
    status: 'running' as const,
  };
  const eventData = {
    previousPhase,
    nextPhase: 'build',
    evidenceHash: options.evidenceHash,
    summary: options.transition.evidence.summary,
    artifacts: [],
    noCodeReason: null,
    verificationResult: null,
  };
  const journal = await prepareNativeTransition({
    paths: options.transition.paths,
    previousState: options.state,
    nextState,
    previousRun: options.run,
    nextRun,
    evidenceHash: options.evidenceHash,
    eventData,
    operation: 'evidence-retreat',
    now: options.transition.now,
    transitionId: options.transition.transitionId,
  });
  await options.transition.hooks?.afterPrepared?.(journal);
  const persisted = await continueNativeTransitionLocked(
    options.transition.paths,
    options.state.name,
    options.transition.hooks,
  );
  if (!persisted) throw new Error('Native evidence retreat journal disappeared before completion');
  return {
    change: persisted,
    previousPhase,
    next: 'auto',
    nextCommand: null,
    findings: [],
    continuation: nativeContinuation({
      state: persisted,
      clarificationMode: options.transition.clarificationMode,
    }),
  };
}

export async function advanceNativeChange(
  options: AdvanceNativeChangeOptions,
): Promise<NativeAdvanceResult> {
  const normalizedOptions = {
    ...options,
    evidence: normalizeNativeAdvanceEvidence(options.evidence),
  };
  validateNativeAdvanceEvidence(normalizedOptions.evidence);
  return withNativeMutationLock(options.paths, `advance ${options.name}`, () =>
    withNativeTransitionLock(options.paths, options.name, `advance ${options.name}`, () =>
      advanceNativeChangeLocked(normalizedOptions),
    ),
  );
}

async function advanceNativeChangeLocked(
  options: AdvanceNativeChangeOptions,
): Promise<NativeAdvanceResult> {
  await settleNativeChangeJournalsLocked(options.paths, options.name);
  const state = await readNativeChange(options.paths, options.name);
  const previousPhase = state.phase;
  const changeDir = nativeChangeDir(options.paths, options.name);
  const hash = nativeAdvanceEvidenceHash(options.evidence);
  const existingRun = await readNativeRunState(changeDir);
  if (existingRun) {
    const trajectory = await readNativeTrajectory(changeDir, existingRun.trajectoryRef);
    const last = trajectory.at(-1);
    if (
      last?.type === 'state_transitioned' &&
      last.data.evidenceHash === hash &&
      last.data.nextPhase === state.phase
    ) {
      const repair = Object.hasOwn(last.data, 'repairStagnation')
        ? await inspectLatestNativeRepairDecision(options.paths, state)
        : null;
      const repairFindings =
        repair && repair.disposition !== 'continue'
          ? structureNativeFindings({
              paths: options.paths,
              state,
              findings: [repairFinding(repair)],
            })
          : [];
      const stopped = repair?.disposition === 'manual-stop' || repair?.disposition === 'hard-stop';
      return {
        change: state,
        previousPhase: (last.data.previousPhase as NativePhase) ?? state.phase,
        next: stopped ? 'manual' : 'auto',
        nextCommand: stopped
          ? null
          : state.phase === 'archive'
            ? `comet native archive ${state.name} --dry-run`
            : null,
        findings: repairFindings,
        continuation: nativeContinuation({
          state,
          findings: repairFindings,
          archiveReady: state.phase === 'archive' && state.verification_result === 'pass',
          clarificationMode: options.clarificationMode,
        }),
        ...(repair ? { repair } : {}),
      };
    }
  }

  if (state.phase === 'archive') {
    if (!existingRun) throw new Error('Native Archive Run state is missing');
    return retreatStaleNativeEvidence({
      transition: options,
      state,
      run: existingRun,
      evidenceHash: hash,
    });
  }
  if (state.phase === 'verify' && !hasEvidenceRetreatExtras(options.evidence)) {
    if (!existingRun) throw new Error('Native Verify Run state is missing');
    const freshness = await inspectNativeImplementationScopeFreshness({
      paths: options.paths,
      state,
      now: options.now,
    });
    if (freshness.freshness !== 'fresh') {
      return retreatStaleNativeEvidence({
        transition: options,
        state,
        run: existingRun,
        evidenceHash: hash,
      });
    }
  }

  const candidate = {
    ...state,
    spec_changes: await reconcileNativeSpecChanges(options.paths, state),
  };
  validateRepairEvidence(state, options.evidence);

  const guard = await inspectNativeGuard({
    paths: options.paths,
    state: candidate,
    evidence: options.evidence,
    clarificationMode: options.clarificationMode,
  });
  if (!guard.valid) {
    const findings = structureNativeFindings({
      paths: options.paths,
      state,
      findings: guard.findings,
    });
    return {
      change: state,
      previousPhase,
      next: 'manual',
      nextCommand: null,
      findings,
      continuation: nativeContinuation({
        state,
        findings,
        clarificationMode: options.clarificationMode,
      }),
    };
  }

  const shapeContract =
    state.phase === 'shape'
      ? await collectNativeContractFiles({
          changeDir,
          briefRef: candidate.brief,
          specChanges: candidate.spec_changes,
        })
      : null;

  if (
    state.phase !== 'build' &&
    (options.evidence.allowPartialScopeHash !== undefined ||
      options.evidence.partialReason !== undefined)
  ) {
    throw new Error('Native partial scope allowance is only valid while leaving Build');
  }

  const buildEvidence =
    state.phase === 'build'
      ? await inspectNativeBuildEvidence({
          paths: options.paths,
          state: candidate,
          artifactRefs: options.evidence.artifacts ?? [],
          noCodeReason: options.evidence.noCodeReason ?? null,
          allowPartialScopeHash: options.evidence.allowPartialScopeHash ?? null,
          partialReason: options.evidence.partialReason ?? null,
          confirmedSummary: options.evidence.summary,
          confirmed: options.evidence.confirmed ?? false,
          now: options.now,
        })
      : null;
  if (
    buildEvidence &&
    (state.approved_contract_hash ?? null) !== buildEvidence.contract.contract.contractHash &&
    !options.evidence.confirmed
  ) {
    const findings = structureNativeFindings({
      paths: options.paths,
      state,
      findings: [
        {
          code: 'contract-changed-after-approval',
          message:
            'Native contract changed after approval; re-confirm the current contract before leaving Build',
        },
      ],
    });
    return {
      change: state,
      previousPhase,
      next: 'manual',
      nextCommand: null,
      findings,
      continuation: nativeContinuation({
        state,
        findings,
        clarificationMode: options.clarificationMode,
      }),
    };
  }
  const preparedScope = buildEvidence
    ? {
        scopeHash: buildEvidence.bundle.scope.scopeHash,
        scopeRef: buildEvidence.scopeRef as NativeChangeState['implementation_scope'] & string,
        complete: buildEvidence.bundle.scope.complete,
        unresolvedScopeCount: buildEvidence.unresolvedScopes.length,
        partialAllowanceRef: buildEvidence.allowanceRef as NativeChangeState['partial_allowance'],
        acceptancePage: projectNativeAcceptancePage({
          criteria: buildEvidence.contract.contract.acceptance,
          acceptanceHash: buildEvidence.contract.contract.acceptanceHash,
        }),
      }
    : undefined;
  if (buildEvidence && buildEvidence.findings.length > 0) {
    await persistNativeBuildEvidence({
      paths: options.paths,
      state,
      preparation: buildEvidence,
      includeAllowance: false,
    });
    const findings = structureNativeFindings({
      paths: options.paths,
      state,
      findings: buildEvidence.findings,
    });
    return {
      change: state,
      previousPhase,
      next: 'manual',
      nextCommand: null,
      findings,
      continuation: nativeContinuation({
        state,
        findings,
        clarificationMode: options.clarificationMode,
      }),
      preparedScope,
    };
  }

  let repairEventProjection: NativeRepairTrajectoryProjection | null = null;
  let repairScopeHashForEvent = buildEvidence ? nativeRepairScopeHash(buildEvidence.bundle) : null;
  if (state.phase === 'build' && buildEvidence) {
    const repairGuard = await inspectNativeRepairBuildGuard({
      paths: options.paths,
      state,
      currentImplementationScope: buildEvidence.bundle,
      ...(options.evidence.repairOverrideSignature && options.evidence.repairOverrideSummary
        ? {
            override: {
              expectedSignatureHash: options.evidence.repairOverrideSignature,
              summary: options.evidence.repairOverrideSummary,
            },
          }
        : {}),
    });
    if (repairGuard.disposition !== 'proceed') {
      await persistNativeBuildEvidence({
        paths: options.paths,
        state,
        preparation: buildEvidence,
        includeAllowance: false,
      });
      const findings = structureNativeFindings({
        paths: options.paths,
        state,
        findings: [
          repairGuard.disposition === 'hard-stop' && repairGuard.overrideRecorded
            ? {
                code: 'repair-override-exhausted',
                message: `Native repair already used its override for signature: ${repairGuard.signatureHash}`,
              }
            : repairFinding({
                disposition: repairGuard.disposition,
                reasonCode:
                  repairGuard.disposition === 'hard-stop'
                    ? 'repair-iteration-limit'
                    : 'repeated-failure-stop',
                signatureHash: repairGuard.signatureHash,
              }),
        ],
      });
      return {
        change: state,
        previousPhase,
        next: 'manual',
        nextCommand: null,
        findings,
        continuation: nativeContinuation({
          state,
          findings,
          clarificationMode: options.clarificationMode,
        }),
        preparedScope: preparedScope
          ? { ...preparedScope, partialAllowanceRef: null }
          : preparedScope,
      };
    }
    repairEventProjection = repairGuard.eventProjection;
  }

  const verificationEvidence =
    state.phase === 'verify'
      ? await inspectNativeVerificationEvidence({
          paths: options.paths,
          state: candidate,
          result: options.evidence.verificationResult!,
          reportRef: options.evidence.verificationReport!,
          receiptRef: options.evidence.verificationReceipt ?? null,
          now: options.now,
        })
      : null;
  if (verificationEvidence && !verificationEvidence.ready) {
    const findings = structureNativeFindings({
      paths: options.paths,
      state,
      findings: verificationEvidence.findingCodes.map((code) => ({
        code,
        message: `Native verification evidence is not current: ${code}`,
      })),
    });
    return {
      change: state,
      previousPhase,
      next: 'manual',
      nextCommand: null,
      findings,
      continuation: nativeContinuation({
        state,
        findings,
        clarificationMode: options.clarificationMode,
      }),
    };
  }

  let repairDecision: NativeRepairDecisionProjection | null = null;
  if (
    state.phase === 'verify' &&
    options.evidence.verificationResult === 'fail' &&
    verificationEvidence?.ready &&
    verificationEvidence.envelope
  ) {
    const repairResult = await inspectNativeRepairFailureForTransition({
      paths: options.paths,
      state,
      envelope: verificationEvidence.envelope,
      ...(options.evidence.repairFailureCategories
        ? { categories: options.evidence.repairFailureCategories }
        : {}),
      ...(options.evidence.repairFailedCheckIds
        ? { failedCheckIds: options.evidence.repairFailedCheckIds }
        : {}),
    });
    repairEventProjection = repairResult.eventProjection;
    repairScopeHashForEvent = repairResult.facts.implementationScopeHash;
    repairDecision = projectNativeRepairDecision(repairResult);
  }

  let run = existingRun;
  if (!run) {
    if (state.run_id !== null || state.phase !== 'shape') {
      throw new Error('Native Run state is missing or inconsistent');
    }
    run = startNativeRun(
      NATIVE_RUNTIME_PACKAGE,
      options.runId?.() ?? randomUUID(),
      NATIVE_RUNTIME_HASH,
    );
  }
  if (run.currentStep !== state.phase) {
    throw new Error(`Native Run step ${run.currentStep ?? '(none)'} does not match ${state.phase}`);
  }
  const decision = decideWithResolver(
    NATIVE_RUNTIME_PACKAGE,
    run,
    new Set(),
    nativePhaseResolver,
    undefined,
  );
  if (!decision.action) throw new Error(decision.reason ?? 'Native runtime produced no action');
  const advanced = recordOutcomeWithResolver(
    NATIVE_RUNTIME_PACKAGE,
    decision.state,
    {
      actionId: decision.action.id,
      status: 'succeeded',
      summary: options.evidence.summary,
      state: options.evidence.verificationResult
        ? { verification_result: options.evidence.verificationResult }
        : undefined,
    },
    nativePhaseResolver,
    undefined,
  );
  if (!advanced.currentStep) throw new Error('Archive completion must use the archive command');

  const updated = {
    ...candidate,
    revision: state.revision + 1,
    phase: advanced.currentStep as NativePhase,
    approval: options.evidence.confirmed
      ? ('confirmed' as const)
      : state.phase === 'shape' && state.approval === null
        ? ('implicit' as const)
        : state.approval,
    approved_contract_hash:
      state.phase === 'shape'
        ? shapeContract!.contract.contractHash
        : state.phase === 'build' && options.evidence.confirmed
          ? buildEvidence!.contract.contract.contractHash
          : (state.approved_contract_hash ?? null),
    run_id: run.runId,
    ...(state.phase === 'build'
      ? {
          verification_result: 'pending' as const,
          verification_report: null,
          implementation_scope: buildEvidence!
            .scopeRef as NativeChangeState['implementation_scope'],
          partial_allowance: buildEvidence!.allowanceRef as NativeChangeState['partial_allowance'],
          verification_evidence: null,
        }
      : {}),
    ...(state.phase === 'verify'
      ? {
          verification_result: options.evidence.verificationResult!,
          verification_report: verificationEvidence!.envelope!.reportRef,
          verification_evidence: verificationEvidence!
            .evidenceRef as NativeChangeState['verification_evidence'],
        }
      : {}),
  };
  const eventData = {
    previousPhase,
    nextPhase: updated.phase,
    evidenceHash: hash,
    summary: options.evidence.summary,
    artifacts: options.evidence.artifacts ?? [],
    noCodeReason: options.evidence.noCodeReason ?? null,
    verificationResult: options.evidence.verificationResult ?? null,
    ...((state.phase === 'build' || state.phase === 'verify') &&
    (state.phase === 'build'
      ? buildEvidence!.bundle.scope.scopeHash
      : verificationEvidence!.envelope!.implementationScopeHash)
      ? {
          implementationScopeHash:
            state.phase === 'build'
              ? buildEvidence!.bundle.scope.scopeHash
              : verificationEvidence!.envelope!.implementationScopeHash,
        }
      : {}),
    ...(repairScopeHashForEvent ? { repairScopeHash: repairScopeHashForEvent } : {}),
    ...(repairEventProjection ? { repairStagnation: repairEventProjection } : {}),
  };
  if (state.phase === 'build' && buildEvidence) {
    await persistNativeBuildEvidence({
      paths: options.paths,
      state,
      preparation: buildEvidence,
    });
  }
  if (state.phase === 'verify' && verificationEvidence) {
    await persistNativeVerificationEvidence({
      paths: options.paths,
      state,
      preparation: verificationEvidence,
    });
  }
  const journal = await prepareNativeTransition({
    paths: options.paths,
    previousState: state,
    nextState: updated,
    previousRun: existingRun,
    nextRun: advanced,
    evidenceHash: hash,
    eventData,
    now: options.now,
    transitionId: options.transitionId,
  });
  await options.hooks?.afterPrepared?.(journal);
  const persisted = await continueNativeTransitionLocked(
    options.paths,
    options.name,
    options.hooks,
  );
  if (!persisted) throw new Error('Native transition journal disappeared before completion');
  const repairFindings =
    repairDecision && repairDecision.disposition !== 'continue'
      ? structureNativeFindings({
          paths: options.paths,
          state: persisted,
          findings: [repairFinding(repairDecision)],
        })
      : [];
  const repairStopped =
    repairDecision?.disposition === 'manual-stop' || repairDecision?.disposition === 'hard-stop';
  return {
    change: persisted,
    previousPhase,
    next: repairStopped ? 'manual' : 'auto',
    nextCommand: repairStopped
      ? null
      : persisted.phase === 'archive'
        ? `comet native archive ${persisted.name} --dry-run`
        : null,
    findings: repairFindings,
    continuation: nativeContinuation({
      state: persisted,
      findings: repairFindings,
      archiveReady: persisted.phase === 'archive' && persisted.verification_result === 'pass',
      clarificationMode: options.clarificationMode,
    }),
    ...(preparedScope ? { preparedScope } : {}),
    ...(repairDecision ? { repair: repairDecision } : {}),
  };
}
