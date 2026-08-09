import { promises as fs } from 'node:fs';

import { atomicWriteText } from './native-atomic-file.js';
import { NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import type { NativePortableState, NativePortableText } from './native-portable-types.js';

function display(value: NativePortableText | null): string {
  if (value === null) return '—';
  const normalized = value.text.replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim();
  return `${normalized || '—'}${value.truncated ? ' … (truncated)' : ''}`;
}

function tableCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/\r?\n/gu, '<br>');
}

function verdictLabel(state: NativePortableState): string {
  if (state.verification?.assurance === 'semantic-verification-unavailable') {
    return 'Semantic verification unavailable, user confirmation required';
  }
  if (state.verification?.assurance === 'user-confirmed-degraded') {
    return 'Passed with user-confirmed degraded assurance';
  }
  if (state.verification_result === 'pass') {
    return state.phase === 'verify' && state.loop.next_action === 'confirm-skill-coordinated-pass'
      ? 'Passed, user confirmation required'
      : 'Passed';
  }
  if (state.verification_result === 'blocked') return 'Blocked';
  if (state.verification_result === 'fail') return 'Failed';
  return 'Pending';
}

function assuranceLabel(state: NativePortableState): string {
  return (
    state.verification?.assurance ??
    (state.builder_handoff?.identity_provider === NATIVE_SKILL_COORDINATION
      ? NATIVE_SKILL_COORDINATION
      : 'host-attested')
  );
}

export function renderNativeVerificationReport(state: NativePortableState): string {
  if (state.verification === null) {
    throw new Error('Native verification report requires a stable Verifier result');
  }
  const acceptance = state.acceptance
    .map(
      (entry) =>
        `| ${tableCell(entry.id)} | ${tableCell(entry.result)} | ${tableCell(entry.source)} | ${tableCell(entry.text)} | ${tableCell(display(entry.reason))} |`,
    )
    .join('\n');
  const checks =
    state.verification.checks.length === 0
      ? '_No Runtime checks were recorded._'
      : [
          '| Check | Command | Working directory | Status | Exit | Duration |',
          '| --- | --- | --- | --- | ---: | ---: |',
          ...state.verification.checks.map((check) => {
            const command = check.argv_display.map(display).join(' ');
            return `| ${tableCell(display(check.name))} | ${tableCell(command || '—')} | ${tableCell(check.cwd_ref)} | ${check.status} | ${check.exit_code ?? '—'} | ${check.duration_ms} ms |`;
          }),
        ].join('\n');
  const blockers =
    state.blockers.length === 0
      ? '_None._'
      : state.blockers
          .map(
            (blocker) =>
              `- **${blocker.owner}**: ${display(blocker.reason)}${
                blocker.acceptance_ids.length > 0
                  ? ` (acceptance: ${blocker.acceptance_ids.join(', ')})`
                  : ''
              } — next: \`${blocker.resolution_action}\``,
          )
          .join('\n');
  const risks =
    state.verification.risks.length === 0
      ? '_None reported._'
      : state.verification.risks.map((risk) => `- ${display(risk)}`).join('\n');
  const history =
    state.history.length === 0
      ? '_No previous iterations._'
      : [
          '| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |',
          '| ---: | ---: | ---: | --- | --- | --- | --- |',
          ...state.history.map(
            (entry) =>
              `| ${entry.goal_cycle} | ${entry.iteration} | ${entry.attempt} | ${entry.outcome} | ${entry.unresolved_ids.join(', ') || '—'} | ${tableCell(display(entry.summary))} | ${entry.completed_at} |`,
          ),
        ].join('\n');

  return `---
generated_from_state_version: ${state.state_version}
---

# Verification

## Current result

- Result: **${verdictLabel(state)}**
- Assurance: **${assuranceLabel(state)}**
- Goal cycle: ${state.loop.goal_cycle}
- Iteration: ${state.verification.iteration}
- Verifier attempt: ${state.verification.attempt}
- Completed: ${state.verification.completed_at}
- Summary: ${display(state.verification.summary)}

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
${acceptance}

## Checks

${checks}

## Blockers

${blockers}

## Risks and skipped work

${risks}

## Previous iterations

${history}

${
  state.history_overflow.dropped_entries > 0
    ? `Earlier history entries folded into summary: ${state.history_overflow.dropped_entries}.\n\n`
    : ''
}## Conclusion

${display(state.verification.summary)}
`;
}

export function nativeVerificationReportStateVersion(source: string): number | null {
  const match = /^---\r?\ngenerated_from_state_version: ([1-9]\d*)\r?\n---(?:\r?\n|$)/u.exec(
    source,
  );
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

export async function inspectNativeVerificationReportAlignment(options: {
  file: string;
  stateVersion: number;
}): Promise<'aligned' | 'missing' | 'stale' | 'invalid'> {
  let source: string;
  try {
    source = await fs.readFile(options.file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
  const version = nativeVerificationReportStateVersion(source);
  if (version === null) return 'invalid';
  return version === options.stateVersion ? 'aligned' : 'stale';
}

export async function writeNativeVerificationReport(options: {
  file: string;
  state: NativePortableState;
}): Promise<void> {
  await atomicWriteText(options.file, renderNativeVerificationReport(options.state));
}
