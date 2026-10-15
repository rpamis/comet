import { expect, it } from 'vitest';
import {
  scaleCounts,
  runWorkflowScaleBenchmark,
  workflowScaleSnapshotHealth,
} from '../../scripts/benchmark/workflow-scale-benchmark.mjs';

it('bounds explicit benchmark scales and keeps ordering reproducible', () => {
  expect(scaleCounts(undefined, [100, 1000])).toEqual([100, 1000]);
  expect(scaleCounts('300,0,10,10', [])).toEqual([0, 10, 300]);
  for (const value of ['-1', '1.5', '100001', 'NaN'])
    expect(() => scaleCounts(value, [])).toThrow('integers');
});

it('requires an explicit positive file budget before preparing larger fixtures', async () => {
  await expect(runWorkflowScaleBenchmark({ snapshotMaxFiles: 0 })).rejects.toThrow(
    'positive integer',
  );
  await expect(runWorkflowScaleBenchmark({ snapshotMaxFiles: 1.5 })).rejects.toThrow(
    'positive integer',
  );
});

it('rejects incomplete or missing Native snapshot evidence while accepting unrelated input measurements', () => {
  expect(
    workflowScaleSnapshotHealth([
      {
        name: 'native-full-10000',
        samples: [{ entries: 10000, snapshotComplete: true, omitted: 0 }],
      },
      {
        name: 'classic-input-dirty-10000',
        samples: [{ entries: 10003, snapshotComplete: null, omitted: 0 }],
      },
    ]),
  ).toEqual({ complete: true, issues: [] });
  expect(
    workflowScaleSnapshotHealth([
      {
        name: 'native-full-10001',
        samples: [{ entries: 10000, snapshotComplete: false, omitted: 1 }],
      },
      { name: 'native-incremental-clean-10001', samples: [{}] },
    ]),
  ).toEqual({
    complete: false,
    issues: [
      { name: 'native-full-10001', sample: 1, entries: 10000, omitted: 1 },
      { name: 'native-incremental-clean-10001', sample: 1, entries: null, omitted: null },
    ],
  });
});
