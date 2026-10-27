import {
  nativeSdkVerifyDecisions,
  nativeSdkVerifyWaitDecisions,
} from './native-sdk-verify-decision.js';
import path from 'node:path';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { nativeSdkCompletedCheckInputDrift } from './native-sdk-checks.js';
import { nativeRecoveryForContinuation } from './native-recovery.js';
import { nativeTaskContextRequest } from './native-task-context.js';
import {
  hashRuntimeValue,
  type WorkflowRun,
  type RuntimeAction,
  type RuntimeExecutor,
  type RuntimeValue,
} from '../engine/runtime.js';
import {
  nativePortableContinuation,
  type NativePortableContinuation,
} from './native-portable-continuation.js';
import { inspectNativeSdkSupervisorRecovery } from './native-sdk-supervisor-recovery.js';
import { nativeSdkChildVerifierRetryWaits } from './native-sdk-supervisor-verifier-recovery.js';
import { nativeSdkRecoverableFailureReason } from './native-sdk-definition.js';
import {
  projectNativeSdkCancellationContinuation,
  type inspectNativeSdkCancellation,
} from './native-sdk-cancellation.js';
import {
  inspectNativeSdkCheckExecutions,
  type NativeSdkCheckExecutionInspection,
} from './native-sdk-check-execution.js';
import {
  NATIVE_SDK_ARCHIVE_STEPS,
  nativeSdkRetryableArchivePreflight,
  nativeSdkRetryableArchiveFinalization,
  inspectNativeSdkPendingArchiveDrift,
} from './native-sdk-archive.js';
import { collectNativeSdkShapeProposal } from './native-sdk-application.js';
import { nativeProjectPaths } from './native-paths.js';
import {
  editReviewContinuation,
  inspectEditReviews,
  type EditReviewObservation,
} from '../workflow-contract/edit-review.js';
import { nativeEditReviewScope } from './native-edit-review.js';
import { inspectNativePortableAcceptanceDrift } from './native-portable-requirements.js';
import {
  nativeSdkRequirementsRevisionAllowed,
  nativeSdkStoppedBuilderWait,
  nativeSdkPendingBuilderRevisionHash,
} from './native-sdk-revise.js';
import {
  NATIVE_SUPERVISOR_COORDINATION_MODES,
  type NativePortableState,
} from './native-portable-types.js';

/** 调度与展示使用同一顺序；终态不再暴露可领取的遗留 Action。 */
export function nativeSdkPendingActions(run: WorkflowRun): RuntimeAction[] {
  if (['failed', 'cancelled', 'completed'].includes(run.status)) return [];
  const pending = run.actions.filter((action) => action.status === 'pending');
  const archiveIndex = pending.findIndex((action) => action.stepId === 'supervisor.child.archive');
  if (archiveIndex > 0) pending.unshift(...pending.splice(archiveIndex, 1));
  return pending;
}

/** 推进和投影共享审批、未知结果及归档串行边界，不猜测在途任务已经结束。 */
export function nativeSdkNextAction(
  run: WorkflowRun,
  state: NativePortableState,
): RuntimeAction | undefined {
  if (
    run.waits.some((wait) => wait.status === 'pending') ||
    run.evidenceWaits?.some((wait) => wait.status === 'pending') ||
    run.actions.some((action) => action.status === 'unknown') ||
    (state.phase === 'archive' && run.actions.some((action) => action.status === 'running'))
  )
    return undefined;
  return nativeSdkPendingActions(run)[0];
}

function sdkCommandArgs(commandArgs: string[], projectRoot: string): string[] {
  return [
    ...commandArgs,
    ...(commandArgs.includes('--project-root') ? [] : ['--project-root', projectRoot]),
    ...(commandArgs.includes('--json') ? [] : ['--json']),
  ];
}

function bindSdkContinuation(
  continuation: NativePortableContinuation,
  projectRoot: string,
): NativePortableContinuation {
  return {
    ...continuation,
    cwd: projectRoot,
    commandArgs: continuation.commandArgs
      ? sdkCommandArgs(continuation.commandArgs, projectRoot)
      : null,
    ...(continuation.commandAlternatives
      ? {
          commandAlternatives: continuation.commandAlternatives.map((alternative) => ({
            ...alternative,
            commandArgs: alternative.commandArgs
              ? sdkCommandArgs(alternative.commandArgs, projectRoot)
              : null,
          })),
        }
      : {}),
  };
}

function sdkDispatchCommand(applicationId: string, projectRoot: string): string[] {
  return sdkCommandArgs(
    [
      'comet',
      'runtime',
      'dispatch',
      '--application',
      applicationId,
      '--request',
      '<request-json-file>',
    ],
    projectRoot,
  );
}

/** 模板只绑定原领取身份；状态和结果必须来自本次真实执行。 */
function nativeSdkOutcomeOutput(
  run: WorkflowRun,
  state: NativePortableState,
  action: RuntimeAction,
): RuntimeValue {
  const activation = (action.input as { activation?: Record<string, RuntimeValue> })?.activation;
  const check = {
    id: '<check-id>',
    name: '<check-name>',
    executable: '<executable>',
    argv: ['<argument>'],
    cwdRef: '.',
    timeoutMs: '<positive-integer>',
    repeatable: '<true|false>',
  };
  const acceptance = (
    Array.isArray(activation?.acceptance)
      ? (activation.acceptance as { id: string }[])
      : state.acceptance
  ).map(({ id }) => ({ id, result: '<passed|failed|blocked>', reason: '<observed-evidence>' }));
  if (['build.builder', 'supervisor.parent.builder'].includes(action.stepId))
    return {
      summary: '<actual-implementation-summary>',
      addressedAcceptanceIds: state.acceptance.map(({ id }) => id),
      acceptanceReview: state.acceptance.map(({ id }) => ({
        id,
        status: '<implemented-with-evidence|implemented-no-evidence|not-implemented|known-fail>',
        evidence: ['<actual-implementation-evidence>'],
        note: '<self-review>',
      })),
      checks: [
        { name: '<check-name>', result: '<passed|failed|not-run>', note: '<actual-result>' },
      ],
      knownLimits: ['<actual-limit-or-remove-entry>'],
      submittedAt: '<YYYY-MM-DDTHH:mm:ss.sssZ; use new Date().toISOString()>',
      verificationChecks: [check],
      ...(action.stepId === 'supervisor.parent.builder'
        ? { candidateCommit: '<current-integration-HEAD>' }
        : {}),
    };
  if (action.stepId === 'verify.verifier')
    return {
      candidateId: state.builder_handoff?.candidate_id ?? null,
      verifierExecutionRef: action.claim?.sessionId ?? '<independent-session-id>',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: '<pass|fail|blocked>',
          acceptance,
          risks: ['<observed-risk-or-remove-entry>'],
          summary: '<independent-verification-summary>',
        },
      },
    };
  if (action.stepId === 'supervisor.child.builder')
    return { candidateCommit: '<current-child-HEAD>', verificationChecks: [check] };
  if (action.stepId === 'supervisor.child.verifier')
    return {
      candidateCommit: activation?.candidateCommit ?? null,
      verdict: '<pass|fail|blocked>',
      evidence: {
        summary: '<independent-verification-summary>',
        checks: (
          (
            run.actions.find(({ id }) => id === activation?.checkActionId)?.outcome?.output as
              { checks?: { id: string }[] } | undefined
          )?.checks ?? []
        ).map(({ id }) => id),
        acceptance,
      },
      integrationChecks: [{ ...check, repeatable: true }],
    };
  if (action.stepId === 'supervisor.child.integration-repair')
    return {
      summary: '<repair-summary>',
      integrationCommit: '<new-integration-HEAD>',
      integrationChecks: [{ ...check, repeatable: true }],
    };
  return '<actual-action-output>';
}

function nativeSdkOutcomeRequest(
  run: WorkflowRun,
  action: RuntimeAction,
  state: NativePortableState,
) {
  if (!action.claim || !['running', 'unknown'].includes(action.status)) return null;
  return {
    operation: 'record-outcome',
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim.token,
      outcomeId: '<outcome-id>',
      status: action.type === 'handoff' ? 'succeeded' : '<succeeded|failed>',
      output: nativeSdkOutcomeOutput(run, state, action),
    },
  };
}

function nativeSdkOutcomeAlternatives(
  run: WorkflowRun,
  action: RuntimeAction,
  state: NativePortableState,
) {
  const request = nativeSdkOutcomeRequest(run, action, state);
  if (!request || action.type !== 'handoff') return {};
  return {
    outcomeTemplateInstruction:
      state.language === 'zh-CN'
        ? '完整保存 stdout JSON，stderr 另存；一次解析并提取 data.outcomeRequest、data.contextRequest 和 data.action。不要用 head 或 tail 截断 JSON，不要把后台任务提示当作 JSON。SDK inspect 的 data 是原始 Run，不含 Native 状态投影的 continuation 或 pendingActions。使用当前模板，不通过检索 Comet Runtime 源码猜字段；仅在返回缺项或实际错误缺少诊断时再调查。用实际结果替换全部占位值，删除不适用的列表项。succeeded 表示任务已完成，验收是否通过由 verdict 表达。已知无法独立验收时，执行自己的 contextRequest 后如实提交 blocked，不为得到结果而重跑检查或假装已独立审查。保留原领取身份，禁止直接提交未填写的模板。'
        : 'Save complete stdout JSON and keep stderr separate. Parse it once to extract data.outcomeRequest, data.contextRequest and data.action. Do not truncate JSON with head or tail, or parse a background-task notice as JSON. SDK inspect returns the raw Run in data, without the Native status projection continuation or pendingActions. Use the current templates instead of searching Comet Runtime source to guess fields; investigate only missing fields or actual errors without a diagnosis. Replace every placeholder with observed results and remove unused entries. succeeded means the task finished, not that acceptance passed. When independent review is known to be unavailable, execute your contextRequest and report blocked honestly; do not rerun checks or pretend an independent review occurred. Keep the original claim identity. Never submit this template unchanged.',
    failureOutcomeRequest: {
      ...request,
      outcome: {
        ...request.outcome,
        status: 'failed',
        output: { summary: '<actual-execution-failure>' },
      },
    },
    ...(action.stepId === 'verify.verifier'
      ? {
          requestChecksOutcomeRequest: {
            ...request,
            outcome: {
              ...request.outcome,
              output: {
                candidateId: state.builder_handoff?.candidate_id ?? null,
                verifierExecutionRef: action.claim?.sessionId ?? null,
                response: {
                  kind: 'request-checks',
                  iteration: state.loop.iteration,
                  attempt: state.loop.attempt,
                  checks: [
                    {
                      id: '<check-id>',
                      name: '<check-name>',
                      executable: '<executable>',
                      argv: ['<argument>'],
                      cwdRef: '.',
                      timeoutMs: '<positive-integer>',
                      repeatable: '<true|false>',
                    },
                  ],
                },
              },
            },
          },
        }
      : {}),
  };
}

/** 宿主任务的核对模板不适用于已经执行的 Runtime 检查、归档或已拒绝的结果。 */
function nativeSdkHostRecoveryRequests(run: WorkflowRun, action: RuntimeAction) {
  if (action.type !== 'handoff' || !action.claim) return {};
  const identity = {
    runId: run.runId,
    expectedRevision: run.revision,
    actionId: action.id,
    attempt: action.attempt,
  };
  if (action.status === 'running')
    return {
      markUnknownRequest: {
        operation: 'mark-unknown',
        ...identity,
        reason: '<why-the-original-outcome-cannot-be-obtained>',
      },
    };
  if (
    action.status !== 'unknown' ||
    action.outcome ||
    action.rejectedOutcomes?.some((rejection) => rejection.outcome.attempt === action.attempt)
  )
    return {};
  return {
    retryRequest: {
      operation: 'retry',
      ...identity,
      reconciliation: { resolution: 'not-executed', evidence: null },
    },
    requiredInputs: [
      'reconciliation.evidence: authoritative evidence that the original host task never executed',
    ],
  };
}

/** CLI 只省略无关 Run 历史，当前 Action、输入和状态保持完整。 */
export async function projectNativeSdkDispatchResult(options: {
  run: WorkflowRun;
  state: NativePortableState;
  actionId: string;
  projectRoot: string;
  applicationId?: string;
  skillExecutors?: readonly RuntimeExecutor[];
}) {
  const { run, state } = options;
  const action = run.actions.find((entry) => entry.id === options.actionId);
  if (!action) throw new Error(`Native SDK Action ${options.actionId} is missing`);
  const applicationId = options.applicationId ?? 'native';
  const outcomeRequest = nativeSdkOutcomeRequest(run, action, state);
  const projection = await projectNativeSdkContinuation(options);
  // 领取响应已经包含完整 Action；原任务索引复用该正文，避免重复序列化输入。
  const activeActions =
    'activeActions' in projection
      ? projection.activeActions?.map((current) => {
          if (current.id !== action.id) return current;
          const { input, outcomeRequest: _outcomeRequest, contextRequest, ...identity } = current;
          void input;
          void _outcomeRequest;
          for (const field of [
            'outcomeTemplateInstruction',
            'failureOutcomeRequest',
            'requestChecksOutcomeRequest',
          ])
            Reflect.deleteProperty(identity, field);
          return {
            ...identity,
            ...(contextRequest
              ? {
                  contextRequest: {
                    phase: contextRequest.phase,
                    contextMode: contextRequest.contextMode,
                    commandArgs: contextRequest.commandArgs,
                  },
                }
              : {}),
            inputRef: 'action.input',
            outcomeRequestRef: 'outcomeRequest',
            ...(action.type === 'handoff'
              ? { failureOutcomeRequestRef: 'failureOutcomeRequest' }
              : {}),
            ...(action.stepId === 'verify.verifier'
              ? { requestChecksOutcomeRequestRef: 'requestChecksOutcomeRequest' }
              : {}),
          };
        })
      : undefined;
  // 领取方使用当前 Action 的请求；完整协议仍由状态响应和 Skill 提供。
  const { contextRequest: _phaseContext, ...continuationWithoutContext } = projection.continuation;
  void _phaseContext;
  const hasClaimedContext = activeActions?.some(
    (current) => current.id === action.id && 'contextRequest' in current,
  );
  const contextRequest = activeActions?.find((current) => current.id === action.id)?.contextRequest;
  return {
    schema: 'comet.native.dispatch-result.v1' as const,
    runId: run.runId,
    revision: run.revision,
    workflow: run.workflow,
    status: run.status,
    workspace: { projectRoot: options.projectRoot },
    ...(outcomeRequest ? { outcomeRequest } : {}),
    ...(contextRequest ? { contextRequest } : {}),
    ...nativeSdkOutcomeAlternatives(run, action, state),
    state,
    action,
    ...projection,
    ...(hasClaimedContext ? { continuation: continuationWithoutContext } : {}),
    ...(activeActions ? { activeActions } : {}),
    inspection: {
      commandArgs: [
        'comet',
        'runtime',
        'dispatch',
        '--application',
        applicationId,
        '--request',
        '<inspect-request-json-file>',
        '--project-root',
        options.projectRoot,
        '--json',
      ],
      request: { operation: 'inspect', runId: run.runId },
    },
  };
}

function sdkShapeContinuation(
  state: NativePortableState,
  supervisorConfirmation: boolean,
): ReturnType<typeof nativePortableContinuation> {
  const continuation = nativePortableContinuation(state);
  if (!supervisorConfirmation) return continuation;
  const chinese = state.language === 'zh-CN';
  return {
    ...continuation,
    requiredInputs: ['summary', 'shared-understanding-confirmation', 'coordination-mode'],
    commandAlternatives: NATIVE_SUPERVISOR_COORDINATION_MODES.map((mode) => ({
      name: mode,
      stateVersion: state.state_version,
      expectedAction: 'confirm-shape' as const,
      commandArgs: [
        'comet',
        'native',
        'next',
        state.name,
        '--summary',
        '<summary>',
        '--confirmed',
        '--coordination-mode',
        mode,
        '--expected-state-version',
        String(state.state_version),
        '--expected-action',
        'confirm-shape',
      ],
      requiredInputs: ['summary', 'shared-understanding-confirmation', 'coordination-mode'],
      inputOptions: [
        {
          name: 'summary',
          flag: '--summary',
          valueKind: 'text' as const,
          required: true,
          template: null,
        },
        {
          name: 'shared-understanding-confirmation',
          flag: '--confirmed',
          valueKind: 'confirmation' as const,
          required: true,
          template: null,
        },
        {
          name: 'coordination-mode',
          flag: '--coordination-mode',
          valueKind: 'choice' as const,
          required: true,
          template: mode,
          choices: [...NATIVE_SUPERVISOR_COORDINATION_MODES],
        },
      ],
    })),
    userCommunication: {
      required: true,
      message: chinese
        ? '请确认完整 Shape，并选择推进方式：多会话协作（推荐）或单会话推进。'
        : 'Confirm the complete Shape and choose multi-session coordination (recommended) or single-session progression.',
      suggestedReply: chinese
        ? '确认 Shape，选择多会话协作'
        : 'Confirm Shape with multi-session coordination',
      agentInstruction: chinese
        ? '先简要展示目标、范围、关键决定、验收标准、非目标及 Child 计划，再转述 message。只有用户明确确认当前完整 Shape 并选定推进方式后，才执行对应的 commandAlternatives；补充或修改要求不算确认。'
        : 'Summarize the target, scope, key decisions, acceptance criteria, non-goals, and child plan before relaying message. Execute the matching commandAlternative only after the user explicitly confirms the complete current Shape and chooses a coordination mode; additions or corrections are not confirmation.',
    },
  };
}

function sdkLoopStopContinuation(
  run: WorkflowRun,
  state: NativePortableState,
  proposalHash: string,
) {
  const continuation = nativePortableContinuation(state);
  const decisions = nativeSdkVerifyDecisions(run, state).filter(
    ({ wait }) => wait.proposalHash === proposalHash,
  );
  if (
    state.loop.next_action === 'resolve-verifier-blocker' &&
    !decisions.some(({ action }) => action === 'resolve-verifier-blocker')
  ) {
    // 旧定义的 Wait 只有 repair；先精确迁移，不能展示执行时必然被拒的 retry。
    return {
      ...continuation,
      action: 'none' as const,
      disposition: 'blocked' as const,
      mode: 'reconcile' as const,
      requiresUserDecision: false,
      commandArgs: ['comet', 'native', 'doctor', state.name, '--repair'],
      commandAlternatives: undefined,
      requiredInputs: [],
      inputOptions: [],
      userCommunication: {
        required: false,
        message: null,
        suggestedReply: null,
        agentInstruction:
          state.language === 'zh-CN'
            ? '更新原 Run 的恢复选项，然后重新读取 continuation。保留候选和检查；只有用户明确决定后才重新验收或修复实现，不需要重新确认需求。'
            : 'Update the original Run recovery choices, then read its continuation again. Preserve the candidate and checks; retry verification or repair only after an explicit user decision. Do not reset the requirements.',
      },
    };
  }
  return {
    ...continuation,
    commandAlternatives: [
      ...decisions.map(({ action, wait }) => sdkDecision(state, action, wait.proposalHash)),
      sdkDecision(state, 'revise-requirements'),
    ],
  };
}

function sdkDecision(
  state: NativePortableState,
  action:
    | 'accept-result'
    | 'revise-implementation'
    | 'revise-requirements'
    | 'retry-verifier'
    | 'continue-builder'
    | 'resolve-verifier-blocker',
  proposalHash?: string,
) {
  return {
    name: action,
    stateVersion: state.state_version,
    expectedAction: action,
    commandArgs: [
      'comet',
      'native',
      'next',
      state.name,
      `--${action}`,
      '--summary',
      '<summary>',
      ...(proposalHash === undefined ? [] : ['--proposal-hash', proposalHash]),
      '--expected-state-version',
      String(state.state_version),
      '--expected-action',
      action,
    ],
    requiredInputs: ['summary', 'user-decision'],
    inputOptions: [
      {
        name: 'summary',
        flag: '--summary',
        valueKind: 'text' as const,
        required: true,
        template: null,
      },
    ],
  };
}

/** 从同一 Run 投影下一步；SDK 不使用 compat Runner 输入或 workspace finish 决定。 */
export async function projectNativeSdkContinuation(
  options: Parameters<typeof projectNativeSdkContinuationValue>[0],
) {
  const projection = await projectNativeSdkContinuationValue(options);
  const pendingArchive =
    options.state.phase === 'archive' &&
    projection.continuation.action === 'archive' &&
    !options.run.actions.some((action) => ['running', 'unknown'].includes(action.status))
      ? nativeSdkNextAction(options.run, options.state)
      : undefined;
  const approved = [...options.run.waits]
    .reverse()
    .find(
      (wait) =>
        wait.stepId === 'verify.confirm' &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'approved',
    );
  if (pendingArchive && approved) {
    const paths = await nativeProjectPaths(
      options.projectRoot,
      (options.run.input as { artifactRootRef: string }).artifactRootRef,
      { readOnly: true },
    );
    const shape = await inspectNativePortableAcceptanceDrift({ paths, state: options.state });
    if (shape.drifted && shape.reviewRequired) {
      const scope = nativeEditReviewScope(paths, options.state);
      const reviews = options.editReviews ?? (await inspectEditReviews(scope));
      const edit = await editReviewContinuation(scope, reviews, true);
      const requiresRevision =
        edit?.mode === 'reconcile' &&
        reviews.some(
          (review) =>
            review.applied &&
            review.receipt?.authority.kind !== 'runtime-superseded' &&
            review.receipt?.decision === 'requirements-changed',
        );
      if (!requiresRevision) {
        const commandArgs =
          edit?.commandArgs ??
          sdkCommandArgs(
            ['comet', 'edit-review', 'prepare-applied', 'native', options.state.name],
            options.projectRoot,
          );
        const recovery = nativeRecoveryForContinuation({
          state: options.state,
          projectRoot: options.projectRoot,
          reason: shape.reason ?? 'Review the user-edited formal comments',
          continuation: {
            disposition: 'blocked',
            commandArgs: commandArgs ? [...commandArgs] : null,
            requiredInputs: [...(edit?.requiredInputs ?? [])],
          },
        })!;
        recovery.code = 'shape-drift';
        return {
          ...projection,
          continuation: {
            ...projection.continuation,
            disposition:
              edit?.mode === 'ask'
                ? ('await-user' as const)
                : edit?.mode === 'reconcile'
                  ? ('blocked' as const)
                  : ('continue' as const),
            mode: edit?.mode ?? ('execute' as const),
            action: 'review-edit' as const,
            requiresUserDecision: edit?.mode === 'ask',
            commandArgs,
            commandAlternatives: undefined,
            requiredInputs: edit?.requiredInputs ?? [],
            inputOptions: [],
            recovery,
            userCommunication: {
              required: false,
              message: null,
              suggestedReply: null,
              agentInstruction:
                edit?.instruction ??
                '正式材料中的注释已经由用户修改。保留当前文件，准备独立复核并对比原批准内容；不要重建需求或覆盖用户修改。',
            },
          },
        };
      }
    }
    if (shape.drifted) {
      const decision = sdkDecision(options.state, 'revise-requirements');
      const commandArgs = sdkCommandArgs(decision.commandArgs, options.projectRoot);
      const recovery = nativeRecoveryForContinuation({
        state: options.state,
        projectRoot: options.projectRoot,
        reason: shape.reason ?? 'Approved requirements changed',
        continuation: { disposition: 'blocked', commandArgs, requiredInputs: [] },
      })!;
      recovery.code = 'shape-drift';
      recovery.affectedPaths = (shape.affectedSources ?? []).map((source) =>
        path.resolve(paths.changesDir, options.state.name, source),
      );
      return {
        ...projection,
        continuation: {
          ...projection.continuation,
          disposition: 'continue' as const,
          mode: 'execute' as const,
          action: 'repair' as const,
          requiresUserDecision: false,
          commandArgs,
          requiredInputs: ['summary'],
          inputOptions: decision.inputOptions,
          commandAlternatives: [{ ...decision, commandArgs, requiredInputs: ['summary'] }],
          recovery,
          userCommunication: {
            required: false,
            message: null,
            suggestedReply: null,
            agentInstruction:
              options.state.language === 'zh-CN'
                ? '正式需求已变化。先检查用户的修改；已有授权时在同一 Run 修订需求并保留现有代码，再展示完整新 Shape 供用户确认。没有授权时先询问，不能沿用旧批准。'
                : 'Inspect the changed requirements. If already authorized, revise them on the same Run and preserve the implementation, then present the complete new Shape for confirmation. Ask when authorization is missing; do not reuse the old approval.',
          },
        },
      };
    }
    let drift: Awaited<ReturnType<typeof inspectNativeSdkPendingArchiveDrift>>;
    try {
      drift = await inspectNativeSdkPendingArchiveDrift({
        run: options.run,
        action: pendingArchive,
        projectRoot: options.projectRoot,
      });
    } catch (error) {
      const recovery = nativeRecoveryForContinuation({
        state: options.state,
        projectRoot: options.projectRoot,
        reason: error instanceof Error ? error.message : String(error),
        continuation: { disposition: 'blocked', commandArgs: null, requiredInputs: [] },
      })!;
      return {
        ...projection,
        continuation: {
          ...projection.continuation,
          disposition: 'blocked' as const,
          mode: 'reconcile' as const,
          action: 'none' as const,
          commandArgs: null,
          recovery,
          userCommunication: {
            required: false,
            message: null,
            suggestedReply: null,
            agentInstruction: `归档输入检查未完成：${recovery.reason}。先核对原因，不要执行归档。`,
          },
        },
      };
    }
    if (drift) {
      if (options.implementationRevisionAvailable === false) {
        const recovery = nativeRecoveryForContinuation({
          state: options.state,
          projectRoot: options.projectRoot,
          reason: drift.message,
          continuation: { disposition: 'blocked', commandArgs: null, requiredInputs: [] },
        })!;
        recovery.code =
          drift.reason === 'candidate-drift' ? 'candidate-drift' : 'verification-report-drift';
        return {
          ...projection,
          continuation: {
            ...projection.continuation,
            disposition: 'blocked' as const,
            mode: 'reconcile' as const,
            action: 'none' as const,
            commandArgs: null,
            recovery,
            userCommunication: {
              required: false,
              message: null,
              suggestedReply: null,
              agentInstruction:
                '当前固定应用没有实现修订入口。保留原 Run 和用户修改，检查该应用支持的恢复方式；不要执行归档或更换固定应用。',
            },
          },
        };
      }
      const decision = sdkDecision(options.state, 'revise-implementation', approved.proposalHash);
      const commandArgs = sdkCommandArgs(decision.commandArgs, options.projectRoot);
      const recovery = nativeRecoveryForContinuation({
        state: options.state,
        projectRoot: options.projectRoot,
        reason: drift.message,
        continuation: { disposition: 'blocked', commandArgs, requiredInputs: [] },
      })!;
      recovery.code =
        drift.reason === 'candidate-drift' ? 'candidate-drift' : 'verification-report-drift';
      const chinese = options.state.language === 'zh-CN';
      return {
        ...projection,
        continuation: {
          ...projection.continuation,
          disposition: 'continue' as const,
          mode: 'execute' as const,
          action: 'repair' as const,
          requiresUserDecision: false,
          commandArgs,
          requiredInputs: ['summary'],
          inputOptions: decision.inputOptions,
          commandAlternatives: [{ ...decision, commandArgs, requiredInputs: ['summary'] }],
          userCommunication: {
            required: false,
            message: null,
            suggestedReply: null,
            agentInstruction:
              (drift.reason === 'report-missing'
                ? chinese
                  ? '原 verification.md 已缺失；保留用户移动或修改的文件，重新验收后生成当前报告。'
                  : 'The original verification.md is missing; preserve any moved or edited files and generate a current report after revalidation. '
                : drift.reason === 'report-drift'
                  ? chinese
                    ? '先读取用户修改的 verification.md，将补充内容作为待核对输入，不把旧报告视为新验收结论。'
                    : 'First read the user-edited verification.md and assess its notes as inputs, not as proof that the new candidate passed. '
                  : '') +
              (chinese
                ? '先检查用户的实际修改。已有授权且仍在已确认需求范围内时，执行当前修订命令，保留现有工作并重新验收；需求变化或缺少授权时先确认。不要重跑原一次性检查。'
                : 'Inspect the actual edits first. If continued work is already authorized and remains within approved requirements, run the revision command, retain the work and independently verify it. Reconfirm changed requirements or ask when authorization is missing. Do not repeat original one-shot checks.'),
          },
          recovery,
        },
      };
    }
  }
  const stopped = [...options.run.actions]
    .reverse()
    .find((action) => ['failed', 'unknown', 'running'].includes(action.status));
  const output = stopped?.outcome?.output as
    { message?: string; blockers?: unknown[]; reason?: string } | null | undefined;
  const candidateDrift = Boolean(
    output?.reason === 'candidate-drift' &&
    options.state.phase === 'verify' &&
    stopped &&
    options.run.actions.indexOf(stopped) >
      options.run.actions
        .map(
          (action: RuntimeAction) =>
            ['build.builder', 'supervisor.parent.builder'].includes(action.stepId) &&
            action.status === 'succeeded',
        )
        .lastIndexOf(true),
  );
  const reason =
    typeof output?.message === 'string'
      ? output.message
      : (Array.isArray(output?.blockers)
          ? output.blockers.filter((entry) => typeof entry === 'string').join('; ')
          : '') ||
        stopped?.reason ||
        options.run.reason ||
        projection.continuation.userCommunication.message ||
        undefined;
  const recovery = nativeRecoveryForContinuation({
    state: options.state,
    continuation: candidateDrift
      ? {
          ...projection.continuation,
          disposition: 'blocked',
          commandArgs:
            projection.continuation.commandAlternatives?.find(
              (option) => option.name === 'revise-implementation',
            )?.commandArgs ?? projection.continuation.commandArgs,
        }
      : projection.continuation,
    projectRoot: options.projectRoot,
    reason,
  });
  if (recovery && stopped) {
    recovery.owner = {
      actionId: stopped.id,
      attempt: stopped.attempt,
      executorId: stopped.claim?.executorId ?? null,
      sessionId: stopped.claim?.sessionId ?? null,
    };
    if (stopped.stepId === 'archive.prepare') recovery.code = 'archive-preflight-blocked';
    else if (['unknown', 'running'].includes(stopped.status))
      recovery.code = 'execution-unresolved';
    if (candidateDrift) recovery.code = 'candidate-drift';
  }
  if (candidateDrift && !options.state.loop.stop_reason) {
    const chinese = options.state.language === 'zh-CN';
    const repair = projection.continuation.commandAlternatives?.find(
      (option) => option.name === 'revise-implementation',
    );
    if (repair) {
      // 用户已授权继续当前工作时，核对现有修改即可安排修复；这不是接受新候选或扩大授权。
      const authorizedRepair = { ...repair, requiredInputs: ['summary'] };
      projection.continuation = {
        ...projection.continuation,
        disposition: 'continue',
        mode: 'execute',
        action: 'repair',
        requiresUserDecision: false,
        commandArgs: authorizedRepair.commandArgs,
        requiredInputs: authorizedRepair.requiredInputs,
        inputOptions: authorizedRepair.inputOptions,
        commandAlternatives: projection.continuation.commandAlternatives?.map((option) =>
          option.name === 'revise-implementation' ? authorizedRepair : option,
        ),
        userCommunication: {
          required: false,
          message: null,
          suggestedReply: null,
          agentInstruction: chinese
            ? '先检查实际修改。若用户已有授权继续且改动仍在已确认需求范围内，执行 revise-implementation，保留现有工作和原检查，再建立后继候选并独立验收；不重建需求或重复原一次性检查。若需求或验收标准变化，走需求修订并重新确认；缺少继续授权或需要新增权限时先询问。不得自动接受新候选或沿用失效证据。'
            : 'Inspect the actual edits first. If the user has already authorized continued work and the edits remain within approved requirements, run revise-implementation, retain the existing work and original checks, and independently verify a successor candidate; do not recreate requirements or repeat original one-shot checks. If requirements or acceptance criteria changed, revise and reconfirm them; ask when continued work or additional permissions are not authorized. Do not automatically accept the successor or reuse invalid evidence.',
        },
      };
    }
  }
  return recovery
    ? { ...projection, continuation: { ...projection.continuation, recovery } }
    : projection;
}

async function projectNativeSdkContinuationValue(options: {
  run: WorkflowRun;
  state: NativePortableState;
  projectRoot: string;
  applicationId?: string;
  implementationRevisionAvailable?: boolean;
  skillExecutors?: readonly RuntimeExecutor[];
  editReviews?: readonly EditReviewObservation[];
  cancellationObservation?: Awaited<ReturnType<typeof inspectNativeSdkCancellation>>;
  checkExecutionObservation?: readonly NativeSdkCheckExecutionInspection[];
}) {
  const { run, state, projectRoot } = options;
  const dispatchCommandArgs = sdkDispatchCommand(options.applicationId ?? 'native', projectRoot);
  const localized = (en: string, zh: string) => (state.language === 'zh-CN' ? zh : en);
  const communication = (instruction: string, message: string | null = null) => ({
    required: message !== null,
    message,
    suggestedReply: null,
    agentInstruction: instruction,
  });
  const actionContextRequest = (action: RuntimeAction) => {
    const input = action.input as {
      worktree?: unknown;
      activation?: { worktree?: unknown };
    } | null;
    const worktree = input?.activation?.worktree ?? input?.worktree;
    return nativeTaskContextRequest({
      name: state.name,
      phase: action.ref?.includes('verifier') ? 'verify' : 'build',
      language: state.language,
      projectRoot: typeof worktree === 'string' ? worktree : projectRoot,
      sessionId: action.claim?.sessionId,
    });
  };
  const base: NativePortableContinuation = {
    schema: 'comet.native.continuation.v2',
    skill: 'comet-native',
    change: state.name,
    phase: state.phase,
    status: state.status,
    stateVersion: state.state_version,
    ...(state.status === 'active'
      ? {
          contextRequest: nativeTaskContextRequest({
            name: state.name,
            phase: state.phase,
            language: state.language,
            projectRoot,
          }),
        }
      : {}),
    disposition: 'continue',
    mode: 'execute',
    requiresUserDecision: false,
    action: 'none',
    commandArgs: null,
    requiredInputs: [],
    inputOptions: [],
    runnerAction: {
      kind: 'none',
      candidateId: state.builder_handoff?.candidate_id ?? null,
      iteration: state.loop.iteration,
      attempt: state.loop.attempt,
    },
    userCommunication: communication(
      localized('Continue from the current SDK Run.', '按当前 SDK Run 继续。'),
    ),
  };
  const cancellation = await projectNativeSdkCancellationContinuation({
    projectRoot,
    run,
    state,
    base,
    cancellationObservation: options.cancellationObservation,
    checkExecutionObservation: options.checkExecutionObservation,
  });
  if (cancellation)
    return {
      ...cancellation,
      continuation: bindSdkContinuation(cancellation.continuation, projectRoot),
    };
  if (run.status === 'failed') {
    const recoverable = nativeSdkRecoverableFailureReason(run.reason);
    const retryPreflight = nativeSdkRetryableArchivePreflight(run);
    const retryFinalization = nativeSdkRetryableArchiveFinalization(run);
    return {
      continuation: bindSdkContinuation(
        {
          ...base,
          disposition: 'blocked' as const,
          mode: 'reconcile',
          commandArgs:
            retryPreflight || retryFinalization
              ? ['comet', 'native', 'archive', state.name]
              : recoverable
                ? ['comet', 'native', 'doctor', state.name, '--repair']
                : ['comet', 'native', 'doctor', state.name],
          requiredInputs: [],
          userCommunication: communication(
            retryFinalization
              ? localized(
                  'Archive finalization stopped before writing because the confirmed candidate changed. Restore the confirmed implementation and materials, then run archive to continue the existing Spec transaction.',
                  '归档收尾在写入前发现候选漂移并停止。恢复已确认的实现和材料后，执行 archive 继续原 Spec 事务。',
                )
              : retryPreflight
                ? localized(
                    'Archive preflight found blockers without changing the confirmed report. Resolve its blockers, then rerun archive to retry the read-only inspection. Existing receipts and approval remain bound to this candidate.',
                    'Archive 预检发现阻塞，未改写已确认报告。消除阻塞后重新执行 archive，只重试只读检查；原收据和审批仍绑定同一候选。',
                  )
                : localized(
                    'The Run stopped. Inspect it with doctor and preserve the original failed receipts; do not claim pending work, retry an executed failure, or report that it never ran.',
                    'Run 已停止。请使用 doctor 核对并保留原失败收据；不能领取遗留待执行工作、重跑已执行失败的旧 Action，或声称它未执行。',
                  ),
          ),
        },
        projectRoot,
      ),
    };
  }
  const pending = nativeSdkPendingActions(run);
  const nextAction = nativeSdkNextAction(run, state);
  const pendingActions = pending.map((action) => {
    const skillExecutor =
      action.type === 'invoke_skill'
        ? options.skillExecutors?.find((executor) => executor.supports(action))
        : undefined;
    return {
      id: action.id,
      stepId: action.stepId,
      type: action.type,
      ref: action.ref,
      attempt: action.attempt,
      inputHash: action.inputHash,
      ...(action.type === 'handoff' || action.type === 'invoke_skill'
        ? { input: action.input }
        : {}),
      mechanism: 'runtime-dispatch',
      commandArgs:
        action.type === 'handoff' || action.type === 'invoke_skill'
          ? dispatchCommandArgs
          : sdkCommandArgs(['comet', 'native', 'next', state.name], projectRoot),
      ...(action.type === 'handoff'
        ? {
            contextRequest: actionContextRequest(action),
            ...(action.ref?.includes('verifier')
              ? {
                  sessionRequirements: {
                    independent: true,
                    readOnly: true,
                    mustDifferFromSessionId:
                      action.stepId === 'verify.verifier'
                        ? (state.builder_handoff?.builder_execution_ref ?? null)
                        : ((action.input as { activation?: { builderSessionId?: string } })
                            ?.activation?.builderSessionId ?? null),
                    resumeCommandArgs: sdkCommandArgs(
                      ['comet', 'native', 'status', state.name],
                      projectRoot,
                    ),
                    instruction: localized(
                      'Launch a separate read-only session in this project. Pass this Action input and claimRequest to it. That session must claim with its own stable session ID before verification and submit its own outcome; the Builder must not claim on its behalf.',
                      '在此项目启动独立只读会话，将本 Action 输入和 claimRequest 交给它。由该会话在验收前使用自己的稳定会话标识领取，并回报自己的结果；Builder 不代领。',
                    ),
                  },
                }
              : {}),
            claimRequest: {
              operation: 'claim',
              runId: run.runId,
              actionId: action.id,
              attempt: action.attempt,
              inputHash: action.inputHash,
              executorId: 'native-host',
              sessionId: '<session-id>',
              claimToken: '<claim-token>',
            },
          }
        : {}),
      ...(action.type === 'invoke_skill'
        ? {
            executeRequest: skillExecutor
              ? {
                  operation: 'execute',
                  runId: run.runId,
                  expectedRevision: run.revision,
                  actionId: action.id,
                  executorId: skillExecutor.id,
                }
              : null,
          }
        : {}),
    };
  });
  const waits = run.waits.filter((wait) => wait.status === 'pending');
  const evidenceWaits = (run.evidenceWaits ?? []).filter((wait) => wait.status === 'pending');
  const pendingBuilderDecisions = waits
    .filter((wait) =>
      [
        'build.resume',
        'supervisor.child.resume',
        'supervisor.parent.resume',
        'supervisor.child.integration-resume',
      ].includes(wait.stepId),
    )
    .map((wait) => ({
      waitId: wait.id,
      stepId: wait.stepId,
      proposalHash: wait.proposalHash,
      commandArgs: sdkCommandArgs(
        sdkDecision(state, 'continue-builder', wait.proposalHash).commandArgs,
        projectRoot,
      ),
    }));
  const pendingRequirementDecisions = waits
    .filter((wait) => wait.stepId.startsWith('native.extension.revise.'))
    .map((wait) => ({
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      proposal: wait.proposal,
      commandArgs: sdkCommandArgs(
        sdkDecision(state, 'revise-requirements').commandArgs,
        projectRoot,
      ),
      message: localized(
        'The extension found changed requirements. Confirm whether to return to Shape after reconciling running or unknown work.',
        '扩展发现需求变化。先核对 running/unknown 工作，再确认是否返回 Shape 修订需求。',
      ),
    }));
  let continuation: NativePortableContinuation;
  const recovery = await inspectNativeSdkSupervisorRecovery(run, projectRoot);
  const verifyWait = waits.find((wait) =>
    ['verify.confirm', 'verify.retry', 'verify.stop', 'verify.checks-stop'].includes(wait.stepId),
  );
  const active = run.actions.filter(
    (action) => action.status === 'running' || action.status === 'unknown',
  );
  const checkExecutions =
    options.checkExecutionObservation ??
    (await inspectNativeSdkCheckExecutions({ projectRoot, run }));
  const childCheckWaits = waits.filter((wait) =>
    ['supervisor.child.checks-stop', 'supervisor.child.integration-checks-stop'].includes(
      wait.stepId,
    ),
  );
  const childVerifierWaits = nativeSdkChildVerifierRetryWaits(run);
  const stoppedBuilder = nativeSdkStoppedBuilderWait(run);
  const canReviseStoppedBuilder =
    stoppedBuilder !== undefined &&
    nativeSdkRequirementsRevisionAllowed(run, state, stoppedBuilder.proposalHash);
  if (recovery) {
    const decision = sdkDecision(state, 'resolve-verifier-blocker', recovery.proposalHash);
    continuation = {
      ...base,
      action: 'resolve-verifier-blocker',
      disposition: 'await-user',
      mode: 'ask',
      requiresUserDecision: true,
      commandArgs: decision.commandArgs,
      requiredInputs: decision.requiredInputs,
      inputOptions: decision.inputOptions,
      userCommunication: communication(
        localized(
          'Execute only after explicit approval to recover this Child; preserve the original result and recheck the successor candidate.',
          '只有明确选择恢复当前 Child 后才执行；保留原结果，后继候选必须重新检查和独立验收。',
        ),
        localized(
          'Child verification is blocked. Recover the original work with a new Builder?',
          'Child 独立验收受阻。是否让新的 Builder 在原工作区继续处理？',
        ),
      ),
    };
  } else if (run.status === 'completed') {
    continuation = {
      ...base,
      disposition: state.status === 'done' ? 'done' : 'blocked',
      mode: state.status === 'done' ? 'done' : 'reconcile',
      commandArgs: state.status === 'done' ? null : ['comet', 'native', 'doctor', state.name],
      userCommunication: communication(
        localized(
          state.status === 'done'
            ? 'SDK Archive has completed. Finish and verify any Git delivery already authorized by the user before reporting the task complete; Run completion alone does not prove commit, push, or PR delivery.'
            : 'The Run ended without completing the Native change. Inspect preserved results and follow Doctor before reporting completion.',
          state.status === 'done'
            ? 'SDK 归档已完成。宣告任务完成前，继续执行并核对用户已经授权的 Git 交付；Run 完成不能证明提交、推送或 PR 已完成。'
            : 'Run 已结束，但 Native change 尚未完成。核对保留的结果并按 Doctor 恢复，不能宣告完成。',
        ),
      ),
    };
  } else if (childCheckWaits.length > 0) {
    continuation = {
      ...base,
      disposition: 'await-user',
      mode: 'ask',
      requiresUserDecision: true,
      requiredInputs: ['summary', 'user-decision'],
      commandAlternatives: childCheckWaits.map((wait) =>
        sdkDecision(state, 'revise-implementation', wait.proposalHash),
      ),
      userCommunication: communication(
        localized(
          'Preserve the interrupted check receipts and partial logs. After the user chooses repair, create a new Builder candidate before running fresh checks. Do not replay the original Action or report unknown check results as passed.',
          '保留中断检查收据与部分日志。用户选择修复后，由新 Builder 提交新候选并重新检查。不能重跑原 Action，或把未知检查结果报告为通过。',
        ),
        localized(
          'Child Runtime checks were interrupted. Repair this Child before continuing?',
          'Child Runtime 检查中断。是否先修复这个 Child 再继续？',
        ),
      ),
    };
  } else if (childVerifierWaits.length > 0) {
    continuation = {
      ...base,
      action: 'retry-verifier',
      disposition: 'await-user',
      mode: 'ask',
      requiresUserDecision: true,
      requiredInputs: ['summary', 'user-decision'],
      commandAlternatives: childVerifierWaits.flatMap((wait) => [
        sdkDecision(state, 'retry-verifier', wait.proposalHash),
        sdkDecision(state, 'revise-implementation', wait.proposalHash),
      ]),
      userCommunication: communication(
        localized(
          'Preserve the failed execution receipt and independent Child progress. After an explicit decision, retry only the failed Child with its current candidate and checks, or return it to a new Builder. Never report an executed failure as not executed.',
          '保留失败执行收据与其他 Child 的进度。明确决定后，仅为失败 Child 复用当前候选和检查派发新 Verifier，或交给新 Builder 修复。不能将已执行失败报告为未执行。',
        ),
        localized(
          'A Child Verifier execution failed. Retry its independent review, or repair this Child first?',
          'Child Verifier 执行失败。是否重新尝试独立验收，或先修复这个 Child？',
        ),
      ),
    };
  } else if (pendingRequirementDecisions.length > 0 || pendingBuilderDecisions.length > 0) {
    const requirements = pendingRequirementDecisions.length > 0;
    continuation = {
      ...base,
      disposition: 'await-user',
      mode: 'ask',
      requiresUserDecision: true,
      commandAlternatives: requirements
        ? [sdkDecision(state, 'revise-requirements')]
        : pendingBuilderDecisions
            .map((wait) => sdkDecision(state, 'continue-builder', wait.proposalHash))
            .concat(
              canReviseStoppedBuilder
                ? [sdkDecision(state, 'revise-requirements', stoppedBuilder!.proposalHash)]
                : [],
            ),
      requiredInputs: ['summary', 'user-decision'],
      userCommunication: communication(
        localized(
          'Preserve completed work, reconcile running or unknown Actions, and execute the matching option only after the user decides.',
          '保留已完成工作，先核对 running/unknown Action，用户明确决定后执行对应选项。',
        ),
        requirements
          ? pendingRequirementDecisions[0].message
          : pendingBuilderDecisions.some(
                (wait) => wait.stepId === 'supervisor.child.integration-resume',
              )
            ? localized(
                'The integration repair failed. Continue from its preserved integration workspace?',
                '集成修复执行失败。是否从保留的集成工作区继续修复？',
              )
            : canReviseStoppedBuilder
              ? localized(
                  'The Builder stopped before completing this work. Continue from its preserved workspace, or revise the requirements and confirm a new Shape?',
                  'Builder 尚未完成本轮工作。请选择从保留的工作区继续，或调整需求并重新确认 Shape。',
                )
              : localized(
                  'The Builder stopped before completing this work. Continue from its preserved workspace?',
                  'Builder 尚未完成本轮工作。是否从保留的工作区继续？',
                ),
      ),
    };
  } else if (verifyWait?.stepId === 'verify.checks-stop') {
    continuation = {
      ...sdkLoopStopContinuation(run, state, verifyWait.proposalHash),
      userCommunication: communication(
        localized(
          'Preserve failed, interrupted, or input-invalidated check receipts. Ask for a repair or requirements decision before creating a new candidate; do not retry the original check or report that it never ran.',
          '保留失败、中断或输入已变化的原检查收据。请用户决定修复实现或调整需求，再创建新候选；不要重跑原检查或声明它从未执行。',
        ),
        state.blockers.map((blocker) => blocker.reason.text).join('; '),
      ),
    };
  } else if (verifyWait?.stepId === 'verify.stop') {
    continuation = sdkLoopStopContinuation(run, state, verifyWait.proposalHash);
  } else if (verifyWait) {
    const retry = verifyWait.stepId === 'verify.retry';
    const decisions = nativeSdkVerifyDecisions(run, state).filter(
      ({ wait }) => wait.id === verifyWait.id,
    );
    const oneShotChecks = !retry && !decisions.some(({ action }) => action === 'retry-verifier');
    continuation = {
      ...base,
      disposition: 'await-user',
      mode: 'ask',
      requiresUserDecision: true,
      action: retry ? 'retry-verifier' : 'confirm-skill-coordinated-pass',
      requiredInputs: ['summary', 'user-decision'],
      commandAlternatives: [
        ...decisions.map(({ action, wait }) => sdkDecision(state, action, wait.proposalHash)),
        ...(!retry ? [sdkDecision(state, 'revise-requirements')] : []),
      ],
      userCommunication: communication(
        localized(
          oneShotChecks
            ? 'Summarize the result and evidence, then wait for an explicit decision. Reverification is unavailable because the current checks include one-shot commands; do not replay them. Accept the valid result or revise the candidate and confirm a new verification plan.'
            : 'Summarize the result and evidence, then wait for an explicit decision before executing the matching option.',
          oneShotChecks
            ? '简要说明结果和证据，等待用户明确决定。当前检查包含不可重复执行的命令，因此不提供重新验收；不能重放它们。可接受有效结果，或修订候选并确认新的验证方式。'
            : '简要说明结果和证据，等待用户明确决定后执行对应选项。',
        ),
        retry
          ? localized(
              'Verification stopped without a usable result. Retry the independent Verifier with the preserved candidate and checks?',
              '验收未正常返回可用结果。是否保留当前候选和检查，重新尝试独立验收？',
            )
          : localized(
              oneShotChecks
                ? 'Verification passed. The checks include one-shot commands, so reverification is unavailable. Accept the result for Archive, revise the implementation, or revise the requirements?'
                : 'Verification passed. Accept the result for Archive, revise the implementation, or revise the requirements?',
              oneShotChecks
                ? '验收已通过。检查包含不可重复执行的命令，因此不能重新验收。请选择接受结果进入归档、修改实现，或调整需求。'
                : '验收已通过。请选择接受结果进入归档、修改实现，或调整需求。',
            ),
      ),
    };
  } else if (state.phase === 'shape' && active.length === 0) {
    const shapeWait = waits.find((wait) =>
      ['shape.confirm', 'supervisor.shape.confirm'].includes(wait.stepId),
    );
    continuation = sdkShapeContinuation(state, shapeWait?.stepId === 'supervisor.shape.confirm');
    if (shapeWait) {
      let currentProposal = false;
      try {
        const paths = await nativeProjectPaths(
          projectRoot,
          (run.input as { artifactRootRef: string }).artifactRootRef,
        );
        const current = await collectNativeSdkShapeProposal({ paths, state });
        const approved = (shapeWait.proposal as { outputs?: Record<string, RuntimeValue> })
          .outputs?.['shape.prepare'];
        currentProposal =
          approved !== undefined &&
          hashRuntimeValue(current as unknown as RuntimeValue) === hashRuntimeValue(approved) &&
          current.shapeConfirmationHash === state.shape_confirmation_hash;
      } catch {
        // 未完成或无效的文档同样不能批准旧提案，保留 Wait 供明确修订。
      }
      continuation = {
        ...continuation,
        ...(!currentProposal
          ? { action: 'none' as const, requiredInputs: ['summary', 'user-decision'] }
          : {}),
        commandAlternatives: [
          ...(currentProposal ? (continuation.commandAlternatives ?? []) : []),
          sdkDecision(state, 'revise-requirements', shapeWait.proposalHash),
        ],
        userCommunication: {
          ...continuation.userCommunication,
          ...(!currentProposal
            ? {
                message: localized(
                  'The Shape documents changed or are incomplete. Update the proposal before asking for confirmation again.',
                  'Shape 文档已变化或尚未完整。请先更新提案，再确认新的完整 Shape。',
                ),
                suggestedReply: null,
              }
            : {}),
          agentInstruction:
            continuation.userCommunication.agentInstruction +
            ' ' +
            localized(
              'When the user requests changed requirements, finish updating the Shape documents and execute revise-requirements to reject this proposal and prepare a new one. Then ask for explicit approval of the new complete Shape; revision never grants approval.',
              '用户要求调整需求时，先补全 Shape 文档，再执行 revise-requirements 拒绝旧提案并准备新提案。随后请用户明确批准新的完整 Shape；修订本身不代表批准。',
            ),
        },
      };
    }
  } else if (checkExecutions.some((execution) => execution.recoveryRequired)) {
    const staleCompleted = new Set<string>();
    for (const execution of checkExecutions) {
      const action = active.find((candidate) => candidate.id === execution.actionId);
      if (
        action &&
        execution.quiescent &&
        execution.execution?.phase === 'completed' &&
        execution.execution.outcome &&
        (await nativeSdkCompletedCheckInputDrift(
          { projectRoot, run, action },
          execution.execution.outcome,
        ))
      )
        staleCompleted.add(action.id);
    }
    const stopped = checkExecutions
      .filter(
        (execution) =>
          execution.recoveryRequired &&
          (staleCompleted.has(execution.actionId) ||
            execution.phase === 'missing' ||
            (execution.quiescent && execution.execution && !execution.execution.outcome)),
      )
      .map((execution) => {
        const action = active.find((candidate) => candidate.id === execution.actionId)!;
        return {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: action.claim!.token,
          evidence:
            '<actual evidence that the original execution and all descendants, including detached processes, have stopped>',
        };
      });
    continuation = {
      ...base,
      disposition: 'blocked',
      mode: 'reconcile',
      requiresUserDecision: stopped.length > 0,
      commandArgs: [
        'comet',
        'native',
        'doctor',
        state.name,
        '--repair',
        ...(stopped.length > 0
          ? ['--confirmed', '--stopped-actions', '<stopped-actions-json-file>']
          : []),
      ],
      requiredInputs:
        stopped.length > 0
          ? ['stopped-actions-json-file', 'original-execution-stop-evidence']
          : ['original-check-execution-evidence'],
      inputOptions:
        stopped.length > 0
          ? [
              {
                name: 'stopped-actions-json-file',
                flag: '--stopped-actions',
                valueKind: 'json-file',
                required: true,
                template: stopped,
              },
            ]
          : [],
      userCommunication: communication(
        localized(
          staleCompleted.size > 0
            ? 'The original check completed, but its input has changed. Preserve its receipts and side effects. Ask the original host or user to confirm all descendants have stopped, then submit the bound stop evidence using doctor. This opens an explicit new-candidate repair decision; it does not replay the old check.'
            : stopped.length > 0
              ? 'The check outcome or its older process registration is missing. Ask the original host or user to verify that the original execution and all descendants, including detached processes, have stopped. Submit actual evidence with the original claim using the shown doctor command. Until then, do not create a new candidate or run another check.'
              : 'The original Runtime check needs recovery. Run doctor to inspect the registered owner, process, and receipts; do not start another check or assume it never executed.',
          staleCompleted.size > 0
            ? '原检查已经完成，但输入随后发生变化。保留原收据和副作用，请原宿主或用户确认全部后代已停止，再通过 doctor 提交绑定原领取的停止证据。这会进入新候选修复审批，不会重跑旧检查。'
            : stopped.length > 0
              ? '检查结果不完整，或旧执行缺少进程登记。请原宿主或用户核对原执行及全部后代（含脱组进程）确已停止，再按显示的 doctor 命令，用原领取信息提交实际停止证据。此前不要创建新候选或另开检查。'
              : '原 Runtime 检查需要恢复。请执行 doctor 核对登记的执行者、进程及收据；不要另开检查或假设它未执行。',
        ),
        stopped.length > 0
          ? localized(
              'Can the original host confirm that this execution and all its descendant processes have stopped?',
              '能否由原宿主确认此执行及全部后代进程已经停止？',
            )
          : null,
      ),
    };
  } else if (
    active.length === 1 &&
    active[0].stepId === 'repair.implementation' &&
    active[0].ref === 'native-revise-implementation' &&
    active[0].claim?.executorId === 'comet-native-revise-implementation' &&
    ['running', 'unknown'].includes(active[0].status)
  ) {
    continuation = {
      ...base,
      disposition: 'continue',
      mode: 'execute',
      commandArgs: ['comet', 'native', 'next', state.name],
      userCommunication: communication(
        localized(
          'Recheck the original read-only implementation revision with its existing claim; this does not assume the original process stopped and does not execute Archive.',
          '使用原领取信息重新核对只读实现修订；不假定原进程已停止，也不执行 Archive。',
        ),
      ),
    };
  } else if (
    active.length === 1 &&
    active[0].status === 'unknown' &&
    active[0].stepId === 'verify.revalidate' &&
    active[0].ref === 'native-report-revalidate' &&
    active[0].claim?.executorId === 'comet-native-report-revalidate'
  ) {
    continuation = {
      ...base,
      disposition: 'continue',
      mode: 'execute',
      commandArgs: ['comet', 'native', 'next', state.name],
      userCommunication: communication(
        localized(
          `Report revalidation stopped: ${active[0].reason ?? 'unknown result'}. Run next to repeat only the read-only validation with the original claim. Changed checks require fresh verification; unresolved storage or permission errors remain blocked.`,
          `报告复核停止：${active[0].reason ?? '结果未知'}。执行 next，只重读校验并保留原领取记录；检查失效后重新验收，未解决的存储或权限错误仍保持阻塞。`,
        ),
      ),
    };
  } else if (
    state.phase === 'archive' &&
    active.length === 1 &&
    active[0].status === 'unknown' &&
    NATIVE_SDK_ARCHIVE_STEPS.some(
      ([stepId, ref]) => active[0].stepId === stepId && active[0].ref === ref,
    )
  ) {
    continuation = {
      ...base,
      action: 'archive',
      disposition: 'blocked',
      mode: 'reconcile',
      commandArgs: ['comet', 'native', 'archive', state.name, '--recover'],
      requiredInputs: ['original-archive-writer-stopped', 'archive-conflict-resolution'],
      userCommunication: communication(
        localized(
          `The original Archive step stopped: ${active[0].reason ?? 'its outcome is unresolved'}. Confirm the original writer stopped and resolve the reported path or permission conflict, then run the recovery command. It reconciles the same transaction and Action; completed checks and applied Specs are retained.`,
          `原归档步骤已停止：${active[0].reason ?? '执行结果尚未核对'}。确认原写入进程已停止，处理报告中的路径或权限冲突后执行恢复命令。恢复会核对同一事务和 Action，保留已完成检查及已应用规格。`,
        ),
      ),
    };
  } else if (active.some((action) => action.status === 'unknown')) {
    continuation = {
      ...base,
      disposition: 'blocked',
      mode: 'reconcile',
      commandArgs: null,
      requiredInputs: ['original-execution-result'],
      userCommunication: communication(
        localized(
          'Reconcile the original Action and execution before continuing. Submit its actual outcome if it executed. Only authoritative evidence that a host task never executed permits its retryRequest; an unknown result or a timeout is not that evidence.',
          '先核对原 Action 和执行现场。已执行时提交原领取的真实结果；只有权威证据证明宿主任务确未执行，才可填写其 retryRequest。结果未知或等待超时不是未执行证据。',
        ),
      ),
    };
  } else if (waits.length > 0 || evidenceWaits.length > 0) {
    continuation = {
      ...base,
      disposition: waits.length > 0 ? 'await-user' : 'blocked',
      mode: waits.length > 0 ? 'ask' : 'reconcile',
      requiresUserDecision: waits.length > 0,
      requiredInputs: [waits.length > 0 ? 'user-decision' : 'runtime-evidence'],
      userCommunication: communication(
        localized(
          'Review the pending SDK Wait and its complete proposal before submitting a decision or evidence with the original identity. Do not repeat Archive to skip it.',
          '先核对待处理 SDK Wait 及其完整提案，再按原身份提交决定或证据。不能重复归档来跳过它。',
        ),
        waits.length > 0
          ? localized(
              'An application decision is required before continuing.',
              '应用需要新的决定才能继续。',
            )
          : null,
      ),
    };
  } else if (nextAction) {
    const action = nextAction;
    const handoff = action.type === 'handoff';
    const skill = action.type === 'invoke_skill';
    const archive =
      state.phase === 'archive' &&
      pending.length === 1 &&
      action.type === 'call_tool' &&
      NATIVE_SDK_ARCHIVE_STEPS.some(
        ([stepId, ref]) => action.stepId === stepId && action.ref === ref,
      );
    const executeRequest = pendingActions[0].executeRequest;
    continuation = {
      ...base,
      action: handoff
        ? action.ref?.includes('verifier')
          ? 'dispatch-verifier'
          : 'builder-handoff'
        : archive
          ? 'archive'
          : 'none',
      disposition: skill && !executeRequest ? 'blocked' : 'continue',
      mode: skill && !executeRequest ? 'reconcile' : 'execute',
      commandArgs:
        handoff || (skill && executeRequest)
          ? [
              'comet',
              'runtime',
              'dispatch',
              '--application',
              options.applicationId ?? 'native',
              '--request',
              '<request-json-file>',
            ]
          : skill
            ? null
            : ['comet', 'native', archive ? 'archive' : 'next', state.name],
      ...(handoff
        ? {
            ...(action.stepId === 'build.builder' && nativeSdkPendingBuilderRevisionHash(run)
              ? {
                  commandAlternatives: [
                    sdkDecision(
                      state,
                      'revise-requirements',
                      nativeSdkPendingBuilderRevisionHash(run)!,
                    ),
                  ],
                }
              : {}),
            requiredInputs: ['request-json-file', 'session-id', 'claim-token'],
            inputOptions: [
              {
                name: 'request-json-file',
                flag: '--request',
                valueKind: 'json-file' as const,
                required: true,
                template: pendingActions[0].claimRequest,
              },
            ],
          }
        : {}),
      ...(skill
        ? {
            requiredInputs: executeRequest ? ['request-json-file'] : ['skill-executor'],
            inputOptions: executeRequest
              ? [
                  {
                    name: 'request-json-file',
                    flag: '--request',
                    valueKind: 'json-file' as const,
                    required: true,
                    template: executeRequest,
                  },
                ]
              : [],
          }
        : {}),
      userCommunication: communication(
        skill
          ? localized(
              'Execute the pending Skill with its fixed Application executor and skillWork contract. If no compatible executor is configured, resolve that host requirement; repeating native next cannot execute this Skill.',
              '按 skillWork 契约使用固定 Application 的执行器运行待处理 Skill。缺少适配执行器时先补全宿主要求；重复 native next 不能执行此 Skill。',
            )
          : handoff
            ? localized(
                'Use the pending Action claimRequest with a real stable session ID and unique claim token. After the claim succeeds, the receiving Agent reads its contextRequest before starting work. Use the returned Action input; Verifiers need a separate read-only session. Submit the original Action outcome, then follow the returned Run.',
                '在待执行 Action 的 claimRequest 中填入真实稳定的会话标识和唯一领取令牌。领取成功后，接收 Agent 先执行自己的 contextRequest，再按返回的 Action 输入开展工作；Verifier 必须使用独立只读会话。提交原 Action 的结果后按返回的 Run 继续。',
              )
            : archive
              ? localized(
                  'Execute Archive once and follow the returned state. If the platform returns a background handle, wait for that original task with its wait/output tool. After completion, parse its original stdout as one complete JSON document and keep stderr separate. Do not poll unrelated processes, parse task-status decorations as JSON, or start another Archive while this task is running.',
                  '只执行一次 Archive，并按返回状态继续。平台返回后台句柄时，使用对应的等待或输出工具跟踪原任务。完成后把原 stdout 作为一个完整 JSON 文档解析，stderr 另存；不要轮询无关进程、把任务状态提示当作 JSON，或在原任务运行时再启动 Archive。',
                )
              : localized(
                  'Execute the next Runtime-owned Action and follow its returned state. It revalidates current evidence before committing.',
                  '执行下一项 Runtime 自有 Action，并按返回状态继续；Runtime 会在提交前重新校验当前证据。',
                ),
      ),
    };
  } else if (active.length > 0) {
    continuation = {
      ...base,
      mode: 'wait',
      commandArgs: null,
      requiredInputs: ['original-execution-result'],
      userCommunication: communication(
        localized(
          'Continue or wait on the original claimed task. Do not create a second task because a wait timed out; submit its actual outcome with the original claim.',
          '继续或等待原已领取任务。等待超时不能另建任务；用原领取信息提交真实结果。',
        ),
      ),
    };
  } else if (state.status === 'done') {
    continuation = { ...base, disposition: 'done', mode: 'done' };
  } else if (run.ready.length > 0) {
    continuation = { ...base, commandArgs: ['comet', 'native', 'next', state.name] };
  } else {
    continuation = {
      ...base,
      disposition: 'blocked',
      mode: 'reconcile',
      requiredInputs: ['runtime-evidence-or-decision'],
      userCommunication: communication(
        localized(
          'Inspect the pending SDK Wait or evidence requirement before continuing; do not submit a compat Runner input.',
          '先核对待处理的 SDK Wait 或证据要求；不要提交 compat Runner 输入。',
        ),
      ),
    };
  }
  if (state.phase === 'verify' && state.builder_handoff) {
    const input = run.input as { artifactRootRef: string };
    const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
    const scope = nativeEditReviewScope(paths, state);
    const edit = await editReviewContinuation(
      scope,
      options.editReviews ?? (await inspectEditReviews(scope)),
      true,
    );
    if (edit)
      continuation = {
        ...continuation,
        ...edit,
        action: 'review-edit',
        commandArgs: edit.commandArgs ? [...edit.commandArgs] : null,
        requiredInputs: [...edit.requiredInputs],
        inputOptions: [],
        commandAlternatives: undefined,
        requiresUserDecision: edit.mode === 'ask',
        disposition:
          edit.mode === 'ask' ? 'await-user' : edit.mode === 'reconcile' ? 'blocked' : 'continue',
        runnerAction: { ...continuation.runnerAction, kind: 'none' },
        userCommunication: communication(edit.instruction ?? '先处理当前编辑复核。'),
      };
  }
  if (
    state.phase === 'shape' ||
    (state.phase === 'build' &&
      nextAction?.type === 'handoff' &&
      !nextAction.ref?.includes('verifier'))
  ) {
    continuation = {
      ...continuation,
      userCommunication: {
        ...continuation.userCommunication,
        agentInstruction:
          localized(
            'Check verificationRequirements before starting implementation. If this host has neither an independent subagent nor a separate Verifier session, explain the limitation and arrange that session before Build. ',
            '开始实现前按 verificationRequirements 核对宿主能力；没有独立子 Agent 或另一个 Verifier 会话时，先说明限制并安排会话，再开始 Build。',
          ) + continuation.userCommunication.agentInstruction,
      },
    };
  }
  if (
    state.workspace.change_branch &&
    !state.archived &&
    !['completed', 'cancelled'].includes(run.status) &&
    inspectGitWorktree(projectRoot).currentBranch !== state.workspace.change_branch
  ) {
    continuation = {
      ...continuation,
      disposition: 'blocked',
      mode: 'reconcile',
      action: 'none',
      commandArgs: ['comet', 'native', 'select', state.name, '--rebind'],
      commandAlternatives: undefined,
      requiredInputs: ['confirm-current-branch-ownership', 'settle-original-executions'],
      userCommunication: communication(
        `当前分支与需求绑定的 ${state.workspace.change_branch} 不一致。切回原分支继续；确认当前分支接管且原执行已结束后，执行 select --rebind，保留同一 Run 和已有工作。`,
      ),
    };
  }
  return {
    continuation: bindSdkContinuation(continuation, projectRoot),
    ...(state.phase === 'shape' ||
    (state.phase === 'build' &&
      nextAction?.type === 'handoff' &&
      !nextAction.ref?.includes('verifier'))
      ? {
          verificationRequirements: {
            required: true,
            checkBefore: 'build',
            independentSession: true,
            capabilityStatus: 'host-check-required',
            supportedModes: ['subagent', 'separate-session'],
            instruction: localized(
              'Before starting Build, check that this host can provide a separate read-only Verifier session. Runtime cannot detect host capabilities. A separate session may resume this same project and claim the Verifier Action; use its own session identity and preserve the original task when waiting.',
              '开始 Build 前，先核对宿主能否提供独立只读 Verifier 会话；Runtime 无法自动探测宿主能力。可用独立子 Agent，或在同一项目另开会话领取 Verifier Action；使用该会话自己的执行标识，等待时继续跟踪原任务。',
            ),
            unavailable: {
              action: 'stop-before-build',
              instruction: localized(
                'Explain the missing capability before implementation. Arrange a separate Verifier session, then resume the same Run. Preserve completed work and checks; never fabricate independent verification or repeatedly retry an unavailable executor.',
                '实现前说明缺少独立验收能力，安排另一个 Verifier 会话后恢复同一 Run。保留已有工作和检查，不伪造独立验收，不反复重试不可用的执行者。',
              ),
              resumeCommandArgs: sdkCommandArgs(
                ['comet', 'native', 'status', state.name],
                projectRoot,
              ),
            },
          },
        }
      : {}),
    ...(checkExecutions.length > 0 ? { checkExecutions } : {}),
    ...(active.length > 0
      ? {
          activeActions: active.map((action) => ({
            id: action.id,
            stepId: action.stepId,
            status: action.status,
            attempt: action.attempt,
            inputHash: action.inputHash,
            input: action.input,
            type: action.type,
            ref: action.ref,
            claim: action.claim,
            ...(action.reason ? { reason: action.reason } : {}),
            ...(action.type === 'handoff' ? { contextRequest: actionContextRequest(action) } : {}),
            commandArgs: dispatchCommandArgs,
            outcomeRequest: nativeSdkOutcomeRequest(run, action, state),
            ...nativeSdkOutcomeAlternatives(run, action, state),
            ...nativeSdkHostRecoveryRequests(run, action),
          })),
        }
      : {}),
    ...(run.status !== 'completed' && pendingActions.length > 0
      ? {
          pendingAction: (() => {
            const { input: _input, ...action } = pendingActions[0];
            void _input;
            return {
              ...action,
              ...(_input === undefined ? {} : { inputRef: 'pendingActions[0].input' }),
            };
          })(),
          pendingActions,
        }
      : {}),
    ...(waits.length > 0
      ? {
          pendingWaits: waits.map((wait) => ({
            ...wait,
            ...(['verify.stop', 'verify.checks-stop', 'verify.retry', 'verify.confirm'].includes(
              wait.stepId,
            )
              ? {
                  choices: nativeSdkVerifyWaitDecisions(state, wait, run).map(
                    ({ choice }) => choice,
                  ),
                }
              : {}),
            commandArgs: dispatchCommandArgs,
            decisionRequests: ([
              'verify.stop',
              'verify.checks-stop',
              'verify.retry',
              'verify.confirm',
            ].includes(wait.stepId)
              ? nativeSdkVerifyWaitDecisions(state, wait, run).map(({ choice }) => choice)
              : wait.choices
            ).map((choice) => ({
              operation: 'resolve-wait',
              runId: run.runId,
              expectedRevision: run.revision,
              waitId: wait.id,
              proposalHash: wait.proposalHash,
              decisionId: '<decision-id>',
              choice,
              ...(wait.stepId === 'verify.stop' && choice === 'retry'
                ? { reason: '<summary>' }
                : {}),
            })),
          })),
        }
      : {}),
    ...(evidenceWaits.length > 0
      ? {
          pendingEvidenceWaits: evidenceWaits.map((wait) => ({
            ...wait,
            commandArgs: dispatchCommandArgs,
            evidenceRequest: {
              operation: 'record-evidence',
              runId: run.runId,
              expectedRevision: run.revision,
              evidenceId: wait.id,
              kind: wait.kind,
              ref: '<evidence-relative-path>',
              contentHash: '<actual-evidence-sha256>',
              submissionId: '<submission-id>',
            },
          })),
        }
      : {}),
    ...(pendingBuilderDecisions.length > 0 ? { pendingBuilderDecisions } : {}),
    ...(childVerifierWaits.length > 0
      ? {
          pendingVerifierDecisions: childVerifierWaits.map((wait) => ({
            waitId: wait.id,
            proposalHash: wait.proposalHash,
            proposal: wait.proposal,
          })),
        }
      : {}),
    ...(pendingRequirementDecisions.length > 0 ? { pendingRequirementDecisions } : {}),
  };
}
