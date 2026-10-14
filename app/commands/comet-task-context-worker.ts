import { collectCometPluginContext } from '../../domains/comet-entry/plugin-context.js';
import { withProjectIdentityScope } from '../../platform/paths/project-identity.js';
import { readStdinTextWithTimeoutAsync } from '../../platform/process/stdin-read.js';
import type { CometPluginContextRequest } from '../../domains/comet-plugin/comet.js';

try {
  const input = await readStdinTextWithTimeoutAsync();
  if (!input.text) throw new Error('Task context input is unavailable');
  const { projectRoot, request } = JSON.parse(input.text) as {
    projectRoot: string;
    request: CometPluginContextRequest;
  };
  const context = await withProjectIdentityScope(() =>
    collectCometPluginContext(projectRoot, request),
  );
  // All context persistence has completed. Exit after flushing the response so
  // provider connection pools cannot keep this one-shot helper alive.
  process.stdout.write(JSON.stringify(context), () => process.exit(0));
} catch {
  process.exitCode = 1;
}
