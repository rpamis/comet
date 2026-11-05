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
import {
  loadOwnedNativeSdkRuntime,
  registerNativeSdkRequestInput,
} from './native-runtime-ownership.js';
import { advanceNativeSdkChange } from './native-sdk-next.js';
import { nativeSdkTaskResultTemplate } from './native-sdk-continuation.js';
import { parseNativePortableState } from './native-portable-state.js';
import { projectNativeSdkStatus } from './native-sdk-status.js';
import { nativeSdkRequiresIndependentReview } from './native-sdk-review.js';

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
  return action.type === 'handoff' && ['build.builder', 'verify.verifier'].includes(action.stepId);
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
): Promise<DispatchResult> {
  const state = parseNativePortableState(run.state);
  const artifactRootRef = (run.input as { artifactRootRef: string }).artifactRootRef;
  const priorStatus = advanced?.data as { schema?: string } | undefined;
  const status = (
    priorStatus?.schema === 'comet.native.sdk-status.v1'
      ? advanced!.data
      : await projectNativeSdkStatus(
          { projectRoot: options.projectRoot, name: options.name, details: options.details },
          { run, state, artifactRootRef, application: null },
        )
  ) as Awaited<ReturnType<typeof projectNativeSdkStatus>>;
  const action = run.actions.find(
    (entry) => ordinaryTask(entry) && ['pending', 'running'].includes(entry.status),
  );
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
        ? taskCommand(options, currentTask, Boolean(claimed))
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
          : currentTask?.stepId === 'verify.verifier'
            ? claimed
              ? '实现结果已保存，当前会话已领取验收任务。'
              : '实现结果已保存，请交给实际验收会话领取。'
            : currentTask?.stepId === 'build.builder'
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
        actionId: currentTask.id,
        role: currentTask.stepId === 'verify.verifier' ? 'verify' : 'build',
        status: currentTask.status,
        session: currentTask.claim?.sessionId ?? null,
        readOnly: currentTask.stepId === 'verify.verifier',
        ...(currentTask.stepId === 'verify.verifier'
          ? { requireIndependentReview: nativeSdkRequiresIndependentReview(run, currentTask) }
          : {}),
        ...(claimed &&
        currentTask.stepId === 'verify.verifier' &&
        state.builder_handoff?.builder_execution_ref !== options.sessionId
          ? {
              contextRequest: (
                status as { activeActions?: Array<{ id: string; contextRequest?: unknown }> }
              ).activeActions?.find((entry) => entry.id === currentTask.id)?.contextRequest,
            }
          : {}),
        originalRequest: (run.input as { task?: string }).task,
        acceptance: state.acceptance,
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
              checks: [...checks.values()],
            }
          : {}),
        instruction:
          currentTask.stepId === 'verify.verifier'
            ? '对照原始请求、Spec、实现和全部验收项，复用当前有效检查，只补缺失证据。用户要求独立审查时交给独立会话。用实际观察填写结果，存在未解决问题时报告 fail 或 blocked。'
            : '按已批准的 brief、Spec 和全部验收项完成实现；需要受管检查时在结果中提交 request-checks，收到检查结果后继续 Build。',
      }
    : undefined;
  const data = {
    schema: 'comet.native.task-result.v1',
    change: options.name,
    phase: state.phase,
    status: run.status === 'completed' ? 'completed' : state.status,
    workspace: { projectRoot: options.projectRoot },
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
    ...(currentTask && claimed
      ? { resultTemplate: nativeSdkTaskResultTemplate(run, currentTask) }
      : {}),
    next: waitingForAcceptance
      ? { askUser: continuation.userCommunication.message, commandArgs: acceptanceCommand }
      : { commandArgs, instruction: summary },
    ...('warning' in status ? { warning: status.warning } : {}),
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
  if (run.workflow.version !== '3' || owned.application)
    throw new NativeUsageError(
      '当前高层任务入口适用于新建内置 SDK Run；此需求请继续使用原响应中的命令。',
    );
  if (parseNativePortableState(run.state).children_contract_hash)
    throw new NativeUsageError(
      'Supervisor 任务保留各 Child 与父级交付协议，请使用当前响应中的命令。',
    );
  if (parseNativePortableState(run.state).phase === 'shape')
    throw new NativeUsageError('请先按当前 Shape 提案取得明确确认，再领取实现任务。');
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
  const advance = async (
    decision?: Parameters<typeof advanceNativeSdkChange>[2],
  ): Promise<DispatchResult> => {
    try {
      return await advanceNativeSdkChange(options.projectRoot, options.name, decision);
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
      throw new NativeUsageError('结果必须绑定本会话实际领取的 Builder 或 Verify 任务。');
    if (options.acceptOnPass !== undefined && action.stepId !== 'verify.verifier')
      throw new NativeUsageError(
        '--accept-on-pass 只接受本次 Verify 结果，不能预先批准 Builder 输出。',
      );
    reportedByIndependentVerifier =
      action.stepId === 'verify.verifier' &&
      parseNativePortableState(run.state).builder_handoff?.builder_execution_ref !==
        options.sessionId;
    const file = path.resolve(options.projectRoot, options.resultFile);
    const original = await readTaskResult(file);
    const previousOutput = action.outcome?.output as { requireIndependentReview?: boolean } | null;
    const result =
      action.stepId === 'build.builder' &&
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
    await registerNativeSdkRequestInput({
      projectRoot: options.projectRoot,
      artifactRootRef: (run.input as { artifactRootRef: string }).artifactRootRef,
      file,
      runId: run.runId,
      validateContent(content) {
        if (JSON.stringify(JSON.parse(stripUtf8Bom(content))) !== JSON.stringify(original))
          throw new Error('Native 结果文件在读取后发生变化，请保留原结果重新提交。');
      },
    });
    reportCometRuntimeProgress(action.stepId === 'build.builder' ? '保存实现结果' : '保存验收结果');
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
      return projectTaskResult(options, await owned.runtime.inspect(options.name), advanced);
    }
  }
  const advanced = repeated ? undefined : await advance();
  run = await owned.runtime.inspect(options.name);
  const pending = run.actions.filter((entry) => ordinaryTask(entry) && entry.status === 'pending');
  const selected =
    options.actionId && !options.resultFile
      ? pending.find((entry) => entry.id === options.actionId)
      : pending.length === 1
        ? pending[0]
        : undefined;
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
    !(reportedByIndependentVerifier && selected.stepId === 'build.builder') &&
    !(
      (options.review === 'independent' ||
        (selected.stepId === 'verify.verifier' &&
          nativeSdkRequiresIndependentReview(run, selected))) &&
      options.resultFile &&
      (selected.stepId === 'verify.verifier' || reported?.stepId === 'verify.verifier')
    )
  ) {
    const state = parseNativePortableState(run.state);
    if (
      selected.stepId === 'verify.verifier' &&
      (options.review === 'independent' || nativeSdkRequiresIndependentReview(run, selected)) &&
      state.builder_handoff?.builder_execution_ref === options.sessionId
    )
      throw new NativeUsageError('独立验收须由与 Builder 不同的实际会话领取。');
    reportCometRuntimeProgress(
      selected.stepId === 'verify.verifier' ? '领取验收任务' : '领取实现任务',
    );
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
  return projectTaskResult(
    options,
    run,
    selected && run.actions.find((entry) => entry.id === selected.id)?.status === 'running'
      ? undefined
      : advanced,
  );
}
