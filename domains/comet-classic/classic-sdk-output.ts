import type { RuntimeAction, RuntimeValue, WorkflowRun } from '../engine/runtime.js';
import type { CliActionContinuation } from '../workflow-contract/output-envelope.js';
import { classicRecoveryContext } from './classic-recovery.js';
import { resolveClassicChangeDirectory } from './classic-paths.js';
import { classicSdkNextAction, findClassicSdkWorkspace } from './classic-sdk-status.js';
import { inspectClassicSdkActionRecovery } from './classic-sdk-check-recovery.js';
import type { ClassicState } from './classic-state.js';

/** 当前 Run 的有界视图；保留所有并行动作，不把历史输入重复展开。 */
export function classicSdkRunSummary(run: WorkflowRun, details = false) {
  if (details) return { ...run, id: run.runId };
  return {
    id: run.runId,
    runId: run.runId,
    revision: run.revision,
    status: run.status,
    actions: run.actions
      .filter((action) => ['pending', 'running', 'unknown'].includes(action.status))
      .map(
        ({ id, stepId, type, ref, status, attempt, inputHash, claim, requiredCapabilities }) => ({
          id,
          stepId,
          type,
          ...(ref ? { ref } : {}),
          status,
          attempt,
          inputHash,
          requiredCapabilities,
          ...(claim ? { claim } : {}),
        }),
      ),
    evidenceWaits: (run.evidenceWaits ?? [])
      .filter((wait) => wait.status === 'pending')
      .map(({ id, stepId, kind, status }) => ({ id, stepId, kind, status })),
    waits: run.waits
      .filter((wait) => wait.status === 'pending')
      .map(({ id, stepId, status, proposal, proposalHash, choices }) => ({
        id,
        stepId,
        status,
        proposal,
        proposalHash,
        choices,
      })),
  };
}

function runtimeObject(value: RuntimeValue | undefined): Record<string, RuntimeValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** 只裁剪内置宿主契约已知的累计输入；未知 Skill 或输入布局保留原文。 */
function classicSdkCurrentInput(run: WorkflowRun, action: RuntimeAction) {
  const builtin = /^comet-classic-(full|hotfix|tweak)$/u.test(run.workflow.id);
  if (!builtin) return { input: action.input };
  if (
    action.type === 'call_tool' &&
    [
      'classic-check',
      'classic-open-revalidate',
      'classic-archive-preflight',
      'classic-archive',
    ].includes(action.ref ?? '')
  )
    return {};
  const step = action.stepId.slice(action.stepId.indexOf('.') + 1);
  const skillSteps = [
    'open',
    'design.handoff',
    'design.document',
    'build.configure',
    'build.plan',
    'build.execute',
    'verify.run',
    'archive.prepare',
    'archive.deliver',
  ];
  const input = runtimeObject(action.input);
  const outputs = input ? runtimeObject(input.outputs) : null;
  if (
    action.type !== 'invoke_skill' ||
    !skillSteps.includes(step) ||
    ![
      'comet-open',
      'comet-design',
      'comet-build',
      'comet-verify',
      'comet-archive',
      'comet-hotfix',
      'comet-tweak',
    ].includes(action.ref ?? '') ||
    !input ||
    !outputs ||
    !Object.hasOwn(input, 'input') ||
    Object.keys(input).some((key) => !['input', 'outputs', 'activation'].includes(key))
  )
    return { input: action.input };
  const profile = action.stepId.split('.')[0];
  const currentOutputs: Record<string, RuntimeValue> = {};
  const checkSummary = (value: RuntimeValue) => {
    const check = runtimeObject(value);
    if (!check) return value;
    return Object.fromEntries(
      Object.entries(check).filter(([key]) =>
        [
          'scope',
          'argv',
          'cwd',
          'exitCode',
          'receiptRef',
          'contentHash',
          'inputBefore',
          'inputAfter',
          'tier',
          'changedDuringExecution',
        ].includes(key),
      ),
    );
  };
  const keepCheck = (suffix: string) => {
    const key = `${profile}.${suffix}`;
    if (outputs[key] !== undefined) currentOutputs[key] = checkSummary(outputs[key]);
  };
  if (step === 'verify.run') keepCheck('build.check');
  if (step === 'archive.prepare') keepCheck('verify.check');
  if (step === 'archive.deliver') {
    for (const suffix of ['archive.preflight', 'archive.execute']) {
      const key = `${profile}.${suffix}`;
      if (outputs[key] !== undefined) currentOutputs[key] = outputs[key];
    }
  }
  // 返工需要本轮失败的实际原因和日志，不重复成功轮次的所有检查收据。
  const context = run.actionContexts[action.id]?.results ?? {};
  const failure = step.startsWith('build.')
    ? run.actions
        .filter((prior) => {
          const result = context[prior.stepId];
          const output = runtimeObject(prior.outcome?.output);
          return (
            result?.sequence === run.actionContexts[prior.id]?.sequence &&
            (prior.status === 'failed' || output?.event === 'verify-fail')
          );
        })
        .sort(
          (left, right) =>
            run.actionContexts[right.id].sequence - run.actionContexts[left.id].sequence,
        )[0]
    : undefined;
  if (failure?.outcome)
    currentOutputs[failure.stepId] =
      failure.type === 'call_tool' ? checkSummary(failure.outcome.output) : failure.outcome.output;
  const invalidated = step.startsWith('build.')
    ? (run.evidenceWaits ?? []).find(
        (wait) => wait.status === 'invalidated' && context[wait.stepId]?.sequence === wait.sequence,
      )
    : undefined;
  return {
    inputSummary: {
      usage: 'host-context-only' as const,
      scope: input.input,
      ...(input.activation === undefined ? {} : { activation: input.activation }),
      configurationRef: 'data.configuration',
      artifactRefsRef: 'data.artifactRefs',
      taskStateRef: 'data.taskState',
      approvalsRef: 'data.continuation.current.approvals',
      ...(Object.keys(currentOutputs).length ? { outputs: currentOutputs } : {}),
      ...(invalidated?.invalidation ? { invalidatedEvidence: invalidated.invalidation } : {}),
    },
  };
}

/** 只把 Run 已安排的工作映射到公开命令，不预测或推进领域状态。 */
export function classicSdkContinuation(
  run: WorkflowRun,
  projectRoot: string,
  change: string,
  observation: { openApprovalHash?: string } = {},
) {
  const nextAction = classicSdkNextAction(run);
  const state = run.state as unknown as ClassicState;
  const summary = classicSdkRunSummary(run);
  const identity = { runId: run.runId, expectedRevision: run.revision };
  const dispatch = [
    'comet',
    'runtime',
    'dispatch',
    '--application',
    run.workflow.id.replace(/^comet-classic-/u, 'classic-'),
    '--project-root',
    projectRoot,
    '--request',
    '<request-json-file>',
    '--json',
  ];
  const approvals = run.waits.filter(
    (wait) =>
      wait.status === 'resolved' &&
      summary.actions.some(
        (action) => run.actionContexts[action.id]?.results[wait.stepId]?.sequence === wait.sequence,
      ),
  );
  const current = {
    actions: summary.actions.map((action) => ({
      ...action,
      ...classicSdkCurrentInput(
        run,
        run.actions.find((entry) => entry.id === action.id)!,
      ),
    })),
    waits: summary.waits.map((wait) => ({
      ...wait,
      request: {
        operation: 'resolve-wait',
        ...identity,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        choice: '<user-choice>',
        decisionId: '<decision-id>',
      },
    })),
    evidenceWaits: (summary.evidenceWaits ?? []).map((wait) => ({
      ...wait,
      request: {
        operation: 'record-evidence',
        ...identity,
        evidenceId: wait.id,
        kind: wait.kind,
        ref: '<actual-evidence-ref>',
        contentHash: '<actual-evidence-sha256>',
        submissionId: '<submission-id>',
      },
    })),
    approvals: approvals.map(({ id, stepId, proposal, proposalHash, choices, decision }) => ({
      id,
      stepId,
      proposal,
      proposalHash,
      choices,
      decision,
    })),
  };
  const base = {
    ...nextAction,
    schema: 'comet.classic.continuation.v1' as const,
    cwd: projectRoot,
    run: { id: run.runId, revision: run.revision, status: run.status },
    current,
    automatic: state.autoTransition ?? true,
    dispatch: { commandArgs: dispatch },
    ...(summary.actions.length
      ? {
          inspection: {
            commandArgs: ['comet', 'state', 'next', change, '--details', '--json'],
            actionInputPath: 'data.run.actions[matching id].input',
            instruction:
              '仅确需未给出的原始输入时读取。inputSummary 仅供宿主理解当前工作，不能替代原 Action input 提交或计算 inputHash；inputHash 始终绑定原始完整输入。',
          },
        }
      : {}),
  };
  function result(
    continuation: CliActionContinuation & {
      skill?: string;
      request?: unknown;
      completion?: {
        commandArgs: readonly string[];
        requiredInputs: readonly string[];
        instruction: string;
      };
    },
  ) {
    return { ...base, ...continuation };
  }
  const command = (operation: string, ...args: string[]) => [
    'comet',
    'state',
    operation,
    change,
    ...args,
    '--json',
  ];
  if (run.status === 'completed' || run.status === 'cancelled')
    return result({
      mode: 'done',
      commandArgs: null,
      requiredInputs: [],
      instruction: run.status === 'cancelled' ? 'Run 已取消，不再安排执行。' : 'Run 已完成。',
    });
  if (run.status === 'failed')
    return result({
      mode: 'reconcile',
      commandArgs: null,
      requiredInputs: [],
      instruction: run.reason ?? 'Run 已失败；没有可自动执行的后继。',
    });
  const action =
    nextAction && 'actionId' in nextAction
      ? run.actions.find((entry) => entry.id === nextAction.actionId)
      : undefined;
  if (action?.status === 'running')
    return result({
      mode: 'wait',
      commandArgs: null,
      requiredInputs: [],
      instruction: '等待原领取方返回本次执行结果；不要重新派发或把仍在运行的工作判为 unknown。',
    });
  if (action?.status === 'unknown')
    return result({
      mode: 'reconcile',
      commandArgs: command('check', state.phase, '--recover'),
      requiredInputs: ['原领取方本次尝试的真实结果或确未执行证据'],
      instruction: '核对原 claim 和实际产物。结果未明前不得重放；仅有原始可信结果时补交 outcome。',
    });
  if (observation.openApprovalHash && state.phase === 'open')
    return result({
      mode: 'ask',
      commandArgs: [
        'comet',
        'guard',
        change,
        'open',
        '--apply',
        '--approval-hash',
        observation.openApprovalHash,
        '--json',
      ],
      requiredInputs: ['用户明确批准本次 Open 产物与范围'],
      instruction: `展示当前 Open 产物并取得明确批准。批准仅绑定 contentHash=${observation.openApprovalHash}；内容变化后重新预检和确认。`,
    });
  if (nextAction?.kind === 'decision') {
    const wait = current.waits.find((entry) => entry.id === nextAction.waitId)!;
    const operation = wait.stepId.endsWith('.design.confirm')
      ? 'decide-design'
      : wait.stepId.endsWith('.build.confirm')
        ? 'decide-build'
        : wait.stepId.endsWith('.build.escalation-confirm')
          ? 'decide-escalation'
          : wait.stepId.endsWith('.archive.confirm')
            ? 'decide-archive'
            : wait.stepId.endsWith('.build.plan-ready')
              ? 'continue-plan'
              : null;
    return result({
      mode: 'ask',
      commandArgs: operation
        ? command(
            operation,
            '--proposal-hash',
            wait.proposalHash,
            ...(operation === 'continue-plan' ? [] : ['--choice', '<user-choice>']),
          )
        : dispatch,
      requiredInputs: [`用户对当前 proposalHash 的明确决定：${wait.choices.join('|')}`],
      instruction: '展示 current.waits 中的当前提案和选项；取得本次决定后才执行请求。',
      request: wait.request,
    });
  }
  if (nextAction?.kind === 'evidence') {
    const evidence = current.evidenceWaits.find((entry) => entry.id === nextAction.evidenceId)!;
    return result({
      mode: 'execute',
      commandArgs: dispatch,
      requiredInputs: ['request-json-file', '真实 evidence ref、contentHash 和 submissionId'],
      instruction:
        '提交当前等待项的真实证据；检查证据必须来自原 Runtime 收据，不重跑已完成的检查。',
      request: evidence.request,
    });
  }
  if (!action)
    return result({
      mode: 'reconcile',
      commandArgs: null,
      requiredInputs: [],
      instruction: '当前 Run 没有可执行的 Action 或 Wait；核对 Run 状态，不从 phase 推测下一工作。',
    });
  if (action.type === 'call_tool') {
    if (action.ref === 'classic-open-revalidate')
      return result({
        mode: 'execute',
        commandArgs: dispatch,
        requiredInputs: ['request-json-file'],
        instruction: '由原 Open 执行器重新校验已批准的产物；授权或来源变化仍由 Runtime 拒绝。',
        request: {
          operation: 'execute',
          ...identity,
          actionId: action.id,
          executorId: 'comet-classic-open-revalidate',
        },
      });
    if (action.ref === 'classic-check') {
      const scope = action.stepId.includes('.build.') ? 'build' : 'verify';
      return result({
        mode: 'execute',
        commandArgs: [
          'comet',
          'check',
          'run',
          change,
          scope,
          '--json',
          '--',
          '<program>',
          '<args...>',
        ],
        requiredInputs: ['当前工作区已确认的完整检查 program 与 args'],
        instruction: '执行当前检查 Action；Runtime 会绑定原命令、输入快照和收据，并校验后续证据。',
      });
    }
    if (['classic-archive-preflight', 'classic-archive'].includes(action.ref ?? ''))
      return result({
        mode: 'execute',
        commandArgs: ['comet', 'guard', change, 'archive', '--apply', '--json'],
        requiredInputs: [],
        instruction: '按当前 Run 已记录的归档决定执行；Runtime 在副作用边界重新校验授权和证据。',
      });
    return result({
      mode: 'reconcile',
      commandArgs: null,
      requiredInputs: [],
      instruction: `当前工具 ${action.ref ?? action.type} 没有内置 CLI 映射；使用该应用固定的执行器契约。`,
    });
  }
  const skill =
    action.type === 'invoke_skill' && nextAction && 'ref' in nextAction
      ? nextAction.ref
      : undefined;
  let commandArgs: string[] | null = null;
  let requiredInputs: string[] = [];
  let preparation = '完成当前 Skill 的工作后，再提交当前 Action。';
  if (action.type === 'invoke_skill') {
    if (action.stepId.endsWith('.open')) {
      commandArgs = ['comet', 'guard', change, 'open', '--json'];
      requiredInputs = ['当前 change 的真实 OpenSpec 需求产物'];
      preparation = '先完成 Open 需求产物，再预检并取得本次产物的用户批准。';
    } else if (action.stepId.endsWith('.design.handoff')) {
      commandArgs = command('propose-design', '--proposal', '<proposal>');
      requiredInputs = ['proposal: 候选方案、取舍、风险和已授权的 Spec Patch'];
      preparation = '先核对来源并准备真实候选方案；提交后等待当前提案的用户决定。';
    } else if (action.stepId.endsWith('.design.document')) {
      const approval = approvals.find(
        (wait) => wait.stepId.endsWith('.design.confirm') && wait.decision?.choice === 'approved',
      );
      commandArgs = command(
        'complete-design',
        '--design-doc',
        '<design-doc-ref>',
        '--approval-hash',
        approval?.proposalHash ?? '<approval-hash>',
      );
      requiredInputs = [
        'design-doc-ref: 按已批准方案完成的真实 Design Doc',
        ...(!approval ? ['approval-hash: 当前方案的已批准哈希'] : []),
      ];
      preparation = '先按当前批准方案保存 Design Doc；Runtime 会重新校验批准和来源。';
    } else if (action.stepId.endsWith('.build.configure')) {
      commandArgs = command('propose-build', '--file', '<configuration-json>');
      requiredInputs = [
        'configuration-json: 已讨论的 build_mode、tdd_mode、review_mode、subagent_dispatch 与必要的 direct_override',
      ];
      preparation = '准备实际执行配置后提案；提交不会代替用户对当前配置的批准。';
    } else if (action.stepId.endsWith('.build.plan')) {
      commandArgs = command('submit-plan', '--plan', '<plan-ref>');
      requiredInputs = ['plan-ref: 引用当前 Design Doc 和 task IDs 的真实计划'];
      preparation = '先完成当前计划；仅用户明确要求计划完成后暂停时添加 --pause。';
    } else if (action.stepId.endsWith('.build.execute')) {
      commandArgs = command('complete-build');
      requiredInputs = ['当前计划任务的真实实现、必要审查和 tasks.md 完成记录'];
      preparation = '先完成实现与任务验收，再提交 Build 完成；后续真实检查仍须执行。';
    } else if (action.stepId.endsWith('.verify.run')) {
      commandArgs = [
        'comet',
        'guard',
        change,
        'verify',
        '--report',
        '<report-ref>',
        '--apply',
        '--json',
        '--',
        '<program>',
        '<args...>',
      ];
      requiredInputs = ['report-ref: 真实验证与独立审查报告', 'program 与 args: 当前完整验证命令'];
      preparation = '先完成独立验证并保存真实报告；Guard 会预检报告、执行检查并绑定收据。';
    } else if (action.stepId.endsWith('.archive.prepare')) {
      commandArgs = command('propose-archive', '--summary', '<delivery-summary>');
      requiredInputs = [
        'delivery-summary: 当前目标、归档影响与交付摘要；push/pr 还须明确 remote/pr-base 并添加对应参数',
      ];
      preparation = '核对真实验证结论和交付目标后提案；尚未获得归档、push 或 PR 授权。';
    } else if (action.stepId.endsWith('.archive.deliver')) {
      const profile = action.stepId.split('.')[0];
      const approved = run.actionContexts[action.id]?.results[`${profile}.archive.preflight`]
        ?.value as { deliveryAction?: string } | undefined;
      commandArgs = command(
        'complete-delivery',
        '--commit',
        '<commit-sha>',
        ...(approved?.deliveryAction === 'pr' ? ['--pr-url', '<pr-url>'] : []),
      );
      requiredInputs = [
        'commit-sha: 实际归档提交',
        ...(approved?.deliveryAction === 'pr' ? ['pr-url: 已获授权且实际创建的 PR'] : []),
      ];
      preparation =
        '按当前 Action inputSummary 与 approvals 中已批准的目标完成真实归档提交及必要远端交付；仅补交实际结果，不再次归档。';
    }
  }
  return result({
    mode: skill && base.automatic ? 'execute' : 'wait',
    commandArgs: null,
    requiredInputs,
    ...(skill ? { skill } : {}),
    ...(commandArgs
      ? {
          completion: {
            commandArgs,
            requiredInputs,
            instruction: `仅在当前 Skill 的真实工作完成且满足所列前提后提交。${preparation}`,
          },
        }
      : {}),
    instruction: skill
      ? `${base.automatic ? '加载' : '等待用户手动加载'} ${skill}，仅完成 ${action.stepId} 的当前工作，并沿用本次 Run 与工作区。${preparation}`
      : '此 Action 需要应用声明的宿主执行器；不要把工具或子流程引用当作 Skill。',
  });
}

/** 查询与写入共用同一响应；使用调用方已经读取或提交的 Run，绝不再次 inspect 推进状态。 */
export async function classicSdkEntryData(
  change: string,
  inspected: { run: WorkflowRun; projectRoot: string },
  details = false,
  observation: { openApprovalHash?: string } = {},
) {
  const { run, projectRoot } = inspected;
  const state = run.state as unknown as ClassicState;
  const base = {
    change,
    runtimeFormat: 'sdk' as const,
    phase: state.phase,
    configuration: state,
    projectRoot,
    workspace: { projectRoot },
    run: classicSdkRunSummary(run, details),
    nextAction: classicSdkNextAction(run),
    continuation: classicSdkContinuation(run, projectRoot, change, observation),
  };
  try {
    const { directory } = await resolveClassicChangeDirectory(change, projectRoot);
    const recovery = await classicRecoveryContext(projectRoot, directory, state, details, null);
    const actionRecovery = run.actions.some((action) => action.status === 'unknown')
      ? await inspectClassicSdkActionRecovery(projectRoot, run)
      : null;
    return {
      ...base,
      changeDir: recovery.changeDir,
      layout: recovery.layout,
      artifactRefs: recovery.artifactRefs,
      configurationReadiness: recovery.configurationReadiness,
      taskState: recovery.taskState,
      nextTask: recovery.nextTask,
      planMapping: recovery.planMapping,
      coordination: recovery.coordination,
      delivery: recovery.delivery,
      requiredFiles: recovery.requiredFiles,
      ...(actionRecovery ? { recovery: actionRecovery } : {}),
    };
  } catch (error) {
    // 附加文件摘要失败不能把已提交的 mutation 误报为未提交。
    return {
      ...base,
      contextWarning: {
        code: 'CLASSIC_CONTEXT_UNAVAILABLE',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** 仅错误路径补读已存在的权威 Run；不恢复检查点、不重试 mutation。 */
export async function classicSdkErrorData(projectRoot: string, change: string) {
  try {
    const current = await findClassicSdkWorkspace(projectRoot, change, { readOnly: true });
    return current ? await classicSdkEntryData(change, current) : null;
  } catch {
    // 保留原始失败；所有权或 Run 本身无效时不能伪造可执行续行。
    return null;
  }
}

export interface ClassicSdkGuardAttempt {
  actionIds: string[];
  evidenceIds: string[];
}

/** Guard 覆盖的工作身份；配置、提案、交付等其他合法工作不因此被阻塞。 */
export function classicSdkGuardAttempt(
  run: {
    actions: readonly { id: string; stepId: string; status: string }[];
    evidenceWaits?: readonly { id: string; stepId: string; status: string }[];
  },
  phase: string,
  previous?: ClassicSdkGuardAttempt,
): ClassicSdkGuardAttempt {
  const steps: Record<string, readonly string[]> = {
    open: ['open', 'open.evidence', 'open.revalidate'],
    design: ['design.document', 'design.evidence'],
    build: ['build.execute', 'build.check', 'build.check.evidence'],
    verify: ['verify.run', 'verify.report.evidence', 'verify.check', 'verify.check.evidence'],
    archive: ['archive.preflight', 'archive.execute'],
  };
  const matches = (entry: { stepId: string; status: string }) =>
    ['pending', 'running', 'unknown'].includes(entry.status) &&
    (steps[phase] ?? []).includes(entry.stepId.slice(entry.stepId.indexOf('.') + 1));
  return {
    actionIds: [
      ...new Set([
        ...(previous?.actionIds ?? []),
        ...run.actions.filter(matches).map((entry) => entry.id),
      ]),
    ],
    evidenceIds: [
      ...new Set([
        ...(previous?.evidenceIds ?? []),
        ...(run.evidenceWaits ?? []).filter(matches).map((entry) => entry.id),
      ]),
    ],
  };
}

/** 同一工作仍被明确阻塞时，不能把其失败命令作为自动续行再次发出。 */
export function classicSdkBlockedContinuation(
  continuation: ReturnType<typeof classicSdkContinuation>,
  attempted: ClassicSdkGuardAttempt,
  message: string,
) {
  const blockedAction =
    'actionId' in continuation &&
    typeof continuation.actionId === 'string' &&
    attempted.actionIds.includes(continuation.actionId);
  const blockedEvidence =
    'evidenceId' in continuation &&
    typeof continuation.evidenceId === 'string' &&
    attempted.evidenceIds.includes(continuation.evidenceId);
  if (continuation.mode !== 'execute' || (!blockedAction && !blockedEvidence)) return continuation;
  return {
    ...continuation,
    mode: 'reconcile' as const,
    commandArgs: null,
    completion: undefined,
    blockers: [
      {
        code: 'CLASSIC_GUARD_BLOCKED',
        message,
        ...(blockedAction && 'actionId' in continuation ? { actionId: continuation.actionId } : {}),
        ...(blockedEvidence && 'evidenceId' in continuation
          ? { evidenceId: continuation.evidenceId }
          : {}),
      },
    ],
    instruction: `当前工作仍被阻塞：${message}。先修复或核对所列问题；不要重复原失败命令，也不要重放已领取的工作。`,
  };
}
