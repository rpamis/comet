import { dashboardResponseError } from './dashboard-web-state.js';

export function groupApplicationRuns(items) {
  const groups = new Map();
  for (const run of items) {
    const id = run.applicationId ?? run.application?.id;
    const key = id ? `application:${id}` : `creation:${run.locator}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        id: id ?? null,
        title: id ?? run.goal ?? run.title,
        base: run.application?.base ?? null,
        records: [],
      });
    groups.get(key).records.push(run);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    creators: group.records.filter((r) => r.kind === 'creator'),
    runs: group.records.filter((r) => r.kind === 'application' && !r.isChild),
    children: group.records.filter((r) => r.kind === 'application' && r.isChild),
    versions: [...new Set(group.records.map((r) => r.application?.version).filter(Boolean))],
  }));
}
export function groupApplicationSteps(records) {
  const groups = new Map();
  for (const record of records) {
    const key = record.stepId;
    if (!groups.has(key))
      groups.set(key, { stepId: key, title: record.title, phase: record.phase, records: [] });
    groups.get(key).records.push(record);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    current: g.records.filter((r) => r.active).at(-1) ?? g.records.at(-1),
  }));
}
export function initialApplicationRecord(detail) {
  const current = detail?.records?.filter((r) => detail.currentIds?.includes(r.id)) ?? [];
  return (
    ['unknown', 'failed', 'waiting', 'evidence', 'running', 'child', 'pending']
      .map((s) => current.find((r) => r.status === s))
      .find(Boolean) ??
    detail?.records?.at(-1) ??
    null
  );
}
export function refreshApplicationRunPage(previous, next) {
  if (!previous?.fingerprint || previous.fingerprint !== next.fingerprint) return next;
  return { ...mergeApplicationRunPages(previous, next), nextCursor: previous.nextCursor };
}
export function mergeApplicationRunPages(previous, next) {
  if (!previous || !previous.fingerprint || previous.fingerprint !== next.fingerprint)
    return previous;
  return {
    ...next,
    items: [
      ...new Map(
        [...(previous?.items ?? []), ...next.items].map((item) => [item.locator, item]),
      ).values(),
    ],
  };
}
export async function fetchApplicationObservation(projectId, endpoint, query = {}, signal) {
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(
    `/api/dashboard/projects/${encodeURIComponent(projectId)}/${endpoint}?${params}`,
    { signal },
  );
  if (!response.ok) throw await dashboardResponseError(response);
  return response.json();
}

export function refreshApplicationRunDetail(previous, next) {
  if (!previous || previous.locator !== next.locator) return next;
  const changed = previous.revision !== next.revision;
  const retained = previous.records.map((record) =>
    changed ? { ...record, active: false, stale: true } : record,
  );
  return {
    ...next,
    records: [
      ...new Map([...retained, ...next.records].map((record) => [record.id, record])).values(),
    ],
    artifacts: [
      ...new Map(
        [...(previous.artifacts ?? []), ...(next.artifacts ?? [])].map((artifact) => [
          artifact.id,
          artifact,
        ]),
      ).values(),
    ],
    recordPage: changed ? next.recordPage : (previous.recordPage ?? next.recordPage),
  };
}
export function mergeApplicationRecordPage(previous, page) {
  if (!previous || previous.locator !== page.locator || previous.revision !== page.revision)
    return previous;
  return {
    ...previous,
    records: [
      ...new Map(
        [...previous.records, ...page.items].map((record) => [record.id, record]),
      ).values(),
    ],
    artifacts: [
      ...new Map(
        [...(previous.artifacts ?? []), ...(page.artifacts ?? [])].map((artifact) => [
          artifact.id,
          artifact,
        ]),
      ).values(),
    ],
    recordPage: { total: page.total, nextCursor: page.nextCursor },
  };
}
