import { promises as fs } from 'fs';
import path from 'path';
import type { BundleCandidateSource } from './candidates.js';
import { reconcileBundleAuthoringState, writeBundleAuthoringState } from './state.js';
import type { BundleAuthoringState } from './types.js';

export interface ResolveBundleFactoryCandidateOptions {
  projectRoot: string;
  name: string;
  candidate: string;
  source?: string;
  ignoreMissing?: boolean;
  reason?: string;
}

async function canonicalPathForComparison(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function candidateSelector(
  source: BundleCandidateSource,
  selector: string,
  projectRoot: string,
) {
  if (source.hash === selector) return true;
  const selectedPath = path.resolve(projectRoot, selector);
  const sourceRoot = path.resolve(source.root);
  if (sourceRoot === selectedPath) return true;
  return (
    (await canonicalPathForComparison(sourceRoot)) ===
    (await canonicalPathForComparison(selectedPath))
  );
}

function invalidateGeneratedFactoryState(state: BundleAuthoringState): BundleAuthoringState {
  const updated: BundleAuthoringState = {
    ...state,
    status: 'draft',
    currentHash: null,
    factory: state.factory
      ? {
          ...state.factory,
        }
      : undefined,
  };
  if (updated.factory) {
    delete updated.factory.generatedSkillPackage;
    delete updated.factory.composition;
    delete updated.factory.proposalConfirmation;
  }
  delete updated.eval;
  delete updated.review;
  delete updated.ready;
  delete updated.conflict;
  return updated;
}

function withoutCandidate(
  sources: BundleCandidateSource[],
  candidate: string,
): BundleCandidateSource[] {
  return sources.filter(
    (source) => source.factory?.query !== candidate && source.name !== candidate,
  );
}

export async function resolveBundleFactoryCandidate(
  options: ResolveBundleFactoryCandidateOptions,
): Promise<BundleAuthoringState> {
  const projectRoot = path.resolve(options.projectRoot);
  if (!options.candidate) throw new Error('--candidate is required');
  if (Boolean(options.source) === Boolean(options.ignoreMissing)) {
    throw new Error('Pass exactly one of --source or --ignore-missing');
  }

  const state = await reconcileBundleAuthoringState(projectRoot, options.name);
  if (!state.factory) throw new Error(`Bundle ${state.name} does not have Skill Creator metadata`);

  const target = state.factory.resolvedSkills.find((skill) => skill.query === options.candidate);
  if (!target) throw new Error(`Skill Creator candidate not found: ${options.candidate}`);

  let updated = invalidateGeneratedFactoryState(state);
  const factory = updated.factory!;

  if (options.source) {
    const matches: BundleCandidateSource[] = [];
    for (const source of target.sources) {
      if (await candidateSelector(source, options.source, projectRoot)) {
        matches.push(source);
      }
    }
    if (matches.length === 0) {
      throw new Error(`No source for ${options.candidate} matches ${options.source}`);
    }
    if (matches.length > 1) {
      throw new Error(`Source selector is ambiguous for ${options.candidate}: ${options.source}`);
    }
    const selected = matches[0];
    factory.resolvedSkills = factory.resolvedSkills.map((skill) =>
      skill.query === options.candidate
        ? {
            ...skill,
            status: 'available',
            sources: [selected],
          }
        : skill,
    );
    updated = {
      ...updated,
      candidates: [...withoutCandidate(updated.candidates, options.candidate), selected],
    };
  } else {
    if (target.status !== 'missing') {
      throw new Error(
        `--ignore-missing can only be used for missing candidates: ${options.candidate}`,
      );
    }
    if (!options.reason || options.reason.trim().length === 0) {
      throw new Error('--reason is required when ignoring a missing candidate');
    }
    const remainingCallChain = factory.callChain.filter((item) => item.skill !== options.candidate);
    if (remainingCallChain.length === 0) {
      throw new Error(`Cannot ignore the only call-chain Skill: ${options.candidate}`);
    }
    const expectedIndex =
      target.preferenceIndex ?? factory.preferredSkills.indexOf(options.candidate);
    factory.preferredSkills = factory.preferredSkills.filter(
      (skill) => skill !== options.candidate,
    );
    factory.resolvedSkills = factory.resolvedSkills.filter(
      (skill) => skill.query !== options.candidate,
    );
    factory.callChain = remainingCallChain;
    factory.deviations = [
      ...factory.deviations.filter(
        (deviation) => !(deviation.skill === options.candidate && deviation.actualIndex === -1),
      ),
      {
        skill: options.candidate,
        expectedIndex,
        actualIndex: -1,
        reason: options.reason.trim(),
      },
    ];
    updated = {
      ...updated,
      candidates: withoutCandidate(updated.candidates, options.candidate),
    };
  }

  await writeBundleAuthoringState(projectRoot, updated);
  return updated;
}
