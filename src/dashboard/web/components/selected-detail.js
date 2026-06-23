// Selected change detail (middle column).

import { escape } from '../utils.js';
import { renderArtifactChecklist } from './artifact-checklist.js';
import { renderPhaseProgress } from './phase-progress.js';
import { renderTaskProgress } from './task-progress.js';
import { VERIFY_CLASS } from './constants.js';

export function renderSelectedDetail({ change }) {
  renderSelectedHeader(change);
  renderPhaseProgress({ change });
  renderArtifactChecklist({
    artifacts: change.artifacts,
    containerId: 'artifactList',
    statusId: 'artifactStatus',
    labelTemplate: (ready, total) => `${ready} / ${total} 已就绪`,
  });
  renderTaskProgress({ change });
}

function renderSelectedHeader(change) {
  document.getElementById('selectedName').textContent = change.displayName;
  document.getElementById('selectedSubline').textContent =
    change.status === 'archived'
      ? `最终阶段: ${change.phase} · 任务: ${change.tasks.completed} / ${change.tasks.total}`
      : `阶段: ${change.phase} · 任务: ${change.tasks.completed} / ${change.tasks.total}`;

  document.getElementById('selectedMeta').innerHTML =
    change.status === 'archived'
      ? `
          <span class="pill status-ok" data-component="ChangeStatusBadge">Status: Archived</span>
          <span class="pill mono">Archived At: ${escape(change.archive?.archivedAt ?? '—')}</span>
          <span class="pill mono">Archive Path: ${escape(change.archive?.archivePath ?? change.path)}</span>
        `
      : '<span class="pill status-current" data-component="ChangeStatusBadge">Status: Active</span>';

  const badge = document.getElementById('selectedBadge');
  badge.className = `pill ${badgeClassFor(change)}`;
  badge.innerHTML = `<span class="dot"></span>${change.status === 'archived' ? 'Archived' : 'Active'}`;
}

function badgeClassFor(change) {
  if (change.status === 'archived') return 'status-ok';
  if (change.verify.result === 'fail') return 'status-danger';
  if (change.verify.result === 'pending') return 'status-current';
  return VERIFY_CLASS[change.verify.result] ?? 'status-ok';
}
