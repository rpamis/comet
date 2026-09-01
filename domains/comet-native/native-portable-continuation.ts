import type { NativeChildrenInspection } from './native-children.js';
import type { NativePortableExpectedContinuationAction } from './native-portable-runtime.js';
import {
  NATIVE_SUPERVISOR_COORDINATION_MODES,
  type NativePortableState,
} from './native-portable-types.js';

type NativePortableContinuationInputOption = {
  name: string;
  flag: string;
  valueKind: 'text' | 'confirmation' | 'choice' | 'json-file';
  required: boolean;
  template: unknown | null;
  choices?: string[];
};

type NativePortableCommandAlternative = {
  name: string;
  stateVersion: number;
  expectedAction: NativePortableExpectedContinuationAction;
  commandArgs: string[];
  requiredInputs: string[];
  inputOptions: NativePortableContinuationInputOption[];
};

export interface NativePortableRunnerAction {
  kind: 'builder-handoff' | 'dispatch-verifier' | 'await-verifier' | 'retry-verifier' | 'none';
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
  action:
    | 'confirm-shape'
    | 'confirm-skill-coordinated-pass'
    | 'confirm-verifier-unavailable'
    | 'resolve-verifier-blocker'
    | 'resolve-loop-stop'
    | 'advance-children'
    | 'advance-parent'
    | 'builder-handoff'
    | 'dispatch-verifier'
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

function localized(state: NativePortableState, english: string, chinese: string): string {
  return state.language === 'zh-CN' ? chinese : english;
}

function nativePortableUserCommunication(
  state: NativePortableState,
  coordinationChoiceRequired: boolean,
): NativePortableUserCommunication {
  const noUserUpdate = (agentInstruction: string): NativePortableUserCommunication => ({
    required: false,
    message: null,
    suggestedReply: null,
    agentInstruction,
  });

  if (coordinationChoiceRequired && state.phase === 'shape' && state.status === 'active') {
    return {
      required: true,
      message: localized(
        state,
        'This Supervisor Change has multiple independent children. Choose one coordination mode before confirming Shape: A) Multi-session coordination (recommended), or B) Single-session progression.',
        '当前 Supervisor Change 包含多个可独立执行的 Child。确认 Shape 前请选择推进方式：A）多会话协作（推荐），或 B）单会话推进。',
      ),
      suggestedReply: localized(state, 'Reply A or B', '回复 A 或 B'),
      agentInstruction: localized(
        state,
        'Relay the two coordination choices and wait for the user decision. Do not treat a generic confirmation as a mode selection or run --confirmed without --coordination-mode.',
        '转述这两个推进方式并等待用户选择。不要把普通“确认”视为已选择推进方式，也不要在没有 --coordination-mode 时运行 --confirmed。',
      ),
    };
  }

  if (
    state.phase === 'verify' &&
    state.status === 'active' &&
    state.loop.stage === 'verify-ready'
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
    return noUserUpdate(
      localized(
        state,
        'Wait only while the dispatched Verifier task is still active. If it did not start, ended without a response, or is no longer available, immediately submit the matching verifier-unavailable or verifier-execution-error input. Do not ask the user to recover files or processes, and do not expose attempt or requestCheckRounds.',
        '仅在已派发的独立验收任务仍在运行时等待。如果任务未启动、结束后没有返回结果或已经丢失，立即提交匹配的 verifier-unavailable 或 verifier-execution-error 输入。不要让用户恢复文件或进程，也不要向用户展示 attempt、requestCheckRounds 等机器状态。',
      ),
    );
  }

  if (
    state.status === 'blocked' &&
    state.blockers.some(({ resolution_action }) => resolution_action === 'retry-verifier')
  ) {
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
            '由于独立验收服务暂时不可用，目前只能完成自动检查。你可以选择接受当前检查结果，或者等验收服务恢复后再重试。',
          suggestedReply: null,
          agentInstruction:
            '向用户转述 message，并请用户明确选择是否接受只有自动检查的结果。不要把“继续”当作默认接受。',
        }
      : {
          required: true,
          message:
            'Because independent verification is temporarily unavailable, only the automatic checks could be completed. You can accept the current check results or wait and retry when verification is available.',
          suggestedReply: null,
          agentInstruction:
            'Relay message and ask the user to explicitly choose whether to accept automatic checks only. Do not treat “Continue” as implicit acceptance.',
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
      : '本次修改的验证失败次数已用完配置的预算，因此暂停等待你的决定，而不是自动重试。你的代码和已经完成的检查都已安全保留。可以让 Builder 换一种修复思路继续，也可以回到需求阶段调整验收项。';
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

  return noUserUpdate(
    localized(
      state,
      'Follow the continuation action. Unless required is true, continue without asking the user to handle internal workflow state, and do not present machine fields as a user-facing explanation.',
      '按 continuation 执行下一步。除非 required 为 true，否则继续推进，不要让用户处理内部工作流状态，也不要把机器字段作为面向用户的说明。',
    ),
  );
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

function boundNativeShapeCommandArgs(options: {
  change: string;
  stateVersion: number;
  coordinationRequired: boolean;
}): string[] {
  return [
    'comet',
    'native',
    'next',
    options.change,
    '--summary',
    '<summary>',
    ...(options.coordinationRequired ? ['--coordination-mode', '<coordination-mode>'] : []),
    '--confirmed',
    '--expected-state-version',
    String(options.stateVersion),
    '--expected-action',
    'confirm-shape',
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

export function nativePortableContinuation(
  state: NativePortableState,
  children?: NativeChildrenInspection | null,
): NativePortableContinuation {
  const coordinationRequired =
    supervisorCoordinationRequired(children) && state.coordination_mode === undefined;
  const base = {
    schema: 'comet.native.continuation.v2' as const,
    skill: 'comet-native' as const,
    change: state.name,
    phase: state.phase,
    status: state.status,
    stateVersion: state.state_version,
    inputOptions: [] as NativePortableContinuation['inputOptions'],
    userCommunication: nativePortableUserCommunication(state, coordinationRequired),
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
        commandArgs: boundNativeNextCommandArgs({
          change: state.name,
          stateVersion: state.state_version,
          action: 'confirm-verifier-unavailable',
          flag: '--confirmed',
        }),
        requiredInputs: ['summary', 'user-confirmation'],
        inputOptions: [
          {
            name: 'summary',
            flag: '--summary',
            valueKind: 'text',
            required: true,
            template: null,
          },
          {
            name: 'confirmed',
            flag: '--confirmed',
            valueKind: 'confirmation',
            required: true,
            template: null,
          },
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
      disposition: coordinationRequired ? 'await-user' : 'continue',
      action: 'confirm-shape',
      commandArgs: boundNativeShapeCommandArgs({
        change: state.name,
        stateVersion: state.state_version,
        coordinationRequired,
      }),
      requiredInputs: [
        'summary',
        ...(coordinationRequired ? ['coordination-choice'] : []),
        'shared-understanding-confirmation',
      ],
      inputOptions: [
        {
          name: 'summary',
          flag: '--summary',
          valueKind: 'text',
          required: true,
          template: null,
        },
        ...(coordinationRequired
          ? [
              choiceInput(
                'coordination-mode',
                '--coordination-mode',
                NATIVE_SUPERVISOR_COORDINATION_MODES,
              ),
            ]
          : []),
        confirmationInput('confirmed', '--confirmed'),
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
          commandArgs: null,
          requiredInputs: ['repair-child'],
          inputOptions: [],
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
                addressed_acceptance_ids: ['<acceptance-id>'],
                checks: [{ name: '<check-name>', result: 'not-run', note: null }],
                known_limits: [],
                review: {
                  status: 'passed',
                  summary: '<review-summary>',
                  reviewer_execution_ref: '<reviewer-execution-ref>',
                },
              },
            },
          ],
          runnerAction: runner('builder-handoff'),
        };
      }
      const blocked = children.children.some(
        ({ status }) => status === 'blocked' || status === 'needs-reverify',
      );
      const progressing = children.children.some(
        ({ status }) => status === 'ready' || status === 'active',
      );
      return {
        ...base,
        disposition: blocked && !progressing ? 'blocked' : 'continue',
        action: 'advance-children',
        commandArgs: null,
        requiredInputs: blocked && !progressing ? ['resolve-child-blocker'] : ['ready-children'],
        inputOptions: [],
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
            addressed_acceptance_ids: ['<acceptance-id>'],
            checks: [{ name: '<check-name>', result: 'not-run', note: null }],
            known_limits: [],
            review: {
              status: 'passed',
              summary: '<review-summary>',
              reviewer_execution_ref: '<reviewer-execution-ref>',
            },
          },
        },
      ],
      runnerAction: runner('builder-handoff'),
    };
  }
  if (state.phase === 'verify') {
    const awaiting = state.loop.next_action === 'await-verifier-result';
    const supervisor = Boolean(state.children_contract_hash);
    const checkTemplate = {
      id: '<check-id>',
      name: '<check-name>',
      executable: '<executable>',
      argv: [],
      cwdRef: '.',
      timeoutMs: 120000,
      repeatable: true,
    };
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
      inputOptions: [
        {
          name: 'runner-input',
          flag: '--runner-input',
          valueKind: 'json-file',
          required: true,
          template: awaiting
            ? [
                {
                  kind: 'verifier-response',
                  response: {
                    kind: 'request-checks',
                    iteration: state.loop.iteration,
                    attempt: state.loop.attempt,
                    checks: [checkTemplate],
                  },
                },
                {
                  kind: 'verifier-response',
                  response: {
                    kind: 'final-result',
                    result: {
                      iteration: state.loop.iteration,
                      attempt: state.loop.attempt,
                      verdict: '<pass|fail|blocked>',
                      acceptance: [
                        {
                          id: '<acceptance-id>',
                          result: '<passed|failed|blocked>',
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
                  verifierExecutionRef: '<from verifierDispatch>',
                },
                {
                  kind: 'verifier-unavailable',
                  summary: '<why no independent semantic execution is available>',
                  stateVersion: state.state_version,
                  iteration: state.loop.iteration,
                  attempt: state.loop.attempt,
                  verifierExecutionRef: '<from verifierDispatch>',
                },
              ]
            : { kind: 'dispatch-verifier', checks: supervisor ? [checkTemplate] : [] },
        },
      ],
      runnerAction: runner(awaiting ? 'await-verifier' : 'dispatch-verifier'),
    };
  }
  if (
    state.phase === 'archive' &&
    state.status === 'active' &&
    state.loop.stage === 'archive-ready' &&
    !state.archived
  ) {
    return {
      ...base,
      disposition: 'continue',
      action: 'archive',
      commandArgs: ['comet', 'native', 'archive', state.name, '--confirmed'],
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
