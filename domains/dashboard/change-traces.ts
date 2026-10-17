import {
  readRuntimeTraceSpans,
  type RuntimeTraceSpan,
} from '../../platform/process/runtime-trace.js';
import {
  readChangeTraceSnapshots,
  workflowRunTraceUpdates,
  workflowTraceId,
} from '../workflow-application/run-trace.js';
import { withinObservationRange, type ObservabilityRange } from './observability-range.js';

export type ChangeTraceNode = RuntimeTraceSpan & { timing?: 'measured' | 'range' | 'unknown' };
const time = (value: string | null | undefined) => (value ? Date.parse(value) : NaN);
function intervals(nodes: RuntimeTraceSpan[], now: number) {
  const values = nodes
    .filter((node) => node.endedAt || node.status === 'running' || node.status === 'waiting')
    .map((node) => [time(node.startedAt), node.endedAt ? time(node.endedAt) : now])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const range of values) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** 合并并行时间区间，显式等待不计入动作时间；缺失时间不按零耗时解释。 */
export function changeTraceStatistics(nodes: RuntimeTraceSpan[], now = Date.now()) {
  const work = nodes.filter((node) => !['workflow', 'wait', 'evidence'].includes(node.kind));
  const waits = nodes.filter((node) => node.kind === 'wait' || node.kind === 'evidence');
  const workRanges = intervals(work, now),
    waitRanges = intervals(waits, now);
  const duration = (ranges: number[][]) =>
    ranges.reduce((sum, [start, end]) => sum + end - start, 0);
  const overlap = workRanges.reduce(
    (sum, [start, end]) =>
      sum +
      waitRanges.reduce(
        (part, [a, b]) => part + Math.max(0, Math.min(end, b) - Math.max(start, a)),
        0,
      ),
    0,
  );
  const actions = new Map<string, RuntimeTraceSpan>();
  for (const node of nodes.filter((item) => item.kind === 'action')) {
    const key = String(node.attributes?.actionId ?? node.spanId);
    if ((actions.get(key)?.attempt ?? 0) <= (node.attempt ?? 1)) actions.set(key, node);
  }
  const terminal = [...actions.values()].filter(
    (node) => node.status === 'succeeded' || node.status === 'failed',
  );
  return {
    observedWorkMs: workRanges.length ? Math.max(0, duration(workRanges) - overlap) : null,
    waitMs: waitRanges.length ? duration(waitRanges) : waits.length ? null : 0,
    firstPassRate: terminal.length
      ? terminal.filter((node) => node.status === 'succeeded' && node.attempt === 1).length /
        terminal.length
      : null,
    retries: [...actions.values()].reduce(
      (sum, node) => sum + Math.max(0, (node.attempt ?? 1) - 1),
      0,
    ),
    failures: nodes.filter((node) => node.status === 'failed').length,
    unknownTiming: nodes.filter(
      (node) =>
        node.status !== 'pending' &&
        (!node.startedAt ||
          (['succeeded', 'failed', 'cancelled'].includes(node.status) && !node.endedAt)),
    ).length,
  };
}

function traceSummary(nodes: RuntimeTraceSpan[], snapshot = false) {
  const root = nodes.find((node) => node.parentSpanId === null) ?? nodes[0];
  const updatedAt =
    nodes
      .map((node) => node.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  return {
    traceId: root.traceId,
    change: root.change,
    workflow: root.workflow,
    runId: root.runId,
    name: root.name,
    kind: root.kind,
    status: root.parentSpanId === null ? root.status : 'unknown',
    startedAt: root.startedAt,
    endedAt: root.endedAt,
    updatedAt,
    nodeCount: nodes.length,
    snapshot,
    incomplete:
      !nodes.some((node) => node.parentSpanId === null) ||
      nodes.some((node) => node.attributes?.truncated === true),
    ...changeTraceStatistics(nodes),
  };
}

async function historicalRuns(projectRoot: string, workflow: 'all' | 'native' | 'classic') {
  const results = await Promise.allSettled(
    (['native', 'classic'] as const)
      .filter((name) => workflow === 'all' || workflow === name)
      .map(async (name) => ({ name, ...(await readChangeTraceSnapshots(projectRoot, name, 50)) })),
  );
  return {
    traces: results.flatMap((result) =>
      result.status === 'fulfilled'
        ? result.value.runs.map((run) =>
            workflowRunTraceUpdates({
              workflow: result.value.name,
              previous: null,
              next: run,
              initial: false,
              observedAt: '',
            }).map((node) => ({ ...node, startedAt: null, endedAt: null, updatedAt: '' })),
          )
        : [],
    ),
    truncated: results.some((result) => result.status === 'fulfilled' && result.value.truncated),
    unreadable: results.reduce(
      (sum, result) => sum + (result.status === 'fulfilled' ? result.value.unreadable : 1),
      0,
    ),
  };
}

export async function collectChangeTraceIndex(
  projectRoot: string,
  workflow: 'all' | 'native' | 'classic' = 'all',
  range?: ObservabilityRange,
) {
  const [sample, history] = await Promise.all([
    readRuntimeTraceSpans(projectRoot),
    historicalRuns(projectRoot, workflow),
  ]);
  const groups = new Map<string, RuntimeTraceSpan[]>();
  for (const span of sample.spans) {
    if (workflow !== 'all' && span.workflow !== workflow) continue;
    const group = groups.get(span.traceId) ?? [];
    group.push(span);
    groups.set(span.traceId, group);
  }
  const measured = new Set(groups.keys());
  for (const nodes of history.traces)
    if (!groups.has(nodes[0].traceId)) groups.set(nodes[0].traceId, nodes);
  const traces = [...groups.values()]
    .map((nodes) => traceSummary(nodes, !measured.has(nodes[0].traceId)))
    .filter((trace) => withinObservationRange(trace.startedAt, range))
    .sort(
      (a, b) =>
        (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.traceId.localeCompare(b.traceId),
    );
  return {
    traces: traces.slice(0, 100),
    truncated:
      sample.truncated ||
      history.truncated ||
      traces.length > 100 ||
      traces.some((trace) => trace.incomplete),
    unreadable: history.unreadable,
    days: sample.days,
    observedAt: new Date().toISOString(),
  };
}

export async function collectChangeTrace(projectRoot: string, traceId: string) {
  const sample = await readRuntimeTraceSpans(projectRoot, { traceId, limit: 2000 });
  let nodes = sample.spans;
  let snapshot = false;
  if (!nodes.length) {
    const workflow = traceId.startsWith('workflow:native:')
      ? 'native'
      : traceId.startsWith('workflow:classic:')
        ? 'classic'
        : null;
    if (!workflow) return null;
    const history = await historicalRuns(projectRoot, workflow);
    nodes =
      history.traces.find((group) => workflowTraceId(workflow, group[0].runId) === traceId) ?? [];
    snapshot = true;
  }
  if (!nodes.length) return null;
  const root = nodes.find((node) => !node.parentSpanId);
  const enriched: ChangeTraceNode[] = nodes.map((node) => ({
    ...node,
    timing: node.startedAt ? 'measured' : 'unknown',
  }));
  if (root?.kind === 'workflow') {
    const phases = new Map<string, ChangeTraceNode[]>();
    for (const node of enriched) {
      const phase = node.attributes?.phase;
      if (typeof phase !== 'string' || !phase) continue;
      const id = `phase:${phase}`;
      node.parentSpanId = id;
      const group = phases.get(id) ?? [];
      group.push(node);
      phases.set(id, group);
    }
    for (const [id, group] of phases) {
      const latest = new Map<string, ChangeTraceNode>();
      for (const node of group) {
        const key =
          node.kind === 'action' ? String(node.attributes?.actionId ?? node.spanId) : node.spanId;
        if ((latest.get(key)?.attempt ?? 0) <= (node.attempt ?? 1)) latest.set(key, node);
      }
      const current = [...latest.values()];
      const starts = group
        .map((node) => node.startedAt)
        .filter((value): value is string => Boolean(value))
        .sort();
      const ends = group
        .map((node) => node.endedAt)
        .filter((value): value is string => Boolean(value))
        .sort();
      enriched.push({
        ...root,
        spanId: id,
        parentSpanId: root.spanId,
        kind: 'workflow',
        name: id.slice(6),
        status: current.some((node) => node.status === 'running')
          ? 'running'
          : current.some((node) => node.status === 'waiting')
            ? 'waiting'
            : current.some((node) => node.status === 'failed')
              ? 'failed'
              : current.every((node) => node.status === 'succeeded')
                ? 'succeeded'
                : current.some((node) => node.status === 'pending')
                  ? 'pending'
                  : current.some((node) => node.status === 'cancelled')
                    ? 'cancelled'
                    : 'unknown',
        startedAt: starts[0] ?? null,
        endedAt: current.some((node) => ['running', 'waiting'].includes(node.status))
          ? null
          : (ends.at(-1) ?? null),
        timing: starts.length ? 'range' : 'unknown',
        summary: '阶段时间范围由已观测节点推导，包含间隔，不等于阶段实际执行耗时。',
        attributes: { phase: id.slice(6) },
      });
    }
  }
  return {
    ...traceSummary(nodes, snapshot),
    nodes: enriched,
    truncated: sample.truncated || nodes.some((node) => node.attributes?.truncated === true),
    observedAt: new Date().toISOString(),
    days: sample.days,
  };
}
