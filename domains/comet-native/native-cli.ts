import { nativeArchiveCommand } from './native-archive-command.js';
import { nativeDoctorCommand } from './native-doctor-command.js';
import { nativeHookGuardCommand } from './native-hook-guard-command.js';
import { nativeInitCommand } from './native-init-command.js';
import { nativeNewCommand } from './native-new-command.js';
import { nativeNextCommand } from './native-next-command.js';
import { nativeRootCommand } from './native-root-command.js';
import { nativeSelectCommand } from './native-select-command.js';
import { nativeShowCommand } from './native-show-command.js';
import { nativeSpecCommand } from './native-spec-command.js';
import { nativeStatusCommand } from './native-status-command.js';
import { nativeHelp } from './native-cli-help.js';
import {
  errorResult,
  NativeUsageError,
  projectRootFrom,
  render,
  takeFlag,
  takeOption,
  type DispatchResult,
  type NativeCommandResult,
} from './native-cli-shared.js';

export type { NativeCommandResult } from './native-cli-shared.js';

type NativeCommandHandler = (args: string[], projectRoot: string) => Promise<DispatchResult>;

const COMMAND_HANDLERS: Record<string, NativeCommandHandler> = {
  'hook-guard': nativeHookGuardCommand,
  init: nativeInitCommand,
  root: nativeRootCommand,
  new: nativeNewCommand,
  spec: nativeSpecCommand,
  show: nativeShowCommand,
  status: nativeStatusCommand,
  select: nativeSelectCommand,
  next: nativeNextCommand,
  archive: nativeArchiveCommand,
  doctor: nativeDoctorCommand,
};

async function dispatch(
  rawArgs: string[],
  explicitProjectRoot: string | undefined,
): Promise<DispatchResult> {
  const helpIndex = rawArgs.indexOf('--help');
  if (rawArgs.length === 0 || helpIndex >= 0 || rawArgs[0] === 'help') {
    const topicParts =
      rawArgs[0] === 'help' ? rawArgs.slice(1) : helpIndex >= 0 ? rawArgs.slice(0, helpIndex) : [];
    let help: ReturnType<typeof nativeHelp>;
    try {
      help = nativeHelp(topicParts);
    } catch (error) {
      throw new NativeUsageError((error as Error).message);
    }
    return {
      command: help.topic ? `${help.topic} --help` : 'help',
      exitCode: 0,
      data: help,
      text: help.usage,
    };
  }
  const command = rawArgs.shift()!;
  const projectRoot = await projectRootFrom(explicitProjectRoot);
  const handler = COMMAND_HANDLERS[command];
  if (!handler) {
    throw new NativeUsageError(`Unknown Native command: ${command}`);
  }
  return handler(rawArgs, projectRoot);
}

export async function runNativeCli(argv: readonly string[]): Promise<NativeCommandResult> {
  const args = [...argv];
  const separator = args.indexOf('--');
  const globalArgs = separator < 0 ? args : args.slice(0, separator);
  const commandTail = separator < 0 ? [] : args.slice(separator);
  const json = globalArgs.includes('--json');
  let explicitProjectRoot: string | undefined;
  let command: string | null = globalArgs[0] ?? null;
  try {
    takeFlag(globalArgs, '--json');
    explicitProjectRoot = takeOption(globalArgs, '--project-root');
    const dispatchArgs = [...globalArgs, ...commandTail];
    command = dispatchArgs[0] ?? null;
    return render(await dispatch(dispatchArgs, explicitProjectRoot), json);
  } catch (error) {
    return render(errorResult(command, error), json);
  }
}
