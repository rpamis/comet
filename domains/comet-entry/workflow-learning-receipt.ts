import path from 'node:path';
import { createHash } from 'node:crypto';
import { AGENT_EXPERIENCE_SCHEMA, type AgentExperienceEventType } from '../agent-learning/index.js';
import { areDefaultWorkflowEventsProcessed } from '../comet-plugin/learning-receipt.js';
import { resolveStableProjectIdAsync } from '../../platform/paths/project-identity.js';

export interface CometWorkflowResult {
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
  /** Persist the checkpoint before a worker begins optional Provider maintenance. */
  readonly captureOnly?: boolean;
}

/** 只读取权威事件回执；缺失或未完成的学习仍执行原路径。 */
export async function areCometWorkflowResultsProcessed(
  results: readonly CometWorkflowResult[],
  signal: AbortSignal,
): Promise<boolean> {
  if (
    results.length === 0 ||
    results.length > 3 ||
    results.some(
      (result) =>
        !fitsReceiptBudget(result) ||
        !result.changeId.trim() ||
        result.learningCheck !== undefined ||
        result.captureOnly ||
        path.resolve(result.projectRoot) !== path.resolve(results[0]!.projectRoot),
    )
  )
    return false;
  const projectId = await resolveStableProjectIdAsync(results[0]!.projectRoot, {
    signal,
    timeoutMs: 100,
  });
  if (signal.aborted) return false;
  return areDefaultWorkflowEventsProcessed(
    results.map((result) => workflowResultEvent(result, projectId, 'zh-CN')),
  );
}

// 大批证据留给原有 worker；可选回执检查不在父进程展开无界输入。
function fitsReceiptBudget(result: CometWorkflowResult): boolean {
  const paths = result.changedPaths ?? [];
  const artifacts = result.artifactRefs ?? [];
  const commands = result.verificationCommands ?? [];
  const verifications = result.verificationResults ?? [];
  if (paths.length + artifacts.length + commands.length + verifications.length > 128) return false;
  const strings = [
    result.projectRoot,
    result.workflow,
    result.changeId,
    result.command,
    result.summary ?? '',
    ...paths,
    ...artifacts,
    ...commands,
    ...verifications.map((item) => item.command),
  ];
  return strings.reduce((total, value) => total + value.length, 0) <= 64 * 1024;
}

export function workflowResultEvent(
  options: CometWorkflowResult,
  projectId: string,
  language: string,
) {
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
  return {
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
    projectId,
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
  } satisfies import('../agent-learning/index.js').AgentExperienceEvent;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
