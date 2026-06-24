// Changes Explorer panel: tabs + change list.

import { escape } from '../utils.js';
import { renderChangeCard } from './change-card.js';

export function renderChangesExplorer({ visible, selectedId, activeTab, onSelect }) {
  const list = document.getElementById('changeList');
  document.getElementById('explorerCountPill').textContent = `${visible.length} 个`;

  syncTabAria(activeTab, list);

  if (visible.length === 0) {
    list.innerHTML = renderEmptyList(activeTab);
    return;
  }

  list.innerHTML = visible.map((change) => renderChangeCard({ change, selectedId })).join('');

  list.querySelectorAll('.change-card').forEach((card) => {
    card.addEventListener('click', () => {
      onSelect(card.dataset.id);
    });
  });
}

function syncTabAria(activeTab, list) {
  document.querySelectorAll('.changes-tab').forEach((tab) => {
    const selected = tab.dataset.tab === activeTab;
    tab.setAttribute('aria-selected', String(selected));
    if (selected) list.setAttribute('aria-labelledby', tab.id);
  });
}

function renderEmptyList(activeTab) {
  const [title, copy] =
    activeTab === 'archived'
      ? ['暂无归档迭代', 'No archived Comet changes found in this repository.']
      : activeTab === 'active'
        ? ['当前无活跃迭代', 'No active Comet changes found in this repository.']
        : ['当前无 Comet 迭代', 'No Comet changes found in this repository.'];
  return `
    <div class="list-empty" data-component="EmptyState">
      <strong>${escape(title)}</strong>
      <span lang="en">${escape(copy)}</span>
    </div>
  `;
}
