import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { recordBundleEval, type RepositoryEvalResult } from './eval.js';

export interface RepositoryEvalContext {
  projectRoot: string;
  name: string;
  draftHash: string;
  evalManifestHash: string;
  sourceManifestPath: string;
}

export interface RepositoryEvalExperimentOptions {
  context: RepositoryEvalContext;
  experimentDir: string;
  level: 'quick' | 'full';
  manifestSource?: string;
}

interface ExpectedCase {
  task: string;
  treatment: string;
  rep: number;
}

interface EvalReport {
  name: string;
  passed: boolean;
  checks_passed: string[];
  checks_failed: string[];
}

interface EvalManifestPolicy {
  baselineTreatments: Set<string>;
  minWeightedScore: number | null;
  minPassAt1: number | null;
  maxInstabilityGap: number | null;
}

interface BuildDependencies {
  record?: typeof recordBundleEval;
  resultFile?: string;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function readGate(value: unknown, label: string): number | null {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number between 0 and 1`);
  }
  return value;
}

function parseManifestPolicy(source: string): EvalManifestPolicy {
  const manifest = parse(source) as unknown;
  assertObject(manifest, 'Eval manifest');
  const evaluation = manifest.evaluation ?? {};
  assertObject(evaluation, 'Eval manifest evaluation');
  const baselines = evaluation.baselineTreatments ?? evaluation.baseline_treatments ?? [];
  const gates = evaluation.qualityGates ?? evaluation.quality_gates ?? {};
  assertObject(gates, 'Eval manifest qualityGates');
  return {
    baselineTreatments: new Set(readStringArray(baselines, 'Eval manifest baselineTreatments')),
    minWeightedScore: readGate(
      gates.minWeightedScore ?? gates.min_weighted_score,
      'qualityGates.minWeightedScore',
    ),
    minPassAt1: readGate(gates.minPassAt1 ?? gates.min_pass_at_1, 'qualityGates.minPassAt1'),
    maxInstabilityGap: readGate(
      gates.maxInstabilityGap ?? gates.max_instability_gap,
      'qualityGates.maxInstabilityGap',
    ),
  };
}

async function readExpectedCases(experimentDir: string): Promise<ExpectedCase[]> {
  const file = path.join(experimentDir, 'expected-case-matrix.json');
  const value = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  assertObject(value, 'Expected case matrix');
  if (value.schema !== 'comet.eval.expected-case-matrix.v1') {
    throw new Error('Expected case matrix schema is unsupported');
  }
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    throw new Error('Expected case matrix must contain at least one case');
  }
  return value.cases.map((item, index) => {
    assertObject(item, `Expected case ${index + 1}`);
    if (
      typeof item.task !== 'string' ||
      !item.task ||
      typeof item.treatment !== 'string' ||
      !item.treatment ||
      !Number.isInteger(item.rep) ||
      Number(item.rep) < 1
    ) {
      throw new Error(`Expected case ${index + 1} is invalid`);
    }
    return { task: item.task, treatment: item.treatment, rep: Number(item.rep) };
  });
}

function parseReport(value: unknown, file: string): EvalReport {
  assertObject(value, `Eval report ${file}`);
  if (typeof value.name !== 'string' || !value.name) {
    throw new Error(`Eval report ${file} name must be a non-empty string`);
  }
  if (typeof value.passed !== 'boolean') {
    throw new Error(`Eval report ${file} passed must be a boolean`);
  }
  return {
    name: value.name,
    passed: value.passed,
    checks_passed: readStringArray(value.checks_passed, `Eval report ${file} checks_passed`),
    checks_failed: readStringArray(value.checks_failed, `Eval report ${file} checks_failed`),
  };
}

async function readReports(experimentDir: string): Promise<Map<string, EvalReport>> {
  const reportsDir = path.join(experimentDir, 'reports');
  const entries = (await fs.readdir(reportsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name));
  const reports = new Map<string, EvalReport>();
  for (const entry of entries) {
    const file = path.join(reportsDir, entry.name);
    const report = parseReport(JSON.parse(await fs.readFile(file, 'utf8')) as unknown, file);
    if (reports.has(report.name)) {
      throw new Error(`Duplicate eval report name: ${report.name}`);
    }
    reports.set(report.name, report);
  }
  return reports;
}

function weightedScore(report: EvalReport): number | null {
  for (const check of report.checks_passed) {
    const match = /^\[RUBRIC\] weighted_score:\s*(\d+(?:\.\d+)?)\b/u.exec(check);
    if (!match) continue;
    const score = Number(match[1]);
    if (Number.isFinite(score) && score >= 0 && score <= 1) return score;
  }
  return null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function reportName(expected: ExpectedCase): string {
  return `${expected.task}-${expected.treatment}-r${expected.rep}`;
}

async function readReportOutputs(experimentDir: string): Promise<string[]> {
  const metadataFile = path.join(experimentDir, 'metadata.json');
  const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8')) as unknown;
  assertObject(metadata, 'Eval metadata');
  const outputs = metadata.report_outputs ?? {};
  assertObject(outputs, 'Eval metadata report_outputs');
  return Object.values(outputs)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

export async function buildRepositoryEvalResult(
  options: RepositoryEvalExperimentOptions,
): Promise<RepositoryEvalResult> {
  const manifestSource =
    options.manifestSource ?? (await fs.readFile(options.context.sourceManifestPath, 'utf8'));
  const policy = parseManifestPolicy(manifestSource);
  const expectedCases = await readExpectedCases(options.experimentDir);
  const reportsByName = await readReports(options.experimentDir);
  const tasks = [...new Set(expectedCases.map((item) => item.task))].sort((a, b) =>
    a.localeCompare(b),
  );
  const treatments = [...new Set(expectedCases.map((item) => item.treatment))].sort((a, b) =>
    a.localeCompare(b),
  );
  const candidateCases = expectedCases.filter(
    (item) => !policy.baselineTreatments.has(item.treatment),
  );
  if (candidateCases.length === 0) {
    throw new Error('Eval manifest leaves no non-baseline treatment to assess');
  }

  const failures: string[] = [];
  const passAtK: Record<string, number> = {};
  const weightedScoreByTask: Record<string, number> = {};
  const instabilityGap: Record<string, number> = {};

  for (const task of tasks) {
    const taskCases = candidateCases.filter((item) => item.task === task);
    if (taskCases.length === 0) continue;
    const taskReports = taskCases.map((item) => {
      const name = reportName(item);
      const report = reportsByName.get(name);
      if (!report) throw new Error(`Missing eval report for expected case ${name}`);
      return { item, report };
    });
    const passedCount = taskReports.filter(
      ({ report }) => report.passed && report.checks_failed.length === 0,
    ).length;
    const passRate = passedCount / taskReports.length;
    const reliabilityFloor = passedCount === taskReports.length ? 1 : 0;
    passAtK[task] = passRate;
    instabilityGap[task] = passRate - reliabilityFloor;

    const scores = taskReports.map(({ item, report }) => {
      const score = weightedScore(report);
      if (score === null) {
        failures.push(`${reportName(item)} did not report a weighted score`);
        return 0;
      }
      return score;
    });
    weightedScoreByTask[task] = mean(scores);

    for (const { item, report } of taskReports) {
      if (!report.passed || report.checks_failed.length > 0) {
        const detail =
          report.checks_failed.length > 0 ? `: ${report.checks_failed.join('; ')}` : '';
        failures.push(`${reportName(item)} failed${detail}`);
      }
    }
    if (policy.minWeightedScore !== null && weightedScoreByTask[task] < policy.minWeightedScore) {
      failures.push(
        `${task} weighted score ${weightedScoreByTask[task]} is below required ${policy.minWeightedScore}`,
      );
    }
    if (policy.minPassAt1 !== null && passAtK[task] < policy.minPassAt1) {
      failures.push(`${task} pass@1 ${passAtK[task]} is below required ${policy.minPassAt1}`);
    }
    if (policy.maxInstabilityGap !== null && instabilityGap[task] > policy.maxInstabilityGap) {
      failures.push(
        `${task} instability gap ${instabilityGap[task]} exceeds allowed ${policy.maxInstabilityGap}`,
      );
    }
  }

  const reports = await readReportOutputs(options.experimentDir);
  const passed = failures.length === 0;
  return {
    schemaVersion: 2,
    provider: 'comet-eval',
    level: options.level,
    draftHash: options.context.draftHash,
    evalManifestHash: options.context.evalManifestHash,
    tasks,
    treatments,
    passAtK,
    weightedScore: weightedScoreByTask,
    instabilityGap,
    failures,
    reports,
    passed,
    summary: passed
      ? `Repository eval gates passed for ${Object.keys(passAtK).length} task(s).`
      : `Repository eval gates failed: ${failures.join('; ')}`,
  };
}

export async function recordRepositoryEvalExperiment(
  options: RepositoryEvalExperimentOptions,
  dependencies: BuildDependencies = {},
): Promise<Awaited<ReturnType<typeof recordBundleEval>>> {
  const result = await buildRepositoryEvalResult(options);
  const resultFile =
    dependencies.resultFile ?? path.join(options.experimentDir, 'repository-eval-result.json');
  await fs.writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  const state = await (dependencies.record ?? recordBundleEval)(
    options.context.projectRoot,
    options.context.name,
    resultFile,
  );
  if (!result.passed) {
    throw new Error(result.summary);
  }
  return state;
}
