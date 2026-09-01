import type { DispatchResult, NativeCommandResult } from './native-cli-shared.js';
import { errorResult, projectRootFrom, render, takeFlag, takeOption } from './native-cli-shared.js';

type NativeScriptHandler = (args: string[], projectRoot: string) => Promise<DispatchResult>;

/**
 * Shared entry point for the per-command Native launchers. Mirrors
 * `runClassicScript`: it strips `--json`/`--verbose`/`--project-root`, resolves
 * the project root, delegates to a single command handler, and renders the
 * result (JSON or the human/agent text envelope). This keeps each command's
 * launcher a thin shell that only loads its own dependency graph instead of the
 * full Native runtime.
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
  const verbose = globalArgs.includes('--verbose');
  let explicitProjectRoot: string | undefined;
  let result: DispatchResult;
  try {
    takeFlag(globalArgs, '--json');
    takeFlag(globalArgs, '--verbose');
    explicitProjectRoot = takeOption(globalArgs, '--project-root');
    const dispatchArgs = [...globalArgs, ...commandTail];
    const projectRoot = await projectRootFrom(explicitProjectRoot);
    result = await handler(dispatchArgs, projectRoot);
  } catch (error) {
    result = errorResult(command, error);
  }
  const output: NativeCommandResult = render(result, json, verbose);
  if (output.stdout) process.stdout.write(output.stdout);
  if (output.stderr)
    process.stderr.write(output.stderr + (output.stderr.endsWith('\n') ? '' : '\n'));
  return output.exitCode;
}
