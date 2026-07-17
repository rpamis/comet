import { randomUUID } from 'crypto';

import { decideWithResolver, recordOutcomeWithResolver } from '../engine/loop.js';
import { readTrajectory } from '../engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { readRunStateAt, startRunWithStorage } from '../engine/storage-run.js';
import { inspectNativeGuard } from './native-guards.js';
import { nativeChangeDir, readNativeChange } from './native-change.js';
import { sha256Text } from './native-hash.js';
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
  continueNativeTransitionLocked,
  prepareNativeTransition,
  withNativeTransitionLock,
} from './native-transition-journal.js';
import type {
  NativeAdvanceEvidence,
  NativeAdvanceResult,
  NativePhase,
  NativeProjectPaths,
  NativeTransitionHooks,
} from './native-types.js';

function evidenceHash(evidence: NativeAdvanceEvidence): string {
  return sha256Text(
    JSON.stringify({
      summary: evidence.summary,
      confirmed: evidence.confirmed ?? false,
      artifacts: [...(evidence.artifacts ?? [])].sort(),
      noCodeReason: evidence.noCodeReason ?? null,
      verificationResult: evidence.verificationResult ?? null,
      verificationReport: evidence.verificationReport ?? null,
    }),
  );
}

interface AdvanceNativeChangeOptions {
  paths: NativeProjectPaths;
  name: string;
  evidence: NativeAdvanceEvidence;
  now?: Date;
  runId?: () => string;
  transitionId?: () => string;
  hooks?: NativeTransitionHooks;
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
  const hash = evidenceHash(options.evidence);
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
        nextCommand: state.phase === 'archive' ? `comet native archive ${state.name}` : null,
        findings: [],
        continuation: nativeContinuation({
          state,
          archiveReady: state.phase === 'archive' && state.verification_result === 'pass',
        }),
      };
    }
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
    ...(state.phase === 'build' ? { verification_result: 'pending' as const } : {}),
    ...(state.phase === 'verify'
      ? {
          verification_result: options.evidence.verificationResult!,
          verification_report: options.evidence.verificationReport ?? state.verification_report,
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
    nextCommand: persisted.phase === 'archive' ? `comet native archive ${persisted.name}` : null,
    findings: [],
    continuation: nativeContinuation({
      state: persisted,
      archiveReady: persisted.phase === 'archive' && persisted.verification_result === 'pass',
    }),
  };
}
