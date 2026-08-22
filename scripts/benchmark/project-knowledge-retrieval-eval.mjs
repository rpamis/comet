import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const projectRoot = path.resolve(
  process.argv.find((value) => value.startsWith('--project='))?.slice(10) ?? repositoryRoot,
);
const cacheRootValue = process.argv.find((value) => value.startsWith('--cache-root='))?.slice(13);
const cacheRoot = cacheRootValue ? path.resolve(cacheRootValue) : undefined;
const enforce = process.argv.includes('--enforce');
const summaryOnly = process.argv.includes('--summary');
const dataset = JSON.parse(
  await readFile(
    path.join(repositoryRoot, 'eval', 'project-knowledge', 'retrieval-baseline.json'),
    'utf8',
  ),
);
const {
  createProjectKnowledgeQuery,
  discoverProjectKnowledgeCorpus,
  LocalProjectKnowledgeProvider,
} = await import('../../dist/domains/project-knowledge/index.js');

const corpus = await discoverProjectKnowledgeCorpus({ projectRoot });

async function evaluate(indexEnabled) {
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot,
    corpus,
    indexEnabled,
    ...(cacheRoot ? { cacheRoot } : {}),
  });
  const rows = [];
  for (const entry of dataset.cases) {
    const started = performance.now();
    const results = await provider.retrieve(createProjectKnowledgeQuery({ task: entry.query }));
    const sources = results.slice(0, dataset.topK).map((result) => result.source);
    const firstGold = sources.findIndex((source) => entry.goldSources.includes(source));
    const forbidden = sources.filter((source) =>
      (entry.forbiddenSourcePrefixes ?? []).some((prefix) => source.startsWith(prefix)),
    );
    rows.push({
      id: entry.id,
      category: entry.category,
      sources,
      hit: entry.expectedAbstain ? sources.length === 0 : firstGold >= 0,
      reciprocalRank: firstGold >= 0 ? 1 / (firstGold + 1) : 0,
      forbidden,
      elapsedMs: performance.now() - started,
    });
  }
  const gold = rows.filter((row) => !row.id.startsWith('none-'));
  const exact = rows.filter((row) => row.category === 'exact');
  const sortedLatency = rows.map((row) => row.elapsedMs).sort((left, right) => left - right);
  return {
    recallAt4: gold.filter((row) => row.hit).length / gold.length,
    exactRecallAt4: exact.filter((row) => row.hit).length / exact.length,
    mrr: gold.reduce((sum, row) => sum + row.reciprocalRank, 0) / gold.length,
    abstainAccuracy:
      rows.filter((row) => row.id.startsWith('none-') && row.hit).length /
      rows.filter((row) => row.id.startsWith('none-')).length,
    forbiddenSourceCount: rows.reduce((sum, row) => sum + row.forbidden.length, 0),
    p95Ms: sortedLatency[Math.max(0, Math.ceil(sortedLatency.length * 0.95) - 1)] ?? 0,
    rows,
  };
}

const ripgrep = await evaluate(false);
const hybrid = await evaluate(true);
const report = {
  schema: dataset.schema,
  projectRoot,
  cases: dataset.cases.length,
  ripgrep,
  hybrid,
  exactRecallNotRegressed: hybrid.exactRecallAt4 >= ripgrep.exactRecallAt4,
};
console.log(
  JSON.stringify(
    summaryOnly
      ? {
          ...report,
          ripgrep: { ...ripgrep, rows: undefined },
          hybrid: { ...hybrid, rows: undefined },
        }
      : report,
    null,
    2,
  ),
);
if (
  enforce &&
  (!report.exactRecallNotRegressed || hybrid.forbiddenSourceCount > 0 || hybrid.p95Ms > 200)
) {
  process.exitCode = 1;
}
