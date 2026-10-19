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
import {
  areCometWorkflowResultsProcessed,
  type CometWorkflowResult,
} from '../../domains/comet-entry/workflow-learning-receipt.js';

type WorkflowResult = CometWorkflowResult;
type WorkflowLearningStatus =
  import('../../domains/comet-memory/index.js').MemoryLearningStatus | undefined;

/** One process deadline covers the whole checkpoint batch, including Provider I/O. */
export async function recordCometTaskWorkflowResults(
  workflowResults: readonly WorkflowResult[],
  options: { readonly reuseProcessed?: boolean } = {},
): Promise<readonly WorkflowLearningStatus[]> {
  if (workflowResults.length === 0) return [];
  const started = performance.now();
  try {
    if (
      options.reuseProcessed &&
      workflowResults.every(
        (result) =>
          result.command === 'next' && result.learningCheck === undefined && !result.captureOnly,
      )
    ) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const processed = await Promise.race([
          areCometWorkflowResultsProcessed(workflowResults, controller.signal).catch(() => false),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve(false);
            }, 100);
          }),
        ]);
        if (processed) return workflowResults.map(() => undefined);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    }
    const output = await runExternalCommandAsync(
      process.execPath,
      [fileURLToPath(new URL('./comet-task-context-worker.js', import.meta.url))],
      {
        input: JSON.stringify({ workflowResults }),
        timeoutMs: Math.max(1, Math.ceil(5_000 - (performance.now() - started))),
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
  trace?: { workflow: 'native' | 'classic'; change: string },
): Promise<readonly CometPluginContextContribution[]> {
  try {
    const output = await runExternalCommandAsync(
      process.execPath,
      [fileURLToPath(new URL('./comet-task-context-worker.js', import.meta.url))],
      {
        input: JSON.stringify({ projectRoot, request, ...(trace ? { trace } : {}) }),
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
