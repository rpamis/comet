import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ receipt: vi.fn(), run: vi.fn() }));
vi.mock('../../domains/comet-entry/workflow-learning-receipt.js', () => ({
  areCometWorkflowResultsProcessed: mocks.receipt,
}));
vi.mock('../../platform/process/external-command.js', async (original) => ({
  ...(await original<object>()),
  runExternalCommandAsync: mocks.run,
}));
import { recordCometTaskWorkflowResults } from '../../app/commands/comet-task-context.js';
const result = {
  projectRoot: '/project',
  workflow: 'native',
  changeId: 'one',
  command: 'next',
  success: true,
};
beforeEach(() => {
  mocks.receipt.mockReset().mockResolvedValue(false);
  mocks.run.mockReset().mockResolvedValue('[null]');
});
test('skips the worker only after the complete batch has a processed receipt', async () => {
  mocks.receipt.mockResolvedValue(true);
  await expect(recordCometTaskWorkflowResults([result], { reuseProcessed: true })).resolves.toEqual(
    [undefined],
  );
  expect(mocks.receipt).toHaveBeenCalledOnce();
  expect(mocks.run).not.toHaveBeenCalled();
});
test.each(['pending', 'unreadable'])('falls back for %s receipts', async (kind) => {
  if (kind === 'unreadable') mocks.receipt.mockRejectedValue(new Error('denied'));
  await recordCometTaskWorkflowResults([result], { reuseProcessed: true });
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run.mock.calls[0]![2].timeoutMs).toBeLessThanOrEqual(5_000);
});
test('cancels a slow preflight and deducts its cost from the original worker deadline', async () => {
  vi.useFakeTimers();
  try {
    mocks.receipt.mockImplementation(() => new Promise(() => {}));
    const pending = recordCometTaskWorkflowResults([result], { reuseProcessed: true });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(mocks.receipt.mock.calls[0]![1].aborted).toBe(true);
    expect(mocks.run).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
test.each([
  { ...result, command: 'archive' },
  { ...result, learningCheck: 'no-observation' as const },
  { ...result, captureOnly: true },
])('preserves non-next checkpoints and explicit learning checks', async (checkpoint) => {
  mocks.receipt.mockResolvedValue(true);
  await recordCometTaskWorkflowResults([checkpoint], { reuseProcessed: true });
  expect(mocks.receipt).not.toHaveBeenCalled();
  expect(mocks.run).toHaveBeenCalledOnce();
});
