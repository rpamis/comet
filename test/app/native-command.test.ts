import { afterEach, describe, expect, it, vi } from 'vitest';

const runNativeCli = vi.fn();
const recordCometWorkflowResult = vi.fn();
const collectCometPluginContext = vi.fn();

vi.mock('../../domains/comet-native/native-cli.js', () => ({ runNativeCli }));
vi.mock('../../domains/comet-entry/plugin-context.js', () => ({
  recordCometWorkflowResult,
  collectCometPluginContext,
}));

describe('Native command facade', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runNativeCli.mockReset();
    recordCometWorkflowResult.mockReset();
    collectCometPluginContext.mockReset();
  });

  it('forwards exact argv, stdout, stderr, and exit code', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    runNativeCli.mockResolvedValue({
      exitCode: 73,
      stdout: 'native output\n',
      stderr: 'native error',
    });
    const { runNativeFacade } = await import('../../app/commands/native.js');
    const argv = ['next', 'change-name', '--summary', 'done', '--json', '--artifact', 'a.ts'];

    const result = await runNativeFacade(argv);

    expect(runNativeCli).toHaveBeenCalledWith(argv);
    expect(stdout).toHaveBeenCalledWith('native output\n');
    expect(stderr).toHaveBeenCalledWith('native error\n');
    expect(result).toBe(73);
  });

  it('preserves argv order through the single Commander registration', async () => {
    runNativeCli.mockResolvedValue({ exitCode: 73 });
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    process.argv = [
      process.execPath,
      'comet',
      'native',
      'next',
      'change-name',
      '--summary',
      'done',
      '--artifact',
      'a.ts',
      '--json',
    ];
    process.exitCode = undefined;
    vi.resetModules();
    try {
      await import('../../app/cli/index.js');
      await vi.waitFor(() => {
        expect(runNativeCli).toHaveBeenCalledWith([
          'next',
          'change-name',
          '--summary',
          'done',
          '--artifact',
          'a.ts',
          '--json',
        ]);
        expect(process.exitCode).toBe(73);
      });
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });

  it('records a successful archive through the shared plugin bridge', async () => {
    runNativeCli.mockResolvedValue({ exitCode: 0, stdout: 'archived\n', stderr: '' });
    const { runNativeFacade } = await import('../../app/commands/native.js');

    await runNativeFacade(['archive', 'change-name', '--project-root', 'D:/repo']);

    expect(recordCometWorkflowResult).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: expect.stringMatching(/D:[\\/]repo/u),
        workflow: 'native',
        changeId: 'change-name',
        command: 'archive',
        success: true,
      }),
    );
  });

  it('automatically collects task context before a workflow command', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    collectCometPluginContext.mockResolvedValue([
      { pluginId: 'comet.personal-memory', text: '使用中文回复' },
    ]);
    runNativeCli.mockResolvedValue({ exitCode: 0, stdout: 'done\n', stderr: '' });
    const { runNativeFacade } = await import('../../app/commands/native.js');

    await runNativeFacade([
      'next',
      'change-name',
      '--comet-task',
      '完成服务端改动',
      '--comet-path',
      'src/server.ts',
      '--comet-phase',
      'verify',
    ]);

    expect(runNativeCli).toHaveBeenCalledWith(['next', 'change-name']);
    expect(collectCometPluginContext).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ task: '完成服务端改动', path: 'src/server.ts', phase: 'verify' }),
    );
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('使用中文回复'));
    expect(recordCometWorkflowResult.mock.calls[0]?.[0]).not.toHaveProperty('summary');
    expect(recordCometWorkflowResult.mock.calls[0]?.[0]).not.toHaveProperty('userEvidence');
  });

  it('records verification commands as verification lifecycle events', async () => {
    runNativeCli.mockResolvedValue({ exitCode: 0, stdout: 'verified\n', stderr: '' });
    const { runNativeFacade } = await import('../../app/commands/native.js');

    await runNativeFacade(['check', 'change-name', '--comet-workflow', 'native']);

    expect(recordCometWorkflowResult).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'check',
        eventType: 'verification.completed',
        workflow: 'native',
      }),
    );
  });

  it('records accepted review and recovered failure events from Native state', async () => {
    runNativeCli.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        data: {
          change: {
            phase: 'archive',
            verification: { verdict: 'pass', summary: 'Focused checks now pass.' },
            history: [{ outcome: 'fail' }, { outcome: 'pass' }],
          },
        },
      }),
      stderr: '',
    });
    const { runNativeFacade } = await import('../../app/commands/native.js');

    await runNativeFacade(['next', 'change-name', '--result', 'result.json']);

    expect(recordCometWorkflowResult).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'review.resolved',
        summary: 'Focused checks now pass.',
      }),
    );
    expect(recordCometWorkflowResult).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'failure.resolved',
        summary: 'Focused checks now pass.',
      }),
    );
  });

  it('records accepted review events from raw Native JSON output', async () => {
    runNativeCli.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        change: {
          phase: 'archive',
          verification: { verdict: 'pass', summary: 'Raw Native result passed.' },
          history: [],
        },
      }),
      stderr: '',
    });
    const { runNativeFacade } = await import('../../app/commands/native.js');

    await runNativeFacade(['next', 'change-name', '--result', 'result.json']);

    expect(recordCometWorkflowResult).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'review.resolved',
        summary: 'Raw Native result passed.',
      }),
    );
  });
});
