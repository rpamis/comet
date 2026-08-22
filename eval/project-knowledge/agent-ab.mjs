import { readFile, writeFile } from 'node:fs/promises';

const MODES = ['none', 'rg', 'hybrid', 'unit'];

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
  };
}

export async function runAgentAB(inputPath, outputPath) {
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const report = summarizeAgentAB(input.runs);
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
