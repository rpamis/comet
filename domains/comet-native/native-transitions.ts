import { randomUUID } from 'crypto';

import { decideWithResolver, recordOutcomeWithResolver } from '../engine/loop.js';
import { readTrajectory } from '../engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { readRunStateAt, startRunWithStorage, writeRunStateAt } from '../engine/storage-run.js';
import { inspectNativeGuard } from './native-guards.js';
import { nativeChangeDir, readNativeChange, writeNativeChange } from './native-change.js';
import { assertNoPendingNativeRootMove } from './native-config.js';
import { sha256Text } from './native-hash.js';
import {
  NATIVE_RUNTIME_HASH,
  NATIVE_RUNTIME_PACKAGE,
  nativePhaseResolver,
} from './native-runtime-package.js';
import { appendNativeTrajectoryEvent, writeNativeCheckpoint } from './native-trajectory.js';
import type {
  NativeAdvanceEvidence,
  NativeAdvanceResult,
  NativePhase,
  NativeProjectPaths,
} from './native-types.js';

function evidenceHash(evidence: NativeAdvanceEvidence): string {
  return sha256Text(
    JSON.stringify({
      summary: evidence.summary,
      artifacts: [...(evidence.artifacts ?? [])].sort(),
      noCodeReason: evidence.noCodeReason ?? null,
      verificationResult: evidence.verificationResult ?? null,
      verificationReport: evidence.verificationReport ?? null,
    }),
  );
}

export async function advanceNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
  evidence: NativeAdvanceEvidence;
  now?: Date;
  runId?: () => string;
}): Promise<NativeAdvanceResult> {
  await assertNoPendingNativeRootMove(options.paths.projectRoot);
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
      };
    }
  }

  const guard = await inspectNativeGuard({
    paths: options.paths,
    state,
    evidence: options.evidence,
  });
  if (!guard.valid) {
    return {
      change: state,
      previousPhase,
      next: 'manual',
      nextCommand: null,
      findings: guard.findings,
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
    await appendNativeTrajectoryEvent({
      changeDir,
      run,
      type: 'run_started',
      data: { runtime: 'comet-native', phase: state.phase },
      now: options.now,
    });
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
    ...state,
    phase: advanced.currentStep as NativePhase,
    approval:
      state.phase === 'shape' && state.approval === null && !state.confirmation_required
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
  await writeRunStateAt(changeDir, advanced, NATIVE_RUN_STORAGE);
  await writeNativeChange(options.paths, updated);
  const event = await appendNativeTrajectoryEvent({
    changeDir,
    run: advanced,
    type: 'state_transitioned',
    data: {
      previousPhase,
      nextPhase: updated.phase,
      evidenceHash: hash,
      summary: options.evidence.summary,
      artifacts: options.evidence.artifacts ?? [],
      noCodeReason: options.evidence.noCodeReason ?? null,
      verificationResult: options.evidence.verificationResult ?? null,
    },
    now: options.now,
  });
  await writeNativeCheckpoint({
    changeDir,
    run: advanced,
    trajectoryOffset: event.sequence,
    evidenceHash: hash,
    now: options.now,
  });
  return {
    change: updated,
    previousPhase,
    next: 'auto',
    nextCommand: updated.phase === 'archive' ? `comet native archive ${updated.name}` : null,
    findings: [],
  };
}
