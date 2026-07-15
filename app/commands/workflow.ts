import path from 'path';

import {
  formatCometWorkflowResolution,
  resolveCometWorkflowResolution,
} from '../../domains/comet-entry/workflow-resolution.js';

interface WorkflowResolveOptions {
  json?: boolean;
}

export async function workflowResolveCommand(
  targetPath: string,
  options: WorkflowResolveOptions = {},
): Promise<void> {
  const resolution = await resolveCometWorkflowResolution(path.resolve(targetPath));
  if (options.json) {
    console.log(JSON.stringify(resolution, null, 2));
    return;
  }
  console.log(formatCometWorkflowResolution(resolution));
}
