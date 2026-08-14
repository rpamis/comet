import path from 'path';

import {
  COMET_WORKFLOW_RESOLUTION_SCHEMA,
  formatCometWorkflowResolution,
  resolveCometWorkflowResolution,
} from '../../domains/comet-entry/workflow-resolution.js';
import { resolveOrActivateCometEntry } from '../../domains/comet-entry/project-activation.js';
import { collectCometPluginContext } from '../../domains/comet-entry/plugin-context.js';

interface WorkflowResolveOptions {
  json?: boolean;
  activate?: boolean;
  task?: string;
  path?: string;
  phase?: string;
}

export async function workflowResolveCommand(
  targetPath: string,
  options: WorkflowResolveOptions = {},
): Promise<void> {
  const absoluteTarget = path.resolve(targetPath);
  if (options.task?.trim()) {
    try {
      const context = await collectCometPluginContext(absoluteTarget, {
        task: options.task,
        ...(options.path ? { path: options.path } : {}),
        ...(options.phase ? { phase: options.phase } : {}),
      });
      if (context.length > 0) {
        process.stderr.write(
          `Comet context:\n${context.map((entry) => `- ${entry.text}`).join('\n')}\n`,
        );
      }
    } catch {
      // Context injection is best effort; resolution must remain available.
    }
  }
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
