import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

const runClassicCli = vi.fn();
const recordCometWorkflowResult = vi.fn();
const collectCometPluginContext = vi.fn();

vi.mock('../../domains/comet-classic/classic-cli.js', () => ({
  runClassicCli,
}));
vi.mock('../../domains/comet-entry/plugin-context.js', () => ({
  recordCometWorkflowResult,
  collectCometPluginContext,
}));

describe('Classic command facade', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runClassicCli.mockReset();
    recordCometWorkflowResult.mockReset();
    collectCometPluginContext.mockReset();
  });

  it('exposes exactly the four stable public Classic commands', async () => {
    const { PUBLIC_CLASSIC_COMMANDS } = await import('../../app/commands/classic.js');

    expect(PUBLIC_CLASSIC_COMMANDS).toEqual(['state', 'guard', 'handoff', 'archive']);
  });

  it('registers the Classic facade from its single public command source', async () => {
    const source = await fs.readFile(path.resolve('app', 'cli', 'index.ts'), 'utf8');

    // The facade command list is inlined in the CLI entry so that importing
    // the Classic CLI graph is deferred to the action (lazy load). The four
    // stable names must still drive the command registration loop.
    expect(source).toContain("= ['state', 'guard', 'handoff', 'archive'] as const");
    expect(source).toContain('for (const command of PUBLIC_CLASSIC_COMMANDS)');
    expect(source).toContain(
      "const { runClassicFacade } = await import('../commands/classic.js');",
    );
  });

  it('dispatches exact argv and forwards stdout, stderr, and a nonzero exit code', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    runClassicCli.mockResolvedValue({
      exitCode: 9,
      stdout: 'classic output\n',
      stderr: 'classic error\n',
    });
    const { runClassicFacade } = await import('../../app/commands/classic.js');

    const exitCode = await runClassicFacade('handoff', [
      'write',
      '--json',
      '--apply',
      '--dry-run',
      '--classic-option',
      'value',
    ]);

    expect(runClassicCli).toHaveBeenCalledWith([
      'handoff',
      'write',
      '--json',
      '--apply',
      '--dry-run',
      '--classic-option',
      'value',
    ]);
    expect(stdout).toHaveBeenCalledWith('classic output\n');
    expect(stderr).toHaveBeenCalledWith('classic error\n');
    expect(exitCode).toBe(9);
  });

  it('preserves flag order through real Commander registration', async () => {
    runClassicCli.mockResolvedValue({ exitCode: 9 });
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    process.argv = [
      process.execPath,
      'comet',
      'guard',
      'check',
      '--json',
      '--apply',
      '--dry-run',
      '--classic-option',
      'value',
    ];
    process.exitCode = undefined;
    vi.resetModules();

    try {
      await import('../../app/cli/index.js');
      await vi.waitFor(() => {
        expect(runClassicCli).toHaveBeenCalledWith([
          'guard',
          'check',
          '--json',
          '--apply',
          '--dry-run',
          '--classic-option',
          'value',
        ]);
        expect(process.exitCode).toBe(9);
      });
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });

  it('routes Classic group argv before global version parsing', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    runClassicCli.mockResolvedValue({ exitCode: 0, stdout: 'openspec version\n' });
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    process.argv = [process.execPath, 'comet', 'classic', 'openspec', '--', '--version'];
    process.exitCode = undefined;
    vi.resetModules();

    try {
      await import('../../app/cli/index.js');
      await vi.waitFor(() => {
        expect(runClassicCli).toHaveBeenCalledWith(['openspec', '--', '--version']);
        expect(stdout).toHaveBeenCalledWith('openspec version\n');
        expect(process.exitCode).toBe(0);
      });
    } finally {
      stdout.mockRestore();
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });

  it('records a successful Classic archive through the shared plugin bridge', async () => {
    runClassicCli.mockResolvedValue({ exitCode: 0, stdout: 'archived\n', stderr: '' });
    const { runClassicFacade } = await import('../../app/commands/classic.js');

    await runClassicFacade('archive', ['change-name']);

    expect(recordCometWorkflowResult).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'full',
        changeId: 'change-name',
        command: 'archive',
        success: true,
      }),
    );
  });

  it('automatically collects task context before a Classic command', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    collectCometPluginContext.mockResolvedValue([
      { pluginId: 'comet.personal-memory', text: '使用中文回复' },
    ]);
    runClassicCli.mockResolvedValue({ exitCode: 0, stdout: 'done\n', stderr: '' });
    const { runClassicFacade } = await import('../../app/commands/classic.js');

    await runClassicFacade('guard', [
      'check',
      '--comet-task',
      '完成服务端改动',
      '--comet-path',
      'src/server.ts',
      '--comet-phase',
      'verify',
    ]);

    expect(runClassicCli).toHaveBeenCalledWith(['guard', 'check']);
    expect(collectCometPluginContext).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ task: '完成服务端改动', path: 'src/server.ts', phase: 'verify' }),
    );
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('使用中文回复'));
    expect(recordCometWorkflowResult.mock.calls[0]?.[0]).not.toHaveProperty('summary');
    expect(recordCometWorkflowResult.mock.calls[0]?.[0]).not.toHaveProperty('userEvidence');
  });

  it('records Classic verification using the selected preset family', async () => {
    runClassicCli.mockResolvedValue({ exitCode: 0, stdout: 'verified\n', stderr: '' });
    const { runClassicFacade } = await import('../../app/commands/classic.js');

    await runClassicFacade('guard', ['check', '--comet-workflow', 'hotfix']);

    expect(recordCometWorkflowResult).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'guard',
        eventType: 'verification.completed',
        workflow: 'hotfix',
      }),
    );
  });
});
