import { nativeArchiveCommand } from './native-archive-command.js';
import { nativeCheckCommand } from './native-check-command.js';
import { nativeCheckpointCommand } from './native-checkpoint-command.js';
import { nativeDoctorCommand } from './native-doctor-command.js';
import { nativeEvidenceCommand } from './native-evidence-command.js';
import { nativeHookGuardCommand } from './native-hook-guard-command.js';
import { nativeInitCommand } from './native-init-command.js';
import { nativeNewCommand } from './native-new-command.js';
import { nativeNextCommand } from './native-next-command.js';
import { nativeReceiptCommand } from './native-receipt-command.js';
import { nativeRootCommand } from './native-root-command.js';
import { nativeSelectCommand } from './native-select-command.js';
import { nativeShowCommand } from './native-show-command.js';
import { nativeSpecCommand } from './native-spec-command.js';
import { nativeStatusCommand } from './native-status-command.js';
import {
  errorResult,
  NativeUsageError,
  projectRootFrom,
  render,
  takeFlag,
  takeOption,
  USAGE,
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
  checkpoint: nativeCheckpointCommand,
  check: nativeCheckCommand,
  evidence: nativeEvidenceCommand,
  receipt: nativeReceiptCommand,
  next: nativeNextCommand,
  archive: nativeArchiveCommand,
  doctor: nativeDoctorCommand,
};

async function dispatch(
  rawArgs: string[],
  explicitProjectRoot: string | undefined,
): Promise<DispatchResult> {
  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === 'help') {
    return { command: rawArgs[0] ?? null, exitCode: 0, data: { usage: USAGE }, text: USAGE };
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
