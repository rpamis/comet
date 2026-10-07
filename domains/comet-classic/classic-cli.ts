import { pathToFileURL } from 'url';
import { classicCommandHelp } from './classic-cli-help.js';
import type { CliOutputEnvelope } from '../workflow-contract/output-envelope.js';
import {
  projectCliAgentObservation,
  formatCliCommandArgs,
  type CliActionContinuation,
} from '../workflow-contract/output-envelope.js';
import { classicIssue } from './classic-issues.js';

export interface ClassicCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  data?: unknown;
  /**
   * Audience-split output envelope: `summary`/`user_message` speak user
   * language, `next` is the agent's single follow-up. Text output keeps its
   * existing lines and only prepends the human summary; JSON gains the
   * envelope fields additively.
   */
  envelope?: CliOutputEnvelope;
}

export interface ClassicCommandOptions {
  json: boolean;
  invocationCwd?: string;
  projectRoot?: string;
}

export interface ClassicCliRunOptions {
  invocationCwd?: string;
  projectRoot?: string;
}

export type ClassicCommandHandler = (
  args: string[],
  options: ClassicCommandOptions,
) => Promise<ClassicCommandResult>;

export type ClassicCommandHandlers = Partial<Record<ClassicCommandName, ClassicCommandHandler>>;

export const CLASSIC_COMMANDS = [
  'state',
  'check',
  'validate',
  'guard',
  'handoff',
  'archive',
  'hook-guard',
  'intent',
  'resume-probe',
  'openspec',
  'root',
  'workspace',
] as const;

export type ClassicCommandName = (typeof CLASSIC_COMMANDS)[number];

const DEFAULT_HANDLERS: ClassicCommandHandlers = {
  state: async (args, options) =>
    (await import('./classic-state-command.js')).classicStateCommand(args, options),
  check: async (args, options) =>
    (await import('./classic-check-command.js')).classicCheckCommand(args, options),
  validate: async (args, options) =>
    (await import('./classic-validate-command.js')).classicValidateCommand(args, options),
  guard: async (args, options) =>
    (await import('./classic-guard.js')).classicGuardCommand(args, options),
  handoff: async (args, options) =>
    (await import('./classic-handoff-command.js')).classicHandoffCommand(args, options),
  archive: async (args, options) =>
    (await import('./classic-archive.js')).classicArchiveCommand(args, options),
  'hook-guard': async (args, options) =>
    (await import('./classic-hook-guard.js')).classicHookGuardCommand(args, options),
  intent: async (args, options) =>
    (await import('./classic-intent-command.js')).classicIntentCommand(args, options),
  'resume-probe': async (args, options) =>
    (await import('./classic-resume-probe-command.js')).classicResumeProbeCommand(args, options),
  openspec: async (args, options) =>
    (await import('./classic-openspec-command.js')).classicOpenSpecCommand(args, options),
  root: async (args, options) =>
    (await import('./classic-root-command.js')).classicRootCommand(args, options),
  workspace: async (args, options) =>
    (await import('./classic-workspace-command.js')).classicWorkspaceCommand(args, options),
};

function isClassicCommand(value: string): value is ClassicCommandName {
  return CLASSIC_COMMANDS.includes(value as ClassicCommandName);
}

function commandError(command: string | undefined): ClassicCommandResult {
  if (!command) {
    return {
      exitCode: 64,
      stderr: `Usage: comet-classic <${CLASSIC_COMMANDS.join('|')}> [args]`,
    };
  }
  return {
    exitCode: 64,
    stderr: `Unknown Classic command: ${command}`,
  };
}

async function dispatch(
  command: string | undefined,
  args: string[],
  options: ClassicCommandOptions,
  handlers: ClassicCommandHandlers,
): Promise<ClassicCommandResult> {
  if (!command || !isClassicCommand(command)) return commandError(command);
  const help = classicCommandHelp(command, args);
  if (help) return { exitCode: 0, stdout: help };
  const handler = handlers[command];
  if (!handler) {
    return {
      exitCode: 70,
      stderr: `Classic command is not implemented: ${command}`,
    };
  }

  try {
    return await withSdkErrorContext(command, args, options, await handler(args, options));
  } catch (error) {
    return withSdkErrorContext(command, args, options, {
      exitCode: 70,
      stderr: error instanceof Error ? error.message : String(error),
      data: { issues: [classicIssue(error)] },
    });
  }
}

async function withSdkErrorContext(
  command: ClassicCommandName,
  args: string[],
  options: ClassicCommandOptions,
  result: ClassicCommandResult,
): Promise<ClassicCommandResult> {
  const data =
    result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>) : {};
  if (result.exitCode === 0 || data.continuation) return result;
  const change = ['state', 'check', 'workspace'].includes(command)
    ? args[1]
    : ['guard', 'archive'].includes(command)
      ? args[0]
      : undefined;
  if (!change) return result;
  try {
    const { classicSdkErrorData, classicSdkGuardAttempt, classicSdkBlockedContinuation } =
      await import('./classic-sdk-output.js');
    const { discoverClassicProject } = await import('./classic-layout.js');
    const root =
      options.projectRoot ?? (await discoverClassicProject(options.invocationCwd ?? process.cwd()));
    const current = await classicSdkErrorData(root, change);
    if (!current) return result;
    const guardPhase =
      command === 'guard' ? args[1] : command === 'archive' ? 'archive' : undefined;
    return {
      ...result,
      data: {
        ...data,
        ...current,
        ...(guardPhase
          ? {
              continuation: classicSdkBlockedContinuation(
                current.continuation,
                classicSdkGuardAttempt(current.run, guardPhase),
                result.stderr?.trim() || 'Guard did not complete',
              ),
            }
          : {}),
      },
    };
  } catch {
    return result;
  }
}

/** 所有命令用同一续行事实生成文本提示；不根据 command 或 phase 另猜路由。 */
function withSdkContinuation(result: ClassicCommandResult): ClassicCommandResult {
  const data = result.data as
    { continuation?: CliActionContinuation & { skill?: string } } | undefined;
  const continuation = data?.continuation;
  if (!continuation?.mode) return result;
  const next =
    continuation.mode === 'ask'
      ? { ask_user: continuation.instruction ?? 'Obtain the current user decision.' }
      : continuation.mode === 'execute' && continuation.skill
        ? { command: `/${continuation.skill}` }
        : continuation.commandArgs
          ? { command: formatCliCommandArgs(continuation.commandArgs) }
          : { instruction: continuation.instruction ?? continuation.mode };
  const summary =
    result.envelope?.summary ??
    result.stdout?.trim().split('\n')[0] ??
    result.stderr?.trim().split('\n')[0] ??
    'Classic Run updated.';
  const hint =
    'command' in next ? next.command : 'ask_user' in next ? next.ask_user : next.instruction;
  return {
    ...result,
    envelope: { ...result.envelope, summary, next },
    ...(!result.stdout?.includes('NEXT:')
      ? { stdout: `${result.stdout ?? ''}NEXT: ${hint}\n` }
      : {}),
  };
}

function jsonResult(
  command: string | undefined,
  result: ClassicCommandResult,
): ClassicCommandResult {
  return {
    exitCode: result.exitCode,
    stdout:
      JSON.stringify({
        command: command ?? null,
        exitCode: result.exitCode,
        agent: projectCliAgentObservation(result.data),
        ...(result.data === undefined ? {} : { data: result.data }),
        ...(result.envelope === undefined
          ? {}
          : {
              summary: result.envelope.summary,
              ...(result.envelope.next === undefined ? {} : { next: result.envelope.next }),
              ...(result.envelope.user_message === undefined
                ? {}
                : { user_message: result.envelope.user_message }),
            }),
        ...(result.stdout === undefined ? {} : { stdout: result.stdout }),
        ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
      }) + '\n',
    ...(result.envelope === undefined ? {} : { envelope: result.envelope }),
  };
}

export async function runClassicCli(
  argv: readonly string[],
  handlers: ClassicCommandHandlers = DEFAULT_HANDLERS,
  runOptions: ClassicCliRunOptions = {},
): Promise<ClassicCommandResult> {
  const boundary = argv.indexOf('--');
  const owns = (index: number) => boundary < 0 || index < boundary;
  const json = argv[0] !== 'openspec' && argv.some((arg, index) => owns(index) && arg === '--json');
  const args = argv.filter((argument, index) => !json || !owns(index) || argument !== '--json');
  const command = args.shift();
  const result = await dispatch(
    command,
    args,
    {
      json,
      invocationCwd: runOptions.invocationCwd ?? process.cwd(),
      ...(runOptions.projectRoot ? { projectRoot: runOptions.projectRoot } : {}),
    },
    handlers,
  );
  const projected = withSdkContinuation(result);
  return json ? jsonResult(command, projected) : projected;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const result = await runClassicCli(argv);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr)
    process.stderr.write(result.stderr + (result.stderr.endsWith('\n') ? '' : '\n'));
  return result.exitCode;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
