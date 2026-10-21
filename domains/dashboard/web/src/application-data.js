import { dashboardResponseError } from './dashboard-web-state.js';

export function applicationRunNeedsAttention(record) {
  return (
    record.error ||
    record.status === 'failed' ||
    (record.activity?.unknown ?? 0) +
      (record.activity?.decisions ?? 0) +
      (record.activity?.evidence ?? 0) >
      0
  );
}

export function preferredApplicationRun(records) {
  const roots = records.filter((record) => !record.isChild);
  const applications = roots.filter((record) => record.kind === 'application');
  const active = applications.filter((record) =>
    ['running', 'waiting', 'unknown'].includes(record.status),
  );
  const attention = applicationRunNeedsAttention;
  return (
    active.find(attention) ??
    active[0] ??
    applications.find(attention) ??
    applications[0] ??
    roots.find(attention) ??
    roots[0] ??
    records.find(attention) ??
    records[0]
  );
}

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

function workflowComponents(adjacency, reverse) {
  // 先记录完成顺序，再沿反向边分组；同组内的边位于循环中。
  const visited = new Set(),
    finished = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack = [{ id: start, next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1),
        neighbors = adjacency.get(frame.id);
      if (frame.next < neighbors.length) {
        const next = neighbors[frame.next++];
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ id: next, next: 0 });
        }
      } else {
        finished.push(frame.id);
        stack.pop();
      }
    }
  }
  const components = new Map();
  let component = 0;
  for (let index = finished.length - 1; index >= 0; index--) {
    const start = finished[index];
    if (components.has(start)) continue;
    components.set(start, component);
    const pending = [start];
    while (pending.length) {
      for (const previous of reverse.get(pending.pop())) {
        if (components.has(previous)) continue;
        components.set(previous, component);
        pending.push(previous);
      }
    }
    component++;
  }
  return components;
}

export function applicationWorkflowView(detail) {
  const definition = detail?.definition;
  if (definition?.status !== 'available' || !definition.workflow) return null;
  const workflow = definition.workflow;
  const metadata = new Map((definition.steps ?? []).map((step) => [step.stepId, step]));
  const records = groupApplicationSteps(detail.records ?? []);
  const observed = new Map(records.map((step) => [step.stepId, step]));
  const entry = new Set(workflow.entry),
    commands = new Map(),
    phaseGroups = new Map();
  for (const [name, command] of Object.entries(workflow.commands ?? {})) {
    if (!commands.has(command.stepId)) commands.set(command.stepId, []);
    commands.get(command.stepId).push(name);
  }
  const nodes = Object.entries(workflow.steps).map(([stepId, step]) => {
    const saved = metadata.get(stepId) ?? {};
    const loaded = observed.get(stepId)?.records ?? [];
    const node = {
      ...step,
      ...saved,
      stepId,
      title: saved.title ?? stepId,
      phase: saved.phase ?? '执行步骤',
      records: loaded,
      recordCount: saved.recordCount ?? loaded.length,
      activeRecordIds: saved.activeRecordIds ?? loaded.filter((r) => r.active).map((r) => r.id),
      latestRecordId:
        saved.latestRecordId === undefined ? (loaded.at(-1)?.id ?? null) : saved.latestRecordId,
      latestStatus:
        saved.latestStatus === undefined ? (loaded.at(-1)?.status ?? null) : saved.latestStatus,
      entry: entry.has(stepId),
      commands: commands.get(stepId) ?? [],
      connections: [],
    };
    return node;
  });
  const adjacency = new Map(nodes.map((node) => [node.stepId, []]));
  const reverse = new Map(nodes.map((node) => [node.stepId, []]));
  const eventCounts = new Map(nodes.map((node) => [node.stepId, new Map()]));
  const byId = new Map(nodes.map((node) => [node.stepId, node]));
  for (const transition of workflow.transitions) {
    adjacency.get(transition.from).push(transition.to);
    reverse.get(transition.to).push(transition.from);
    const counts = eventCounts.get(transition.from);
    counts.set(transition.on, (counts.get(transition.on) ?? 0) + 1);
  }
  const components = workflowComponents(adjacency, reverse);
  const edges = workflow.transitions.map((edge) => {
    const connection = {
      ...edge,
      cyclic: components.get(edge.from) === components.get(edge.to),
      parallel: workflow.dynamicRouting === false && eventCounts.get(edge.from).get(edge.on) > 1,
    };
    byId.get(edge.from).connections.push(connection);
    return connection;
  });
  // 将循环作为一组排序，避免 JSON 键顺序把下游阶段放到上游之前。
  const members = new Map(),
    successors = new Map(),
    incoming = new Map();
  for (const node of nodes) {
    const group = components.get(node.stepId);
    if (!members.has(group)) {
      members.set(group, []);
      successors.set(group, new Set());
      incoming.set(group, 0);
    }
    members.get(group).push(node);
  }
  for (const edge of edges) {
    const from = components.get(edge.from),
      to = components.get(edge.to);
    if (from !== to && !successors.get(from).has(to)) {
      successors.get(from).add(to);
      incoming.set(to, incoming.get(to) + 1);
    }
  }
  const ready = [...members.keys()].filter((group) => incoming.get(group) === 0);
  ready.sort(
    (left, right) =>
      Number(members.get(right).some((node) => node.entry)) -
      Number(members.get(left).some((node) => node.entry)),
  );
  const ordered = [];
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const group = ready[cursor];
    ordered.push(...members.get(group));
    for (const next of successors.get(group)) {
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) ready.push(next);
    }
  }
  for (const node of ordered) {
    if (!phaseGroups.has(node.phase)) phaseGroups.set(node.phase, []);
    phaseGroups.get(node.phase).push(node);
  }
  return {
    title: definition.title ?? workflow.id,
    description: definition.description,
    nodes: ordered,
    edges,
    phases: [...phaseGroups.keys()],
    phaseGroups: [...phaseGroups].map(([phase, steps]) => ({ phase, nodes: steps })),
  };
}

export function applicationOutputSummary(record, fields = []) {
  const output = record?.data?.outcome?.output;
  return fields.map((field) => {
    const value = field.path
      .split('.')
      .reduce(
        (current, key) =>
          current !== null && typeof current === 'object' && Object.hasOwn(current, key)
            ? current[key]
            : undefined,
        output,
      );
    return { ...field, available: value !== undefined, value };
  });
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
  if (previous.revision > next.revision) return previous;
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
