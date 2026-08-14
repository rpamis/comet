import { afterEach, describe, expect, it, vi } from 'vitest';

const runNativeCli = vi.fn();
const recordCometWorkflowResult = vi.fn();

vi.mock('../../domains/comet-native/native-cli.js', () => ({ runNativeCli }));
vi.mock('../../domains/comet-entry/plugin-context.js', () => ({ recordCometWorkflowResult }));

describe('Native command facade', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runNativeCli.mockReset();
    recordCometWorkflowResult.mockReset();
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
});
