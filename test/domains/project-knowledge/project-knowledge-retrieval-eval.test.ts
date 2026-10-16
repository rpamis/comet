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
      goldPassages?: Array<{ source: string; allOf?: string[]; anyOf?: string[] }>;
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
  const labeled = dataset.cases.filter((entry) => entry.goldPassages?.length);
  expect(labeled).toHaveLength(6);
  for (const entry of labeled) {
    for (const passage of entry.goldPassages ?? []) {
      expect(entry.goldSources).toContain(passage.source);
      const text = (await readFile(path.resolve(passage.source), 'utf8'))
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/\s+/gu, ' ');
      const includes = (value: string): boolean =>
        text.includes(value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' '));
      expect((passage.allOf ?? []).every(includes), entry.id).toBe(true);
      expect(!passage.anyOf?.length || passage.anyOf.some(includes), entry.id).toBe(true);
    }
  }
});
