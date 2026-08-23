import { readFile, writeFile } from 'node:fs/promises';

const MODES = ['none', 'rg', 'fts', 'hybrid'];

const REQUIRED_EVIDENCE_FIELDS = [
  'snapshotId',
  'model',
  'promptVersion',
  'worktreeId',
  'supplementalQuerySet',
];

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function summaryStats(entries, field) {
  const values = entries
    .map((entry) => entry?.[field])
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0)
    return { mean: null, standardDeviation: null, coefficientOfVariation: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  const standardDeviation = Math.sqrt(variance);
  return {
    mean,
    standardDeviation,
    coefficientOfVariation: mean === 0 ? null : standardDeviation / Math.abs(mean),
  };
}

export function summarizeAgentAB(runs) {
  const groups = new Map(MODES.map((mode) => [mode, []]));
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!groups.has(run.mode)) continue;
    groups.get(run.mode).push(run);
  }
  const modes = {};
  for (const mode of MODES) {
    const entries = groups.get(mode);
    const count = entries.length;
    if (count === 0) {
      modes[mode] = { runs: 0 };
      continue;
    }
    modes[mode] = {
      runs: count,
      successRate: entries.filter((entry) => entry.success === true).length / count,
      firstGoldModuleTurns:
        entries.reduce((sum, entry) => sum + numberOrZero(entry.firstGoldModuleTurns), 0) / count,
      searchesBeforeEdit:
        entries.reduce((sum, entry) => sum + numberOrZero(entry.searchesBeforeEdit), 0) / count,
      unrelatedModules:
        entries.reduce((sum, entry) => sum + numberOrZero(entry.unrelatedModules), 0) / count,
      changeCoverage:
        entries.reduce((sum, entry) => sum + numberOrZero(entry.changeCoverage), 0) / count,
      tokens: entries.reduce((sum, entry) => sum + numberOrZero(entry.tokens), 0) / count,
      toolCalls: entries.reduce((sum, entry) => sum + numberOrZero(entry.toolCalls), 0) / count,
      latencyMs: entries.reduce((sum, entry) => sum + numberOrZero(entry.latencyMs), 0) / count,
      anchoredByWrongKnowledge: entries.filter((entry) => entry.anchoredByWrongKnowledge === true)
        .length,
      replications: count,
      statistics: {
        searchesBeforeEdit: summaryStats(entries, 'searchesBeforeEdit'),
        changeCoverage: summaryStats(entries, 'changeCoverage'),
        tokens: summaryStats(entries, 'tokens'),
        toolCalls: summaryStats(entries, 'toolCalls'),
        latencyMs: summaryStats(entries, 'latencyMs'),
      },
    };
  }
  const baseline = modes.none.runs > 0 ? modes.none : modes.rg;
  const hybrid = modes.hybrid;
  const explorationReduction =
    baseline?.searchesBeforeEdit > 0 && hybrid?.runs > 0
      ? 1 - hybrid.searchesBeforeEdit / baseline.searchesBeforeEdit
      : null;
  return {
    schema: 'comet.project-knowledge.agent-ab.v1',
    modes,
    comparison: {
      baselineMode: modes.none.runs > 0 ? 'none' : 'rg',
      hybridSuccessNotLower:
        baseline?.runs > 0 && hybrid?.runs > 0 ? hybrid.successRate >= baseline.successRate : null,
      explorationReduction,
      meetsTwentyPercentExplorationTarget:
        explorationReduction === null ? null : explorationReduction >= 0.2,
      changeCoverageNotLower:
        baseline?.runs > 0 && hybrid?.runs > 0
          ? hybrid.changeCoverage >= baseline.changeCoverage
          : null,
    },
    evidence: evidenceSummary(runs),
  };
}

function evidenceSummary(runs) {
  const entries = Array.isArray(runs) ? runs : [];
  const missing = new Set();
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    if (entries.some((entry) => entry && entry[field] !== undefined)) continue;
    missing.add(field);
  }
  const snapshots = new Set(entries.map((entry) => entry?.snapshotId).filter(Boolean));
  const models = new Set(entries.map((entry) => entry?.model).filter(Boolean));
  const prompts = new Set(entries.map((entry) => entry?.promptVersion).filter(Boolean));
  const worktrees = new Set(entries.map((entry) => entry?.worktreeId).filter(Boolean));
  const supplemental = entries.filter((entry) => entry?.supplementalQuerySet !== undefined);
  const replicationCounts = Object.fromEntries(
    MODES.map((mode) => [mode, entries.filter((entry) => entry?.mode === mode).length]),
  );
  return {
    decisionReady:
      missing.size === 0 &&
      snapshots.size === 1 &&
      models.size === 1 &&
      prompts.size === 1 &&
      worktrees.size >= 2 &&
      supplemental.length > 0 &&
      MODES.every((mode) => (replicationCounts[mode] ?? 0) >= 3),
    missing: [...missing],
    snapshotCount: snapshots.size,
    modelCount: models.size,
    promptVersionCount: prompts.size,
    worktreeCount: worktrees.size,
    supplementalQueryRuns: supplemental.length,
    replicationCounts,
    minimumReplicationsMet: MODES.every((mode) => (replicationCounts[mode] ?? 0) >= 3),
  };
}

export async function runAgentAB(inputPath, outputPath) {
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const report = summarizeAgentAB(input.runs);
  if (input.metadata && typeof input.metadata === 'object') {
    report.metadata = input.metadata;
  }
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('agent-ab.mjs')) {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath) {
    console.error('Usage: node agent-ab.mjs <runs.json> [report.json]');
    process.exitCode = 1;
  } else {
    runAgentAB(inputPath, outputPath).then((report) => {
      console.log(JSON.stringify(report, null, 2));
    });
  }
}
