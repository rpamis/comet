/** Public invocation syntax, shared by the CLI and self-contained bundles. */
export function classicCommandHelp(command: string, args: readonly string[]): string | undefined {
  if (!args.includes('--help') && !args.includes('-h')) return undefined;
  // OpenSpec owns its forwarded arguments, including help.
  const usage: Record<string, string[]> = {
    state: [
      'comet state <command> [args]',
      'init <change-name> <full|hotfix|tweak> [--isolation <current|branch|worktree>]',
      'get <change-name> <field>',
      'set <change-name> <field> <value>',
      'transition <change-name> <event>',
      'check <change-name> <phase> [--recover]',
      'scale <change-name>',
      'record-check <change-name> <build|verify> --command <text> --exit-code <int> [--cwd <path>]',
      'task-checkoff <file> <task-text>',
      'select <change-name> | rebind <change-name> | next <change-name>',
      'current | clear-selection',
    ],
    guard: [
      'comet guard <change-name> <open|design|build|verify|archive> [--apply]',
      'Checks only by default; --apply advances the phase after all checks pass.',
    ],
    handoff: [
      'comet handoff <change-name> design --write [--full]',
      'comet handoff <change-name> --hash-only',
    ],
    archive: ['comet archive <change-name> [--dry-run]'],
    validate: ['comet classic validate <change-name>'],
    workspace: [
      'comet classic workspace prepare <change-name> --isolation <current|branch|worktree> [--change-branch <branch>] [--target-branch <branch>] [--worktree-path <path>]',
      'comet classic workspace resolve <change-name>',
    ],
  };
  const lines = usage[command];
  return lines
    ? `Usage: ${lines.join('\n  ')}\n\nOptions: --json (machine-readable output), --help\nUnknown options are rejected; command placeholders must be replaced with actual values.\n`
    : undefined;
}
