import { compactCliStdout } from '../workflow-contract/compact-output.js';
import { withNativeCommandRecovery } from './native-command-recovery.js';
import type { DispatchResult, NativeCommandResult } from './native-cli-shared.js';
import {
  errorResult,
  NativeUsageError,
  isNativeReadOnlyCommand,
  projectRootFrom,
  render,
  takeFlag,
  takeOption,
} from './native-cli-shared.js';

type NativeScriptHandler = (args: string[], projectRoot: string) => Promise<DispatchResult>;

/**
 * Shared entry point for the per-command Native launchers. Mirrors
 * `runClassicScript`: it strips `--json`/`--compact`/`--verbose`/`--project-root`, resolves
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
  const compact = globalArgs.includes('--compact');
  let explicitProjectRoot: string | undefined;
  let requestName: string | undefined;
  let caughtError: unknown;
  let result: DispatchResult;
  try {
    takeFlag(globalArgs, '--json');
    takeFlag(globalArgs, '--compact');
    if (compact && !json) throw new NativeUsageError('--compact requires --json');
    takeFlag(globalArgs, '--verbose');
    explicitProjectRoot = takeOption(globalArgs, '--project-root');
    const dispatchArgs = [...globalArgs, ...commandTail];
    requestName = dispatchArgs[0]?.startsWith('--') ? undefined : dispatchArgs[0];
    const invoke = async () => {
      const projectRoot = await projectRootFrom(explicitProjectRoot);
      return { executionCwd: projectRoot, ...(await handler(dispatchArgs, projectRoot)) };
    };
    result = isNativeReadOnlyCommand(command, dispatchArgs)
      ? await withGitWorktreeReadScope(invoke)
      : await invoke();
  } catch (error) {
    caughtError = error;
    result = errorResult(command, error);
  }
  result = await withNativeCommandRecovery(result, {
    projectRoot: result.executionCwd ?? explicitProjectRoot ?? process.cwd(),
    name: requestName,
    error: caughtError,
  });
  const output: NativeCommandResult = render(result, json, verbose);
  if (output.stdout) process.stdout.write(compactCliStdout(output.stdout, compact && json)!);
  if (output.stderr)
    process.stderr.write(output.stderr + (output.stderr.endsWith('\n') ? '' : '\n'));
  return output.exitCode;
}
import { withGitWorktreeReadScope } from '../../platform/paths/git-worktree.js';
