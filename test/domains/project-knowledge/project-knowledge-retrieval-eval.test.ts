import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'vitest';

test('keeps the fixed project knowledge retrieval baseline complete', async () => {
  const dataset = JSON.parse(
    await readFile(path.resolve('eval/project-knowledge/retrieval-baseline.json'), 'utf8'),
  ) as {
    schema: string;
    cases: Array<{
      id: string;
      category: string;
      query: string;
      goldSources: string[];
      expectedAbstain?: boolean;
    }>;
  };
  expect(dataset.schema).toBe('comet.project-knowledge.retrieval-eval.v1');
  expect(dataset.cases).toHaveLength(50);
  expect(new Set(dataset.cases.map((entry) => entry.id)).size).toBe(50);
  expect(dataset.cases.filter((entry) => entry.category === 'exact')).toHaveLength(15);
  expect(dataset.cases.filter((entry) => entry.category === 'chinese')).toHaveLength(15);
  expect(dataset.cases.filter((entry) => entry.category === 'cross-module')).toHaveLength(10);
  expect(dataset.cases.filter((entry) => entry.category === 'archive-conflict')).toHaveLength(5);
  expect(dataset.cases.filter((entry) => entry.expectedAbstain)).toHaveLength(5);
  expect(dataset.cases.every((entry) => entry.query.trim().length > 0)).toBe(true);
});
