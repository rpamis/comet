import path from 'node:path';
import { readFileRaceSafe } from '../../platform/fs/race-safe-read.js';
import { stripUtf8Bom } from '../../platform/fs/strip-bom.js';
import { reportCometRuntimeProgress } from '../../platform/process/runtime-metrics.js';
import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeOutcome,
  type WorkflowRun,
} from '../engine/runtime.js';
import { formatCliCommandArgs } from '../workflow-contract/output-envelope.js';
import { NativeUsageError, success, type DispatchResult } from './native-cli-shared.js';
import { hasNativeCompletedWork } from './native-experience.js';
import { nativeProjectPaths } from './native-paths.js';
import type { NativePortableAcceptanceInput } from './native-portable-acceptance.js';
import type { NativePortableState } from './native-portable-types.js';
import { parseNativePortableState } from './native-portable-state.js';
import { loadOwnedNativeSdkRuntime } from './native-runtime-ownership.js';
import { collectNativeSdkShapeProposal } from './native-sdk-application.js';
import {
  nativeSdkTaskResultTemplate,
  nativeSdkActionContextRequest,
} from './native-sdk-continuation.js';
import { advanceNativeSdkChange } from './native-sdk-next.js';
import { nativeSdkRequiresIndependentReview } from './native-sdk-review.js';
import { projectNativeSdkStatus, projectNativeSdkTaskStatus } from './native-sdk-status.js';
import { supervisorAcceptanceScope } from './native-supervisor-model.js';

interface NativeTaskOptions {
  projectRoot: string;
  name: string;
  sessionId: string;
  actionId?: string;
  resultFile?: string;
  review?: 'current-session' | 'independent';
  acceptOnPass?: string;
  details?: boolean;
}

function ordinaryTask(action: RuntimeAction): boolean {
  return (
    (action.type === 'call_tool' && action.stepId === 'shape.prepare') ||
    (action.type === 'handoff' &&
      [
        'build.builder',
        'verify.verifier',
        'supervisor.child.builder',
        'supervisor.child.verifier',
        'supervisor.parent.builder',
        'supervisor.child.integration-repair',
      ].includes(action.stepId))
  );
}

function verifierTask(action: RuntimeAction) {
  return ['verify.verifier', 'supervisor.child.verifier'].includes(action.stepId);
}
function builderTask(action: RuntimeAction) {
  return ['build.builder', 'supervisor.child.builder', 'supervisor.parent.builder'].includes(
    action.stepId,
  );
}
function activation(action: RuntimeAction) {
  return (
    action.input as {
      activation?: {
        child?: string;
        worktree?: string;
        integrationWorktree?: string;
        builderSessionId?: string;
        acceptance?: Array<{ id: string; source: string; text: string }>;
      };
    }
  ).activation;
}
function builderSession(run: WorkflowRun, action: RuntimeAction) {
  return (
    activation(action)?.builderSessionId ??
    (run.state as unknown as NativePortableState).builder_handoff?.builder_execution_ref
  );
}
function taskScope(run: WorkflowRun, action: RuntimeAction, projectRoot: string) {
  const state = run.state as unknown as NativePortableState,
    input = activation(action);
  const child = input?.child;
  const parent = Boolean(state.children_contract_ref) && !child;
  return {
    ...(child ? { child, scope: 'child' as const } : parent ? { scope: 'parent' as const } : {}),
    projectRoot:
      (action.stepId === 'supervisor.child.integration-repair'
        ? input?.integrationWorktree
        : input?.worktree) ??
      input?.integrationWorktree ??
      (parent
        ? (run.outputs['supervisor.prepare']?.value as { integrationWorktree?: string })
            ?.integrationWorktree
        : undefined) ??
      projectRoot,
    acceptance:
      input?.acceptance ??
      (child && state.children_contract
        ? supervisorAcceptanceScope(state.children_contract, child)
        : state.acceptance),
  };
}

async function readTaskResult(
  file: string,
): Promise<Pick<RuntimeOutcome, 'status' | 'output' | 'summary' | 'artifacts' | 'event'>> {
  const { bytes } = await readFileRaceSafe(file, Number.MAX_SAFE_INTEGER, {
    label: 'Native task result',
  });
  const result = JSON.parse(stripUtf8Bom(bytes.toString('utf8'))) as Record<string, unknown>;
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !['succeeded', 'failed'].includes(String(result.status)) ||
    !Object.hasOwn(result, 'output') ||
    Object.keys(result).some(
      (key) => !['status', 'output', 'summary', 'artifacts', 'event'].includes(key),
    )
  )
    throw new NativeUsageError(
      '结果文件须填写 resultTemplate 中的 status、output 和实际结果，可选 summary、artifacts、event。',
    );
  return result as unknown as Pick<
    RuntimeOutcome,
    'status' | 'output' | 'summary' | 'artifacts' | 'event'
  >;
}

function taskCommand(options: NativeTaskOptions, action: RuntimeAction, claimed: boolean) {
  return [
    'comet',
    'native',
    'next',
    options.name,
    '--action',
    action.id,
    '--session',
    claimed ? action.claim!.sessionId! : '<actual-receiving-session>',
    ...(claimed ? ['--result', '<result-json-file>'] : []),
    ...(options.review ? ['--review', options.review] : []),
    '--project-root',
    options.projectRoot,
    '--json',
  ];
}

async function projectTaskResult(
  options: NativeTaskOptions,
  run: WorkflowRun,
  advanced?: DispatchResult,
  observedStatus?: Awaited<ReturnType<typeof projectNativeSdkTaskStatus>>,
): Promise<DispatchResult> {
  const state = parseNativePortableState(run.state);
  const artifactRootRef = (run.input as { artifactRootRef: string }).artifactRootRef;
  const priorStatus = advanced?.data as
    { schema?: string; warning?: { code: string; message: string } } | undefined;
  const status = options.details
    ? await projectNativeSdkStatus(
        { projectRoot: options.projectRoot, name: options.name, details: true },
        { run, state, artifactRootRef, application: null },
      )
    : observedStatus
      ? observedStatus
      : priorStatus?.schema === 'comet.native.sdk-status.v1'
        ? (advanced!.data as Awaited<ReturnType<typeof projectNativeSdkStatus>>)
        : await projectNativeSdkTaskStatus(options, run, state);
  const available = run.actions.filter(
    (entry) => ordinaryTask(entry) && ['pending', 'running'].includes(entry.status),
  );
  const requested = run.actions.find((entry) => entry.id === options.actionId);
  const requestedChild = requested ? activation(requested)?.child : undefined;
  const action =
    available.find((entry) => entry.id === options.actionId) ??
    available.find((entry) => entry.claim?.sessionId === options.sessionId) ??
    (requestedChild
      ? available.find((entry) => activation(entry)?.child === requestedChild)
      : undefined) ??
    available.find((entry) => entry.status === 'pending') ??
    available[0];
  const claimed = action?.status === 'running' && action.claim?.sessionId === options.sessionId;
  const continuation = status.continuation;
  const blocked =
    (advanced?.exitCode !== undefined && advanced.exitCode !== 0) ||
    continuation.mode === 'reconcile' ||
    continuation.action === 'review-edit';
  const currentTask = blocked ? undefined : action;
  const commandArgs =
    run.status === 'completed' || run.status === 'cancelled'
      ? null
      : currentTask
        ? currentTask.claim && !claimed
          ? null
          : taskCommand(options, currentTask, Boolean(claimed))
        : continuation.commandArgs;
  const waitingForAcceptance = run.waits.some(
    (wait) => wait.stepId === 'verify.confirm' && wait.status === 'pending',
  );
  const acceptanceCommand = waitingForAcceptance
    ? continuation.commandAlternatives?.find((choice) => choice.name === 'accept-result')
        ?.commandArgs
    : undefined;
  const verificationOutput = [...run.actions].reverse().find((entry) => {
    const output = entry.outcome?.output as
      { candidateId?: string; response?: { kind?: string } } | undefined;
    return (
      entry.stepId === 'verify.verifier' &&
      entry.status === 'succeeded' &&
      output?.candidateId === state.verification?.candidate_id &&
      output?.response?.kind === 'final-result'
    );
  })?.outcome?.output as
    | {
        response?: {
          result?: {
            summary: string;
            acceptance: Array<{ id: string; reason: string }>;
            risks: string[];
            requestReview?: unknown;
          };
        };
      }
    | undefined;
  const verified = verificationOutput?.response?.result;
  const summary =
    blocked && advanced?.error
      ? advanced.error.message
      : state.archived && run.status === 'completed'
        ? '验收通过，归档完成。'
        : waitingForAcceptance
          ? '验收通过，等待用户接受当前结果。'
          : currentTask && verifierTask(currentTask)
            ? claimed
              ? '实现结果已保存，当前会话已领取验收任务。'
              : '实现结果已保存，请交给实际验收会话领取。'
            : currentTask && builderTask(currentTask)
              ? '继续实现当前已批准的需求。'
              : continuation.userCommunication.agentInstruction;
  const checks = new Map<string, Record<string, unknown>>();
  for (const entry of run.actions) {
    const output = entry.outcome?.output as
      { candidateId?: string; checks?: Array<Record<string, unknown>> } | undefined;
    if (
      entry.type !== 'call_tool' ||
      output?.candidateId !== state.builder_handoff?.candidate_id ||
      !Array.isArray(output?.checks)
    )
      continue;
    for (const check of output.checks) {
      if (typeof check.id !== 'string') continue;
      checks.set(check.id, {
        id: check.id,
        name: check.name,
        status: check.status,
        logRef: check.logRef,
        exitCode: check.exitCode,
        reused: Boolean(check.reusedFrom),
      });
    }
  }
  const task = currentTask
    ? {
        ...taskScope(run, currentTask, options.projectRoot),
        actionId: currentTask.id,
        role:
          currentTask.stepId === 'shape.prepare'
            ? 'shape'
            : verifierTask(currentTask)
              ? 'verify'
              : currentTask.stepId === 'supervisor.child.integration-repair'
                ? 'integration-repair'
                : 'build',
        status: currentTask.status,
        session: currentTask.claim?.sessionId ?? null,
        readOnly: verifierTask(currentTask),
        ...(verifierTask(currentTask)
          ? { requireIndependentReview: nativeSdkRequiresIndependentReview(run, currentTask) }
          : {}),
        ...(claimed &&
        verifierTask(currentTask) &&
        builderSession(run, currentTask) !== options.sessionId
          ? {
              contextRequest: nativeSdkActionContextRequest(
                currentTask,
                state,
                options.projectRoot,
              ),
            }
          : {}),
        ...(run.workflow.version === '4' && currentTask.stepId === 'supervisor.child.verifier'
          ? {
              checks:
                (currentTask.input as { activation?: { checks?: unknown } }).activation?.checks ??
                [],
            }
          : {}),
        originalRequest: (run.input as { task?: string }).task,
        artifacts: {
          brief: path.posix.join(artifactRootRef, 'comet', 'changes', state.name, 'brief.md'),
          specs: state.spec_changes.flatMap((change) =>
            change.source
              ? [path.posix.join(artifactRootRef, 'comet', 'changes', state.name, change.source)]
              : [],
          ),
        },
        ...(state.builder_handoff
          ? {
              candidateId: state.builder_handoff.candidate_id,
              checks:
                run.workflow.version === '4'
                  ? state.builder_handoff.checks.map((check) => ({
                      name: check.name.text,
                      result: check.result,
                      note: check.note?.text ?? null,
                    }))
                  : [...checks.values()],
            }
          : {}),
        instruction:
          currentTask.stepId === 'shape.prepare'
            ? '读取原始请求、brief 和本次声明的 Spec，由 Agent 判断内容是否明确并提取完整验收条目。将条目的 source 和 text 填入结果；Runtime 分配 A1..An，并等待用户确认后才允许实现。'
            : currentTask.stepId === 'supervisor.child.integration-repair'
              ? '读取原失败检查，在当前任务的集成工作区修复并提交后继 Git commit，保留已有子任务结果和集成进度。按实际需要选择检查，再通过本次结果模板继续原集成 Action。'
              : verifierTask(currentTask)
                ? '对照原始请求、Spec、实现和全部验收项，复用当前有效检查，只补缺失证据。用户要求独立审查时交给独立会话。用实际观察填写结果，存在未解决问题时报告 fail 或 blocked。'
                : currentTask.stepId === 'supervisor.child.builder'
                  ? run.workflow.version === '4'
                    ? '在当前 Child 工作区完成实现，用平台工具运行必要检查并读取实际结果。提交真实 candidateCommit、实现摘要和 checks 报告，再继续本子任务验收。'
                    : '在当前 Child 工作区完成本任务的验收范围并提交实际 Git commit；将 candidateCommit 和必要 verificationChecks 写入结果。Runtime 执行所选命令后继续验收，不为进入下一步编造检查。'
                  : currentTask.stepId === 'supervisor.parent.builder'
                    ? run.workflow.version === '4'
                      ? '在集成工作区覆盖全部验收项，复用适用的子结果并用平台工具补足集成检查。提交真实 candidateCommit、实现摘要和 checks 报告，再完成父级验收。'
                      : '在集成工作区核对全部已确认验收项，复用适用的子任务结果并补足集成缺口。提交实际 candidateCommit、实现总结和所选 verificationChecks，再完成父级的完整验收。'
                    : run.workflow.version === '4'
                      ? '按已批准的需求完成实现，用平台工具执行必要检查并等待真实结果。将命令、目录、结果和日志引用写入 checks 的 name/result/note，提交实现和实际报告后直接验收；不提交 Runtime 检查计划或收据。'
                      : '按已批准的 brief、Spec 和全部验收项完成实现。TDD RED 与局部调试照常；首次最终 GREEN 或完整验证直接在结果中提交 request-checks，不先在终端重复同一完整计划。收到真实检查结果后继续 Build，沿用模板中的原检查计划；最终提交仍由 Runtime 核对证据。',
      }
    : undefined;
  const data = {
    schema: 'comet.native.task-result.v1',
    change: options.name,
    phase: state.phase,
    status: run.status === 'completed' ? 'completed' : state.status,
    workspace: {
      projectRoot: currentTask
        ? taskScope(run, currentTask, options.projectRoot).projectRoot
        : options.projectRoot,
      ownerProjectRoot: options.projectRoot,
    },
    result: {
      summary: verified?.summary ?? state.verification?.summary.text ?? summary,
      ...(state.verification
        ? {
            verdict: state.verification_result,
            assurance: state.verification.assurance,
            acceptance: state.acceptance.map((item) => ({
              ...item,
              reason:
                verified?.acceptance.find((result) => result.id === item.id)?.reason ??
                item.reason?.text ??
                null,
            })),
            risks: verified?.risks ?? state.verification.risks.map((risk) => risk.text),
            ...(verified?.requestReview ? { requestReview: verified.requestReview } : {}),
          }
        : {}),
    },
    ...(task ? { task } : {}),
    ...(available.length > 1
      ? {
          availableTasks: available.map((entry) => ({
            actionId: entry.id,
            role: verifierTask(entry)
              ? 'verify'
              : builderTask(entry)
                ? 'build'
                : entry.stepId === 'shape.prepare'
                  ? 'shape'
                  : 'integration-repair',
            ...taskScope(run, entry, options.projectRoot),
            status: entry.status,
            session: entry.claim?.sessionId ?? null,
            commandArgs:
              entry.claim && entry.claim.sessionId !== options.sessionId
                ? null
                : taskCommand(options, entry, Boolean(entry.claim)),
          })),
        }
      : {}),
    ...(currentTask && claimed
      ? { resultTemplate: nativeSdkTaskResultTemplate(run, currentTask) }
      : {}),
    next: waitingForAcceptance
      ? { askUser: continuation.userCommunication.message, commandArgs: acceptanceCommand }
      : { commandArgs, instruction: summary },
    ...('warning' in status
      ? { warning: status.warning }
      : priorStatus?.warning
        ? { warning: priorStatus.warning }
        : {}),
    ...(blocked ? { recovery: continuation.recovery, blockers: status.blockers } : {}),
    detailsCommandArgs: [
      'comet',
      'native',
      'status',
      options.name,
      '--details',
      '--project-root',
      options.projectRoot,
      '--json',
    ],
    ...(options.details ? { details: status } : {}),
  };
  return {
    ...success('next', data),
    ...(advanced?.error ? { exitCode: advanced.exitCode, error: advanced.error } : {}),
    envelope: {
      summary,
      ...(waitingForAcceptance
        ? { next: { ask_user: continuation.userCommunication.message ?? '是否接受当前验收结果？' } }
        : commandArgs
          ? { next: { command: formatCliCommandArgs(commandArgs) } }
          : {}),
    },
  };
}

/** 合并正常任务回报、内部推进和真实会话领取；所有推进仍由原 SDK Run 提交。 */
export async function advanceNativeSdkTask(options: NativeTaskOptions): Promise<DispatchResult> {
  if (!options.sessionId.trim() || options.sessionId.includes('<'))
    throw new NativeUsageError('--session 必须填写实际执行会话标识。');
  if (options.resultFile && !options.actionId)
    throw new NativeUsageError('--result 必须同时提供当前响应中的 --action。');
  if (options.acceptOnPass !== undefined && (!options.resultFile || !options.acceptOnPass.trim()))
    throw new NativeUsageError('--accept-on-pass 需要本次验收结果和用户明确委托的摘要。');
  const owned = await loadOwnedNativeSdkRuntime(options.projectRoot, options.name);
  let run = await owned.runtime.inspect(options.name);
  const originalRun = run;
  const taskResult = async (...args: Parameters<typeof projectTaskResult>) => ({
    ...(await projectTaskResult(...args)),
    workflowCompleted: hasNativeCompletedWork(originalRun, args[1]),
  });
  if (!['3', '4'].includes(run.workflow.version) || owned.application)
    throw new NativeUsageError(
      '当前高层任务入口适用于新建内置 SDK Run；此需求请继续使用原响应中的命令。',
    );
  if (run.ready.length) run = await owned.runtime.next({ runId: run.runId });
  if (options.actionId && !options.resultFile) {
    const selected = run.actions.find((action) => action.id === options.actionId);
    if (!selected || !ordinaryTask(selected) || !['pending', 'running'].includes(selected.status))
      throw new NativeUsageError('--action 必须绑定当前可领取或已领取的任务。');
    if (selected.claim && selected.claim.sessionId !== options.sessionId)
      throw new NativeUsageError('该任务已由另一个实际会话领取，请等待原会话回报。');
  }
  let reported: RuntimeAction | undefined;
  let reportedByIndependentVerifier = false;
  let repeated = false;
  let advancementObservation:
    | { run: WorkflowRun; status: Awaited<ReturnType<typeof projectNativeSdkTaskStatus>> }
    | undefined;
  const advance = async (
    decision?: Parameters<typeof advanceNativeSdkChange>[2],
  ): Promise<DispatchResult> => {
    try {
      return await advanceNativeSdkChange(
        options.projectRoot,
        options.name,
        decision,
        {
          run,
          state: parseNativePortableState(run.state),
          artifactRootRef: (run.input as { artifactRootRef: string }).artifactRootRef,
          application: owned.application,
        },
        true,
        (current, status) => {
          advancementObservation = { run: current, status };
        },
      );
    } catch (error) {
      if (!reported) throw error;
      return {
        command: 'next',
        exitCode: 73,
        error: {
          code: 'blocked',
          message: `本次结果已保存，后续推进需要处理。${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  };
  if (options.resultFile) {
    const action = run.actions.find((entry) => entry.id === options.actionId);
    if (
      !action ||
      !ordinaryTask(action) ||
      !action.claim ||
      action.claim.sessionId !== options.sessionId
    )
      throw new NativeUsageError('结果必须绑定本会话实际领取的 Shape、Builder 或 Verify 任务。');
    if (options.acceptOnPass !== undefined && action.stepId !== 'verify.verifier')
      throw new NativeUsageError(
        '--accept-on-pass 只接受本次 Verify 结果，不能预先批准 Builder 输出。',
      );
    reportedByIndependentVerifier =
      verifierTask(action) && builderSession(run, action) !== options.sessionId;
    const file = path.resolve(options.projectRoot, options.resultFile);
    const original = await readTaskResult(file);
    const previousOutput = action.outcome?.output as { requireIndependentReview?: boolean } | null;
    const shapeInput = original.output as { acceptance?: unknown };
    if (
      action.stepId === 'shape.prepare' &&
      original.status === 'succeeded' &&
      !Array.isArray(shapeInput?.acceptance)
    )
      throw new NativeUsageError('Shape 结果需要填写 acceptance 条目的 source 和 text。');
    const savedShape =
      action.stepId === 'shape.prepare' && action.status === 'succeeded'
        ? (action.outcome?.output as { acceptance: Array<{ source: string; text: string }> })
        : undefined;
    if (
      savedShape &&
      JSON.stringify(
        (shapeInput.acceptance as NativePortableAcceptanceInput[]).map((entry) => ({
          source: entry?.source,
          text: entry?.text?.trim(),
        })),
      ) !== JSON.stringify(savedShape.acceptance.map(({ source, text }) => ({ source, text })))
    )
      throw new NativeUsageError(
        '已保存的 Shape 结果不能被另一个结果替换；需求变化请沿原 Run 修订并重新确认。',
      );
    const result =
      action.stepId === 'shape.prepare' && original.status === 'succeeded'
        ? {
            ...original,
            output: (savedShape ??
              (await collectNativeSdkShapeProposal({
                paths: await nativeProjectPaths(
                  options.projectRoot,
                  (run.input as { artifactRootRef: string }).artifactRootRef,
                  { change: options.name },
                ),
                state: parseNativePortableState(run.state),
                materializeTargets: true,
                acceptance: shapeInput.acceptance as NativePortableAcceptanceInput[],
              }))) as unknown as RuntimeOutcome['output'],
          }
        : builderTask(action) &&
            original.status === 'succeeded' &&
            (options.review === 'independent' || previousOutput?.requireIndependentReview === true)
          ? {
              ...original,
              output: {
                ...(original.output as Record<string, never>),
                requireIndependentReview: true,
              },
            }
          : original;
    const outcomeId =
      'native-result-' +
      hashRuntimeValue({
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim.token,
        result,
      });
    repeated = action.outcome?.outcomeId === outcomeId;
    reportCometRuntimeProgress(
      action.stepId === 'shape.prepare'
        ? '保存需求与验收条目'
        : builderTask(action)
          ? '保存实现结果'
          : '保存验收结果',
    );
    run = await owned.runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        ...result,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim.token,
        outcomeId,
      },
      context: { requestId: outcomeId, projectRoot: options.projectRoot },
    });
    reported = run.actions.find((entry) => entry.id === action.id);
  }
  if (options.acceptOnPass !== undefined && reported) {
    const wait = run.waits.find(
      (entry) => entry.stepId === 'verify.confirm' && entry.status === 'pending',
    );
    const result = reported.outcome?.output as
      { response?: { kind?: string; result?: { verdict?: string } } } | undefined;
    const latestVerifier = run.actions.filter((entry) => entry.stepId === 'verify.verifier').at(-1);
    if (
      wait &&
      latestVerifier?.id === reported.id &&
      result?.response?.kind === 'final-result' &&
      result.response.result?.verdict === 'pass'
    ) {
      const state = parseNativePortableState(run.state);
      const advanced = await advance({
        expectedAction: 'accept-result',
        expectedStateVersion: state.state_version,
        proposalHash: wait.proposalHash,
        summary: options.acceptOnPass.trim(),
      });
      return taskResult(
        options,
        advancementObservation?.run ?? (await owned.runtime.inspect(options.name)),
        advanced,
        advancementObservation?.status,
      );
    }
  }
  const awaitingShapeInput =
    !options.resultFile &&
    run.actions.some(
      (entry) => entry.stepId === 'shape.prepare' && ['pending', 'running'].includes(entry.status),
    );
  const advanced = repeated || awaitingShapeInput ? undefined : await advance();
  if (advanced) run = advancementObservation?.run ?? (await owned.runtime.inspect(options.name));
  const pending = run.actions.filter((entry) => ordinaryTask(entry) && entry.status === 'pending');
  const reportedChild = reported ? activation(reported)?.child : undefined;
  const nextTask =
    options.actionId && !options.resultFile
      ? pending.find((entry) => entry.id === options.actionId)
      : reportedChild
        ? pending.find((entry) => activation(entry)?.child === reportedChild)
        : pending.length === 1
          ? pending[0]
          : undefined;
  const selected =
    reportedChild && nextTask && activation(nextTask)?.child !== reportedChild
      ? undefined
      : nextTask;
  const continuation = (
    advanced?.data as { continuation?: { mode?: string; action?: string } } | undefined
  )?.continuation;
  const claimAllowed =
    !continuation || (continuation.mode === 'execute' && continuation.action !== 'review-edit');
  if (
    selected &&
    !repeated &&
    claimAllowed &&
    (advanced?.exitCode ?? 0) === 0 &&
    !(
      reportedByIndependentVerifier &&
      (builderTask(selected) || selected.stepId === 'supervisor.child.integration-repair')
    ) &&
    !(
      (options.review === 'independent' ||
        (verifierTask(selected) && nativeSdkRequiresIndependentReview(run, selected))) &&
      options.resultFile &&
      (verifierTask(selected) || (reported && verifierTask(reported)))
    )
  ) {
    if (
      verifierTask(selected) &&
      (options.review === 'independent' || nativeSdkRequiresIndependentReview(run, selected)) &&
      builderSession(run, selected) === options.sessionId
    )
      throw new NativeUsageError('独立验收须由与 Builder 不同的实际会话领取。');
    reportCometRuntimeProgress(verifierTask(selected) ? '领取验收任务' : '领取实现任务');
    run = await owned.runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: selected.id,
      attempt: selected.attempt,
      inputHash: selected.inputHash,
      executorId: 'native-host',
      sessionId: options.sessionId,
      claimToken: hashRuntimeValue({
        runId: run.runId,
        actionId: selected.id,
        attempt: selected.attempt,
        sessionId: options.sessionId,
      }),
      context: { requestId: `native-task-${selected.id}`, projectRoot: options.projectRoot },
    });
  }
  // A successful claim changes only its execution identity. Domain state, decisions,
  // diagnostics and report warnings are the same observation; task fields use the committed Run.
  return taskResult(options, run, advanced, advancementObservation?.status);
}
