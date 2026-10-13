import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function archiveFixture(project: string, run: unknown) {
  const archive = path.join(project, 'eval/archives/example');
  await fs.mkdir(path.join(archive, 'runs'), { recursive: true });
  const files: Record<string, string> = {};
  for (const [file, value] of Object.entries({
    'runs/creator.json': JSON.stringify(run),
    'report.md': '# Assisted task review\nOriginal tests: 4/4. Formal Eval not performed.\n',
  })) {
    await fs.writeFile(path.join(archive, file), value);
    files[file] = createHash('sha256').update(value).digest('hex');
  }
  const manifest = {
    schema: 'comet.eval.archive.v1',
    id: 'example',
    title: 'Historical experiment',
    application: {
      id: 'example-app',
      version: '3',
      base: 'standalone',
      root: 'application',
      contentHash: 'a'.repeat(64),
      packageHash: 'b'.repeat(64),
    },
    files,
    runs: [{ kind: 'creator', runId: (run as { runId: string }).runId, file: 'runs/creator.json' }],
    reports: [{ path: 'report.md', label: '专项复核报告' }],
    assessment: {
      task: 'graph-review',
      taskCompleted: true,
      originalTestsPassed: 4,
      regressionTestsPassed: 13,
      models: ['glm'],
      limitations: ['Assisted continuation; formal Eval not performed.'],
    },
  };
  await fs.writeFile(path.join(archive, 'archive.json'), JSON.stringify(manifest));
  return { archive, manifest };
}
