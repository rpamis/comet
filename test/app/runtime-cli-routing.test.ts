import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerRuntimeCommand,
  reportRuntimeCliFailure,
  runRuntimeCli,
} from '../../app/cli/runtime-command.js';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';

vi.mock('../../app/commands/runtime.js', async (original) => ({
  ...(await original<typeof import('../../app/commands/runtime.js')>()),
  runtimeDispatchCommand: vi.fn(),
}));

describe('shared Runtime CLI routing', () => {
  let previousExitCode: typeof process.exitCode;
  beforeEach(() => {
    previousExitCode = process.exitCode;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.mocked(runtimeDispatchCommand).mockResolvedValue({
      exitCode: 0,
      response: {
        protocolVersion: 1,
        requestId: 'request',
        status: 'succeeded',
        data: {} as never,
      },
    });
  });
  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('parses repeatable workflow flags and invokes the existing command exactly once', async () => {
    await runRuntimeCli([
      'runtime',
      'dispatch',
      '--request=request.json',
      '--workflow',
      'first.json',
      '--workflow=second.json',
      '--project-root',
      'project',
      '--root-dir',
      'state',
      '--json',
    ]);
    expect(runtimeDispatchCommand).toHaveBeenCalledExactlyOnceWith(
      {
        request: 'request.json',
        workflow: ['first.json', 'second.json'],
        projectRoot: 'project',
        rootDir: 'state',
        json: true,
      },
      { output: 'compact' },
    );
    expect(process.exitCode).toBe(0);
  });

  it.each([
    ['runtime', 'dispatch'],
    ['runtime', 'dispatch', '--request'],
    ['runtime', 'dispatch', '--request', 'request.json', '--unexpected'],
    ['runtime', 'dispatch', '--request', 'request.json', 'extra'],
  ])('preserves public invalid-argument responses: %j', async (...argv) => {
    const publicProgram = new Command().name('comet').exitOverride();
    registerRuntimeCommand(publicProgram, true);
    try {
      await publicProgram.parseAsync(argv, { from: 'user' });
    } catch (error) {
      await reportRuntimeCliFailure(error);
    }
    const publicResponse = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0]);
    const publicStderr = vi.mocked(process.stderr.write).mock.calls.map(([text]) => String(text));
    vi.mocked(console.log).mockClear();
    vi.mocked(process.stderr.write).mockClear();
    await runRuntimeCli(argv);
    const fastResponse = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0]);
    expect(fastResponse).toEqual({ ...publicResponse, requestId: fastResponse.requestId });
    expect(process.exitCode).toBe(64);
    expect(vi.mocked(process.stderr.write).mock.calls.map(([text]) => String(text))).toEqual(
      publicStderr,
    );
    expect(runtimeDispatchCommand).not.toHaveBeenCalled();
  });
});
