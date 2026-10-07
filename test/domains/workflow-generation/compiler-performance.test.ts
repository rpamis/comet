import { Ajv } from 'ajv';
import { expect, it, vi } from 'vitest';
import {
  hashWorkflowApplicationPlanContent,
  prepareWorkflowApplicationPlan,
  type WorkflowApplicationProposal,
} from '../../../domains/workflow-generation/compiler.js';

it('reuses fixed plan validators while validating every new proposal and full plan', async () => {
  const invalid = { schema: 'unsupported' };
  const prepare = (proposal: unknown) =>
    prepareWorkflowApplicationPlan({
      proposal: proposal as WorkflowApplicationProposal,
      projectRoot: '/unused-project',
      packageRoot: '/unused-package',
    });
  // 无效输入在任何目录访问前被拒绝；先覆盖两种验证模式，再检查重用预算。
  await expect(prepare(invalid)).rejects.toThrow(/组合方案结构无效/);
  await expect(hashWorkflowApplicationPlanContent(invalid)).rejects.toThrow(/组合方案结构无效/);
  const compile = vi.spyOn(Ajv.prototype, 'compile');
  try {
    await expect(prepare(invalid)).rejects.toThrow(/must have required property 'manifest'/);
    await expect(hashWorkflowApplicationPlanContent(invalid)).rejects.toThrow(
      /must have required property 'workflows'/,
    );
    await expect(prepare({ ...invalid, extra: true })).rejects.toThrow(
      /must NOT have additional properties/,
    );
    const proposal: WorkflowApplicationProposal = {
      schema: 'comet.workflow.application.plan.v1',
      manifest: {
        schema: 'comet.workflow.application.v1',
        id: 'plan-budget',
        version: '1',
        base: 'standalone',
        runtimeVersion: '0.4.5',
        entrySkill: 'SKILL.md',
        module: 'custom.mjs',
        skills: [],
        bindings: [],
      },
      modules: {},
      composition: { kind: 'report' },
    };
    // 预览可先装配流程；严格模式始终拒绝空流程，不能借用预览模式的验证结果。
    await expect(prepare(proposal)).rejects.toThrow(/application.mjs 由组合器生成/);
    await expect(
      hashWorkflowApplicationPlanContent({ ...proposal, workflows: [] }),
    ).rejects.toThrow(/must NOT have fewer than 1 items/);
    expect(compile).not.toHaveBeenCalled();
  } finally {
    compile.mockRestore();
  }
});
