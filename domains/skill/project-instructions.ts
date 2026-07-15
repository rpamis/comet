import path from 'path';
import type { SkillLanguageId } from './languages.js';
import {
  mergeManagedMarkdownBlock,
  removeManagedMarkdownBlock,
  type ManagedMarkdownBlockResult,
} from './managed-markdown.js';

export const COMET_AMBIENT_RESUME_TAG = 'comet-ambient-resume';
export const PROJECT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

export interface ProjectInstructionResult {
  files: Array<{ file: string; result: ManagedMarkdownBlockResult }>;
  changed: number;
}

export interface ProjectInstructionRemovalResult {
  files: Array<{ file: string; result: ManagedMarkdownBlockResult }>;
  removed: number;
}

export function renderCometAmbientResumeContent(languageId: SkillLanguageId): string {
  if (languageId === 'zh') {
    return [
      '<!-- Managed by Comet. Edits inside this block may be replaced by comet init/update. -->',
      '<!-- Contract: comet.resume_probe.v2 -->',
      '',
      '## Comet Ambient Resume',
      '',
      '在这个仓库中，开始处理需要改动或调查的任务前，如果可能存在活跃 Comet workflow，把当前用户请求传入只读探针：`comet resume-probe . --stdin --json`。',
      '',
      '- 只信任返回的 `workflow`、`skill` 和 `entrySource`；它们只由项目配置或无配置兼容回退决定。不得扫描或切换另一套 workflow。',
      '- 如果 probe 返回 `auto_resume`，简短说明选中的 active change，并进入 `nextCommand` 指向的永久入口。不要把状态命令当作恢复入口直接推进。',
      '- 如果 probe 返回 `ask_user`，只问一个简短问题并等待用户回复。',
      '- 如果 probe 返回 `out_of_scope` 或 `none`，不要进入 Comet workflow。',
      '- 如果配置或状态无效且没有 `nextCommand`，停止并报告原因；不要猜测另一个 workflow。',
      '- 不能只因为存在 active change 就把无关任务挂到该 change。Native 的未提交改动由 Native 入口检查，不由探针自动归因。',
      '',
    ].join('\n');
  }

  return [
    '<!-- Managed by Comet. Edits inside this block may be replaced by comet init/update. -->',
    '<!-- Contract: comet.resume_probe.v2 -->',
    '',
    '## Comet Ambient Resume',
    '',
    'In this repository, before starting work that may need code changes or investigation, pass the current user request to the read-only probe when a Comet workflow may already be active: `comet resume-probe . --stdin --json`.',
    '',
    '- Trust only the returned `workflow`, `skill`, and `entrySource`; project configuration or the no-config compatibility fallback alone selects them. Do not scan or switch to the other workflow.',
    '- If the probe returns `auto_resume`, briefly state the selected active change and enter the permanent entry in `nextCommand`. Do not treat a state command as the resume entry or advance it blindly.',
    '- If the probe returns `ask_user`, ask one short question and wait.',
    '- If the probe returns `out_of_scope` or `none`, do not enter the Comet workflow.',
    '- If configuration or state is invalid and `nextCommand` is absent, stop and report the reason; do not guess another workflow.',
    '- Never attach unrelated work merely because an active change exists. The Native entry inspects uncommitted work; the probe does not attribute it automatically.',
    '',
  ].join('\n');
}

export async function installCometProjectInstructions(
  projectPath: string,
  languageId: SkillLanguageId,
): Promise<ProjectInstructionResult> {
  const content = renderCometAmbientResumeContent(languageId);
  const files = [];

  for (const file of PROJECT_INSTRUCTION_FILES) {
    const result = await mergeManagedMarkdownBlock(path.join(projectPath, file), {
      tagName: COMET_AMBIENT_RESUME_TAG,
      content,
    });
    files.push({ file, result });
  }

  return {
    files,
    changed: files.filter((entry) => entry.result.changed).length,
  };
}

export async function removeCometProjectInstructions(
  projectPath: string,
): Promise<ProjectInstructionRemovalResult> {
  const files = [];

  for (const file of PROJECT_INSTRUCTION_FILES) {
    const result = await removeManagedMarkdownBlock(
      path.join(projectPath, file),
      COMET_AMBIENT_RESUME_TAG,
    );
    files.push({ file, result });
  }

  return {
    files,
    removed: files.filter((entry) => entry.result.action === 'removed').length,
  };
}
