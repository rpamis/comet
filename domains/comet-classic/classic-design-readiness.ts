import path from 'node:path';
import type { ClassicIssue } from './classic-issues.js';
import { classicIssue } from './classic-issues.js';
import { classicProjectFileNonempty, readClassicProjectFile } from './classic-protected-path.js';
import type { ClassicState } from './classic-state.js';

/** Observe persisted Design work without clearing it or assuming user authorization. */
export async function inspectClassicDesignReadiness(
  root: string,
  directory: string,
  state: ClassicState,
) {
  const issues: ClassicIssue[] = [];
  if (state.designDoc) {
    try {
      const source = await readClassicProjectFile(root, state.designDoc, {
        label: 'Classic Design Doc',
      });
      if (!source.trim())
        issues.push({
          code: 'CLASSIC_DESIGN_EMPTY',
          field: 'design_doc',
          path: state.designDoc,
          message: 'Design Doc is empty.',
          remediation: 'Write the selected technical design before completing Design.',
        });
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
  if (state.handoffContext) {
    try {
      const present = await classicProjectFileNonempty(
        root,
        path.join(directory, 'proposal.md'),
        'Classic Design source',
      );
      handoff = present ? 'ready' : 'missing';
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
