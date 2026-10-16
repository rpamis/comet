import {
  collectCometPluginContext,
  recordCometWorkflowResult,
} from '../../domains/comet-entry/plugin-context.js';
import { withProjectIdentityScope } from '../../platform/paths/project-identity.js';
import { readStdinTextWithTimeoutAsync } from '../../platform/process/stdin-read.js';
import type { CometPluginContextRequest } from '../../domains/comet-plugin/comet.js';
import {
  readProjectLearningStatus,
  type ProjectLearningRequest,
} from '../../domains/project-knowledge/index.js';

try {
  const input = await readStdinTextWithTimeoutAsync();
  if (!input.text) throw new Error('Task context input is unavailable');
  const { projectRoot, request, projectLearning, workflowResults } = JSON.parse(input.text) as {
    projectRoot: string;
    request: CometPluginContextRequest;
    projectLearning?: ProjectLearningRequest;
    workflowResults?: readonly Parameters<typeof recordCometWorkflowResult>[0][];
  };
  const context = await withProjectIdentityScope(async () => {
    if (workflowResults !== undefined) {
      if (!Array.isArray(workflowResults) || workflowResults.length > 3)
        throw new Error('Expected at most three workflow checkpoints');
      for (const result of workflowResults)
        await recordCometWorkflowResult({ ...result, captureOnly: true });
      const results = [];
      for (const result of workflowResults) results.push(await recordCometWorkflowResult(result));
      return results;
    }
    return projectLearning === undefined
      ? collectCometPluginContext(projectRoot, request)
      : readProjectLearningStatus(projectRoot, projectLearning);
  });
  // All context persistence has completed. Exit after flushing the response so
  // provider connection pools cannot keep this one-shot helper alive.
  process.stdout.write(JSON.stringify(context), () => process.exit(0));
} catch {
  process.exitCode = 1;
}
