import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectCometPluginContext = vi.fn();
const expandCometPluginContext = vi.fn();
const recordCometContextOutcome = vi.fn();
const recordCometWorkflowResult = vi.fn();

vi.mock('../../domains/comet-entry/plugin-context.js', () => ({
  collectCometPluginContext,
  expandCometPluginContext,
  recordCometContextOutcome,
  recordCometWorkflowResult,
}));

describe('ordinary Comet task host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a completion checkpoint without selecting fresh context', async () => {
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

    expect(collectCometPluginContext).not.toHaveBeenCalled();
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
    expect(result.context).toEqual([]);
  });

  it('uses the shared progressive expansion and application outcome interfaces', async () => {
    expandCometPluginContext.mockResolvedValue({
      id: 'knowledge-1',
      title: '验证约束',
      content: '运行 pnpm lint',
      whyApplied: '当前操作匹配',
      sources: [],
      verification: [{ command: 'pnpm lint' }],
    });
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');

    const expansion = await cometTaskCommand('D:/repo', {
      task: '验证变更',
      phase: 'verify',
      operation: 'lint',
      session: 'session-1',
      contextBudget: '1200',
      expandContext: 'knowledge-1',
      json: true,
    });
    expect(expandCometPluginContext).toHaveBeenCalledWith(
      expect.stringMatching(/D:[\\/]repo/u),
      'knowledge-1',
      {
        task: '验证变更',
        phase: 'verify',
        operation: 'lint',
        sessionId: 'session-1',
        charBudget: 1200,
      },
    );
    expect(expansion.expansion).toMatchObject({ id: 'knowledge-1' });
    expect(collectCometPluginContext).not.toHaveBeenCalled();

    await cometTaskCommand('D:/repo', {
      task: '验证变更',
      application: 'application-1',
      outcome: 'used-successfully',
      json: true,
    });
    expect(recordCometContextOutcome).toHaveBeenCalledWith({
      projectRoot: expect.stringMatching(/D:[\\/]repo/u),
      applicationId: 'application-1',
      outcome: 'used-successfully',
    });
    expect(collectCometPluginContext).not.toHaveBeenCalled();
  });

  it('requires application and outcome together', async () => {
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');
    await expect(
      cometTaskCommand('D:/repo', {
        task: '验证变更',
        application: 'application-1',
      }),
    ).rejects.toThrow('--application and --outcome');
  });

  it('reports an unavailable explicit context expansion', async () => {
    expandCometPluginContext.mockResolvedValue(null);
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');
    await expect(
      cometTaskCommand('D:/repo', {
        task: '展开上下文',
        expandContext: 'missing-context',
      }),
    ).rejects.toThrow('Unknown or unavailable context: missing-context');
  });

  it('prints expanded context details in the ordinary text output', async () => {
    expandCometPluginContext.mockResolvedValue({
      id: 'knowledge-1',
      title: '验证约束',
      content: '运行 pnpm lint',
      whyApplied: '当前操作匹配',
      sources: [{ type: 'repository', source: 'AGENTS.md' }],
      verification: [{ command: 'pnpm lint', expected: 'pass' }],
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');

    await cometTaskCommand('D:/repo', {
      task: '展开上下文',
      expandContext: 'knowledge-1',
    });

    expect(output).toHaveBeenCalledWith(expect.stringContaining('验证约束'));
    expect(output).toHaveBeenCalledWith(expect.stringContaining('运行 pnpm lint'));
    expect(output).toHaveBeenCalledWith(expect.stringContaining('AGENTS.md'));
    expect(output).toHaveBeenCalledWith(expect.stringContaining('pnpm lint'));
    output.mockRestore();
  });
});
