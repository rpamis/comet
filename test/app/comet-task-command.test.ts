import { describe, expect, it, vi } from 'vitest';

const collectCometPluginContext = vi.fn();
const collectCometProjectRuleCandidates = vi.fn();
const applyCometProjectRuleAction = vi.fn();
const recordCometWorkflowResult = vi.fn();

vi.mock('../../domains/comet-entry/plugin-context.js', () => ({
  collectCometPluginContext,
  collectCometProjectRuleCandidates,
  applyCometProjectRuleAction,
  recordCometWorkflowResult,
}));

describe('ordinary Comet task host', () => {
  it('uses the shared bridge for start context and completion checkpoint', async () => {
    collectCometPluginContext.mockResolvedValue([
      { pluginId: 'comet.personal-memory', text: '使用中文' },
      { pluginId: 'comet.project-rules', text: '先运行测试' },
    ]);
    collectCometProjectRuleCandidates.mockResolvedValue({
      summary: '当前没有待处理的项目规则候选。',
      candidates: [],
      operations: ['adopt', 'ignore', 'snooze', 'restore'],
    });
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');

    const result = await cometTaskCommand('D:/repo', {
      task: '修复接口',
      path: 'src/api.ts',
      phase: 'build',
      complete: true,
      workflow: 'native',
      change: 'change-1',
      json: true,
    });

    expect(collectCometPluginContext).toHaveBeenCalledWith(expect.stringMatching(/D:[\\/]repo/u), {
      task: '修复接口',
      path: 'src/api.ts',
      phase: 'build',
    });
    expect(recordCometWorkflowResult).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: expect.stringMatching(/D:[\\/]repo/u),
        workflow: 'native',
        changeId: 'change-1',
        command: 'task',
      }),
    );
    expect(result.context).toHaveLength(2);
    expect(result.candidates).toMatchObject({ candidates: [] });
  });

  it('keeps task completion successful when project-rule discovery fails', async () => {
    collectCometPluginContext.mockResolvedValue([]);
    collectCometProjectRuleCandidates.mockRejectedValue(new Error('plugin unavailable'));
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');

    await expect(
      cometTaskCommand('D:/repo', {
        task: '修复接口',
        complete: true,
        workflow: 'native',
        change: 'change-2',
      }),
    ).resolves.toMatchObject({
      candidates: expect.objectContaining({
        candidates: [],
        diagnostics: [
          expect.objectContaining({
            pluginId: 'comet.project-rules',
            code: 'execution-failed',
          }),
        ],
      }),
    });
  });

  it('applies a candidate action as part of the task-end operation', async () => {
    collectCometPluginContext.mockResolvedValue([]);
    applyCometProjectRuleAction.mockResolvedValue({ adopted: true });
    collectCometProjectRuleCandidates.mockResolvedValue({ candidates: [] });
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');

    await cometTaskCommand('D:/repo', {
      task: '修复接口',
      complete: true,
      workflow: 'native',
      change: 'change-3',
      action: 'adopt',
      id: 'candidate-1',
    });

    expect(applyCometProjectRuleAction).toHaveBeenCalledWith(
      expect.stringMatching(/D:[\\/]repo/u),
      'adopt',
      { id: 'candidate-1' },
    );
  });
});
