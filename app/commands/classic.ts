import { runClassicCli } from '../../domains/comet-classic/classic-cli.js';
import { recordCometWorkflowResult } from '../../domains/comet-entry/plugin-context.js';

export const PUBLIC_CLASSIC_COMMANDS = ['state', 'guard', 'handoff', 'archive'] as const;

export type PublicClassicCommand = (typeof PUBLIC_CLASSIC_COMMANDS)[number];

export async function runClassicFacade(
  command: PublicClassicCommand,
  args: readonly string[],
): Promise<number> {
  const result = await runClassicCli([command, ...args]);
  await recordClassicResult(command, args, result);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

export async function runClassicGroupFacade(args: readonly string[]): Promise<number> {
  if (args.length === 0 || (args.length === 1 && (args[0] === '--help' || args[0] === '-h'))) {
    process.stdout.write(
      [
        'Usage: comet classic <command> [args]',
        '',
        'Commands:',
        '  workspace prepare <name> --isolation <mode>  Prepare or reuse the Classic workspace',
        '  workspace resolve <name>                    Route to the selected Classic workspace',
        '  openspec -- <openspec-args...>       Run OpenSpec from the configured Classic root',
        '  root show                            Print the configured Classic artifact roots',
        '  root move docs --dry-run              Inspect the legacy-to-docs migration',
        '  root move docs --apply                Apply the migration immediately',
        '',
      ].join('\n'),
    );
    return 0;
  }
  const result = await runClassicCli(args);
  await recordClassicResult(args[0] ?? 'classic', args.slice(1), result);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

async function recordClassicResult(
  command: string,
  args: readonly string[],
  result: Awaited<ReturnType<typeof runClassicCli>>,
): Promise<void> {
  if (result.exitCode !== 0 || !['archive', 'handoff', 'workspace'].includes(command)) return;
  try {
    await recordCometWorkflowResult({
      projectRoot: process.cwd(),
      workflow: command === 'workspace' ? 'full' : 'full',
      changeId: args.find((value) => !value.startsWith('--')) ?? command,
      command,
      success: true,
      summary: result.stdout,
    });
  } catch {
    // Plugin learning must never make a workflow command fail.
  }
}
