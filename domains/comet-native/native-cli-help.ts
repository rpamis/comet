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
  '--verbose              Append the raw machine projection after the human/agent text.',
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
      'spec sync <change-name> <capability> --input <json-file>  Audit local Markdown reference corrections.',
      'show <change-name>           Read formal artifacts and portable state.',
      'status [<change-name>]       Discover stable boundaries and Runner actions.',
      'select <change-name>         Select a change in its bound workspace.',
      'next <change-name>           Confirm or recover a stable workflow boundary.',
      'archive <change-name>        Preview and execute Archive plus workspace finish.',
      'doctor [<change-name>]       Diagnose, migrate, or rebuild local execution state.',
    ],
    options: GLOBAL_OPTIONS,
    output:
      'A human summary plus a NEXT step by default (RELAY TO USER blocks carry user decisions); use --json for the structured envelope, --verbose to append the raw machine projection.',
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
      'comet native new <change-name> [--language en|zh-CN] [--task <text>] [--capability <id>] [--isolation current|branch|worktree] [--change-branch <branch>] [--target-branch <branch>] [--worktree-path <path>]',
    purpose: 'Create a portable Native change and prepare the requested branch or linked worktree.',
    options: [
      '--language en|zh-CN          Artifact language; defaults to project configuration.',
      '--task <text>                Search Project Knowledge for an existing capability and save a revocable association draft.',
      '--capability <id>            Directly validate and associate an existing capability without retrieval.',
      '--isolation <kind>           current, branch, or worktree; defaults to current.',
      '--change-branch <branch>     Change branch; defaults to comet/<change-name>.',
      '--target-branch <branch>     Local base branch; defaults to the current branch.',
      '--worktree-path <path>       Worktree directory; defaults to .worktrees/<change-name>.',
    ],
    output:
      'The portable state, workspace preparation result, and continuation with the next Runner action.',
    examples: [
      'comet native new session-timeout --language zh-CN',
      'comet native new add-sms-login --task "add SMS login to authentication"',
      'comet native new session-timeout --isolation branch --target-branch main',
      'comet native new session-timeout --isolation worktree --target-branch main',
    ],
  },
  spec: {
    usage:
      'comet native spec remove <change-name> <capability>\n       comet native spec sync <change-name> <capability> --input <json-file>',
    purpose:
      'Record a capability removal; create and modify intents use complete proposed Spec files.',
    subcommands: [
      'remove <change-name> <capability>  Record a capability removal.',
      'sync <change-name> <capability> --input <json-file>  Audit local Markdown reference corrections without changing prose or acceptance.',
    ],
    output: 'The updated portable state and continuation.',
  },
  'spec remove': {
    usage: 'comet native spec remove <change-name> <capability>',
    purpose: 'Record removal of a capability in the complete target specification.',
    output: 'The updated portable state and continuation with the next Runner action.',
  },
  'spec sync': {
    usage: 'comet native spec sync <change-name> <capability> --input <json-file>',
    purpose:
      'Sync local Markdown link destinations in an already confirmed target spec; semantic edits require Shape.',
    options: [
      '--input <json-file>  Fields: expectedStateVersion, actor, reason, affectedAcceptanceIds, replacements [{from,to}]. Include all acceptance IDs from the affected spec.',
    ],
    output:
      'The audited portable state, preserved unaffected acceptance results and Build continuation for re-verification.',
  },
  show: {
    usage: 'comet native show <change-name>',
    purpose: 'Read formal artifacts and portable state for one Native change.',
    output:
      'A compact summary and NEXT action by default. Use --json to read the portable state, brief, complete proposed Specs, and continuation; legacy state is reported as migration-required. Fill command-template placeholders before executing NEXT commands.',
  },
  check: {
    usage: 'comet native check <change-name>',
    purpose: 'Legacy-only verification command; not supported for current portable changes.',
    output:
      'For current changes, run comet native status <change-name> --json and follow the continuation to dispatch verification through comet native next.',
  },
  status: {
    usage: 'comet native status [<change-name>] [--cursor <token>] [--details]',
    purpose:
      'Discover portable stable boundaries, parent child readiness, or the exact next Runner action.',
    options: [
      '--cursor <token>  Continue a status-list page, or a named details/history page.',
      '--details         Include one fixed-size page of acceptance, Spec, handoff, verification, history, workspace, and report details.',
    ],
    output:
      'A compact v2 status page or one compact Loop projection with local execution availability. Use --details and --cursor to read fixed-size detail pages; parent changes expose childSummary and readyChildren.',
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
      'comet native next <change-name> --summary <text> [--coordination-mode multi-session|single-session] [--max-parallel <n>] [--expected-state-version <n>] [--expected-action <action>]\n       comet native next <change-name> --summary <text> [--confirmed|--accept-result|--revise-implementation|--revise-requirements|--retry-verifier|--resolve-verifier-blocker] [--expected-state-version <n>] [--expected-action <action>]\n       comet native next <change-name> --runner-input <json-file> [--validate-only]',
    purpose:
      'Confirm or recover an Agent boundary, advance parent child changes, handle Supervisor task operations, or use one skill-coordinated JSON bridge for Builder handoff, check-plan dispatch, and Verifier response/error.',
    options: [
      '--summary <text>    Required transition or recovery summary.',
      '--confirmed         Confirm the persisted Shape boundary with both expected guards, or confirm an explicitly degraded verifier-unavailable fallback before Archive.',
      '--coordination-mode multi-session|single-session  Select how a multi-child Supervisor proceeds while preparing its Shape confirmation; final Shape confirmation is a later, separate step.',
      '--accept-result     Accept the current skill-coordinated Verify result and make it archive-ready.',
      '--revise-implementation  Keep confirmed requirements unchanged and return Verify to Build for implementation revision.',
      '--revise-requirements    Return Verify or Archive to Shape when user-visible goals or acceptance criteria must change.',
      '--retry-verifier    Retry a failed or unavailable Verifier when the continuation allows it.',
      '--resolve-verifier-blocker  Resolve a semantic Verifier blocker without changing the candidate, then dispatch a new attempt.',
      '--max-parallel <n>  Supervisor task concurrency cap; defaults to 2, use 1 for serial fallback.',
      '--expected-state-version <n>  Continuation-issued guard that rejects stale public transition decisions.',
      '--expected-action <action>    Continuation-issued guard that binds the public transition decision to its intended action.',
      '--runner-input <file>  Skill-coordinated JSON: builder-handoff, dispatch-verifier, retry-checks, verifier-response, verifier-execution-error, or verifier-unavailable. Builder/dispatch identity fields are rejected; verifier responses must echo the current candidateId and verifierExecutionRef from the Verifier dispatch.',
      '--validate-only       Validate the Runner JSON shape and current boundary without writing state or starting a process; requires --runner-input.',
      '  Choose one object template from an inputOptions exclusiveGroup and save it as UTF-8 JSON (BOM accepted). Field errors return issues with JSON pointer, missingFields and unknownFields. Execute agent.continuation in agent.workspace.cwd; Supervisor results use task.returnAction.',
      '  builder-handoff fields: kind, summary, addressed_acceptance_ids, checks, known_limits, optional review. If review is supplied, its fields are status=passed, summary, reviewer_execution_ref from a separate read-only review.',
      '  dispatch-verifier fields: kind, checks (an explicitly resolved plan; [] is allowed).',
      '  retry-checks fields: kind, check_ids for repeatable interrupted Runtime checks from the current candidate; each check can be retried at most three times.',
      '  verifier-response fields: kind, candidateId, verifierExecutionRef, response (request-checks or final-result); copy the two binding fields from the current continuation.',
      '  verifier-execution-error fields: kind, summary, stateVersion, iteration, attempt, verifierExecutionRef copied from verifierDispatch.',
      '  verifier-unavailable fields: kind, summary, stateVersion, iteration, attempt, verifierExecutionRef copied from verifierDispatch; accepted only after the explicit Runtime check plan completed and passed.',
      '  Supervisor task fields: supervisor-builder-result (child, runId, candidateCommit), supervisor-builder-failure (child, runId, reason), supervisor-verifier-result (child, runId, verdict, verification data), supervisor-reconnect (child, runId), supervisor-cancel (child, runId, reason), or supervisor-integrate (child, checks).',
      '  supervisor-checks fields: kind, child, runId, checks (non-empty repeatable Runtime check plans), materials [{name,content}], and optional retry_check_ids for interrupted checks from the same candidate, machine and workspace. Returns per-check execution state plus operationId, status and receiptRef. Repeated running plans return the same handle.',
      '  supervisor-verifier-result evidence fields: summary, checks (informal notes), acceptance [{id,result,reason}], receiptRef. verdict is pass, fail or blocked; every task acceptance ID must appear exactly once. Runtime receipts determine formal check status; receiptRef may be null for fail or blocked.',
      '  supervisor-integrate checks are non-empty Runtime check plans executed after the merge in the integration worktree, not declared statuses.',
    ],
    output:
      'A compact portable state summary, explicit skill-coordinated label, Runtime-owned check results, scoped verifierDispatch, bounded request-check response, continuation.runnerAction, machine-readable continuation.inputOptions, and continuation.userCommunication with a user-ready message and Agent relay guidance. Read acceptance text and other long fields from paged status --details output. Human-readable verification statuses include "Host independently verified", "Checks completed, but your confirmation is required", "Full verification was unavailable; only automatic checks completed", and "You accepted the incomplete verification result". This generic bridge is not trusted identity attestation: a passing result waits for explicit user confirmation before Archive.',
    examples: [
      'comet native next session-timeout --summary "Shape confirmed" --confirmed --expected-state-version <n> --expected-action confirm-shape',
      'comet native next session-timeout --summary "Current result accepted" --accept-result',
      'comet native next session-timeout --summary "Implementation needs revision" --revise-implementation',
      'comet native next session-timeout --summary "Acceptance criteria changed" --revise-requirements',
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
      '--dry-run          Run the complete read-only Archive and workspace-finish readiness check; it persists only an explicit --finish choice.',
      '--finish <action>  Persist merge, push, pull-request, or keep for an isolated workspace.',
      '--serial-first <current-change>  During execution only, confirm that this change archives before detected capability peers; the value must equal <change-name>.',
      '--confirmed        Confirm Archive when project policy requires it.',
    ],
    output:
      'Readiness, every blocker, and the exact next continuation, or the completed Archive transaction and workspace finish result. Execute the returned confirmed command only after ready is true; Archive does not repeat verification.',
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
