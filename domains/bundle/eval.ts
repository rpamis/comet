import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { compileBundleIr } from './compiler.js';
import { loadBundle } from './load.js';
import {
  readBundleAuthoringState,
  reconcileBundleAuthoringState,
  writeBundleAuthoringState,
} from './state.js';
import type { BundleAuthoringState, BundleCompilerIr } from './types.js';

export interface BundleEvalPlan {
  level: 'quick' | 'full';
  components: string[];
  estimatedRuns: number;
  tokenWorkload: 'low' | 'medium' | 'high';
  explanation: string;
}

export interface RepositoryEvalResult {
  schemaVersion: 2;
  provider: 'comet-eval';
  level: 'quick' | 'full';
  draftHash: string;
  evalManifestHash: string;
  tasks: string[];
  treatments: string[];
  passAtK: Record<string, number>;
  weightedScore: Record<string, number>;
  instabilityGap: Record<string, number>;
  failures: string[];
  reports: string[];
  passed: boolean;
  summary: string;
}

export type BundleEvalEvidenceResult = RepositoryEvalResult;

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertStringArray(
  value: unknown,
  label: string,
  allowEmpty = false,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string') ||
    (!allowEmpty && value.length === 0)
  ) {
    throw new Error(`${label} must be a non-empty string array`);
  }
}

function assertRate(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number between 0 and 1`);
  }
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash`);
  }
}

function assertRateRecord(value: unknown, label: string): asserts value is Record<string, number> {
  assertObject(value, label);
  for (const [key, rate] of Object.entries(value)) {
    if (!key) throw new Error(`${label} keys must be non-empty strings`);
    assertRate(rate, `${label}.${key}`);
  }
}

function parseRepositoryEvalResult(value: Record<string, unknown>): RepositoryEvalResult {
  assertObject(value, 'Eval result');
  if (value.schemaVersion !== 2) throw new Error('Eval result schemaVersion must be 2');
  if (value.provider !== 'comet-eval') {
    throw new Error('Eval result provider is unsupported');
  }
  if (!['quick', 'full'].includes(String(value.level))) {
    throw new Error('Eval result level must be quick or full');
  }
  assertHash(value.draftHash, 'Eval result draftHash');
  assertHash(value.evalManifestHash, 'Eval result evalManifestHash');
  assertStringArray(value.tasks, 'Eval result tasks');
  assertStringArray(value.treatments, 'Eval result treatments');
  assertRateRecord(value.passAtK, 'Eval result passAtK');
  assertRateRecord(value.weightedScore, 'Eval result weightedScore');
  assertRateRecord(value.instabilityGap, 'Eval result instabilityGap');
  assertStringArray(value.failures, 'Eval result failures', true);
  assertStringArray(value.reports, 'Eval result reports', true);
  if (typeof value.passed !== 'boolean') {
    throw new Error('Eval result passed must be a boolean');
  }
  if (typeof value.summary !== 'string' || !value.summary.trim()) {
    throw new Error('Eval result summary must be a non-empty string');
  }
  return value as unknown as RepositoryEvalResult;
}

function parseEvalResult(value: unknown): BundleEvalEvidenceResult {
  assertObject(value, 'Eval result');
  if (value.schemaVersion === 2) return parseRepositoryEvalResult(value);
  throw new Error('Eval result schemaVersion must be 2');
}

function evalResultHash(result: BundleEvalEvidenceResult): string {
  return result.draftHash;
}

function evalEvidencePathSegments(result: BundleEvalEvidenceResult): string[] {
  return [result.draftHash, result.evalManifestHash];
}

async function resultMatchesCurrentDraft(
  state: BundleAuthoringState,
  result: BundleEvalEvidenceResult,
): Promise<boolean> {
  if (!state.currentHash) return false;
  return result.draftHash === state.currentHash;
}

function projectRelativeReport(projectRoot: string, report: string): string | null {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(projectRoot, report));
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return `./${relative.replaceAll(path.sep, '/')}`;
}

function portableEvalEvidence(
  projectRoot: string,
  result: BundleEvalEvidenceResult,
): BundleEvalEvidenceResult {
  return {
    ...result,
    reports: result.reports
      .map((report) => projectRelativeReport(projectRoot, report))
      .filter((report): report is string => report !== null),
  };
}

async function writeEvidence(
  projectRoot: string,
  name: string,
  result: BundleEvalEvidenceResult,
): Promise<string> {
  const persistedResult = portableEvalEvidence(projectRoot, result);
  const directory = path.resolve(
    projectRoot,
    '.comet',
    'bundle-evals',
    name,
    ...evalEvidencePathSegments(persistedResult),
  );
  const destination = path.join(directory, 'result.json');
  const temporary = path.join(directory, `.result.${randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporary, JSON.stringify(persistedResult, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
    });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return destination;
}

function stateWithEval(
  state: BundleAuthoringState,
  result: BundleEvalEvidenceResult,
  resultPath: string,
): BundleAuthoringState {
  const gatesPassed = result.passed && result.failures.length === 0;
  const updated: BundleAuthoringState = {
    ...state,
    status: gatesPassed ? 'eval-passed' : 'draft',
    eval: {
      level: result.level,
      hash: evalResultHash(result),
      resultPath,
      passed: gatesPassed,
    },
  };
  delete updated.review;
  delete updated.ready;
  delete updated.conflict;
  return updated;
}

export function planBundleEval(ir: BundleCompilerIr, level: 'quick' | 'full'): BundleEvalPlan {
  const entries = ir.skills.filter((skill) => skill.visibility === 'entry').length;
  const quickComponents = [
    'static',
    'entry-smoke',
    'baseline',
    'assertion-grading',
    'platform-compile',
  ];
  const quickRuns = 4 + entries * 2;
  if (level === 'quick') {
    return {
      level,
      components: quickComponents,
      estimatedRuns: quickRuns,
      tokenWorkload: entries > 2 ? 'medium' : 'low',
      explanation: `Descriptive estimate for ${entries} entry Skill(s); actual token use depends on the provider and prompts.`,
    };
  }
  return {
    level,
    components: [
      ...quickComponents,
      'trigger-accuracy',
      'routing-overlap',
      'behavior-effects',
      'multi-platform',
      'failure-analysis',
      'blind-comparison',
      'optimization',
    ],
    estimatedRuns: quickRuns + 6 + entries * 3,
    tokenWorkload: 'high',
    explanation: `Descriptive estimate for a multi-run full evaluation of ${entries} entry Skill(s); it is not a token commitment.`,
  };
}

export async function recordBundleEval(
  projectRoot: string,
  name: string,
  resultFile: string,
): Promise<BundleAuthoringState> {
  const result = parseEvalResult(JSON.parse(await fs.readFile(resultFile, 'utf8')) as unknown);
  let state = await reconcileBundleAuthoringState(projectRoot, name);
  if (!(await resultMatchesCurrentDraft(state, result))) {
    await writeEvidence(projectRoot, name, result);
    return state;
  }

  const bundle = await loadBundle(state.draftPath);
  const ir = await compileBundleIr(bundle, { locale: state.defaultLocale });
  if (ir.bundle.hash !== state.currentHash) {
    state = await reconcileBundleAuthoringState(projectRoot, name);
    await writeEvidence(projectRoot, name, result);
    return state;
  }
  const resultPath = await writeEvidence(projectRoot, name, result);
  const updated = stateWithEval(state, result, resultPath);
  await writeBundleAuthoringState(projectRoot, updated);
  return updated;
}

export async function readBundleEvalResult(resultPath: string): Promise<BundleEvalEvidenceResult> {
  return parseEvalResult(JSON.parse(await fs.readFile(resultPath, 'utf8')) as unknown);
}

export async function readRecordedBundleEval(
  projectRoot: string,
  name: string,
): Promise<BundleEvalEvidenceResult | null> {
  const state = await readBundleAuthoringState(projectRoot, name);
  if (!state.eval) return null;
  return readBundleEvalResult(state.eval.resultPath);
}
