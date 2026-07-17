import { randomUUID } from 'crypto';

import { decideWithResolver, recordOutcomeWithResolver } from '../engine/loop.js';
import { readTrajectory } from '../engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { readRunStateAt, startRunWithStorage } from '../engine/storage-run.js';
import { inspectNativeGuard } from './native-guards.js';
import { nativeChangeDir, readNativeChange } from './native-change.js';
import { prepareNativeBuildEvidence } from './native-build-evidence.js';
import { nativeContinuation } from './native-continuation.js';
import { structureNativeFindings } from './native-findings.js';
import { settleNativeChangeJournalsLocked } from './native-change-recovery.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  NATIVE_RUNTIME_HASH,
  NATIVE_RUNTIME_PACKAGE,
  nativePhaseResolver,
} from './native-runtime-package.js';
import { reconcileNativeSpecChanges } from './native-specs.js';
import {
  inspectNativeVerificationFreshness,
  prepareNativeVerificationEvidence,
} from './native-verification-runtime.js';
import {
  continueNativeTransitionLocked,
  prepareNativeTransition,
  withNativeTransitionLock,
} from './native-transition-journal.js';
import { nativeAdvanceEvidenceHash } from './native-transition-evidence.js';
import type {
  NativeAdvanceEvidence,
  NativeAdvanceResult,
  NativeChangeState,
  NativePhase,
  NativeProjectPaths,
  NativeTransitionHooks,
} from './native-types.js';

interface AdvanceNativeChangeOptions {
  paths: NativeProjectPaths;
  name: string;
  evidence: NativeAdvanceEvidence;
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
    evidence.verificationReport !== undefined
  );
}

async function retreatStaleNativeEvidence(options: {
  transition: AdvanceNativeChangeOptions;
  state: NativeChangeState;
  run: NonNullable<Awaited<ReturnType<typeof readRunStateAt>>>;
  evidenceHash: string;
}): Promise<NativeAdvanceResult> {
  if (hasEvidenceRetreatExtras(options.transition.evidence)) {
    throw new Error('Native evidence retreat only accepts a transition summary');
  }
  if (options.run.currentStep !== 'archive' || options.run.pending !== null) {
    throw new Error('Native Archive Run cannot retreat evidence safely');
  }
  const freshness = await inspectNativeVerificationFreshness({
    paths: options.transition.paths,
    state: options.state,
    now: options.transition.now,
  });
  if (freshness.freshness === 'complete' || freshness.freshness === 'partial') {
    const findings = structureNativeFindings({
      paths: options.transition.paths,
      state: options.state,
      findings: [
        {
          code: 'archive-command-required',
          message: 'Current verification evidence is fresh; use Native Archive preview',
        },
      ],
    });
    return {
      change: options.state,
      previousPhase: 'archive',
      next: 'manual',
      nextCommand: `comet native archive ${options.state.name} --dry-run`,
      findings,
      continuation: nativeContinuation({
        state: options.state,
        archiveReady: true,
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
    previousPhase: 'archive',
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
    previousPhase: 'archive',
    next: 'auto',
    nextCommand: null,
    findings: [],
    continuation: nativeContinuation({ state: persisted }),
  };
}

export async function advanceNativeChange(
  options: AdvanceNativeChangeOptions,
): Promise<NativeAdvanceResult> {
  return withNativeMutationLock(options.paths, `advance ${options.name}`, () =>
    withNativeTransitionLock(options.paths, options.name, `advance ${options.name}`, () =>
      advanceNativeChangeLocked(options),
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
  const existingRun = await readRunStateAt(changeDir, NATIVE_RUN_STORAGE);
  if (existingRun) {
    const trajectory = await readTrajectory(changeDir, existingRun.trajectoryRef);
    const last = trajectory.at(-1);
    if (
      last?.type === 'state_transitioned' &&
      last.data.evidenceHash === hash &&
      last.data.nextPhase === state.phase
    ) {
      return {
        change: state,
        previousPhase: (last.data.previousPhase as NativePhase) ?? state.phase,
        next: 'auto',
        nextCommand:
          state.phase === 'archive' ? `comet native archive ${state.name} --dry-run` : null,
        findings: [],
        continuation: nativeContinuation({
          state,
          archiveReady: state.phase === 'archive' && state.verification_result === 'pass',
        }),
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

  const candidate = {
    ...state,
    spec_changes: await reconcileNativeSpecChanges(options.paths, state),
  };

  const guard = await inspectNativeGuard({
    paths: options.paths,
    state: candidate,
    evidence: options.evidence,
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
      continuation: nativeContinuation({ state, findings }),
    };
  }

  if (
    state.phase !== 'build' &&
    (options.evidence.allowPartialScopeHash !== undefined ||
      options.evidence.partialReason !== undefined)
  ) {
    throw new Error('Native partial scope allowance is only valid while leaving Build');
  }

  const buildEvidence =
    state.phase === 'build'
      ? await prepareNativeBuildEvidence({
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
  const preparedScope = buildEvidence
    ? {
        scopeHash: buildEvidence.bundle.scope.scopeHash,
        scopeRef: buildEvidence.scopeRef as NativeChangeState['implementation_scope'] & string,
        complete: buildEvidence.bundle.scope.complete,
        unresolvedScopeCount: buildEvidence.unresolvedScopes.length,
        partialAllowanceRef: buildEvidence.allowanceRef as NativeChangeState['partial_allowance'],
      }
    : undefined;
  if (buildEvidence && buildEvidence.findings.length > 0) {
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
      continuation: nativeContinuation({ state, findings }),
      preparedScope,
    };
  }

  const verificationEvidence =
    state.phase === 'verify'
      ? await prepareNativeVerificationEvidence({
          paths: options.paths,
          state: candidate,
          result: options.evidence.verificationResult!,
          reportRef: options.evidence.verificationReport!,
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
      continuation: nativeContinuation({ state, findings }),
    };
  }

  let run = existingRun;
  if (!run) {
    if (state.run_id !== null || state.phase !== 'shape') {
      throw new Error('Native Run state is missing or inconsistent');
    }
    run = startRunWithStorage(
      NATIVE_RUNTIME_PACKAGE,
      options.runId?.() ?? randomUUID(),
      NATIVE_RUNTIME_HASH,
      NATIVE_RUN_STORAGE,
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
  };
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
  return {
    change: persisted,
    previousPhase,
    next: 'auto',
    nextCommand:
      persisted.phase === 'archive' ? `comet native archive ${persisted.name} --dry-run` : null,
    findings: [],
    continuation: nativeContinuation({
      state: persisted,
      archiveReady: persisted.phase === 'archive' && persisted.verification_result === 'pass',
    }),
    ...(preparedScope ? { preparedScope } : {}),
  };
}
