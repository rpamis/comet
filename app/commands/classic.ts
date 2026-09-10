import type { ClassicCommandResult } from '../../domains/comet-classic/classic-cli.js';
import { withProjectIdentityScope } from '../../platform/paths/project-identity.js';
import {
  classicChangeId,
  inferClassicWorkflow,
  parseClassicLifecycleEvidence,
} from '../../domains/comet-classic/classic-experience.js';

export const PUBLIC_CLASSIC_COMMANDS = ['state', 'guard', 'handoff', 'archive', 'check'] as const;

export type PublicClassicCommand = (typeof PUBLIC_CLASSIC_COMMANDS)[number];

export async function runClassicFacade(
  command: PublicClassicCommand,
  args: readonly string[],
  executor?: (argv: readonly string[]) => Promise<ClassicCommandResult>,
): Promise<number> {
  let integration: ClassicIntegrationArgs;
  try {
    integration = splitIntegrationArgs(args);
  } catch (error) {
    return reportIntegrationFailure(command, args, error);
  }
  const projectRoot = integration.projectRoot ?? process.cwd();
  await emitContext(projectRoot, integration);
  const execute =
    executor ?? (await import('../../domains/comet-classic/classic-cli.js')).runClassicCli;
  const result = await execute([command, ...integration.cliArgs]);
  await withProjectIdentityScope(() =>
    recordClassicResult(command, integration.cliArgs, result, integration.workflow, projectRoot),
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
        '  state current | state next <name>    Inspect the current change or next workflow action',
        '  check run <name> <build|verify> ...  Execute a check and record evidence',
        '',
        'Advanced workflow operations (may write state or execute checks):',
        '  state <command>                     Read or update workflow state',
        '  guard <name> <phase> [--apply]        Validate requirements; optionally advance',
        '  handoff <name> design --write        Write the Design handoff',
        '  archive <name> [--dry-run]           Archive a completed change',
        '  validate <name>                     Validate the Classic state schema',
        '  workspace prepare <name> --isolation <mode>  Prepare or reuse the Classic workspace',
        '  workspace resolve <name>                    Route to the selected Classic workspace',
        '  openspec -- <openspec-args...>       Run OpenSpec from the configured Classic root',
        '  root show                            Print the configured Classic artifact roots',
        '  root move docs --dry-run              Inspect the legacy-to-docs migration',
        '  root move docs --apply                Apply the migration immediately',
        '',
        'Use comet classic <command> --help for details and side effects.',
        'Public shortcuts: comet state, comet check, comet guard, comet handoff, comet archive.',
        '',
      ].join('\n'),
    );
    return 0;
  }
  const command = args[0] ?? 'classic';
  let integration: ClassicIntegrationArgs;
  try {
    integration = splitIntegrationArgs(args.slice(1));
  } catch (error) {
    return reportIntegrationFailure(command, args.slice(1), error);
  }
  await emitContext(integration.projectRoot, integration);
  const { runClassicCli } = await import('../../domains/comet-classic/classic-cli.js');
  const result = await runClassicCli([command, ...integration.cliArgs]);
  await withProjectIdentityScope(() =>
    recordClassicResult(
      command,
      integration.cliArgs,
      result,
      integration.workflow,
      integration.projectRoot,
    ),
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

async function recordClassicResult(
  command: string,
  args: readonly string[],
  result: ClassicCommandResult,
  workflowOverride?: string,
  projectRoot = process.cwd(),
): Promise<void> {
  if (hasOwnHelp(args)) return;
  if (!['state', 'guard', 'handoff', 'archive', 'workspace'].includes(command)) return;
  if (result.exitCode !== 0 && command !== 'guard') return;
  try {
    const { recordCometWorkflowResult } =
      await import('../../domains/comet-entry/plugin-context.js');
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

class ClassicIntegrationFailure extends Error {
  constructor(readonly field: string) {
    super(`${field} requires a value`);
  }
}

function reportIntegrationFailure(
  command: string,
  args: readonly string[],
  error: unknown,
): number {
  const message = error instanceof Error ? error.message : String(error);
  const boundary = args.indexOf('--');
  if ((boundary < 0 ? args : args.slice(0, boundary)).includes('--json')) {
    process.stdout.write(
      JSON.stringify({
        command,
        exitCode: 64,
        data: {
          issues: [
            {
              code: 'CLASSIC_INTEGRATION_ARGUMENT_MISSING',
              field: error instanceof ClassicIntegrationFailure ? error.field : 'arguments',
              message,
              expected: 'a value before --',
              remediation:
                'Provide the integration option value before the child argument separator.',
            },
          ],
        },
        stderr: message,
      }) + '\n',
    );
  } else process.stderr.write(message + '\n');
  return 64;
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
    if (value === '--') {
      cliArgs.push(...args.slice(index));
      break;
    }
    const next = args[index + 1];
    if (
      value === '--comet-task' ||
      value === '--comet-path' ||
      value === '--comet-phase' ||
      value === '--comet-workflow'
    ) {
      if (next === undefined || next === '--') throw new ClassicIntegrationFailure(value);
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
  if (hasOwnHelp(options.cliArgs)) return;
  if (!options.task?.trim()) return;
  try {
    const { collectCometPluginContext } =
      await import('../../domains/comet-entry/plugin-context.js');
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

function hasOwnHelp(args: readonly string[]): boolean {
  const boundary = args.indexOf('--');
  const owned = boundary < 0 ? args : args.slice(0, boundary);
  return owned.includes('--help') || owned.includes('-h');
}
