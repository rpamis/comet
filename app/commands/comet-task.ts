import path from 'node:path';

import {
  collectCometPluginContext,
  expandCometPluginContext,
  recordCometContextOutcome,
  recordCometWorkflowResult,
} from '../../domains/comet-entry/plugin-context.js';
import type { AgentContextOutcomeStatus } from '../../domains/agent-learning/index.js';

export interface CometTaskCommandOptions {
  readonly task: string;
  readonly path?: string;
  readonly phase?: string;
  readonly operation?: string;
  readonly session?: string;
  readonly contextBudget?: string | number;
  readonly expandContext?: string;
  readonly application?: string;
  readonly outcome?: AgentContextOutcomeStatus;
  readonly complete?: boolean;
  readonly workflow?: string;
  readonly change?: string;
  readonly json?: boolean;
}

export interface CometTaskCommandResult {
  readonly context: Awaited<ReturnType<typeof collectCometPluginContext>>;
  readonly expansion?: Awaited<ReturnType<typeof expandCometPluginContext>>;
  readonly outcomeRecorded?: boolean;
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
  const request = {
    task: requireText(options.task, '--task'),
    ...(options.path ? { path: options.path } : {}),
    ...(options.phase ? { phase: options.phase } : {}),
    ...(options.operation ? { operation: options.operation } : {}),
    ...(options.session ? { sessionId: options.session } : {}),
    ...(contextBudget(options.contextBudget) === undefined
      ? {}
      : { charBudget: contextBudget(options.contextBudget) }),
  };
  if ((options.application === undefined) !== (options.outcome === undefined)) {
    throw new Error('--application and --outcome must be used together');
  }
  if (options.application && options.outcome) {
    await recordCometContextOutcome({
      projectRoot,
      applicationId: options.application,
      outcome: options.outcome,
    });
  }
  const expansion = options.expandContext
    ? await expandCometPluginContext(projectRoot, options.expandContext, request)
    : undefined;
  if (options.expandContext && expansion === null) {
    throw new Error(`Unknown or unavailable context: ${options.expandContext}`);
  }
  const context =
    options.expandContext || options.application || options.complete
      ? []
      : await collectCometPluginContext(projectRoot, request);
  if (options.complete) {
    await recordCometWorkflowResult({
      projectRoot,
      workflow: requireText(options.workflow, '--workflow'),
      changeId: requireText(options.change, '--change'),
      command: 'task',
      success: true,
      eventType: 'episode.completed',
      ...(options.path === undefined ? {} : { changedPaths: [options.path] }),
    });
  }
  const result = {
    context,
    ...(expansion === undefined ? {} : { expansion }),
    ...(options.application === undefined ? {} : { outcomeRecorded: true }),
  };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (expansion) {
    console.log(
      [
        expansion.title,
        expansion.content,
        `应用原因：${expansion.whyApplied}`,
        ...(expansion.sources.length === 0
          ? []
          : [
              `来源：${expansion.sources
                .map((source) => [source.source, source.anchor].filter(Boolean).join('#'))
                .join('、')}`,
            ]),
        ...(expansion.verification.length === 0
          ? []
          : [
              `验证：${expansion.verification
                .map((entry) =>
                  entry.expected ? `${entry.command}（${entry.expected}）` : entry.command,
                )
                .join('、')}`,
            ]),
      ].join('\n'),
    );
  } else if (context.length > 0) console.log(context.map((entry) => `- ${entry.text}`).join('\n'));
  return result;
}

function contextBudget(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--context-budget must be a positive integer');
  }
  return parsed;
}

function requireText(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new Error(`${option} must not be empty`);
  return value.trim();
}
