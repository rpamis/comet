import type { BundleReviewReadiness } from './review-summary.js';

export type BundleReadinessConclusion =
  'blocked' | 'needs-confirmation' | 'can-publish' | 'published';

export interface BundleReadinessUserSummaryItem {
  code:
    | 'candidate'
    | 'proposal'
    | 'preference'
    | 'composition'
    | 'workflow'
    | 'control-plane'
    | 'authoring'
    | 'draft'
    | 'eval'
    | 'review'
    | 'publish'
    | 'capability'
    | 'agent'
    | 'executable'
    | 'unknown';
  severity: 'blocker' | 'warning';
  message: string;
  impact: string;
  nextAction: {
    label: string;
    command: string;
  };
  evidence: string | null;
}

export interface BundleReadinessUserSummary {
  conclusion: BundleReadinessConclusion;
  title: string;
  summary: string;
  items: BundleReadinessUserSummaryItem[];
  nextSteps: Array<{ label: string; command: string }>;
}

function fallbackNextSteps(
  conclusion: BundleReadinessConclusion,
  bundleName: string,
): Array<{ label: string; command: string }> {
  if (conclusion === 'can-publish') {
    return [
      {
        label: 'Publish the approved candidate',
        command: `comet publish run ${bundleName} --platform <reference-platform>`,
      },
    ];
  }
  if (conclusion === 'published') {
    return [
      {
        label: 'Preview distribution before installing into Agent platforms',
        command: `comet publish distribute ${bundleName} --platform <platform> --scope project --preview`,
      },
    ];
  }
  return [];
}

function codeOf(message: string): BundleReadinessUserSummaryItem['code'] {
  const match = message.match(/^\[([a-z-]+)\]/u);
  const value = match?.[1] ?? 'unknown';
  if (
    [
      'candidate',
      'proposal',
      'preference',
      'composition',
      'workflow',
      'control-plane',
      'authoring',
      'draft',
      'eval',
      'review',
      'publish',
      'capability',
      'agent',
      'executable',
    ].includes(value)
  ) {
    return value as BundleReadinessUserSummaryItem['code'];
  }
  return 'unknown';
}

function advice(
  code: BundleReadinessUserSummaryItem['code'],
  bundleName: string,
): { impact: string; label: string; command: string } {
  switch (code) {
    case 'candidate':
      return {
        impact: 'Comet cannot safely compose the Skill until every source Skill is resolved.',
        label: 'Resolve missing or ambiguous Skill candidates',
        command: `comet creator status ${bundleName}`,
      };
    case 'proposal':
      return {
        impact: 'The resolved Skill composition has not been confirmed by the user.',
        label: 'Confirm the resolved composition proposal',
        command: `comet creator init ${bundleName} --file <plan.json> --confirmed-proposal`,
      };
    case 'preference':
      return {
        impact: 'The saved project Skill preferences no longer match this candidate.',
        label: 'Review project Skill preferences and resume /comet-any',
        command: 'Open .comet/skill-preferences.yaml, then run /comet-any again',
      };
    case 'composition':
      return {
        impact: 'The generated Skill plan is not stable enough to publish.',
        label: 'Ask /comet-any to revise the composition proposal',
        command: 'Ask /comet-any to revise the proposal',
      };
    case 'workflow':
      return {
        impact:
          'The generated workflow contract is missing a required Output Schema or violates a protected Node rule.',
        label: 'Revise the workflow contract',
        command: 'Ask /comet-any to revise the Workflow Nodes, Skill Bindings, or Output Schemas',
      };
    case 'control-plane':
      return {
        impact: 'Required scripts, rules, hooks, or checks are missing from the generated Skill.',
        label: 'Regenerate the Skill Creator package',
        command: `comet creator generate ${bundleName}`,
      };
    case 'authoring':
      return {
        impact:
          'The generated Skill still contains scaffold content that must be authored before publishing.',
        label: 'Complete generated Skill authoring',
        command: `comet creator authoring-record ${bundleName} --lane skill-core --file <authoring-output.json>, then run the skill-review lane`,
      };
    case 'draft':
      return {
        impact: 'The draft cannot be tied to a stable hash.',
        label: 'Reconcile the Bundle status',
        command: `comet creator status ${bundleName}`,
      };
    case 'eval':
      return {
        impact: 'There is no passing eval evidence for the current generated Skill draft.',
        label: 'Run repository eval for the generated Skill',
        command: 'comet eval <generated-skill>/comet/eval.yaml --quick --html',
      };
    case 'review':
      return {
        impact: 'A human has not approved the current draft hash.',
        label: 'Review readiness and approve when acceptable',
        command: `comet publish review ${bundleName} --platform <reference-platform>`,
      };
    case 'publish':
      return {
        impact: 'Published Bundle metadata is incomplete.',
        label: 'Run publish again after review approval',
        command: `comet publish run ${bundleName} --platform <reference-platform>`,
      };
    case 'capability':
      return {
        impact: 'The selected platform cannot support one of the required generated capabilities.',
        label: 'Preview distribution on the target platform',
        command: `comet publish distribute ${bundleName} --platform <platform> --scope project --preview`,
      };
    case 'agent':
      return {
        impact:
          'The generated Skill declares Claude Code custom agents, but the platform preview does not include them.',
        label: 'Preview Claude Code agent distribution',
        command: `comet publish distribute ${bundleName} --platform claude --scope project --preview`,
      };
    case 'executable':
      return {
        impact:
          'The generated Skill includes executable hooks or scripts that require explicit confirmation.',
        label: 'Review executable disclosures before distribution',
        command: `comet publish distribute ${bundleName} --platform <platform> --scope project --preview`,
      };
    default:
      return {
        impact: 'Comet needs more information before it can publish safely.',
        label: 'Inspect publish readiness',
        command: `comet publish review ${bundleName} --platform <reference-platform>`,
      };
  }
}

export function buildReadinessUserSummary(
  bundleName: string,
  readiness: BundleReviewReadiness,
): BundleReadinessUserSummary {
  const items: BundleReadinessUserSummaryItem[] = [
    ...readiness.blockers.map((message) => ({ message, severity: 'blocker' as const })),
    ...readiness.warnings.map((message) => ({ message, severity: 'warning' as const })),
  ].map((item) => {
    const code = codeOf(item.message);
    const next = advice(code, bundleName);
    return {
      code,
      severity: item.severity,
      message: item.message.replace(/^\[[^\]]+\]\s*/u, ''),
      impact: next.impact,
      nextAction: {
        label: next.label,
        command: next.command,
      },
      evidence: readiness.evidence[code] ?? null,
    };
  });

  const conclusion: BundleReadinessConclusion =
    readiness.state === 'published'
      ? 'published'
      : readiness.state === 'publishable'
        ? 'can-publish'
        : readiness.blockers.length > 0
          ? 'blocked'
          : 'needs-confirmation';
  const title =
    conclusion === 'published'
      ? 'Already published'
      : conclusion === 'can-publish'
        ? 'Ready to publish'
        : conclusion === 'needs-confirmation'
          ? 'Ready for review approval'
          : 'Cannot publish yet';

  return {
    conclusion,
    title,
    summary:
      conclusion === 'blocked'
        ? `${readiness.blockers.length} issue(s) must be fixed before publishing.`
        : conclusion === 'needs-confirmation'
          ? 'No blockers remain, but human review approval is still required.'
          : conclusion === 'can-publish'
            ? 'Eval and review evidence match the current draft.'
            : 'The published Bundle is bound to the current hash.',
    items,
    nextSteps:
      items.length > 0
        ? items.map((item) => item.nextAction)
        : fallbackNextSteps(conclusion, bundleName),
  };
}
