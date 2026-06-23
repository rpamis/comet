// Task progress card + task section table + remaining-task list.

import { escape } from '../utils.js';
import { SECTION_STATUS_CLASS, STATE_GLYPH, STATE_TEXT } from './constants.js';
import { progressClassFor } from './change-card.js';

export function renderTaskProgress({ change }) {
  const percent = change.tasks.total
    ? Math.round((change.tasks.completed / change.tasks.total) * 100)
    : 0;

  document.getElementById('taskPercent').textContent = `${percent}%`;
  const bar = document.getElementById('taskProgressBar');
  bar.style.setProperty('--value', `${percent}%`);
  bar.className = `progress-bar ${progressClassFor(change)}`;
  document.getElementById('taskProgressTrack').setAttribute('aria-valuenow', String(percent));

  renderTaskStats(change, percent);
  renderTaskTable(change);
  renderRemainingTasks(change);
}

function renderTaskStats(change, percent) {
  const remaining = change.tasks.total - change.tasks.completed;
  const stats = [
    ['总数', change.tasks.total],
    ['已完成', change.tasks.completed],
    ['剩余', remaining],
    ['进度', `${percent}%`],
  ];
  document.getElementById('taskStats').innerHTML = stats
    .map(
      ([label, value]) => `
        <div class="task-stat">
          <div class="label">${escape(label)}</div>
          <strong>${escape(String(value))}</strong>
        </div>
      `,
    )
    .join('');
}

function renderTaskTable(change) {
  const headerRow =
    '<div class="table-row header"><span>分组</span><span>完成</span><span>状态</span></div>';

  const body = change.tasks.sections.length
    ? change.tasks.sections.map(renderTaskSectionRow).join('')
    : '<div class="table-row"><span class="muted">暂无任务分组</span><span></span><span></span></div>';

  document.getElementById('taskTable').innerHTML = headerRow + body;
}

function renderTaskSectionRow(section) {
  const cls = SECTION_STATUS_CLASS[section.status] ?? 'status-muted';
  const glyph =
    section.status === 'active'
      ? STATE_GLYPH.current
      : (STATE_GLYPH[section.status] ?? STATE_GLYPH.pending);
  const label =
    section.status === 'active'
      ? STATE_TEXT.current
      : (STATE_TEXT[section.status] ?? STATE_TEXT.pending);
  return `
    <div class="table-row">
      <strong>${escape(section.title)}</strong>
      <span class="mono">${section.completed} / ${section.total}</span>
      <span class="pill ${cls}">${glyph} ${escape(label)}</span>
    </div>
  `;
}

function renderRemainingTasks(change) {
  const list = document.getElementById('remainingTasks');
  if (change.tasks.incomplete.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = change.tasks.incomplete
    .slice(0, 12)
    .map((task) => `<li>${escape(task)}</li>`)
    .join('');
}
