import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { LocalProjectKnowledgeProvider } from '../../../domains/project-knowledge/local-provider.js';
import { createProjectKnowledgeQuery } from '../../../domains/project-knowledge/query.js';

test('uses current evidence for ordinary tasks while keeping explicit history searchable', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-knowledge-current-'));
  await fs.mkdir(path.join(directory, 'docs', 'archive'), { recursive: true });
  await fs.writeFile(
    path.join(directory, 'docs', 'current.md'),
    '# Auth session migration\n\nAuth session migration requires the current migration check.\n',
  );
  await fs.writeFile(
    path.join(directory, 'docs', 'archive', 'old.md'),
    '# Historical Auth session migration\n\nHistorical Auth session migration used a previous protocol.\n',
  );
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot: directory,
    cacheRoot: path.join(directory, 'cache'),
    corpus: [
      {
        absolutePath: path.join(directory, 'docs', 'current.md'),
        source: 'docs/current.md',
        kind: 'native-spec',
      },
      {
        absolutePath: path.join(directory, 'docs', 'archive', 'old.md'),
        source: 'docs/archive/old.md',
        kind: 'native-archive',
      },
    ],
  });
  try {
    const current = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'Auth session migration' }),
    });
    expect(current.kind === 'search' && current.results.map((entry) => entry.source)).toEqual([
      'docs/current.md',
    ]);
    const history = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'Historical Auth session migration' }),
    });
    expect(
      history.kind === 'search' &&
        history.results.some((entry) => entry.source === 'docs/archive/old.md'),
    ).toBe(true);
    const absent = await provider.query({
      kind: 'search',
      query: createProjectKnowledgeQuery({ task: 'quantum banana deployment topology' }),
    });
    expect(absent.kind === 'search' && absent.results).toEqual([]);
  } finally {
    provider.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
