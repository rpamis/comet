import os from 'os';
import { compileBundleIr } from './compiler.js';
import { planBundleEval, readBundleEvalResult } from './eval.js';
import { loadBundle } from './load.js';
import { compileBundleForPlatform, type PlatformCompileReport } from './platform.js';
import { reconcileBundleAuthoringState } from './state.js';
import type { BundleAuthoringState } from './types.js';
import { listBundlePlatformTargets } from './bundle-platform.js';
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
  compile?: PlatformCompileReport,
): Promise<BundleReviewReadiness> {
  const blockers: string[] = [];
  const warnings: string[] = [];
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
      ...(state.eval?.resultPath ? { evalResult: state.eval.resultPath } : {}),
      ...(state.ready?.path ? { publishedBundle: state.ready.path } : {}),
    },
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
  const bundle = await loadBundle(state.draftPath);
  const locale = options.locale ?? state.defaultLocale;
  const scope = options.scope ?? 'project';
  const target = listBundlePlatformTargets({
    projectRoot: options.projectRoot,
    homeDir: os.homedir(),
    scope,
  }).find((candidate) => candidate.id === options.platform);
  if (!target) throw new Error(`Unknown platform: ${options.platform}`);
  const ir = await compileBundleIr(bundle, { locale });
  const compile = await compileBundleForPlatform(ir, target, {
    projectRoot: options.projectRoot,
    scope,
    locale,
  });
  const readiness = await buildReadiness(state, compile);

  return {
    schemaVersion: 1,
    name: state.name,
    status: state.status,
    hash: state.currentHash,
    draftPath: state.draftPath,
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
