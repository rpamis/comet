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
  const bridge = await createBridge(projectRoot);
  const contributions = await bridge.collectContext(request);
  return contributions.map(({ pluginId, text }) => ({ pluginId: String(pluginId), text }));
}

export async function collectCometProjectRuleCandidates(projectRoot: string): Promise<unknown> {
  const bridge = await createBridge(projectRoot);
  return bridge.projectRulesAction('candidates');
}

export async function applyCometProjectRuleAction(
  projectRoot: string,
  action: 'adopt' | 'ignore' | 'snooze' | 'restore',
  input: { readonly id?: string; readonly text?: string },
): Promise<unknown> {
  const bridge = await createBridge(projectRoot);
  return bridge.projectRulesAction(action, input);
}

export async function recordCometWorkflowResult(options: {
  readonly projectRoot: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly command: string;
  readonly success: boolean;
  readonly summary?: string;
  readonly eventName?: CometLifecycleObservation['name'];
}): Promise<void> {
  if (!options.changeId.trim()) return;
  try {
    const bridge = await createBridge(options.projectRoot);
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
    });
  } catch {
    // Memory learning is optional and must never block a workflow checkpoint.
  }
}

async function createBridge(projectRoot: string) {
  const resolved = path.resolve(projectRoot);
  return createDefaultCometPluginBridge({
    projectRoot: resolved,
    projectId: resolveStableProjectId(resolved),
  });
}
