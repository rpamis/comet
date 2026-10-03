import {
  hashRuntimeValue,
  RuntimeProtocolError,
  type RuntimeAction,
  type RuntimeExecutor,
  type RuntimeInvocationContext,
  type WorkflowRun,
} from '../engine/runtime.js';
import type {
  AdaptedSkill,
  ApplicationSkillBinding,
  LoadedWorkflowApplication,
  SkillExecutionHost,
} from './types.js';

type SkillExecutionApplication = Pick<LoadedWorkflowApplication, 'manifest' | 'skills'>;

/** 核对本次激活的共享资源；图中跨轮互达不能证明当前 Action 串行。 */
export function assertApplicationSkillExecutionScope(
  application: SkillExecutionApplication,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): void {
  const scopes = (candidate: Readonly<RuntimeAction>) =>
    application.manifest.bindings
      .filter(
        (binding) =>
          binding.workflowId === run.workflow.id &&
          binding.stepId === candidate.stepId &&
          binding.usage === 'action',
      )
      .flatMap((binding) => {
        const skill = application.skills.get(binding.skillId);
        return skill?.adapter.sideEffect !== 'read' ? (skill?.adapter.scope ?? []) : [];
      });
  const current = scopes(action);
  if (!current.length) return;
  for (const other of run.actions) {
    if (
      other.id !== action.id &&
      ['pending', 'running', 'unknown'].includes(other.status) &&
      scopes(other).some((scope) => current.includes(scope))
    )
      throw new RuntimeProtocolError(
        'COMMAND_REJECTED',
        `Skill 写入范围存在并行冲突：${action.stepId} / ${other.stepId}；请隔离范围或声明串行依赖`,
      );
  }
}

function requiredBinding(
  application: SkillExecutionApplication,
  action: Readonly<RuntimeAction>,
  run: Readonly<WorkflowRun>,
): { binding: ApplicationSkillBinding; skill: AdaptedSkill } {
  const bindings = application.manifest.bindings.filter(
    (binding) =>
      binding.workflowId === run.workflow.id &&
      binding.stepId === action.stepId &&
      binding.usage === 'action',
  );
  const binding = bindings[0];
  const skill = binding ? application.skills.get(binding.skillId) : undefined;
  if (
    bindings.length !== 1 ||
    !binding ||
    !skill ||
    action.type !== 'invoke_skill' ||
    action.ref !== binding.skillId
  )
    throw new RuntimeProtocolError('EXECUTOR_UNSUPPORTED', 'Action 未绑定到唯一的真实 Skill');
  return { binding, skill };
}

/** 宿主执行端口不自行领取或推进；createRuntime.execute 先持久化领取，再调用它。 */
export function createApplicationSkillExecutor(
  application: SkillExecutionApplication,
  host: SkillExecutionHost,
): RuntimeExecutor {
  const preflight = async (
    action: Readonly<RuntimeAction>,
    context?: RuntimeInvocationContext,
    run?: Readonly<WorkflowRun>,
  ) => {
    if (!run) throw new RuntimeProtocolError('INVALID_RUN', 'Skill 执行需要当前 SDK Run');
    const { binding, skill } = requiredBinding(application, action, run);
    assertApplicationSkillExecutionScope(application, run, action);
    skill.validateInput(action.input);
    if (
      skill.adapter.requiredCapabilities.some(
        (capability) => !host.capabilities.includes(capability),
      )
    )
      throw new RuntimeProtocolError('CAPABILITY_REQUIRED', '宿主缺少 Skill 必需能力');
    if (skill.adapter.sideEffect === 'external' && !host.reconcile)
      throw new RuntimeProtocolError(
        'RECONCILIATION_REQUIRED',
        '外部操作没有结果核对适配器，不能执行',
      );
    if (skill.adapter.sideEffect !== 'read') {
      const inherited = binding.authorizationFrom
        ? run.actionContexts[action.id]?.results[binding.authorizationFrom]
        : undefined;
      const wait = run.waits.find(
        (wait) =>
          wait.stepId === binding.authorizationFrom && wait.sequence === inherited?.sequence,
      );
      if (
        !inherited ||
        wait?.status !== 'resolved' ||
        !wait.decision ||
        !(binding.authorizationChoices ?? ['approved']).includes(wait.decision.choice) ||
        wait.decision.proposalHash !== wait.proposalHash ||
        hashRuntimeValue(inherited.value) !==
          hashRuntimeValue({ choice: wait.decision.choice, proposal: wait.proposal })
      )
        throw new RuntimeProtocolError('STALE_PROPOSAL', '此工作缺少父流程的当前批准记录');
    }
    if (!(await host.authorize({ action, run, binding, skill, context })))
      throw new RuntimeProtocolError('COMMAND_REJECTED', '宿主授权不覆盖此 Skill、范围或副作用');
  };
  return {
    id: host.id,
    capabilities: host.capabilities,
    preflight,
    supports: (action) =>
      action.type === 'invoke_skill' &&
      application.manifest.bindings.some(
        (binding) =>
          binding.stepId === action.stepId &&
          binding.skillId === action.ref &&
          binding.usage === 'action',
      ),
    async execute(action, context, run) {
      if (!run) throw new RuntimeProtocolError('INVALID_RUN', 'Skill 执行需要当前 SDK Run');
      const { binding, skill } = requiredBinding(application, action, run);
      const result = await host.invokeSkill({ action, run, binding, skill, context });
      // 已返回的原始结果交给 SDK Schema/业务验证器；拒绝时仍保存 output/artifacts。
      return result;
    },
  };
}

/** 只读取原 Action 的外部结果；不重发操作。调用者按 SDK 原领取协议提交核对后的结果。 */
export async function reconcileApplicationSkill(
  application: LoadedWorkflowApplication,
  host: SkillExecutionHost,
  run: Readonly<WorkflowRun>,
  actionId: string,
  context?: RuntimeInvocationContext,
) {
  const action = run.actions.find((action) => action.id === actionId);
  if (!action || !['running', 'unknown'].includes(action.status))
    throw new RuntimeProtocolError('ACTION_NOT_RUNNING', '只能核对原 running/unknown Action');
  const { skill } = requiredBinding(application, action, run);
  if (!host.reconcile)
    throw new RuntimeProtocolError(
      'RECONCILIATION_REQUIRED',
      '没有外部结果核对能力，保留原 Action 等待处理',
    );
  const result = await host.reconcile({ action, run, skill, context });
  if (result.resolution === 'executed') {
    if (
      result.outcome.actionId !== action.id ||
      result.outcome.attempt !== action.attempt ||
      result.outcome.inputHash !== action.inputHash ||
      result.outcome.claimToken !== action.claim?.token
    )
      throw new RuntimeProtocolError('STALE_ACTION', '核对结果不属于原领取 Action');
  } else if (!result.evidence?.trim())
    throw new RuntimeProtocolError('RECONCILIATION_REQUIRED', '确认未执行必须提供可核对证据');
  return result;
}
