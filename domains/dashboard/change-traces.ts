import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  readRuntimeTraceSpans,
  type RuntimeTraceSpan,
} from '../../platform/process/runtime-trace.js';
import { readChangeTraceSnapshots, workflowTraceId } from '../workflow-application/run-trace.js';
import {
  readNativeChangeTraceCheckpoint,
  workflowRunTraceSnapshot,
} from '../workflow-application/run-observation.js';
import {
  readNativeBoundedTextFile,
  readNativeTextFilePrefix,
} from '../comet-native/native-bounded-file.js';
import { nativeProjectPaths } from '../comet-native/native-paths.js';
import { parseNativePortableState } from '../comet-native/native-portable-state.js';
import {
  hasNativeManagedRunMarker,
  NATIVE_MANAGED_RUN_MARKER,
  parseNativeStateDocument,
} from '../comet-native/native-state-document.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
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

async function archivedNativeTraces(
  projectRoot: string,
  observed: ReadonlyMap<string, RuntimeTraceSpan[]>,
  target?: string,
) {
  const traces: RuntimeTraceSpan[][] = [];
  let unreadable = 0;
  try {
    const config = await readWorkflowProjectConfig(projectRoot);
    if (!config?.native) return { traces, unreadable };
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root, {
      readOnly: true,
    });
    const archive = await inspectProtectedProjectPath(
      projectRoot,
      path.relative(projectRoot, paths.archiveDir),
      {
        label: 'Native Archive directory',
        expected: 'directory',
      },
    );
    if (!archive.exists) return { traces, unreadable };
    const candidates = new Map<string, string[]>();
    for (const entry of await fs.readdir(archive.target, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        !/^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(entry.name)
      )
        continue;
      const name = entry.name.slice(11);
      if (
        (target !== undefined && name !== target) ||
        observed.has(workflowTraceId('native', name))
      )
        continue;
      const directories = candidates.get(name) ?? [];
      directories.push(entry.name);
      candidates.set(name, directories);
    }
    for (const [name, directories] of candidates) {
      if (directories.length !== 1) {
        unreadable++;
        continue;
      }
      const [archiveRef] = directories;
      const ref = `archive/${archiveRef}/comet-state.yaml`;
      try {
        const prefix = await readNativeTextFilePrefix({
          root: paths.nativeRoot,
          ref,
          maxBytes: NATIVE_MANAGED_RUN_MARKER.length + 1,
        });
        if (!hasNativeManagedRunMarker(prefix.text)) continue;
        const { text } = await readNativeBoundedTextFile({
          root: paths.nativeRoot,
          ref,
          includeHash: false,
        });
        const data = parseNativeStateDocument(text, 'Native Archive state') as {
          run_checkpoint?: unknown;
          archive_receipt?: { runId?: unknown; change?: unknown; archiveRef?: unknown };
        };
        const state = parseNativePortableState(data);
        const receipt = data.archive_receipt;
        if (
          !state.archived ||
          state.name !== name ||
          receipt?.runId !== name ||
          receipt.change !== name ||
          receipt.archiveRef !== archiveRef
        ) {
          throw new Error('Native Archive receipt does not match its change');
        }
        const trace = readNativeChangeTraceCheckpoint(data.run_checkpoint, name);
        if (!trace) {
          throw new Error('Native Archive checkpoint does not contain a completed Native Run');
        }
        traces.push(trace);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadable++;
      }
    }
  } catch {
    unreadable++;
  }
  return { traces, unreadable };
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
        ? result.value.runs.map((run) => workflowRunTraceSnapshot(result.value.name, run))
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
  change?: string,
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
  const archived =
    !range && workflow !== 'classic' ? await archivedNativeTraces(projectRoot, groups) : null;
  for (const nodes of archived?.traces ?? []) groups.set(nodes[0].traceId, nodes);
  const traces = [...groups.values()]
    .map((nodes) => traceSummary(nodes, !measured.has(nodes[0].traceId)))
    .filter((trace) => withinObservationRange(trace.startedAt, range))
    .sort(
      (a, b) =>
        (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.traceId.localeCompare(b.traceId),
    );
  const changeKey = (trace: (typeof traces)[number]) => `${trace.workflow}:${trace.change}`;
  const selected = change ? traces.filter((trace) => changeKey(trace) === change) : traces;
  return {
    changes: [...new Set(traces.map(changeKey))],
    traces: selected.slice(0, 100),
    truncated:
      sample.truncated ||
      history.truncated ||
      selected.length > 100 ||
      selected.some((trace) => trace.incomplete),
    unreadable: history.unreadable + (archived?.unreadable ?? 0),
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
    if (!nodes.length && workflow === 'native') {
      const nativeTracePrefix = 'workflow:native:';
      const archive = await archivedNativeTraces(
        projectRoot,
        new Map(),
        traceId.slice(nativeTracePrefix.length),
      );
      nodes = archive.traces[0] ?? [];
    }
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
