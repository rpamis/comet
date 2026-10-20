import { evalMatrix } from '../../helpers/eval-matrix.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readEvalRetrySelection } from '../../../domains/eval/eval-run-retry.js';
let project: string;
beforeEach(async () => {
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-retry-'));
});
afterEach(async () => {
  await fs.rm(project, { recursive: true, force: true });
});
async function source(status = 'completed') {
  const root = path.join(project, '.comet/eval/runs/original');
  await fs.mkdir(path.join(root, 'reports'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'expected-case-matrix.json'),
    JSON.stringify(
      evalMatrix(
        [0, 1, 2].map((index) => ({
          task: `case-${index}`,
          treatment: 'DYNAMIC_SKILL',
          rep: index === 2 ? 2 : 1,
        })),
      ),
    ),
  );
  await fs.writeFile(
    path.join(root, 'dashboard-run.json'),
    JSON.stringify({
      schema: 'comet.eval.managed-run.v1',
      id: 'original',
      status,
      config: { target: 'skill', targetType: 'skill', agent: 'codex' },
      targetId: 'writer',
      contentHash: 'old',
    }),
  );
  await fs.writeFile(
    path.join(root, 'metadata.json'),
    JSON.stringify({
      experiment_id: 'original',
      completed_at: '2026-10-11',
      expected_case_matrix: { case_count: 3 },
    }),
  );
  for (const [index, passed] of [true, false, false].entries())
    await fs.writeFile(
      path.join(root, 'reports', `case-${index}_report.json`),
      JSON.stringify({
        passed,
        name: `case-${index}-DYNAMIC_SKILL`,
        rep: index === 2 ? 2 : 1,
        events_summary: {
          task: `case-${index}`,
          treatment: 'DYNAMIC_SKILL',
          sample: index === 2 ? 2 : 1,
          case_manifest: { task_hash: 'task', validator_hash: 'validator' },
        },
      }),
    );
}
it('selects every failed combination and preserves repetitions without touching the parent', async () => {
  await source();
  const selection = await readEvalRetrySelection(project, 'original');
  expect(selection.cases.map((item) => [item.task, item.repetition])).toEqual([
    ['case-1', 1],
    ['case-2', 2],
  ]);
  expect(selection.sourceRunId).toBe('original');
  expect(
    JSON.parse(
      await fs.readFile(path.join(project, '.comet/eval/runs/original/dashboard-run.json'), 'utf8'),
    ).status,
  ).toBe('completed');
});
it('refuses retrying an active run', async () => {
  await source('running');
  await expect(readEvalRetrySelection(project, 'original')).rejects.toThrow(/停止|结束/);
});
