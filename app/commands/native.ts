import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import {
  collectCometPluginContext,
  collectCometProjectRuleCandidates,
  recordCometWorkflowResult,
} from '../../domains/comet-entry/plugin-context.js';
import path from 'node:path';

export async function runNativeFacade(args: readonly string[]): Promise<number> {
  const integration = splitIntegrationArgs(args);
  const projectRoot = path.resolve(integration.projectRoot ?? process.cwd());
  await emitContext(projectRoot, integration);
  const result = await runNativeCli(integration.cliArgs);
  await recordNativeResult(integration.cliArgs, result, integration.workflow);
  if (result.exitCode === 0 && integration.ruleAction) {
    await emitCandidates(projectRoot, integration);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr)
    process.stderr.write(result.stderr + (result.stderr.endsWith('\n') ? '' : '\n'));
  return result.exitCode;
}

async function recordNativeResult(
  args: readonly string[],
  result: Awaited<ReturnType<typeof runNativeCli>>,
  workflowOverride?: string,
): Promise<void> {
  if (result.exitCode !== 0) return;
  const command = args.find((value) => ['next', 'archive', 'handoff', 'check'].includes(value));
  if (!command || !['next', 'archive', 'handoff', 'check'].includes(command)) return;
  const commandIndex = args.indexOf(command);
  const projectIndex = args.indexOf('--project-root');
  const projectRoot = projectIndex >= 0 ? args[projectIndex + 1] : process.cwd();
  if (!projectRoot) return;
  const changeId = args
    .slice(commandIndex + 1, projectIndex >= 0 ? projectIndex : args.length)
    .find((value) => !value.startsWith('--'));
  try {
    await recordCometWorkflowResult({
      projectRoot: path.resolve(projectRoot),
      workflow: workflowOverride ?? 'native',
      changeId: changeId ?? command,
      command,
      success: true,
      summary: result.stdout,
      eventName:
        command === 'archive'
          ? 'change.completed'
          : command === 'check' || args.includes('--result')
            ? 'verification.completed'
            : 'task.completed',
    });
  } catch {
    // Plugin learning must never make a workflow command fail.
  }
}

interface NativeIntegrationArgs {
  readonly cliArgs: readonly string[];
  readonly projectRoot?: string;
  readonly task?: string;
  readonly contextPath?: string;
  readonly phase?: string;
  readonly workflow?: string;
  readonly ruleAction?: 'adopt' | 'ignore' | 'snooze' | 'restore';
  readonly ruleId?: string;
  readonly ruleText?: string;
}

function splitIntegrationArgs(args: readonly string[]): NativeIntegrationArgs {
  const cliArgs: string[] = [];
  let projectRoot: string | undefined;
  let task: string | undefined;
  let contextPath: string | undefined;
  let phase: string | undefined;
  let workflow: string | undefined;
  let ruleAction: NativeIntegrationArgs['ruleAction'];
  let ruleId: string | undefined;
  let ruleText: string | undefined;
  let summary: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    const next = args[index + 1];
    if (
      value === '--comet-task' ||
      value === '--comet-path' ||
      value === '--comet-phase' ||
      value === '--comet-workflow' ||
      value === '--comet-rule-action' ||
      value === '--comet-rule-id' ||
      value === '--comet-rule-text'
    ) {
      if (next === undefined) throw new Error(`${value} requires a value`);
      if (value === '--comet-task') task = next;
      if (value === '--comet-path') contextPath = next;
      if (value === '--comet-phase') phase = next;
      if (value === '--comet-workflow') workflow = next;
      if (value === '--comet-rule-action') {
        if (!['adopt', 'ignore', 'snooze', 'restore'].includes(next))
          throw new Error(`${value} must be adopt, ignore, snooze, or restore`);
        ruleAction = next as NativeIntegrationArgs['ruleAction'];
      }
      if (value === '--comet-rule-id') ruleId = next;
      if (value === '--comet-rule-text') ruleText = next;
      index += 1;
      continue;
    }
    cliArgs.push(value);
    if (value === '--project-root' && next !== undefined) projectRoot = next;
    if (value === '--summary' && next !== undefined) summary = next;
  }
  return {
    cliArgs,
    projectRoot,
    task: task ?? process.env.COMET_TASK ?? summary,
    contextPath,
    phase,
    workflow,
    ruleAction,
    ruleId,
    ruleText,
  };
}

async function emitContext(projectRoot: string, options: NativeIntegrationArgs): Promise<void> {
  if (!options.task?.trim()) return;
  try {
    const contributions =
      (await collectCometPluginContext(projectRoot, {
        task: options.task,
        ...(options.contextPath ? { path: options.contextPath } : {}),
        ...(options.phase ? { phase: options.phase } : {}),
      })) ?? [];
    if (contributions.length === 0) return;
    process.stderr.write(
      `Comet context:\n${contributions.map((entry) => `- ${entry.text}`).join('\n')}\n`,
    );
  } catch {
    // Context injection is best effort and must not block the workflow.
  }
}

async function emitCandidates(projectRoot: string, options: NativeIntegrationArgs): Promise<void> {
  try {
    if (options.ruleAction) {
      const { applyCometProjectRuleAction } =
        await import('../../domains/comet-entry/plugin-context.js');
      await applyCometProjectRuleAction(projectRoot, options.ruleAction, {
        ...(options.ruleId ? { id: options.ruleId } : {}),
        ...(options.ruleText ? { text: options.ruleText } : {}),
      });
    }
    const envelope = (await collectCometProjectRuleCandidates(projectRoot)) as
      | { summary?: unknown; candidates?: unknown; operations?: unknown }
      | null
      | undefined;
    if (!envelope || !Array.isArray(envelope.candidates) || envelope.candidates.length === 0)
      return;
    if (typeof envelope.summary === 'string') {
      const operations = Array.isArray(envelope.operations)
        ? `\n可执行操作：${envelope.operations.join('、')}`
        : '';
      process.stderr.write(`Comet project-rule candidates:\n${envelope.summary}${operations}\n`);
    }
  } catch {
    // Candidate discovery is best effort and must not block the workflow.
  }
}
