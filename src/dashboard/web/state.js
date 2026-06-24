// State shape + reducers. No DOM, no fetch — easy to reason about.

const VALID_TABS = new Set(['active', 'archived', 'all']);

const state = {
  snapshot: null,
  selectedId: null,
  activeTab: 'active',
  loading: false,
};

export function getState() {
  return state;
}

export function setLoading(loading) {
  state.loading = loading;
}

export function setActiveTab(tab) {
  // Tabs are driven by DOM `data-tab` attributes, but we clamp here so a typo
  // or stray injection cannot put the UI into an unknown branch.
  state.activeTab = VALID_TABS.has(tab) ? tab : 'active';
}

export function selectChange(id) {
  state.selectedId = id;
}

/**
 * Apply a freshly-fetched snapshot. Preserves the previous selectedId if the
 * change still exists; otherwise falls back to the default rule:
 *   active first, else first archived, else null.
 *
 * The default rule is intentionally independent of `activeTab` — switching
 * tabs is a filter on the list view, never a re-selection signal.
 */
export function applySnapshot(snapshot) {
  state.snapshot = snapshot;
  state.selectedId = pickSelectedId(snapshot, state.selectedId);
}

export function pickSelectedId(snapshot, previousId) {
  const active = snapshot.changes.active ?? [];
  const archived = snapshot.changes.archived ?? [];
  const allIds = new Set([...active, ...archived].map((c) => c.id));

  if (previousId && allIds.has(previousId)) return previousId;
  if (active[0]) return active[0].id;
  if (archived[0]) return archived[0].id;
  return null;
}

export function getSelected() {
  if (!state.snapshot || !state.selectedId) return null;
  const all = [
    ...(state.snapshot.changes.active ?? []),
    ...(state.snapshot.changes.archived ?? []),
  ];
  return all.find((c) => c.id === state.selectedId) ?? null;
}

export function getVisibleChanges() {
  if (!state.snapshot) return [];
  const { active, archived } = state.snapshot.changes;
  if (state.activeTab === 'active') return active ?? [];
  if (state.activeTab === 'archived') return archived ?? [];
  return [...(active ?? []), ...(archived ?? [])];
}
