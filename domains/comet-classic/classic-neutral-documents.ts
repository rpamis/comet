import { isNeutralDocumentPath } from '../workflow-contract/neutral-document-path.js';
import { classicProjectRelative, resolveClassicLayout } from './classic-layout.js';
import type { ClassicLayoutPaths } from './classic-layout.js';
import { readClassicConfigValue } from './classic-project-config.js';

export type ClassicDocumentEvidenceMode = 'neutral' | 'strict';

/**
 * How documentation edits affect recorded check evidence. `neutral` (default)
 * keeps evidence valid when only neutral document paths changed; `strict`
 * binds every working-tree file again, matching pre-0.4.2 behavior.
 */
export async function classicDocumentEvidenceMode(
  projectRoot: string,
): Promise<ClassicDocumentEvidenceMode> {
  const recorded = await readClassicConfigValue('document_evidence', { cwd: projectRoot });
  if (!recorded) return 'neutral';
  if (recorded.value === 'neutral' || recorded.value === 'strict') {
    return recorded.value as ClassicDocumentEvidenceMode;
  }
  throw new Error(
    `classic.document_evidence must be neutral or strict, got '${recorded.value}' (${recorded.source})`,
  );
}

/**
 * Project-relative prefixes whose files always stay bound: OpenSpec change
 * artifacts (proposal, design, tasks, specs) and the Superpowers workspace
 * (design docs, plans, reports). Documentation neutrality never applies here.
 */
export function classicProtectedDocumentPrefixes(
  projectRoot: string,
  layout: ClassicLayoutPaths,
): string[] {
  return [
    classicProjectRelative(projectRoot, layout.openSpecRoot),
    classicProjectRelative(projectRoot, layout.superpowersRoot),
  ];
}

/** Splits changed paths into material inputs and neutral document paths. */
export async function splitNeutralDocumentChanges(
  projectRoot: string,
  changedPaths: readonly string[],
): Promise<{ material: string[]; neutral: string[] }> {
  let protectedPrefixes: string[];
  try {
    const layout = await resolveClassicLayout(projectRoot);
    protectedPrefixes = classicProtectedDocumentPrefixes(projectRoot, layout);
  } catch {
    // Without a resolvable layout (missing config, Classic not enabled) both
    // possible OpenSpec roots stay protected instead of failing the check.
    protectedPrefixes = ['openspec', 'docs/openspec', 'docs/superpowers'];
  }
  const material: string[] = [];
  const neutral: string[] = [];
  for (const changedPath of changedPaths) {
    if (isNeutralDocumentPath(changedPath, protectedPrefixes)) neutral.push(changedPath);
    else material.push(changedPath);
  }
  return { material, neutral };
}

/**
 * Whether the Hook may treat a project-relative write as a neutral document
 * edit. Under `strict` only the historical root-markdown whitelist applies.
 */
export async function isClassicNeutralDocumentWrite(
  projectRoot: string,
  layout: ClassicLayoutPaths,
  relativePath: string,
): Promise<boolean> {
  if ((await classicDocumentEvidenceMode(projectRoot)) === 'strict') return false;
  return isNeutralDocumentPath(relativePath, classicProtectedDocumentPrefixes(projectRoot, layout));
}
