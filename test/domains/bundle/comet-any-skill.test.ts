import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

describe('comet-any SDK creator guidance', () => {
  it.each([
    [
      '中文',
      'assets/skills-zh/comet-any',
      '用户明确确认当前方案后',
      '用户明确批准当前预览后',
      '真实 Skill 加载',
    ],
    [
      'English',
      'assets/skills/comet-any',
      'After the user explicitly approves the current plan',
      'After the user explicitly approves the current preview',
      'Hook execution',
    ],
  ])(
    '%s keeps the SDK Run, actual plan, current decisions and evidence boundary',
    async (_language, root, planApproval, installApproval, evidenceBoundary) => {
      const skill = await fs.readFile(path.join(root, 'SKILL.md'), 'utf8');
      const reference = await fs.readFile(path.join(root, 'reference/sdk-creation.md'), 'utf8');
      for (const term of [
        'comet creator start',
        'comet creator status',
        'comet creator next',
        'Native',
        'Classic',
        planApproval,
        installApproval,
        evidenceBoundary,
      ])
        expect(skill).toContain(term);
      for (const term of [
        'record-outcome',
        'resolve-wait',
        'runId',
        'attempt',
        'inputHash',
        'claimToken',
        'proposalHash',
        'comet.workflow.application.plan.v1',
      ])
        expect(reference).toContain(term);
      for (const obsolete of [
        'workflow-kernel',
        'comet-five-phase-overlay',
        'authoring DAG',
        '六个职责独立的 subagent',
        'six responsibility-specific subagents',
      ])
        expect(skill + reference).not.toContain(obsolete);
    },
  );

  it('Chinese guidance requires authored business documents, SDK protection and official host installation', async () => {
    const skill = await fs.readFile('assets/skills-zh/comet-any/SKILL.md', 'utf8');
    const reference = await fs.readFile(
      'assets/skills-zh/comet-any/reference/sdk-creation.md',
      'utf8',
    );
    for (const term of [
      'Agent 编写',
      '完整入口 Skill',
      '业务 Rule',
      '执行协议',
      'Guard',
      '正式分发',
      '真实 Skill 加载',
      'Rule 配置',
      'Hook 执行',
      'SDK Run',
      '业务断言',
    ])
      expect(skill).toContain(term);
    for (const term of [
      'proposal.documents',
      'SKILL.md',
      'rules/workflow-guard.md',
      'plan.documents',
      'distribution',
      '不能只看到导出目录就回报完成',
      '不能允许写入 SDK 控制资源',
    ])
      expect(reference).toContain(term);
  });

  it('English guidance uses the same authored documents and preserves current approval boundaries', async () => {
    const skill = await fs.readFile('assets/skills/comet-any/SKILL.md', 'utf8');
    const reference = await fs.readFile(
      'assets/skills/comet-any/reference/sdk-creation.md',
      'utf8',
    );
    for (const term of ['The Agent writes', 'entry Skill', 'business Rule', 'execution protocol'])
      expect(skill).toContain(term);
    for (const term of [
      'proposal.documents',
      'SKILL.md',
      'rules/workflow-guard.md',
      'plan.documents',
    ])
      expect(reference).toContain(term);
    for (const removed of [
      'There is no fixed subagent count',
      'Keep Codex and Claude Code adapter contracts',
      'dollar cap',
    ])
      expect(skill + reference).not.toContain(removed);
  });
});
