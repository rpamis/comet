import {
  defineWorkflow,
  hashRuntimeValue,
  preserveRuntimeExecutionOrigins,
  type DefineWorkflowOptions,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowTransitionHandler,
} from '../engine/runtime.js';
import type { ClassicState } from './classic-state.js';
import { applyClassicTransition } from './classic-transitions.js';

/** 旧版已接受的实际检查仅作历史报告读取，不恢复执行器或校验内容快照。 */
export function acceptedClassicLegacyVerifyCheck(run: Readonly<WorkflowRun>) {
  const state = run.state as unknown as ClassicState;
  const verifier = [...run.actions]
    .reverse()
    .find((a) => a.stepId === state.workflow + '.verify.run');
  const check = [...run.actions]
    .reverse()
    .find((a) => a.stepId === state.workflow + '.verify.check');
  const evidence = run.evidenceWaits
    ?.slice()
    .reverse()
    .find((w) => w.stepId === state.workflow + '.verify.check.evidence');
  if (
    !verifier ||
    !check ||
    check.executionOrigin?.workflow.version !== '1' ||
    check.status !== 'succeeded' ||
    check.outcome?.status !== 'succeeded' ||
    evidence?.status !== 'resolved' ||
    evidence.results[check.stepId]?.sequence !== run.actionContexts[check.id]?.sequence ||
    run.actionContexts[check.id]?.results[verifier.stepId]?.sequence !==
      run.actionContexts[verifier.id]?.sequence
  )
    return null;
  const value = check.outcome.output as {
    scope?: string;
    exitCode?: number;
    tier?: string;
    argv?: string[];
    cwd?: string;
    receiptRef?: string;
    contentHash?: string;
    deliveryInputs?: Record<string, string>;
  };
  if (
    value.scope !== 'verify' ||
    value.exitCode !== 0 ||
    value.tier !== 'full' ||
    !Array.isArray(value.argv) ||
    !value.argv.length ||
    typeof value.receiptRef !== 'string' ||
    typeof value.contentHash !== 'string' ||
    evidence.receipt?.ref !== value.receiptRef ||
    evidence.receipt.contentHash !== value.contentHash
  )
    return null;
  return { action: check, output: value };
}

/** 升级旧业务记录，不加载旧检查执行器，也不重放检查命令。 */
export function upgradeClassicRun(
  saved: WorkflowRun,
  workflow: DefineWorkflowOptions,
  transitionHandler?: WorkflowTransitionHandler,
): WorkflowRun {
  const definition = defineWorkflow(workflow),
    hash = hashRuntimeValue(definition);
  if (saved.workflow.version === definition.version && saved.workflow.hash === hash) return saved;
  if (saved.workflow.version === definition.version)
    throw new Error('Classic 当前 Run 的 definition hash 不匹配；不能作为旧业务数据重新绑定。');
  if (!['1', '2'].includes(saved.workflow.version) || saved.workflow.id !== definition.id)
    throw new Error('Classic Run 不属于可升级的内置协议');
  const next = preserveRuntimeExecutionOrigins(saved);
  const exists = (id: string) => Object.hasOwn(definition.steps, id);
  const retired = new Set<string>();
  for (const a of next.actions)
    if (!exists(a.stepId) && ['pending', 'running', 'unknown'].includes(a.status)) {
      retired.add(a.stepId);
      a.status = 'cancelled';
      a.reason = '旧检查调度已移交 Agent 平台；原进程结果未确认，不代表已经停止或通过。';
    }
  for (const w of [...next.waits, ...(next.evidenceWaits ?? [])])
    if (!exists(w.stepId) && w.status === 'pending') {
      retired.add(w.stepId);
      w.status = 'cancelled';
    }
  const oldReady = next.ready;
  next.ready = oldReady.filter((t) => exists(t.to) && (t.from === null || exists(t.from)));
  for (const t of oldReady)
    if (!exists(t.to) || (t.from !== null && !exists(t.from))) retired.add(t.to);
  if (saved.status === 'failed' && saved.reason?.startsWith('ACTION_FAILED: ')) {
    const step = saved.reason.slice(15);
    if (!exists(step)) retired.add(step);
  }
  const state = next.state as unknown as ClassicState;
  // 旧 Verify 的报告尚未包含平台检查结果时，交还原业务验收；不把退休检查标记为通过。
  if (
    saved.workflow.version === '1' &&
    state.phase === 'verify' &&
    next.evidenceWaits?.some(
      (w) => w.status === 'pending' && w.stepId.endsWith('.verify.report.evidence'),
    )
  ) {
    for (const w of next.evidenceWaits)
      if (w.status === 'pending' && w.stepId.endsWith('.verify.report.evidence')) {
        w.status = 'cancelled';
        retired.add(w.stepId);
      }
  }
  const active =
    next.actions.some((a) => ['pending', 'running', 'unknown'].includes(a.status)) ||
    next.waits.some((w) => w.status === 'pending') ||
    next.evidenceWaits?.some((w) => w.status === 'pending');
  if (
    retired.size &&
    !active &&
    !next.ready.length &&
    !['completed', 'cancelled'].includes(saved.status)
  ) {
    const builder = [...next.actions]
      .reverse()
      .find((a) => a.stepId === state.workflow + '.build.execute' && a.status === 'succeeded');
    if (!builder) throw new Error('旧 Classic Run 缺少已接受的 Build 来源，原记录保持不变。');
    const transition =
      state.phase === 'build' && transitionHandler
        ? transitionHandler.apply({
            run: next,
            event: { kind: 'action-outcome', stepId: builder.stepId, outcome: builder.outcome! },
          })
        : undefined;
    if (transition) next.state = transition.state;
    else if (state.phase === 'build')
      next.state = applyClassicTransition(state, 'build-complete')
        .classic as unknown as RuntimeValue;
    const context = next.actionContexts[builder.id];
    for (const target of transition?.next ?? [state.workflow + '.verify.run'])
      next.ready.push({
        from: builder.stepId,
        to: typeof target === 'string' ? target : target.stepId,
        ...(typeof target === 'string' ? {} : { activation: target.input }),
        results: {
          ...context.results,
          [builder.stepId]: { sequence: context.sequence, value: builder.outcome!.output },
        },
      });
    next.status = 'running';
    delete next.reason;
  }
  next.workflow = { id: definition.id, version: definition.version, hash };
  for (const key of Object.keys(next.definitionHashes))
    if (JSON.parse(key)[0] === definition.id) delete next.definitionHashes[key];
  next.definitionHashes[JSON.stringify([definition.id, definition.version])] = hash;
  return next;
}
