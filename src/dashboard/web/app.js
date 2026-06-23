// Comet Dashboard frontend entry.
//
// Fetches /api/dashboard, owns the top-level state (selectedId / activeTab /
// snapshot), and delegates the DOM work to the small components in
// ./components/. Each component owns a subtree by id reference — there is no
// virtual DOM, just functions that produce HTML.

import {
  applySnapshot,
  getSelected,
  getState,
  getVisibleChanges,
  selectChange,
  setActiveTab,
  setLoading,
} from './state.js';
import { renderTopbar } from './components/topbar.js';
import { renderSummaryGrid } from './components/summary-grid.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderChangesExplorer } from './components/changes-explorer.js';
import { renderSelectedDetail } from './components/selected-detail.js';
import { renderSidePanel } from './components/side-panel.js';

document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  bindRefresh();
  bindKeyboardNav();
  void loadSnapshot();
});

function bindTabs() {
  document.querySelectorAll('.changes-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      // Tabs filter the list view only — never re-target the selection.
      setActiveTab(tab.dataset.tab);
      renderAll();
    });
  });
}

function bindRefresh() {
  document.getElementById('refreshButton').addEventListener('click', () => {
    void loadSnapshot(true);
  });
}

function bindKeyboardNav() {
  const tabs = Array.from(document.querySelectorAll('.changes-tab'));
  tabs.forEach((tab, idx) => {
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const dir = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(idx + dir + tabs.length) % tabs.length];
      next.focus();
      setActiveTab(next.dataset.tab);
      renderAll();
    });
  });
}

async function loadSnapshot(manual = false) {
  const button = document.getElementById('refreshButton');
  const label = document.getElementById('refreshLabel');
  setLoading(true);
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  label.textContent = '刷新中';

  try {
    const res = await fetch('/api/dashboard', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snapshot = await res.json();
    applySnapshot(snapshot);
    renderAll();
    if (manual) {
      const selected = getSelected();
      const note = selected ? `状态已刷新，仍选中 ${selected.name}` : '状态已刷新';
      showToast(note);
    }
  } catch (error) {
    showToast(`刷新失败：${error.message}`);
  } finally {
    setLoading(false);
    button.setAttribute('aria-busy', 'false');
    button.disabled = false;
    label.textContent = '刷新状态';
  }
}

function renderAll() {
  const { snapshot, selectedId, activeTab } = getState();
  if (!snapshot) return;

  const selected = getSelected();

  renderTopbar({ project: snapshot.project, selected });
  renderSummaryGrid({ snapshot });
  renderEmptyState({ snapshot });
  renderChangesExplorer({
    visible: getVisibleChanges(),
    selectedId,
    activeTab,
    onSelect: handleCardClick,
  });

  const detailPanel = document.getElementById('detailPanel');
  const sidePanel = document.getElementById('sidePanel');
  if (!selected) {
    detailPanel.hidden = true;
    sidePanel.hidden = true;
    return;
  }
  detailPanel.hidden = false;
  sidePanel.hidden = false;

  renderSelectedDetail({ change: selected });
  renderSidePanel({ change: selected, git: snapshot.git });
  announceSelection(selected);
}

function handleCardClick(id) {
  selectChange(id);
  renderAll();
}

function announceSelection(change) {
  document.getElementById('selectedAnnounce').textContent = `已选中 ${change.displayName}`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2200);
}
