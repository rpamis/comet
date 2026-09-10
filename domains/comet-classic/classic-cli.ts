import { pathToFileURL } from 'url';
import { classicCommandHelp } from './classic-cli-help.js';
import type { CliOutputEnvelope } from '../workflow-contract/output-envelope.js';
import { projectCliAgentObservation } from '../workflow-contract/output-envelope.js';
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
    (await import('./classic-handoff.js')).classicHandoffCommand(args, options),
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
    return await handler(args, options);
  } catch (error) {
    return {
      exitCode: 70,
      stderr: error instanceof Error ? error.message : String(error),
      data: { issues: [classicIssue(error)] },
    };
  }
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
): Promise<ClassicCommandResult> {
  const boundary = argv.indexOf('--');
  const owns = (index: number) => boundary < 0 || index < boundary;
  const json = argv[0] !== 'openspec' && argv.some((arg, index) => owns(index) && arg === '--json');
  const args = argv.filter((argument, index) => !json || !owns(index) || argument !== '--json');
  const command = args.shift();
  const result = await dispatch(command, args, { json, invocationCwd: process.cwd() }, handlers);
  return json ? jsonResult(command, result) : result;
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
