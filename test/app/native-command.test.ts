import { afterEach, describe, expect, it, vi } from 'vitest';

const runNativeCli = vi.fn();
const runNativeCliDetailed = vi.fn();
const recordCometWorkflowResult = vi.fn();
const collectCometPluginContext = vi.fn();

vi.mock('../../domains/comet-native/native-cli.js', () => ({ runNativeCli, runNativeCliDetailed }));
vi.mock('../../app/commands/comet-task-context.js', () => ({
  recordCometTaskWorkflowResults: async (results: readonly unknown[]) => {
    for (const result of results) await recordCometWorkflowResult(result);
  },
  collectCometTaskContext: collectCometPluginContext,
}));

const shapeConfirmationArgs = [
  'next',
  'change-name',
  '--summary',
  'User approved the current Shape.',
  '--confirmed',
  '--expected-state-version',
  '2',
  '--expected-action',
  'confirm-shape',
  '--json',
];

describe('Native command facade', () => {
  it('does not learn a claim or repeated outcome without new completed work', async () => {
    runNativeCliDetailed.mockResolvedValue({
      dispatch: { command: 'next', exitCode: 0, workflowCompleted: false },
      output: { exitCode: 0, stdout: '{}' },
      experience: {
        lifecycle: { changedPaths: [], artifactRefs: [] },
        outcome: { reviewResolved: false, failureResolved: false },
      },
    });
    const { runNativeFacade } = await import('../../app/commands/native.js');
    await runNativeFacade(['next', 'change-name', '--session', 'builder']);
    expect(recordCometWorkflowResult).not.toHaveBeenCalled();
    await runNativeFacade(['next', 'change-name', '--comet-task', 'explicit completion']);
    expect(recordCometWorkflowResult).toHaveBeenCalledTimes(1);
  });
  it('does not learn a successful archive from a dry-run preview', async () => {
    runNativeCli.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ready: false }) });
    const { runNativeFacade } = await import('../../app/commands/native.js');
    await runNativeFacade(['archive', 'change-name', '--dry-run', '--project-root', 'D:/repo']);
    expect(recordCometWorkflowResult).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    runNativeCli.mockReset();
    runNativeCliDetailed.mockReset();
    recordCometWorkflowResult.mockReset();
    collectCometPluginContext.mockReset();
  });

  it.each([
    { layout: 'trailing options', argv: shapeConfirmationArgs },
    {
      layout: 'leading options',
      argv: ['--json', '--project-root', 'D:/repo', ...shapeConfirmationArgs.slice(0, -1)],
    },
  ])('passes a Shape approval through without plugin work with $layout', async ({ argv }) => {
    vi.stubEnv('COMET_TASK', undefined);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const output = '{"exitCode":0,"data":{"state":{"phase":"build"}}}\n';
    runNativeCliDetailed.mockResolvedValue({
      dispatch: { command: 'next', exitCode: 0, workflowCompleted: false },
      output: { exitCode: 0, stdout: output },
    });
    const { runNativeFacade } = await import('../../app/commands/native.js');

    expect(await runNativeFacade(argv)).toBe(0);
    expect(runNativeCliDetailed).toHaveBeenCalledExactlyOnceWith(argv);
    expect(stdout).toHaveBeenCalledWith(output);
    expect(collectCometPluginContext).not.toHaveBeenCalled();
    expect(recordCometWorkflowResult).not.toHaveBeenCalled();
  });

  it.each([
    {
      title: 'Supervisor preparation',
      extra: ['--coordination-mode', 'multi-session'],
      workflowCompleted: true,
      reviewResolved: false,
      eventType: 'episode.completed',
    },
    {
      title: 'Compat runner response',
      extra: ['--runner-input', 'response.json'],
      workflowCompleted: undefined,
      reviewResolved: true,
      eventType: 'review.resolved',
    },
    {
      title: 'Compat with a previously selected coordination mode',
      extra: [],
      workflowCompleted: undefined,
      reviewResolved: false,
      eventType: 'episode.completed',
    },
  ])(
    'keeps plugin processing when Shape flags accompany $title',
    async ({ extra, workflowCompleted, reviewResolved, eventType }) => {
      vi.stubEnv('COMET_TASK', undefined);
      runNativeCliDetailed.mockResolvedValue({
        dispatch: { command: 'next', exitCode: 0, workflowCompleted },
        output: { exitCode: 0 },
        experience: {
          lifecycle: { changedPaths: [], artifactRefs: [] },
          outcome: { reviewResolved, failureResolved: false },
        },
      });
      const { runNativeFacade } = await import('../../app/commands/native.js');

      expect(await runNativeFacade([...shapeConfirmationArgs, ...extra])).toBe(0);
      expect(collectCometPluginContext).toHaveBeenCalledOnce();
      expect(recordCometWorkflowResult).toHaveBeenCalledWith(
        expect.objectContaining({ eventType }),
      );
    },
  );

  it.each([
    { layout: 'trailing project root', argv: [...shapeConfirmationArgs, '--project-root', '.'] },
    { layout: 'leading project root', argv: ['--project-root', '.', ...shapeConfirmationArgs] },
    {
      layout: 'command-shaped project root between command and change',
      argv: ['next', '--project-root', 'archive', ...shapeConfirmationArgs.slice(1)],
    },
  ])(
    'records completed work reported by the Runtime for the change with $layout',
    async ({ argv }) => {
      vi.stubEnv('COMET_TASK', undefined);
      runNativeCliDetailed.mockResolvedValue({
        dispatch: { command: 'next', exitCode: 0, workflowCompleted: true },
        output: { exitCode: 0 },
        experience: {
          lifecycle: { changedPaths: [], artifactRefs: [] },
          outcome: { reviewResolved: false, failureResolved: false },
        },
      });
      const { runNativeFacade } = await import('../../app/commands/native.js');

      expect(await runNativeFacade(argv)).toBe(0);
      expect(collectCometPluginContext).toHaveBeenCalledOnce();
      expect(recordCometWorkflowResult).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ changeId: 'change-name', eventType: 'episode.completed' }),
      );
    },
  );

  it.each([
    { task: 'Explicit task from flag', flag: true },
    { task: 'Explicit task from environment', flag: false },
  ])('preserves context and learning on Shape approval with $task', async ({ task, flag }) => {
    vi.stubEnv('COMET_TASK', flag ? undefined : task);
    runNativeCli.mockResolvedValue({ exitCode: 0 });
    const { runNativeFacade } = await import('../../app/commands/native.js');

    expect(
      await runNativeFacade(
        flag ? [...shapeConfirmationArgs, '--comet-task', task] : shapeConfirmationArgs,
      ),
    ).toBe(0);
    expect(runNativeCli).toHaveBeenCalledExactlyOnceWith(shapeConfirmationArgs);
    expect(collectCometPluginContext).toHaveBeenCalledExactlyOnceWith(expect.any(String), { task });
    expect(recordCometWorkflowResult).toHaveBeenCalledTimes(1);
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

  it('records a successful next without integration flags', async () => {
    runNativeCli.mockResolvedValue({ exitCode: 0, stdout: 'advanced\n', stderr: '' });
    const { runNativeFacade } = await import('../../app/commands/native.js');

    await runNativeFacade(['next', 'change-name']);

    expect(recordCometWorkflowResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workflow: 'native',
        changeId: 'change-name',
        command: 'next',
        eventType: 'episode.completed',
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

  it('does not expose additional plugin evidence for rendered text output', async () => {
    runNativeCliDetailed.mockResolvedValue({
      dispatch: {
        command: 'next',
        exitCode: 0,
        data: {
          change: {
            phase: 'archive',
            verification: { verdict: 'pass', summary: 'Structured result passed.' },
            history: [{ outcome: 'fail' }, { outcome: 'pass' }],
          },
          changedPaths: ['src/native.ts'],
        },
      },
      output: { exitCode: 0, stdout: 'rendered output\n', stderr: '' },
      experience: {
        lifecycle: { changedPaths: [], artifactRefs: [] },
        outcome: { reviewResolved: false, failureResolved: false },
      },
      json: false,
      verbose: false,
    });
    const { runNativeFacade } = await import('../../app/commands/native.js');

    await runNativeFacade(['next', 'change-name', '--result', 'result.json']);

    expect(runNativeCli).not.toHaveBeenCalled();
    expect(recordCometWorkflowResult).toHaveBeenCalledTimes(1);
    expect(recordCometWorkflowResult).toHaveBeenCalledWith(
      expect.not.objectContaining({ changedPaths: expect.anything() }),
    );
  });
});
