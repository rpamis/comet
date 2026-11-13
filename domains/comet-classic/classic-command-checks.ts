import { readTrajectory } from './classic-run-store.js';
import path from 'path';
import type { RuntimeAction } from '../engine/runtime-action.js';
import { hashRuntimeValue } from '../engine/runtime-json.js';
import type { RunState, TrajectoryEvent } from '../engine/types.js';
import { appendTrajectory } from './classic-run-store.js';
import type { ClassicState } from './classic-state.js';
import { readClassicState, withClassicStateMutation } from './classic-store.js';
export type CommandCheckScope = 'build' | 'verify';
export interface RecordedCommandCheck {
  sequence: number;
  timestamp: string;
  runId: string;
  scope: CommandCheckScope;
  command: string;
  exitCode: number;
  cwd: string;
  provenance?: 'runtime' | 'agent';
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
  return withClassicStateMutation(changeDir, async () => {
    const index = await readCheckEvents(changeDir, run.trajectoryRef);
    const recorded: RecordedCommandCheck = {
      sequence: index.maximumSequence + 1,
      timestamp: new Date().toISOString(),
      runId: run.runId,
      scope: input.scope,
      command: input.command,
      exitCode: input.exitCode,
      cwd: normalizedCwd(projectRoot, input.cwd),
      provenance: 'agent',
      checkEpoch: (await readClassicState(changeDir, { migrate: false })).classic?.checkEpoch ?? 0,
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
        provenance: recorded.provenance,
        checkEpoch: recorded.checkEpoch,
      },
    });
    return recorded;
  });
}
async function checkEvent(
  changeDir: string,
  run: RunState,
  type: TrajectoryEvent['type'],
  data: Record<string, unknown>,
): Promise<TrajectoryEvent> {
  return withClassicStateMutation(changeDir, async () => {
    const index = await readCheckEvents(changeDir, run.trajectoryRef);
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
  if (!state.verificationReport || check.exitCode !== 0)
    throw new Error('接受 Verify 需要真实检查和报告');
  await checkEvent(changeDir, run, 'checkpoint', {
    kind: 'classic-accepted-verify-check',
    scope: 'verify',
    sequence: check.sequence,
    ...(check.action ? { actionId: check.action.id } : {}),
    reportRef: state.verificationReport,
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
  const event = [...(await readCheckEvents(changeDir, run.trajectoryRef)).events]
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
    typeof data.sequence !== 'number' ||
    typeof data.checkEpoch !== 'number' ||
    data.checkEpoch > (state.checkEpoch ?? 0)
  )
    throw new Error('原 Verify 缺少对应报告的接受证据；保留原批准和工作，只诊断缺失记录');
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
    !(await readCheckEvents(changeDir, run.trajectoryRef)).events.some(
      (event) =>
        event.runId === run.runId &&
        event.type === 'checkpoint' &&
        event.data?.kind === 'classic-accepted-verify-check',
    )
  )
    return;
  await readClassicAcceptedVerifyCheck(root, changeDir, run, state);
  const result = await evaluateCommandCheck(root, changeDir, run, 'verify');
  if (!result.record)
    throw new Error(
      `原验收检查不再适用：${result.reason ?? '结果缺失'}；由当前 Agent 只补受影响检查，保留报告和批准`,
    );
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
/** 旧检查只作为业务历史读取，不装载执行器、内容快照或进程记录。 */
async function readCheckEvents(changeDir: string, ref: string) {
  const events = await readTrajectory(changeDir, ref);
  return {
    events,
    maximumSequence: events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0),
  };
}
export async function latestCommandCheck(
  root: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
): Promise<RecordedCommandCheck | null> {
  validateScope(scope);
  const { events } = await readCheckEvents(changeDir, run.trajectoryRef);
  for (const event of events.reverse()) {
    if (event.runId !== run.runId) continue;
    if (
      event.type === 'command_checks_invalidated' &&
      (!Array.isArray(event.data?.scopes) || event.data.scopes.includes(scope))
    )
      return null;
    if (event.data?.scope !== scope) continue;
    if (['command_check_started', 'command_check_consumed'].includes(event.type)) return null;
    if (!['command_check_executed', 'command_check_recorded'].includes(event.type)) continue;
    const data = event.data as unknown as RecordedCommandCheck;
    if (
      typeof data.command !== 'string' ||
      !Number.isInteger(data.exitCode) ||
      typeof data.cwd !== 'string'
    )
      return null;
    let cwd: string;
    try {
      cwd = normalizedCwd(root, data.cwd);
    } catch {
      continue;
    }
    return {
      ...data,
      sequence: event.sequence,
      timestamp: event.timestamp,
      runId: run.runId,
      scope,
      cwd,
      ...(event.type === 'command_check_executed' ? { provenance: 'runtime' as const } : {}),
    };
  }
  return null;
}
export async function evaluateCommandCheck(
  root: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
): Promise<CommandCheckEvaluation> {
  const record = await latestCommandCheck(root, changeDir, run, scope);
  if (!record)
    return { record: null, reason: '没有本阶段的完整检查报告；请在 Agent 平台执行并提交实际结果' };
  if (!record.provenance)
    return { record: null, reason: '旧手工声明没有平台检查来源；请核对后提交实际结果' };
  if (record.exitCode !== 0)
    return { record: null, reason: '检查未通过，退出码 ' + record.exitCode };
  const state = (await readClassicState(changeDir, { migrate: false })).classic;
  if (state?.phase !== 'archive' && (record.checkEpoch ?? 0) !== (state?.checkEpoch ?? 0))
    return { record: null, reason: '报告属于较早阶段，请由 Agent 核对当前工作后提交结果' };
  return { record };
}
