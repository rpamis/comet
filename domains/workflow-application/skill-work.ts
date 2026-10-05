import type { LoadedWorkflowApplication } from './types.js';
import type { WorkflowRun } from '../engine/runtime.js';

/** 宿主读取实际 Action 的固定指导和执行绑定；仅表示内容交付。 */
export function applicationSkillWork(application: LoadedWorkflowApplication, run: WorkflowRun) {
  return run.actions
    .filter((action) => ['pending', 'running', 'unknown'].includes(action.status))
    .flatMap((action) =>
      application.manifest.bindings
        .filter(
          (binding) => binding.workflowId === run.workflow.id && binding.stepId === action.stepId,
        )
        .map((binding) => {
          const skill = application.skills.get(binding.skillId)!;
          return {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            binding,
            skill: {
              id: skill.id,
              root: skill.root,
              contentHash: skill.contentHash,
              adapter: skill.adapter,
              files: skill.files,
            },
          };
        }),
    );
}
