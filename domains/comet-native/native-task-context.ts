import type { NativePortableState } from './native-portable-types.js';
import { taskContextRequest } from '../workflow-contract/task-context.js';
import type { WorkflowRun, RuntimeValue } from '../engine/runtime.js';
import path from 'node:path';

/** 把用户的旧报告当成待核对的输入，而非新候选的验证结论。 */
export function nativeUserEditedReportContext(
  state: NativePortableState,
  run: Readonly<WorkflowRun>,
): RuntimeValue | null {
  const index = run.actions
    .map((action) => action.stepId === 'repair.implementation' && action.status === 'succeeded')
    .lastIndexOf(true);
  const revision = run.actions[index];
  if (
    index < 0 ||
    (revision?.outcome?.output as { driftKind?: string } | undefined)?.driftKind !==
      'report-drift' ||
    run.actions
      .slice(index + 1)
      .some((action) => action.stepId === 'verify.report' && action.status === 'succeeded')
  )
    return null;
  const root = (run.input as { artifactRootRef?: unknown }).artifactRootRef;
  if (typeof root !== 'string') return null;
  return {
    ref: path.posix.join(
      root.replaceAll('\\', '/'),
      'comet',
      'changes',
      state.name,
      'verification.md',
    ),
    instruction:
      state.language === 'zh-CN'
        ? '读取用户修改的原验证报告，核对其补充并作为待验证输入；不得将旧报告当作新候选已通过的证据。'
        : 'Read the user-edited verification report and assess its notes as inputs; do not treat the old report as proof that the new candidate passed.',
  };
}

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
    ...(nativeUserEditedReportContext(state, run)
      ? { userEditedReport: nativeUserEditedReportContext(state, run) }
      : {}),
    candidateHandling: 'review-existing-work-first',
    instruction:
      state.language === 'zh-CN'
        ? '先核对并保留用户当前修改。若现有工作已满足已确认需求，原样提交后继候选，无需为推进流程重新写入；确有遗漏时只修复遗漏。旧检查由 Runtime 判断复用，新候选仍需独立验收全部验收项。'
        : 'Inspect and preserve the user’s current changes first. If the existing work satisfies the approved requirements, submit it unchanged as the successor candidate; do not rewrite files merely to advance. Repair only actual gaps. Runtime decides check reuse and the successor still requires independent verification of every acceptance criterion.',
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
