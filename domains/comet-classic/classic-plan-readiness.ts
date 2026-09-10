import {
  classicProjectTargetExists,
  classicProjectFileNonempty,
  readClassicProjectFile,
} from './classic-protected-path.js';
import type { ClassicState } from './classic-state.js';
import { parseDocument } from 'yaml';
import { assertClassicLayoutReadable } from './classic-layout.js';
import path from 'node:path';

export type ClassicPlanReadiness =
  | { status: 'missing'; recordedPath: null }
  | { status: 'broken'; recordedPath: string }
  | { status: 'ready'; recordedPath: string };

export async function inspectClassicAutonomousBuildProblems(
  projectRoot: string,
  change: string,
  state: ClassicState,
  options: { requirePlan?: boolean } = {},
): Promise<string[]> {
  if (state.workflow !== 'full' || state.buildMode !== 'autonomous') return [];
  const problems: string[] = [];
  if (options.requirePlan !== false) {
    if (!state.tddMode) problems.push('tdd_mode must be selected for autonomous full build');
    if (!state.reviewMode) problems.push('review_mode must be selected for autonomous full build');
    else if (state.reviewMode === 'off')
      problems.push('review_mode must be standard or thorough for autonomous full build');
    if (!state.isolation) problems.push('isolation must be selected for autonomous full build');
  }
  if (
    !state.designDoc ||
    !(await classicProjectFileNonempty(projectRoot, state.designDoc, 'Classic autonomous design'))
  ) {
    problems.push(
      'design_doc must reference a nonempty technical design for autonomous full build',
    );
  } else {
    const source = await readClassicProjectFile(projectRoot, state.designDoc, {
      label: 'Classic autonomous design',
    });
    const frontmatter = source
      .replace(/^\uFEFF/u, '')
      .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
    const document = frontmatter ? parseDocument(frontmatter[1]) : null;
    if (
      !document ||
      document.errors.length ||
      document.get('comet_change') !== change ||
      document.get('role') !== 'technical-design' ||
      document.get('canonical_spec') !== 'openspec'
    ) {
      problems.push(
        'design_doc must link the current change and declare role: technical-design and canonical_spec: openspec',
      );
    }
  }
  if (options.requirePlan !== false) {
    const readiness = await inspectClassicPlanReadiness(projectRoot, state.plan, {
      requireNonempty: true,
    });
    if (readiness.status !== 'ready') {
      problems.push(
        'plan must reference a nonempty implementation plan in the configured plans directory',
      );
    }
  }
  return problems;
}

export async function inspectClassicPlanReadiness(
  projectRoot: string,
  plan: string | null,
  options: { requireNonempty?: boolean } = {},
): Promise<ClassicPlanReadiness> {
  if (!plan || plan === 'null') return { status: 'missing', recordedPath: null };

  const layout = await assertClassicLayoutReadable(projectRoot);
  const planPath = path.resolve(projectRoot, plan);
  const relativeToPlans = path.relative(layout.superpowersPlansDir, planPath);
  if (
    path.isAbsolute(plan) ||
    !relativeToPlans ||
    relativeToPlans.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToPlans) ||
    relativeToPlans.includes(path.sep) ||
    path.extname(relativeToPlans).toLowerCase() !== '.md'
  ) {
    return { status: 'broken', recordedPath: plan };
  }

  const exists = await classicProjectTargetExists(projectRoot, plan, {
    label: `Classic build plan ${plan}`,
    expected: 'file',
  });
  const ready =
    exists &&
    (!options.requireNonempty ||
      (
        await readClassicProjectFile(projectRoot, plan, { label: `Classic build plan ${plan}` })
      ).trim().length > 0);
  return ready ? { status: 'ready', recordedPath: plan } : { status: 'broken', recordedPath: plan };
}
