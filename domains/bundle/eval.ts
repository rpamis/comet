import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { compileBundleIr } from './compiler.js';
import { loadBundle } from './load.js';
import {
  readBundleAuthoringState,
  reconcileBundleAuthoringState,
  writeBundleAuthoringState,
} from './state.js';
import { loadNormalizedHook } from './validate.js';
import type {
  BundleAuthoringState,
  BundleCapability,
  BundleCompilerIr,
  BundleManifest,
} from './types.js';

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

export interface BundleControlPlaneValidation {
  passed: boolean;
  evidence: string[];
  errors: string[];
}

const REQUIRED_FACTORY_CONTROL_PLANE = [
  'SKILL.md',
  'reference/resolved-skills.json',
  'reference/workflow-protocol.json',
  'reference/decision-points.md',
  'reference/recovery.md',
  'reference/authoring-lanes.json',
  'reference/skill-review.md',
  'reference/composition-report.md',
  'reference/subagents/script-author.md',
  'scripts/comet-plan.mjs',
  'scripts/comet-check.mjs',
  'scripts/comet-hook-guard.mjs',
  'scripts/workflow-state.mjs',
  'scripts/workflow-guard.mjs',
  'scripts/workflow-handoff.mjs',
] as const;

const REQUIRED_FACTORY_ENGINE_CONTROL_PLANE = [
  'comet/skill.yaml',
  'comet/guardrails.yaml',
  'comet/checks.yaml',
  'comet/eval.yaml',
] as const;

const REQUIRED_FACTORY_CAPABILITIES: BundleCapability[] = [
  'skills',
  'scripts',
  'rules',
  'hooks',
  'references',
];

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

export async function validateStableFactoryControlPlane(
  state: BundleAuthoringState,
): Promise<BundleControlPlaneValidation> {
  const generated = state.factory?.generatedSkillPackage;
  if (!generated) {
    return {
      passed: true,
      evidence: ['not a generated factory package'],
      errors: [],
    };
  }

  const actualPackageRoot = path.resolve(generated.packageRoot);
  const expectedPackageRoot = path.resolve(state.draftPath, 'skills', generated.entrySkill);
  if (actualPackageRoot !== expectedPackageRoot) {
    return {
      passed: false,
      evidence: [],
      errors: [
        `generated packageRoot mismatch: expected ${expectedPackageRoot}, got ${actualPackageRoot}`,
      ],
    };
  }

  const evidence: string[] = [];
  const errors: string[] = [];
  let manifest: BundleManifest | null = null;
  try {
    const bundle = await loadBundle(state.draftPath);
    manifest = bundle.manifest;
    evidence.push('bundle.yaml');
    await compileBundleIr(bundle, { locale: state.defaultLocale });
  } catch (error) {
    errors.push(`bundle.yaml invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  const required = [
    ...REQUIRED_FACTORY_CONTROL_PLANE,
    ...(state.factory?.engineMode === 'none' ? [] : REQUIRED_FACTORY_ENGINE_CONTROL_PLANE),
  ];
  for (const relative of required) {
    const target = path.join(generated.packageRoot, relative);
    try {
      const stats = await fs.stat(target);
      if (stats.isFile()) {
        evidence.push(relative);
      } else {
        errors.push(`missing ${relative}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      errors.push(`missing ${relative}`);
    }
  }

  if (manifest) {
    await validateFactoryManifestResources({
      draftPath: state.draftPath,
      entrySkill: generated.entrySkill,
      manifest,
      evidence,
      errors,
    });
  }

  await validateGeneratedScriptContracts(
    generated.packageRoot,
    state.factory?.engineMode ?? 'deterministic',
    evidence,
    errors,
  );

  return {
    passed: errors.length === 0,
    evidence,
    errors,
  };
}

function hasCapability(manifest: BundleManifest, capability: BundleCapability): boolean {
  return manifest.platforms.requires.includes(capability);
}

function resourceSet<T extends { id: string; path: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

async function validateFactoryManifestResources(options: {
  draftPath: string;
  entrySkill: string;
  manifest: BundleManifest;
  evidence: string[];
  errors: string[];
}): Promise<void> {
  const { draftPath, entrySkill, manifest, evidence, errors } = options;
  const missingCapabilities = REQUIRED_FACTORY_CAPABILITIES.filter(
    (capability) => !hasCapability(manifest, capability),
  );
  if (missingCapabilities.length > 0) {
    errors.push(`required capabilities missing: ${missingCapabilities.join(', ')}`);
  } else {
    evidence.push(`required capabilities: ${REQUIRED_FACTORY_CAPABILITIES.join(', ')}`);
  }

  const rules = resourceSet(manifest.resources.rules);
  const hooks = resourceSet(manifest.resources.hooks);
  const scripts = resourceSet(manifest.resources.scripts);
  const scriptIds = new Set(manifest.resources.scripts.map((script) => script.id));
  const references = new Set(manifest.resources.references);
  const expectedRules = [
    {
      id: `${entrySkill}-orchestration`,
      path: `rules/${entrySkill}-orchestration.md`,
    },
  ];
  const expectedHooks = [
    {
      id: `${entrySkill}-before-write-guard`,
      path: `hooks/${entrySkill}-before-write-guard.yaml`,
      event: 'before_write' as const,
    },
    {
      id: `${entrySkill}-before-tool-guard`,
      path: `hooks/${entrySkill}-before-tool-guard.yaml`,
      event: 'before_tool' as const,
    },
  ];
  const expectedScripts = [
    {
      id: 'comet-plan',
      path: `skills/${entrySkill}/scripts/comet-plan.mjs`,
    },
    {
      id: 'comet-check',
      path: `skills/${entrySkill}/scripts/comet-check.mjs`,
    },
    {
      id: 'comet-hook-guard',
      path: `skills/${entrySkill}/scripts/comet-hook-guard.mjs`,
    },
    {
      id: 'workflow-state',
      path: `skills/${entrySkill}/scripts/workflow-state.mjs`,
    },
    {
      id: 'workflow-guard',
      path: `skills/${entrySkill}/scripts/workflow-guard.mjs`,
    },
    {
      id: 'workflow-handoff',
      path: `skills/${entrySkill}/scripts/workflow-handoff.mjs`,
    },
  ];
  const expectedReferences = [
    `skills/${entrySkill}/reference/resolved-skills.json`,
    `skills/${entrySkill}/reference/workflow-protocol.json`,
    `skills/${entrySkill}/reference/decision-points.md`,
    `skills/${entrySkill}/reference/recovery.md`,
    `skills/${entrySkill}/reference/authoring-lanes.json`,
    `skills/${entrySkill}/reference/skill-review.md`,
    `skills/${entrySkill}/reference/composition-report.md`,
    `skills/${entrySkill}/reference/subagents/script-author.md`,
  ];
  for (const rule of expectedRules) {
    const actual = rules.get(rule.id);
    if (!actual || actual.path !== rule.path || !actual.required) {
      errors.push(`manifest missing required rule ${rule.id} at ${rule.path}`);
    } else {
      evidence.push(`rule:${rule.id}`);
    }
  }
  for (const script of expectedScripts) {
    const actual = scripts.get(script.id);
    if (!actual || actual.path !== script.path) {
      errors.push(`manifest missing required script ${script.id} at ${script.path}`);
    } else {
      evidence.push(`script:${script.id}`);
    }
  }
  for (const reference of expectedReferences) {
    if (!references.has(reference)) {
      errors.push(`manifest missing required reference ${reference}`);
    } else {
      evidence.push(`reference:${reference}`);
    }
  }
  for (const hook of expectedHooks) {
    const actual = hooks.get(hook.id);
    if (!actual || actual.path !== hook.path) {
      errors.push(`manifest missing required hook ${hook.id} at ${hook.path}`);
      continue;
    }
    try {
      const normalized = await loadNormalizedHook(
        { root: draftPath, manifest },
        actual,
        manifest.resources.hooks.findIndex((item) => item.id === actual.id),
        path.join(draftPath, actual.path),
      );
      if (normalized.event !== hook.event) {
        errors.push(`hook ${hook.id} event must be ${hook.event}`);
      }
      if (normalized.failure !== 'block') {
        errors.push(`hook ${hook.id} failure must be block`);
      }
      if (!scriptIds.has(normalized.script)) {
        errors.push(`hook ${hook.id} references undeclared script ${normalized.script}`);
      }
      if (normalized.script !== 'comet-hook-guard') {
        errors.push(`hook ${hook.id} must reference comet-hook-guard`);
      }
      if (
        hook.event === 'before_write' &&
        normalized.matcher !== undefined &&
        normalized.matcher !== 'Write|Edit'
      ) {
        errors.push(`hook ${hook.id} matcher must cover Write|Edit`);
      }
      evidence.push(`hook:${hook.id}:${hook.event}`);
    } catch (error) {
      errors.push(
        `hook ${hook.id} invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function validateGeneratedScriptContracts(
  packageRoot: string,
  engineMode: 'none' | 'deterministic' | 'adaptive',
  evidence: string[],
  errors: string[],
): Promise<void> {
  const checkScriptPath = path.join(packageRoot, 'scripts', 'comet-check.mjs');
  let source: string;
  try {
    source = await fs.readFile(checkScriptPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const requiredFragments = [
    'const command = process.argv[2] ??',
    "command !== 'verify'",
    'control-plane-ok',
    'scripts/comet-hook-guard.mjs',
    ...(engineMode === 'none' ? [] : ['comet/skill.yaml']),
  ];
  const workflowContractFragments = [
    'workflow-protocol.json must use the current schema with nodes',
    'workflow-contract-ok',
    'protocol.nodes',
  ];
  if (workflowContractFragments.every((fragment) => source.includes(fragment))) {
    evidence.push('script-contract:comet-check workflow protocol verify');
    return;
  }
  const missing = requiredFragments.filter((fragment) => !source.includes(fragment));
  if (missing.length > 0) {
    errors.push(`scripts/comet-check.mjs verify contract missing: ${missing.join(', ')}`);
  } else {
    evidence.push('script-contract:comet-check verify');
  }
}

function evalResultHash(result: BundleEvalEvidenceResult): string {
  return result.draftHash;
}

function evalEvidencePathSegments(result: BundleEvalEvidenceResult): string[] {
  return [result.draftHash, result.evalManifestHash];
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

async function readGeneratedEvalManifestIdentity(state: BundleAuthoringState): Promise<{
  evalManifestHash: string;
} | null> {
  const evalManifestPath = state.factory?.generatedSkillPackage?.evalManifestPath;
  if (!evalManifestPath) return null;
  const source = await fs.readFile(evalManifestPath, 'utf8');
  const manifest = parse(source) as Record<string, unknown>;
  assertObject(manifest, 'Generated eval manifest');
  return {
    evalManifestHash: sha256(source),
  };
}

async function resultMatchesCurrentDraft(
  state: BundleAuthoringState,
  result: BundleEvalEvidenceResult,
): Promise<boolean> {
  if (!state.currentHash) return false;
  const generatedManifest = await readGeneratedEvalManifestIdentity(state);
  if (!generatedManifest) {
    return result.draftHash === state.currentHash;
  }
  return (
    result.draftHash === state.currentHash &&
    result.evalManifestHash === generatedManifest.evalManifestHash
  );
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

function resultWouldPassEvalGates(result: BundleEvalEvidenceResult): boolean {
  return result.passed && result.failures.length === 0;
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

  const controlPlane = await validateStableFactoryControlPlane(state);
  if (!controlPlane.passed) {
    const resultPath = await writeEvidence(projectRoot, name, result);
    if (resultWouldPassEvalGates(result)) {
      throw new Error(`Bundle control plane is incomplete: ${controlPlane.errors.join(', ')}`);
    }
    const updated = stateWithEval(state, result, resultPath);
    await writeBundleAuthoringState(projectRoot, updated);
    return updated;
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
