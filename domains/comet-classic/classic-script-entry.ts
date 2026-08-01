import type {
  ClassicCommandHandler,
  ClassicCommandName,
  ClassicCommandResult,
} from './classic-cli.js';

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
        ...(result.stdout === undefined ? {} : { stdout: result.stdout }),
        ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
      }) + '\n',
  };
}

export async function runClassicScript(
  command: ClassicCommandName,
  handler: ClassicCommandHandler,
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const json = argv.includes('--json');
  const args = argv.filter((argument) => argument !== '--json');
  let result: ClassicCommandResult;
  try {
    result = await handler(args, { json });
  } catch (error) {
    result = {
      exitCode: 70,
      stderr: error instanceof Error ? error.message : String(error),
    };
  }

  const output = json ? jsonResult(command, result) : result;
  if (output.stdout) process.stdout.write(output.stdout);
  if (output.stderr)
    process.stderr.write(output.stderr + (output.stderr.endsWith('\n') ? '' : '\n'));
  return output.exitCode;
}
