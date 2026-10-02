import type {
  ClassicCommandHandler,
  ClassicCommandName,
  ClassicCommandResult,
  ClassicCliRunOptions,
} from './classic-cli.js';
import { realpathSync } from 'fs';
import { pathToFileURL } from 'url';
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

async function executeClassicScript(
  command: ClassicCommandName,
  handler: ClassicCommandHandler,
  argv: readonly string[],
  runOptions: ClassicCliRunOptions = {},
): Promise<ClassicCommandResult> {
  const boundary = argv.indexOf('--');
  const owns = (index: number) => boundary < 0 || index < boundary;
  const json = argv.some((arg, index) => owns(index) && arg === '--json');
  const args = argv.filter((argument, index) => !owns(index) || argument !== '--json');
  let result: ClassicCommandResult;
  try {
    const help = classicCommandHelp(command, args);
    result = help
      ? { exitCode: 0, stdout: help }
      : await handler(args, {
          json,
          invocationCwd: runOptions.invocationCwd ?? process.cwd(),
          ...(runOptions.projectRoot ? { projectRoot: runOptions.projectRoot } : {}),
        });
  } catch (error) {
    result = {
      exitCode: 70,
      stderr: error instanceof Error ? error.message : String(error),
      data: { issues: [classicIssue(error)] },
    };
  }

  return json ? jsonResult(command, result) : result;
}

export function createClassicCommandRunner(
  command: ClassicCommandName,
  handler: ClassicCommandHandler,
) {
  return async (
    argv: readonly string[],
    runOptions: ClassicCliRunOptions = {},
  ): Promise<ClassicCommandResult> => {
    if (argv[0] !== command)
      return { exitCode: 64, stderr: `Expected Classic command: ${command}` };
    return executeClassicScript(command, handler, argv.slice(1), runOptions);
  };
}

export function isClassicScriptEntry(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  if (moduleUrl === pathToFileURL(entry).href) return true;
  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

export async function runClassicScript(
  command: ClassicCommandName,
  handler: ClassicCommandHandler,
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const output = await executeClassicScript(command, handler, argv);
  if (output.stdout) process.stdout.write(output.stdout);
  if (output.stderr)
    process.stderr.write(output.stderr + (output.stderr.endsWith('\n') ? '' : '\n'));
  return output.exitCode;
}
