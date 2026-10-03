import type { NativeChildrenInspection } from './native-children.js';
import type { NativePortableExpectedContinuationAction } from './native-portable-runtime.js';
import {
  NATIVE_SUPERVISOR_COORDINATION_MODES,
  type NativePortableState,
} from './native-portable-types.js';
import { NATIVE_MAX_SUPERVISOR_BUILDER_FAILURES } from './native-supervisor-model.js';

type NativePortableContinuationInputOption = {
  name: string;
  flag: string;
  valueKind: 'text' | 'confirmation' | 'choice' | 'json-file';
  required: boolean;
  template: unknown | null;
  choices?: string[];
  exclusiveGroup?: string;
  description?: string;
};

type NativePortableCommandAlternative = {
  name: string;
  stateVersion: number;
  expectedAction: NativePortableExpectedContinuationAction | 'archive-preview' | 'archive';
  commandArgs: string[] | null;
  requiredInputs: string[];
  inputOptions: NativePortableContinuationInputOption[];
  description?: string;
};

export interface NativePortableRunnerAction {
  kind:
    | 'builder-handoff'
    | 'dispatch-verifier'
    | 'retry-checks'
    | 'await-verifier'
    | 'retry-verifier'
    | 'none';
  candidateId: string | null;
  iteration: number;
  attempt: number;
}

export interface NativePortableUserCommunication {
  required: boolean;
  message: string | null;
  suggestedReply: string | null;
  agentInstruction: string;
}

export interface NativePortableContinuation {
  schema: 'comet.native.continuation.v2';
  skill: 'comet-native';
  change: string;
  phase: NativePortableState['phase'];
  status: NativePortableState['status'];
  stateVersion: number;
  disposition: 'continue' | 'await-user' | 'blocked' | 'done';
  requiresUserDecision: boolean;
  action:
    | 'prepare-shape-confirmation'
    | 'confirm-shape'
    | 'confirm-skill-coordinated-pass'
    | 'confirm-verifier-unavailable'
    | 'resolve-verifier-blocker'
    | 'resolve-loop-stop'
    | 'advance-children'
    | 'builder-handoff'
    | 'dispatch-verifier'
    | 'retry-checks'
    | 'await-verifier'
    | 'repair'
    | 'retry-verifier'
    | 'archive'
    | 'none';
  commandArgs: string[] | null;
  requiredInputs: string[];
  inputOptions: NativePortableContinuationInputOption[];
  commandAlternatives?: NativePortableCommandAlternative[];
  runnerAction: NativePortableRunnerAction;
  userCommunication: NativePortableUserCommunication;
}

export type NativePortableArchiveContinuationMode = 'archive-ready' | 'preview' | 'blocked';

export interface NativePortableCheckPlanTemplate {
  id: string;
  name: string;
  executable: string;
  argv: readonly string[];
  cwdRef: string;
  timeoutMs: number;
  repeatable: boolean;
}

export interface NativePortableContinuationOptions {
  verifierExecutionRef?: string;
  verifierStartup?: 'unconfirmed' | 'confirmed';
  retryCheckIds?: readonly string[];
  verificationCheckPlans?: readonly NativePortableCheckPlanTemplate[];
  supervisorIntegrationRetryIds?: readonly string[];
  archiveMode?: NativePortableArchiveContinuationMode;
  archiveBlockers?: readonly string[];
}

function localized(state: NativePortableState, english: string, chinese: string): string {
  return state.language === 'zh-CN' ? chinese : english;
}

function nativePortableUserCommunication(
  state: NativePortableState,
  coordinationChoiceRequired: boolean,
  children?: NativeChildrenInspection | null,
  verifierStartup?: NativePortableContinuationOptions['verifierStartup'],
): NativePortableUserCommunication {
  const noUserUpdate = (agentInstruction: string): NativePortableUserCommunication => ({
    required: false,
    message: null,
    suggestedReply: null,
    agentInstruction,
  });

  if (
    state.phase === 'shape' &&
    state.status === 'await-user' &&
    state.loop.next_action === 'confirm-shape'
  ) {
    if (coordinationChoiceRequired) {
      return {
        required: true,
        message: localized(
          state,
          'Shape is ready. Confirm the complete plan and choose A) Multi-session coordination (recommended), or B) Single-session progression in one reply.',
          'Shape 已整理完成。请确认完整方案，并在同一次回复中选择 A）多会话协作（推荐），或 B）单会话推进。',
        ),
        suggestedReply: localized(state, 'Confirm the plan and use A', '确认方案，按 A 开始'),
        agentInstruction: localized(
          state,
          'First present the target, scope, key decisions, acceptance criteria, non-goals, child responsibilities and dependencies, and both coordination choices. Execute the matching confirm-shape alternative only when the user explicitly accepts this complete Shape and chooses its mode. Choosing a mode alone, additions, or corrections are not full confirmation; retain that choice and ask only for the missing decision. Do not run --confirmed before full confirmation.',
          '先展示目标、范围、关键决定、验收标准、非目标、各 Child 的职责与依赖，以及两种推进方式。只有用户明确同意当前完整 Shape 并选择推进方式后，才执行对应的 confirm-shape 选项。仅选择推进方式、补充或修改要求都不算完整确认；保留已选方式，只补问缺少的决定。完整确认前不要运行 --confirmed。',
        ),
      };
    }
    return state.language === 'zh-CN'
      ? {
          required: true,
          message:
            'Shape 已整理完成。请确认目标、范围、关键决定、验收标准和非目标是否准确；明确确认后才会进入 Build。',
          suggestedReply: '确认进入 Build',
          agentInstruction:
            '先用自然语言简要展示目标、范围、关键决定、验收标准和非目标，再转述 message 并等待用户明确确认。只有用户明确同意当前完整 Shape 时，才执行 commandAlternatives 中的 confirm-shape；补充或修改要求不算确认。不要展示机器状态或提前运行 --confirmed。',
        }
      : {
          required: true,
          message:
            'Shape is ready. Confirm that the target, scope, key decisions, acceptance criteria, and non-goals are accurate; Build starts only after explicit confirmation.',
          suggestedReply: 'Confirm and enter Build',
          agentInstruction:
            'First present a concise natural-language summary of the target, scope, key decisions, acceptance criteria, and non-goals. Then relay message and wait for explicit user confirmation. Run confirm-shape from commandAlternatives only when the user explicitly accepts the complete current Shape; additions or corrections are not confirmation. Do not expose machine state or run --confirmed early.',
        };
  }

  if (coordinationChoiceRequired && state.phase === 'shape' && state.status === 'active') {
    return noUserUpdate(
      localized(
        state,
        'Complete the Shape documents and child plan, resolve blocking questions, then execute prepare-shape-confirmation. Its persisted response combines complete Shape confirmation and coordination choice in one user decision. If the user already chose only a mode, include that --coordination-mode when preparing and ask only for complete Shape confirmation afterward.',
        '完成 Shape 文档和 Child 计划，解决阻塞问题后执行 prepare-shape-confirmation。持久化后的响应会让用户一次确认完整 Shape 并选择推进方式。如果用户已经仅选择了推进方式，准备时附上对应的 --coordination-mode，随后只确认完整 Shape。',
      ),
    );
  }

  if (
    state.phase === 'verify' &&
    state.status === 'active' &&
    state.loop.stage === 'verify-ready' &&
    state.loop.next_action !== 'await-verifier-result'
  ) {
    return noUserUpdate(
      localized(
        state,
        'The current candidate and completed checks are preserved. Continue with dispatch-verifier without asking the user to recover files, processes, or workflow state. If a brief status update is necessary, say only that verification is being retried and the code is unchanged.',
        '当前候选和已经完成的检查都已保留。直接继续 dispatch-verifier，不要让用户恢复文件、进程或工作流状态。如果确实需要简短同步进度，只说明正在重新尝试验收且代码没有变化。',
      ),
    );
  }

  if (
    state.phase === 'verify' &&
    state.status === 'active' &&
    state.loop.next_action === 'await-verifier-result'
  ) {
    const startupInstruction =
      verifierStartup === 'confirmed'
        ? localized(
            state,
            'The Verifier has confirmed startup. Continue waiting on the same host task and use its actual progress.',
            'Verifier 已确认启动。继续等待同一个宿主任务，并使用该任务的实际进度。',
          )
        : localized(
            state,
            'Check whether the host accepted the startup call and locate the task for the current verifierExecutionRef. If the call has not been made, start the dispatched task once; if the host accepted it, check that same task and let the Verifier submit its startup receipt. A missing receipt alone does not prove failure. If local startup state is unavailable, recover the host task context before deciding whether startup is needed.',
            '先核实宿主是否接受了启动调用，并找到当前 verifierExecutionRef 对应的任务。尚未调用时启动已派发的任务一次；宿主已接受时检查同一个任务，由 Verifier 提交启动回执。仅缺少回执不能证明执行失败。本地启动记录不可用时，先恢复宿主任务上下文，再判断是否需要启动。',
          );
    return noUserUpdate(
      `${startupInstruction} ${localized(
        state,
        'Keep the same dispatched Verifier while it is active. A wait-tool timeout is not an execution timeout: check task progress and continue waiting; do not cancel, interrupt, or spawn a replacement just because a wait returned without a result. Request progress without telling the Verifier to stop inspecting. Only after confirmed task failure, a host-reported execution timeout, loss, or termination without a usable result, immediately submit verifier-execution-error. Preserve completed evidence and explain the failure and changed recovery approach before retrying. Submit verifier-unavailable only when the current platform truly has no usable subagent capability. Forward the actual report, including risks and incomplete checks; never turn an uninspected candidate into pass. Do not ask the user to recover files or processes, and do not expose attempt or requestCheckRounds.',
        '已派发的验收任务仍在运行时，继续使用同一个 Verifier。等待工具超时不等于执行超时：检查任务进度并继续等待，不得仅因一次等待没有结果就取消、中断或重新派发。询问进度时不要要求停止核查。仅在确认任务失败、宿主报告执行超时、任务丢失或结束后没有可用结果时，立即提交 verifier-execution-error；保留已完成证据，重试前说明失败原因及恢复方式的变化。只有当前平台确实没有可用的 subagent 能力时才提交 verifier-unavailable。忠实传递原始报告，包括风险和未完成检查；没有核查当前候选不能判定通过。不要让用户恢复文件或进程，也不要向用户展示 attempt、requestCheckRounds 等机器状态。',
      )}`,
    );
  }

  if (
    state.status === 'blocked' &&
    state.blockers.some(({ resolution_action }) => resolution_action === 'retry-verifier')
  ) {
    if (state.loop.retry_epoch >= 3) {
      return state.language === 'zh-CN'
        ? {
            required: true,
            message:
              '自动重试验收已连续多轮未能取得结果，验证环境很可能不可用。请人工检查验证环境（subagent 配额、平台任务队列、网络），或使用 doctor --repair 评估该 change 状态。',
            suggestedReply: '人工检查验证环境',
            agentInstruction:
              '只向用户转述 message，等待用户完成人工检查后再继续。不要自动重试验收。',
          }
        : {
            required: true,
            message:
              'Automatic verification retries have failed across multiple rounds; the verification environment is likely unavailable. Inspect the environment manually (subagent quota, platform task queue, network), or use doctor --repair to assess the change state.',
            suggestedReply: 'Inspect the verification environment',
            agentInstruction:
              'Relay message to the user and wait for a manual environment check before continuing. Do not retry verification automatically.',
          };
    }
    return state.language === 'zh-CN'
      ? {
          required: true,
          message:
            '由于独立验收任务连续几次没有正常返回结果，本次验收已暂停。你的代码和已经完成的检查都已安全保留。回复“继续”即可重新尝试，不需要处理文件或进程。',
          suggestedReply: '继续',
          agentInstruction:
            '只向用户转述 message 和 suggestedReply，并等待用户回复。不要展示内部轮次、计数、路径或恢复步骤。',
        }
      : {
          required: true,
          message:
            'Verification paused because the independent verification task repeatedly ended without a result. Your code and completed checks are safely preserved. Reply “Continue” to retry; you do not need to manage files or processes.',
          suggestedReply: 'Continue',
          agentInstruction:
            'Relay only message and suggestedReply to the user, then wait for that reply. Do not expose internal attempts, counters, paths, or recovery steps.',
        };
  }

  if (
    state.phase === 'verify' &&
    state.status === 'await-user' &&
    state.verification?.assurance === 'semantic-verification-unavailable'
  ) {
    return state.language === 'zh-CN'
      ? {
          required: true,
          message:
            '独立验收当前不可用，但你的代码和已经完成的检查都已安全保留。你可以直接重新尝试独立验收，也可以明确接受只有自动检查的结果。',
          suggestedReply: '重新尝试独立验收',
          agentInstruction:
            '只向用户转述 message 和 suggestedReply，并等待用户选择。用户要求重试时执行 commandAlternatives 中的 retry-verifier；只有用户明确接受降级结果时才执行 confirm-verifier-unavailable。不要把“继续”视为接受降级结果，也不要要求用户处理文件、进程、服务或回调。',
        }
      : {
          required: true,
          message:
            'Independent verification is currently unavailable, but your code and completed checks are safely preserved. You can retry independent verification directly or explicitly accept the automatic-check-only result.',
          suggestedReply: 'Retry independent verification',
          agentInstruction:
            'Relay only message and suggestedReply, then wait for the user choice. If the user asks to retry, run retry-verifier from commandAlternatives; run confirm-verifier-unavailable only when the user explicitly accepts the degraded result. Do not treat “Continue” as accepting the degraded result, and do not ask the user to manage files, processes, services, or callbacks.',
        };
  }

  if (
    state.phase === 'verify' &&
    state.status === 'await-user' &&
    state.loop.next_action === 'resolve-verifier-blocker'
  ) {
    return state.language === 'zh-CN'
      ? {
          required: true,
          message:
            '验证暂时无法下结论，因为缺少只有你能提供的信息，例如外部系统的真实行为或某个业务决定。你的代码和已经完成的检查都已安全保留。补充所需信息后可继续验证，也可以选择修改实现或调整需求。',
          suggestedReply: null,
          agentInstruction:
            '向用户转述 message，请用户补充缺失的信息，或在继续验证（resolve-verifier-blocker）、修改实现、调整需求之间明确选择，再执行 commandAlternatives 中对应的完整命令。不要把“继续”当作默认选择，也不要展示内部轮次、计数、路径或恢复步骤。',
        }
      : {
          required: true,
          message:
            'Verification cannot reach a verdict yet because information only you can provide is missing, such as the real behavior of an external system or a business decision. Your code and completed checks are safely preserved. Supply the missing information to resume verification, or choose to revise the implementation or the requirements.',
          suggestedReply: null,
          agentInstruction:
            'Relay message and ask the user to supply the missing information or explicitly choose between resuming verification (resolve-verifier-blocker), revising the implementation, and revising the requirements; run the matching commandAlternative afterwards. Do not treat “Continue” as a default choice, and do not expose internal rounds, counters, paths, or recovery steps.',
        };
  }

  if (
    state.phase === 'verify' &&
    state.status === 'await-user' &&
    state.loop.next_action === 'await-user'
  ) {
    // New states persist the exact stop reason. Older v4 states did not have
    // that field, so retain the counter-based fallback for compatibility.
    const stopReason =
      state.loop.stop_reason ?? (state.loop.no_progress_count >= 3 ? 'stalled' : 'budget');
    const stalled = stopReason === 'stalled';
    const zhMessage = stalled
      ? '验证已连续三轮失败且未通过的验收场景一直没有减少，本次修改已暂停，以避免在同一个问题上反复循环。你的代码和已经完成的检查都已安全保留。可以让 Builder 换一种修复思路继续，也可以回到需求阶段调整验收项。'
      : '本次修改的验证失败次数已用完配置的预算，因此暂停等待你的决定，而不是自动重试。你的代码和已经完成的检查都已安全保留。可以让 Builder 换一种修复思路继续，也可以回到需求阶段调整验收项。注意：预算不会重置，选择继续修复后，下一次验收失败会再次暂停。';
    const enMessage = stalled
      ? 'Verification has failed three times in a row without the unresolved scenarios shrinking, so this change is paused to avoid looping on the same problem. Your code and completed checks are safely preserved. You can have the Builder try a different repair approach, or go back and adjust the requirements.'
      : 'Verification for this change has used its configured failure budget, so it is paused for your decision instead of retrying automatically. Your code and completed checks are safely preserved. You can have the Builder continue with a different repair approach, or go back and adjust the requirements.';
    return state.language === 'zh-CN'
      ? {
          required: true,
          message: zhMessage,
          suggestedReply: '继续修复',
          agentInstruction:
            '向用户转述 message 和 suggestedReply，等待用户在“继续修复实现”（revise-implementation）与“调整需求”（revise-requirements）之间明确选择，再执行 commandAlternatives 中对应的完整命令。选择继续修复时，要求 Builder 更换修复思路。不要替用户选择，也不要展示内部轮次、计数、路径或恢复步骤。',
        }
      : {
          required: true,
          message: enMessage,
          suggestedReply: 'Continue repairing',
          agentInstruction:
            'Relay message and suggestedReply, then wait for the user to explicitly choose between continuing the implementation (revise-implementation) and adjusting the requirements (revise-requirements); run the matching commandAlternative afterwards. When continuing, ask the Builder to change its repair approach. Do not choose for the user, and do not expose internal rounds, counters, paths, or recovery steps.',
        };
  }

  if (
    state.phase === 'verify' &&
    state.status === 'await-user' &&
    state.verification_result === 'pass' &&
    state.loop.next_action === 'confirm-skill-coordinated-pass'
  ) {
    return {
      required: true,
      message: localized(
        state,
        'The reported verification passed, but this platform cannot confirm an independent Verifier execution. Review the result and choose whether to accept it for Archive, revise the implementation, or revise the requirements.' +
          (state.workspace.isolation !== 'current' && state.workspace.finish === null
            ? ' If accepting, also choose: keep the workspace, merge locally, push the branch, or push and create a PR. You may accept the result and defer the finish choice.'
            : ''),
        '当前验收报告已通过，但当前平台无法确认验收是否独立执行。请检查结果，并选择接受结果进入归档、继续修改实现，或调整需求。' +
          (state.workspace.isolation !== 'current' && state.workspace.finish === null
            ? ' 接受时可一起选择：保留工作区、本地合并、推送分支，或推送并创建 PR；也可以先接受结果，稍后再选择收尾方式。'
            : ''),
      ),
      suggestedReply: localized(state, 'Accept the result', '接受结果'),
      agentInstruction: localized(
        state,
        'Summarize the result and verification evidence, relay the message, and wait for an explicit user decision. Only then execute the matching commandAlternative. Do not accept the result on the user’s behalf.',
        '简要说明交付结果和验收证据，转述 message，并等待用户明确选择后再执行对应的 commandAlternative。不要替用户接受结果。',
      ),
    };
  }

  if (state.phase === 'build' && state.status === 'active') {
    const hardBlockedChildren =
      children?.children.some(({ status }) => status === 'blocked') ?? false;
    const reverifyChildren =
      children?.children.some(({ status }) => status === 'needs-reverify') ?? false;
    const progressingChildren =
      children?.children.some(({ status }) => status === 'ready' || status === 'active') ?? false;
    const explicitBuilderRetryAvailable =
      children?.children.some(
        ({ status, builderFailureCount }) =>
          status === 'blocked' &&
          (builderFailureCount ?? 0) >= NATIVE_MAX_SUPERVISOR_BUILDER_FAILURES,
      ) ?? false;
    if (
      hardBlockedChildren &&
      !reverifyChildren &&
      !progressingChildren &&
      !explicitBuilderRetryAvailable
    ) {
      return state.language === 'zh-CN'
        ? {
            required: true,
            message:
              'Supervisor 子任务暂时无法启动，已暂停自动重试以避免流程循环。请先根据子任务 blocker 修复工作区、分支或依赖；修复完成后重新运行最新的 next 继续流程。代码和已有证据已保留。',
            suggestedReply: '修复 blocker 后继续',
            agentInstruction:
              '向用户说明子任务 blocker 和需要先完成的外部修复；不要反复执行 next，也不要创建替代任务。用户确认工作区或依赖已修复后，再重新读取 status 并执行最新 continuation。',
          }
        : {
            required: true,
            message:
              'Supervisor child dispatch is paused because every remaining child is blocked. Automatic retries are stopped to avoid a loop. Resolve the recorded child blocker (workspace, branch, or dependency) first, then read the latest status and continue; code and completed evidence are preserved.',
            suggestedReply: 'Resolve the blocker and continue',
            agentInstruction:
              'Explain the child blocker and the required external repair to the user. Do not repeatedly run next or spawn replacement tasks. After the user confirms the workspace or dependency is fixed, read status again and execute the latest continuation.',
          };
    }
    return noUserUpdate(
      localized(
        state,
        'Implement the complete confirmed brief and Spec scope, then review every acceptance ID with its implementation and evidence before handoff. Fill acceptance_review from this audit; derive remaining work from it. Do not submit a partial candidate just to obtain verification feedback. Run focused checks; a separate pre-review is optional. If review is useful, retain the same Reviewer for focused repair follow-ups. Submit the completed candidate for one complete independent verification and release completed helper tasks.',
        '完成已确认的 brief 和 Spec 全部范围，交接前逐项核对所有验收 ID 的实现和证据，填写 acceptance_review，并由这份自查生成剩余工作。不得提交未完成的候选来试探验收反馈。开发期运行相关检查，额外预审为可选项；确需审查时，保留同一个 Reviewer 复核修复及受影响范围。全部完成后提交一次完整独立验收，及时释放已完成的辅助任务。',
      ),
    );
  }

  return noUserUpdate(
    localized(
      state,
      'Follow the continuation action. Unless required is true, continue without asking the user to handle internal workflow state, and do not present machine fields as a user-facing explanation.',
      '按 continuation 执行下一步。除非 required 为 true，否则继续推进，不要让用户处理内部工作流状态，也不要把机器字段作为面向用户的说明。',
    ),
  );
}

function nativePortableArchiveFinishCommunication(
  state: NativePortableState,
): NativePortableUserCommunication {
  const branch = state.workspace.change_branch ?? '<change-branch>';
  const target = state.workspace.target_branch ?? '<target-branch>';
  return state.language === 'zh-CN'
    ? {
        required: true,
        message: `当前 change 位于 ${branch}，目标分支为 ${target}。请选择一次工作区收尾方式：A) 保留工作区；B) 本地合并；C) 推送分支；D) 推送并创建 PR；E) 暂不归档。选择 A-D 后 Runtime 会完成预检，检查通过后按所选方式归档；选择 E 将保留当前 change 等待稍后继续。`,
        suggestedReply: '回复 A、B、C、D 或 E',
        agentInstruction:
          '向用户展示五种收尾方式及实际影响，等待用户选择。选择 A-D 时执行对应 commandAlternatives 的完整命令，Runtime 会在归档前检查状态和证据；选择 E 时停止，不运行 Archive 命令。按用户的明确选择执行 finish。',
      }
    : {
        required: true,
        message: `This change is on ${branch} and targets ${target}. Choose one workspace finish: A) keep the workspace; B) merge locally; C) push the branch; D) push and create a PR; or E) defer Archive. For A-D, Runtime will run preflight and archive with the selected finish when the checks pass; E keeps the current change for later.`,
        suggestedReply: 'Reply A, B, C, D, or E',
        agentInstruction:
          'Show all five finish choices and their actual effects, then wait. For A-D, execute the matching complete commandAlternative; Runtime checks state and evidence before archiving. For E, stop without running an Archive command. Use the finish explicitly selected by the user.',
      };
}

function nativePortableArchiveFinishAlternatives(
  state: NativePortableState,
): NativePortableCommandAlternative[] {
  const choices: Array<{
    finish: 'keep' | 'merge' | 'push' | 'pull-request';
    name: string;
    description: [string, string];
  }> = [
    {
      finish: 'keep',
      name: 'keep-workspace',
      description: [
        '保留当前分支和目录；完成归档提交，不合并、不推送、不创建 PR。',
        'Keep the current branch and directory; create the archive commit without merging, pushing, or creating a PR.',
      ],
    },
    {
      finish: 'merge',
      name: 'merge-locally',
      description: [
        '完成归档提交，并把 change 分支本地合并到目标分支；不推送、不创建 PR。',
        'Create the archive commit and merge the change branch locally into the target branch without pushing or creating a PR.',
      ],
    },
    {
      finish: 'push',
      name: 'push-branch',
      description: [
        '完成归档提交并推送 change 分支；不合并到目标分支、不创建 PR。',
        'Create the archive commit and push the change branch without merging into the target branch or creating a PR.',
      ],
    },
    {
      finish: 'pull-request',
      name: 'push-pull-request',
      description: [
        '完成归档提交、推送 change 分支，并以目标分支为基础创建 PR。',
        'Create the archive commit, push the change branch, and create a PR against the target branch.',
      ],
    },
  ];
  const finishAlternatives: NativePortableCommandAlternative[] = choices.map(
    ({ finish, name, description }) => ({
      name,
      stateVersion: state.state_version,
      expectedAction: 'archive' as const,
      commandArgs: [
        'comet',
        'native',
        'archive',
        state.name,
        '--confirmed',
        '--finish',
        finish,
        '--expected-state-version',
        String(state.state_version),
      ],
      requiredInputs: [],
      inputOptions: [],
      description: localized(state, description[1], description[0]),
    }),
  );
  return [
    ...finishAlternatives,
    {
      name: 'defer-archive',
      stateVersion: state.state_version,
      expectedAction: 'archive-preview' as const,
      commandArgs: null,
      requiredInputs: [],
      inputOptions: [],
      description: localized(
        state,
        'Keep the current change and workspace without archiving; stop and resume later.',
        '保留当前 change 和工作区，不执行归档；停止本次流程，稍后再继续。',
      ),
    },
  ];
}

function boundNativeNextCommandArgs(options: {
  change: string;
  stateVersion: number;
  action: NativePortableExpectedContinuationAction;
  flag: string;
}): string[] {
  return [
    'comet',
    'native',
    'next',
    options.change,
    '--summary',
    '<summary>',
    options.flag,
    '--expected-state-version',
    String(options.stateVersion),
    '--expected-action',
    options.action,
  ];
}

function textInput(name: string, flag: string): NativePortableContinuationInputOption {
  return { name, flag, valueKind: 'text', required: true, template: null };
}

function nativeCheckPlanTemplate(): NativePortableCheckPlanTemplate {
  return {
    id: '<check-id>',
    name: '<check-name>',
    executable: '<executable>',
    argv: [],
    cwdRef: '.',
    timeoutMs: 120000,
    repeatable: true,
  };
}

function confirmationInput(name: string, flag: string): NativePortableContinuationInputOption {
  return { name, flag, valueKind: 'confirmation', required: true, template: null };
}

function choiceInput(
  name: string,
  flag: string,
  choices: readonly string[],
): NativePortableContinuationInputOption {
  return { name, flag, valueKind: 'choice', required: true, template: null, choices: [...choices] };
}

function supervisorCoordinationRequired(children?: NativeChildrenInspection | null): boolean {
  return (
    children?.coordinationChoiceRequired === true ||
    (children?.schema === 'comet.native.children.v2' && children.children.length >= 2)
  );
}

function boundNativeShapePreparationCommandArgs(options: {
  change: string;
  stateVersion: number;
}): string[] {
  return [
    'comet',
    'native',
    'next',
    options.change,
    '--summary',
    '<summary>',
    '--expected-state-version',
    String(options.stateVersion),
    '--expected-action',
    'prepare-shape-confirmation',
  ];
}

function nativeNextDecisionAlternative(options: {
  name: string;
  change: string;
  stateVersion: number;
  expectedAction: NativePortableExpectedContinuationAction;
  flag: string;
  confirmationInput: string;
}): NativePortableCommandAlternative {
  return {
    name: options.name,
    stateVersion: options.stateVersion,
    expectedAction: options.expectedAction,
    commandArgs: boundNativeNextCommandArgs({
      change: options.change,
      stateVersion: options.stateVersion,
      action: options.expectedAction,
      flag: options.flag,
    }),
    requiredInputs: ['summary', options.confirmationInput],
    inputOptions: [
      textInput('summary', '--summary'),
      confirmationInput(options.name, options.flag),
    ],
  };
}

function nativePortableArchiveRepairAlternatives(
  state: NativePortableState,
  blockers: readonly string[],
): NativePortableCommandAlternative[] {
  const reportNeedsRepair = blockers.some((blocker) =>
    /^verification\.md is (?:missing|stale|invalid)$/u.test(blocker),
  );
  if (!reportNeedsRepair) return [];
  return [
    {
      name: 'repair-verification-report',
      stateVersion: state.state_version,
      expectedAction: 'archive-preview',
      commandArgs: ['comet', 'native', 'doctor', state.name, '--repair'],
      requiredInputs: [],
      inputOptions: [],
      description: localized(
        state,
        'Rebuild the Runtime-managed verification report, then rerun the Archive dry-run.',
        '重建由 Runtime 管理的 verification.md，然后重新运行 Archive 预检。',
      ),
    },
  ];
}

function isVerificationReportBlocker(blocker: string): boolean {
  return /^verification\.md is (?:missing|stale|invalid)$/u.test(blocker);
}

function nativeNextRevisionAlternatives(options: {
  change: string;
  stateVersion: number;
}): NativePortableCommandAlternative[] {
  return [
    nativeNextDecisionAlternative({
      name: 'revise-implementation',
      change: options.change,
      stateVersion: options.stateVersion,
      expectedAction: 'revise-implementation',
      flag: '--revise-implementation',
      confirmationInput: 'user-decision',
    }),
    nativeNextDecisionAlternative({
      name: 'revise-requirements',
      change: options.change,
      stateVersion: options.stateVersion,
      expectedAction: 'revise-requirements',
      flag: '--revise-requirements',
      confirmationInput: 'user-decision',
    }),
  ];
}

function individualRunnerInputs(
  options: NativePortableContinuationInputOption[],
): NativePortableContinuationInputOption[] {
  const descriptions: Record<string, string> = {
    'request-checks': 'Choose when the Verifier needs additional Runtime checks.',
    'final-result': 'Choose when the Verifier has a result for every current scope ID.',
    'verifier-execution-error':
      'Choose when a dispatched Verifier failed, was lost, or ended without a result.',
    'verifier-unavailable':
      'Choose only when the platform has no usable independent Verifier capability.',
  };
  return options.flatMap((option) => {
    if (!Array.isArray(option.template)) return [option];
    return option.template.map((template: { kind: string; response?: { kind: string } }) => {
      const name = template.response?.kind ?? template.kind;
      return {
        ...option,
        name,
        required: false,
        exclusiveGroup: 'runner-input',
        description: descriptions[name],
        template,
      };
    });
  });
}

export function nativePortableContinuation(
  state: NativePortableState,
  children?: NativeChildrenInspection | null,
  options: NativePortableContinuationOptions = {},
): NativePortableContinuation {
  const coordinationRequired =
    supervisorCoordinationRequired(children) && state.coordination_mode === undefined;
  const userCommunication = nativePortableUserCommunication(
    state,
    coordinationRequired,
    children,
    options.verifierStartup,
  );
  const base = {
    schema: 'comet.native.continuation.v2' as const,
    skill: 'comet-native' as const,
    change: state.name,
    phase: state.phase,
    status: state.status,
    stateVersion: state.state_version,
    inputOptions: [] as NativePortableContinuation['inputOptions'],
    requiresUserDecision: userCommunication.required,
    userCommunication,
  };
  const runner = (kind: NativePortableRunnerAction['kind']): NativePortableRunnerAction => ({
    kind,
    candidateId: state.builder_handoff?.candidate_id ?? null,
    iteration: state.loop.iteration,
    attempt: state.loop.attempt,
  });
  if (state.status === 'done') {
    return {
      ...base,
      disposition: 'done',
      action: 'none',
      commandArgs: null,
      requiredInputs: [],
      runnerAction: runner('none'),
    };
  }
  if (state.status === 'await-user') {
    if (state.phase === 'shape' && state.loop.next_action === 'confirm-shape') {
      return {
        ...base,
        disposition: 'await-user',
        action: 'confirm-shape',
        commandArgs: null,
        requiredInputs: [
          'summary',
          'shared-understanding-confirmation',
          ...(coordinationRequired ? ['coordination-choice'] : []),
        ],
        inputOptions: [textInput('summary', '--summary')],
        commandAlternatives: coordinationRequired
          ? NATIVE_SUPERVISOR_COORDINATION_MODES.map((mode) => {
              const alternative = nativeNextDecisionAlternative({
                name: `confirm-shape-${mode}`,
                change: state.name,
                stateVersion: state.state_version,
                expectedAction: 'confirm-shape',
                flag: '--confirmed',
                confirmationInput: 'shared-understanding-confirmation',
              });
              return {
                ...alternative,
                commandArgs: [...alternative.commandArgs!, '--coordination-mode', mode],
                requiredInputs: [...alternative.requiredInputs, 'coordination-choice'],
                inputOptions: [
                  ...alternative.inputOptions,
                  choiceInput('coordination-mode', '--coordination-mode', [mode]),
                ],
              };
            })
          : [
              nativeNextDecisionAlternative({
                name: 'confirm-shape',
                change: state.name,
                stateVersion: state.state_version,
                expectedAction: 'confirm-shape',
                flag: '--confirmed',
                confirmationInput: 'shared-understanding-confirmation',
              }),
            ],
        runnerAction: runner('none'),
      };
    }
    if (
      state.phase === 'verify' &&
      state.verification_result === 'pass' &&
      state.loop.next_action === 'confirm-skill-coordinated-pass'
    ) {
      return {
        ...base,
        disposition: 'await-user',
        action: 'confirm-skill-coordinated-pass',
        commandArgs: null,
        requiredInputs: ['summary', 'user-decision'],
        inputOptions: [textInput('summary', '--summary')],
        commandAlternatives: [
          ...(state.workspace.isolation !== 'current' && state.workspace.finish === null
            ? (['keep', 'merge', 'push', 'pull-request'] as const).map((finish) => {
                const alternative = nativeNextDecisionAlternative({
                  name: `accept-result-${finish}`,
                  change: state.name,
                  stateVersion: state.state_version,
                  expectedAction: 'accept-result',
                  flag: '--accept-result',
                  confirmationInput: 'user-decision',
                });
                return {
                  ...alternative,
                  commandArgs: [...alternative.commandArgs!, '--finish', finish],
                };
              })
            : []),
          nativeNextDecisionAlternative({
            name: 'accept-result',
            change: state.name,
            stateVersion: state.state_version,
            expectedAction: 'accept-result',
            flag: '--accept-result',
            confirmationInput: 'user-decision',
          }),
          ...nativeNextRevisionAlternatives({
            change: state.name,
            stateVersion: state.state_version,
          }),
        ],
        runnerAction: runner('none'),
      };
    }
    if (
      state.phase === 'verify' &&
      state.verification?.assurance === 'semantic-verification-unavailable' &&
      state.loop.next_action === 'confirm-verifier-unavailable'
    ) {
      return {
        ...base,
        disposition: 'await-user',
        action: 'confirm-verifier-unavailable',
        commandArgs: null,
        requiredInputs: ['summary', 'user-decision'],
        inputOptions: [textInput('summary', '--summary')],
        commandAlternatives: [
          nativeNextDecisionAlternative({
            name: 'retry-verifier',
            change: state.name,
            stateVersion: state.state_version,
            expectedAction: 'retry-verifier',
            flag: '--retry-verifier',
            confirmationInput: 'user-decision',
          }),
          nativeNextDecisionAlternative({
            name: 'confirm-verifier-unavailable',
            change: state.name,
            stateVersion: state.state_version,
            expectedAction: 'confirm-verifier-unavailable',
            flag: '--confirmed',
            confirmationInput: 'user-decision',
          }),
        ],
        runnerAction: runner('none'),
      };
    }
    if (state.phase === 'verify' && state.loop.next_action === 'resolve-verifier-blocker') {
      return {
        ...base,
        disposition: 'await-user',
        action: 'resolve-verifier-blocker',
        commandArgs: null,
        requiredInputs: ['summary', 'user-decision'],
        inputOptions: [textInput('summary', '--summary')],
        commandAlternatives: [
          nativeNextDecisionAlternative({
            name: 'resolve-verifier-blocker',
            change: state.name,
            stateVersion: state.state_version,
            expectedAction: 'resolve-verifier-blocker',
            flag: '--resolve-verifier-blocker',
            confirmationInput: 'user-resolution',
          }),
          ...nativeNextRevisionAlternatives({
            change: state.name,
            stateVersion: state.state_version,
          }),
        ],
        runnerAction: runner('none'),
      };
    }
    if (state.phase === 'verify' && state.loop.next_action === 'await-user') {
      return {
        ...base,
        disposition: 'await-user',
        action: 'resolve-loop-stop',
        commandArgs: null,
        requiredInputs: ['summary', 'user-decision'],
        inputOptions: [textInput('summary', '--summary')],
        commandAlternatives: nativeNextRevisionAlternatives({
          change: state.name,
          stateVersion: state.state_version,
        }),
        runnerAction: runner('none'),
      };
    }
    return {
      ...base,
      disposition: 'await-user',
      action: 'none',
      commandArgs: null,
      // Fallback for uncovered await-user states: surface the blocker message
      // and the revision alternatives so the agent always has an executable
      // next step instead of a dead `action: none` with no options.
      commandAlternatives: nativeNextRevisionAlternatives({
        change: state.name,
        stateVersion: state.state_version,
      }),
      userCommunication: {
        ...base.userCommunication,
        required: true,
        message:
          state.blockers.length > 0
            ? state.blockers.map(({ reason }) => reason).join('; ')
            : base.userCommunication.message,
        suggestedReply:
          state.blockers.length > 0
            ? (state.blockers[0]?.resolution_action ?? null)
            : base.userCommunication.suggestedReply,
      },
      requiredInputs: ['resolve-blocker'],
      runnerAction: runner('none'),
    };
  }
  if (state.status === 'blocked') {
    const retry = state.blockers.some(
      ({ resolution_action }) => resolution_action === 'retry-verifier',
    );
    return {
      ...base,
      disposition: 'blocked',
      action: retry ? 'retry-verifier' : 'none',
      commandArgs: retry
        ? boundNativeNextCommandArgs({
            change: state.name,
            stateVersion: state.state_version,
            action: 'retry-verifier',
            flag: '--retry-verifier',
          })
        : null,
      requiredInputs: retry ? ['summary'] : ['repair-runtime'],
      inputOptions: retry
        ? [
            {
              name: 'summary',
              flag: '--summary',
              valueKind: 'text',
              required: true,
              template: null,
            },
          ]
        : [],
      runnerAction: runner(retry ? 'retry-verifier' : 'none'),
    };
  }
  if (state.phase === 'shape') {
    return {
      ...base,
      disposition: 'continue',
      action: 'prepare-shape-confirmation',
      commandArgs: boundNativeShapePreparationCommandArgs({
        change: state.name,
        stateVersion: state.state_version,
      }),
      requiredInputs: ['summary'],
      inputOptions: [
        {
          name: 'summary',
          flag: '--summary',
          valueKind: 'text',
          required: true,
          template: null,
        },
      ],
      runnerAction: runner('none'),
    };
  }
  if (state.phase === 'build') {
    if (children) {
      if (!children.confirmed) {
        return {
          ...base,
          disposition: 'continue',
          action: 'advance-children',
          commandArgs: ['comet', 'native', 'next', state.name, '--summary', '<summary>'],
          requiredInputs: ['summary'],
          inputOptions: [
            {
              name: 'summary',
              flag: '--summary',
              valueKind: 'text',
              required: true,
              template: null,
            },
          ],
          runnerAction: runner('none'),
        };
      }
      if (state.loop.stage === 'repairing' && state.verification_result === 'fail') {
        return {
          ...base,
          disposition: 'continue',
          action: 'repair',
          // The repair loop continues by editing children.yaml and running
          // `next`; the children-contract drift detection then returns the
          // change to Shape for confirmation (issue: an actionless repair
          // continuation left agents with no executable step).
          commandArgs: ['comet', 'native', 'next', state.name, '--summary', '<summary>'],
          requiredInputs: ['repair-child'],
          inputOptions: [
            {
              name: 'summary',
              flag: '--summary',
              valueKind: 'text' as const,
              required: true,
              template: null,
            },
          ],
          runnerAction: runner('none'),
        };
      }
      if (children.allDone) {
        return {
          ...base,
          disposition: 'continue',
          action: 'builder-handoff',
          commandArgs: [
            'comet',
            'native',
            'next',
            state.name,
            '--runner-input',
            '<temporary-json-file>',
          ],
          requiredInputs: ['builder-handoff-json-file'],
          inputOptions: [
            {
              name: 'runner-input',
              flag: '--runner-input',
              valueKind: 'json-file',
              required: true,
              template: {
                kind: 'builder-handoff',
                summary: '<summary>',
                addressed_acceptance_ids: state.acceptance.map(({ id }) => id),
                acceptance_review: state.acceptance.map(({ id }) => ({
                  id,
                  status: 'not-implemented',
                  evidence: [],
                  note: '<implementation and evidence summary>',
                })),
                checks: [{ name: '<check-name>', result: 'not-run', note: null }],
                verification_checks: [nativeCheckPlanTemplate()],
                known_limits: [],
              },
            },
          ],
          runnerAction: runner('builder-handoff'),
        };
      }
      const verified = children.children.find(({ status }) => status === 'verified');
      if (verified) {
        const retryCheckIds = options.supervisorIntegrationRetryIds;
        return {
          ...base,
          disposition: 'continue',
          action: 'advance-children',
          commandArgs: [
            'comet',
            'native',
            'next',
            state.name,
            '--runner-input',
            '<temporary-json-file>',
          ],
          requiredInputs: ['supervisor-integration-checks'],
          inputOptions: [
            {
              name: 'runner-input',
              flag: '--runner-input',
              valueKind: 'json-file',
              required: true,
              template: {
                kind: 'supervisor-integrate',
                child: verified.name,
                checks: [
                  {
                    id: '<check-id>',
                    name: '<check-name>',
                    executable: '<executable>',
                    argv: [],
                    cwdRef: '.',
                    timeoutMs: 120000,
                    repeatable: true,
                  },
                ],
                ...(retryCheckIds && retryCheckIds.length > 0
                  ? { retry_check_ids: [...retryCheckIds] }
                  : {}),
              },
            },
          ],
          runnerAction: runner('none'),
        };
      }
      const blocked = children.children.some(
        ({ status }) => status === 'blocked' || status === 'needs-reverify',
      );
      const reverifyPending = children.children.some(({ status }) => status === 'needs-reverify');
      const progressing = children.children.some(
        ({ status }) => status === 'ready' || status === 'active',
      );
      const exhaustedBuilder =
        children.supervisorStateVersion === undefined
          ? null
          : (children.children.find(
              (child) =>
                child.status === 'blocked' &&
                (child.builderFailureCount ?? 0) >= NATIVE_MAX_SUPERVISOR_BUILDER_FAILURES,
            ) ?? null);
      const builderRetryOption =
        exhaustedBuilder === null
          ? null
          : {
              name: 'runner-input',
              flag: '--runner-input' as const,
              valueKind: 'json-file' as const,
              required: true,
              template: {
                kind: 'supervisor-retry-builder',
                child: exhaustedBuilder.name,
                stateVersion: children.supervisorStateVersion,
              },
              description: localized(
                state,
                'Explicitly authorize one fresh Builder attempt after the Builder failure budget was exhausted.',
                'Builder 失败预算已耗尽；明确授权后才能重新开始一次 Builder 尝试。',
              ),
            };
      const blockedWithoutBuilderRetry =
        blocked && !reverifyPending && !progressing && builderRetryOption === null;
      return {
        ...base,
        disposition: blockedWithoutBuilderRetry ? 'blocked' : 'continue',
        action: 'advance-children',
        commandArgs: blockedWithoutBuilderRetry
          ? null
          : builderRetryOption !== null
            ? ['comet', 'native', 'next', state.name, '--runner-input', '<temporary-json-file>']
            : [
                'comet',
                'native',
                'next',
                state.name,
                '--summary',
                '<summary>',
                ...(state.coordination_mode === 'single-session' ? ['--max-parallel', '1'] : []),
              ],
        requiredInputs: blockedWithoutBuilderRetry
          ? []
          : builderRetryOption !== null
            ? ['supervisor-builder-retry-json-file']
            : ['ready-children'],
        inputOptions: blockedWithoutBuilderRetry
          ? []
          : builderRetryOption !== null
            ? [builderRetryOption]
            : [textInput('summary', '--summary')],
        runnerAction: runner('none'),
      };
    }
    return {
      ...base,
      disposition: 'continue',
      action: state.loop.stage === 'repairing' ? 'repair' : 'builder-handoff',
      commandArgs: [
        'comet',
        'native',
        'next',
        state.name,
        '--runner-input',
        '<temporary-json-file>',
      ],
      requiredInputs: ['builder-handoff-json-file'],
      inputOptions: [
        {
          name: 'runner-input',
          flag: '--runner-input',
          valueKind: 'json-file',
          required: true,
          template: {
            kind: 'builder-handoff',
            summary: '<summary>',
            addressed_acceptance_ids: state.acceptance.map(({ id }) => id),
            acceptance_review: state.acceptance.map(({ id }) => {
              const previous = state.builder_handoff?.acceptance_review?.find(
                (entry) => entry.id === id,
              );
              return previous
                ? {
                    ...previous,
                    evidence: [...previous.evidence],
                    ...(state.loop.previous_unresolved_ids.includes(id)
                      ? {
                          status: 'implemented-no-evidence',
                          evidence: [],
                          note: '<current repair and evidence summary>',
                        }
                      : {}),
                  }
                : {
                    id,
                    status: 'not-implemented',
                    evidence: [],
                    note: '<implementation and evidence summary>',
                  };
            }),
            checks: [{ name: '<check-name>', result: 'not-run', note: null }],
            verification_checks: [],
            known_limits: [],
          },
        },
      ],
      runnerAction: runner('builder-handoff'),
    };
  }
  if (state.phase === 'verify') {
    const awaiting = state.loop.next_action === 'await-verifier-result';
    const supervisor = Boolean(state.children_contract_hash);
    const checkTemplate = nativeCheckPlanTemplate();
    if (!awaiting && options.retryCheckIds && options.retryCheckIds.length > 0) {
      return {
        ...base,
        disposition: 'continue',
        action: 'retry-checks',
        commandArgs: [
          'comet',
          'native',
          'next',
          state.name,
          '--runner-input',
          '<temporary-json-file>',
        ],
        requiredInputs: ['retry-checks-json-file'],
        inputOptions: [
          {
            name: 'runner-input',
            flag: '--runner-input',
            valueKind: 'json-file',
            required: true,
            template: {
              kind: 'retry-checks',
              check_ids: [...options.retryCheckIds],
            },
          },
        ],
        runnerAction: runner('retry-checks'),
      };
    }
    return {
      ...base,
      userCommunication:
        !awaiting && supervisor
          ? {
              ...base.userCommunication,
              agentInstruction: `${base.userCommunication.agentInstruction} ${localized(
                state,
                'Resolve at least one integration check for the Supervisor parent; cwdRef is relative to the integration worktree.',
                '为 Supervisor 父级解析至少一项集成检查；cwdRef 相对于集成工作区。',
              )}`,
            }
          : base.userCommunication,
      disposition: 'continue',
      action: awaiting ? 'await-verifier' : 'dispatch-verifier',
      commandArgs: [
        'comet',
        'native',
        'next',
        state.name,
        '--runner-input',
        '<temporary-json-file>',
      ],
      requiredInputs: [
        awaiting ? 'verifier-response-or-error-json-file' : 'resolved-check-plan-json-file',
      ],
      inputOptions: individualRunnerInputs([
        {
          name: 'runner-input',
          flag: '--runner-input',
          valueKind: 'json-file',
          required: true,
          template: awaiting
            ? [
                {
                  kind: 'verifier-response',
                  candidateId: state.builder_handoff?.candidate_id ?? '<candidate-id>',
                  verifierExecutionRef: options.verifierExecutionRef ?? '<from verifierDispatch>',
                  response: {
                    kind: 'request-checks',
                    iteration: state.loop.iteration,
                    attempt: state.loop.attempt,
                    checks: [checkTemplate],
                  },
                },
                {
                  kind: 'verifier-response',
                  candidateId: state.builder_handoff?.candidate_id ?? '<candidate-id>',
                  verifierExecutionRef: options.verifierExecutionRef ?? '<from verifierDispatch>',
                  response: {
                    kind: 'final-result',
                    result: {
                      iteration: state.loop.iteration,
                      attempt: state.loop.attempt,
                      verdict: 'blocked',
                      acceptance: [
                        {
                          id: '<acceptance-id>',
                          result: 'blocked',
                          reason: '<reason>',
                        },
                      ],
                      risks: [],
                      summary: '<summary>',
                    },
                  },
                },
                {
                  kind: 'verifier-execution-error',
                  summary: '<summary>',
                  stateVersion: state.state_version,
                  iteration: state.loop.iteration,
                  attempt: state.loop.attempt,
                  verifierExecutionRef: options.verifierExecutionRef ?? '<from verifierDispatch>',
                },
                {
                  kind: 'verifier-unavailable',
                  summary: '<why no independent semantic execution is available>',
                  stateVersion: state.state_version,
                  iteration: state.loop.iteration,
                  attempt: state.loop.attempt,
                  verifierExecutionRef: options.verifierExecutionRef ?? '<from verifierDispatch>',
                },
              ]
            : {
                kind: 'dispatch-verifier',
                checks: options.verificationCheckPlans
                  ? options.verificationCheckPlans.map((plan) => ({
                      ...plan,
                      argv: [...plan.argv],
                    }))
                  : supervisor
                    ? [checkTemplate]
                    : [],
              },
        },
      ]),
      runnerAction: runner(awaiting ? 'await-verifier' : 'dispatch-verifier'),
    };
  }
  if (
    state.phase === 'archive' &&
    state.status === 'active' &&
    state.loop.stage === 'archive-ready' &&
    !state.archived
  ) {
    const archiveMode = options.archiveMode ?? 'archive-ready';
    const isolated = state.workspace.isolation !== 'current';
    const finishRequired = isolated && state.workspace.finish === null;
    if (archiveMode === 'blocked') {
      return {
        ...base,
        disposition: 'blocked',
        action: 'archive',
        commandArgs: null,
        requiredInputs: ['archive-blocker-resolution'],
        inputOptions: [],
        runnerAction: runner('none'),
      };
    }
    if (archiveMode === 'preview') {
      if (options.archiveBlockers && options.archiveBlockers.length > 0) {
        const reportRepair = nativePortableArchiveRepairAlternatives(
          state,
          options.archiveBlockers,
        )[0];
        if (
          reportRepair &&
          options.archiveBlockers.every((blocker) => isVerificationReportBlocker(blocker))
        ) {
          return {
            ...base,
            disposition: 'continue',
            action: 'repair',
            commandArgs: reportRepair.commandArgs,
            requiredInputs: [],
            inputOptions: [],
            runnerAction: runner('none'),
          };
        }
        return {
          ...base,
          disposition: 'blocked',
          action: 'archive',
          commandArgs: null,
          requiredInputs: ['archive-blocker-resolution'],
          inputOptions: [],
          commandAlternatives: nativePortableArchiveRepairAlternatives(
            state,
            options.archiveBlockers,
          ),
          runnerAction: runner('none'),
        };
      }
      return {
        ...base,
        disposition: 'continue',
        action: 'archive',
        commandArgs: ['comet', 'native', 'archive', state.name, '--confirmed'],
        requiredInputs: [],
        runnerAction: runner('none'),
      };
    }
    if (finishRequired) {
      return {
        ...base,
        disposition: 'await-user',
        action: 'archive',
        commandArgs: null,
        requiredInputs: ['workspace-finish'],
        inputOptions: [
          choiceInput('finish', '--finish', ['keep', 'merge', 'push', 'pull-request']),
        ],
        commandAlternatives: [...nativePortableArchiveFinishAlternatives(state)],
        userCommunication: nativePortableArchiveFinishCommunication(state),
        runnerAction: runner('none'),
      };
    }
    return {
      ...base,
      disposition: 'continue',
      action: 'archive',
      commandArgs: ['comet', 'native', 'archive', state.name, '--dry-run'],
      requiredInputs: [],
      commandAlternatives: [
        nativeNextDecisionAlternative({
          name: 'revise-requirements',
          change: state.name,
          stateVersion: state.state_version,
          expectedAction: 'revise-requirements',
          flag: '--revise-requirements',
          confirmationInput: 'user-decision',
        }),
      ],
      runnerAction: runner('none'),
    };
  }
  return {
    ...base,
    disposition: 'continue',
    action: 'archive',
    commandArgs: ['comet', 'native', 'archive', state.name, '--confirmed'],
    requiredInputs: [],
    runnerAction: runner('none'),
  };
}
