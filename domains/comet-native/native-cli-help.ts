interface NativeHelpEntry {
  usage: string;
  purpose: string;
  agentQuickStart?: readonly string[];
  options?: readonly string[];
  output: string;
  examples?: readonly string[];
  subcommands?: readonly string[];
}

const GLOBAL_OPTIONS = [
  '--project-root <path>  Resolve the Native project from this working directory.',
  '--json                 Emit the stable JSON command envelope.',
  '--compact              与 --json 合用；重复字段用 outputView.references 的 JSON Pointer 定位，Request 模板保留完整；没有字节收益时返回原完整协议。去掉此选项获取完整协议。',
  '--verbose              Append the raw machine projection after the human/agent text.',
  '--help                 Show help without requiring an initialized project.',
] as const;

const HELP: Readonly<Record<string, NativeHelpEntry>> = Object.freeze({
  '': {
    usage: 'comet native <command> [options]',
    purpose:
      'Create, inspect, recover, and archive portable Native changes through Runtime-enforced, skill-coordinated steps.',
    agentQuickStart: [
      'Run `comet native status --json` to discover active changes.',
      'Select an existing change with `select`, or create one with `new`.',
      'After Shape approval, new ordinary SDK tasks use `next <change> --session <actual-session>`. Submit business results using the returned command. Runtime checks and the next task are returned together. Older and Supervisor tasks retain their returned protocol through `comet runtime dispatch --application native`; read continuation.inputOptions when present.',
      'For compat Runtime changes, execute `agent.continuation.commandArgs` in `agent.workspace.cwd` and fill `agent.continuation.inputOptions` templates.',
    ],
    subcommands: [
      'init                         Initialize Native project configuration.',
      'root show                    Inspect the configured artifact root.',
      'root move <artifact-root>    Move the configured artifact root.',
      'new <change-name>            Create a change and prepare its workspace.',
      'spec disassociate            Revoke a capability association through Runtime.',
      'spec remove                  Record a complete capability removal intent.',
      'spec sync <change-name> <capability> --input <json-file>  Audit local Markdown reference corrections.',
      'show <change-name>           Read formal artifacts and portable state.',
      'status [<change-name>]       Discover stable boundaries and Runner actions.',
      'select <change-name>         Select a change in its bound workspace.',
      'next <change-name>           Confirm or recover a stable workflow boundary.',
      'archive <change-name>        Preview and execute Archive plus workspace finish.',
      'cancel <change-name>         Cancel an unfinished change while keeping its code and workspace.',
      'doctor [<change-name>]       Diagnose, migrate, or rebuild local execution state.',
      'transfer export|import        Move an active Supervisor Child Build to another checkout.',
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
      'comet native new <change-name> [--runtime compat|sdk] [--language en|zh-CN] [--task <text>] [--capability <id>] [--isolation current|branch|worktree] [--change-branch <branch>] [--target-branch <branch>] [--worktree-path <path>]',
    purpose: 'Create a portable Native change and prepare the requested branch or linked worktree.',
    options: [
      '--runtime compat|sdk        Runtime format for this new change; defaults to sdk.',
      '--language en|zh-CN          Artifact language; defaults to project configuration.',
      '--task <text>                Preserve the original request in the SDK Run for independent alignment review; also search Project Knowledge for a capability association.',
      '--capability <id>            Directly validate and associate an existing capability without retrieval.',
      '--isolation <kind>           current, branch, or worktree; defaults to current.',
      '--change-branch <branch>     Change branch; defaults to comet/<change-name>.',
      '--target-branch <branch>     Local base branch; defaults to the current branch.',
      '--worktree-path <path>       Worktree directory; defaults to .worktrees/<change-name>.',
    ],
    output:
      'The SDK Run or portable state, canonical artifact paths, and workspace preparation result; compat Runtime changes include the next Runner continuation.',
    examples: [
      'comet native new session-timeout --language zh-CN',
      'comet native new add-sms-login --task "add SMS login to authentication"',
      'comet native new session-timeout --isolation branch --target-branch main',
      'comet native new session-timeout --isolation worktree --target-branch main',
    ],
  },
  spec: {
    usage:
      'comet native spec disassociate <change-name> --expected-state-version <n> --expected-action disassociate-capability\n       comet native spec remove <change-name> <capability>\n       comet native spec sync <change-name> <capability> --input <json-file>',
    purpose:
      'Record a capability removal; create and modify intents use complete proposed Spec files.',
    subcommands: [
      'disassociate <change-name>  Revoke a capability association and return to Shape.',
      'remove <change-name> <capability>  Record a capability removal.',
      'sync <change-name> <capability> --input <json-file>  Compat-only Markdown reference correction; SDK changes return to Shape for revision.',
    ],
    output: 'The updated portable state and continuation.',
  },
  'spec remove': {
    usage: 'comet native spec remove <change-name> <capability>',
    purpose: 'Record removal of a capability in the complete target specification.',
    output: 'The updated portable state and continuation with the next Runner action.',
  },
  'spec disassociate': {
    usage:
      'comet native spec disassociate <change-name> --expected-state-version <n> --expected-action disassociate-capability',
    purpose: 'Revoke a capability association through Runtime without hand-editing artifacts.',
    options: [
      '--expected-state-version <n>  State version returned by the latest status response.',
      '--expected-action <action>   Must be disassociate-capability.',
    ],
    output: 'The updated portable state and continuation with the next Runner action.',
  },
  'spec snapshot': {
    usage: 'comet native spec snapshot <change-name>',
    purpose:
      'Restore the originally approved documents first. Runtime checks their complete legacy fingerprint and saves at most 2 MiB of original evidence in this workspace Runtime. It does not approve changed requirements or change the Run, candidate, Action, claim or check receipts. Evidence is local to this workspace; repeat the verified capture after moving to another device.',
    output:
      'The validated original Shape identity and captured sources; no workflow state changes.',
  },
  'spec sync': {
    usage: 'comet native spec sync <change-name> <capability> --input <json-file>',
    purpose:
      'Compat-only reference correction. SDK changes use Shape edits or next --revise-requirements from Verify/Archive.',
    options: [
      '--input <json-file>  Fields: expectedStateVersion, actor, reason, affectedAcceptanceIds, replacements [{from,to}]. Include all acceptance IDs from the affected spec.',
    ],
    output:
      'For compat Runtime changes, the audited state and Build continuation for re-verification. SDK changes receive revise-requirements guidance.',
  },
  show: {
    usage: 'comet native show <change-name>',
    purpose: 'Read formal artifacts and portable state for one Native change.',
    output:
      'A compact summary and NEXT action by default. Use --json to read canonical artifact paths, the portable state, brief, complete proposed Specs, and continuation; compat Runtime state is reported as migration-required. Fill command-template placeholders before executing NEXT commands.',
  },
  check: {
    usage: 'comet native check <change-name>',
    purpose: 'Compatibility guidance for running checks through Agent platform tools.',
    output:
      'For current changes, run comet native status <change-name> --json and follow the continuation to dispatch verification through comet native next.',
  },
  status: {
    usage: 'comet native status [<change-name>] [--cursor <token>] [--details]',
    purpose:
      'Discover portable stable boundaries, parent child readiness, or the exact next Runner action.',
    options: [
      '--cursor <token>  Continue a status-list page, or a named details/history page.',
      '--details         SDK: include complete business state and Action/Wait history. Compat: include one fixed-size detail page.',
    ],
    output:
      'SDK status includes the exact continuation, claim request templates, all pending/running/unknown work, and the latest 12 settled records per history collection. run.history reports omitted records; --details returns complete history without --cursor. Compat status reports business continuation and details use --cursor for fixed-size pages; parent changes expose childSummary and readyChildren.',
    examples: [
      'comet native status --json',
      'comet native status session-timeout --details --json',
    ],
  },
  select: {
    usage: 'comet native select <change-name> [--rebind]',
    options: [
      '--rebind  Explicitly bind the same idle SDK Run to the current Git branch; preserve work and approvals, and reject unresolved executions.',
    ],
    purpose: 'Select one Native change after validating its workspace binding.',
    output: 'The selected change record.',
  },
  next: {
    usage:
      'comet native next <change-name> --session <actual-session> [--action <id>] [--result <json-file>] [--review current-session|independent] [--accept-on-pass <authorization-summary>] [--details]\n       comet native next <change-name> --summary <text> [--coordination-mode multi-session|single-session] [--max-parallel <n>] [--expected-state-version <n>] [--expected-action <action>]\n       comet native next <change-name> --summary <text> [--confirmed|--accept-result|--revise-implementation|--revise-requirements|--retry-verifier|--resolve-verifier-blocker] [--expected-state-version <n>] [--expected-action <action>]\n       comet native next <sdk-change> --confirmed --coordination-mode multi-session|single-session --summary <text> --expected-state-version <n> --expected-action confirm-shape\n       comet native next <sdk-change> --accept-result|--revise-implementation|--retry-verifier|--continue-builder|--resolve-verifier-blocker --summary <text> --proposal-hash <hash> --expected-state-version <n> --expected-action <action>\n       comet native next <change-name> --runner-input <json-file> [--validate-only]',
    purpose:
      'Advance SDK-owned Runtime actions and bound user decisions, or recover a compat Runtime Agent boundary and use its skill-coordinated Builder/Verifier JSON bridge.',
    options: [
      '--session <actual-session>  Claim a new ordinary SDK task using its real receiving session.',
      '--action <id>               Preserve the current task ID when claiming or reporting.',
      '--result <json-file>        Submit actual status/output business fields, run authorized internal steps, and return the next task. Requires --action and --session.',
      '--review current-session|independent  Continue ordinary Verify in this session or leave it for a separate actual receiver. Honor explicit user requests for independent review.',
      '--accept-on-pass <authorization-summary>  With this Verify result only, record prior explicit user delegation to accept and archive if all criteria pass. Without this option, wait for user acceptance.',
      '--details                   With --session, include the full SDK projection alongside the current task.',
      '--summary <text>    Required transition or recovery summary.',
      '--confirmed         Confirm the persisted Shape boundary with both expected guards, or confirm an explicitly degraded verifier-unavailable fallback before Archive.',
      '--coordination-mode multi-session|single-session  Choose how a multi-child Supervisor proceeds. Supply it with --confirmed at the persisted Shape boundary to confirm the full plan and mode together, or select it during preparation and confirm the plan afterward.',
      '--accept-result     Accept the current skill-coordinated Verify result and make it archive-ready.',
      '--finish keep|merge|push|pull-request  For compat changes, with --accept-result record the explicitly chosen isolated-workspace finish in the same guarded decision. SDK Runs keep Git delivery separate.',
      '--revise-implementation  Keep confirmed requirements unchanged and return Verify to Build for implementation revision.',
      '--revise-requirements    Renew a pending Shape proposal or return Verify, Archive, or a quiescent SDK Supervisor Build to Shape. SDK changes also allow revising after an ordinary Builder explicitly failed; use the current continuation proposal hash. Preserve partial work and reconcile running/unknown Actions first. The new Shape still requires explicit approval. Completed SDK Runs require an application-validated blocked Child recovery.',
      '--retry-verifier    Retry a failed or unavailable Verifier when the continuation allows it.',
      '--continue-builder  After a failed SDK Builder Action, explicitly continue from its preserved workspace in a new Action.',
      '--resolve-verifier-blocker  Resume an SDK or compat blocked Verifier with the retained candidate and valid checks; a completed SDK Supervisor Child resumes with a new Builder. SDK recovery requires the current proposal hash and both expected guards; original outcomes are preserved.',
      '--max-parallel <n>  Compat-only Supervisor concurrency override. SDK and Compat use native.max_parallel_children (default 2); configure it in project settings or .comet/config.yaml; single-session always uses 1.',
      '--expected-state-version <n>  Continuation-issued guard that rejects stale public transition decisions.',
      '--expected-action <action>    Continuation-issued guard that binds the public transition decision to its intended action.',
      '--proposal-hash <hash>       SDK decision guard from the current Wait or blocked Child continuation; required with --accept-result, --revise-implementation, --retry-verifier, --continue-builder, or --resolve-verifier-blocker, and with --revise-requirements for pending Shape or failed ordinary Builder recovery.',
      '--runner-input <file>  Skill-coordinated JSON: builder-handoff, dispatch-verifier, retry-checks, verifier-response, verifier-started, verifier-execution-error, or verifier-unavailable. Builder/dispatch identity fields are rejected; verifier responses must echo the current candidateId and verifierExecutionRef from the Verifier dispatch.',
      '--validate-only       Validate the Runner JSON shape and current boundary without writing state or starting a process; requires --runner-input.',
      '  Choose one object template from an inputOptions exclusiveGroup and save it as UTF-8 JSON (BOM accepted). Field errors return issues with JSON pointer, missingFields and unknownFields. Execute agent.continuation in agent.workspace.cwd; Supervisor results use task.returnAction.',
      '  builder-handoff fields: kind, summary, addressed_acceptance_ids, acceptance_review, checks, known_limits, optional review. Cover every confirmed acceptance ID with its actual status, evidence and note. Only implemented-with-evidence entries with nonempty evidence are ready for handoff. checks contain actual Agent platform reports. An optional review records status=passed, summary and reviewer_execution_ref from a separate read-only review.',
      '  dispatch-verifier fields: kind. Run development checks through Agent platform tools and hand the current candidate to the selected Verifier.',
      '  retry-checks is a retired compatibility input that returns platform execution guidance without running a command.',
      '  verifier-response fields: kind, candidateId, verifierExecutionRef, response (final-result). Copy the current candidate and receiving session from the dispatch and report every acceptance item.',
      '  verifier-started is optional compatibility progress reporting for the existing Verifier session; it does not supervise a process or authorize completion.',
      '  verifier-execution-error fields: kind, summary, stateVersion, iteration, attempt, verifierExecutionRef copied from verifierDispatch.',
      '  verifier-unavailable fields: kind, summary, stateVersion, iteration, attempt, verifierExecutionRef. Record the actual platform capability failure; it never grants a passing result.',
      '  Supervisor task fields: supervisor-builder-result (child, runId, candidateCommit), supervisor-builder-failure (child, runId, reason), supervisor-verifier-result (child, runId, verdict, verification data), supervisor-reconnect (child, runId), supervisor-cancel (child, runId, reason), or supervisor-integrate (child, checks).',
      '  supervisor-checks is retired and returns platform execution guidance without starting a process or generating a receipt.',
      '  supervisor-verifier-result evidence fields: summary, checks (actual platform reports), acceptance [{id,result,reason}]. verdict is pass, fail or blocked; every task acceptance ID must appear exactly once.',
      '  supervisor-integrate fields: child, integrationCommit and checks [{name,status,reason}], reporting the actual merge and platform checks.',
    ],
    output:
      'SDK-owned changes return the current Run Action or Wait and the same continuation as status/show, including current decision guards and pending Action claimRequest templates. Fill the template with the host session and claim token; the successful claim returns the current Action input. Authorized internal business steps and Archive continue from the original Run. Builder and Verifier handoffs use `comet runtime dispatch --application native`; never resubmit running/unknown work. Compat Runtime changes return the portable state, Runner result, continuation.inputOptions, and userCommunication. The compat JSON bridge is not trusted identity attestation: a passing skill-coordinated result waits for explicit user confirmation before Archive.',
    examples: [
      'comet native next session-timeout --summary "Shape confirmed" --confirmed --expected-state-version <n> --expected-action confirm-shape',
      'comet native next session-timeout --summary "Current result accepted" --accept-result',
      'comet native next session-timeout --summary "Implementation needs revision" --revise-implementation',
      'comet native next session-timeout --summary "Acceptance criteria changed" --revise-requirements',
      'comet native next session-timeout --revise-requirements --summary "User changed the pending Shape or stopped Builder requirements" --proposal-hash <hash> --expected-state-version <n> --expected-action revise-requirements',
      'comet native next session-timeout --summary "Retry verifier infrastructure" --retry-verifier',
      'comet native next session-timeout --continue-builder --summary "Continue the inspected partial work" --proposal-hash <hash> --expected-state-version <n> --expected-action continue-builder',
      'comet native next session-timeout --summary "Retry semantic verification" --resolve-verifier-blocker',
      'comet native next session-timeout --runner-input <temporary-json-file>',
    ],
  },
  cancel: {
    usage: 'comet native cancel <change-name> [--reason <text>] [--dry-run]',
    purpose:
      'Cancel an unfinished SDK Native change: it stops counting as active without verification or a fake Archive.',
    options: [
      '--reason <text>  Record why the change is cancelled; defaults to a neutral user-cancellation note.',
      '--dry-run        List what cancellation would stop, release, and retain without changing any state.',
    ],
    output:
      'The cancellation status and its outstanding acknowledgements. Code, commits, branches, and the workspace are always retained; deleting implementations or worktrees stays a separate explicit Git operation. Completed changes are rejected in favor of archive; legacy 0.4 runtime changes keep their original lifecycle.',
  },
  archive: {
    usage:
      'comet native archive <change-name> --dry-run [--finish merge|push|pull-request|keep] [--commit-message <text>] [--merge-message <text>]\n       comet native archive <change-name> [--confirmed] [--serial-first <current-change>] [--commit-message <text>] [--merge-message <text>]\n       comet native archive <sdk-change-name> --recover [--legacy-spec-backup <json-file>]',
    purpose:
      'Preview or execute deterministic Archive after the portable state reaches archive-ready.',
    options: [
      '--dry-run          Run the complete read-only Archive and workspace-finish readiness check; it persists only an explicit --finish choice.',
      '--finish <action>  Persist merge, push, pull-request, or keep for an isolated workspace.',
      '--expected-state-version <n>  Preserve this continuation-issued guard when confirming a new finish choice; stale choices are rejected before it is recorded.',
      '--commit-message <text>  For compat changes, set the archive commit message; Unicode and multiline text are supported. Git hooks still run.',
      '--merge-message <text>   For compat changes, set the local merge commit message; requires merge finish. Omit it to use Git defaults.',
      '--serial-first <current-change>  During execution only, confirm that this change archives before detected capability peers; the value must equal <change-name>.',
      '--confirmed        Confirm Archive when project policy requires it.',
      '--legacy-spec-backup <json-file>  SDK only: read a bounded original-Spec backup for an existing legacy Archive transaction. Use a new file outside the project so it does not change the old candidate. Requires exact schema/runId/transactionId/path/hash and original candidate digest matches; never writes the source file or Git index. See docs/operations/native-archive-recovery.zh.md.',
      '--recover          For an SDK-owned change, reconcile one unknown Supervisor delivery, Archive, or cleanup Action only after confirming the original execution process has stopped; never retry it as new work.',
    ],
    output:
      'Readiness, every blocker, actual prepared commitMessages (mergeMessage is null when no merge is planned), and the exact next continuation, or the completed Archive transaction and workspace finish result. Messages are retained for retries. After a Git hook rejects a message, provide a corrected message with --confirmed for the unfinished step; completed commits are never rewritten. Execute the returned confirmed command only after ready is true; Archive does not repeat verification.',
  },
  doctor: {
    usage: 'comet native doctor [<change-name>] [--repair] [--confirmed] [--migrate-history]',
    purpose:
      'Inspect Native business state and existing transactions, or recover the original Run checkpoint.',
    options: [
      '--repair  Apply deterministic migration or rebuild from the portable stable boundary.',
      '--migrate-history  Validate and close built-in Native terminal Runs whose business cleanup is complete. Preserve documents and checkpoints; unfinished or invalid Runs remain active. Safe to rerun after interruption. Upgrade CLI and platform Hooks together: older Runtime versions cannot write the new storage format. Ordinary inspection never migrates.',
      '--confirmed  With --repair and a named managed change whose local Run history is missing, recover its saved Run checkpoint. Original business approvals and task claims are preserved.',
    ],
    output:
      'Health, original business records, and structured recovery with diagnosticArgs, recoveryArgs and preconditions. Inspection does not change the Run.',
  },
  transfer: {
    usage:
      'comet native transfer export <change-name> --output <directory> --confirmed-stopped\n       comet native transfer import --input <directory>',
    purpose:
      'Carry a prepared Supervisor Child Builder and its Git worktrees to another checkout before handing the next Child task to an Agent.',
    subcommands: [
      'export  Snapshot the parent checkpoint, Supervisor branches, and non-ignored uncommitted work.',
      'import  Validate the package and restore its Run and worktrees in a checkout at the same target commit.',
    ],
    options: [
      '--output <directory>   New private directory for the transfer package; must not already exist.',
      '--input <directory>    Existing transfer package to import.',
      '--confirmed-stopped    Confirm the original Builder and other Supervisor agents stopped before export.',
    ],
    output:
      'The package path or restored change and worktree paths. An in-flight Builder becomes outcome-unknown and must be reconciled; import never reports its work as completed.',
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
  if (entry.agentQuickStart) {
    sections.push('', section('Agent Quick Start', entry.agentQuickStart));
  }
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
