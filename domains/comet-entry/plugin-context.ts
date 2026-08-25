import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  createDefaultCometPluginBridge,
  type CometPluginContextContribution,
  type CometPluginContextRequest,
} from '../comet-plugin/index.js';
import {
  AGENT_EXPERIENCE_SCHEMA,
  type AgentContextExpansion,
  type AgentContextOutcomeStatus,
  type AgentExperienceEventType,
} from '../agent-learning/index.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

export async function collectCometPluginContext(
  projectRoot: string,
  request: CometPluginContextRequest,
): Promise<readonly CometPluginContextContribution[]> {
  const notices: string[] = [];
  const bridge = await createBridge(projectRoot, (notice) => notices.push(notice));
  const contributions = await bridge.collectContext(request);
  for (const notice of notices) process.stderr.write(`${notice}\n`);
  for (const diagnostic of await bridge.diagnostics()) {
    if (diagnostic.pluginId !== 'comet.project-knowledge' || diagnostic.phase !== 'context')
      continue;
    process.stderr.write(`Project knowledge: ${diagnostic.message}\n`);
  }
  return contributions;
}

export async function expandCometPluginContext(
  projectRoot: string,
  id: string,
  request: CometPluginContextRequest,
): Promise<AgentContextExpansion | null> {
  const bridge = await createBridge(projectRoot);
  return bridge.expandContext(id, request);
}

export async function recordCometContextOutcome(options: {
  readonly projectRoot: string;
  readonly applicationId: string;
  readonly outcome: AgentContextOutcomeStatus;
}): Promise<void> {
  const bridge = await createBridge(options.projectRoot);
  await bridge.recordContextOutcome(options.applicationId, options.outcome);
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
}): Promise<void> {
  if (!options.changeId.trim()) return;
  try {
    const notices: string[] = [];
    const bridge = await createBridge(options.projectRoot, (notice) => notices.push(notice));
    const language = bridge.currentLanguage;
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
  } catch {
    // Memory learning is optional and must never block a workflow checkpoint.
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function createBridge(projectRoot: string, onMemoryReviewNotice?: (notice: string) => void) {
  const resolved = path.resolve(projectRoot);
  return createDefaultCometPluginBridge({
    projectRoot: resolved,
    projectId: resolveStableProjectId(resolved),
    ...(onMemoryReviewNotice === undefined ? {} : { onMemoryReviewNotice }),
  });
}
