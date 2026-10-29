import { resolveClassicCheckTimeout } from './classic-project-config.js';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { appendTrajectory } from './classic-run-store.js';
import type { RuntimeAction } from '../engine/runtime-action.js';
import {
  markRuntimeActionUnknown,
  retryRuntimeAction,
  claimRuntimeAction,
} from '../engine/runtime-action.js';
import type { RunState, TrajectoryEvent } from '../engine/types.js';
import { terminateProcessTree } from '../../platform/process/terminate-process-tree.js';
import { spawnCommand } from '../../platform/process/spawn-command.js';
import { reportCometRuntimeProgress } from '../../platform/process/runtime-metrics.js';
import {
  checkEnvironmentFingerprint,
  collectCheckSnapshot,
  legacyCheckInputFingerprint,
} from './classic-check-snapshot.js';
import {
  inspectClassicProjectTarget,
  readClassicProjectFile,
  writeClassicProjectText,
} from './classic-protected-path.js';
import { readClassicState, withClassicStateLock } from './classic-store.js';
import type { ClassicState } from './classic-state.js';
import {
  completeClassicCheckAction,
  completedClassicCheckAction,
  runningClassicCheckAction,
  startClassicCheckAction,
} from './classic-check-action.js';
import { readCheckIndex } from './classic-check-index.js';
import { readCheckPolicy } from './classic-check-policy.js';
import { hashRuntimeValue } from '../engine/runtime-json.js';
import {
  classicCheckInputsRetained,
  classicCompatCheckExecutionRef,
  classicEditReviewScope,
  classicFormalEditReviewScope,
  observeClassicCompatCheckInputs,
} from './classic-edit-review.js';
import {
  areObservedEditsNonBehavioral,
  assertEditReviewsComplete,
} from '../workflow-contract/edit-review.js';
import { classicDocumentEvidenceMode } from './classic-neutral-documents.js';
import {
  checkManifestHash,
  diffCheckManifests,
  parseCheckManifest,
  type CheckManifestEntry,
} from './classic-check-manifest.js';

export type CommandCheckScope = 'build' | 'verify';

export interface RecordedCommandCheck {
  sequence: number;
  timestamp: string;
  runId: string;
  scope: CommandCheckScope;
  command: string;
  exitCode: number;
  cwd: string;
  provenance?: 'runtime';
  argv?: string[];
  timeoutMs?: number;
  inputBefore?: string;
  inputAfter?: string;
  /** Input paths whose contents changed during this execution. */
  changedDuringExecution?: string[];
  environment?: string;
  logRef?: string;
  logHash?: string;
  /**
   * Post-write stat of the evidence log. Revalidation trusts an unchanged
   * size+mtime instead of rereading the whole log; records without these
   * fields (or a changed stat) keep the full content-hash check.
   */
  logSize?: number;
  logMtimeNs?: string;
  /** Repository-relative per-file input manifest recorded at execution time. */
  manifestRef?: string;
  manifestHash?: string;
  /** Incremental evidence maintains validity inside a phase; only full evidence advances it. */
  tier?: 'full' | 'incremental';
  reusable?: boolean;
  reused?: boolean;
  checkEpoch?: number;
  action?: RuntimeAction;
}

/**
 * The exact Runtime command identity persisted before snapshotting or launch.
 * A started event may be the only durable evidence left after interruption, so
 * it must contain enough data for `comet check rerun` to retry without guessing.
 */
export interface RecordedCommandCheckAttempt {
  sequence: number;
  timestamp: string;
  runId: string;
  scope: CommandCheckScope;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  reusable: boolean;
  tier: 'full' | 'incremental';
  action?: RuntimeAction;
}

export interface RecordCommandCheckInput {
  scope: CommandCheckScope;
  command: string;
  exitCode: number;
  cwd?: string;
}

function validateScope(scope: unknown): asserts scope is CommandCheckScope {
  if (scope !== 'build' && scope !== 'verify') {
    throw new Error(`Invalid command check scope: '${String(scope)}'`);
  }
}

function normalizedCwd(projectRoot: string, cwd = '.'): string {
  if (cwd.trim().length === 0) throw new Error('Command check cwd cannot be blank');
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, cwd);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Command check cwd must resolve within the project root: '${cwd}'`);
  }
  return path.relative(root, target).replaceAll('\\', '/') || '.';
}

function validRecord(projectRoot: string, event: TrajectoryEvent): RecordedCommandCheck | null {
  if (event.type !== 'command_check_recorded' && event.type !== 'command_check_executed')
    return null;
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { scope, command, exitCode, cwd } = data as Record<string, unknown>;
  if (
    (scope !== 'build' && scope !== 'verify') ||
    typeof command !== 'string' ||
    command.trim().length === 0 ||
    !Number.isInteger(exitCode) ||
    typeof cwd !== 'string'
  ) {
    return null;
  }
  let normalized: string;
  try {
    normalized = normalizedCwd(projectRoot, cwd);
  } catch {
    return null;
  }
  const action =
    (data as Record<string, unknown>).action === undefined
      ? undefined
      : completedClassicCheckAction((data as Record<string, unknown>).action, {
          runId: event.runId,
          scope,
          argv: (data as RecordedCommandCheck).argv,
          cwd: normalized,
          timeoutMs: (data as RecordedCommandCheck).timeoutMs,
          tier: (data as RecordedCommandCheck).tier,
          checkEpoch: (data as RecordedCommandCheck).checkEpoch,
          exitCode: exitCode as number,
          inputBefore: (data as RecordedCommandCheck).inputBefore,
          inputAfter: (data as RecordedCommandCheck).inputAfter,
          logHash: (data as RecordedCommandCheck).logHash,
          manifestHash: (data as RecordedCommandCheck).manifestHash,
        });
  if ((data as Record<string, unknown>).action !== undefined && !action) return null;
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    runId: event.runId,
    scope,
    command,
    exitCode: exitCode as number,
    cwd: normalized,
    ...(event.type === 'command_check_executed'
      ? {
          provenance: 'runtime' as const,
          argv: (data as RecordedCommandCheck).argv,
          timeoutMs:
            typeof (data as RecordedCommandCheck).timeoutMs === 'number'
              ? (data as RecordedCommandCheck).timeoutMs
              : undefined,
          inputBefore: (data as RecordedCommandCheck).inputBefore,
          inputAfter: (data as RecordedCommandCheck).inputAfter,
          changedDuringExecution: Array.isArray(
            (data as RecordedCommandCheck).changedDuringExecution,
          )
            ? (data as RecordedCommandCheck).changedDuringExecution?.filter(
                (entry): entry is string => typeof entry === 'string',
              )
            : undefined,
          environment: (data as RecordedCommandCheck).environment,
          logRef: (data as RecordedCommandCheck).logRef,
          logHash: (data as RecordedCommandCheck).logHash,
          logSize:
            typeof (data as RecordedCommandCheck).logSize === 'number'
              ? (data as RecordedCommandCheck).logSize
              : undefined,
          logMtimeNs:
            typeof (data as RecordedCommandCheck).logMtimeNs === 'string'
              ? (data as RecordedCommandCheck).logMtimeNs
              : undefined,
          manifestRef:
            typeof (data as RecordedCommandCheck).manifestRef === 'string'
              ? (data as RecordedCommandCheck).manifestRef
              : undefined,
          manifestHash:
            typeof (data as RecordedCommandCheck).manifestHash === 'string'
              ? (data as RecordedCommandCheck).manifestHash
              : undefined,
          tier: (data as RecordedCommandCheck).tier === 'incremental' ? 'incremental' : undefined,
          reusable: (data as RecordedCommandCheck).reusable,
          checkEpoch: (data as RecordedCommandCheck).checkEpoch,
          ...(action ? { action } : {}),
        }
      : {}),
  };
}

export async function recordCommandCheck(
  projectRoot: string,
  changeDir: string,
  run: RunState,
  input: RecordCommandCheckInput,
): Promise<RecordedCommandCheck> {
  validateScope(input.scope);
  if (typeof input.command !== 'string' || input.command.trim().length === 0) {
    throw new Error('Command check command cannot be blank');
  }
  if (!Number.isInteger(input.exitCode)) {
    throw new Error('Command check exitCode must be an integer');
  }
  return withClassicStateLock(changeDir, async () => {
    const index = await readCheckIndex(changeDir, run.trajectoryRef);
    const recorded: RecordedCommandCheck = {
      sequence: index.maximumSequence + 1,
      timestamp: new Date().toISOString(),
      runId: run.runId,
      scope: input.scope,
      command: input.command,
      exitCode: input.exitCode,
      cwd: normalizedCwd(projectRoot, input.cwd),
    };
    await appendTrajectory(changeDir, run.trajectoryRef, {
      sequence: recorded.sequence,
      timestamp: recorded.timestamp,
      type: 'command_check_recorded',
      runId: recorded.runId,
      data: {
        scope: recorded.scope,
        command: recorded.command,
        exitCode: recorded.exitCode,
        cwd: recorded.cwd,
      },
    });
    return recorded;
  });
}

export async function latestCommandCheck(
  projectRoot: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
): Promise<RecordedCommandCheck | null> {
  validateScope(scope);
  const trajectory = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
  for (let index = trajectory.length - 1; index >= 0; index -= 1) {
    const event = trajectory[index];
    if (event.runId !== run.runId) continue;
    if (
      event.type === 'command_checks_invalidated' &&
      (!Array.isArray(event.data?.scopes) || event.data.scopes.includes(scope))
    )
      return null;
    if (event.type === 'command_check_started' && event.data?.scope === scope) return null;
    if (event.type === 'command_check_consumed' && event.data?.scope === scope) return null;
    const record = validRecord(projectRoot, event);
    if (record?.scope === scope) {
      if (record.action && !hasMatchingCheckStart(projectRoot, trajectory, index, record))
        return null;
      if (path.basename(path.dirname(changeDir)) === 'archive') {
        const name = path.basename(changeDir).replace(/^\d{4}-\d{2}-\d{2}-/u, '');
        const archivedRef = path.relative(projectRoot, changeDir).replaceAll('\\', '/');
        const relocate = (ref: string | undefined) => {
          if (!ref) return ref;
          const match = /^(?:docs\/)?openspec\/changes\/([^/]+)\/\.comet\/(checks\/.*)$/u.exec(ref);
          return match?.[1] === name ? `${archivedRef}/.comet/${match[2]}` : ref;
        };
        return {
          ...record,
          logRef: relocate(record.logRef),
          manifestRef: relocate(record.manifestRef),
        };
      }
      return record;
    }
    if (
      event.type === 'command_check_executed' &&
      event.data?.scope === scope &&
      event.data.action !== undefined
    )
      return null;
  }
  return null;
}

function hasMatchingCheckStart(
  projectRoot: string,
  events: readonly TrajectoryEvent[],
  completedIndex: number,
  record: RecordedCommandCheck,
): boolean {
  for (let index = completedIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.runId !== record.runId || event.data?.scope !== record.scope) continue;
    if (event.type !== 'command_check_started') return false;
    const started = validStartedAttempt(projectRoot, event);
    const startedAction = started?.action;
    const completedAction = record.action;
    return (
      !!startedAction &&
      !!completedAction &&
      startedAction.id === completedAction.id &&
      startedAction.inputHash === completedAction.inputHash &&
      startedAction.attempt === completedAction.attempt
    );
  }
  return false;
}

function validStartedAttempt(
  projectRoot: string,
  event: TrajectoryEvent,
): RecordedCommandCheckAttempt | null {
  if (event.type !== 'command_check_started') return null;
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { scope, argv, cwd, timeoutMs, reusable, tier } = data as Record<string, unknown>;
  if (
    (scope !== 'build' && scope !== 'verify') ||
    !Array.isArray(argv) ||
    argv.length === 0 ||
    argv.some((argument) => typeof argument !== 'string' || argument.includes('\0')) ||
    typeof cwd !== 'string' ||
    !Number.isInteger(timeoutMs) ||
    Number(timeoutMs) < 1 ||
    typeof reusable !== 'boolean' ||
    (tier !== 'full' && tier !== 'incremental')
  ) {
    return null;
  }
  let normalized: string;
  try {
    normalized = normalizedCwd(projectRoot, cwd);
  } catch {
    return null;
  }
  const action =
    (data as Record<string, unknown>).action === undefined
      ? undefined
      : runningClassicCheckAction((data as Record<string, unknown>).action, {
          runId: event.runId,
          scope,
          argv: argv as string[],
          cwd: normalized,
          timeoutMs: Number(timeoutMs),
          tier,
          checkEpoch: (data as Record<string, unknown>).checkEpoch,
        });
  if ((data as Record<string, unknown>).action !== undefined && !action) return null;
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    runId: event.runId,
    scope,
    argv: [...argv] as string[],
    cwd: normalized,
    timeoutMs: Number(timeoutMs),
    reusable,
    tier,
    ...(action ? { action } : {}),
  };
}

/** Returns only an unfinished latest attempt; older executions remain fenced. */
export async function latestInterruptedCommandCheck(
  projectRoot: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
): Promise<RecordedCommandCheckAttempt | null> {
  validateScope(scope);
  const trajectory = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
  for (let index = trajectory.length - 1; index >= 0; index -= 1) {
    const event = trajectory[index];
    if (event.runId !== run.runId) continue;
    const touchesScope =
      event.data?.scope === scope ||
      (Array.isArray(event.data?.scopes) && event.data.scopes.includes(scope));
    if (!touchesScope) continue;
    if (event.type === 'command_check_started') return validStartedAttempt(projectRoot, event);
    const record = validRecord(projectRoot, event);
    if (record?.scope === scope && record.provenance === 'runtime' && record.argv?.length) {
      return {
        sequence: record.sequence,
        timestamp: record.timestamp,
        runId: record.runId,
        scope: record.scope,
        argv: [...record.argv],
        cwd: record.cwd,
        timeoutMs: record.timeoutMs ?? 300_000,
        reusable: record.reusable === true,
        tier: record.tier ?? 'full',
      };
    }
    // Cold recovery fences the evidence but deliberately leaves the exact
    // Runtime plan discoverable above it. Do not let the fence erase the only
    // command identity and force Guard to guess a replacement command.
    if (event.type === 'command_checks_invalidated') continue;
    return null;
  }
  return null;
}

export async function invalidateCommandChecks(changeDir: string, run: RunState): Promise<void> {
  await checkEvent(changeDir, run, 'command_checks_invalidated', { reason: 'cold-recovery' });
}

/**
 * Explains why no record is visible when a `command_check_started` event
 * without a completing event is the latest trajectory entry for the scope —
 * the attempt was interrupted (killed, timed out during snapshotting, or the
 * process died) and must not expose an older success.
 */
export async function interruptedCommandCheckReason(
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
): Promise<string | null> {
  const trajectory = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
  for (let index = trajectory.length - 1; index >= 0; index -= 1) {
    const event = trajectory[index];
    if (event.runId !== run.runId) continue;
    const touchesScope =
      event.data?.scope === scope ||
      (Array.isArray(event.data?.scopes) && event.data.scopes.includes(scope));
    if (!touchesScope) continue;
    if (event.type === 'command_check_started')
      return `a previous ${scope} check attempt started at ${event.timestamp} never completed (interrupted or failed during launch); rerun the check`;
    return null;
  }
  return null;
}

export async function recoverCommandChecks(
  root: string,
  changeDir: string,
  run: RunState,
  options: { persistInvalidation?: boolean } = {},
) {
  const snapshots = new Map<string, Promise<string>>();
  // Pre-manifest records are revalidated with their original binding semantics.
  const inputFingerprint = async (argv: string[], cwd: string) => {
    const identity = { argv, cwd };
    const key = JSON.stringify(await readCheckPolicy(root, identity, true));
    let snapshot = snapshots.get(key);
    if (!snapshot) {
      snapshot = legacyCheckInputFingerprint(root, changeDir, identity);
      snapshots.set(key, snapshot);
    }
    return snapshot;
  };
  const scopes: Record<CommandCheckScope, 'revalidated' | 'rerun-required'> = {
    build: 'rerun-required',
    verify: 'rerun-required',
  };
  const invalidated: CommandCheckScope[] = [];
  for (const scope of ['build', 'verify'] as const) {
    const record = await usableCommandCheck(root, changeDir, run, scope, inputFingerprint).catch(
      () => null,
    );
    // Incremental evidence never survives cold recovery: it is a phase-local
    // accelerator, not a resumable acceptance record.
    if (record?.reusable === true && record.tier !== 'incremental') scopes[scope] = 'revalidated';
    else invalidated.push(scope);
  }
  // Persist rejected scopes so restoring old inputs cannot resurrect stale evidence.
  const persistInvalidation = options.persistInvalidation ?? true;
  if (persistInvalidation && invalidated.length) {
    const events = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
    // An unrelated event may follow the invalidation (for example a status
    // checkpoint).  Looking only at the last trajectory entry caused every
    // subsequent cold recovery to append another identical fence, making the
    // trajectory grow and slowing recovery.  Reuse any matching fence for this
    // run that already covers all invalidated scopes.
    const alreadyRecorded = events.some(
      (event) =>
        event.runId === run.runId &&
        event.type === 'command_checks_invalidated' &&
        event.data?.reason === 'cold-recovery' &&
        Array.isArray(event.data.scopes) &&
        invalidated.every((scope) => (event.data?.scopes as unknown[]).includes(scope)),
    );
    if (alreadyRecorded) return scopes;
    await checkEvent(changeDir, run, 'command_checks_invalidated', {
      reason: 'cold-recovery',
      scopes: invalidated,
    });
  }
  return scopes;
}

async function checkEvent(
  changeDir: string,
  run: RunState,
  type: TrajectoryEvent['type'],
  data: Record<string, unknown>,
): Promise<TrajectoryEvent> {
  return withClassicStateLock(changeDir, async () => {
    const index = await readCheckIndex(changeDir, run.trajectoryRef);
    const event = {
      sequence: index.maximumSequence + 1,
      timestamp: new Date().toISOString(),
      runId: run.runId,
      type,
      data,
    };
    await appendTrajectory(changeDir, run.trajectoryRef, event);
    return event;
  });
}

export async function rememberClassicAcceptedVerifyCheck(
  root: string,
  changeDir: string,
  run: RunState,
  state: ClassicState,
  check: RecordedCommandCheck,
) {
  if (!state.verificationReport || !check.action || check.exitCode !== 0)
    throw new Error('接受 Verify 需要真实检查和报告');
  const report = await readClassicProjectFile(root, state.verificationReport, {
    label: 'Classic 已接受报告',
  });
  const snapshot = await collectCheckSnapshot(
    root,
    changeDir,
    { argv: check.argv!, cwd: check.cwd },
    { verificationReport: state.verificationReport },
  );
  const candidateManifestHash = checkManifestHash(snapshot.manifest);
  const candidateManifestRef = `${path.relative(root, changeDir).replaceAll('\\', '/')}/.comet/checks/accepted-${candidateManifestHash}.manifest`;
  await writeClassicProjectText(root, candidateManifestRef, snapshot.manifest, {
    label: 'Classic 接受时的候选输入',
  });
  await checkEvent(changeDir, run, 'checkpoint', {
    kind: 'classic-accepted-verify-check',
    scope: 'verify',
    sequence: check.sequence,
    actionId: check.action.id,
    manifestHash: check.manifestHash,
    candidateManifestRef,
    candidateManifestHash,
    reportRef: state.verificationReport,
    reportSha256: createHash('sha256').update(report).digest('hex'),
    checkEpoch: state.checkEpoch ?? 0,
    verifiedAt: state.verifiedAt,
  });
}

export async function readClassicAcceptedVerifyCheck(
  root: string,
  changeDir: string,
  run: RunState,
  state: ClassicState,
) {
  const event = [...(await readCheckIndex(changeDir, run.trajectoryRef)).events]
    .reverse()
    .find(
      (entry) =>
        entry.runId === run.runId &&
        entry.type === 'checkpoint' &&
        entry.data?.kind === 'classic-accepted-verify-check',
    );
  const data = event?.data;
  if (
    !data ||
    data.reportRef !== state.verificationReport ||
    data.verifiedAt !== state.verifiedAt ||
    typeof data.actionId !== 'string' ||
    typeof data.reportSha256 !== 'string' ||
    typeof data.sequence !== 'number' ||
    typeof data.checkEpoch !== 'number' ||
    data.checkEpoch > (state.checkEpoch ?? 0)
  )
    throw new Error('原 Verify 缺少对应报告的接受证据；保留原批准和工作，只诊断缺失记录');
  const report = await readClassicProjectFile(root, data.reportRef as string, {
    label: 'Classic 原验收报告',
  });
  if (createHash('sha256').update(report).digest('hex') !== data.reportSha256)
    throw new Error('原验收报告与已接受内容不匹配，不能沿用原接受结果');
  return {
    ...data,
    sequence: data.sequence,
    actionId: data.actionId,
    reportSha256: data.reportSha256,
    checkEpoch: data.checkEpoch,
    manifestHash: typeof data.manifestHash === 'string' ? data.manifestHash : null,
    candidateManifestRef:
      typeof data.candidateManifestRef === 'string' ? data.candidateManifestRef : null,
    candidateManifestHash:
      typeof data.candidateManifestHash === 'string' ? data.candidateManifestHash : null,
    bindingHash: hashRuntimeValue(data as import('../engine/runtime.js').RuntimeValue),
  };
}

export async function assertClassicAcceptedVerifyInputs(
  root: string,
  changeDir: string,
  run: RunState,
  state: ClassicState,
) {
  if (state.archived) return;
  // 旧 Compat 没有保存报告接受检查点，保持其原契约；新接受边界始终写入此证据。
  if (
    !(await readCheckIndex(changeDir, run.trajectoryRef)).events.some(
      (event) =>
        event.runId === run.runId &&
        event.type === 'checkpoint' &&
        event.data?.kind === 'classic-accepted-verify-check',
    )
  )
    return;
  await readClassicAcceptedVerifyCheck(root, changeDir, run, state);
  await assertClassicAcceptedCandidateInputs(root, changeDir, run, state);
  const result = await evaluateCommandCheck(root, changeDir, run, 'verify');
  if (!result.record)
    throw new Error(
      `原验收检查不再适用：${result.reason ?? '结果缺失'}；由当前 Agent 只补受影响检查，保留报告和批准`,
    );
}

export async function readClassicAcceptedCommandCheck(
  root: string,
  changeDir: string,
  run: RunState,
  state: ClassicState,
) {
  const accepted = await readClassicAcceptedVerifyCheck(root, changeDir, run, state);
  const events = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
  const event = events.find(
    (entry) => entry.runId === run.runId && entry.sequence === accepted.sequence,
  );
  const original = event ? validRecord(root, event) : null;
  if (
    !original ||
    original.action?.id !== accepted.actionId ||
    original.manifestHash !== accepted.manifestHash ||
    original.provenance !== 'runtime' ||
    original.exitCode !== 0 ||
    original.inputBefore !== original.inputAfter ||
    !hasMatchingCheckStart(root, events, events.indexOf(event!), original)
  )
    throw new Error('原接受结果的检查收据缺失或不匹配，不能用补检查替代原验收');
  if (!accepted.candidateManifestRef || !accepted.candidateManifestHash)
    throw new Error('接受时的候选输入记录缺失，不能从当前文件补造原验收');
  return { original, accepted };
}

export async function observeClassicAcceptedCandidateInputs(
  root: string,
  changeDir: string,
  run: RunState,
  state: ClassicState,
) {
  const { original, accepted } = await readClassicAcceptedCommandCheck(root, changeDir, run, state);
  return {
    original,
    observation: await observeClassicCompatCheckInputs(root, changeDir, state, original, {
      manifestRef: accepted.candidateManifestRef!,
      manifestHash: accepted.candidateManifestHash!,
    }),
  };
}

export async function classicCheckNotExecuted(
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
) {
  const events = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
  const relevant = events.filter(
    (event) => event.runId === run.runId && event.data?.scope === scope,
  );
  const proof = relevant.at(-1);
  const started = relevant.at(-2);
  return proof?.type === 'checkpoint' &&
    proof.data.kind === 'classic-check-not-executed' &&
    started?.type === 'command_check_started' &&
    proof.data.actionId === (started.data.action as RuntimeAction | undefined)?.id &&
    proof.data.attempt === (started.data.action as RuntimeAction | undefined)?.attempt &&
    proof.data.inputHash === (started.data.action as RuntimeAction | undefined)?.inputHash
    ? proof
    : null;
}

export async function assertClassicAcceptedCandidateInputs(
  root: string,
  changeDir: string,
  run: RunState,
  state: ClassicState,
) {
  const { original, observation } = await observeClassicAcceptedCandidateInputs(
    root,
    changeDir,
    run,
    state,
  );
  const scopes = [
    await classicEditReviewScope(root, path.basename(changeDir), state),
    await classicFormalEditReviewScope(root, path.basename(changeDir), state),
  ];
  for (const scope of scopes) await assertEditReviewsComplete(scope);
  if (!(await areObservedEditsNonBehavioral(scopes, observation.changes)))
    throw new Error(
      '当前内容与原已接受候选不一致；由当前 Agent 只判断新增变化，不能用新的检查成功替代原验收',
    );
  const latest = await latestCommandCheck(root, changeDir, run, 'verify');
  if (
    latest?.argv &&
    (JSON.stringify(latest.argv) !== JSON.stringify(original.argv) ||
      latest.cwd !== original.cwd ||
      latest.timeoutMs !== original.timeoutMs)
  )
    throw new Error('补充检查变更了原已接受命令；保留原批准并核对验证方式');
}

/** 仅供未启动尝试恢复输入观察；不会将旧结果重新标为可用于推进。 */
export async function classicCheckBeforeUnexecutedAttempt(
  root: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
) {
  const proof = await classicCheckNotExecuted(changeDir, run, scope);
  if (!proof || typeof proof.data.sourceCheckSequence !== 'number') return null;
  const events = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
  const index = events.findIndex(
    (event) => event.runId === run.runId && event.sequence === proof.data.sourceCheckSequence,
  );
  const record = index < 0 ? null : validRecord(root, events[index]);
  return record?.scope === scope &&
    record.provenance === 'runtime' &&
    hasMatchingCheckStart(root, events, index, record)
    ? record
    : null;
}

export async function executeCommandCheck(
  root: string,
  changeDir: string,
  run: RunState,
  input: {
    scope: CommandCheckScope;
    argv: string[];
    cwd?: string;
    timeoutMs?: number;
    reusable?: boolean;
    tier?: 'full' | 'incremental';
    executionRequestId?: string;
    expectedManifestHash?: string;
    validateBeforeStart?: () => Promise<void>;
  },
): Promise<RecordedCommandCheck> {
  validateScope(input.scope);
  const timeoutMs = await resolveClassicCheckTimeout(root, input.timeoutMs);
  if (!input.argv.length || input.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')))
    throw new Error('Check requires literal program arguments');
  const cwd = normalizedCwd(root, input.cwd);
  const realRoot = await fs.realpath(root);
  normalizedCwd(realRoot, await fs.realpath(path.resolve(root, cwd)));
  const tier: 'full' | 'incremental' = input.tier === 'incremental' ? 'incremental' : 'full';
  // Read the previous record before writing the started event: once it exists,
  // the started event hides every earlier record for this scope.
  const previous = await latestCommandCheck(root, changeDir, run, input.scope);
  const inputSource =
    previous ??
    (input.executionRequestId
      ? await classicCheckBeforeUnexecutedAttempt(root, changeDir, run, input.scope)
      : null);
  if (input.executionRequestId && !/^[a-f0-9]{64}$/u.test(input.executionRequestId))
    throw new Error('Invalid check execution request ID');
  if (input.reusable && !input.executionRequestId) {
    if (
      previous &&
      previous.reusable &&
      (previous.timeoutMs ?? 300_000) === timeoutMs &&
      (previous.tier ?? 'full') === tier &&
      previous.cwd === cwd &&
      JSON.stringify(previous.argv) === JSON.stringify(input.argv)
    ) {
      const usable = await usableCommandCheck(root, changeDir, run, input.scope);
      if (usable?.sequence === previous.sequence && usable.timestamp === previous.timestamp)
        return { ...usable, reused: true };
    }
    if (!previous) {
      const otherScope: CommandCheckScope = input.scope === 'build' ? 'verify' : 'build';
      const other = await usableCommandCheck(root, changeDir, run, otherScope);
      if (
        other?.reusable &&
        (other.timeoutMs ?? 300_000) === timeoutMs &&
        (other.tier ?? 'full') === tier &&
        other.cwd === cwd &&
        JSON.stringify(other.argv) === JSON.stringify(input.argv)
      ) {
        const {
          sequence: _sequence,
          timestamp: _timestamp,
          runId: _runId,
          scope: _scope,
          reused: _reused,
          action: _sourceAction,
          ...evidence
        } = other;
        void [_sequence, _timestamp, _runId, _scope, _reused, _sourceAction];
        const { event, checkEpoch, action } = await withClassicStateLock(changeDir, async () => {
          const projection = await readClassicState(changeDir, { migrate: false });
          if (
            (projection.run || projection.classic) &&
            (projection.run?.runId !== run.runId ||
              projection.run?.iteration !== run.iteration ||
              !projection.classic)
          )
            throw new Error('Classic check Run changed before reuse; reload the current state');
          const checkEpoch = projection.classic?.checkEpoch ?? 0;
          const startedAction = startClassicCheckAction({
            run,
            id: randomUUID(),
            scope: input.scope,
            argv: [...input.argv],
            cwd,
            timeoutMs: other.timeoutMs ?? 300_000,
            tier,
            checkEpoch,
          });
          await checkEvent(changeDir, run, 'command_check_started', {
            scope: input.scope,
            argv: [...input.argv],
            cwd,
            timeoutMs: other.timeoutMs ?? 300_000,
            reusable: true,
            tier,
            checkEpoch,
            action: startedAction,
          });
          const action = completeClassicCheckAction(startedAction, {
            exitCode: other.exitCode,
            inputBefore: other.inputBefore!,
            inputAfter: other.inputAfter!,
            logHash: other.logHash!,
            manifestHash: other.manifestHash ?? null,
          });
          const event = await checkEvent(changeDir, run, 'command_check_executed', {
            ...evidence,
            scope: input.scope,
            checkEpoch,
            timeoutMs: other.timeoutMs ?? 300_000,
            action,
          });
          return { event, checkEpoch, action };
        });
        return {
          ...evidence,
          scope: input.scope,
          checkEpoch,
          timeoutMs: other.timeoutMs ?? 300_000,
          action,
          sequence: event.sequence,
          timestamp: event.timestamp,
          runId: run.runId,
          reused: true,
        };
      }
    }
  }
  // A failed launch, snapshot, or log write must not expose an older success.
  const reservation = await withClassicStateLock(
    changeDir,
    async (): Promise<
      | { record: RecordedCommandCheck }
      | { started: TrajectoryEvent; checkEpoch: number; action: RuntimeAction }
    > => {
      const projection = await readClassicState(changeDir, { migrate: false });
      if (
        (projection.run || projection.classic) &&
        (projection.run?.runId !== run.runId ||
          projection.run?.iteration !== run.iteration ||
          !projection.classic)
      )
        throw new Error('Classic check Run changed before launch; reload the current state');
      let retryAction: RuntimeAction | undefined;
      if (input.executionRequestId) {
        const events = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
        const notExecuted = await classicCheckNotExecuted(changeDir, run, input.scope);
        const latestStarted = await latestInterruptedCommandCheck(
          root,
          changeDir,
          run,
          input.scope,
        );
        if (!previous && latestStarted?.action && !notExecuted)
          throw new Error(
            `原检查 ${latestStarted.action.id}（尝试 ${latestStarted.action.attempt}）已开始且结果未明；先核对该命令及原进程，不能用新请求重复启动`,
          );
        const prior = [...events]
          .reverse()
          .find(
            (event) =>
              event.runId === run.runId &&
              (event.data?.action as { id?: string } | undefined)?.id === input.executionRequestId,
          );
        if (prior && notExecuted?.data.actionId === input.executionRequestId) {
          const started = validStartedAttempt(root, prior);
          if (!started?.action) throw new Error('原未执行检查的身份不匹配');
          if (
            JSON.stringify(started.argv) !== JSON.stringify(input.argv) ||
            started.cwd !== cwd ||
            started.timeoutMs !== timeoutMs ||
            started.tier !== tier
          )
            throw new Error('补充检查请求与原命令不匹配');
          const pending = retryRuntimeAction(
            markRuntimeActionUnknown(started.action, String(notExecuted.data.reason)),
            { resolution: 'not-executed', evidence: notExecuted.data },
          );
          retryAction = claimRuntimeAction(pending, {
            executorId: 'comet-classic-check',
            token: pending.id,
            attempt: pending.attempt,
            inputHash: pending.inputHash,
          });
        } else if (prior) {
          const record = validRecord(root, prior);
          if (!record || !hasMatchingCheckStart(root, events, events.indexOf(prior), record))
            throw new Error('原补充检查已开始且结果未明；核对原执行，不能重复启动');
          if (
            !record.logRef ||
            !record.logHash ||
            createHash('sha256')
              .update(
                await readClassicProjectFile(root, record.logRef, {
                  label: 'Classic 补充检查原日志',
                }),
              )
              .digest('hex') !== record.logHash ||
            !(await recordManifestEntries(root, record))
          )
            throw new Error('原补充检查证据缺失或损坏；保留原执行并诊断');
          if (
            JSON.stringify(record.argv) !== JSON.stringify(input.argv) ||
            record.cwd !== cwd ||
            record.timeoutMs !== timeoutMs
          )
            throw new Error('补充检查请求与原命令不匹配');
          return { record: { ...record, tier: record.tier ?? 'full' } };
        }
      }
      if (projection.classic?.phase === 'archive' && !input.executionRequestId)
        throw new Error(
          '已接受结果后补检查须使用 comet edit-review refresh-checks，先绑定当前 Agent 判断和原报告',
        );
      await input.validateBeforeStart?.();
      const checkEpoch = projection.classic?.checkEpoch ?? 0;
      const action =
        retryAction ??
        startClassicCheckAction({
          run,
          id: input.executionRequestId ?? randomUUID(),
          scope: input.scope,
          argv: [...input.argv],
          cwd,
          timeoutMs,
          tier,
          checkEpoch,
        });
      const started = await checkEvent(changeDir, run, 'command_check_started', {
        scope: input.scope,
        argv: [...input.argv],
        cwd,
        timeoutMs,
        reusable: input.reusable === true,
        tier,
        checkEpoch,
        action,
      });
      return { started, checkEpoch, action };
    },
  );
  if ('record' in reservation) return { ...reservation.record, reused: true };
  const { started, checkEpoch, action } = reservation;
  const identity = { argv: input.argv, cwd };
  // The previous execution's manifest lets unchanged files skip rereading, so a
  // rerun only reads what actually changed since the last recorded check.
  let before: Awaited<ReturnType<typeof collectCheckSnapshot>>;
  let environment: string;
  try {
    const previousManifest = inputSource?.manifestRef
      ? await recordManifestEntries(root, inputSource).catch(() => null)
      : null;
    before = await collectCheckSnapshot(
      root,
      changeDir,
      identity,
      previousManifest ? { baseline: previousManifest } : {},
    );
    if (
      input.expectedManifestHash &&
      checkManifestHash(before.manifest) !== input.expectedManifestHash
    )
      throw new Error('补充检查预留后输入发生变化；保留原执行记录，只判断新增变化后继续');
    environment = await checkEnvironmentFingerprint(
      input.argv,
      path.resolve(root, cwd),
      await readCheckPolicy(root, identity),
    );
  } catch (error) {
    await checkEvent(changeDir, run, 'checkpoint', {
      kind: 'classic-check-not-executed',
      scope: input.scope,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      sourceCheckSequence: inputSource?.sequence ?? null,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const inputBefore = before.digest;
  const logPath = path.join(changeDir, '.comet', 'checks', `${randomUUID()}.log`);
  // The platform adapter preserves argv and rejects unsafe Windows batch arguments.
  const result = await new Promise<{ exitCode: number; output: string }>((resolve) => {
    reportCometRuntimeProgress(`执行 ${input.scope} 检查：${input.argv[0]}`);
    const child = spawnCommand(input.argv[0], input.argv.slice(1), {
      cwd: path.resolve(root, cwd),
    });
    let output = '';
    let timedOut = false;
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-2 * 1024 * 1024);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (error) => {
      output += `\n${error.message}`;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child).catch(() => child.kill('SIGKILL'));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        output: (timedOut ? 'Check timed out.\n' : '') + output,
      });
    });
  });
  const after = await collectCheckSnapshot(root, changeDir, identity, {
    baseline: before.entries,
  }).catch(() => null);
  let inputAfter = after ? after.digest : 'unavailable';
  const changedDuringExecution = after
    ? (() => {
        const diff = diffCheckManifests(before.entries, after.entries);
        return [...diff.added, ...diff.removed, ...diff.changed].slice(0, 100);
      })()
    : undefined;
  let manifestRef: string | undefined;
  let manifestHash: string | undefined;
  if (after) {
    // The manifest lives under the change's runtime directory, which the
    // input snapshot omits, so recording it never invalidates its own check.
    const manifestPath = path.join(changeDir, '.comet', 'checks', `${randomUUID()}.manifest`);
    await writeClassicProjectText(root, manifestPath, after.manifest, {
      label: 'Classic check manifest',
    });
    manifestRef = path.relative(root, manifestPath).replaceAll('\\', '/');
    manifestHash = checkManifestHash(after.manifest);
  }
  if (
    checkEpoch !==
    ((await readClassicState(changeDir, { migrate: false })).classic?.checkEpoch ?? 0)
  )
    inputAfter = 'phase-changed';
  if (
    environment !==
    (await checkEnvironmentFingerprint(
      input.argv,
      path.resolve(root, cwd),
      await readCheckPolicy(root, identity),
    ))
  )
    inputAfter = 'environment-changed';
  await writeClassicProjectText(root, logPath, result.output, { label: 'Classic check log' });
  const logTarget = await inspectClassicProjectTarget(root, logPath, {
    label: 'Classic check log',
    expected: 'file',
  });
  const logStat = await fs.lstat(logTarget.target, { bigint: true }).catch(() => null);
  const data = {
    scope: input.scope,
    command: JSON.stringify(input.argv),
    checkEpoch,
    argv: input.argv,
    timeoutMs,
    exitCode: result.exitCode,
    cwd,
    provenance: 'runtime' as const,
    inputBefore,
    inputAfter,
    changedDuringExecution,
    environment,
    logRef: path.relative(root, logPath).replaceAll('\\', '/'),
    logHash: createHash('sha256').update(result.output).digest('hex'),
    ...(logStat ? { logSize: Number(logStat.size), logMtimeNs: logStat.mtimeNs.toString() } : {}),
    manifestRef,
    manifestHash,
    tier,
    reusable: input.reusable === true && inputBefore === inputAfter,
  };
  const event = await withClassicStateLock(changeDir, async () => {
    const events = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
    const newer = events.some(
      (event) =>
        event.runId === run.runId &&
        event.sequence > started.sequence &&
        ((event.type === 'command_checks_invalidated' &&
          (!Array.isArray(event.data?.scopes) || event.data.scopes.includes(input.scope))) ||
          event.data?.scope === input.scope),
    );
    if (newer) throw new Error('Check superseded by a newer check or invalidation; rerun required');
    const completed = completeClassicCheckAction(action, {
      exitCode: result.exitCode,
      inputBefore,
      inputAfter,
      logHash: data.logHash,
      manifestHash: manifestHash ?? null,
    });
    return checkEvent(changeDir, run, 'command_check_executed', { ...data, action: completed });
  });
  return {
    ...data,
    action: event.data.action as RuntimeAction,
    sequence: event.sequence,
    timestamp: event.timestamp,
    runId: run.runId,
  };
}

async function recordManifestEntries(
  root: string,
  record: RecordedCommandCheck,
): Promise<CheckManifestEntry[] | null> {
  if (typeof record.manifestHash !== 'string' || typeof record.manifestRef !== 'string')
    return null;
  const serialized = await readClassicProjectFile(root, record.manifestRef, {
    label: 'Classic check manifest',
    maxBytes: Number.MAX_SAFE_INTEGER,
  });
  if (checkManifestHash(serialized) !== record.manifestHash) return null;
  return parseCheckManifest(serialized);
}

export interface CommandCheckEvaluation {
  record: RecordedCommandCheck | null;
  /** Why the latest record is not reusable; absent when a record is usable or none exists. */
  reason?: string;
  /** Added, removed and changed input paths relative to the recorded manifest. */
  changedPaths?: string[];
  /** The declared input scope that decided relevance for the changed paths. */
  relevance?: string;
  /**
   * Neutral document paths that changed since execution while every material
   * input stayed identical; the record remains usable and these edits are
   * reported instead of silently dropped.
   */
  documentChangesIgnored?: string[];
}

export async function evaluateCommandCheck(
  root: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
  inputFingerprint: (argv: string[], cwd: string) => Promise<string> = (argv, cwd) =>
    legacyCheckInputFingerprint(root, changeDir, { argv, cwd }),
): Promise<CommandCheckEvaluation> {
  const record = await latestCommandCheck(root, changeDir, run, scope);
  const fail = (reason: string): CommandCheckEvaluation => ({ record: null, reason });
  if (
    record &&
    !record.reusable &&
    (record.checkEpoch ?? 0) !==
      ((await readClassicState(changeDir, { migrate: false })).classic?.checkEpoch ?? 0)
  ) {
    const state = (await readClassicState(changeDir, { migrate: false })).classic;
    const accepted =
      state?.phase === 'archive' && scope === 'verify'
        ? await readClassicAcceptedVerifyCheck(root, changeDir, run, state).catch(() => null)
        : null;
    if (
      !accepted ||
      accepted.sequence !== record.sequence ||
      accepted.actionId !== record.action?.id
    )
      return fail('check evidence crossed a phase boundary');
  }
  if (!record)
    return {
      record: null,
      reason: (await interruptedCommandCheckReason(changeDir, run, scope)) ?? undefined,
    };
  if (record.provenance !== 'runtime')
    return fail(
      'the latest record is a manual record-check declaration from ' +
        `${record.timestamp}; manual declarations never satisfy the guard and shadow any earlier runtime record`,
    );
  if (record.exitCode !== 0) return fail(`the last check failed with exit code ${record.exitCode}`);
  if (!Array.isArray(record.argv) || !record.argv.length || !record.inputBefore)
    return fail('the latest record is incomplete');
  if (record.inputBefore !== record.inputAfter)
    return {
      record: null,
      reason: record.changedDuringExecution?.length
        ? 'inputs changed while the check ran; if these paths are generated artifacts, declare them in the matching command outputs in .comet/check-policy.json'
        : 'inputs changed while the check ran',
      ...(record.changedDuringExecution?.length
        ? {
            changedPaths: record.changedDuringExecution,
            relevance: 'execution-time command inputs',
          }
        : {}),
    };
  const identity = { argv: record.argv, cwd: record.cwd };
  let documentChangesIgnored: string[] | undefined;
  if (record.manifestRef) {
    // Per-file evidence reuses when the environment binding holds and no
    // recorded input file changed relative to the execution-time manifest.
    const policy = await readCheckPolicy(root, identity);
    if (
      record.environment !==
      (await checkEnvironmentFingerprint(record.argv, path.resolve(root, record.cwd), policy))
    )
      return fail(
        'the environment changed since execution (checks bind the resolved executable path and its file identity, the Node version, and declared policy environment variables; switching Node versions, package-manager shims, or PATH order invalidates evidence)',
      );
    const baseline = await recordManifestEntries(root, record).catch(() => null);
    if (!baseline) return fail('the recorded input manifest is damaged or missing');
    const current = await collectCheckSnapshot(root, changeDir, identity, { baseline });
    const diff = diffCheckManifests(baseline, current.entries);
    const changedPaths = [...diff.added, ...diff.removed, ...diff.changed];
    if (changedPaths.length) {
      const relevance = policy.files
        ? `declared inputs (${policy.files.join(', ')})`
        : 'default whole-tree inputs';
      // A declared files list keeps its exact binding; the neutral-document
      // default relaxes only the undeclared whole-tree scope, so editing a
      // README or a docs page alone no longer discards valid evidence.
      const state = (await readClassicState(changeDir, { migrate: false })).classic;
      const retained =
        !policy.files &&
        (await classicDocumentEvidenceMode(root)) !== 'strict' &&
        state &&
        (await classicCheckInputsRetained(
          root,
          path.basename(changeDir),
          state,
          classicCompatCheckExecutionRef(record),
          record as unknown as Record<string, unknown>,
          current.manifest,
        ));
      if (!retained) {
        return {
          record: null,
          reason: 'check inputs changed since execution',
          changedPaths,
          relevance,
        };
      }
      documentChangesIgnored = changedPaths;
    }
  } else {
    // Evidence recorded before per-file manifests existed keeps its original
    // binding semantics: whole-tree inputs, HEAD/index and every environment
    // variable unless a v1 policy declared otherwise.
    if (
      record.environment !==
        (await checkEnvironmentFingerprint(
          record.argv,
          path.resolve(root, record.cwd),
          await readCheckPolicy(root, identity, true),
          true,
        )) ||
      record.inputAfter !== (await inputFingerprint(record.argv, record.cwd))
    )
      return fail('check inputs changed since execution');
  }
  if (typeof record.logRef !== 'string' || typeof record.logHash !== 'string')
    return fail('the evidence log record is incomplete');
  try {
    const log = await readClassicProjectFile(root, record.logRef, {
      label: 'Classic check evidence log',
    });
    if (createHash('sha256').update(log).digest('hex') !== record.logHash)
      return fail('the evidence log is damaged');
  } catch {
    return fail('the evidence log is missing');
  }
  const current = await latestCommandCheck(root, changeDir, run, scope);
  if (
    current?.sequence !== record.sequence ||
    current.timestamp !== record.timestamp ||
    JSON.stringify(current) !== JSON.stringify(record)
  )
    return fail('the evidence was superseded by a newer check');
  return { record, ...(documentChangesIgnored ? { documentChangesIgnored } : {}) };
}

export async function usableCommandCheck(
  root: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
  inputFingerprint: (argv: string[], cwd: string) => Promise<string> = (argv, cwd) =>
    legacyCheckInputFingerprint(root, changeDir, { argv, cwd }),
): Promise<RecordedCommandCheck | null> {
  return (await evaluateCommandCheck(root, changeDir, run, scope, inputFingerprint)).record;
}

export async function consumeCommandCheck(
  changeDir: string,
  run: RunState,
  record: RecordedCommandCheck,
): Promise<void> {
  if (!record.reusable)
    await checkEvent(changeDir, run, 'command_check_consumed', {
      scope: record.scope,
      sequence: record.sequence,
    });
}
