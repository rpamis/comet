import { expect, it } from 'vitest';
import {
  scaleCounts,
  countGitTraceStarts,
  runWorkflowScaleBenchmark,
} from '../../scripts/benchmark/workflow-scale-benchmark.mjs';

it('bounds explicit benchmark scales and keeps ordering reproducible', () => {
  expect(scaleCounts(undefined, [100, 1000])).toEqual([100, 1000]);
  expect(scaleCounts('300,0,10,10', [])).toEqual([0, 10, 300]);
  for (const value of ['-1', '1.5', '100001', 'NaN'])
    expect(() => scaleCounts(value, [])).toThrow('integers');
});

it('rejects removed snapshot benchmark options without preparing fixtures', async () => {
  for (const options of [{ snapshotMaxFiles: 1 }, { fileCounts: [1] }, { dirtyCounts: [0] }])
    await expect(runWorkflowScaleBenchmark(options)).rejects.toThrow(
      'File snapshot benchmarks have been removed',
    );
});

it('counts Git process starts across parent and CLI descendants, not unrelated trace events', () => {
  expect(
    countGitTraceStarts(
      [
        { event: 'start', sid: 'parent', argv: ['git', 'status'] },
        { event: 'exit', sid: 'parent' },
        { event: 'start', sid: 'child', argv: ['git', 'diff'] },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n') + '\n',
    ),
  ).toBe(2);
  expect(() => countGitTraceStarts('{truncated')).toThrow();
});
