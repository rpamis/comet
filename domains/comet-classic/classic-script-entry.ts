import type {
  ClassicCommandHandler,
  ClassicCommandName,
  ClassicCommandResult,
} from './classic-cli.js';
import { classicCommandHelp } from './classic-cli-help.js';
import { projectCliAgentObservation } from '../workflow-contract/output-envelope.js';
import { classicIssue } from './classic-issues.js';

function jsonResult(
  command: ClassicCommandName,
  result: ClassicCommandResult,
): ClassicCommandResult {
  return {
    exitCode: result.exitCode,
    stdout:
      JSON.stringify({
        command,
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

export async function runClassicScript(
  command: ClassicCommandName,
  handler: ClassicCommandHandler,
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const boundary = argv.indexOf('--');
  const owns = (index: number) => boundary < 0 || index < boundary;
  const json = argv.some((arg, index) => owns(index) && arg === '--json');
  const args = argv.filter((argument, index) => !owns(index) || argument !== '--json');
  let result: ClassicCommandResult;
  try {
    const help = classicCommandHelp(command, args);
    result = help ? { exitCode: 0, stdout: help } : await handler(args, { json });
  } catch (error) {
    result = {
      exitCode: 70,
      stderr: error instanceof Error ? error.message : String(error),
      data: { issues: [classicIssue(error)] },
    };
  }

  const output = json ? jsonResult(command, result) : result;
  if (output.stdout) process.stdout.write(output.stdout);
  if (output.stderr)
    process.stderr.write(output.stderr + (output.stderr.endsWith('\n') ? '' : '\n'));
  return output.exitCode;
}
