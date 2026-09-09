import { CLASSIC_TRANSITION_EVENTS } from './classic-transitions.js';
import { CLASSIC_WIRE_KEYS, RUN_WIRE_KEYS } from './classic-state.js';
import { FIELD_ENUMS, SETTABLE_FIELDS } from './classic-state-options.js';

const OUTPUT_HELP =
  '\nOptions: --json (machine-readable output), --help\n' +
  'JSON: one object with command and exitCode; data, stdout, stderr, summary and next are optional.\n' +
  'Use exitCode for success; do not parse human-readable stdout. Help text is in stdout in JSON mode.\n';

/** Public invocation syntax, shared by the CLI and self-contained bundles. */
export function classicCommandHelp(command: string, args: readonly string[]): string | undefined {
  const boundary = args.indexOf('--');
  const ownArgs = boundary < 0 ? args : args.slice(0, boundary);
  if (!ownArgs.includes('--help') && !ownArgs.includes('-h')) return undefined;
  // OpenSpec owns its forwarded arguments, including help.
  const usage: Record<string, string[]> = {
    check: [
      'comet check run <change> <build|verify> [--local] [--cwd <path>] [--timeout-ms <ms>] -- <program> [args...]',
      '--local opts deterministic local checks into same-input reuse; other checks are single-use.',
      'Arguments after -- belong to the child. Windows batch arguments containing shell syntax are rejected.',
      '',
      'Executes a program for an active change and stores its log and input-bound evidence.',
      '--local is not a location switch: all checks execute locally. It asserts deterministic inputs.',
      'Use --local only when no network, external state or untracked ignored inputs affect the result.',
      'Default evidence is single-use; reusable evidence requires matching inputs, environment and log.',
      '--cwd: relative to the project root; default is the invocation directory; must stay inside the project.',
      '--timeout-ms: default 300000; integer range 1..3600000.',
      'Place Comet options, including --json, before --. Child --help and --json after -- are forwarded.',
      '',
      'Result: data.scope, data.argv, data.cwd, data.exitCode, data.logRef, data.reusable; data.reused is optional.',
      'Exit: 0 = success with stable inputs; child failures propagate; timeout = 124; invalid invocation/runtime error = 70.',
      'A child exit of 0 with changed inputs returns exitCode 1. Use top-level exitCode, not data.exitCode.',
      'On failure inspect data.logRef or stderr, fix the cause, then rerun. Recovery revalidates local evidence.',
      'Build evidence does not substitute for verify evidence. A successful check does not advance the phase.',
      '',
      'Examples: (replace demo with your active change; these commands execute code)',
      '  comet check run demo verify --json -- node --test',
      '  comet check run demo build --local --cwd . -- npm run build',
    ],
    state: [
      'comet state <command> [args]',
      'init <change-name> <full|hotfix|tweak> [--isolation <current|branch|worktree>]',
      'get <change-name> <field>',
      'set <change-name> <field> <value> [<field> <value> ...]',
      'transition <change-name> <event>',
      'check <change-name> <phase> [--recover]',
      'scale <change-name>',
      'artifacts <change-name>',
      'record-check <change-name> <build|verify> --command <text> --exit-code <int> [--cwd <path>]',
      'task-checkoff <file> <task-text>',
      'tasks <change-name> [--assign-ids]',
      'task-complete <change-name> <task-id> --expect <revision>',
      'select <change-name> | rebind <change-name> | next <change-name>',
      'current | clear-selection',
      '',
      'Start with current or next <change-name> to inspect workflow guidance.',
      'Advanced writes: init, set, transition, task-checkoff, select, rebind, clear-selection.',
      'Use comet state <command> --help for details. --recover is for cold recovery, not normal progression.',
    ],
    guard: [
      'comet guard <change-name> <open|design|build|verify|archive> [--apply]',
      'Validates phase requirements; --apply advances the phase after all checks pass.',
      'Without --apply the phase stays unchanged, but this is NOT a read-only preview:',
      'Build validation may execute a detected build and write evidence/logs.',
      'Preview does not consume single-use evidence. Successful phase advancement consumes it atomically.',
      'Failed or repeated previews preserve evidence; changed inputs still require a new check.',
      'Do not poll guard for status. Use comet state next <change-name> for guidance.',
      'On failure follow the reported next action; do not blindly retry side-effecting checks.',
      '',
      'Examples:',
      '  comet guard demo build --apply --json',
      '  comet state next demo --json',
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
  const stateDetails: Record<string, string[]> = {
    current: [
      'comet state current',
      'Reports the selected Classic change. Does not advance the phase.',
    ],
    next: [
      'comet state next <change-name>',
      'Reports the next workflow action. Does not execute build or verification checks.',
    ],
    select: [
      'comet state select <change-name>',
      'Writes the current change selection used by workflow routing.',
    ],
    rebind: [
      'comet state rebind <change-name>',
      'Updates the change branch binding to the current Git branch after validation.',
    ],
    'clear-selection': [
      'comet state clear-selection',
      'Clears the current change selection; does not delete change artifacts.',
    ],
    init: [
      'comet state init <change-name> <full|hotfix|tweak> [--isolation <current|branch|worktree>]',
      'Creates Classic workflow state. Follow the Open workflow for required user decisions.',
    ],
    scale: [
      'comet state scale <change-name>',
      'Reports a verification recommendation without changing verify_mode.',
      'JSON: data.recommendation, data.selected and data.metrics. Scale is not a risk assessment.',
      'Preserve an existing selection; record a new decision explicitly with state set when needed.',
    ],
    artifacts: [
      'comet state artifacts <change-name>',
      'Inspects the OpenSpec apply dependency closure, including dependencies of already-complete artifacts.',
      'JSON: data.source, required, skipped, designRequired, files and problems. This does not execute implementation or verification.',
      'Optional design is omitted only when the active schema excludes it from the required closure.',
      'Skipped specs require explicit skip_specs: true, upstream support and no conflicting spec files.',
      'Legacy changes without .openspec.yaml retain the existing Classic artifact requirements.',
    ],
    'task-checkoff': [
      'comet state task-checkoff <file> <task-text>',
      'Checks that exactly one matching task is already checked. Does not write the task file or execute the task.',
    ],
    tasks: [
      'comet state tasks <change-name> [--assign-ids]',
      'Reads tasks.md as the task completion authority. Fenced examples are excluded.',
      '--assign-ids persists IDs for legacy/new tasks in Open, Design or Build; existing IDs remain unchanged.',
      'Assign IDs before generating the design handoff and plan. ID assignment changes task requirements.',
      'JSON: data.authority, data.revision, data.needsIds, data.tasks and data.progress.',
      'Each task has id, text, completed and line. Never use line/order as task identity.',
      'Example: comet state tasks demo --assign-ids --json',
    ],
    'task-complete': [
      'comet state task-complete <change-name> <task-id> --expect <revision>',
      'Records accepted task completion during Build; does not execute or independently verify work.',
      'Use the revision returned by state tasks. Changed requirements reject the write; refresh and reassess the task.',
      'Writes only tasks.md under the state lock. Completion-only edits preserve the revision; retries are idempotent.',
      'Do not maintain another completion checklist in the plan. Legacy plans retain their existing checks until explicitly migrated.',
    ],
    get: [
      'comet state get <change-name> <field>',
      'Reads one stored field. The field value is returned in stdout, including in JSON mode.',
      `Fields: ${[...CLASSIC_WIRE_KEYS, ...RUN_WIRE_KEYS].join(', ')}`,
      'Example: comet state get demo phase --json',
    ],
    set: [
      'comet state set <change-name> <field> <value> [<field> <value> ...]',
      'Advanced: validates all fields, then commits one atomic state update and reconciles Runtime state.',
      'Invalid values or duplicate fields reject the whole update. Do not bypass workflow confirmations.',
      'JSON: data.change and data.updated contain the committed field values.',
      'Writable fields (enum values shown where applicable):',
      ...[...SETTABLE_FIELDS].map(
        (field) =>
          `  ${field}${FIELD_ENUMS[field] ? `: ${FIELD_ENUMS[field].join('|')}` : field === 'language' ? ': en|zh-CN' : ''}`,
      ),
      'Other Runtime-owned fields cannot be set manually. Artifact paths must stay within the project.',
      'Example: comet state set demo verify_mode full',
      'Example: comet state set demo build_mode executing-plans tdd_mode direct review_mode standard --json',
    ],
    check: [
      'comet state check <change-name> <open|design|build|verify|archive> [--recover]',
      'Checks phase entry requirements; this is not a build/test execution command.',
      '--recover is for cold recovery after context loss, not normal phase progression.',
      'Recovery revalidates reusable local evidence and invalidates stale, damaged or single-use evidence.',
      'It preserves completed work; resume from the checkpoint and rerun required checks before progressing.',
      'With --recover --json, data includes phase, currentStep, configuration, nextTask, checkpoint, evidence and requiredFiles.',
      'Without --recover, data includes change, phase, requestedPhase, configuration and checks (passed, total, blocked).',
      'Read fresh state after changing configuration or advancing phases; do not reuse an earlier entry snapshot.',
      '',
      'Examples:',
      '  comet state check demo build --json',
      '  comet state check demo build --recover --json',
    ],
    'record-check': [
      'comet state record-check <change> <build|verify> --command <text> --exit-code <int> [--cwd <path>]',
      'Advanced: writes a manual attestation; does not execute the command.',
      'A manual attestation cannot satisfy Runtime build/verify evidence requirements, even with exit code 0.',
      'Use comet check run to execute a check and obtain evidence that guard can validate.',
      '--cwd: relative to project root, defaults to .; must stay inside the project.',
      '',
      'Examples:',
      '  comet state record-check demo verify --command "external test run" --exit-code 1',
      '  comet check run demo verify --json -- node --test',
    ],
    transition: [
      'comet state transition <change-name> <event>',
      `Events: ${CLASSIC_TRANSITION_EVENTS.join(', ')}`,
      'Advanced: applies a state-machine event and writes workflow state. Required confirmations still apply.',
      'This is not a substitute for the workflow Skill or phase guard. Use state next for the next action.',
    ],
  };
  const subcommand = ownArgs.find((arg) => !arg.startsWith('-'));
  const lines = (command === 'state' && subcommand && stateDetails[subcommand]) || usage[command];
  return lines
    ? `Usage: ${lines.join('\n  ')}\n${OUTPUT_HELP}Command placeholders must be replaced with actual values.\n`
    : undefined;
}
