interface NativeHelpEntry {
  usage: string;
  purpose: string;
  options?: readonly string[];
  output: string;
  examples?: readonly string[];
  subcommands?: readonly string[];
}

const GLOBAL_OPTIONS = [
  '--project-root <path>  Resolve the Native project from this working directory.',
  '--json                 Emit the stable JSON command envelope.',
  '--help                 Show help without requiring an initialized project.',
] as const;

const HELP: Readonly<Record<string, NativeHelpEntry>> = Object.freeze({
  '': {
    usage: 'comet native <command> [options]',
    purpose:
      'Create, inspect, recover, and archive portable Native changes through Runtime-enforced, skill-coordinated steps.',
    subcommands: [
      'init                         Initialize Native project configuration.',
      'root show                    Inspect the configured artifact root.',
      'root move <artifact-root>    Move the configured artifact root.',
      'new <change-name>            Create a change and prepare its workspace.',
      'spec remove                  Record a complete capability removal intent.',
      'show <change-name>           Read formal artifacts and portable state.',
      'status [<change-name>]       Discover stable boundaries and Runner actions.',
      'select <change-name>         Select a change in its bound workspace.',
      'next <change-name>           Confirm or recover a stable workflow boundary.',
      'archive <change-name>        Preview and execute Archive plus workspace finish.',
      'doctor [<change-name>]       Diagnose, migrate, or rebuild local execution state.',
    ],
    options: GLOBAL_OPTIONS,
    output: 'Human-readable text by default; use --json for a structured command envelope.',
    examples: [
      'comet native status --json',
      'comet native status my-change --details --json',
      'comet native next --help',
    ],
  },
  init: {
    usage: 'comet native init [--root <artifact-root>] [--language en|zh-CN]',
    purpose: 'Create or normalize .comet/config.yaml and the configured Native directories.',
    options: [
      '--root <artifact-root>  Project-relative artifact root; defaults to docs.',
      '--language en|zh-CN     Language for newly generated Native artifacts.',
    ],
    output: 'The resolved project configuration and Native paths.',
    examples: ['comet native init --root docs --language zh-CN'],
  },
  root: {
    usage: 'comet native root <show|move> [arguments]',
    purpose: 'Inspect or transactionally move the configured Native artifact root.',
    subcommands: [
      'show                  Print the configured artifact root and resolved paths.',
      'move <artifact-root>  Move Native artifacts and update project configuration.',
    ],
    output: 'The current root projection or the completed move result.',
    examples: ['comet native root show', 'comet native root move artifacts/native'],
  },
  'root show': {
    usage: 'comet native root show',
    purpose: 'Print the configured Native artifact root and resolved paths.',
    output: 'The configured artifact root and resolved Native paths.',
  },
  'root move': {
    usage: 'comet native root move <artifact-root>',
    purpose: 'Transactionally move Native artifacts and update project configuration.',
    output: 'The source, destination, and committed root-move transaction result.',
    examples: ['comet native root move artifacts/native'],
  },
  new: {
    usage:
      'comet native new <change-name> [--language en|zh-CN] [--isolation current|branch|worktree] [--change-branch <branch>] [--target-branch <branch>] [--worktree-path <path>]',
    purpose: 'Create a portable Native change and prepare the requested branch or linked worktree.',
    options: [
      '--language en|zh-CN          Artifact language; defaults to project configuration.',
      '--isolation <kind>           current, branch, or worktree; defaults to current.',
      '--change-branch <branch>     Change branch; defaults to comet/<change-name>.',
      '--target-branch <branch>     Local base branch; defaults to the current branch.',
      '--worktree-path <path>       Worktree directory; defaults to .worktrees/<change-name>.',
    ],
    output:
      'The portable state, workspace preparation result, and continuation with the next Runner action.',
    examples: [
      'comet native new session-timeout --language zh-CN',
      'comet native new session-timeout --isolation branch --target-branch main',
      'comet native new session-timeout --isolation worktree --target-branch main',
    ],
  },
  spec: {
    usage: 'comet native spec remove <change-name> <capability>',
    purpose:
      'Record a capability removal; create and modify intents use complete proposed Spec files.',
    subcommands: ['remove <change-name> <capability>  Record a capability removal.'],
    output: 'The updated portable state and continuation.',
  },
  'spec remove': {
    usage: 'comet native spec remove <change-name> <capability>',
    purpose: 'Record removal of a capability in the complete target specification.',
    output: 'The updated portable state and continuation with the next Runner action.',
  },
  show: {
    usage: 'comet native show <change-name>',
    purpose: 'Read formal artifacts and portable state for one Native change.',
    output:
      'The portable state, brief, complete proposed Specs, and continuation; legacy state is reported as migration-required.',
  },
  status: {
    usage: 'comet native status [<change-name>] [--cursor <token>] [--details]',
    purpose: 'Discover portable stable boundaries or inspect the exact next Runner action.',
    options: [
      '--cursor <token>  Continue a status-list page.',
      '--details         Include acceptance, Spec, workspace, and report details.',
    ],
    output:
      'A v2 status page or one portable Loop projection with local execution availability and continuation.runnerAction.',
    examples: [
      'comet native status --json',
      'comet native status session-timeout --details --json',
    ],
  },
  select: {
    usage: 'comet native select <change-name>',
    purpose: 'Select one Native change after validating its workspace binding.',
    output: 'The selected change record.',
  },
  next: {
    usage:
      'comet native next <change-name> --summary <text> [--confirmed|--return-to-build|--retry-verifier|--resolve-verifier-blocker]\n       comet native next <change-name> --runner-input <json-file>',
    purpose:
      'Confirm or recover an Agent boundary, or use one skill-coordinated JSON bridge for Builder handoff, check-plan dispatch, and Verifier response/error.',
    options: [
      '--summary <text>    Required transition or recovery summary.',
      '--confirmed         Confirm Shape, a completed skill-coordinated pass, or an explicitly degraded verifier-unavailable fallback before Archive.',
      '--return-to-build   Return Verify or Archive to Build after invalidation or user choice.',
      '--retry-verifier    Retry a blocked Verifier execution when the continuation allows it.',
      '--resolve-verifier-blocker  Resolve a semantic Verifier blocker without changing the candidate, then dispatch a new attempt.',
      '--runner-input <file>  Skill-coordinated JSON: builder-handoff, dispatch-verifier, verifier-response, verifier-execution-error, or verifier-unavailable. Identity/provider/execution/candidate fields are rejected.',
      '  builder-handoff fields: kind, summary, addressed_acceptance_ids, checks, known_limits.',
      '  dispatch-verifier fields: kind, checks (an explicitly resolved plan; [] is allowed).',
      '  verifier-response fields: kind, response (request-checks or final-result).',
      '  verifier-execution-error fields: kind, summary, stateVersion, iteration, attempt, verifierExecutionRef copied from verifierDispatch.',
      '  verifier-unavailable fields: kind, summary, stateVersion, iteration, attempt, verifierExecutionRef copied from verifierDispatch; accepted only after the explicit Runtime check plan completed and passed.',
    ],
    output:
      'The portable state, explicit skill-coordinated label, Runtime-owned check results, complete verifierDispatch, bounded request-check response, continuation.runnerAction, and machine-readable continuation.inputOptions. This generic bridge is not trusted identity attestation: a passing result waits for explicit user confirmation before Archive.',
    examples: [
      'comet native next session-timeout --summary "Shape confirmed" --confirmed',
      'comet native next session-timeout --summary "Implementation changed" --return-to-build',
      'comet native next session-timeout --summary "Retry verifier infrastructure" --retry-verifier',
      'comet native next session-timeout --summary "Retry semantic verification" --resolve-verifier-blocker',
      'comet native next session-timeout --runner-input <temporary-json-file>',
    ],
  },
  archive: {
    usage:
      'comet native archive <change-name> --dry-run [--finish merge|push|pull-request|keep]\n       comet native archive <change-name> [--confirmed] [--serial-first <current-change>]',
    purpose:
      'Preview or execute deterministic Archive after the portable state reaches archive-ready.',
    options: [
      '--dry-run          Inspect readiness without rerunning verification.',
      '--finish <action>  Persist merge, push, pull-request, or keep for an isolated workspace.',
      '--serial-first <current-change>  During execution only, confirm that this change archives before detected capability peers; the value must equal <change-name>.',
      '--confirmed        Confirm Archive when project policy requires it.',
    ],
    output:
      'Readiness plus continuation, or the completed Archive transaction and workspace finish result; Archive does not repeat verification.',
  },
  doctor: {
    usage: 'comet native doctor [<change-name>] [--repair]',
    purpose:
      'Inspect portable state, migrate a legacy active change, or rebuild its local execution overlay.',
    options: [
      '--repair  Apply deterministic migration or rebuild from the portable stable boundary.',
    ],
    output:
      'Health, migration or recovery details, and the continuation with the next Runner action.',
  },
});

function section(title: string, values: readonly string[]): string {
  return `${title}:\n${values.map((value) => `  ${value}`).join('\n')}`;
}

function normalizeTopic(parts: readonly string[]): string {
  const meaningful = parts.filter((part) => part !== '--help');
  if (meaningful.length === 0) return '';
  const nested = meaningful.slice(0, 2).join(' ');
  if (HELP[nested]) return nested;
  if (meaningful.length > 1 && HELP[meaningful[0]]?.subcommands) return nested;
  return meaningful[0];
}

export function nativeHelp(topicParts: readonly string[] = []): {
  topic: string;
  usage: string;
} {
  const topic = normalizeTopic(topicParts);
  const entry = HELP[topic];
  if (!entry) throw new Error(`Unknown Native help topic: ${topic}`);
  const sections = [`Usage: ${entry.usage}`, '', entry.purpose];
  if (entry.subcommands) sections.push('', section('Commands', entry.subcommands));
  const options = topic === '' ? entry.options : [...(entry.options ?? []), ...GLOBAL_OPTIONS];
  if (options && options.length > 0) sections.push('', section('Options', options));
  sections.push('', `Output:\n  ${entry.output}`);
  if (entry.examples) sections.push('', section('Examples', entry.examples));
  if (topic === '') {
    sections.push('', 'Run `comet native <command> --help` for command-specific details.');
  }
  return { topic, usage: `${sections.join('\n')}\n` };
}

export const USAGE = nativeHelp().usage;
