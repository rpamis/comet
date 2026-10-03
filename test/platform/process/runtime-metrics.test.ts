import { describe, expect, it } from 'vitest';
import {
  measureCometGitCommand,
  measureCometGitCommandAsync,
  snapshotCometRuntimeMetrics,
  withCometRuntimeMetrics,
} from '../../../platform/process/runtime-metrics.js';
import { runGitCommand } from '../../../platform/process/git.js';
import { runExternalCommand } from '../../../platform/process/external-command.js';

describe('Runtime Git metrics', () => {
  it('counts failed Git subprocesses without changing their error', async () => {
    const before = snapshotCometRuntimeMetrics();
    const observed = await withCometRuntimeMetrics(async () => {
      expect(() => runGitCommand(process.cwd(), ['--comet-invalid-option'])).toThrow('failed');
    });
    expect(observed.metrics.gitCommands).toBe(1);
    expect(observed.metrics.gitDurationMs).toBeGreaterThan(0);
    expect(snapshotCometRuntimeMetrics().gitCommands - before.gitCommands).toBe(1);
  });

  it('preserves a successful result and a thrown error', () => {
    expect(measureCometGitCommand(() => 'output')).toBe('output');
    const failure = new Error('failure');
    expect(() =>
      measureCometGitCommand(() => {
        throw failure;
      }),
    ).toThrow(failure);
  });

  it('counts asynchronous failures and external Git while excluding other commands', async () => {
    const failure = new Error('async failure');
    const observed = await withCometRuntimeMetrics(async () => {
      await expect(
        measureCometGitCommandAsync(async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(runExternalCommand('git', ['--version'])).toContain('git version');
      runExternalCommand(process.execPath, ['-e', '']);
    });
    expect(observed.metrics.gitCommands).toBe(2);
    expect(observed.metrics.gitDurationMs).toBeGreaterThan(0);
  });
});
