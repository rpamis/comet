import path from 'node:path';
import { ProjectKnowledgeHostReview } from '../project-knowledge/host-review.js';
import { createHash } from 'node:crypto';

import {
  createDefaultCometPluginBridge,
  type CometPluginContextContribution,
  type CometPluginContextRequest,
} from '../comet-plugin/index.js';
import type { MemoryLearningStatus } from '../comet-memory/index.js';
import {
  AGENT_EXPERIENCE_SCHEMA,
  type AgentContextExpansion,
  type AgentContextOutcomeStatus,
  type AgentContextOutcomeEvidence,
  type AgentExperienceEventType,
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
  return new Promise((resolve) => {
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
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve([]);
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

export async function recordCometWorkflowResult(options: {
  readonly projectRoot: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly command: string;
  readonly success: boolean;
  readonly eventType?: AgentExperienceEventType;
  readonly changedPaths?: readonly string[];
  readonly artifactRefs?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly verificationResults?: readonly {
    readonly command: string;
    readonly success: boolean;
  }[];
  readonly summary?: string;
  /** Whether the host performed the task-end learning check. */
  readonly learningCheck?: 'submitted' | 'no-observation' | 'not-run';
}): Promise<MemoryLearningStatus | undefined> {
  if (!options.changeId.trim()) return;
  try {
    const notices: string[] = [];
    const bridge = await createBridge(options.projectRoot, (notice) => notices.push(notice), {
      lockTimeoutMs: 750,
    });
    const language = bridge.currentLanguage;
    let learningStatus: MemoryLearningStatus | undefined;
    if (options.learningCheck !== undefined) {
      try {
        learningStatus = await bridge.recordMemoryLearningCheck(options.learningCheck, {
          projectKey: bridge.currentProjectId,
          workflow: options.workflow,
          changeId: options.changeId,
        });
      } catch {
        // A Provider may not implement the optional task-end diagnostic yet;
        // still dispatch the workflow checkpoint and keep the task nonblocking.
      }
    }
    const eventType =
      options.eventType ??
      (options.command === 'archive'
        ? 'change.archived'
        : options.verificationResults !== undefined || options.command === 'check'
          ? 'verification.completed'
          : 'episode.completed');
    const evidence = [
      ...(options.changedPaths ?? []).map((source, index) => ({
        id: `source-${index}`,
        kind: 'source' as const,
        summary: `Changed source: ${source}`,
        source,
        digest: digest(`${source}:${options.changeId}`),
      })),
      ...(options.artifactRefs ?? []).map((source, index) => ({
        id: `artifact-${index}`,
        kind: 'source' as const,
        summary: `Workflow artifact: ${source}`,
        source,
        digest: digest(`${source}:${options.changeId}:artifact`),
      })),
      ...(options.verificationResults ?? []).map((result, index) => ({
        id: `verification-${index}`,
        kind: 'verification' as const,
        summary: `${result.command}: ${result.success ? 'passed' : 'failed'}`,
        command: result.command,
        success: result.success,
        digest: digest(`${result.command}:${result.success}`),
      })),
      ...(options.verificationCommands ?? [])
        .filter(
          (command) =>
            !(options.verificationResults ?? []).some((result) => result.command === command),
        )
        .map((command, index) => ({
          id: `verification-command-${index}`,
          kind: 'verification' as const,
          summary: `Verification command: ${command}`,
          command,
          digest: digest(command),
        })),
    ];
    await bridge.dispatchExperience({
      schema: AGENT_EXPERIENCE_SCHEMA,
      eventId: `workflow:${digest(
        JSON.stringify({
          workflow: options.workflow,
          changeId: options.changeId,
          command: options.command,
          eventType,
          success: options.success,
          evidence,
        }),
      )}`,
      episodeId: `workflow:${digest(`${options.workflow}:${options.changeId}`)}`,
      occurredAt: new Date().toISOString(),
      type: eventType,
      actor: 'workflow',
      scope: 'project',
      projectId: bridge.currentProjectId,
      source: {
        kind: 'workflow',
        name: options.workflow,
        workflow: options.workflow,
        changeId: options.changeId,
        command: options.command,
      },
      context: {
        workflow: options.workflow,
        changeId: options.changeId,
        operation: options.command,
        ...(options.changedPaths === undefined ? {} : { paths: options.changedPaths }),
      },
      evidence,
      outcome: {
        status: options.success ? 'used-successfully' : 'contributed-to-failure',
        summary:
          options.summary ??
          (language === 'en' ? 'Workflow checkpoint completed' : '工作流检查点已完成'),
      },
    });
    for (const notice of notices) console.log(notice);
    return learningStatus;
  } catch {
    // Memory learning is optional and must never block a workflow checkpoint.
    return undefined;
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
