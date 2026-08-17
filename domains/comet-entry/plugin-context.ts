import path from 'node:path';

import {
  createDefaultCometPluginBridge,
  type CometLifecycleObservation,
  type CometPluginContextRequest,
} from '../comet-plugin/index.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

export async function collectCometPluginContext(
  projectRoot: string,
  request: CometPluginContextRequest,
): Promise<readonly { readonly pluginId: string; readonly text: string }[]> {
  const notices: string[] = [];
  const bridge = await createBridge(projectRoot, (notice) => notices.push(notice));
  const contributions = await bridge.collectContext(request);
  for (const notice of notices) process.stderr.write(`${notice}\n`);
  return contributions.map(({ pluginId, text }) => ({ pluginId: String(pluginId), text }));
}

export async function recordCometWorkflowResult(options: {
  readonly projectRoot: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly command: string;
  readonly success: boolean;
  readonly summary?: string;
  readonly eventName?: CometLifecycleObservation['name'];
  readonly userEvidence?: readonly string[];
}): Promise<void> {
  if (!options.changeId.trim()) return;
  try {
    const notices: string[] = [];
    const bridge = await createBridge(options.projectRoot, (notice) => notices.push(notice));
    const language = bridge.currentLanguage;
    const text =
      options.summary?.trim() ||
      (language === 'en' ? 'Command checkpoint completed' : '完成命令检查点');
    await bridge.dispatchLifecycle({
      name:
        options.eventName ??
        (options.command === 'archive' ? 'change.completed' : 'task.completed'),
      workflow: options.workflow,
      changeId: options.changeId,
      success: options.success,
      category: language === 'en' ? 'Workflow checkpoint' : '工作流检查点',
      text: text.slice(0, 1000),
      candidateKey: `${options.workflow}:${options.command}`,
      operations: [options.command],
      ...(options.userEvidence === undefined || options.userEvidence.length === 0
        ? {}
        : { userEvidence: options.userEvidence.slice(0, 8) }),
    });
    for (const notice of notices) console.log(notice);
  } catch {
    // Memory learning is optional and must never block a workflow checkpoint.
  }
}

async function createBridge(projectRoot: string, onMemoryReviewNotice?: (notice: string) => void) {
  const resolved = path.resolve(projectRoot);
  return createDefaultCometPluginBridge({
    projectRoot: resolved,
    projectId: resolveStableProjectId(resolved),
    ...(onMemoryReviewNotice === undefined ? {} : { onMemoryReviewNotice }),
  });
}
