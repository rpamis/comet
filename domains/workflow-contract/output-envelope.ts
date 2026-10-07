/**
 * Shared output-envelope contract for the Classic and Native CLIs.
 *
 * Every command's user-visible story is split by audience:
 * - `summary` and `user_message` are human lines: plain language, no internal
 *   machine terms (no revision counters, hashes, or state-file field names).
 * - `next` is the single follow-up action for the agent: either an exact
 *   command to run or a question to relay to the user.
 * - structured machine data stays in each runtime's existing `data` payload
 *   and is only shown to humans behind an explicit verbose/details flag.
 *
 * The contract only fixes field names, markers, and audience rules. Phrase
 * wording lives in each runtime's own output-language catalog so Classic and
 * Native never share state-machine logic through this module.
 */

export type CliOutputLocale = 'en' | 'zh-CN';

/** 由领域根据当前 Run 决定；展示层不得根据命令名重新推断是否可推进。 */
export type CliContinuationMode = 'execute' | 'wait' | 'ask' | 'reconcile' | 'done';

export interface CliActionContinuation {
  mode: CliContinuationMode;
  commandArgs: readonly string[] | null;
  requiredInputs: readonly string[];
  instruction?: string;
}

/** argv 是执行依据；文本按 POSIX shell 引用，避免空格、变量和重定向改变参数。 */
export function formatCliCommandArgs(args: readonly string[]): string {
  return args
    .map((value) =>
      /^[A-Za-z0-9_./:=+@-]+$/u.test(value) ? value : `'${value.replace(/'/gu, `'"'"'`)}'`,
    )
    .join(' ');
}

export interface CliNextHint {
  /** Exact command the agent should run next, if the next step is a command. */
  command?: string;
  /** What the agent must ask the user instead of running a command. */
  ask_user?: string;
  /** 等待、核对或结束时的动作说明，不伪装成用户问题或可执行命令。 */
  instruction?: string;
}

export interface CliOutputEnvelope {
  /** One to three plain-language sentences: what happened, for humans. */
  summary: string;
  next?: CliNextHint;
  /** Ready-to-relay block for the user (decisions, pauses, recoveries). */
  user_message?: string;
}

export interface CliAgentObservation {
  phase: string | null;
  status: string | null;
  stateVersion: number | null;
  workspace: { cwd: string | null };
  continuation: Record<string, unknown> | null;
  /** SDK identity and revision stay separate from a workflow's state version. */
  run?: { id: string | null; revision: number | null; status: string | null };
}

/** A bounded view of existing runtime facts, never a second state machine. */
export function projectCliAgentObservation(data: unknown, cwd?: string): CliAgentObservation {
  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const root = record(data);
  const entry = record(root.entry);
  const run = record(root.run ?? entry.run ?? (typeof root.runId === 'string' ? root : undefined));
  const state = record(root.state ?? entry.state ?? root);
  const workspace = record(root.preparation ?? root.workspace ?? entry.workspace);
  const continuation = record(
    root.continuation ?? entry.continuation ?? root.nextAction ?? entry.nextAction,
  );
  const executionCwd =
    typeof workspace.projectRoot === 'string' && workspace.projectRoot !== '.'
      ? workspace.projectRoot
      : typeof continuation.cwd === 'string'
        ? continuation.cwd
        : typeof root.projectRoot === 'string'
          ? root.projectRoot
          : typeof entry.projectRoot === 'string'
            ? entry.projectRoot
            : (cwd ?? null);
  const version = state.stateVersion ?? state.state_version;
  const status = state.status ?? run.status;
  // 轻量头引用同一 JSON 内的当前工作，避免再次复制输入正文和完整提案。
  const { current, ...continuationHeader } = continuation;
  const continuationView =
    current === undefined
      ? continuation
      : {
          ...continuationHeader,
          currentRef:
            root.continuation !== undefined
              ? 'data.continuation.current'
              : 'data.entry.continuation.current',
        };
  return {
    phase: typeof state.phase === 'string' ? state.phase : null,
    status: typeof status === 'string' ? status : null,
    stateVersion: typeof version === 'number' ? version : null,
    workspace: { cwd: executionCwd },
    continuation: Object.keys(continuation).length
      ? { ...continuationView, cwd: executionCwd }
      : null,
    ...(Object.keys(run).length
      ? {
          run: {
            id:
              typeof run.id === 'string'
                ? run.id
                : typeof run.runId === 'string'
                  ? run.runId
                  : null,
            revision: typeof run.revision === 'number' ? run.revision : null,
            status: typeof run.status === 'string' ? run.status : null,
          },
        }
      : {}),
  };
}

/**
 * Stable machine-line markers. Markers stay English so agents can pattern
 * match them across locales; only the content after each marker is localized.
 */
export const CLI_OUTPUT_MARKERS = {
  next: 'NEXT:',
  relay: 'RELAY TO USER:',
  detail: 'DETAIL:',
  details: '--- machine projection (run with --json to consume it) ---',
} as const;

export function cliNextHintLine(next: CliNextHint | undefined): string | null {
  if (!next) return null;
  if (next.command) return `${CLI_OUTPUT_MARKERS.next} ${next.command}`;
  if (next.ask_user) return `${CLI_OUTPUT_MARKERS.next} ${next.ask_user}`;
  if (next.instruction) return `${CLI_OUTPUT_MARKERS.next} ${next.instruction}`;
  return null;
}

/**
 * Render the envelope as the default text output: human summary first, the
 * agent's single next step, then the relay block. `details` (the raw machine
 * projection) is only appended in verbose mode.
 */
export function formatCliOutputEnvelope(envelope: CliOutputEnvelope, details?: unknown): string {
  const lines: string[] = [envelope.summary];
  const nextLine = cliNextHintLine(envelope.next);
  if (nextLine) lines.push(nextLine);
  if (envelope.user_message) {
    lines.push('', CLI_OUTPUT_MARKERS.relay, envelope.user_message);
  }
  if (details !== undefined) {
    lines.push('', CLI_OUTPUT_MARKERS.details, JSON.stringify(details, null, 2));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Render an error envelope: the human story first, then the machine detail so
 * debugging context is never lost when the message is translated.
 */
export function formatCliErrorEnvelope(
  envelope: CliOutputEnvelope,
  message: string,
  details?: unknown,
): string {
  const lines: string[] = [envelope.summary];
  const nextLine = cliNextHintLine(envelope.next);
  if (nextLine) lines.push(nextLine);
  if (envelope.user_message) {
    lines.push('', CLI_OUTPUT_MARKERS.relay, envelope.user_message);
  }
  lines.push('', `${CLI_OUTPUT_MARKERS.detail} ${message}`);
  if (details !== undefined) {
    lines.push('', CLI_OUTPUT_MARKERS.details, JSON.stringify(details, null, 2));
  }
  return lines.join('\n');
}

/**
 * Lint helper for contract tests: returns the denylist fragments found in a
 * human-facing line. Machine lines (NEXT:/DETAIL:/relay markers, JSON) are not
 * passed through this check by callers.
 */
export function cliHumanTextViolations(text: string, denylist: readonly RegExp[]): string[] {
  const violations: string[] = [];
  for (const pattern of denylist) {
    const match = pattern.exec(text);
    if (match) violations.push(match[0]);
  }
  return violations;
}

export function isCliOutputEnvelope(value: unknown): value is CliOutputEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<CliOutputEnvelope>;
  if (typeof candidate.summary !== 'string' || candidate.summary.trim() === '') return false;
  if (
    candidate.next !== undefined &&
    (typeof candidate.next !== 'object' ||
      candidate.next === null ||
      (candidate.next.command !== undefined && typeof candidate.next.command !== 'string') ||
      (candidate.next.ask_user !== undefined && typeof candidate.next.ask_user !== 'string') ||
      (candidate.next.instruction !== undefined && typeof candidate.next.instruction !== 'string'))
  ) {
    return false;
  }
  if (
    candidate.next !== undefined &&
    [candidate.next.command, candidate.next.ask_user, candidate.next.instruction].filter(
      (value) => value !== undefined,
    ).length > 1
  ) {
    return false;
  }
  if (candidate.user_message !== undefined && typeof candidate.user_message !== 'string') {
    return false;
  }
  return true;
}
