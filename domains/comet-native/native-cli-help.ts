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
    purpose: 'Create, inspect, advance, verify, recover, and archive Native changes.',
    subcommands: [
      'init                         Initialize Native project configuration.',
      'root show                    Inspect the configured artifact root.',
      'root move <artifact-root>    Move the configured artifact root.',
      'new <change-name>            Create a change and prepare its workspace.',
      'spec remove|rebase           Change or recover canonical specification intent.',
      'show <change-name>           Read the complete persisted change state.',
      'status [<change-name>]       Discover resumable changes and exact next actions.',
      'select <change-name>         Select a change in its bound workspace.',
      'checkpoint <change-name>     Save a resumable progress checkpoint.',
      'check <change-name>          Run Native required checks.',
      'evidence format              Format acceptance evidence entries.',
      'receipt <command>            Issue or refresh typed verification receipts.',
      'next <change-name>           Submit phase evidence or return to Build.',
      'archive <change-name>        Preview and execute Archive plus workspace finish.',
      'doctor [<change-name>]       Diagnose or repair recoverable Native state.',
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
    purpose:
      'Create a Native change, preparing the requested branch or linked worktree before baseline capture.',
    options: [
      '--language en|zh-CN          Artifact language; defaults to project configuration.',
      '--isolation <kind>           current, branch, or worktree; defaults to current.',
      '--change-branch <branch>     Change branch; defaults to comet/<change-name>.',
      '--target-branch <branch>     Local base branch; defaults to the current branch.',
      '--worktree-path <path>       Worktree directory; defaults to .worktrees/<change-name>.',
    ],
    output: 'The new state, workspace binding, preparation receipt, and continuation.',
    examples: [
      'comet native new session-timeout --language zh-CN',
      'comet native new session-timeout --isolation branch --target-branch main',
      'comet native new session-timeout --isolation worktree --target-branch main',
    ],
  },
  spec: {
    usage: 'comet native spec <remove|rebase> [arguments]',
    purpose: 'Record capability removal or recover from canonical specification drift.',
    subcommands: [
      'remove <change-name> <capability>          Record a capability removal.',
      'rebase <change-name> --summary <text>      Rebind rewritten target specs.',
    ],
    output: 'The updated specification trajectory and continuation.',
  },
  'spec remove': {
    usage: 'comet native spec remove <change-name> <capability>',
    purpose: 'Record removal of a capability in the change specification trajectory.',
    output: 'The updated change state and continuation.',
  },
  'spec rebase': {
    usage: 'comet native spec rebase <change-name> --summary <text>',
    purpose: 'Rebind rewritten complete target specifications after canonical drift.',
    options: ['--summary <text>  Why the specification was rebased.'],
    output: 'The rebased specification trajectory and continuation.',
  },
  show: {
    usage: 'comet native show <change-name>',
    purpose: 'Read the complete persisted state for one Native change.',
    output: 'The bounded change state and referenced Runtime projections.',
  },
  status: {
    usage:
      'comet native status [<change-name>] [--cursor <token>] [--details [--acceptance-cursor <token>]]',
    purpose:
      'Discover changes across registered Git worktrees or inspect one change in its bound workspace.',
    options: [
      '--cursor <token>             Continue a status-list page.',
      '--details                    Include bounded findings, checkpoint, and acceptance details.',
      '--acceptance-cursor <token>  Continue acceptance details for one change.',
    ],
    output:
      'A resumable status page or one status projection with workspace identity and exact follow-up actions.',
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
  checkpoint: {
    usage:
      'comet native checkpoint <change-name> --summary <text> --next-action <text> [--artifact <project-relative>]... [--expect-revision <n>]',
    purpose: 'Save a bounded recovery checkpoint without advancing the phase.',
    options: [
      '--summary <text>          Progress completed so far.',
      '--next-action <text>      Concrete action to resume with.',
      '--artifact <path>         Project-relative artifact; repeatable.',
      '--expect-revision <n>     Reject a stale checkpoint write.',
    ],
    output: 'The checkpoint receipt, resulting revision, and continuation.',
  },
  check: {
    usage: 'comet native check <change-name>',
    purpose: 'Run Native built-in required checks for the current implementation scope.',
    output: 'Typed check receipts and any actionable failures.',
  },
  evidence: {
    usage: 'comet native evidence format [--entries <path>]',
    purpose: 'Format acceptance entries as the canonical verification.md machine block.',
    subcommands: ['format [--entries <path>]  Read JSON from a file or stdin and emit the block.'],
    output: 'A canonical acceptance-evidence Markdown block.',
  },
  'evidence format': {
    usage: 'comet native evidence format [--entries <path>]',
    purpose: 'Format acceptance entries as the canonical verification.md machine block.',
    options: ['--entries <path>  Read the JSON array from a bounded file instead of stdin.'],
    output: 'A canonical acceptance-evidence Markdown block.',
  },
  receipt: {
    usage: 'comet native receipt <manual|automated|refresh> [arguments]',
    purpose: 'Issue or refresh typed, revision-bound verification receipts.',
    subcommands: [
      'manual <change-name>       Record an actual human observation.',
      'automated <change-name>    Execute a command and record its result.',
      'refresh <change-name>      Inspect or apply safe manual-receipt refreshes.',
    ],
    output: 'Typed receipt references or a structured refresh plan.',
  },
  'receipt manual': {
    usage:
      'comet native receipt manual <change-name> --acceptance <id>... --step <text>... --observation <text>...',
    purpose: 'Record actual manual verification observations as a typed receipt.',
    options: [
      '--acceptance <id>   Acceptance ID; repeatable.',
      '--step <text>       Step actually performed; repeatable.',
      '--observation <text>  Result actually observed; repeatable.',
    ],
    output: 'The receipt reference and typed receipt.',
  },
  'receipt automated': {
    usage:
      'comet native receipt automated <change-name> [--acceptance <id>]... [--timeout-ms <n>] -- <executable> [args...]',
    purpose: 'Execute a verification command and bind its real result to the current revision.',
    options: [
      '--acceptance <id>  Acceptance ID covered by the command; repeatable.',
      '--timeout-ms <n>   Positive bounded execution timeout.',
      '--                 Separates Native options from the executable and arguments.',
    ],
    output: 'The command result, typed receipt, and scope-change recovery when needed.',
  },
  'receipt refresh': {
    usage: 'comet native receipt refresh <change-name> [--dry-run|--apply]',
    purpose: 'Classify stale receipts and safely re-issue revision-only manual receipts.',
    options: [
      '--dry-run  Report required actions without changing files; this is the default.',
      '--apply    Re-issue eligible manual receipts and update verification.md.',
    ],
    output: 'Refreshed receipts plus explicit rerun, manual, and required-check actions.',
  },
  next: {
    usage: 'comet native next <change-name> --summary <text> [phase evidence options]',
    purpose: 'Submit phase evidence, advance safely, or explicitly return Verify/Archive to Build.',
    options: [
      '--summary <text>                                      Required transition summary.',
      '--confirmed                                           Confirm the current shared understanding.',
      '--return-to-build                                     Return Verify or Archive to Build.',
      '--artifact <project-relative-path>                     Build artifact; repeatable.',
      '--no-code-reason <text>                               Explain a legitimate no-code Build.',
      '--allow-partial-scope <sha256> --partial-reason <text>  Accept the exact reported gap.',
      '--result pass|fail --report <change-relative-path>     Submit Verify evidence.',
      '--override-repair <sha256> --override-summary <text>   Apply one new repair hypothesis.',
    ],
    output: 'The transition result, structured findings, and complete continuation template.',
    examples: [
      'comet native next session-timeout --summary "Shape confirmed" --confirmed',
      'comet native next session-timeout --summary "Build complete" --artifact src/session.ts',
      'comet native next session-timeout --summary "Verification complete" --result pass --report verification.md',
    ],
  },
  archive: {
    usage:
      'comet native archive <change-name> --dry-run [--finish merge|push|pull-request|keep]\n       comet native archive <change-name> --expect-preflight <sha256> [--confirmed]',
    purpose:
      'Preview Archive, persist an authorized workspace finish, then archive and execute that finish.',
    options: [
      '--dry-run                 Recompute readiness without archiving.',
      '--finish <action>         Persist merge, push, pull-request, or keep for an isolated workspace.',
      '--expect-preflight <hash> Execute only the exact current preview.',
      '--confirmed               Confirm Archive when project policy requires it.',
    ],
    output: 'The Archive transaction plus a structured workspace-finish result or recovery plan.',
  },
  doctor: {
    usage: 'comet native doctor [<change-name>] [--repair] [--strategy continue|rollback]',
    purpose:
      'Diagnose Native configuration, state, transaction, selection, and migration problems.',
    options: [
      '--repair                    Apply only repairs proven safe by the diagnosis.',
      '--strategy continue|rollback  Resolve a recoverable transaction in that direction.',
    ],
    output: 'Health, findings, applied repairs, and remaining required actions.',
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
