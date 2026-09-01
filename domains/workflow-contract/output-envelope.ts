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

export interface CliNextHint {
  /** Exact command the agent should run next, if the next step is a command. */
  command?: string;
  /** What the agent must ask the user instead of running a command. */
  ask_user?: string;
}

export interface CliOutputEnvelope {
  /** One to three plain-language sentences: what happened, for humans. */
  summary: string;
  next?: CliNextHint;
  /** Ready-to-relay block for the user (decisions, pauses, recoveries). */
  user_message?: string;
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
      (candidate.next.ask_user !== undefined && typeof candidate.next.ask_user !== 'string'))
  ) {
    return false;
  }
  if (
    candidate.next !== undefined &&
    candidate.next.command !== undefined &&
    candidate.next.ask_user !== undefined
  ) {
    return false;
  }
  if (candidate.user_message !== undefined && typeof candidate.user_message !== 'string') {
    return false;
  }
  return true;
}
