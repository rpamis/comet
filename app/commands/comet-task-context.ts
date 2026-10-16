import { fileURLToPath } from 'node:url';
import type {
  CometPluginContextContribution,
  CometPluginContextRequest,
} from '../../domains/comet-plugin/comet.js';
import {
  ExternalCommandError,
  runExternalCommandAsync,
} from '../../platform/process/external-command.js';
import type {
  ProjectLearningRequest,
  ProjectLearningStatus,
} from '../../domains/project-knowledge/index.js';
import type { recordCometWorkflowResult } from '../../domains/comet-entry/plugin-context.js';

type WorkflowResult = Parameters<typeof recordCometWorkflowResult>[0];
type WorkflowLearningStatus = Awaited<ReturnType<typeof recordCometWorkflowResult>>;

/** One process deadline covers the whole checkpoint batch, including Provider I/O. */
export async function recordCometTaskWorkflowResults(
  workflowResults: readonly WorkflowResult[],
): Promise<readonly WorkflowLearningStatus[]> {
  if (workflowResults.length === 0) return [];
  try {
    const output = await runExternalCommandAsync(
      process.execPath,
      [fileURLToPath(new URL('./comet-task-context-worker.js', import.meta.url))],
      {
        input: JSON.stringify({ workflowResults }),
        timeoutMs: 5_000,
        maxBufferBytes: 1024 * 1024,
        onStderr: (chunk) => process.stderr.write(chunk),
      },
    );
    const results: unknown = JSON.parse(output);
    if (!Array.isArray(results) || results.length !== workflowResults.length)
      throw new Error('Invalid workflow learning response');
    return results.map((result) => result ?? undefined);
  } catch (error) {
    process.stderr.write(
      error instanceof ExternalCommandError && error.timedOut
        ? 'Workflow learning exceeded 5 seconds and was canceled. The workflow result is unchanged; captured events are retained for later retry with comet memory sync.\n'
        : 'Workflow learning is unavailable. The workflow result is unchanged; inspect pending learning with comet memory status.\n',
    );
    return [];
  }
}

export async function recordCometTaskWorkflowResult(
  result: WorkflowResult,
): Promise<WorkflowLearningStatus> {
  return (await recordCometTaskWorkflowResults([result]))[0];
}

export async function readCometTaskProjectLearning(
  projectRoot: string,
  projectLearning: ProjectLearningRequest,
): Promise<ProjectLearningStatus> {
  try {
    const output = await runExternalCommandAsync(
      process.execPath,
      [fileURLToPath(new URL('./comet-task-context-worker.js', import.meta.url))],
      {
        input: JSON.stringify({ projectRoot, projectLearning }),
        timeoutMs: 10_000,
        maxBufferBytes: 1024 * 1024,
      },
    );
    const status = JSON.parse(output) as Partial<ProjectLearningStatus> | null;
    if (
      !status ||
      Array.isArray(status) ||
      status.check !== projectLearning.check ||
      typeof status.submissionVerified !== 'boolean' ||
      !Number.isSafeInteger(status.pendingHostReviewCount) ||
      status.pendingHostReviewCount! < 0 ||
      !Number.isSafeInteger(status.pendingReflectionCount) ||
      status.pendingReflectionCount! < 0 ||
      !Array.isArray(status.memories) ||
      !Array.isArray(status.pendingReviews) ||
      !Array.isArray(status.nextActions) ||
      status.nextActions.some((action) => typeof action !== 'string')
    ) {
      throw new Error('Invalid project learning response');
    }
    return status as ProjectLearningStatus;
  } catch {
    return {
      check: projectLearning.check,
      submissionVerified: false,
      memories: [],
      pendingHostReviewCount: 0,
      pendingReflectionCount: 0,
      pendingReviews: [],
      unavailable: true,
      nextActions: [
        '项目学习状态暂不可用；继续完成任务，保留记忆写入和评审回执，状态恢复后再核对。',
      ],
    };
  }
}

/** Isolate advisory retrieval so its deadline also stops pending I/O and child processes. */
export async function collectCometTaskContext(
  projectRoot: string,
  request: CometPluginContextRequest,
): Promise<readonly CometPluginContextContribution[]> {
  try {
    const output = await runExternalCommandAsync(
      process.execPath,
      [fileURLToPath(new URL('./comet-task-context-worker.js', import.meta.url))],
      {
        input: JSON.stringify({ projectRoot, request }),
        timeoutMs: 10_000,
        maxBufferBytes: 1024 * 1024,
        onStderr: (chunk) => {
          process.stderr.write(chunk);
        },
      },
    );
    const context: unknown = JSON.parse(output);
    if (!Array.isArray(context)) throw new Error('Invalid task context response');
    return context;
  } catch (error) {
    process.stderr.write(
      error instanceof ExternalCommandError && error.timedOut
        ? 'Task context retrieval exceeded 10 seconds and was canceled. Continue project exploration without recalled context; do not retry this lookup for the same task.\n'
        : 'Task context retrieval is unavailable. Continue project exploration without recalled context; do not retry this lookup for the same task.\n',
    );
    return [];
  }
}
