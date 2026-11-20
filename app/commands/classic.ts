import { compactCliStdout } from '../../domains/workflow-contract/compact-output.js';
import { splitCompactOutputArgs } from './compact-output.js';
import type { ClassicCommandResult } from '../../domains/comet-classic/classic-cli.js';
import { withProjectIdentityScope } from '../../platform/paths/project-identity.js';
import path from 'node:path';

export const PUBLIC_CLASSIC_COMMANDS = ['state', 'guard', 'handoff', 'archive', 'check'] as const;

export type PublicClassicCommand = (typeof PUBLIC_CLASSIC_COMMANDS)[number];

export async function runClassicFacade(
  command: PublicClassicCommand,
  args: readonly string[],
  executor?: (argv: readonly string[]) => Promise<ClassicCommandResult>,
): Promise<number> {
  const outputArgs = splitCompactOutputArgs(args, args[0] !== 'openspec');
  let integration: ClassicIntegrationArgs;
  try {
    integration = splitIntegrationArgs(outputArgs.args);
  } catch (error) {
    return reportIntegrationFailure(command, args, error);
  }
  const projectRoot = integration.projectRoot ?? process.cwd();
  await emitContext(projectRoot, integration);
  const execute =
    executor ?? (await import('../../domains/comet-classic/classic-cli.js')).runClassicCli;
  const result = await execute([command, ...integration.cliArgs]);
  if (shouldRecordClassicResult(command, integration.cliArgs, integration)) {
    await withProjectIdentityScope(() =>
      recordClassicResult(command, integration.cliArgs, result, integration.workflow, projectRoot),
    );
  }
  if (result.stdout) process.stdout.write(compactCliStdout(result.stdout, outputArgs.compact)!);
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
        '  context-cost <name> [--trace <file>]  Report the current phase context costs (read-only)',
        '  state complete-build <name> --checks <file>  Submit platform check reports for a new Run',
        '  guard <name> verify --report <ref> --apply --checks <file>  Submit acceptance and check reports',
        '  check run <name> <build|verify> ...  Execute a managed check for a legacy Run',
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
  if (command === 'context-cost') return runClassicContextCost(args.slice(1));
  const outputArgs = splitCompactOutputArgs(args, args[0] !== 'openspec');
  let integration: ClassicIntegrationArgs;
  try {
    integration = splitIntegrationArgs(outputArgs.args.slice(1));
  } catch (error) {
    return reportIntegrationFailure(command, args.slice(1), error);
  }
  await emitContext(integration.projectRoot, integration);
  const { runClassicCli } = await import('../../domains/comet-classic/classic-cli.js');
  const result = await runClassicCli([command, ...integration.cliArgs]);
  if (shouldRecordClassicResult(command, integration.cliArgs, integration)) {
    await withProjectIdentityScope(() =>
      recordClassicResult(
        command,
        integration.cliArgs,
        result,
        integration.workflow,
        integration.projectRoot,
      ),
    );
  }
  if (result.stdout) process.stdout.write(compactCliStdout(result.stdout, outputArgs.compact)!);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

async function runClassicContextCost(args: readonly string[]): Promise<number> {
  const usage =
    'Usage: comet classic context-cost <name> [--project-root <dir>] [--trace <file>] [--json]';
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      `${usage}\n\n` +
        'Shows bundled Rule and stage file byte estimates and one read-only state next response. ' +
        'The byte estimates describe selected package files and CLI output. They do not measure model input or platform customization.\n\n' +
        'Use --trace with a JSON summary of actual platform measurements. Copy scope from the JSON report.\n' +
        'Example: {"schema":"comet.classic.context-trace.v1","scope":{"projectRoot":"/project","change":"my-change","phase":"build"},\n' +
        '          "source":"platform-trace-export","metrics":{"inputTokens":1200,"toolRoundTrips":4,"waitMs":250},\n' +
        '          "categories":{"cli":{"contextBytes":420}}}\n' +
        'Omit any measurement not available from the trace.\n',
    );
    return 0;
  }
  const json = args.includes('--json');
  let exitCode = 64;
  try {
    const [change, ...options] = args.filter((arg) => arg !== '--json');
    if (!change || change.startsWith('-')) throw new Error(usage);
    const flags = new Map<string, string>();
    for (let index = 0; index < options.length; index += 2) {
      const flag = options[index];
      const value = options[index + 1];
      if (
        !['--project-root', '--trace'].includes(flag) ||
        !value ||
        value.startsWith('--') ||
        flags.has(flag)
      )
        throw new Error(usage);
      flags.set(flag, value);
    }
    exitCode = 1;
    const [
      { runClassicCli },
      { discoverClassicProject },
      { classicContextCost },
      { getAssetsDir },
    ] = await Promise.all([
      import('../../domains/comet-classic/classic-cli.js'),
      import('../../domains/comet-classic/classic-layout.js'),
      import('../../domains/comet-classic/classic-context-cost.js'),
      import('../../domains/skill/platform-install.js'),
    ]);
    const requestedRoot = flags.get('--project-root');
    const projectRoot = requestedRoot
      ? path.resolve(requestedRoot)
      : await discoverClassicProject(process.cwd());
    const current = await runClassicCli(['state', 'next', change, '--json'], undefined, {
      projectRoot,
      readOnly: true,
      ...(requestedRoot ? { invocationCwd: projectRoot } : {}),
    });
    const { data, stderr } = JSON.parse(current.stdout ?? '{}');
    if (current.exitCode !== 0)
      throw new Error(stderr?.trim() || 'Unable to read the Classic change.');
    const report = await classicContextCost({
      assetsRoot: getAssetsDir(),
      projectRoot: data.projectRoot ?? projectRoot,
      change,
      phase: data.phase,
      configuration: data.configuration,
      cliBytes: Buffer.byteLength(current.stdout!),
      traceFile: flags.get('--trace'),
    });
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ command: 'context-cost', exitCode: 0, data: report })}\n`,
      );
    } else {
      const format = (metric: { value: number; unit: string; kind: string } | null | undefined) =>
        metric ? `${metric.value} ${metric.unit} (${metric.kind})` : 'unavailable';
      process.stdout.write(
        [
          `Classic context costs for ${report.scope.change} (${report.scope.phase})`,
          ...Object.entries(report.categories).map(([category, row]) => {
            const actual = Object.entries(row.observed).map(
              ([name, metric]) => `${name}: ${format(metric)}`,
            );
            return `  ${category}: ${format(row.estimate)}; trace: ${actual.join(', ') || 'unavailable'}`;
          }),
          ...Object.entries(report.metrics).map(([name, metric]) => `  ${name}: ${format(metric)}`),
          '',
        ].join('\n'),
      );
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json)
      process.stdout.write(
        `${JSON.stringify({ command: 'context-cost', exitCode, stderr: message })}\n`,
      );
    else process.stderr.write(`${message}\n`);
    return exitCode;
  }
}

function shouldRecordClassicResult(
  command: string,
  args: readonly string[],
  integration: ClassicIntegrationArgs,
): boolean {
  if (!isReadOnlyClassicStateQuery(command, args)) return true;
  return Boolean(
    integration.task?.trim() ||
    integration.contextPath ||
    integration.phase ||
    integration.workflow,
  );
}

function isReadOnlyClassicStateQuery(command: string, args: readonly string[]): boolean {
  if (command !== 'state') return false;
  const subcommand = args[0];
  return subcommand === 'current' || subcommand === 'next' || subcommand === 'get';
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
    const { classicChangeId, inferClassicWorkflow, parseClassicLifecycleEvidence } =
      await import('../../domains/comet-classic/classic-experience.js');
    const { recordCometTaskWorkflowResult: recordCometWorkflowResult } =
      await import('./comet-task-context.js');
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
    const { collectCometTaskContext: collectCometPluginContext } =
      await import('./comet-task-context.js');
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
