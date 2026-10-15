import { afterEach, expect, it, vi } from 'vitest';
import {
  withCometRuntimeProgress,
  reportCometRuntimeProgress,
} from '../../platform/process/runtime-metrics.js';

afterEach(() => vi.useRealTimers());

it('reports slow operation progress without changing its result or keeping a timer after completion', async () => {
  vi.useFakeTimers();
  const events: Array<{ label: string; completed?: number; elapsedMs: number }> = [];
  let finish!: (value: number) => void;
  const pending = withCometRuntimeProgress(
    () => {
      reportCometRuntimeProgress('读取项目文件', 12, 100);
      return new Promise<number>((resolve) => {
        finish = resolve;
      });
    },
    (event) => events.push(event),
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(events).toMatchObject([{ label: '读取项目文件', completed: 12, elapsedMs: 5000 }]);
  finish(42);
  expect(await pending).toBe(42);
  await vi.advanceTimersByTimeAsync(10000);
  expect(events).toHaveLength(1);
});

it('keeps diagnostics isolated and ignores a failing progress consumer', async () => {
  vi.useFakeTimers();
  const pending = withCometRuntimeProgress(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      return 'complete';
    },
    () => {
      throw new Error('closed diagnostics stream');
    },
  );
  await vi.advanceTimersByTimeAsync(6000);
  expect(await pending).toBe('complete');
});
