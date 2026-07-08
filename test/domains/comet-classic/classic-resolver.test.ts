import { describe, expect, it } from 'vitest';
import {
  resolveClassicStepId,
  type ClassicResolverContext,
} from '../../../domains/comet-classic/classic-resolver.js';
import type { ClassicEvidence } from '../../../domains/comet-classic/classic-evidence.js';
import type { ClassicState } from '../../../domains/comet-classic/classic-state.js';

function state(overrides: Partial<ClassicState> = {}): ClassicState {
  return {
    workflow: 'full',
    phase: 'open',
    contextCompression: 'off',
    buildMode: null,
    buildPause: null,
    subagentDispatch: null,
    tddMode: null,
    isolation: null,
    verifyMode: null,
    autoTransition: true,
    baseRef: null,
    designDoc: null,
    plan: null,
    verifyResult: 'pending',
    verificationReport: null,
    branchStatus: 'pending',
    createdAt: '2026-06-14',
    verifiedAt: null,
    archived: false,
    directOverride: null,
    handoffContext: null,
    handoffHash: null,
    classicProfile: null,
    classicMigration: null,
    ...overrides,
  };
}

function evidence(...satisfiedCodes: string[]): ClassicEvidence[] {
  return satisfiedCodes.map((code) => ({ code, satisfied: true }));
}

interface ResolverCase {
  name: string;
  classic: ClassicState;
  evidence?: ClassicEvidence[];
  expected: string;
}

const cases: ResolverCase[] = [
  { name: 'full open', classic: state(), expected: 'full.open' },
  {
    name: 'full design handoff',
    classic: state({ phase: 'design' }),
    expected: 'full.design.handoff',
  },
  {
    name: 'full design document',
    classic: state({ phase: 'design', handoffContext: '.comet/context.json' }),
    evidence: evidence('design.handoff'),
    expected: 'full.design.document',
  },
  {
    name: 'full build plan',
    classic: state({ phase: 'build' }),
    expected: 'full.build.plan',
  },
  {
    name: 'full build plan-ready pause',
    classic: state({ phase: 'build', plan: 'plan.md', buildPause: 'plan-ready' }),
    evidence: evidence('build.plan'),
    expected: 'full.build.plan-ready',
  },
  {
    name: 'full build configuration',
    classic: state({ phase: 'build', plan: 'plan.md' }),
    evidence: evidence('build.plan'),
    expected: 'full.build.configure',
  },
  {
    name: 'full build execution',
    classic: state({
      phase: 'build',
      plan: 'plan.md',
      buildMode: 'executing-plans',
      tddMode: 'tdd',
      isolation: 'worktree',
      verifyMode: 'full',
    }),
    evidence: evidence('build.plan'),
    expected: 'full.build.execute',
  },
  {
    name: 'full build completion',
    classic: state({
      phase: 'build',
      plan: 'plan.md',
      buildMode: 'executing-plans',
      tddMode: 'tdd',
      isolation: 'worktree',
      verifyMode: 'full',
    }),
    evidence: evidence('build.plan', 'build.tasks-complete'),
    expected: 'full.build.complete',
  },
  {
    name: 'full build fix',
    classic: state({
      phase: 'build',
      plan: 'plan.md',
      buildMode: 'executing-plans',
      tddMode: 'tdd',
      isolation: 'worktree',
      verifyMode: 'full',
      verifyResult: 'fail',
    }),
    evidence: evidence('build.plan'),
    expected: 'full.build.fix',
  },
  {
    name: 'full verification run',
    classic: state({ phase: 'verify' }),
    expected: 'full.verify.run',
  },
  {
    name: 'full verification branch handling',
    classic: state({
      phase: 'verify',
      verifyResult: 'pass',
      verificationReport: 'verification.md',
    }),
    evidence: evidence('verification.report'),
    expected: 'full.verify.branch',
  },
  {
    name: 'full archive confirmation',
    classic: state({
      phase: 'archive',
      verifyResult: 'pass',
      verificationReport: 'verification.md',
      branchStatus: 'handled',
    }),
    evidence: evidence('verification.report'),
    expected: 'full.archive.confirm',
  },
  {
    name: 'full archive execution',
    classic: state({
      phase: 'archive',
      verifyResult: 'pass',
      verificationReport: 'verification.md',
      branchStatus: 'handled',
    }),
    evidence: evidence('verification.report', 'archive.confirmed'),
    expected: 'full.archive.execute',
  },
  {
    name: 'completed',
    classic: state({
      phase: 'archive',
      verifyResult: 'pass',
      branchStatus: 'handled',
      archived: true,
    }),
    expected: 'completed',
  },
  {
    name: 'hotfix open',
    classic: state({ workflow: 'hotfix' }),
    expected: 'hotfix.open',
  },
  {
    name: 'hotfix build execution',
    classic: state({
      workflow: 'hotfix',
      phase: 'build',
      buildMode: 'direct',
      tddMode: 'direct',
      isolation: 'branch',
      verifyMode: 'light',
    }),
    expected: 'hotfix.build.execute',
  },
  {
    name: 'hotfix build completion',
    classic: state({
      workflow: 'hotfix',
      phase: 'build',
      buildMode: 'direct',
      tddMode: 'direct',
      isolation: 'branch',
      verifyMode: 'light',
    }),
    evidence: evidence('build.tasks-complete'),
    expected: 'hotfix.build.complete',
  },
  {
    name: 'tweak verification',
    classic: state({ workflow: 'tweak', phase: 'verify' }),
    expected: 'tweak.verify.run',
  },
  {
    name: 'tweak archive execution',
    classic: state({
      workflow: 'tweak',
      phase: 'archive',
      verifyResult: 'pass',
      verificationReport: 'verification.md',
      branchStatus: 'handled',
    }),
    evidence: evidence('verification.report', 'archive.confirmed'),
    expected: 'tweak.archive.execute',
  },
];

describe('Classic Resolver', () => {
  it.each(cases)('$name -> $expected', ({ classic, evidence: facts = [], expected }) => {
    expect(resolveClassicStepId(classic, facts)).toBe(expected);
  });

  it('uses classic_profile after a preset upgrade', () => {
    expect(
      resolveClassicStepId(
        state({
          workflow: 'hotfix',
          classicProfile: 'full',
          phase: 'build',
          plan: 'plan.md',
        }),
        evidence('build.plan'),
      ),
    ).toBe('full.build.configure');
  });

  it('resolves a preset-escalate terminal state to the design handoff step', () => {
    // preset-escalate transitions (workflow/classic_profile → full, phase →
    // design, design_doc → null). The resolver must accept this state and
    // route to the design handoff step instead of tripping the
    // (phase=design, profile!=full) invariant.
    expect(
      resolveClassicStepId(
        state({
          workflow: 'full',
          classicProfile: 'full',
          phase: 'design',
          designDoc: null,
        }),
        [],
      ),
    ).toBe('full.design.handoff');
  });

  it.each([
    {
      name: 'archived outside archive',
      classic: state({ phase: 'build', archived: true }),
      message: 'archived=true requires phase=archive',
    },
    {
      name: 'design phase for hotfix',
      classic: state({ workflow: 'hotfix', phase: 'design' }),
      message: 'hotfix workflow cannot enter design',
    },
    {
      name: 'archive before verification passes',
      classic: state({ phase: 'archive', verifyResult: 'pending' }),
      message: 'archive requires verify_result=pass',
    },
  ])('fails closed for $name', ({ classic, message }) => {
    expect(() => resolveClassicStepId(classic, [])).toThrow(message);
  });

  it('defines the resolver context as Classic state plus structured evidence', () => {
    const context: ClassicResolverContext = {
      classic: state(),
      evidence: evidence('openspec.proposal'),
    };

    expect(context.classic.workflow).toBe('full');
    expect(context.evidence[0].code).toBe('openspec.proposal');
  });
});
