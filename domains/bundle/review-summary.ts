import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { compileBundleIr } from './compiler.js';
import { planBundleEval, readBundleEvalResult, validateStableFactoryControlPlane } from './eval.js';
import { hashBundle } from './hash.js';
import { loadBundle } from './load.js';
import { compileBundleForPlatform, type PlatformCompileReport } from './platform.js';
import { reconcileBundleAuthoringState } from './state.js';
import type {
  BundleAuthoringState,
  BundleCompilerIr,
  BundleGeneratedSkillPackage,
  SkillBundle,
} from './types.js';
import { listBundlePlatformTargets } from './bundle-platform.js';
import { readProjectSkillPreferences } from '../skill/preferences.js';
import {
  buildReadinessUserSummary,
  type BundleReadinessUserSummary,
} from './readiness-user-summary.js';

export interface BundleReviewReadiness {
  state: 'blocked' | 'reviewable' | 'publishable' | 'published';
  blockers: string[];
  warnings: string[];
  evidence: Record<string, string>;
}

export interface BundleReviewSummary {
  schemaVersion: 1;
  name: string;
  status: BundleAuthoringState['status'];
  hash: string | null;
  draftPath: string;
  factory: BundleAuthoringState['factory'] | null;
  compile: PlatformCompileReport;
  evalPlans: {
    quick: ReturnType<typeof planBundleEval>;
    full: ReturnType<typeof planBundleEval>;
  };
  eval: BundleAuthoringState['eval'] | null;
  review: BundleAuthoringState['review'] | null;
  ready: BundleAuthoringState['ready'] | null;
  readiness: BundleReviewReadiness;
  userSummary: BundleReadinessUserSummary;
}

const AUTHORING_PENDING_MARKER = '<!-- AUTHORING PENDING -->';

async function generatedPackageContains(root: string, needle: string): Promise<boolean> {
  let entries: Array<import('fs').Dirent>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (await generatedPackageContains(target, needle)) return true;
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      if ((await fs.readFile(target, 'utf8')).includes(needle)) return true;
    } catch {
      // Generated packages are expected to be text, but unreadable platform files
      // should not hide other readiness evidence.
    }
  }
  return false;
}

async function generatedEntrySkillContains(root: string, needle: string): Promise<boolean> {
  try {
    return (await fs.readFile(path.join(root, 'SKILL.md'), 'utf8')).includes(needle);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

function generatedPackageRoots(generatedPackage: BundleGeneratedSkillPackage): string[] {
  const skillsRoot = path.dirname(generatedPackage.packageRoot);
  return Array.from(
    new Set([
      path.resolve(generatedPackage.packageRoot),
      ...generatedPackage.internalSkills.map((skill) => path.resolve(skillsRoot, skill)),
    ]),
  );
}

async function generatedSkillPackageContains(
  generatedPackage: BundleGeneratedSkillPackage,
  needle: string,
): Promise<boolean> {
  for (const root of generatedPackageRoots(generatedPackage)) {
    if (await generatedPackageContains(root, needle)) return true;
  }
  return false;
}

async function repositoryEvalFailureSummary(state: BundleAuthoringState): Promise<string | null> {
  if (!state.eval?.resultPath || state.eval.hash !== state.currentHash) {
    return null;
  }
  try {
    const result = await readBundleEvalResult(state.eval.resultPath);
    if (!result.passed || result.failures.length > 0) {
      return result.summary;
    }
  } catch {
    return null;
  }
  return null;
}

async function buildReadiness(
  state: BundleAuthoringState,
  controlPlane: Awaited<ReturnType<typeof validateStableFactoryControlPlane>>,
  compile?: PlatformCompileReport,
  currentPreferenceHash?: string | null,
): Promise<BundleReviewReadiness> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const workflowProtocol = state.factory?.workflowProtocol;
  const unresolved =
    state.factory?.resolvedSkills.filter(
      (skill) => skill.status === 'missing' || skill.status === 'ambiguous',
    ) ?? [];
  if (unresolved.length > 0) {
    blockers.push(
      `[candidate] Unresolved Skill Creator candidates: ${unresolved
        .map((skill) => `${skill.query} (${skill.status})`)
        .join(', ')}`,
    );
  }
  const required = new Set(state.factory?.requiredSkills ?? []);
  const unresolvedRequired = unresolved.filter((skill) => required.has(skill.query));
  if (state.factory?.preferenceMode === 'strict' && unresolvedRequired.length > 0) {
    blockers.push(
      `[preference] Required Skill candidates are unresolved: ${unresolvedRequired
        .map((skill) => `${skill.query} (${skill.status})`)
        .join(', ')}`,
    );
  }
  if (state.factory && state.factory.proposalConfirmation?.confirmed !== true) {
    blockers.push('[proposal] Skill Creator proposal confirmation is missing');
  }
  const storedPreferenceHash = state.factory?.preferenceHash ?? null;
  if (storedPreferenceHash && currentPreferenceHash !== storedPreferenceHash) {
    const message = '[preference] Project Skill preferences changed after Factory initialization';
    if (state.factory?.preferenceMode === 'strict') blockers.push(message);
    else warnings.push(message);
  }
  for (const issue of state.factory?.composition?.issues ?? []) {
    blockers.push(`[composition] ${issue.message}`);
  }
  for (const node of workflowProtocol?.nodes ?? []) {
    if (node.kind === 'control' && node.implementation.operation === 'override') {
      blockers.push(`[workflow] ${node.id}: control Node cannot be overridden`);
    }
    if (node.kind === 'producer' && node.implementation.operation === 'override') {
      const missing = node.outputSchemas.filter((schema) => !node.satisfies.includes(schema));
      if (missing.length > 0) {
        blockers.push(
          `[workflow] ${node.id}: producer override missing Output Schema ${missing.join(', ')}`,
        );
      }
    }
  }
  for (const error of controlPlane.errors) {
    blockers.push(`[control-plane] ${error}`);
  }
  if (!state.currentHash) blockers.push('[draft] Current draft hash is missing');
  const repoEvalFailure = await repositoryEvalFailureSummary(state);
  if (repoEvalFailure) {
    blockers.push(`[eval] Eval evidence is below publish quality gates: ${repoEvalFailure}`);
  } else if (!state.eval || state.eval.hash !== state.currentHash || !state.eval.passed) {
    blockers.push('[eval] Eval evidence for the current draft hash is missing');
  }
  if (state.eval?.passed && (!state.review || state.review.hash !== state.currentHash)) {
    warnings.push('[review] Review approval for the current draft hash is missing');
  }
  const generatedPackage = state.factory?.generatedSkillPackage;
  const authoringReview = state.factory?.authoringReview;
  if (generatedPackage) {
    if (await generatedEntrySkillContains(generatedPackage.packageRoot, AUTHORING_PENDING_MARKER)) {
      blockers.push('[authoring] Entry Decision Core is not authored');
    }
    if (await generatedSkillPackageContains(generatedPackage, AUTHORING_PENDING_MARKER)) {
      blockers.push('[authoring] Generated package still contains AUTHORING PENDING markers');
    }
    const unauthored = generatedPackage.unauthoredSubstanceNodes ?? [];
    if (unauthored.length > 0) {
      blockers.push(
        `[authoring] Substance nodes lack authored content (run skill-core lane): ${unauthored.join(', ')}`,
      );
    }
    if (!authoringReview) {
      warnings.push('[authoring] No LLM authoring review recorded; run the skill-review lane');
    } else if (authoringReview.evidenceSource === 'deterministic-check-only') {
      warnings.push('[authoring] Authoring review is deterministic-check-only, not an LLM review');
    } else if (!authoringReview.passed) {
      const blockingFindings = authoringReview.findings
        .filter((finding) => finding.severity === 'critical' || finding.severity === 'important')
        .map((finding) => finding.problem);
      blockers.push(
        `[authoring] LLM authoring review did not pass${
          blockingFindings.length > 0 ? `: ${blockingFindings.join('; ')}` : ''
        }`,
      );
    }
    const hasClaudeAgent = generatedPackage.platformAgents?.some(
      (agent) => agent.platform === 'claude',
    );
    const hasClaudeAgentPreview = compile?.files.some((file) => file.kind === 'agent') ?? false;
    if (
      controlPlane.passed &&
      compile?.platform === 'claude' &&
      hasClaudeAgent &&
      !hasClaudeAgentPreview
    ) {
      blockers.push(
        '[agent] Claude Code custom agent definitions are missing from platform preview',
      );
    }
  }
  if (state.status === 'ready' && !state.ready) {
    blockers.push('[publish] Ready Bundle metadata is missing');
  }
  for (const unsupported of compile?.unsupported ?? []) {
    const message = `[capability] ${unsupported.capability}: ${unsupported.reason}`;
    if (unsupported.required) blockers.push(message);
    else warnings.push(message);
  }
  for (const disclosure of compile?.executableDisclosures ?? []) {
    warnings.push(
      `[executable] ${disclosure.id}: ${disclosure.command} -> ${disclosure.destination} (${disclosure.sideEffect})`,
    );
  }
  const publishable =
    blockers.length === 0 &&
    state.status === 'review-approved' &&
    state.review?.hash === state.currentHash &&
    state.review.decision === 'approved';
  const published =
    blockers.length === 0 &&
    state.status === 'ready' &&
    state.ready?.hash === state.currentHash &&
    Boolean(state.ready.path);
  return {
    state: published
      ? 'published'
      : publishable
        ? 'publishable'
        : blockers.length === 0
          ? 'reviewable'
          : 'blocked',
    blockers,
    warnings,
    evidence: {
      draftPath: state.draftPath,
      ...(generatedPackage
        ? authoringReview
          ? {
              authoringReview: `${authoringReview.passed ? 'passed' : 'failed'} (${
                authoringReview.evidenceSource
              }${authoringReview.voters ? `, ${authoringReview.voters} voters` : ''})`,
            }
          : { authoringReview: 'missing' }
        : {}),
      ...(state.factory?.generatedSkillPackage?.packageRoot
        ? { generatedPackage: state.factory.generatedSkillPackage.packageRoot }
        : {}),
      ...(state.factory?.generatedSkillPackage?.evalManifestPath
        ? { evalManifest: state.factory.generatedSkillPackage.evalManifestPath }
        : {}),
      ...(generatedPackage
        ? { wrapperClassification: generatedPackage.wrapperClassification ?? 'unknown' }
        : {}),
      ...(generatedPackage?.platformAgents?.length
        ? { agent: `${generatedPackage.platformAgents.length} platform agent(s)` }
        : {}),
      ...(state.factory?.composition
        ? {
            compositionIssues: `${state.factory.composition.issues.length} issue(s)`,
            compositionChoices: `${state.factory.composition.choices.length} choice(s)`,
          }
        : {}),
      ...(workflowProtocol
        ? {
            workflow: `${workflowProtocol.nodes.length} node(s), ${workflowProtocol.outputSchemas.length} output schema(s)`,
            workflowRequiredSkillCalls: `${workflowProtocol.nodes.reduce(
              (count, node) => count + node.requiredSkillCalls.length,
              0,
            )} required Skill call(s)`,
            workflowOutputSchemas: workflowProtocol.outputSchemas
              .map((schema) => schema.id)
              .join(', '),
          }
        : {}),
      ...(state.factory?.generatedSkillPackage
        ? {
            controlPlane: `${controlPlane.evidence.length}/${
              controlPlane.evidence.length + controlPlane.errors.length
            } file(s)`,
            ...(controlPlane.errors.length > 0
              ? { controlPlaneErrors: `${controlPlane.errors.length} error(s)` }
              : {}),
          }
        : {}),
      ...(state.eval?.resultPath ? { evalResult: state.eval.resultPath } : {}),
      ...(state.factory?.planPath ? { factoryPlan: state.factory.planPath } : {}),
      ...(state.factory?.preferenceHash ? { preferenceHash: state.factory.preferenceHash } : {}),
      ...(state.factory?.preferenceMode ? { preferenceMode: state.factory.preferenceMode } : {}),
      ...(state.ready?.path ? { publishedBundle: state.ready.path } : {}),
    },
  };
}

async function fallbackIrForBundle(bundle: SkillBundle, locale: string): Promise<BundleCompilerIr> {
  return {
    bundle: {
      name: bundle.manifest.metadata.name,
      version: bundle.manifest.metadata.version,
      locale,
      hash: await hashBundle(bundle),
    },
    capabilities: {
      requires: [...bundle.manifest.platforms.requires],
      optional: [...bundle.manifest.platforms.optional],
    },
    skills: bundle.manifest.skills.map((skill) => ({
      id: skill.id,
      logicalRoot: skill.path,
      visibility: skill.visibility,
      sourceRoot: `${bundle.root}/${skill.path}`,
      files: [],
    })),
    rules: [],
    hooks: [],
    scripts: [],
    references: [],
    assets: [],
    agents: [],
    overrides: [],
    engine: null,
  };
}

function fallbackCompileReport(options: {
  bundle: SkillBundle;
  platform: string;
  scope: 'project' | 'global';
}): PlatformCompileReport {
  return {
    platform: options.platform,
    scope: options.scope,
    files: [],
    entrySkills: options.bundle.manifest.skills
      .filter((skill) => skill.visibility === 'entry')
      .map((skill) => skill.id),
    unsupported: [],
    executableDisclosures: [],
  };
}

export async function buildBundleReviewSummary(options: {
  projectRoot: string;
  name: string;
  platform: string;
  scope?: 'project' | 'global';
  locale?: string;
}): Promise<BundleReviewSummary> {
  const state = await reconcileBundleAuthoringState(options.projectRoot, options.name);
  const currentPreferences = await readProjectSkillPreferences(options.projectRoot);
  const bundle = await loadBundle(state.draftPath);
  const locale = options.locale ?? state.defaultLocale;
  const scope = options.scope ?? 'project';
  const target = listBundlePlatformTargets({
    projectRoot: options.projectRoot,
    homeDir: os.homedir(),
    scope,
  }).find((candidate) => candidate.id === options.platform);
  if (!target) throw new Error(`Unknown platform: ${options.platform}`);
  const controlPlane = await validateStableFactoryControlPlane(state);
  const ir = controlPlane.passed
    ? await compileBundleIr(bundle, { locale })
    : await fallbackIrForBundle(bundle, locale);
  const compile = controlPlane.passed
    ? await compileBundleForPlatform(ir, target, {
        projectRoot: options.projectRoot,
        scope,
        locale,
      })
    : fallbackCompileReport({ bundle, platform: target.id, scope });
  const readiness = await buildReadiness(
    state,
    controlPlane,
    compile,
    currentPreferences?.hash ?? null,
  );

  return {
    schemaVersion: 1,
    name: state.name,
    status: state.status,
    hash: state.currentHash,
    draftPath: state.draftPath,
    factory: state.factory ?? null,
    compile,
    evalPlans: {
      quick: planBundleEval(ir, 'quick'),
      full: planBundleEval(ir, 'full'),
    },
    eval: state.eval ?? null,
    review: state.review ?? null,
    ready: state.ready ?? null,
    readiness,
    userSummary: buildReadinessUserSummary(state.name, readiness),
  };
}
