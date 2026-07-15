import type { CometEntryResolution } from './types.js';
import { resolveCometEntry } from './resolve-entry.js';

export const COMET_WORKFLOW_RESOLUTION_SCHEMA = 'comet.workflow-resolution.v1' as const;

export interface CometWorkflowResolution extends CometEntryResolution {
  schema: typeof COMET_WORKFLOW_RESOLUTION_SCHEMA;
}

export async function resolveCometWorkflowResolution(
  startPath: string,
): Promise<CometWorkflowResolution> {
  return {
    schema: COMET_WORKFLOW_RESOLUTION_SCHEMA,
    ...(await resolveCometEntry(startPath)),
  };
}

export function formatCometWorkflowResolution(resolution: CometWorkflowResolution): string {
  return [
    `workflow: ${resolution.workflow}`,
    `skill: ${resolution.skill}`,
    `source: ${resolution.source}`,
  ].join('\n');
}
