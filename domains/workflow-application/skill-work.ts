import type { LoadedWorkflowApplication } from './types.js';
import type { WorkflowRun } from '../engine/runtime.js';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

function actualSkillName(root: string, markdown: string): string {
  const frontmatter = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!frontmatter) return path.basename(root);
  const metadata = parseYaml(frontmatter[1]) as { name?: unknown } | null;
  if (metadata?.name === undefined) return path.basename(root);
  if (typeof metadata.name !== 'string' || !metadata.name.trim())
    throw new Error('固定 Skill 的 name 必须是非空文本；保留等待点并修正实际依赖');
  return metadata.name.trim();
}

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

/** 等待用户决定时交付该 Wait 的固定指导；不领取 Action 或替用户提交决定。 */
export function applicationWaitSkillWork(application: LoadedWorkflowApplication, run: WorkflowRun) {
  return run.waits
    .filter((wait) => wait.status === 'pending')
    .flatMap((wait) =>
      application.manifest.bindings
        .filter(
          (binding) =>
            binding.workflowId === run.workflow.id &&
            binding.stepId === wait.stepId &&
            binding.usage === 'guidance',
        )
        .map((binding) => {
          const skill = application.skills.get(binding.skillId)!;
          return {
            waitId: wait.id,
            proposalHash: wait.proposalHash,
            binding,
            skill: {
              id: skill.id,
              name: actualSkillName(skill.root, skill.files['SKILL.md']),
              root: skill.root,
              contentHash: skill.contentHash,
              adapter: skill.adapter,
              files: skill.files,
            },
          };
        }),
    );
}
