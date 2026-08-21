import { describe, expect, it, vi } from 'vitest';

const collectCometPluginContext = vi.fn();
const recordCometWorkflowResult = vi.fn();

vi.mock('../../domains/comet-entry/plugin-context.js', () => ({
  collectCometPluginContext,
  recordCometWorkflowResult,
}));

describe('ordinary Comet task host', () => {
  it('uses the shared bridge for start context and completion checkpoint', async () => {
    collectCometPluginContext.mockResolvedValue([
      { pluginId: 'comet.personal-memory', text: '使用中文' },
    ]);
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
    expect(recordCometWorkflowResult.mock.calls[0]?.[0]).not.toHaveProperty('summary');
    expect(recordCometWorkflowResult.mock.calls[0]?.[0]).not.toHaveProperty('userEvidence');
    expect(result.context).toHaveLength(1);
  });
});
