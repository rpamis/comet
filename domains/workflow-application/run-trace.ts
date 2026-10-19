import path from 'node:path';
import {
  createFileRuntimeStore,
  listFileRuntimeStoreRunKeys,
  readFileRuntimeStoreRunSources,
  parseWorkflowRun,
  type RuntimeStore,
  type WorkflowRun,
} from '../engine/runtime.js';
import { readWorkspaceRuntimeRoots } from '../workflow-contract/workspace-runtime.js';
import {
  bindRuntimeTrace,
  recordRuntimeTraceSpans,
  type RuntimeTraceSpan,
} from '../../platform/process/runtime-trace.js';

export const workflowTraceId = (workflow: 'native' | 'classic', runId: string) =>
  `workflow:${workflow}:${runId}`;

const phase = (stepId: string, workflow: 'native' | 'classic') => {
  const parts = stepId.split('.');
  return workflow === 'classic' && ['full', 'hotfix', 'tweak'].includes(parts[0])
    ? (parts[1] ?? parts[0])
    : parts[0];
};
interface WorkflowTraceSnapshot {
  runId: string;
  revision: number;
  status: WorkflowRun['status'];
  actions: {
    id: string;
    attempt: number;
    status: string;
    reason?: string;
    outcome?: { outcomeId: string; summary?: string };
  }[];
  waits: { id: string; status: string }[];
  evidenceWaits?: { id: string; status: string }[];
}
const traceSnapshot = (run: WorkflowRun): WorkflowTraceSnapshot => ({
  runId: run.runId,
  revision: run.revision,
  status: run.status,
  actions: run.actions.map((action) => ({
    id: action.id,
    attempt: action.attempt,
    status: action.status,
    reason: action.reason,
    ...(action.outcome
      ? { outcome: { outcomeId: action.outcome.outcomeId, summary: action.outcome.summary } }
      : {}),
  })),
  waits: run.waits.map((wait) => ({ id: wait.id, status: wait.status })),
  evidenceWaits: run.evidenceWaits?.map((wait) => ({ id: wait.id, status: wait.status })),
});
const fields = (value: unknown) =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? [`${value.length} items`]
      : Object.keys(value).slice(0, 30)
    : [value === null ? 'null' : typeof value];

/** 只有成功提交的转换产生计时；既有快照首次被观测时保留未知的开始时间。 */
export function workflowRunTraceUpdates(options: {
  workflow: 'native' | 'classic';
  previous: WorkflowTraceSnapshot | null;
  next: WorkflowRun;
  initial: boolean;
  observedAt: string;
}): RuntimeTraceSpan[] {
  const { workflow, previous, next, initial, observedAt } = options;
  const traceId = workflowTraceId(workflow, next.runId);
  const rootId = `run:${next.runId}`;
  const base = {
    workflow,
    change: next.runId,
    runId: next.runId,
    traceId,
    updatedAt: observedAt,
    revision: next.revision,
  };
  const terminal = ['completed', 'failed', 'cancelled'].includes(next.status);
  const oldActions = new Map(
    previous?.actions.map((action) => [`${action.id}:${action.attempt}`, action]),
  );
  const spans: RuntimeTraceSpan[] = [
    {
      ...base,
      spanId: rootId,
      parentSpanId: null,
      kind: 'workflow',
      name: next.workflow.id,
      status: next.status === 'completed' ? 'succeeded' : next.status,
      startedAt: initial ? observedAt : null,
      endedAt:
        terminal && (initial || (previous !== null && previous.status !== next.status))
          ? observedAt
          : null,
      summary: next.reason,
      attributes: {
        workflowVersion: next.workflow.version,
        sequence: next.sequence,
        parentRunIds: next.lineage,
        childRunIds: next.children.map((child) => child.runId),
      },
    },
  ];
  for (const action of next.actions) {
    const old = oldActions.get(`${action.id}:${action.attempt}`);
    if (
      old &&
      old.status === action.status &&
      old.outcome?.outcomeId === action.outcome?.outcomeId &&
      old.reason === action.reason &&
      old.outcome?.summary === action.outcome?.summary
    )
      continue;
    const ended = ['succeeded', 'failed', 'cancelled'].includes(action.status);
    spans.push({
      ...base,
      spanId: `action:${action.id}:${action.attempt}`,
      parentSpanId: rootId,
      kind: 'action',
      name: action.stepId,
      status: action.status,
      attempt: action.attempt,
      startedAt:
        action.status === 'running' && (old?.status === 'pending' || initial) ? observedAt : null,
      endedAt: ended && (initial || previous !== null) ? observedAt : null,
      summary: action.outcome?.summary ?? action.reason,
      attributes: {
        phase: phase(action.stepId, workflow),
        actionId: action.id,
        actionType: action.type,
        ref: action.ref ?? null,
        executor: action.claim?.executorId ?? null,
        inputFields: fields(action.input),
        outputFields: action.outcome ? fields(action.outcome.output) : [],
        artifacts: (action.outcome?.artifacts ?? []).map((artifact) => artifact.uri),
      },
    });
  }
  for (const kind of ['wait', 'evidence'] as const) {
    const items = kind === 'wait' ? next.waits : (next.evidenceWaits ?? []);
    const oldItems = kind === 'wait' ? previous?.waits : previous?.evidenceWaits;
    const oldWaits = new Map(oldItems?.map((wait) => [wait.id, wait]));
    for (const wait of items) {
      const old = oldWaits.get(wait.id);
      if (old?.status === wait.status) continue;
      spans.push({
        ...base,
        spanId: `${kind}:${wait.id}`,
        parentSpanId: rootId,
        kind,
        name: wait.stepId,
        status:
          wait.status === 'pending'
            ? 'waiting'
            : wait.status === 'resolved'
              ? 'succeeded'
              : wait.status === 'cancelled'
                ? 'cancelled'
                : 'unknown',
        startedAt:
          !old && (previous !== null || initial) && wait.status === 'pending' ? observedAt : null,
        endedAt: wait.status !== 'pending' && (initial || previous !== null) ? observedAt : null,
        attributes: {
          phase: phase(wait.stepId, workflow),
          waitId: wait.id,
          decision: 'decision' in wait ? (wait.decision?.choice ?? null) : null,
        },
      });
    }
  }
  return spans;
}

/** 观测 Store 的成功提交，原 Store 继续拥有并发校验、恢复与推进权威。 */
export function observeWorkflowRunStore(
  projectRoot: string,
  workflow: 'native' | 'classic',
  store: RuntimeStore<WorkflowRun>,
): RuntimeStore<WorkflowRun> {
  let cached: WorkflowTraceSnapshot | null = null;
  return {
    ...store,
    ...(store.restoreCheckpoint
      ? {
          restoreCheckpoint: (runId: string, revision: null | 1, run: WorkflowRun) =>
            store.restoreCheckpoint!(runId, revision, run),
        }
      : {}),
    async read(runId) {
      const run = await store.read(runId);
      try {
        cached = run ? traceSnapshot(run) : null;
      } catch {
        cached = null;
      }
      if (run) bindRuntimeTrace({ workflow, change: run.runId, runId: run.runId });
      return run;
    },
    async compareAndSwap(runId, revision, next) {
      const previous = cached?.runId === runId && cached.revision === revision ? cached : null;
      const committed = await store.compareAndSwap(runId, revision, next);
      if (committed) {
        bindRuntimeTrace({ workflow, change: runId, runId });
        try {
          await recordRuntimeTraceSpans(
            projectRoot,
            workflowRunTraceUpdates({
              workflow,
              previous,
              next,
              initial: revision === null,
              observedAt: new Date().toISOString(),
            }),
          );
        } catch {
          /* 观测副本失败不改变已提交的 Run。 */
        }
        try {
          cached = traceSnapshot(next);
        } catch {
          cached = null;
        }
      }
      return committed;
    },
  };
}

/** 有界读取内置 SDK 的原始只读快照；不触发 YAML 投影、恢复或应用执行模块。 */
export async function readChangeTraceSnapshots(
  projectRoot: string,
  workflow: 'native' | 'classic',
  limit = 100,
) {
  const result: WorkflowRun[] = [];
  let unreadable = 0;
  const roots = await readWorkspaceRuntimeRoots(projectRoot);
  const locations = new Map<string, string[]>();
  for (const root of roots) {
    const rootDir = path.join(root, 'sdk-runs', workflow);
    for (const key of await listFileRuntimeStoreRunKeys({ rootDir })) {
      const directories = locations.get(key) ?? [];
      directories.push(rootDir);
      locations.set(key, directories);
    }
  }
  const keys = [...locations.keys()].sort((a, b) => a.localeCompare(b));
  const selected = keys.slice(0, Math.max(0, Math.floor(limit)));
  const sources = new Map<
    string,
    Awaited<ReturnType<typeof readFileRuntimeStoreRunSources>>[number]
  >();
  for (const root of roots) {
    const rootDir = path.join(root, 'sdk-runs', workflow);
    const localKeys = selected.filter(
      (key) => locations.get(key)?.length === 1 && locations.get(key)![0] === rootDir,
    );
    if (!localKeys.length) continue;
    for (const source of await readFileRuntimeStoreRunSources({ rootDir }, localKeys))
      sources.set(source.storageKey, source);
  }
  for (const key of selected) {
    const directories = locations.get(key)!;
    // 同一身份的两个权威不能由列表顺序静默决定。
    if (directories.length !== 1) {
      unreadable++;
      continue;
    }
    const rootDir = directories[0];
    const source = sources.get(key);
    if (!source?.runId || source.error) {
      unreadable++;
      continue;
    }
    try {
      const run = await createFileRuntimeStore<WorkflowRun>({ rootDir }).read(source.runId);
      if (!run) throw new Error('Run unavailable');
      result.push(parseWorkflowRun(run, source.runId));
    } catch {
      unreadable++;
    }
  }
  return { runs: result, truncated: keys.length > selected.length, unreadable };
}
