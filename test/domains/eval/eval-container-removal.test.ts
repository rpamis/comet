import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopEvalContainers } from '../../../domains/eval/eval-run-cleanup.js';
import { runExternalCommandAsync } from '../../../platform/process/external-command.js';

vi.mock('../../../platform/process/external-command.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../platform/process/external-command.js')>()),
  runExternalCommandAsync: vi.fn(),
}));

describe('Docker container removal completion', () => {
  let project: string;
  const container = 'abcdef123456';
  const command = vi.mocked(runExternalCommandAsync);

  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-removal-test-'));
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.resetAllMocks();
    await fs.rm(project, { recursive: true, force: true });
  });

  function daemon(
    remainingQueries: number,
    removalMessage = 'removal of container is already in progress',
  ) {
    let removing = false;
    command.mockImplementation(async (_name, args) => {
      if (args[0] === 'stop') return '';
      if (args[0] === 'rm') {
        removing = true;
        throw new Error(removalMessage);
      }
      if (args[0] === 'ps') {
        if (!removing) return container;
        return remainingQueries-- > 0 ? container : '';
      }
      throw new Error(`Unexpected Docker command: ${args[0]}`);
    });
  }

  it('waits for an in-progress removal before confirming scoped container cleanup', async () => {
    daemon(2);
    const cleanup = stopEvalContainers(project, 'pending-removal');
    const assertion = expect(cleanup).resolves.toBeUndefined();
    await vi.waitFor(() =>
      expect(command.mock.calls.some(([, args]) => args[0] === 'rm')).toBe(true),
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(command.mock.calls.filter(([, args]) => args[0] === 'rm')).toHaveLength(1);
    expect(command.mock.calls.filter(([, args]) => args[0] === 'stop')).toHaveLength(1);
    for (const [, args] of command.mock.calls.filter(([, args]) => args[0] === 'ps')) {
      expect(args).toContain('label=comet.eval.experiment=pending-removal');
    }
  });

  it('keeps cleanup incomplete when an in-progress removal never finishes', async () => {
    daemon(Infinity);
    const assertion = expect(stopEvalContainers(project, 'stuck-removal')).rejects.toThrow(
      '停止未完成',
    );
    await vi.waitFor(() =>
      expect(command.mock.calls.some(([, args]) => args[0] === 'rm')).toBe(true),
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(command.mock.calls.filter(([, args]) => args[0] === 'rm')).toHaveLength(1);
  });

  it('does not turn a failed removal into successful cleanup', async () => {
    daemon(Infinity, 'permission denied');
    await expect(stopEvalContainers(project, 'failed-removal')).rejects.toThrow('停止未完成');
    expect(vi.getTimerCount()).toBe(0);
  });
});
