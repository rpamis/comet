// Archive summary card for archived selected changes — replaces the
// NextActionCard slot when status === 'archived'.

import { escape } from '../utils.js';

export function renderArchiveSummaryCard({ change }) {
  const primary = document.getElementById('rightPrimary');
  primary.dataset.component = 'ArchiveSummaryCard';
  primary.className = 'card command-card archive-card';

  document.getElementById('rightPrimaryTitle').textContent = '归档摘要';
  const phasePill = document.getElementById('actionPhase');
  phasePill.className = 'pill status-ok';
  phasePill.textContent = 'Archived';

  document.getElementById('primaryCommandLine').innerHTML =
    `<span class="mono">${escape(change.archive?.archiveName ?? change.name)}</span>`;
  document.getElementById('nextReason').textContent =
    `Original Change: ${change.archive?.originalName ?? change.name}` +
    ` · Archived At: ${change.archive?.archivedAt ?? '—'}`;
  document.getElementById('nextInstruction').textContent =
    `Archive Path: ${change.archive?.archivePath ?? change.path}` +
    ` · Final Tasks: ${change.tasks.completed} / ${change.tasks.total}`;
}
