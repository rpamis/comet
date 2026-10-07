import { describe, expect, it } from 'vitest';
import {
  CLI_OUTPUT_MARKERS,
  cliHumanTextViolations,
  cliNextHintLine,
  formatCliErrorEnvelope,
  formatCliOutputEnvelope,
  isCliOutputEnvelope,
  projectCliAgentObservation,
} from '../../../domains/workflow-contract/output-envelope.js';

describe('output envelope contract', () => {
  it('projects current action and prepared cwd without copying evidence payloads', () => {
    const observation = projectCliAgentObservation(
      {
        state: { phase: 'build', status: 'active', state_version: 3 },
        preparation: { projectRoot: '/prepared' },
        workspace: { isolation: 'worktree', change_branch: 'comet/change' },
        continuation: { commandArgs: ['comet', 'native', 'next', 'change'] },
        evidence: 'large evidence payload',
      },
      '/original',
    );
    expect(observation).toEqual({
      phase: 'build',
      status: 'active',
      stateVersion: 3,
      workspace: { cwd: '/prepared' },
      continuation: { commandArgs: ['comet', 'native', 'next', 'change'], cwd: '/prepared' },
    });
  });

  it('renders a summary-only envelope as one line', () => {
    expect(formatCliOutputEnvelope({ summary: 'Done.' })).toBe('Done.\n');
  });

  it('projects Classic SDK nextAction and current Run identity without copying the Run payload', () => {
    const nextAction = {
      kind: 'action',
      actionId: 'current-action',
      attempt: 2,
      inputHash: 'current-input',
      stepId: 'full.build.execute',
    };
    expect(
      projectCliAgentObservation({
        phase: 'build',
        run: {
          id: 'change',
          revision: 17,
          status: 'running',
          actions: [{ id: 'large-action-payload' }],
          evidenceWaits: [{ artifact: 'large-evidence-payload' }],
        },
        nextAction,
      }),
    ).toEqual({
      phase: 'build',
      status: 'running',
      stateVersion: null,
      workspace: { cwd: null },
      continuation: { ...nextAction, cwd: null },
      run: { id: 'change', revision: 17, status: 'running' },
    });
  });

  it('preserves explicit continuation, workflow state version, and prepared workspace precedence', () => {
    const result = projectCliAgentObservation(
      {
        state: { phase: 'verify', status: 'active', stateVersion: 3 },
        run: { id: 'change', revision: 19, status: 'waiting' },
        continuation: { commandArgs: ['comet', 'native', 'next', 'change'], cwd: '/hint' },
        nextAction: { kind: 'must-not-replace-continuation' },
        preparation: { projectRoot: '/prepared' },
      },
      '/invocation',
    );
    expect(result).toMatchObject({
      phase: 'verify',
      status: 'active',
      stateVersion: 3,
      run: { revision: 19, status: 'waiting' },
      workspace: { cwd: '/prepared' },
      continuation: { commandArgs: ['comet', 'native', 'next', 'change'], cwd: '/prepared' },
    });
    expect(result.continuation).not.toHaveProperty('kind');
  });

  it('uses the supplied continuation cwd when there is no prepared or invocation cwd', () => {
    expect(
      projectCliAgentObservation({ entry: { nextAction: { kind: 'decision', cwd: '/selected' } } }),
    ).toMatchObject({
      workspace: { cwd: '/selected' },
      continuation: { kind: 'decision', cwd: '/selected' },
    });
  });

  it('renders the NEXT marker before the relay block', () => {
    const text = formatCliOutputEnvelope({
      summary: 'Verification paused.',
      next: { ask_user: 'Ask the user how to continue.' },
      user_message: 'Verification is paused. Reply "Continue" to retry.',
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Verification paused.');
    expect(lines[1]).toBe(`${CLI_OUTPUT_MARKERS.next} Ask the user how to continue.`);
    expect(lines).toContain(CLI_OUTPUT_MARKERS.relay);
    expect(text).toContain('Verification is paused. Reply "Continue" to retry.');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('prefers a command hint over an ask_user hint', () => {
    expect(cliNextHintLine({ command: 'comet native next x --confirmed' })).toBe(
      'NEXT: comet native next x --confirmed',
    );
    expect(cliNextHintLine({})).toBeNull();
    expect(cliNextHintLine(undefined)).toBeNull();
  });

  it('appends the machine projection only when verbose details are provided', () => {
    const quiet = formatCliOutputEnvelope({ summary: 'Ok.' });
    expect(quiet).not.toContain(CLI_OUTPUT_MARKERS.details);
    const verbose = formatCliOutputEnvelope({ summary: 'Ok.' }, { stateVersion: 7 });
    expect(verbose).toContain(CLI_OUTPUT_MARKERS.details);
    expect(verbose).toContain('"stateVersion": 7');
  });

  it('keeps the machine detail line in error envelopes', () => {
    const text = formatCliErrorEnvelope(
      {
        summary: 'The change was updated elsewhere.',
        next: { command: 'comet native status x --json' },
      },
      'NativeChangeRevisionConflictError: expected 7, got 8',
    );
    expect(text.split('\n')[0]).toBe('The change was updated elsewhere.');
    expect(text).toContain('NEXT: comet native status x --json');
    expect(text).toContain('DETAIL: NativeChangeRevisionConflictError: expected 7, got 8');
  });

  it('reports denylist fragments found in human text', () => {
    expect(
      cliHumanTextViolations('the stateVersion drifted', [/\bstate[_ ]?versions?\b/iu]),
    ).toEqual(['stateVersion']);
    expect(cliHumanTextViolations('all good', [/\bverify_mode\b/iu])).toEqual([]);
  });

  it('validates envelope shapes', () => {
    expect(isCliOutputEnvelope({ summary: 'ok' })).toBe(true);
    expect(isCliOutputEnvelope({ summary: 'ok', next: { command: 'x' } })).toBe(true);
    expect(isCliOutputEnvelope({ summary: 'ok', next: { command: 'x', ask_user: 'ask' } })).toBe(
      false,
    );
    expect(isCliOutputEnvelope({ summary: 'ok', user_message: 'm' })).toBe(true);
    expect(isCliOutputEnvelope({})).toBe(false);
    expect(isCliOutputEnvelope({ summary: '' })).toBe(false);
    expect(isCliOutputEnvelope({ summary: 'ok', next: { command: 3 } })).toBe(false);
    expect(isCliOutputEnvelope({ summary: 'ok', user_message: null })).toBe(false);
  });
});
