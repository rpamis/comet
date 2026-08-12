import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatCometWorkflowResolution,
  resolveCometWorkflowResolution,
} from '../../../domains/comet-entry/workflow-resolution.js';
import { runCometEntryRuntime } from '../../../domains/comet-entry/entry-runtime.js';

vi.mock('../../../domains/comet-entry/workflow-resolution.js', () => ({
  formatCometWorkflowResolution: vi.fn(),
  resolveCometWorkflowResolution: vi.fn(),
}));

function io() {
  return { stdout: vi.fn(), stderr: vi.fn() };
}

describe('Comet entry runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats a human-readable workflow resolution by default', async () => {
    const output = io();
    vi.mocked(resolveCometWorkflowResolution).mockResolvedValue({} as never);
    vi.mocked(formatCometWorkflowResolution).mockReturnValue('classic: demo');

    await expect(runCometEntryRuntime([], output)).resolves.toBe(0);

    expect(resolveCometWorkflowResolution).toHaveBeenCalledWith(process.cwd());
    expect(formatCometWorkflowResolution).toHaveBeenCalledWith({});
    expect(output.stdout).toHaveBeenCalledWith('classic: demo\n');
    expect(output.stderr).not.toHaveBeenCalled();
  });

  it('prints help without resolving a project', async () => {
    const output = io();

    await expect(runCometEntryRuntime(['--help'], output)).resolves.toBe(0);
    await expect(runCometEntryRuntime(['-h'], output)).resolves.toBe(0);

    expect(resolveCometWorkflowResolution).not.toHaveBeenCalled();
    expect(output.stdout).toHaveBeenNthCalledWith(
      1,
      'Usage: comet-entry-runtime [path] [--json]\n',
    );
    expect(output.stdout).toHaveBeenNthCalledWith(
      2,
      'Usage: comet-entry-runtime [path] [--json]\n',
    );
  });

  it('prints JSON for an explicit target path', async () => {
    const output = io();
    const resolution = { workflow: 'native', change: 'demo' };
    vi.mocked(resolveCometWorkflowResolution).mockResolvedValue(resolution as never);

    await expect(runCometEntryRuntime(['--json', 'project'], output)).resolves.toBe(0);

    expect(resolveCometWorkflowResolution).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]project$/u),
    );
    expect(output.stdout).toHaveBeenCalledWith(`${JSON.stringify(resolution, null, 2)}\n`);
  });

  it.each([
    [['--unknown'], 'Unknown option: --unknown'],
    [['first', 'second'], 'Unexpected argument: second'],
  ])('returns a usage error for invalid arguments %j', async (args, message) => {
    const output = io();

    await expect(runCometEntryRuntime(args, output)).resolves.toBe(64);
    expect(output.stderr).toHaveBeenCalledWith(
      `${message}\nUsage: comet-entry-runtime [path] [--json]\n`,
    );
  });

  it('returns a runtime error when workflow resolution fails', async () => {
    const output = io();
    vi.mocked(resolveCometWorkflowResolution).mockRejectedValue(new Error('unreadable project'));

    await expect(runCometEntryRuntime(['project'], output)).resolves.toBe(65);
    expect(output.stderr).toHaveBeenCalledWith('unreadable project\n');
  });

  it('formats a non-Error workflow resolution failure', async () => {
    const output = io();
    vi.mocked(resolveCometWorkflowResolution).mockRejectedValue('unreadable project');

    await expect(runCometEntryRuntime(['project'], output)).resolves.toBe(65);
    expect(output.stderr).toHaveBeenCalledWith('unreadable project\n');
  });
});
