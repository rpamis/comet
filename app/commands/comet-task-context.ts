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
