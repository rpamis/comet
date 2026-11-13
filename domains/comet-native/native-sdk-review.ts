import type { RuntimeAction, WorkflowRun } from '../engine/runtime.js';
/** 从已提交的 Builder 结果读取审查要求，后续领取不能省略已有的独立要求。 */
export function nativeSdkRequiresIndependentReview(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): boolean {
  const child = action.stepId === 'supervisor.child.verifier';
  const activation = (
    action.input as {
      activation?: {
        child?: string;
      };
    }
  ).activation;
  const actionIndex = run.actions.findIndex((entry) => entry.id === action.id);
  for (let index = actionIndex - 1; index >= 0; index -= 1) {
    const entry = run.actions[index];
    if (entry.stepId === 'shape.revalidate' || entry.stepId === 'shape.prepare') break;
    if (entry.status !== 'succeeded') continue;
    const output = entry.outcome?.output as {
      requireIndependentReview?: boolean;
    } | null;
    if (output?.requireIndependentReview !== true) continue;
    if (child) {
      const input = (
        entry.input as {
          activation?: {
            child?: string;
          };
        }
      ).activation;
      if (entry.stepId === 'supervisor.child.builder' && input?.child === activation?.child)
        return true;
    } else if (['build.builder', 'supervisor.parent.builder'].includes(entry.stepId)) return true;
  }
  return false;
}
