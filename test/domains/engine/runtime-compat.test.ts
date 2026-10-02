import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';

test('a public SDK consumer restores the pre-optimization approval and unknown-result fixtures', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve('test/helpers/runtime-sdk-compat-consumer.mjs'),
      path.resolve('test/fixtures/runtime-sdk-v1-045/run.json'),
    ],
    { encoding: 'utf8' },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    baselineCommit: '5990e5c3b8e27dc7e11ed99f0d49f5a90e5159f0',
    approval: 'completed',
    unknown: 'unknown',
    executions: 1,
    staleApprovalRejected: true,
    definitionDriftRejected: true,
    unsafeRetryRejected: true,
  });
});
