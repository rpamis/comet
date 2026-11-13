import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), processed: vi.fn() }));
vi.mock('../../platform/process/external-command.js', async (original) => ({
  ...(await original<object>()),
  runExternalCommandAsync: mocks.run,
}));
vi.mock('../../domains/comet-plugin/learning-receipt.js', () => ({
  areDefaultWorkflowEventsProcessed: mocks.processed,
}));

import { ExternalCommandError } from '../../platform/process/external-command.js';
import { stableProjectId } from '../../platform/paths/project-identity.js';
import { recordCometTaskWorkflowResults } from '../../app/commands/comet-task-context.js';

beforeEach(() => {
  mocks.run.mockReset();
  mocks.processed.mockReset();
});

test('keeps the original learning worker when the actual receipt identity probe times out', async () => {
  const result = {
    projectRoot: '/project',
    workflow: 'native',
    changeId: 'original-change',
    command: 'next',
    success: true,
    artifactRefs: ['original-report.md'],
  };
  mocks.run.mockImplementation(async (command, args) => {
    if (command === 'git') throw new ExternalCommandError(command, args, '', { timedOut: true });
    return '[null]';
  });

  await expect(recordCometTaskWorkflowResults([result], { reuseProcessed: true })).resolves.toEqual(
    [undefined],
  );

  expect(mocks.run).toHaveBeenCalledTimes(2);
  const [identity, worker] = mocks.run.mock.calls;
  expect(identity![0]).toBe('git');
  expect(identity![1]).toEqual(['-C', expect.any(String), 'remote', 'get-url', 'origin']);
  expect(identity![2].timeoutMs).toBe(100);
  expect(worker![0]).toBe(process.execPath);
  expect(worker![1][0]).toMatch(/comet-task-context-worker\.js$/u);
  expect(JSON.parse(worker![2].input)).toEqual({ workflowResults: [result] });
  expect(worker![2].timeoutMs).toBeGreaterThan(0);
  expect(worker![2].timeoutMs).toBeLessThanOrEqual(5_000);
  expect(mocks.processed).not.toHaveBeenCalled();
});

test('skips the worker only for processed events bound to the actual resolved Git identity', async () => {
  const origin = 'https://example.invalid/original-project.git';
  const result = {
    projectRoot: '/project',
    workflow: 'native',
    changeId: 'original-change',
    command: 'next',
    success: true,
    artifactRefs: ['original-report.md'],
  };
  mocks.run.mockResolvedValue(origin);
  mocks.processed.mockResolvedValue(true);

  await expect(recordCometTaskWorkflowResults([result], { reuseProcessed: true })).resolves.toEqual(
    [undefined],
  );

  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run.mock.calls[0]![0]).toBe('git');
  expect(mocks.processed).toHaveBeenCalledOnce();
  expect(mocks.processed).toHaveBeenCalledWith([
    expect.objectContaining({
      projectId: stableProjectId(origin),
      scope: 'project',
      source: expect.objectContaining({ changeId: result.changeId, command: 'next' }),
      evidence: [expect.objectContaining({ source: 'original-report.md' })],
    }),
  ]);
});
