export function refreshDashboardPage(existing, fresh) {
  if (!existing) return fresh;

  const existingHead = existing.items.slice(0, fresh.items.length).map((item) => item.id);
  const freshIds = fresh.items.map((item) => item.id);
  if (existing.total !== fresh.total || existingHead.length !== freshIds.length) return fresh;
  if (!existingHead.every((id, index) => id === freshIds[index])) return fresh;

  const freshById = new Map(fresh.items.map((item) => [item.id, item]));
  return {
    ...existing,
    items: existing.items.map((item) => freshById.get(item.id) ?? item),
  };
}

export function nativeDashboardChangeKey(change) {
  return `${change.status}:${change.archiveName ?? ''}:${change.name}`;
}

export function refreshNativeDashboardPage(existing, fresh) {
  if (!existing) return fresh;

  const existingHead = existing.items.slice(0, fresh.items.length).map(nativeDashboardChangeKey);
  const freshKeys = fresh.items.map(nativeDashboardChangeKey);
  if (existing.total !== fresh.total || existingHead.length !== freshKeys.length) return fresh;
  if (!existingHead.every((key, index) => key === freshKeys[index])) return fresh;

  const freshByKey = new Map(fresh.items.map((item) => [nativeDashboardChangeKey(item), item]));
  return {
    ...existing,
    items: existing.items.map((item) => freshByKey.get(nativeDashboardChangeKey(item)) ?? item),
  };
}

export function isStaleNativeDashboardCursorError(error) {
  return error instanceof Error && error.message === 'Stale Native Dashboard change cursor';
}

export async function dashboardResponseError(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return new Error(payload.error);
    }
  } catch {
    // Fall back to the HTTP status when the server did not return its JSON error envelope.
  }
  return new Error(`HTTP ${response.status}`);
}

export function shouldAutoLoadDashboardDetail({
  detailLoading,
  selectedId,
  selectedDetailId,
  visibleIds,
  failedDetailId,
}) {
  if (detailLoading || !selectedId || failedDetailId === selectedId) return false;
  return !(selectedDetailId === selectedId && visibleIds.includes(selectedId));
}

export function shouldShowDashboardDetailLoading({
  detailLoading,
  selectedId,
  selectedDetailId,
  failedDetailId,
}) {
  if (failedDetailId && failedDetailId === selectedId) return false;
  return detailLoading || Boolean(selectedId && !selectedDetailId);
}
