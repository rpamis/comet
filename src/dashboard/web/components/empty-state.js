// Project-wide empty state — shown when there are 0 active + 0 archived
// changes. The list-empty fallback inside ChangesExplorer covers tab-level
// emptiness.

export function renderEmptyState({ snapshot }) {
  const total = (snapshot.changes.active?.length ?? 0) + (snapshot.changes.archived?.length ?? 0);
  const isEmpty = total === 0;
  document.getElementById('dashboardGrid').classList.toggle('is-empty', isEmpty);
  const empty = document.getElementById('emptyState');
  empty.hidden = !isEmpty;
  if (isEmpty) {
    document.getElementById('emptyTitle').textContent = '当前无 Comet 迭代';
    const copy = document.getElementById('emptyCopy');
    copy.textContent = 'No Comet changes found in this repository.';
    copy.lang = 'en';
  }
}
