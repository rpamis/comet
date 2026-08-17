import path from 'node:path';

import {
  collectCometPluginContext,
  recordCometWorkflowResult,
} from '../../domains/comet-entry/plugin-context.js';

export interface CometTaskCommandOptions {
  readonly task: string;
  readonly path?: string;
  readonly phase?: string;
  readonly complete?: boolean;
  readonly workflow?: string;
  readonly change?: string;
  readonly json?: boolean;
}

export interface CometTaskCommandResult {
  readonly context: readonly { readonly pluginId: string; readonly text: string }[];
}

/**
 * One host entry for ordinary Skill tasks. It keeps context selection and the
 * task-completion checkpoint on the same public bridge used by Native, Classic,
 * and Dashboard.
 */
export async function cometTaskCommand(
  targetPath = '.',
  options: CometTaskCommandOptions,
): Promise<CometTaskCommandResult> {
  const projectRoot = path.resolve(targetPath);
  const context = await collectCometPluginContext(projectRoot, {
    task: requireText(options.task, '--task'),
    ...(options.path ? { path: options.path } : {}),
    ...(options.phase ? { phase: options.phase } : {}),
  });
  if (options.complete) {
    await recordCometWorkflowResult({
      projectRoot,
      workflow: requireText(options.workflow, '--workflow'),
      changeId: requireText(options.change, '--change'),
      command: 'task',
      success: true,
      summary: options.task,
      eventName: 'task.completed',
      userEvidence: [options.task],
    });
  }
  const result = { context };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (context.length > 0) console.log(context.map((entry) => `- ${entry.text}`).join('\n'));
  return result;
}

function requireText(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new Error(`${option} must not be empty`);
  return value.trim();
}
