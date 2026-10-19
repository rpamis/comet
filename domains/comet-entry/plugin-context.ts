import path from 'node:path';
import { ProjectKnowledgeHostReview } from '../project-knowledge/host-review.js';
import { workflowResultEvent, type CometWorkflowResult } from './workflow-learning-receipt.js';
export { areCometWorkflowResultsProcessed } from './workflow-learning-receipt.js';
export type { CometWorkflowResult } from './workflow-learning-receipt.js';

import {
  createDefaultCometPluginBridge,
  type CometPluginContextContribution,
  type CometPluginContextRequest,
} from '../comet-plugin/comet.js';
import type { MemoryLearningStatus } from '../comet-memory/index.js';
import {
  type AgentContextExpansion,
  type AgentContextOutcomeStatus,
  type AgentContextOutcomeEvidence,
} from '../agent-learning/index.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

export async function collectCometPluginContext(
  projectRoot: string,
  request: CometPluginContextRequest,
  options: { lockTimeoutMs?: number; bestEffortContext?: boolean } = {},
): Promise<readonly CometPluginContextContribution[]> {
  const notices: string[] = [];
  const bridge = await createBridge(projectRoot, (notice) => notices.push(notice), {
    lockTimeoutMs: options.lockTimeoutMs ?? 750,
    ...(options.bestEffortContext === true ? { bestEffortContext: true } : {}),
  });
  const contributions = await bridge.collectContext(request);
  try {
    if ((await new ProjectKnowledgeHostReview(projectRoot).pending()).length > 0) {
      process.stderr.write(
        'Project knowledge: host Agent review pending. Run comet knowledge review --json, inspect the evidence, and submit supported lessons with --id and --file.\n',
      );
    }
  } catch {
    process.stderr.write('Project knowledge: pending review status is unavailable.\n');
  }
  for (const notice of notices) process.stderr.write(`${notice}\n`);
  for (const diagnostic of await bridge.diagnostics()) {
    if (diagnostic.pluginId !== 'comet.project-knowledge' || diagnostic.phase !== 'context')
      continue;
    process.stderr.write(`Project knowledge: ${diagnostic.message}\n`);
  }
  return contributions;
}

/**
 * Hook context is advisory.  Bound the whole bridge path so a held plugin,
 * memory, or provider lock can never delay a write Hook indefinitely.  The
 * in-flight operation is intentionally allowed to finish on its own; the
 * best-effort bridge performs no durable context writes or reflection replay.
 */
export async function collectCometHookContext(
  projectRoot: string,
  request: CometPluginContextRequest,
): Promise<readonly CometPluginContextContribution[]> {
  const task = collectCometPluginContext(projectRoot, request, {
    lockTimeoutMs: 750,
    bestEffortContext: true,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve([]);
    }, 1_500);
    void task.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function expandCometPluginContext(
  projectRoot: string,
  id: string,
  request: CometPluginContextRequest,
): Promise<AgentContextExpansion | null> {
  const bridge = await createBridge(projectRoot, undefined, { lockTimeoutMs: 750 });
  return bridge.expandContext(id, request);
}

export async function recordCometContextOutcome(options: {
  readonly projectRoot: string;
  readonly applicationId: string;
  readonly outcome: AgentContextOutcomeStatus;
  readonly evidence?: AgentContextOutcomeEvidence;
}): Promise<void> {
  const bridge = await createBridge(options.projectRoot, undefined, { lockTimeoutMs: 750 });
  await bridge.recordContextOutcome(options.applicationId, options.outcome, options.evidence);
}

export async function recordCometWorkflowResult(
  options: CometWorkflowResult,
): Promise<MemoryLearningStatus | undefined> {
  if (!options.changeId.trim()) return;
  try {
    const notices: string[] = [];
    const bridge = await createBridge(options.projectRoot, (notice) => notices.push(notice), {
      lockTimeoutMs: 750,
    });
    const language = bridge.currentLanguage;
    let learningStatus: MemoryLearningStatus | undefined;
    const event = workflowResultEvent(options, bridge.currentProjectId, language);
    await bridge.pluginRuntime.enqueueEvents([event]);
    if (options.captureOnly) return undefined;
    if (options.learningCheck !== undefined) {
      try {
        learningStatus = await bridge.recordMemoryLearningCheck(options.learningCheck, {
          projectKey: bridge.currentProjectId,
          workflow: options.workflow,
          changeId: options.changeId,
        });
      } catch {
        // The checkpoint is already durable even if the optional Provider diagnostic fails.
      }
    }
    await bridge.dispatchExperience(event);
    for (const notice of notices) process.stderr.write(`${notice}\n`);
    return learningStatus;
  } catch {
    // Memory learning is optional and must never block a workflow checkpoint.
    process.stderr.write(
      'Workflow learning checkpoint is unavailable; the workflow result is unchanged.\n',
    );
    return undefined;
  }
}

async function createBridge(
  projectRoot: string,
  onMemoryReviewNotice?: (notice: string) => void,
  options: { lockTimeoutMs?: number; bestEffortContext?: boolean } = {},
) {
  const resolved = path.resolve(projectRoot);
  return createDefaultCometPluginBridge({
    projectRoot: resolved,
    projectId: resolveStableProjectId(resolved),
    // CLI and Hook invocations are short-lived processes. Complete the
    // durable Reflection before returning so learning is not lost at exit.
    scheduleLearning: (task) => task(),
    ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
    ...(options.bestEffortContext === true ? { bestEffortContext: true } : {}),
    ...(onMemoryReviewNotice === undefined ? {} : { onMemoryReviewNotice }),
  });
}
