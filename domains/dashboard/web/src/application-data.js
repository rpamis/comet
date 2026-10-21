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

export function groupApplicationRunChildren(group) {
  const byLocator = new Map(),
    byRunId = new Map();
  for (const child of group.children) {
    const index = child.parentLocator ? byLocator : byRunId;
    const key = child.parentLocator ?? child.parentRunId;
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(child);
  }
  return new Map(
    group.runs.map((run) => [
      run.locator,
      [...(byLocator.get(run.locator) ?? []), ...(byRunId.get(run.runId) ?? [])],
    ]),
  );
}

// 定义中的未执行分支保留待进行状态；不能按阶段位置推断完成。
export function applicationPhaseState(nodes) {
  const active = nodes.flatMap((node) =>
    (node.activeRecordIds ?? []).map(
      (id) => node.records?.find((record) => record.id === id)?.status ?? 'unknown',
    ),
  );
  const statuses = [...active, ...nodes.map((node) => node.latestStatus)];
  const attention = ['unknown', 'failed', 'waiting', 'evidence'].find((status) =>
    statuses.includes(status),
  );
  const labels = {
    unknown: '结果待核对',
    failed: '失败',
    waiting: '等待确认',
    evidence: '等待证据',
  };
  if (attention) return { state: 'current', running: false, label: labels[attention] };
  if (active.length || statuses.some((status) => ['running', 'child'].includes(status)))
    return {
      state: 'current',
      running:
        active.some((status) => ['running', 'child'].includes(status)) ||
        statuses.includes('running') ||
        statuses.includes('child'),
      label: statuses.some((status) => ['running', 'child'].includes(status))
        ? '正在进行'
        : '已准备就绪',
    };
  const done = (status) => ['succeeded', 'cancelled', 'resolved'].includes(status);
  if (nodes.length && statuses.every(done))
    return { state: 'done', running: false, label: '已完成' };
  return { state: 'pending', running: false, label: statuses.some(done) ? '部分完成' : '待进行' };
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

/** 循环步骤留在同一层，跨组依赖决定层次；每个步骤只渲染一次。 */
export function applicationWorkflowLayers(flow) {
  const adjacency = new Map(flow.nodes.map((node) => [node.stepId, []]));
  const reverse = new Map(flow.nodes.map((node) => [node.stepId, []]));
  for (const edge of flow.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    reverse.get(edge.to)?.push(edge.from);
  }
  const components = workflowComponents(adjacency, reverse);
  const successors = new Map(),
    incoming = new Map(),
    levels = new Map();
  for (const component of components.values()) {
    if (!successors.has(component)) {
      successors.set(component, new Set());
      incoming.set(component, 0);
      levels.set(component, 0);
    }
  }
  for (const edge of flow.edges) {
    const from = components.get(edge.from),
      to = components.get(edge.to);
    if (from !== to && !successors.get(from).has(to)) {
      successors.get(from).add(to);
      incoming.set(to, incoming.get(to) + 1);
    }
  }
  const ready = [...incoming.keys()].filter((id) => incoming.get(id) === 0);
  for (let i = 0; i < ready.length; i++) {
    const from = ready[i];
    for (const to of successors.get(from)) {
      levels.set(to, Math.max(levels.get(to), levels.get(from) + 1));
      incoming.set(to, incoming.get(to) - 1);
      if (!incoming.get(to)) ready.push(to);
    }
  }
  const layers = [];
  for (const node of flow.nodes) {
    const level = levels.get(components.get(node.stepId));
    (layers[level] ??= []).push(node);
  }
  return layers.filter(Boolean);
}

// 仅描述内置 Creator 的展示分组，不决定执行、确认或恢复行为。
const creatorStages = [
  ['需求与调查', [['analyze', '理解需求与调查 Skills', 'handoff']]],
  [
    '方案与确认',
    [
      ['prepare', '整理创作方案', 'call_tool'],
      ['confirm-plan', '确认创作方案', 'ask_user'],
    ],
  ],
  [
    '构建与校验',
    [
      ['compile', '编译应用', 'call_tool'],
      ['verify', '校验应用与依赖', 'call_tool'],
    ],
  ],
  [
    '模型评估',
    [
      ['eval-preview', '准备模型评估', 'call_tool'],
      ['confirm-eval', '确认是否评估', 'ask_user'],
      ['evaluate', '模型评估', 'call_tool'],
    ],
  ],
  ['安装预览', [['preview', '预览安装影响', 'call_tool']]],
  [
    '交付与分发',
    [
      ['confirm-install', '确认安装', 'ask_user'],
      ['install', '安装与交付', 'call_tool'],
    ],
  ],
];
export function creatorWorkflowView(detail) {
  if (
    detail?.kind !== 'creator' ||
    detail.workflow?.id !== 'comet-creator' ||
    detail.workflow.version !== '1'
  )
    return null;
  const observed = new Map(
    groupApplicationSteps(detail.records ?? []).map((step) => [step.stepId, step]),
  );
  const groups = creatorStages.map(([phase, entries]) => ({
    phase,
    nodes: entries.map(([stepId, title, type]) => {
      const records = observed.get(stepId)?.records ?? [];
      observed.delete(stepId);
      const latest = records.at(-1);
      return {
        stepId,
        title,
        type,
        phase,
        records,
        recordCount: records.length,
        activeRecordIds: records.filter((r) => r.active).map((r) => r.id),
        latestRecordId: latest?.id ?? null,
        latestStatus: latest?.status ?? null,
        connections: [],
        commands: [],
        planned: true,
        unloaded: Boolean(detail.recordPage?.nextCursor),
      };
    }),
  }));
  for (const step of observed.values()) {
    const group = groups.find((g) => g.phase === step.phase) ?? { phase: step.phase, nodes: [] };
    if (!groups.includes(group)) groups.push(group);
    const latest = step.records.at(-1);
    group.nodes.push({
      ...step,
      type: latest.type,
      recordCount: step.records.length,
      activeRecordIds: step.records.filter((r) => r.active).map((r) => r.id),
      latestRecordId: latest.id,
      latestStatus: latest.status,
      connections: [],
      commands: [],
    });
  }
  return {
    title: '完整创作流程',
    description: '阶段状态来自已加载的执行记录；模型评估可选。',
    modelSkipped: detail.evidence?.some(
      (item) => item.kind === 'model' && item.status === 'skipped',
    ),
    phases: groups.map((g) => g.phase),
    phaseGroups: groups,
    nodes: groups.flatMap((g) => g.nodes),
    edges: [],
  };
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
