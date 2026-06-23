// Project summary cards across the top of the page.

import { formatTimestamp } from '../utils.js';

export function renderSummaryGrid({ snapshot }) {
  const s = snapshot.summary;

  document.getElementById('summaryActiveChanges').textContent = String(s.activeChanges);
  document.getElementById('summaryArchivedChanges').textContent = String(s.archivedChanges);

  renderVerifyFailedCard(snapshot, s.verifyFailed);
  renderTasksIncompleteCard(snapshot, s.tasksIncomplete);
  renderDirtyCard(s.dirtyFiles);

  document.getElementById('summaryBranch').textContent = snapshot.git.branch ?? '—';
  const head = snapshot.git.head ?? '—';
  document.getElementById('summaryHead').textContent = head.split(' ')[0];
  document.getElementById('summaryGeneratedAt').textContent =
    '生成于 ' + formatTimestamp(snapshot.project.generatedAt);
}

function renderVerifyFailedCard(snapshot, count) {
  const el = document.getElementById('summaryVerifyFailed');
  el.textContent = String(count);
  el.className = `summary-value ${count > 0 ? 'status-danger' : ''}`;
  document.getElementById('cardVerifyFailed').classList.toggle('is-danger', count > 0);

  const failedNames = (snapshot.changes.active ?? [])
    .filter((c) => c.verify.result === 'fail')
    .map((c) => c.name);
  document.getElementById('summaryVerifyNote').textContent =
    failedNames.length > 0 ? failedNames.join(', ') : '全部通过';
}

function renderTasksIncompleteCard(snapshot, count) {
  const el = document.getElementById('summaryTasksIncomplete');
  el.textContent = String(count);
  el.className = `summary-value ${count > 0 ? 'status-warn' : ''}`;
  document.getElementById('cardTasksIncomplete').classList.toggle('is-warn', count > 0);

  const incompleteChanges = (snapshot.changes.active ?? []).filter(
    (c) => c.tasks.total - c.tasks.completed > 0,
  ).length;
  document.getElementById('summaryTasksNote').textContent =
    count > 0 ? `跨 ${incompleteChanges} 个变更` : '无阻塞任务';
}

function renderDirtyCard(count) {
  const el = document.getElementById('summaryDirty');
  el.textContent = String(count);
  el.className = `summary-value ${count > 0 ? 'status-warn' : ''}`;
  document.getElementById('cardDirty').classList.toggle('is-warn', count > 0);
}
