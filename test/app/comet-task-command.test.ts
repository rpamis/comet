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

  it('shares identity during the task request and refreshes it on the next invocation', async () => {
    const { resolveProjectName, resolveStableProjectId } =
      await import('../../platform/paths/project-identity.js');
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');
    let remote = 'https://example.com/first.git';
    const runGit = vi.fn(() => remote);
    const identities: string[] = [];
    collectCometPluginContext.mockImplementation(async (root: string) => {
      identities.push(resolveStableProjectId(root, { runGit }));
      await Promise.resolve();
      expect(resolveProjectName(root, { runGit })).toBe(
        remote.includes('first') ? 'first' : 'second',
      );
      return [];
    });
    await cometTaskCommand('D:/repo', { task: 'Inspect the project' });
    remote = 'https://example.com/second.git';
    await cometTaskCommand('D:/repo', { task: 'Inspect the project' });
    expect(identities[0]).not.toBe(identities[1]);
    expect(runGit).toHaveBeenCalledTimes(2);
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
        learningCheck: 'not-run',
      }),
    );
    expect(recordCometWorkflowResult.mock.calls[0]?.[0]).not.toHaveProperty('summary');
    expect(recordCometWorkflowResult.mock.calls[0]?.[0]).not.toHaveProperty('userEvidence');
    expect(result.context).toEqual([]);
  });

  it('records an explicit task-end learning check in the completion checkpoint', async () => {
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');
    recordCometWorkflowResult.mockResolvedValueOnce({ submissionVerified: false });
    const first = await cometTaskCommand('D:/repo', {
      task: '完成变更',
      complete: true,
      workflow: 'native',
      change: 'change-learning-check',
      learningCheck: 'submitted',
      json: true,
    });
    expect(first.learningCheckVerified).toBe(false);

    await cometTaskCommand('D:/repo', {
      task: '完成变更',
      complete: true,
      workflow: 'native',
      change: 'change-learning-check',
      learningCheck: 'no-observation',
      json: true,
    });

    expect(recordCometWorkflowResult).toHaveBeenCalledWith(
      expect.objectContaining({ learningCheck: 'no-observation' }),
    );
    expect(
      (
        await cometTaskCommand('D:/repo', {
          task: '完成变更',
          complete: true,
          workflow: 'native',
          change: 'change-learning-check-2',
          learningCheck: 'no-observation',
          json: true,
        })
      ).learningCheck,
    ).toBe('no-observation');
  });

  it('warns on stderr when a submitted learning check has no matching observation', async () => {
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const observeWarnings = () =>
      error.mock.calls.filter(([message]) => String(message).includes('comet memory observe'));
    try {
      recordCometWorkflowResult.mockResolvedValueOnce({ submissionVerified: false });
      const first = await cometTaskCommand('D:/repo', {
        task: '完成变更',
        complete: true,
        workflow: 'native',
        change: 'change-learning-warning',
        learningCheck: 'submitted',
        json: true,
      });
      expect(observeWarnings()).toHaveLength(1);
      expect(first.projectMemory).toMatchObject({
        count: expect.any(Number),
        reminder: expect.stringContaining('comet knowledge remember'),
      });
      expect(
        error.mock.calls.some(([message]) => String(message).includes('Project memory:')),
      ).toBe(true);

      recordCometWorkflowResult.mockResolvedValueOnce({ submissionVerified: true });
      await cometTaskCommand('D:/repo', {
        task: '完成变更',
        complete: true,
        workflow: 'native',
        change: 'change-learning-warning',
        learningCheck: 'submitted',
        json: true,
      });
      expect(observeWarnings()).toHaveLength(1);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"learningCheckVerified": true'));
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
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

  it('records the concrete adoption decision and actual verification without running a command', async () => {
    const { cometTaskCommand } = await import('../../app/commands/comet-task.js');
    await cometTaskCommand('D:/repo', {
      task: 'Fix router',
      application: 'application-1',
      outcome: 'used-successfully',
      decision: 'Rebuild the entry bundle',
      verification: 'pnpm check:generated',
      verificationResult: 'passed',
      json: true,
    });
    expect(recordCometContextOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: {
          decision: 'Rebuild the entry bundle',
          verification: { command: 'pnpm check:generated', success: true },
        },
      }),
    );
    await expect(
      cometTaskCommand('D:/repo', {
        task: 'Fix router',
        application: 'application-1',
        outcome: 'used-successfully',
        decision: 'Rebuild',
      }),
    ).rejects.toThrow('Adoption evidence requires');
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
