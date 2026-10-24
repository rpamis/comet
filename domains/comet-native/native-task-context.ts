import type { NativePortableState } from './native-portable-types.js';
import { taskContextRequest } from '../workflow-contract/task-context.js';
import type { WorkflowRun, RuntimeValue } from '../engine/runtime.js';

/** 修复交接使用验收偏差与原始证据引用，不再次生成 Shape 或转述 Builder 自评。 */
export function nativeBuilderRepairContext(
  state: NativePortableState,
  run: Readonly<WorkflowRun>,
): RuntimeValue {
  const previousCandidateId = state.builder_handoff?.candidate_id ?? null;
  const checks = new Map<string, RuntimeValue>();
  for (const action of run.actions) {
    if (!['verify.checks', 'verify.requested-checks'].includes(action.stepId) || !action.outcome)
      continue;
    const output = action.outcome.output as {
      candidateId?: string;
      checks?: Array<{ id: string; status: string; logRef: string; inputScope?: { kind: string } }>;
    } | null;
    if (output?.candidateId !== previousCandidateId) continue;
    for (const check of output.checks ?? [])
      checks.set(check.id, {
        id: check.id,
        status: check.status,
        actionId: action.id,
        logRef: check.logRef,
        inputScope: check.inputScope?.kind ?? 'project',
      });
  }
  const verifier = [...run.actions]
    .reverse()
    .find((action) => action.stepId === 'verify.verifier' && action.status === 'succeeded');
  return {
    schema: 'comet.native.repair-context.v1',
    previousCandidateId,
    shapeConfirmationHash: state.shape_confirmation_hash ?? null,
    unresolvedAcceptanceIds: state.loop.previous_unresolved_ids,
    previousVerifierActionId: verifier?.id ?? null,
    previousChecks: [...checks.values()],
    instruction:
      state.language === 'zh-CN'
        ? '保留已确认需求，结合当前差异修复未通过的验收项并提交后继候选。旧检查只作为原始证据引用，由 Runtime 判断哪些仍可复用；新候选仍需独立验收全部验收项。'
        : 'Preserve the approved requirements. Repair unresolved acceptance using the current diff and submit a successor candidate. Prior checks are evidence references; only the Runtime decides reuse. Independently verify every acceptance criterion for the new candidate.',
  };
}

/** 只描述宿主何时获取上下文；不在状态读取或 Guard 中执行检索。 */
export function nativeTaskContextRequest(options: {
  phase: NativePortableState['phase'];
  language: NativePortableState['language'];
  projectRoot?: string;
  sessionId?: string;
  name?: string;
}) {
  return taskContextRequest({
    ...options,
    workflow: 'native',
    change: options.name,
    instruction:
      options.language === 'zh-CN'
        ? '原始请求缺失时从当前 brief 恢复目标。向 Builder、Verifier 或子任务交接时不转交 Builder 的自评结论，保留独立只读验收要求。'
        : 'Recover a missing task goal from the current brief. Hand off to the Builder, Verifier or child without Builder self-assessment, preserving independent read-only verification.',
  });
}
