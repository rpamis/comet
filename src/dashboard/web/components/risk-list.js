// Risk list — collapsible items, level-based color.

import { escape } from '../utils.js';

export function renderRiskList({ risks, containerId = 'riskList', countPillId = 'riskCount' }) {
  const countPill = document.getElementById(countPillId);
  countPill.className = 'pill';
  countPill.textContent = `${risks.length} 项`;

  const list = document.getElementById(containerId);
  if (risks.length === 0) {
    list.innerHTML = '<div class="muted">暂无风险。</div>';
    return;
  }

  list.innerHTML = risks.map(renderRiskItem).join('');
  list.querySelectorAll('.risk-trigger').forEach(bindToggle);
}

function renderRiskItem(risk, index) {
  const cls =
    risk.level === 'error'
      ? 'status-danger'
      : risk.level === 'warning'
        ? 'status-warn'
        : 'status-info';
  const label = risk.level === 'error' ? '错误' : risk.level === 'warning' ? '警告' : '信息';
  const triggerId = `risk-trigger-${index}`;
  const detailId = `risk-detail-${index}`;
  return `
    <div class="risk-item" data-component="RiskItem">
      <button
        class="risk-trigger"
        id="${triggerId}"
        type="button"
        aria-expanded="false"
        aria-controls="${detailId}"
      >
        <span class="pill ${cls}">${label}</span>
        <span>
          <span class="risk-code">${escape(risk.code)}</span>
          <span class="risk-message">${escape(risk.message)}</span>
        </span>
        <span class="chevron">›</span>
      </button>
      <div class="risk-detail" id="${detailId}" role="region" aria-labelledby="${triggerId}">
        ${escape(risk.suggestion ?? '暂无建议。')}
      </div>
    </div>
  `;
}

function bindToggle(trigger) {
  trigger.addEventListener('click', () => {
    const item = trigger.closest('.risk-item');
    const open = !item.classList.contains('is-open');
    item.classList.toggle('is-open', open);
    trigger.setAttribute('aria-expanded', String(open));
  });
}
