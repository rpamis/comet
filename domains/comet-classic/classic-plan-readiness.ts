import { classicProjectTargetExists } from './classic-protected-path.js';
import { assertClassicLayoutReadable } from './classic-layout.js';
import path from 'node:path';

export type ClassicPlanReadiness =
  | { status: 'missing'; recordedPath: null }
  | { status: 'broken'; recordedPath: string }
  | { status: 'ready'; recordedPath: string };

export async function inspectClassicPlanReadiness(
  projectRoot: string,
  plan: string | null,
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
  return exists
    ? { status: 'ready', recordedPath: plan }
    : { status: 'broken', recordedPath: plan };
}
