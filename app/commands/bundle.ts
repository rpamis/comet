import path from 'path';
import os from 'os';
import { discoverBundleCandidates } from '../../domains/bundle/candidates.js';
import { readSkillPreferences } from '../../domains/bundle/preferences.js';
import { createBundleDraft, optimizeBundleDraft } from '../../domains/bundle/draft.js';
import { loadBundle } from '../../domains/bundle/load.js';
import {
  listBundleAuthoringStates,
  reconcileBundleAuthoringState,
} from '../../domains/bundle/state.js';
import { compileBundleIr } from '../../domains/bundle/compiler.js';
import { compileBundleForPlatform } from '../../domains/bundle/platform.js';
import { buildBundleReviewSummary } from '../../domains/bundle/review-summary.js';
import { listBundlePlatformTargets } from '../../domains/bundle/bundle-platform.js';
import { planBundleEval, recordBundleEval } from '../../domains/bundle/eval.js';
import { publishBundle, reviewBundle } from '../../domains/bundle/publish.js';
import { distributeBundle } from '../../domains/bundle/distribute.js';
import {
  buildBundleResumeSummary,
  determineBundleNextAction,
  type BundleNextAction,
} from '../../domains/bundle/next-action.js';
import { readProjectSkillPreferences } from '../../domains/skill/preferences.js';
import type { BundleCapability } from '../../domains/bundle/types.js';
import {
  buildSkillCreatorInstallText,
  buildSkillCreatorResumeText,
} from '../../domains/bundle/user-facing.js';

interface BundleCommandOptions {
  project?: string;
  json?: boolean;
  platform?: string | string[];
  scope?: 'project' | 'global';
  locale?: string;
  level?: 'quick' | 'full';
  result?: string;
  approve?: boolean;
  reject?: boolean;
  reviewer?: string;
  overwrite?: boolean;
  skipCapability?: BundleCapability[];
  confirmExecutables?: boolean;
  preview?: boolean;
  name?: string;
  defaultLocale?: string;
  localeOption?: string[];
  engine?: boolean;
}

function projectRoot(options: BundleCommandOptions): string {
  return path.resolve(options.project ?? '.');
}

function emit(value: unknown, json: boolean | undefined, text: string): void {
  console.log(json ? JSON.stringify(value, null, 2) : text);
}

function platformIds(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function formatOptionalSection(title: string, lines: string[]): string[] {
  return lines.length > 0 ? [title, ...lines.map((line) => `- ${line}`)] : [];
}

function formatStateEval(
  evalState:
    NonNullable<Awaited<ReturnType<typeof reconcileBundleAuthoringState>>['eval']> | undefined,
): string {
  if (!evalState)
    return 'Eval: missing; run comet eval <generated-skill>/comet/eval.yaml --quick --html';
  return `Eval: ${evalState.passed ? 'passed' : 'failed'} (${evalState.level}) @ ${evalState.hash}`;
}

function formatStateReview(
  reviewState:
    NonNullable<Awaited<ReturnType<typeof reconcileBundleAuthoringState>>['review']> | undefined,
): string {
  if (!reviewState) return 'Review: missing; run comet publish review before approval';
  return `Review: ${reviewState.decision} by ${reviewState.reviewer} @ ${reviewState.hash}`;
}

function formatStatusText(
  state: Awaited<ReturnType<typeof reconcileBundleAuthoringState>>,
  resumeSummary: ReturnType<typeof buildBundleResumeSummary>,
): string {
  const backendCommandLines =
    resumeSummary.recommendedNextStep.category === 'eval'
      ? []
      : [`Backend command: ${resumeSummary.recommendedNextStep.backendCommand}`];
  const userText = buildSkillCreatorResumeText({
    title: 'Found an unfinished Bundle',
    completed: resumeSummary.completed,
    missing: resumeSummary.missing,
    nextAction: resumeSummary.recommendedNextStep.userLabel,
    choices: resumeSummary.choices.map((choice) => choice.label),
  });

  return [
    userText,
    'Advanced details:',
    `Bundle: ${state.name}`,
    `Status: ${state.status}`,
    `Hash: ${state.currentHash ?? '(invalid)'}`,
    `Draft: ${state.draftPath}`,
    formatStateEval(state.eval),
    formatStateReview(state.review),
    `Next action: ${resumeSummary.recommendedNextStep.action}`,
    `Current step: ${resumeSummary.currentStep}`,
    `User next step: ${resumeSummary.recommendedNextStep.userLabel}`,
    `Reason: ${resumeSummary.recommendedNextStep.reason}`,
    `Suggested user command: ${resumeSummary.recommendedNextStep.userCommand}`,
    ...backendCommandLines,
    ...formatOptionalSection('Already done:', resumeSummary.completed),
    ...formatOptionalSection('Still missing:', resumeSummary.missing),
    ...(resumeSummary.preferenceDrift.changed
      ? ['Preference drift: project Skill preferences changed after this flow started']
      : []),
    ...(state.ready ? [`Ready: ${state.ready.path}`] : []),
  ].join('\n');
}

function formatListText(
  states: Array<
    Awaited<ReturnType<typeof reconcileBundleAuthoringState>> & {
      nextAction: BundleNextAction;
      resumeSummary: ReturnType<typeof buildBundleResumeSummary>;
    }
  >,
): string {
  if (states.length === 0) return 'No Bundle states found.';
  return states
    .map((state) =>
      [
        `${state.name}: ${state.status}`,
        `Hash: ${state.currentHash ?? '(invalid)'}`,
        `Draft: ${state.draftPath}`,
        `Next action: ${state.nextAction.action}`,
        `Current step: ${state.resumeSummary.currentStep}`,
        `Suggested user command: ${state.resumeSummary.recommendedNextStep.userCommand}`,
        `Reason: ${state.nextAction.reason}`,
      ].join('\n'),
    )
    .join('\n\n');
}

function formatReviewSummaryText(
  summary: Awaited<ReturnType<typeof buildBundleReviewSummary>>,
): string {
  const userLines = [
    summary.userSummary.conclusion === 'blocked'
      ? 'Validate this Skill: blocked'
      : 'Validate this Skill: ready for the next step',
    summary.userSummary.summary,
    ...formatOptionalSection(
      'Next steps:',
      summary.userSummary.nextSteps.map((step) => `${step.label}: ${step.command}`),
    ),
  ];
  const readinessLines = [
    `Readiness: ${summary.readiness.state}`,
    'Readiness details:',
    ...formatOptionalSection('Blockers:', summary.readiness.blockers),
    ...formatOptionalSection('Warnings:', summary.readiness.warnings),
    ...formatOptionalSection(
      'Evidence:',
      Object.entries(summary.readiness.evidence).map(([key, value]) => `${key}: ${value}`),
    ),
  ];

  return [
    `Bundle: ${summary.name}`,
    `Status: ${summary.status}`,
    `Hash: ${summary.hash ?? '(invalid)'}`,
    `Platform: ${summary.compile.platform}`,
    ...userLines,
    `Quick Eval runs: ${summary.evalPlans.quick.estimatedRuns}`,
    `Full Eval runs: ${summary.evalPlans.full.estimatedRuns}`,
    ...readinessLines,
  ].join('\n');
}

function formatDistributionText(result: Awaited<ReturnType<typeof distributeBundle>>): string {
  return buildSkillCreatorInstallText({
    preview: result.preview,
    skillName: result.bundle,
    platforms: result.platforms.map((platform) => `${platform.platform}: ${platform.status}`),
    plannedFiles: result.platforms.flatMap((platform) =>
      platform.plannedFiles.map((file) => `${file.kind}: ${file.destination}`),
    ),
    disclosures: result.platforms.flatMap((platform) => [
      ...platform.executableDisclosures.map(
        (disclosure) =>
          `${disclosure.id}: ${disclosure.command} (${disclosure.sideEffect}) -> ${disclosure.destination}`,
      ),
      ...platform.unsupported.map(
        (unsupported) =>
          `${unsupported.capability}${unsupported.required ? ' (required)' : ''}: ${unsupported.reason}`,
      ),
      ...(platform.manualAction ? [platform.manualAction] : []),
      ...(platform.error ? [platform.error] : []),
      ...platform.written.map((file) => `wrote: ${file}`),
      ...platform.skipped.map((file) => `skipped: ${file}`),
    ]),
  });
}

async function compileDraft(
  name: string,
  options: BundleCommandOptions,
): Promise<{
  state: Awaited<ReturnType<typeof reconcileBundleAuthoringState>>;
  ir: Awaited<ReturnType<typeof compileBundleIr>>;
}> {
  const state = await reconcileBundleAuthoringState(projectRoot(options), name);
  const bundle = await loadBundle(state.draftPath);
  return {
    state,
    ir: await compileBundleIr(bundle, { locale: options.locale ?? state.defaultLocale }),
  };
}

export async function bundleCandidatesCommand(options: BundleCommandOptions = {}): Promise<void> {
  const root = projectRoot(options);
  const preferences = await readSkillPreferences(root);
  const candidates = await discoverBundleCandidates({ projectRoot: root, preferences });
  emit(
    { candidates },
    options.json,
    candidates.map((candidate) => `${candidate.name}: ${candidate.status}`).join('\n'),
  );
}

export async function bundleDraftCreateCommand(
  name: string,
  options: BundleCommandOptions = {},
): Promise<void> {
  const state = await createBundleDraft({
    projectRoot: projectRoot(options),
    name,
    candidates: [],
    defaultLocale: options.defaultLocale ?? options.locale ?? 'en',
    locales: options.localeOption ?? [options.defaultLocale ?? options.locale ?? 'en'],
    engineEnabled: options.engine ?? false,
  });
  emit(state, options.json, `Created Bundle draft ${state.name}\nDraft: ${state.draftPath}`);
}

export async function bundleDraftOptimizeCommand(
  source: string,
  options: BundleCommandOptions = {},
): Promise<void> {
  const sourceRoot = path.resolve(source);
  const bundle = await loadBundle(sourceRoot);
  const state = await optimizeBundleDraft({
    projectRoot: projectRoot(options),
    name: options.name ?? bundle.manifest.metadata.name,
    sourceRoot,
    candidates: [],
    defaultLocale: options.defaultLocale ?? bundle.manifest.metadata.defaultLocale,
    locales: options.localeOption ?? bundle.manifest.metadata.locales,
    engineEnabled: bundle.manifest.engine.enabled,
  });
  emit(state, options.json, `Optimized Bundle draft ${state.name}\nDraft: ${state.draftPath}`);
}

export async function bundleStatusCommand(
  name: string,
  options: BundleCommandOptions = {},
): Promise<void> {
  const root = projectRoot(options);
  const state = await reconcileBundleAuthoringState(root, name);
  const nextAction = determineBundleNextAction(state);
  const currentPreferences = await readProjectSkillPreferences(root);
  const resumeSummary = buildBundleResumeSummary(state, {
    currentPreferenceHash: currentPreferences?.hash ?? null,
  });
  emit(
    { ...state, nextAction, resumeSummary },
    options.json,
    formatStatusText(state, resumeSummary),
  );
}

export async function bundleListCommand(options: BundleCommandOptions = {}): Promise<void> {
  const root = projectRoot(options);
  const currentPreferences = await readProjectSkillPreferences(root);
  const states = (await listBundleAuthoringStates(root)).map((state) => ({
    ...state,
    nextAction: determineBundleNextAction(state),
    resumeSummary: buildBundleResumeSummary(state, {
      currentPreferenceHash: currentPreferences?.hash ?? null,
    }),
  }));
  emit({ bundles: states }, options.json, formatListText(states));
}

export async function bundleCompileCommand(
  name: string,
  options: BundleCommandOptions = {},
): Promise<void> {
  const ids = platformIds(options.platform);
  if (ids.length !== 1) throw new Error('--platform is required exactly once');
  const { state, ir } = await compileDraft(name, options);
  const target = listBundlePlatformTargets({
    projectRoot: projectRoot(options),
    homeDir: os.homedir(),
    scope: options.scope ?? 'project',
  }).find((candidate) => candidate.id === ids[0]);
  if (!target) throw new Error(`Unknown platform: ${ids[0]}`);
  const report = await compileBundleForPlatform(ir, target, {
    projectRoot: projectRoot(options),
    scope: options.scope ?? 'project',
    locale: options.locale ?? state.defaultLocale,
  });
  emit(
    report,
    options.json,
    `Compiled ${name} for ${report.platform}: ${report.files.length} file(s)`,
  );
}

export async function bundleEvalPlanCommand(
  name: string,
  options: BundleCommandOptions = {},
): Promise<void> {
  const { ir } = await compileDraft(name, options);
  const plan = planBundleEval(ir, options.level ?? 'quick');
  emit(
    plan,
    options.json,
    [
      `Eval level: ${plan.level}`,
      `Estimated runs: ${plan.estimatedRuns}`,
      `Token workload: ${plan.tokenWorkload}`,
      plan.explanation,
    ].join('\n'),
  );
}

export async function bundleEvalRecordCommand(
  name: string,
  options: BundleCommandOptions = {},
): Promise<void> {
  if (!options.result) throw new Error('--result is required');
  const state = await recordBundleEval(projectRoot(options), name, path.resolve(options.result));
  emit(state, options.json, `Recorded Eval for ${state.name}: ${state.status}`);
}

export async function bundleReviewCommand(
  name: string,
  options: BundleCommandOptions = {},
): Promise<void> {
  if (options.approve === options.reject) {
    throw new Error('Pass exactly one of --approve or --reject');
  }
  if (!options.reviewer) throw new Error('--reviewer is required');
  const state = await reviewBundle({
    projectRoot: projectRoot(options),
    name,
    decision: options.approve ? 'approved' : 'rejected',
    reviewer: options.reviewer,
  });
  emit(state, options.json, `Review ${state.review?.decision ?? 'recorded'}: ${state.status}`);
}

export async function bundleReviewSummaryCommand(
  name: string,
  options: BundleCommandOptions = {},
): Promise<void> {
  const ids = platformIds(options.platform);
  if (ids.length !== 1) throw new Error('--platform is required exactly once');
  const summary = await buildBundleReviewSummary({
    projectRoot: projectRoot(options),
    name,
    platform: ids[0],
    scope: options.scope ?? 'project',
    locale: options.locale,
  });
  emit(summary, options.json, formatReviewSummaryText(summary));
}

export async function bundlePublishCommand(
  name: string,
  options: BundleCommandOptions = {},
): Promise<void> {
  const ids = platformIds(options.platform);
  if (ids.length !== 1) throw new Error('--platform is required exactly once');
  const state = await publishBundle({
    projectRoot: projectRoot(options),
    name,
    overwrite: options.overwrite,
    referencePlatform: ids[0],
  });
  emit(state, options.json, `Published ${state.name}: ${state.ready?.path}`);
}

export async function bundleDistributeCommand(
  name: string,
  options: BundleCommandOptions = {},
): Promise<void> {
  const ids = platformIds(options.platform);
  if (ids.length === 0) throw new Error('At least one --platform is required');
  const result = await distributeBundle({
    projectRoot: projectRoot(options),
    name,
    platforms: ids,
    scope: options.scope ?? 'project',
    locale: options.locale,
    overwrite: options.overwrite,
    skipCapabilities: options.skipCapability,
    confirmedExecutables: options.confirmExecutables,
    preview: options.preview,
  });
  emit(result, options.json, formatDistributionText(result));
}

export type { BundleCommandOptions };
