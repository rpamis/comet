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
      '真实宿主或模型证据',
    ],
    [
      'English',
      'assets/skills/comet-any',
      'After the user explicitly approves the current plan',
      'After the user explicitly approves the current preview',
      'real host or model evidence',
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
});
