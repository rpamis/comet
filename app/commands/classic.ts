import { runClassicCli } from '../../domains/comet-classic/classic-cli.js';

export const PUBLIC_CLASSIC_COMMANDS = ['state', 'guard', 'handoff', 'archive'] as const;

export type PublicClassicCommand = (typeof PUBLIC_CLASSIC_COMMANDS)[number];

export async function runClassicFacade(
  command: PublicClassicCommand,
  args: readonly string[],
): Promise<number> {
  const result = await runClassicCli([command, ...args]);
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
        '  openspec -- <openspec-args...>       Run OpenSpec from the configured Classic root',
        '  root show                            Print the configured Classic artifact roots',
        '  root move docs --dry-run                   Plan the legacy-to-docs migration',
        '  root move docs --apply --plan <id>         Apply the exact audited plan',
        '',
      ].join('\n'),
    );
    return 0;
  }
  const result = await runClassicCli(args);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}
