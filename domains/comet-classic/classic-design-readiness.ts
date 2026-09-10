import path from 'node:path';
import { parseDocument } from 'yaml';
import type { ClassicState } from './classic-state.js';
import type { ClassicIssue } from './classic-issues.js';
import { classicIssue } from './classic-issues.js';
import { classicProjectRelative } from './classic-layout.js';
import { computeContextHash } from './classic-handoff.js';
import { classicProjectFileNonempty, readClassicProjectFile } from './classic-protected-path.js';

/** Observe persisted Design work without clearing it or assuming user authorization. */
export async function inspectClassicDesignReadiness(
  root: string,
  directory: string,
  state: ClassicState,
) {
  const issues: ClassicIssue[] = [];
  const name = path.basename(directory);
  if (state.designDoc) {
    try {
      const source = await readClassicProjectFile(root, state.designDoc, {
        label: 'Classic Design Doc',
      });
      const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source)?.[1];
      const document = frontmatter === undefined ? null : parseDocument(frontmatter);
      for (const [field, expected] of Object.entries({
        comet_change: name,
        role: 'technical-design',
        canonical_spec: 'openspec',
      })) {
        const actual = document?.get(field) ?? null;
        if (document?.errors.length || actual !== expected)
          issues.push({
            code: 'CLASSIC_DESIGN_METADATA_INVALID',
            field,
            path: state.designDoc,
            actual,
            expected,
            message: `Design Doc ${field} must be ${expected}.`,
            remediation:
              'Repair the reported metadata in the selected change design; preserve confirmed content.',
          });
      }
    } catch (error) {
      issues.push(
        classicIssue(error, {
          code: 'CLASSIC_DESIGN_UNREADABLE',
          field: 'design_doc',
          path: state.designDoc,
          remediation:
            'Restore the recorded Design Doc or register its correct repository-relative reference. Do not clear valid design work.',
        }),
      );
    }
  }
  let handoff: 'missing' | 'stale' | 'ready' = 'missing';
  if (state.handoffContext && state.handoffHash) {
    try {
      const markdown = state.handoffContext.replace(/\.json$/u, '.md');
      const currentHash = await computeContextHash(
        root,
        directory,
        classicProjectRelative(root, directory),
      );
      const present =
        (await classicProjectFileNonempty(root, state.handoffContext, 'Classic design handoff')) &&
        (await classicProjectFileNonempty(root, markdown, 'Classic design handoff markdown'));
      handoff = present && currentHash === state.handoffHash ? 'ready' : 'stale';
    } catch {
      handoff = 'stale';
    }
  }
  return {
    design: state.designDoc ? (issues.length ? 'invalid' : 'ready') : 'missing',
    handoff,
    issues,
  };
}
