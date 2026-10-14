import { fileURLToPath } from 'node:url';
import type {
  CometPluginContextContribution,
  CometPluginContextRequest,
} from '../../domains/comet-plugin/comet.js';
import {
  ExternalCommandError,
  runExternalCommandAsync,
} from '../../platform/process/external-command.js';

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
