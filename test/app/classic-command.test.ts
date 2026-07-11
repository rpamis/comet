import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

const runClassicCli = vi.fn();

vi.mock('../../domains/comet-classic/classic-cli.js', () => ({
  runClassicCli,
}));

describe('Classic command facade', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runClassicCli.mockReset();
  });

  it('exposes exactly the four stable public Classic commands', async () => {
    const { PUBLIC_CLASSIC_COMMANDS } = await import('../../app/commands/classic.js');

    expect(PUBLIC_CLASSIC_COMMANDS).toEqual(['state', 'guard', 'handoff', 'archive']);
  });

  it('registers the Classic facade from its single public command source', async () => {
    const source = await fs.readFile(path.resolve('app', 'cli', 'index.ts'), 'utf8');

    expect(source).toMatch(
      /import \{[\s\S]*PUBLIC_CLASSIC_COMMANDS[\s\S]*\} from '\.\.\/commands\/classic\.js';/u,
    );
    expect(source).toContain('for (const command of PUBLIC_CLASSIC_COMMANDS)');
    expect(source).not.toContain(
      "for (const command of ['state', 'guard', 'handoff', 'archive'] as const)",
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
});
