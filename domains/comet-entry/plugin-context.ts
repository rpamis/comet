import path from 'node:path';

import {
  createDefaultCometPluginBridge,
  type CometPluginContextRequest,
} from '../comet-plugin/index.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

export async function collectCometPluginContext(
  projectRoot: string,
  request: CometPluginContextRequest,
): Promise<readonly { readonly pluginId: string; readonly text: string }[]> {
  const bridge = await createBridge(projectRoot);
  const contributions = await bridge.collectContext(request);
  return contributions.map(({ pluginId, text }) => ({ pluginId: String(pluginId), text }));
}

export async function recordCometWorkflowResult(options: {
  readonly projectRoot: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly command: string;
  readonly success: boolean;
  readonly summary?: string;
}): Promise<void> {
  if (!options.changeId.trim()) return;
  const bridge = await createBridge(options.projectRoot);
  await bridge.dispatchLifecycle({
    name: options.command === 'archive' ? 'change.completed' : 'task.completed',
    workflow: options.workflow,
    changeId: options.changeId,
    success: options.success,
    category: 'workflow-operation',
    text: (options.summary ?? `${options.workflow} ${options.command}`).slice(0, 1000),
    candidateKey: `${options.workflow}:${options.command}`,
    operations: [options.command],
  });
}

async function createBridge(projectRoot: string) {
  const resolved = path.resolve(projectRoot);
  return createDefaultCometPluginBridge({
    projectRoot: resolved,
    projectId: resolveStableProjectId(resolved),
  });
}
