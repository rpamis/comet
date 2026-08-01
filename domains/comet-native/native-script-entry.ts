import type { DispatchResult, NativeCommandResult } from './native-cli-shared.js';
import { errorResult, projectRootFrom, render, takeFlag, takeOption } from './native-cli-shared.js';

type NativeScriptHandler = (args: string[], projectRoot: string) => Promise<DispatchResult>;

function jsonResult(result: DispatchResult): NativeCommandResult {
  return {
    exitCode: result.exitCode,
    stdout:
      JSON.stringify({
        command: result.command,
        exitCode: result.exitCode,
        ...(result.data === undefined ? {} : { data: result.data }),
        ...(result.error === undefined ? {} : { error: result.error }),
      }) + '\n',
  };
}

/**
 * Shared entry point for the per-command Native launchers. Mirrors
 * `runClassicScript`: it strips `--json`/`--project-root`, resolves the project
 * root, delegates to a single command handler, and renders the result (JSON or
 * text). This keeps each command's launcher a thin shell that only loads its
 * own dependency graph instead of the full Native runtime.
 */
export async function runNativeScript(
  command: string,
  handler: NativeScriptHandler,
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const separator = argv.indexOf('--');
  const globalArgs = separator < 0 ? [...argv] : argv.slice(0, separator);
  const commandTail = separator < 0 ? [] : argv.slice(separator);
  const json = globalArgs.includes('--json');
  let explicitProjectRoot: string | undefined;
  let result: DispatchResult;
  try {
    takeFlag(globalArgs, '--json');
    explicitProjectRoot = takeOption(globalArgs, '--project-root');
    const dispatchArgs = [...globalArgs, ...commandTail];
    const projectRoot = await projectRootFrom(explicitProjectRoot);
    result = await handler(dispatchArgs, projectRoot);
  } catch (error) {
    result = errorResult(command, error);
  }
  const output = json ? jsonResult(result) : render(result, false);
  if (output.stdout) process.stdout.write(output.stdout);
  if (output.stderr)
    process.stderr.write(output.stderr + (output.stderr.endsWith('\n') ? '' : '\n'));
  return output.exitCode;
}
