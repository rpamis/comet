import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

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
  it.each(['shortcut', 'group'])(
    'shares identity only after the %s command has finished',
    async (mode) => {
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      let remote = 'https://example.test/before.git';
      const runGit = vi.fn(() => remote);
      const beforeId = resolveStableProjectId(process.cwd(), { runGit });
      runGit.mockClear();
      runClassicCli.mockImplementation(async () => {
        resolveStableProjectId(process.cwd(), { runGit });
        remote = 'https://example.test/after.git';
        return { exitCode: 0, stdout: '{}' };
      });
      recordCometWorkflowResult.mockImplementation(async () => {
        const id = resolveStableProjectId(process.cwd(), { runGit });
        expect(id).not.toBe(beforeId);
        expect(resolveStableProjectId(process.cwd(), { runGit })).toBe(id);
      });
      const { runClassicFacade, runClassicGroupFacade } =
        await import('../../app/commands/classic.js');
      const args = ['next', 'change', '--comet-workflow', 'full', '--json'];
      expect(
        await (mode === 'shortcut'
          ? runClassicFacade('state', args)
          : runClassicGroupFacade(['state', ...args])),
      ).toBe(0);
      expect(runGit).toHaveBeenCalledTimes(2);
      expect(recordCometWorkflowResult).toHaveBeenCalledTimes(1);
    },
  );
  it('offers a concise Classic command overview with drill-down help', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { runClassicGroupFacade } = await import('../../app/commands/classic.js');
    expect(await runClassicGroupFacade(['--help'])).toBe(0);
    const help = String(stdout.mock.calls[0][0]);
    expect(help).toContain('check run');
    expect(help).toContain('Advanced workflow operations');
    expect(help).toContain('<command> --help');
    expect(runClassicCli).not.toHaveBeenCalled();
  });
  it.each(['--help', '-h'])(
    'does not collect context or record workflow success for %s',
    async (flag) => {
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      runClassicCli.mockResolvedValue({ exitCode: 0, stdout: 'Usage: comet state\n' });
      const { runClassicFacade, runClassicGroupFacade } =
        await import('../../app/commands/classic.js');
      expect(await runClassicFacade('state', [flag, '--comet-task', 'repair'])).toBe(0);
      expect(await runClassicGroupFacade(['workspace', flag, '--comet-task', 'repair'])).toBe(0);
      expect(collectCometPluginContext).not.toHaveBeenCalled();
      expect(recordCometWorkflowResult).not.toHaveBeenCalled();
    },
  );
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    runClassicCli.mockReset();
    recordCometWorkflowResult.mockReset();
    collectCometPluginContext.mockReset();
  });

  it('exposes the stable public Classic commands including executed checks', async () => {
    const { PUBLIC_CLASSIC_COMMANDS } = await import('../../app/commands/classic.js');

    expect(PUBLIC_CLASSIC_COMMANDS).toEqual(['state', 'guard', 'handoff', 'archive', 'check']);
  });

  it('registers the Classic facade from its single public command source', async () => {
    const source = await fs.readFile(path.resolve('app', 'cli', 'index.ts'), 'utf8');

    // The facade command list is inlined in the CLI entry so that importing
    // the Classic CLI graph is deferred to the action (lazy load). The four
    // stable names must still drive the command registration loop.
    expect(source).toContain("= ['state', 'guard', 'handoff', 'archive', 'check'] as const");
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

  it.each(['shortcut', 'group'] as const)(
    'preserves integration, delimiter, and exactly one plugin event through the %s facade',
    async (mode) => {
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      runClassicCli.mockResolvedValue({ exitCode: 0, stdout: '{}' });
      const { runClassicFacade, runClassicGroupFacade } =
        await import('../../app/commands/classic.js');
      const args = [
        'demo',
        'design',
        '--apply',
        '--comet-task',
        '修复 CLI',
        '--comet-path',
        'src/a b.ts',
        '--comet-phase',
        'design',
        '--comet-workflow',
        'hotfix',
        '--',
        '--comet-task',
        'child',
        '--help',
      ];
      const result =
        mode === 'shortcut'
          ? await runClassicFacade('guard', args)
          : await runClassicGroupFacade(['guard', ...args]);
      expect(result).toBe(0);
      expect(runClassicCli).toHaveBeenCalledWith([
        'guard',
        'demo',
        'design',
        '--apply',
        '--',
        '--comet-task',
        'child',
        '--help',
      ]);
      expect(collectCometPluginContext).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
        task: '修复 CLI',
        path: 'src/a b.ts',
        phase: 'design',
      });
      expect(recordCometWorkflowResult).toHaveBeenCalledTimes(1);
      expect(recordCometWorkflowResult.mock.calls[0][0]).toMatchObject({
        workflow: 'hotfix',
        changeId: 'demo',
        success: true,
      });
    },
  );

  it('uses COMET_TASK without explicit flags and isolates plugin failures from workflow success', async () => {
    vi.stubEnv('COMET_TASK', 'environment task');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    collectCometPluginContext.mockRejectedValue(new Error('context unavailable'));
    recordCometWorkflowResult.mockRejectedValue(new Error('plugin unavailable'));
    runClassicCli.mockResolvedValue({ exitCode: 0, stdout: 'result' });
    const { runClassicFacade } = await import('../../app/commands/classic.js');
    expect(await runClassicFacade('state', ['current', '--json'])).toBe(0);
    expect(collectCometPluginContext).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
      task: 'environment task',
    });
    expect(recordCometWorkflowResult).toHaveBeenCalledTimes(1);
  });
  it('injects the self-contained packaged executor through the same integration and plugin boundary', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const execute = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, stdout: '{"command":"state","exitCode":0}' });
    const { runClassicFacade } = await import('../../app/commands/classic.js');
    expect(
      await runClassicFacade('state', ['current', '--comet-workflow', 'hotfix', '--json'], execute),
    ).toBe(0);
    expect(execute).toHaveBeenCalledExactlyOnceWith(['state', 'current', '--json']);
    expect(runClassicCli).not.toHaveBeenCalled();
    expect(recordCometWorkflowResult).toHaveBeenCalledTimes(1);
    expect(recordCometWorkflowResult.mock.calls[0][0].workflow).toBe('hotfix');
  });

  it.each(['--comet-task', '--comet-path', '--comet-phase', '--comet-workflow'])(
    'reports missing %s values in JSON before dispatch',
    async (flag) => {
      let stdout = '';
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        stdout += String(chunk);
        return true;
      });
      const { runClassicFacade } = await import('../../app/commands/classic.js');
      expect(await runClassicFacade('state', ['current', '--json', flag])).toBe(64);
      expect(JSON.parse(stdout).data.issues[0]).toMatchObject({
        code: 'CLASSIC_INTEGRATION_ARGUMENT_MISSING',
        field: flag,
      });
      expect(runClassicCli).not.toHaveBeenCalled();
      expect(recordCometWorkflowResult).not.toHaveBeenCalled();
    },
  );
});
