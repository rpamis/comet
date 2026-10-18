import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';

export async function writeApplicationCaseEvidence(
  resultFile: string,
  result: {
    taskNames: string[];
    passed: number;
    taskSet?: { manifestPath: string; manifestHash: string };
  },
) {
  const directory = path.dirname(resultFile);
  const project = path.resolve(directory, '../../../..');
  if (!result.taskSet) {
    const manifestPath = path.join(
      project,
      '.comet/eval/generated',
      path.basename(directory),
      'eval.yaml',
    );
    const manifest = stringify({
      evaluation: {
        tasks: result.taskNames.map((name) => ({ name, prompt: 'Run the isolated SDK fixture' })),
      },
    });
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, manifest);
    result.taskSet = {
      manifestPath,
      manifestHash: 'sha256:' + createHash('sha256').update(manifest).digest('hex'),
    };
  }
  const cases = result.taskNames
    .map((task) => ({ rep: 1, task, treatment: 'DYNAMIC_SKILL' }))
    .sort((a, b) => (a.task < b.task ? -1 : a.task > b.task ? 1 : 0));
  const payload = { cases, schema: 'comet.eval.expected-case-matrix.v1' };
  const matrix = {
    ...payload,
    matrix_hash: 'sha256:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
  await fs.mkdir(path.join(directory, 'reports'), { recursive: true });
  await fs.writeFile(path.join(directory, 'expected-case-matrix.json'), JSON.stringify(matrix));
  for (const [index, task] of result.taskNames.entries()) {
    await fs.writeFile(
      path.join(directory, 'reports', `${task}_report.json`),
      JSON.stringify({
        name: `${task}-DYNAMIC_SKILL-r1`,
        rep: 1,
        passed: index < result.passed,
        sample_quality: { status: 'included' },
        events_summary: { task, treatment: 'DYNAMIC_SKILL', sample: 1 },
        checks_passed: ['SDK Run inspected by actual Runtime: fixture'],
        checks_failed: index < result.passed ? [] : ['fixture failure'],
      }),
    );
  }
}
