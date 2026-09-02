import type { BundleAuthoringState } from './types.js';

export type BundleNextActionKind =
  | 'resolve-candidates'
  | 'fix-composition'
  | 'confirm-proposal'
  | 'generate-factory-package'
  | 'choose-eval-level'
  | 'request-review'
  | 'publish'
  | 'ask-distribution'
  | 'done';

export type BundleNextActionCategory =
  'factory' | 'eval' | 'review' | 'publish' | 'distribute' | 'complete';

export interface BundleNextAction {
  action: BundleNextActionKind;
  category: BundleNextActionCategory;
  userLabel: string;
  reason: string;
  backendCommand: string;
  userCommand: string;
  requiresUserConfirmation: boolean;
}

export interface BundleResumeSummary {
  schemaVersion: 1;
  name: string;
  goal: string | null;
  status: BundleAuthoringState['status'];
  currentStep:
    | 'needs-candidate-resolution'
    | 'needs-composition-fix'
    | 'needs-proposal-confirmation'
    | 'needs-generation'
    | 'needs-eval'
    | 'needs-review'
    | 'needs-publish'
    | 'needs-distribution'
    | 'complete';
  completed: string[];
  missing: string[];
  evidencePaths: Record<string, string>;
  preferenceDrift: {
    changed: boolean;
    storedHash: string | null;
    currentHash: string | null;
  };
  recommendedNextStep: BundleNextAction;
  choices: Array<{ id: 'continue' | 'view-details' | 'abandon'; label: string }>;
}

function factoryPackagePath(state: BundleAuthoringState): string | null {
  return state.factory?.generatedSkillPackage?.packageRoot ?? null;
}

function generatedEvalManifest(state: BundleAuthoringState): string | null {
  return state.factory?.generatedSkillPackage?.evalManifestPath ?? null;
}

export function determineBundleNextAction(state: BundleAuthoringState): BundleNextAction {
  const unresolved =
    state.factory?.resolvedSkills.filter(
      (skill) => skill.status === 'missing' || skill.status === 'ambiguous',
    ) ?? [];
  if (unresolved.length > 0) {
    const first = unresolved[0];
    return {
      action: 'resolve-candidates',
      category: 'factory',
      userLabel: 'Resolve missing or ambiguous Skill candidates',
      reason: `${unresolved.length} unresolved Skill Creator candidate(s) remain`,
      backendCommand: `comet creator resolve ${state.name} --candidate ${first.query}`,
      userCommand: `Ask /comet-any to resolve ${first.query}`,
      requiresUserConfirmation: true,
    };
  }

  const compositionIssues = state.factory?.composition?.issues ?? [];
  if (compositionIssues.length > 0) {
    const first = compositionIssues[0];
    return {
      action: 'fix-composition',
      category: 'factory',
      userLabel: 'Fix the composition plan',
      reason: `Skill Creator composition has ${compositionIssues.length} issue(s): ${first.message}`,
      backendCommand: `comet bundle review-summary ${state.name} --platform <reference-platform>`,
      userCommand: 'Ask /comet-any to revise the composition proposal',
      requiresUserConfirmation: true,
    };
  }

  if (state.factory && state.factory.proposalConfirmation?.confirmed !== true) {
    const planPath = state.factory.planPath ?? '<plan.json>';
    return {
      action: 'confirm-proposal',
      category: 'factory',
      userLabel: 'Confirm the resolved composition proposal',
      reason:
        'Skill Creator candidates and composition are resolved but proposal confirmation is missing',
      backendCommand: `comet creator init ${state.name} --file ${planPath} --confirmed-proposal`,
      userCommand: 'Ask /comet-any to show and confirm the resolved composition proposal',
      requiresUserConfirmation: true,
    };
  }

  if (state.factory && !state.factory.generatedSkillPackage) {
    return {
      action: 'generate-factory-package',
      category: 'factory',
      userLabel: 'Generate the Comet-native Skill package',
      reason: 'Skill Creator metadata exists but no generated Skill package is recorded yet',
      backendCommand: `comet creator generate ${state.name}`,
      userCommand: 'Ask /comet-any to continue generation',
      requiresUserConfirmation: false,
    };
  }

  if (!state.eval || state.eval.hash !== state.currentHash || !state.eval.passed) {
    const evalManifest = generatedEvalManifest(state);
    return {
      action: 'choose-eval-level',
      category: 'eval',
      userLabel: 'Run repository eval for the generated Skill',
      reason: 'Current draft hash is missing passing eval evidence',
      backendCommand: `comet bundle eval-plan ${state.name} --level quick`,
      userCommand:
        evalManifest !== null
          ? `comet eval ${evalManifest} --quick --html`
          : 'comet eval <generated-skill> --quick --html',
      requiresUserConfirmation: true,
    };
  }

  if (
    !state.review ||
    state.review.hash !== state.currentHash ||
    state.review.decision !== 'approved'
  ) {
    return {
      action: 'request-review',
      category: 'review',
      userLabel: 'Review readiness before approval',
      reason: 'Current draft hash is missing review approval',
      backendCommand: `comet bundle review-summary ${state.name} --platform <reference-platform>`,
      userCommand: `comet publish review ${state.name} --platform <reference-platform>`,
      requiresUserConfirmation: true,
    };
  }

  if (state.status === 'review-approved' && !state.ready) {
    return {
      action: 'publish',
      category: 'publish',
      userLabel: 'Publish the approved candidate',
      reason: 'Eval and review are present; the draft is ready to publish',
      backendCommand: `comet bundle publish ${state.name} --platform <reference-platform>`,
      userCommand: `comet publish run ${state.name} --platform <reference-platform>`,
      requiresUserConfirmation: true,
    };
  }

  if (state.ready) {
    return {
      action: 'ask-distribution',
      category: 'distribute',
      userLabel: 'Preview distribution before installing into Agent platforms',
      reason: 'Ready Bundle exists; the next step is distribution after user confirmation',
      backendCommand: `comet bundle distribute ${state.name} --platform <platform> --scope project --preview`,
      userCommand: `comet publish distribute ${state.name} --platform <platform> --scope project --preview`,
      requiresUserConfirmation: true,
    };
  }

  return {
    action: 'done',
    category: 'complete',
    userLabel: 'No further action required',
    reason: 'No further automatic Bundle action is required',
    backendCommand: 'none',
    userCommand: 'none',
    requiresUserConfirmation: false,
  };
}

export function buildBundleResumeSummary(
  state: BundleAuthoringState,
  options: { currentPreferenceHash?: string | null } = {},
): BundleResumeSummary {
  const nextAction = determineBundleNextAction(state);
  const currentStepByAction: Record<BundleNextActionKind, BundleResumeSummary['currentStep']> = {
    'resolve-candidates': 'needs-candidate-resolution',
    'fix-composition': 'needs-composition-fix',
    'confirm-proposal': 'needs-proposal-confirmation',
    'generate-factory-package': 'needs-generation',
    'choose-eval-level': 'needs-eval',
    'request-review': 'needs-review',
    publish: 'needs-publish',
    'ask-distribution': 'needs-distribution',
    done: 'complete',
  };

  const completed: string[] = [];
  const missing: string[] = [];
  if (state.factory) completed.push('Skill Creator metadata initialized');
  else missing.push('Skill Creator metadata');
  if (state.factory?.generatedSkillPackage) completed.push('Generated Skill package recorded');
  else if (state.factory) missing.push('Generated Skill package');
  if (state.eval?.hash === state.currentHash && state.eval.passed)
    completed.push('Passing eval evidence');
  else missing.push('Passing eval evidence for the current draft');
  if (state.review?.hash === state.currentHash && state.review.decision === 'approved') {
    completed.push('Review approval for the current draft');
  } else {
    missing.push('Review approval for the current draft');
  }
  if (state.ready?.hash === state.currentHash) completed.push('Published Bundle');
  else if (state.status === 'review-approved') missing.push('Published Bundle');

  const storedHash = state.factory?.preferenceHash ?? null;
  const currentHash = options.currentPreferenceHash ?? null;
  const generatedSkill = factoryPackagePath(state);
  const evalManifest = generatedEvalManifest(state);

  return {
    schemaVersion: 1,
    name: state.name,
    goal: state.factory?.goal ?? null,
    status: state.status,
    currentStep: currentStepByAction[nextAction.action],
    completed,
    missing,
    evidencePaths: {
      draft: state.draftPath,
      ...(generatedSkill ? { generatedSkill } : {}),
      ...(evalManifest ? { evalManifest } : {}),
      ...(state.eval?.resultPath ? { evalResult: state.eval.resultPath } : {}),
      ...(state.ready?.path ? { publishedBundle: state.ready.path } : {}),
    },
    preferenceDrift: {
      changed: storedHash !== null && currentHash !== storedHash,
      storedHash,
      currentHash,
    },
    recommendedNextStep: nextAction,
    choices: [
      { id: 'continue', label: 'Continue' },
      { id: 'view-details', label: 'View details' },
      { id: 'abandon', label: 'Abandon this flow' },
    ],
  };
}
