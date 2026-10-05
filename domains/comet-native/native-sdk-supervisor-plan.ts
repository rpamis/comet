import type { NativeChildrenContract } from './native-children-contract.js';
import type { RuntimeAction, WorkflowRun } from '../engine/runtime.js';

/** 历史结果保留在 Run 中；本轮只能使用最近一次 Shape 复核之后的工作事实。 */
export function currentNativeSdkSupervisorActions(
  run: Readonly<WorkflowRun>,
): readonly RuntimeAction[] {
  for (let index = run.actions.length - 1; index >= 0; index--) {
    const action = run.actions[index];
    if (action.stepId === 'shape.revalidate' && action.status === 'succeeded')
      return run.actions.slice(index + 1);
  }
  return run.actions;
}

/** Selects a bounded wave from the confirmed child DAG using only SDK Run facts. */
export function selectNativeSdkReadyChildren(options: {
  contract: NativeChildrenContract;
  integrated: readonly string[];
  active: readonly string[];
  maxParallel: number;
}): string[] {
  if (!Number.isSafeInteger(options.maxParallel) || options.maxParallel < 1) {
    throw new Error('Native Supervisor maxParallel must be a positive integer');
  }
  const known = new Set(options.contract.children.map((child) => child.name));
  const integrated = new Set(options.integrated);
  const active = new Set(options.active);
  if (integrated.size !== options.integrated.length || active.size !== options.active.length) {
    throw new Error('Native Supervisor child facts contain duplicate names');
  }
  for (const name of [...integrated, ...active]) {
    if (!known.has(name)) throw new Error(`Native Supervisor fact names unknown child ${name}`);
    if (integrated.has(name) && active.has(name)) {
      throw new Error(`Native Supervisor child ${name} cannot be both integrated and active`);
    }
  }
  const capacity = Math.max(0, options.maxParallel - active.size);
  return options.contract.children
    .filter(
      (child) =>
        !integrated.has(child.name) &&
        !active.has(child.name) &&
        child.depends_on.every((dependency) => integrated.has(dependency)),
    )
    .slice(0, capacity)
    .map((child) => child.name);
}
