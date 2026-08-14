import { runClassicCli } from '../../domains/comet-classic/classic-cli.js';
import { resolveClassicChangeDirectory } from '../../domains/comet-classic/classic-paths.js';
import { readClassicState } from '../../domains/comet-classic/classic-store.js';
import {
  collectCometPluginContext,
  collectCometProjectRuleCandidates,
  recordCometWorkflowResult,
} from '../../domains/comet-entry/plugin-context.js';

export const PUBLIC_CLASSIC_COMMANDS = ['state', 'guard', 'handoff', 'archive'] as const;

export type PublicClassicCommand = (typeof PUBLIC_CLASSIC_COMMANDS)[number];

export async function runClassicFacade(
  command: PublicClassicCommand,
  args: readonly string[],
): Promise<number> {
  const integration = splitIntegrationArgs(args);
  const projectRoot = integration.projectRoot ?? process.cwd();
  await emitContext(projectRoot, integration);
  const result = await runClassicCli([command, ...integration.cliArgs]);
  await recordClassicResult(
    command,
    integration.cliArgs,
    result,
    integration.workflow,
    projectRoot,
  );
  if (result.exitCode === 0 && integration.ruleAction) {
    await emitCandidates(projectRoot, integration);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

export async function runClassicGroupFacade(args: readonly string[]): Promise<number> {
  if (args.length === 0 || (args.length === 1 && (args[0] === '--help' || args[0] === '-h'))) {
    process.stdout.write(
      [
        'Usage: comet classic <command> [args]',
        '',
        'Commands:',
        '  workspace prepare <name> --isolation <mode>  Prepare or reuse the Classic workspace',
        '  workspace resolve <name>                    Route to the selected Classic workspace',
        '  openspec -- <openspec-args...>       Run OpenSpec from the configured Classic root',
        '  root show                            Print the configured Classic artifact roots',
        '  root move docs --dry-run              Inspect the legacy-to-docs migration',
        '  root move docs --apply                Apply the migration immediately',
        '',
      ].join('\n'),
    );
    return 0;
  }
  const command = args[0] ?? 'classic';
  const integration = splitIntegrationArgs(args.slice(1));
  await emitContext(integration.projectRoot, integration);
  const result = await runClassicCli([command, ...integration.cliArgs]);
  await recordClassicResult(
    command,
    integration.cliArgs,
    result,
    integration.workflow,
    integration.projectRoot,
  );
  if (result.exitCode === 0 && integration.ruleAction) {
    await emitCandidates(integration.projectRoot, integration);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

async function recordClassicResult(
  command: string,
  args: readonly string[],
  result: Awaited<ReturnType<typeof runClassicCli>>,
  workflowOverride?: string,
  projectRoot = process.cwd(),
): Promise<void> {
  if (
    result.exitCode !== 0 ||
    !['state', 'guard', 'handoff', 'archive', 'workspace'].includes(command)
  )
    return;
  try {
    await recordCometWorkflowResult({
      projectRoot,
      workflow: workflowOverride ?? (await inferClassicWorkflow(args, projectRoot, command)),
      changeId: classicChangeId(args, command),
      command,
      success: true,
      summary: result.stdout,
      eventName:
        command === 'archive'
          ? 'change.completed'
          : command === 'guard'
            ? 'verification.completed'
            : 'task.completed',
    });
  } catch {
    // Plugin learning must never make a workflow command fail.
  }
}

function classicChangeId(args: readonly string[], command: string): string {
  const values = args.filter((value) => !value.startsWith('--'));
  if (command === 'state' && values[0] !== undefined) return values[1] ?? values[0];
  return values[0] ?? command;
}

async function inferClassicWorkflow(
  args: readonly string[],
  projectRoot: string,
  command: string,
): Promise<string> {
  const explicit = args.find(
    (value) => value === 'full' || value === 'hotfix' || value === 'tweak',
  );
  if (explicit) return explicit;
  const changeId = classicChangeId(args, command);
  try {
    const { directory } = await resolveClassicChangeDirectory(changeId, projectRoot);
    const projection = await readClassicState(directory, { migrate: false });
    const workflow = projection.classic?.workflow;
    if (workflow) return workflow;
  } catch {
    // A command that does not target an existing change falls back to the host hint.
  }
  return process.env.COMET_WORKFLOW ?? 'full';
}

interface ClassicIntegrationArgs {
  readonly cliArgs: readonly string[];
  readonly projectRoot: string;
  readonly task?: string;
  readonly contextPath?: string;
  readonly phase?: string;
  readonly workflow?: string;
  readonly ruleAction?: 'adopt' | 'ignore' | 'snooze' | 'restore';
  readonly ruleId?: string;
  readonly ruleText?: string;
}

function splitIntegrationArgs(args: readonly string[]): ClassicIntegrationArgs {
  const cliArgs: string[] = [];
  let projectRoot = process.cwd();
  let task: string | undefined;
  let contextPath: string | undefined;
  let phase: string | undefined;
  let workflow: string | undefined;
  let ruleAction: ClassicIntegrationArgs['ruleAction'];
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
        ruleAction = next as ClassicIntegrationArgs['ruleAction'];
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

async function emitContext(projectRoot: string, options: ClassicIntegrationArgs): Promise<void> {
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

async function emitCandidates(projectRoot: string, options: ClassicIntegrationArgs): Promise<void> {
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
