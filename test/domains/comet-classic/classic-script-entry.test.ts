import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createClassicCommandRunner,
  runClassicScript,
} from '../../../domains/comet-classic/classic-script-entry.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import type { ClassicCommandHandler } from '../../../domains/comet-classic/classic-cli.js';

describe('Classic direct script entry', () => {
  it.each([
    ['check', 'run', 'demo', 'verify', '--json', '--', 'node', 'test.js', '--json', '--help'],
    ['check', '--help', '--json'],
    ['check', 'run', 'demo', 'verify'],
  ])('keeps aggregate argv, JSON and project context semantics for %j', async (...argv) => {
    const handler: ClassicCommandHandler = async (args, options) => ({
      exitCode: 0,
      data: { args, options },
      envelope: { summary: 'Check completed.', next: { command: 'comet state next demo' } },
    });
    const runOptions = { invocationCwd: '/workspace/caller', projectRoot: '/workspace/project' };
    expect(await createClassicCommandRunner('check', handler)(argv, runOptions)).toEqual(
      await runClassicCli(argv, { check: handler }, runOptions),
    );
  });

  it('keeps handler failures in the same JSON envelope without writing during an imported call', async () => {
    const handler: ClassicCommandHandler = async () => {
      throw new Error('check failed');
    };
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    expect(await createClassicCommandRunner('check', handler)(['check', 'run', '--json'])).toEqual(
      await runClassicCli(['check', 'run', '--json'], { check: handler }),
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(['guard', 'hook-guard'] as const)(
    'reports live %s progress only outside Hooks and keeps JSON clean',
    async (command) => {
      vi.useFakeTimers();
      const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      let finish!: () => void;
      const pending = createClassicCommandRunner(command, async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { exitCode: 0, data: { finished: true } };
      })([command, '--json']);
      await vi.advanceTimersByTimeAsync(5000);
      expect(stderr.mock.calls.length).toBe(command === 'guard' ? 1 : 0);
      expect(stdout).not.toHaveBeenCalled();
      finish();
      expect(JSON.parse((await pending).stdout!).data).toEqual({ finished: true });
      stderr.mockClear();
      await vi.advanceTimersByTimeAsync(10000);
      expect(stderr).not.toHaveBeenCalled();
    },
  );

  it('preserves the shared runtime command field in JSON mode', async () => {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });

    const exitCode = await runClassicScript(
      'state',
      async () => ({ exitCode: 64, stderr: 'invalid state arguments' }),
      ['--json'],
    );

    expect(exitCode).toBe(64);
    expect(JSON.parse(output)).toEqual({
      agent: {
        phase: null,
        status: null,
        stateVersion: null,
        workspace: { cwd: null },
        continuation: null,
      },
      command: 'state',
      exitCode: 64,
      stderr: 'invalid state arguments',
    });
  });

  it('keeps the audience envelope fields in direct command JSON mode', async () => {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });

    const exitCode = await runClassicScript(
      'state',
      async () => ({
        exitCode: 0,
        envelope: {
          summary: 'The change is ready to continue.',
          next: { command: 'comet state next demo' },
          user_message: 'No user decision is needed.',
        },
      }),
      ['--json'],
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toEqual({
      agent: {
        phase: null,
        status: null,
        stateVersion: null,
        workspace: { cwd: null },
        continuation: null,
      },
      command: 'state',
      exitCode: 0,
      summary: 'The change is ready to continue.',
      next: { command: 'comet state next demo' },
      user_message: 'No user decision is needed.',
    });
  });
});
