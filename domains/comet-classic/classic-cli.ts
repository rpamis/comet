import { pathToFileURL } from 'url';
import { classicArchiveCommand } from './classic-archive.js';
import { classicGuardCommand } from './classic-guard.js';
import { classicHandoffCommand } from './classic-handoff.js';
import { classicHookGuardCommand } from './classic-hook-guard.js';
import { classicIntentCommand } from './classic-intent-command.js';
import { classicOpenSpecCommand } from './classic-openspec-command.js';
import { classicResumeProbeCommand } from './classic-resume-probe-command.js';
import { classicRootCommand } from './classic-root-command.js';
import { classicStateCommand } from './classic-state-command.js';
import { classicValidateCommand } from './classic-validate-command.js';
import { classicWorkspaceCommand } from './classic-workspace-command.js';

export interface ClassicCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
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
  state: classicStateCommand,
  validate: classicValidateCommand,
  guard: classicGuardCommand,
  handoff: classicHandoffCommand,
  archive: classicArchiveCommand,
  'hook-guard': classicHookGuardCommand,
  intent: classicIntentCommand,
  'resume-probe': classicResumeProbeCommand,
  openspec: classicOpenSpecCommand,
  root: classicRootCommand,
  workspace: classicWorkspaceCommand,
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
        ...(result.stdout === undefined ? {} : { stdout: result.stdout }),
        ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
      }) + '\n',
  };
}

export async function runClassicCli(
  argv: readonly string[],
  handlers: ClassicCommandHandlers = DEFAULT_HANDLERS,
): Promise<ClassicCommandResult> {
  const json = argv[0] !== 'openspec' && argv.includes('--json');
  const args = json ? argv.filter((argument) => argument !== '--json') : [...argv];
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
