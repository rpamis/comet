// Phase Progress: 5 lifecycle phases with done / current / pending / failed / unknown.

import { escape } from '../utils.js';
import { PHASE_INDEX, PHASE_LABELS, PHASE_ORDER, STATE_GLYPH, STATE_TEXT } from './constants.js';

export function renderPhaseProgress({ change }) {
  const phases = computePhaseStates(change);
  document.getElementById('phaseTrack').innerHTML = phases.map(renderPhaseStep).join('');

  const cmdLabel =
    change.status === 'archived' ? `归档 ${change.phase}` : `下一步 ${change.next?.command ?? '—'}`;
  document.getElementById('phaseCommand').textContent = cmdLabel;
}

function renderPhaseStep({ label, state }) {
  return `
    <div class="phase ${state}" role="listitem" aria-label="${escape(label)}: ${STATE_TEXT[state] ?? state}">
      <div class="phase-icon" aria-hidden="true">${STATE_GLYPH[state] ?? '?'}</div>
      <div class="phase-name">${escape(label)}</div>
      <div class="phase-state">${escape(STATE_TEXT[state] ?? state)}</div>
    </div>
  `;
}

export function computePhaseStates(change) {
  const phases = PHASE_ORDER.map((name) => ({
    name,
    label: PHASE_LABELS[name],
    state: 'pending',
  }));

  if (change.status === 'archived') {
    phases.forEach((p) => {
      p.state = 'done';
    });
    if (change.verify.result === 'fail') {
      phases[PHASE_INDEX.verify].state = 'failed';
    }
    return phases;
  }

  if (change.phase === 'unknown') {
    phases.forEach((p) => {
      p.state = 'unknown';
    });
    return phases;
  }

  const currentIdx = PHASE_INDEX[change.phase] ?? -1;
  if (currentIdx === -1) return phases;

  for (let i = 0; i < currentIdx; i += 1) phases[i].state = 'done';
  phases[currentIdx].state = 'current';

  if (change.verify.result === 'fail' && currentIdx >= PHASE_INDEX.verify) {
    phases[PHASE_INDEX.verify].state = 'failed';
  }

  return phases;
}
