import type { ClassicPhase, ClassicState } from './classic-state.js';

export const CLASSIC_TRANSITION_EVENTS = [
  'open-complete',
  'design-complete',
  'build-complete',
  'verify-pass',
  'verify-fail',
  'archive-confirm',
  'archive-reopen',
  'archived',
  'preset-escalate',
] as const;

export type ClassicTransitionEvent = (typeof CLASSIC_TRANSITION_EVENTS)[number];

export interface ClassicTransitionEffect {
  field: keyof ClassicState;
  from: unknown;
  to: unknown;
}

export interface ClassicTransitionDefinition {
  event: ClassicTransitionEvent;
  from: ClassicPhase;
  guardRefs: string[];
}

export interface ClassicTransitionResult {
  classic: ClassicState;
  effects: ClassicTransitionEffect[];
  definition: ClassicTransitionDefinition;
}

export const CLASSIC_TRANSITION_TABLE: Record<ClassicTransitionEvent, ClassicTransitionDefinition> =
  {
    'open-complete': {
      event: 'open-complete',
      from: 'open',
      guardRefs: ['open-artifacts-present'],
    },
    'design-complete': {
      event: 'design-complete',
      from: 'design',
      guardRefs: ['design-evidence-present'],
    },
    'build-complete': {
      event: 'build-complete',
      from: 'build',
      guardRefs: ['build-decisions-selected'],
    },
    'verify-pass': {
      event: 'verify-pass',
      from: 'verify',
      guardRefs: ['verification-report-present'],
    },
    'verify-fail': {
      event: 'verify-fail',
      from: 'verify',
      guardRefs: ['verification-failed'],
    },
    'archive-confirm': {
      event: 'archive-confirm',
      from: 'archive',
      guardRefs: ['archive-final-confirmation'],
    },
    'archive-reopen': {
      event: 'archive-reopen',
      from: 'archive',
      guardRefs: ['archive-not-finalized'],
    },
    archived: {
      event: 'archived',
      from: 'archive',
      guardRefs: ['verify-result-pass', 'archive-confirmed'],
    },
    'preset-escalate': {
      event: 'preset-escalate',
      from: 'build',
      guardRefs: ['preset-workflow'],
    },
  };

export const CLASSIC_GUARD_TRANSITION_EVENT: Partial<Record<ClassicPhase, ClassicTransitionEvent>> =
  {
    open: 'open-complete',
    design: 'design-complete',
    build: 'build-complete',
    verify: 'verify-pass',
  };

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function setField<K extends keyof ClassicState>(
  classic: ClassicState,
  effects: ClassicTransitionEffect[],
  field: K,
  value: ClassicState[K],
): void {
  const from = classic[field];
  classic[field] = value;
  if (from !== value) effects.push({ field, from, to: value });
}

export function applyClassicTransition(
  current: ClassicState,
  event: ClassicTransitionEvent,
  options: { now?: Date } = {},
): ClassicTransitionResult {
  const definition = CLASSIC_TRANSITION_TABLE[event];
  if (current.phase !== definition.from) {
    throw new Error(
      `Cannot apply ${event}: phase is '${current.phase}', expected '${definition.from}'`,
    );
  }

  const classic: ClassicState = { ...current };
  const effects: ClassicTransitionEffect[] = [];
  const now = options.now ?? new Date();

  if (event === 'open-complete') {
    setField(classic, effects, 'phase', classic.workflow === 'full' ? 'design' : 'build');
  } else if (event === 'design-complete') {
    setField(classic, effects, 'phase', 'build');
  } else if (event === 'build-complete') {
    const preserveEvidence = classic.verifyResult === 'fail';
    setField(classic, effects, 'phase', 'verify');
    setField(classic, effects, 'verifyResult', 'pending');
    setField(classic, effects, 'branchStatus', 'pending');
    if (!preserveEvidence) {
      setField(classic, effects, 'verificationReport', null);
    }
  } else if (event === 'verify-pass') {
    setField(classic, effects, 'verifyResult', 'pass');
    setField(classic, effects, 'verifyFailures', 0);
    setField(classic, effects, 'phase', 'archive');
    setField(classic, effects, 'verifiedAt', dateOnly(now));
    setField(classic, effects, 'archiveConfirmation', 'pending');
    setField(classic, effects, 'branchStatus', 'pending');
  } else if (event === 'verify-fail') {
    setField(classic, effects, 'verifyResult', 'fail');
    setField(classic, effects, 'verifyFailures', classic.verifyFailures + 1);
    setField(classic, effects, 'phase', 'build');
    setField(classic, effects, 'branchStatus', 'pending');
  } else if (event === 'preset-escalate') {
    if (classic.workflow !== 'hotfix' && classic.workflow !== 'tweak') {
      throw new Error(
        `Cannot apply ${event}: workflow must be hotfix or tweak, got '${classic.workflow}'`,
      );
    }
    setField(classic, effects, 'workflow', 'full');
    setField(classic, effects, 'classicProfile', 'full');
    setField(classic, effects, 'phase', 'design');
    setField(classic, effects, 'designDoc', null);
    setField(classic, effects, 'buildPause', null);
    setField(classic, effects, 'buildMode', null);
    setField(classic, effects, 'subagentDispatch', null);
    setField(classic, effects, 'tddMode', null);
    setField(classic, effects, 'reviewMode', null);
    setField(classic, effects, 'isolation', null);
    setField(classic, effects, 'verifyMode', null);
    setField(classic, effects, 'directOverride', null);
  } else if (event === 'archive-confirm') {
    if (classic.verifyResult !== 'pass') {
      throw new Error(`Cannot apply ${event}: verifyResult must be pass`);
    }
    if (classic.archived) throw new Error(`Cannot apply ${event}: already archived`);
    setField(classic, effects, 'archiveConfirmation', 'confirmed');
  } else if (event === 'archive-reopen') {
    if (classic.archived) throw new Error(`Cannot apply ${event}: already archived`);
    setField(classic, effects, 'verifyResult', 'pending');
    setField(classic, effects, 'verifyFailures', 0);
    setField(classic, effects, 'phase', 'verify');
    setField(classic, effects, 'verifiedAt', null);
    setField(classic, effects, 'archiveConfirmation', null);
    setField(classic, effects, 'branchStatus', 'pending');
  } else {
    if (classic.verifyResult !== 'pass') {
      throw new Error(`Cannot apply ${event}: verifyResult must be pass`);
    }
    if (classic.archiveConfirmation !== 'confirmed') {
      throw new Error(`Cannot apply ${event}: archiveConfirmation must be confirmed`);
    }
    setField(classic, effects, 'archived', true);
  }

  return { classic, effects, definition };
}
