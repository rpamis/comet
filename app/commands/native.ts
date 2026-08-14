import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import { recordCometWorkflowResult } from '../../domains/comet-entry/plugin-context.js';
import path from 'node:path';

export async function runNativeFacade(args: readonly string[]): Promise<number> {
  const result = await runNativeCli(args);
  await recordNativeResult(args, result);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr)
    process.stderr.write(result.stderr + (result.stderr.endsWith('\n') ? '' : '\n'));
  return result.exitCode;
}

async function recordNativeResult(
  args: readonly string[],
  result: Awaited<ReturnType<typeof runNativeCli>>,
): Promise<void> {
  if (result.exitCode !== 0) return;
  const command = args.find((value) => ['next', 'archive', 'handoff'].includes(value));
  if (!command || !['next', 'archive', 'handoff'].includes(command)) return;
  const commandIndex = args.indexOf(command);
  const projectIndex = args.indexOf('--project-root');
  const projectRoot = projectIndex >= 0 ? args[projectIndex + 1] : process.cwd();
  if (!projectRoot) return;
  const changeId = args
    .slice(commandIndex + 1, projectIndex >= 0 ? projectIndex : args.length)
    .find((value) => !value.startsWith('--'));
  try {
    await recordCometWorkflowResult({
      projectRoot: path.resolve(projectRoot),
      workflow: 'native',
      changeId: changeId ?? command,
      command,
      success: true,
      summary: result.stdout,
    });
  } catch {
    // Plugin learning must never make a workflow command fail.
  }
}
