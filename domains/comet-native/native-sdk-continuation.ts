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
import { projectNativeSdkCancellationContinuation } from './native-sdk-cancellation.js';
import { inspectNativeSdkCheckExecutions } from './native-sdk-check-execution.js';
import { NATIVE_SDK_ARCHIVE_STEPS } from './native-sdk-archive.js';
import { collectNativeSdkShapeProposal } from './native-sdk-application.js';
import { nativeProjectPaths } from './native-paths.js';
import {
  nativeSdkRequirementsRevisionAllowed,
  nativeSdkStoppedBuilderWait,
} from './native-sdk-revise.js';
import {
  NATIVE_SUPERVISOR_COORDINATION_MODES,
  type NativePortableState,
} from './native-portable-types.js';

/** 模板只绑定原领取身份；状态和结果必须来自本次真实执行。 */
function nativeSdkOutcomeRequest(run: WorkflowRun, action: RuntimeAction) {
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
      status: '<succeeded|failed>',
      output: '<actual-action-output>',
    },
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
  const outcomeRequest = nativeSdkOutcomeRequest(run, action);
  return {
    schema: 'comet.native.dispatch-result.v1' as const,
    runId: run.runId,
    revision: run.revision,
    workflow: run.workflow,
    status: run.status,
    state,
    action,
    ...(outcomeRequest ? { outcomeRequest } : {}),
    ...(await projectNativeSdkContinuation(options)),
    inspection: {
      commandArgs: [
        'comet',
        'runtime',
        'dispatch',
        '--application',
        applicationId,
        '--request',
        '<inspect-request-json-file>',
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

function sdkLoopStopContinuation(state: NativePortableState, proposalHash: string) {
  const continuation = nativePortableContinuation(state);
  if (!continuation.commandAlternatives) {
    throw new Error('Native SDK Verify stop has no recovery choices');
  }
  return {
    ...continuation,
    commandAlternatives: continuation.commandAlternatives.map((alternative) => {
      if (alternative.name !== 'revise-implementation' || !alternative.commandArgs) {
        return alternative;
      }
      const position = alternative.commandArgs.indexOf('--expected-state-version');
      if (position < 0) throw new Error('Native SDK repair command lacks its state version');
      return {
        ...alternative,
        commandArgs: [
          ...alternative.commandArgs.slice(0, position),
          '--proposal-hash',
          proposalHash,
          ...alternative.commandArgs.slice(position),
        ],
      };
    }),
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
export async function projectNativeSdkContinuation(options: {
  run: WorkflowRun;
  state: NativePortableState;
  projectRoot: string;
  applicationId?: string;
  skillExecutors?: readonly RuntimeExecutor[];
}) {
  const { run, state, projectRoot } = options;
  const localized = (en: string, zh: string) => (state.language === 'zh-CN' ? zh : en);
  const communication = (instruction: string, message: string | null = null) => ({
    required: message !== null,
    message,
    suggestedReply: null,
    agentInstruction: instruction,
  });
  const base: NativePortableContinuation = {
    schema: 'comet.native.continuation.v2',
    skill: 'comet-native',
    change: state.name,
    phase: state.phase,
    status: state.status,
    stateVersion: state.state_version,
    disposition: 'continue',
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
  });
  if (cancellation) return cancellation;
  if (run.status === 'failed') {
    const recoverable = nativeSdkRecoverableFailureReason(run.reason);
    return {
      continuation: {
        ...base,
        disposition: 'blocked' as const,
        commandArgs: recoverable
          ? ['comet', 'native', 'doctor', state.name, '--repair']
          : ['comet', 'native', 'doctor', state.name],
        requiredInputs: [],
        userCommunication: communication(
          localized(
            'The Run stopped. Inspect it with doctor and preserve the original failed receipts; do not claim pending work, retry an executed failure, or report that it never ran.',
            'Run 已停止。请使用 doctor 核对并保留原失败收据；不能领取遗留待执行工作、重跑已执行失败的旧 Action，或声称它未执行。',
          ),
        ),
      },
    };
  }
  const pending = run.actions.filter((action) => action.status === 'pending');
  // 与 next 的执行顺序一致，先完成已集成 Child 的归档。
  const archiveIndex = pending.findIndex((action) => action.stepId === 'supervisor.child.archive');
  if (archiveIndex > 0) pending.unshift(...pending.splice(archiveIndex, 1));
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
      mechanism: 'runtime-dispatch',
      ...(action.type === 'handoff'
        ? {
            claimRequest: {
              operation: 'claim',
              runId: run.runId,
              expectedRevision: run.revision,
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
      ['build.resume', 'supervisor.child.resume', 'supervisor.parent.resume'].includes(wait.stepId),
    )
    .map((wait) => ({
      waitId: wait.id,
      stepId: wait.stepId,
      proposalHash: wait.proposalHash,
      commandArgs: sdkDecision(state, 'continue-builder', wait.proposalHash).commandArgs,
    }));
  const pendingRequirementDecisions = waits
    .filter((wait) => wait.stepId.startsWith('native.extension.revise.'))
    .map((wait) => ({
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      proposal: wait.proposal,
      commandArgs: sdkDecision(state, 'revise-requirements').commandArgs,
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
  const checkExecutions = await inspectNativeSdkCheckExecutions({ projectRoot, run });
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
      commandArgs: state.status === 'done' ? null : ['comet', 'native', 'doctor', state.name],
      userCommunication: communication(
        localized(
          'This Run has completed. Inspect its preserved results before starting any further work.',
          '此 Run 已结束。继续开展工作前请核对保留的结果。',
        ),
      ),
    };
  } else if (childCheckWaits.length > 0) {
    continuation = {
      ...base,
      disposition: 'await-user',
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
      ...sdkLoopStopContinuation(state, verifyWait.proposalHash),
      userCommunication: communication(
        localized(
          'Preserve the failed or interrupted check receipts. Ask for a repair or requirements decision before creating a new candidate; do not retry the original check or report that it never ran.',
          '保留失败或中断检查的收据。请用户决定修复实现或调整需求，再创建新候选；不要重跑原检查或声明它从未执行。',
        ),
        state.blockers.map((blocker) => blocker.reason.text).join('; '),
      ),
    };
  } else if (verifyWait?.stepId === 'verify.stop') {
    continuation = sdkLoopStopContinuation(state, verifyWait.proposalHash);
  } else if (verifyWait) {
    const retry = verifyWait.stepId === 'verify.retry';
    continuation = {
      ...base,
      disposition: 'await-user',
      requiresUserDecision: true,
      action: retry ? 'retry-verifier' : 'confirm-skill-coordinated-pass',
      requiredInputs: ['summary', 'user-decision'],
      commandAlternatives: retry
        ? [sdkDecision(state, 'retry-verifier', verifyWait.proposalHash)]
        : [
            sdkDecision(state, 'accept-result', verifyWait.proposalHash),
            sdkDecision(state, 'revise-implementation', verifyWait.proposalHash),
            sdkDecision(state, 'revise-requirements'),
          ],
      userCommunication: communication(
        localized(
          'Summarize the result and evidence, then wait for an explicit decision before executing the matching option.',
          '简要说明结果和证据，等待用户明确决定后执行对应选项。',
        ),
        retry
          ? localized(
              'Verification stopped without a usable result. Retry the independent Verifier with the preserved candidate and checks?',
              '验收未正常返回可用结果。是否保留当前候选和检查，重新尝试独立验收？',
            )
          : localized(
              'Verification passed. Accept the result for Archive, revise the implementation, or revise the requirements?',
              '验收已通过。请选择接受结果进入归档、修改实现，或调整需求。',
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
    const stopped = checkExecutions
      .filter(
        (execution) =>
          execution.recoveryRequired &&
          (execution.phase === 'missing' ||
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
          stopped.length > 0
            ? 'The check outcome or its older process registration is missing. Ask the original host or user to verify that the original execution and all descendants, including detached processes, have stopped. Submit actual evidence with the original claim using the shown doctor command. Until then, do not create a new candidate or run another check.'
            : 'The original Runtime check needs recovery. Run doctor to inspect the registered owner, process, and receipts; do not start another check or assume it never executed.',
          stopped.length > 0
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
  } else if (active.some((action) => action.status === 'unknown')) {
    continuation = {
      ...base,
      disposition: 'blocked',
      commandArgs: ['comet', 'native', 'status', state.name, '--json'],
      requiredInputs: ['original-execution-result'],
      userCommunication: communication(
        localized(
          'Reconcile the original Action and execution before continuing. An unknown result does not authorize a retry or another handoff.',
          '先核对原 Action 和执行现场。结果未知不代表可以重试或另行派发。',
        ),
      ),
    };
  } else if (waits.length > 0 || evidenceWaits.length > 0) {
    continuation = {
      ...base,
      disposition: waits.length > 0 ? 'await-user' : 'blocked',
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
  } else if (pending.length > 0 && !(state.phase === 'archive' && active.length > 0)) {
    const action = pending[0];
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
                'Use the pending Action claimRequest with a real stable session ID and unique claim token. Work only after the claim succeeds, using the returned Action input; Verifiers need a separate read-only session. Submit the original Action outcome, then follow the returned Run.',
                '在待执行 Action 的 claimRequest 中填入真实稳定的会话标识和唯一领取令牌。领取成功后按返回的 Action 输入开展工作；Verifier 必须使用独立只读会话。提交原 Action 的结果后按返回的 Run 继续。',
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
      commandArgs: ['comet', 'native', 'status', state.name, '--json'],
      userCommunication: communication(
        localized(
          'Continue or wait on the original claimed task. Do not create a second task because a wait timed out; submit its actual outcome with the original claim.',
          '继续或等待原已领取任务。等待超时不能另建任务；用原领取信息提交真实结果。',
        ),
      ),
    };
  } else if (state.status === 'done') {
    continuation = { ...base, disposition: 'done' };
  } else if (run.ready.length > 0) {
    continuation = { ...base, commandArgs: ['comet', 'native', 'next', state.name] };
  } else {
    continuation = {
      ...base,
      disposition: 'blocked',
      requiredInputs: ['runtime-evidence-or-decision'],
      userCommunication: communication(
        localized(
          'Inspect the pending SDK Wait or evidence requirement before continuing; do not submit a compat Runner input.',
          '先核对待处理的 SDK Wait 或证据要求；不要提交 compat Runner 输入。',
        ),
      ),
    };
  }
  return {
    continuation,
    ...(checkExecutions.length > 0 ? { checkExecutions } : {}),
    ...(active.length > 0
      ? {
          activeActions: active.map((action) => ({
            id: action.id,
            stepId: action.stepId,
            status: action.status,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claim: action.claim,
            outcomeRequest: nativeSdkOutcomeRequest(run, action),
          })),
        }
      : {}),
    ...(run.status !== 'completed' && pendingActions.length > 0
      ? { pendingAction: pendingActions[0], pendingActions }
      : {}),
    ...(waits.length > 0 ? { pendingWaits: waits } : {}),
    ...(evidenceWaits.length > 0 ? { pendingEvidenceWaits: evidenceWaits } : {}),
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
