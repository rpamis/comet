import { classicProjectTargetExists } from './classic-protected-path.js';

export type ClassicPlanReadiness =
  | { status: 'missing'; recordedPath: null }
  | { status: 'broken'; recordedPath: string }
  | { status: 'ready'; recordedPath: string };

export async function inspectClassicPlanReadiness(
  projectRoot: string,
  plan: string | null,
): Promise<ClassicPlanReadiness> {
  if (!plan || plan === 'null') return { status: 'missing', recordedPath: null };

  const exists = await classicProjectTargetExists(projectRoot, plan, {
    label: `Classic build plan ${plan}`,
    expected: 'file',
  });
  return exists
    ? { status: 'ready', recordedPath: plan }
    : { status: 'broken', recordedPath: plan };
}
