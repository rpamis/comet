// Next Action card for active selected changes.

import { escape } from '../utils.js';
import { PHASE_LABELS } from './constants.js';

export function renderNextActionCard({ change }) {
  const primary = document.getElementById('rightPrimary');
  primary.dataset.component = 'NextActionCard';
  const variant =
    change.verify.result === 'fail'
      ? 'is-danger'
      : change.tasks.total > change.tasks.completed
        ? 'is-warn'
        : '';
  primary.className = `card command-card ${variant}`;

  document.getElementById('rightPrimaryTitle').textContent = '下一步建议';
  const phasePill = document.getElementById('actionPhase');
  phasePill.className = 'pill status-current';
  phasePill.textContent = PHASE_LABELS[change.phase] ?? '未知';

  document.getElementById('primaryCommandLine').innerHTML =
    `<span id="nextCommand">${escape(change.next?.command ?? '—')}</span>`;
  document.getElementById('nextReason').textContent = change.next?.reason ?? '';
  document.getElementById('nextInstruction').textContent = change.next?.description ?? '';
}
