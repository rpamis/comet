import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { decide, recordOutcome, startRun } from '../../../domains/engine/loop.js';
import { loadRuntimePackage } from '../../../domains/skill/load.js';
import { validateSkillPackage } from '../../../domains/skill/validate.js';

const chinesePackageRoot = path.resolve('assets', 'skills-zh', 'comet', 'runtime', 'classic');
const englishPackageRoot = path.resolve('assets', 'skills', 'comet', 'runtime', 'classic');
const stableSteps = [
  'full.open',
  'full.design.handoff',
  'full.design.document',
  'full.build.configure',
  'full.build.plan',
  'full.build.plan-ready',
  'full.build.execute',
  'full.build.complete',
  'full.build.fix',
  'full.verify.run',
  'full.verify.branch',
  'full.archive.confirm',
  'full.archive.execute',
  'hotfix.open',
  'hotfix.build.execute',
  'hotfix.build.complete',
  'hotfix.verify.run',
  'hotfix.verify.branch',
  'hotfix.archive.confirm',
  'hotfix.archive.execute',
  'tweak.open',
  'tweak.build.execute',
  'tweak.build.complete',
  'tweak.verify.run',
  'tweak.verify.branch',
  'tweak.archive.confirm',
  'tweak.archive.execute',
  'completed',
];

describe('Chinese comet-classic package', () => {
  it('loads as one deterministic internal Skill with every stable step', async () => {
    const pkg = await loadRuntimePackage(chinesePackageRoot);

    expect(pkg.definition.metadata).toMatchObject({
      name: 'comet-classic',
      version: '1',
    });
    expect(pkg.definition.orchestration.mode).toBe('deterministic');
    expect(pkg.definition.orchestration.entry).toBe('full.open');
    expect(pkg.definition.orchestration.steps?.map((step) => step.id)).toEqual(stableSteps);
    expect(validateSkillPackage(pkg)).toEqual([]);
  });

  it('declares every invoked public Skill and never invokes itself', async () => {
    const pkg = await loadRuntimePackage(chinesePackageRoot);
    const declared = new Set(pkg.definition.skills.map((skill) => skill.id));
    const invoked = (pkg.definition.orchestration.steps ?? [])
      .filter((step) => step.action.type === 'invoke_skill')
      .map((step) => step.action.ref);

    expect(declared).toEqual(
      new Set([
        'comet-open',
        'comet-design',
        'comet-build',
        'comet-verify',
        'comet-archive',
        'comet-hotfix',
        'comet-tweak',
      ]),
    );
    expect(invoked.every((ref) => ref && declared.has(ref))).toBe(true);
    expect(invoked).not.toContain('comet-classic');
  });

  it('configures the full build before planning it', async () => {
    const pkg = await loadRuntimePackage(chinesePackageRoot);
    let state = {
      ...startRun(pkg, 'classic-package-order', '1'.repeat(64)),
      currentStep: 'full.design.document',
    };
    const visited: Array<string | null> = [];

    for (let index = 0; index < 4; index++) {
      const decision = decide(pkg, state, new Set());
      expect(decision.action).not.toBeNull();
      visited.push(decision.action!.stepId);
      state = recordOutcome(pkg, decision.state, {
        actionId: decision.action!.id,
        status: 'succeeded',
        summary: 'step completed',
      });
    }

    expect(visited).toEqual([
      'full.design.document',
      'full.build.configure',
      'full.build.plan',
      'full.build.plan-ready',
    ]);
    expect(state.currentStep).toBe('full.build.execute');
  });

  it('defines a completion eval for completed Run state', async () => {
    const pkg = await loadRuntimePackage(chinesePackageRoot);

    expect(pkg.evals).toContainEqual({
      id: 'classic-completed',
      scope: 'completion',
      type: 'state_equals',
      field: 'status',
      equals: 'completed',
    });
    expect(
      pkg.definition.orchestration.steps?.find((step) => step.id === 'completed')?.completionEvals,
    ).toEqual(['classic-completed']);
  });

  it('is a YAML-only runtime package without a user-facing SKILL.md', async () => {
    await expect(fs.access(path.join(chinesePackageRoot, 'SKILL.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('English comet-classic package', () => {
  it('matches the executable structure of the confirmed Chinese package', async () => {
    const [chinese, english] = await Promise.all([
      loadRuntimePackage(chinesePackageRoot),
      loadRuntimePackage(englishPackageRoot),
    ]);

    expect(validateSkillPackage(english)).toEqual([]);
    expect({
      metadata: {
        name: english.definition.metadata.name,
        version: english.definition.metadata.version,
      },
      orchestration: english.definition.orchestration,
      skills: english.definition.skills,
      agents: english.definition.agents,
      tools: english.definition.tools,
      guardrails: english.guardrails,
      evals: english.evals,
    }).toEqual({
      metadata: {
        name: chinese.definition.metadata.name,
        version: chinese.definition.metadata.version,
      },
      orchestration: chinese.definition.orchestration,
      skills: chinese.definition.skills,
      agents: chinese.definition.agents,
      tools: chinese.definition.tools,
      guardrails: chinese.guardrails,
      evals: chinese.evals,
    });
  });

  it('is a YAML-only runtime package without a user-facing English SKILL.md', async () => {
    await expect(fs.access(path.join(englishPackageRoot, 'SKILL.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
