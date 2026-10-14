import { collectCometPluginContext } from '../../domains/comet-entry/plugin-context.js';
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
  const { projectRoot, request, projectLearning } = JSON.parse(input.text) as {
    projectRoot: string;
    request: CometPluginContextRequest;
    projectLearning?: ProjectLearningRequest;
  };
  const context = await withProjectIdentityScope(() =>
    projectLearning === undefined
      ? collectCometPluginContext(projectRoot, request)
      : readProjectLearningStatus(projectRoot, projectLearning),
  );
  // All context persistence has completed. Exit after flushing the response so
  // provider connection pools cannot keep this one-shot helper alive.
  process.stdout.write(JSON.stringify(context), () => process.exit(0));
} catch {
  process.exitCode = 1;
}
