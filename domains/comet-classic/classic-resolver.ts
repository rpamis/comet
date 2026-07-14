import type { DeterministicResolver } from '../../domains/engine/resolver.js';
import type { ClassicEvidence } from './classic-evidence.js';
import { evidenceSatisfied } from './classic-evidence.js';
import type { ClassicProfile, ClassicState } from './classic-state.js';

export interface ClassicResolverContext {
  classic: ClassicState;
  evidence: ClassicEvidence[];
}

function profileFor(classic: ClassicState): ClassicProfile {
  return classic.classicProfile ?? classic.workflow;
}

function fullBuildConfigured(classic: ClassicState): boolean {
  if (!classic.buildMode || !classic.tddMode || !classic.isolation || !classic.verifyMode) {
    return false;
  }
  if (classic.buildMode === 'subagent-driven-development') {
    return classic.subagentDispatch === 'confirmed';
  }
  if (classic.buildMode === 'direct') return classic.directOverride === true;
  return true;
}

function presetBuildConfigured(classic: ClassicState): boolean {
  return Boolean(
    classic.buildMode === 'direct' &&
    classic.tddMode === 'direct' &&
    classic.isolation !== null &&
    classic.verifyMode === 'light',
  );
}

function resolveBuild(
  profile: ClassicProfile,
  classic: ClassicState,
  evidence: readonly ClassicEvidence[],
): string {
  if (classic.verifyResult === 'fail') {
    return profile === 'full' ? 'full.build.fix' : `${profile}.build.execute`;
  }

  if (profile === 'full') {
    if (!evidenceSatisfied(evidence, 'build.plan')) return 'full.build.plan';
    if (classic.buildPause === 'plan-ready') return 'full.build.plan-ready';
    if (!fullBuildConfigured(classic)) return 'full.build.configure';
  } else if (!presetBuildConfigured(classic)) {
    throw new Error(`${profile} build configuration is incomplete`);
  }

  return evidenceSatisfied(evidence, 'build.tasks-complete')
    ? `${profile}.build.complete`
    : `${profile}.build.execute`;
}

function resolveVerify(
  profile: ClassicProfile,
  classic: ClassicState,
  evidence: readonly ClassicEvidence[],
): string {
  if (classic.verifyResult !== 'pass' || !evidenceSatisfied(evidence, 'verification.report')) {
    return `${profile}.verify.run`;
  }
  return `${profile}.verify.branch`;
}

function resolveArchive(profile: ClassicProfile, classic: ClassicState): string {
  if (classic.verifyResult !== 'pass') {
    throw new Error('archive requires verify_result=pass');
  }
  return classic.archiveConfirmation === 'confirmed'
    ? `${profile}.archive.execute`
    : `${profile}.archive.confirm`;
}

export function resolveClassicStepId(
  classic: ClassicState,
  evidence: readonly ClassicEvidence[],
): string {
  const profile = profileFor(classic);

  if (classic.archived && classic.phase !== 'archive') {
    throw new Error('archived=true requires phase=archive');
  }
  if (classic.archived) return 'completed';
  if (profile !== 'full' && classic.phase === 'design') {
    throw new Error(`${profile} workflow cannot enter design`);
  }

  switch (classic.phase) {
    case 'open':
      return `${profile}.open`;
    case 'design':
      return evidenceSatisfied(evidence, 'design.handoff')
        ? 'full.design.document'
        : 'full.design.handoff';
    case 'build':
      return resolveBuild(profile, classic, evidence);
    case 'verify':
      return resolveVerify(profile, classic, evidence);
    case 'archive':
      return resolveArchive(profile, classic);
  }
}

export const classicDeterministicResolver: DeterministicResolver<ClassicResolverContext> = {
  resolveStep({ pkg, context }) {
    const stepId = resolveClassicStepId(context.classic, context.evidence);
    return pkg.definition.orchestration.steps?.find((step) => step.id === stepId);
  },
  resolveNext({ step }) {
    return step.next ?? null;
  },
};
