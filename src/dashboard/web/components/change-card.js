// Single change card (active or archived).

import { classes, escape } from '../utils.js';
import { VERIFY_CLASS, VERIFY_LABEL } from './constants.js';

export function renderChangeCard({ change, selectedId }) {
  const isSelected = change.id === selectedId;
  const isArchived = change.status === 'archived';
  const isDanger = change.verify.result === 'fail';
  const percent = change.tasks.total
    ? Math.round((change.tasks.completed / change.tasks.total) * 100)
    : 0;
  const progressClass = progressClassFor(change);
  const riskLabel = describeRiskLabel(change);
  const riskClass = describeRiskClass(change);
  const verifyLabel = VERIFY_LABEL[change.verify.result] ?? '未知';
  const verifyClass = VERIFY_CLASS[change.verify.result] ?? 'status-muted';
  const componentName = isArchived ? 'ArchivedChangeCard' : 'ChangeCard';

  const metaRows = isArchived ? renderArchivedMeta(change) : renderActiveMeta(change);

  return `
    <button
      class="${classes('change-card', isSelected && 'is-active', isDanger && 'is-danger', isArchived && 'is-archived')}"
      data-id="${escape(change.id)}"
      data-component="${componentName}"
      type="button"
      aria-pressed="${isSelected}"
    >
      <div class="change-head">
        <div class="change-name">${escape(change.displayName)}</div>
        <div class="change-badges">
          ${isSelected ? '<span class="pill status-current" data-component="StatusBadge">已选中</span>' : ''}
          <span class="pill ${isArchived ? 'status-ok' : 'status-current'}" data-component="ChangeStatusBadge">${change.status}</span>
          <span class="pill ${riskClass}" data-component="StatusBadge">${escape(riskLabel)}</span>
        </div>
      </div>
      <div class="change-meta">
        <span>验证</span><strong class="${verifyClass} mono">${escape(verifyLabel)}</strong>
        ${metaRows}
      </div>
      <div
        class="progress-track"
        style="margin-top:12px;"
        role="progressbar"
        aria-label="${escape(change.name)} 任务完成进度"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="${percent}"
      >
        <div class="progress-bar ${progressClass}" style="--value:${percent}%"></div>
      </div>
    </button>
  `;
}

function renderActiveMeta(change) {
  return `
    <span>状态</span><strong class="mono">active</strong>
    <span>阶段</span><strong class="mono">${escape(change.phase)}</strong>
    <span>任务</span><strong class="mono">${change.tasks.completed} / ${change.tasks.total}</strong>
    <span>下一步</span><strong class="mono">${escape(change.next?.command ?? '—')}</strong>
  `;
}

function renderArchivedMeta(change) {
  return `
    <span>状态</span><strong class="mono">archived</strong>
    <span>最终阶段</span><strong class="mono">${escape(change.phase)}</strong>
    <span>任务</span><strong class="mono">${change.tasks.completed} / ${change.tasks.total}</strong>
    <span>归档于</span><strong class="mono">${escape(change.archive?.archivedAt ?? '—')}</strong>
  `;
}

export function describeRiskLabel(change) {
  if (change.verify.result === 'fail' || change.risks.some((r) => r.level === 'error')) {
    return '错误';
  }
  const warnings = change.risks.filter((r) => r.level === 'warning').length;
  if (warnings > 0) return `${warnings} 警告`;
  if (change.status === 'archived') return '已归档';
  return '健康';
}

export function describeRiskClass(change) {
  if (change.verify.result === 'fail' || change.risks.some((r) => r.level === 'error')) {
    return 'status-danger';
  }
  if (change.risks.some((r) => r.level === 'warning')) return 'status-warn';
  return 'status-ok';
}

export function progressClassFor(change) {
  if (change.verify.result === 'fail') return 'is-danger';
  if (change.tasks.total > 0 && change.tasks.completed < change.tasks.total) return 'is-warn';
  if (change.verify.result === 'pass' || change.tasks.total === change.tasks.completed) {
    return 'is-ok';
  }
  return '';
}
