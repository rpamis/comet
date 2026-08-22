import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
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

async function runFixtureChecks() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'comet-project-knowledge-eval-'));
  const cache = await mkdtemp(path.join(os.tmpdir(), 'comet-project-knowledge-eval-cache-'));
  const projects = [path.join(root, 'one'), path.join(root, 'two')];
  try {
    for (const [index, fixtureRoot] of projects.entries()) {
      await mkdir(path.join(fixtureRoot, '.comet'), { recursive: true });
      await mkdir(path.join(fixtureRoot, 'docs', 'comet', 'specs'), { recursive: true });
      await writeFile(
        path.join(fixtureRoot, '.comet', 'config.yaml'),
        'schema: comet.project.v1\ndefault_workflow: native\nworkflows: [native]\nnative:\n  artifact_root: docs\n',
      );
      await writeFile(
        path.join(fixtureRoot, 'docs', 'comet', 'specs', 'fixture.md'),
        `# Fixture\n\nworkspace-${index + 1}-original\n`,
      );
    }
    const providers = [];
    for (const fixtureRoot of projects) {
      const fixtureCorpus = await discoverProjectKnowledgeCorpus({ projectRoot: fixtureRoot });
      providers.push(
        new LocalProjectKnowledgeProvider({
          projectRoot: fixtureRoot,
          corpus: fixtureCorpus,
          cacheRoot: cache,
          indexEnabled: true,
        }),
      );
    }
    const first = await providers[0].retrieve(
      createProjectKnowledgeQuery({ task: 'workspace-1-original' }),
    );
    const second = await providers[1].retrieve(
      createProjectKnowledgeQuery({ task: 'workspace-2-original' }),
    );
    const isolated =
      first.some((result) => result.content.includes('workspace-1-original')) &&
      !first.some((result) => result.content.includes('workspace-2-original')) &&
      second.some((result) => result.content.includes('workspace-2-original')) &&
      !second.some((result) => result.content.includes('workspace-1-original'));

    await writeFile(
      path.join(projects[0], 'docs', 'comet', 'specs', 'fixture.md'),
      '# Fixture\n\nworkspace-1-mutated\n',
    );
    const mutated = await providers[0].retrieve(
      createProjectKnowledgeQuery({ task: 'workspace-1-mutated' }),
    );
    const mutationDetected = mutated.some((result) =>
      result.content.includes('workspace-1-mutated'),
    );

    const databasePath = providers[0].indexStore?.databasePath;
    if (databasePath) await writeFile(databasePath, 'not a sqlite database\n');
    const recovered = await providers[0].retrieve(
      createProjectKnowledgeQuery({ task: 'workspace-1-mutated' }),
    );
    const quarantined = databasePath
      ? (await readdir(path.dirname(databasePath))).some((name) =>
          name.startsWith(`${path.basename(databasePath)}.corrupt-`),
        )
      : false;
    return {
      isolated,
      mutationDetected,
      corruptIndexRecovered: quarantined && recovered.length >= 0,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
}

async function evaluate(indexEnabled, useRipgrep = true) {
  const provider = new LocalProjectKnowledgeProvider({
    projectRoot,
    corpus,
    indexEnabled,
    ...(indexEnabled && !useRipgrep
      ? {
          runRipgrep: async () => ({
            stdout: '',
            stderr: '',
            exitCode: 1,
            timedOut: false,
            truncated: false,
            matchLimitReached: false,
          }),
        }
      : {}),
    ...(cacheRoot ? { cacheRoot } : {}),
  });
  const rows = [];
  for (const entry of dataset.cases) {
    const started = performance.now();
    const results = await provider.retrieve(createProjectKnowledgeQuery({ task: entry.query }));
    const sources = results.slice(0, dataset.topK).map((result) => result.source);
    const firstGold = sources.findIndex((source) => entry.goldSources.includes(source));
    const relevance = sources.map((source) => (entry.goldSources.includes(source) ? 1 : 0));
    const dcg = relevance.reduce(
      (sum, value, index) => sum + (value === 0 ? 0 : value / Math.log2(index + 2)),
      0,
    );
    const ideal = Math.min(dataset.topK, entry.goldSources.length);
    const idcg = Array.from({ length: ideal }, (_, index) => 1 / Math.log2(index + 2)).reduce(
      (sum, value) => sum + value,
      0,
    );
    const forbidden = sources.filter((source) =>
      (entry.forbiddenSourcePrefixes ?? []).some((prefix) => source.startsWith(prefix)),
    );
    rows.push({
      id: entry.id,
      category: entry.category,
      sources,
      hit: entry.expectedAbstain ? sources.length === 0 : firstGold >= 0,
      reciprocalRank: firstGold >= 0 ? 1 / (firstGold + 1) : 0,
      ndcgAt4: idcg === 0 ? 0 : dcg / idcg,
      sourceDiversity: new Set(sources.map((source) => source.split('/')[0])).size,
      forbidden,
      elapsedMs: performance.now() - started,
      returnedBytes: results.reduce(
        (sum, result) => sum + Buffer.byteLength(result.content ?? ''),
        0,
      ),
      indexReadBytes: provider.indexStore?.lastSyncReadBytes ?? 0,
    });
  }
  const gold = rows.filter((row) => !row.id.startsWith('none-'));
  const exact = rows.filter((row) => row.category === 'exact');
  const sortedLatency = rows.map((row) => row.elapsedMs).sort((left, right) => left - right);
  const warmLatency = rows
    .slice(1)
    .map((row) => row.elapsedMs)
    .sort((left, right) => left - right);
  const successful = rows.filter((row) => !row.id.startsWith('none-'));
  const p50Index = Math.max(0, Math.ceil(sortedLatency.length * 0.5) - 1);
  let indexSizeBytes = 0;
  if (indexEnabled) {
    try {
      const databasePath = provider.indexStore?.databasePath;
      if (databasePath) indexSizeBytes = Number((await stat(databasePath)).size);
    } catch {
      // A missing projection is itself useful eval evidence and remains zero.
    }
  }
  return {
    recallAt4: gold.filter((row) => row.hit).length / gold.length,
    exactRecallAt4: exact.filter((row) => row.hit).length / exact.length,
    mrr: gold.reduce((sum, row) => sum + row.reciprocalRank, 0) / gold.length,
    nDcgAt4: successful.reduce((sum, row) => sum + row.ndcgAt4, 0) / Math.max(1, successful.length),
    sourceDiversity:
      rows.reduce((sum, row) => sum + row.sourceDiversity, 0) / Math.max(1, rows.length),
    abstainAccuracy:
      rows.filter((row) => row.id.startsWith('none-') && row.hit).length /
      rows.filter((row) => row.id.startsWith('none-')).length,
    forbiddenSourceCount: rows.reduce((sum, row) => sum + row.forbidden.length, 0),
    p95Ms: sortedLatency[Math.max(0, Math.ceil(sortedLatency.length * 0.95) - 1)] ?? 0,
    warmP95Ms:
      warmLatency[Math.max(0, Math.ceil(warmLatency.length * 0.95) - 1)] ??
      sortedLatency[Math.max(0, Math.ceil(sortedLatency.length * 0.95) - 1)] ??
      0,
    p50Ms: sortedLatency[p50Index] ?? 0,
    indexSizeBytes,
    returnedBytes: rows.reduce((sum, row) => sum + row.returnedBytes, 0),
    indexReadBytes: rows.reduce((sum, row) => sum + row.indexReadBytes, 0),
    rows,
  };
}

const ripgrep = await evaluate(false);
const fts = await evaluate(true, false);
const hybrid = await evaluate(true, true);
const fixtureChecks = await runFixtureChecks();
const report = {
  schema: dataset.schema,
  projectRoot,
  cases: dataset.cases.length,
  ripgrep,
  fts,
  hybrid,
  fixtureChecks,
  exactRecallNotRegressed: hybrid.exactRecallAt4 >= ripgrep.exactRecallAt4,
  hybridImprovesNdcgOverRipgrep: hybrid.nDcgAt4 > ripgrep.nDcgAt4,
  workspaceScopedIndex: fixtureChecks.isolated,
};
console.log(
  JSON.stringify(
    summaryOnly
      ? {
          ...report,
          ripgrep: { ...ripgrep, rows: undefined },
          fts: { ...fts, rows: undefined },
          hybrid: { ...hybrid, rows: undefined },
        }
      : report,
    null,
    2,
  ),
);
if (
  enforce &&
  (!report.exactRecallNotRegressed ||
    !report.hybridImprovesNdcgOverRipgrep ||
    hybrid.forbiddenSourceCount > 0 ||
    hybrid.warmP95Ms > 200 ||
    !report.workspaceScopedIndex ||
    !fixtureChecks.mutationDetected ||
    !fixtureChecks.corruptIndexRecovered)
) {
  process.exitCode = 1;
}
