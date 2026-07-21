import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const evalFacadeCommand = vi.fn(async () => undefined);
const repositoryRoot = path.resolve('.');
const originalArgv = process.argv;

vi.mock('../../app/commands/eval.js', () => ({
  evalCommand: evalFacadeCommand,
}));

async function runEvalCli(...args: string[]): Promise<unknown[]> {
  process.argv = [process.execPath, path.join(repositoryRoot, 'bin', 'comet.js'), 'eval', ...args];
  vi.resetModules();
  await import('../../app/cli/index.js');
  await vi.waitFor(() => expect(evalFacadeCommand).toHaveBeenCalledTimes(1));
  return evalFacadeCommand.mock.calls[0];
}

describe('eval CLI options', () => {
  afterEach(() => {
    process.argv = originalArgv;
    evalFacadeCommand.mockReset();
  });

  it('leaves project undefined unless --project is explicitly passed', async () => {
    const [defaultTarget, defaultOptions] = await runEvalCli();

    expect(defaultTarget).toBeUndefined();
    expect((defaultOptions as { project?: string }).project).toBeUndefined();

    evalFacadeCommand.mockReset();
    const [explicitTarget, explicitOptions] = await runEvalCli('--project', 'custom-project');

    expect(explicitTarget).toBeUndefined();
    expect((explicitOptions as { project?: string }).project).toBe('custom-project');
  });

  it('defaults to the local suite and accepts an explicit LangSmith suite', async () => {
    const [, defaultOptions] = await runEvalCli();

    expect((defaultOptions as { suite?: string }).suite).toBe('local');

    evalFacadeCommand.mockReset();
    const [, explicitOptions] = await runEvalCli('--suite', 'langsmith');

    expect((explicitOptions as { suite?: string }).suite).toBe('langsmith');
  });
});
