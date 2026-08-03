import path from 'path';

import {
  COMET_WORKFLOW_RESOLUTION_SCHEMA,
  formatCometWorkflowResolution,
  resolveCometWorkflowResolution,
} from '../../domains/comet-entry/workflow-resolution.js';
import { resolveOrActivateCometEntry } from '../../domains/comet-entry/project-activation.js';

interface WorkflowResolveOptions {
  json?: boolean;
  activate?: boolean;
}

export async function workflowResolveCommand(
  targetPath: string,
  options: WorkflowResolveOptions = {},
): Promise<void> {
  const absoluteTarget = path.resolve(targetPath);
  const resolution = options.activate
    ? {
        schema: COMET_WORKFLOW_RESOLUTION_SCHEMA,
        ...(await resolveOrActivateCometEntry(absoluteTarget)),
      }
    : await resolveCometWorkflowResolution(absoluteTarget);
  if (options.json) {
    console.log(JSON.stringify(resolution, null, 2));
    return;
  }
  console.log(formatCometWorkflowResolution(resolution));
}
