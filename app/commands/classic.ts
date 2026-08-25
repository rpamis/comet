import { runClassicCli } from '../../domains/comet-classic/classic-cli.js';
import {
  classicChangeId,
  inferClassicWorkflow,
  parseClassicLifecycleEvidence,
} from '../../domains/comet-classic/classic-experience.js';
import {
  collectCometPluginContext,
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
  if (!['state', 'guard', 'handoff', 'archive', 'workspace'].includes(command)) return;
  if (result.exitCode !== 0 && command !== 'guard') return;
  try {
    const verificationCommand = command === 'guard' ? 'comet classic guard' : undefined;
    const evidence = parseClassicLifecycleEvidence(result.stdout);
    await recordCometWorkflowResult({
      projectRoot,
      workflow: workflowOverride ?? (await inferClassicWorkflow(args, projectRoot, command)),
      changeId: classicChangeId(args, command),
      command,
      success: result.exitCode === 0,
      eventType:
        command === 'archive'
          ? 'change.archived'
          : command === 'guard'
            ? 'verification.completed'
            : 'episode.completed',
      ...(verificationCommand
        ? {
            verificationCommands: [verificationCommand],
            verificationResults: [{ command: verificationCommand, success: result.exitCode === 0 }],
          }
        : {}),
      ...(evidence.changedPaths.length > 0 ? { changedPaths: evidence.changedPaths } : {}),
      ...(evidence.artifactRefs.length > 0 ? { artifactRefs: evidence.artifactRefs } : {}),
    });
  } catch {
    // Plugin learning must never make a workflow command fail.
  }
}

interface ClassicIntegrationArgs {
  readonly cliArgs: readonly string[];
  readonly projectRoot: string;
  readonly task?: string;
  readonly contextPath?: string;
  readonly phase?: string;
  readonly workflow?: string;
}

function splitIntegrationArgs(args: readonly string[]): ClassicIntegrationArgs {
  const cliArgs: string[] = [];
  let projectRoot = process.cwd();
  let task: string | undefined;
  let contextPath: string | undefined;
  let phase: string | undefined;
  let workflow: string | undefined;
  let summary: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    const next = args[index + 1];
    if (
      value === '--comet-task' ||
      value === '--comet-path' ||
      value === '--comet-phase' ||
      value === '--comet-workflow'
    ) {
      if (next === undefined) throw new Error(`${value} requires a value`);
      if (value === '--comet-task') task = next;
      if (value === '--comet-path') contextPath = next;
      if (value === '--comet-phase') phase = next;
      if (value === '--comet-workflow') workflow = next;
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
