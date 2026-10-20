import { randomUUID } from 'node:crypto';
import {
  materializeJsonValueProjection,
  freezeJsonValueProjection,
  hashJsonValueProjection,
  visitJsonValueMap,
  validateJsonValueMapOrigins,
  getJsonValueProjectionStats,
} from '../../platform/fs/json-value-pool.js';
import { RuntimeProtocolError } from './runtime-errors.js';
import { validateWorkflowRunProjection } from './workflow-run-validation.js';
import { hashRuntimeValue, validateRuntimeValue } from './runtime-json.js';
import type { RuntimeStore, RuntimeRecord } from './runtime-store.js';
import type { WorkflowRun } from './workflow-run.js';
const scopes = new WeakMap<object, string>();
export interface RuntimeQuery {
  runId?: string;
  view: 'current' | 'summary' | 'history' | 'action' | 'artifact';
  limit?: number;
  cursor?: string;
  actionId?: string;
  filter?: 'actions' | 'waits' | 'evidenceWaits' | 'all';
  artifactId?: string;
}
export async function readRuntimeProjection<T extends RuntimeRecord>(
  store: RuntimeStore<T>,
  runId: string,
) {
  let record = await (store.readProjection ? store.readProjection(runId) : store.read(runId));
  if (!record) throw new RuntimeProtocolError('RUN_NOT_FOUND', `找不到工作流实例：${runId}`);
  if (!getJsonValueProjectionStats(record)) {
    validateRuntimeValue(record);
    // 普通 Store 的返回对象仍归调用者所有，隔离后才能冻结语义快照。
    record = structuredClone(record);
    freezeJsonValueProjection(record);
  }
  const raw = ('run' in record ? record.run : record) as WorkflowRun;
  if (!raw || raw.runId !== record.runId || raw.revision !== record.revision)
    throw new RuntimeProtocolError('INVALID_RUN', 'Run 与存储 envelope 身份不一致');
  let run: WorkflowRun;
  try {
    run = validateWorkflowRunProjection(raw, runId, {
      hash: hashJsonValueProjection,
      visitResults: visitJsonValueMap,
      validateOrigins: validateJsonValueMapOrigins,
    });
  } catch (error) {
    if (error instanceof RuntimeProtocolError) throw error;
    throw new RuntimeProtocolError(
      'INVALID_RUN',
      error instanceof Error ? error.message : String(error),
    );
  }
  freezeJsonValueProjection(run);
  const stats = getJsonValueProjectionStats(record);
  if (stats) {
    stats.validationActions = run.actions.length;
    stats.validationMaterializedEntries = stats.materializedEntries;
  }
  let scope = store.queryScope ?? scopes.get(store);
  if (!scope) {
    scope = randomUUID();
    scopes.set(store, scope);
  }
  return Object.freeze({
    record,
    run,
    scope,
    stats,
    materialize: (path: readonly string[] = []) =>
      materializeJsonValueProjection(
        path.reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], run),
      ),
    hash: () => hashJsonValueProjection(run),
  });
}
export type RuntimeProjection = Awaited<ReturnType<typeof readRuntimeProjection>>;
const invalid = (message: string): never => {
  throw new RuntimeProtocolError('INVALID_REQUEST', message);
};
export function queryRuntimeProjection(
  projection: RuntimeProjection,
  request: RuntimeQuery,
): unknown {
  const { run, scope } = projection;
  if (!['current', 'summary', 'history', 'action', 'artifact'].includes(request.view))
    invalid('query.view 无效');
  const header = {
    runId: run.runId,
    revision: run.revision,
    status: run.status,
    workflow: run.workflow,
    sequence: run.sequence,
  };
  const history = {
    actions: run.actions.length,
    waits: run.waits.length,
    evidenceWaits: run.evidenceWaits?.length ?? 0,
  };
  const active = run.actions.filter(
    (a) =>
      ['pending', 'running', 'unknown'].includes(a.status) ||
      (a.status === 'cancelled' && a.claim && !a.executionStop && !a.cancellation),
  );
  if (request.view === 'summary')
    return materializeJsonValueProjection({
      ...header,
      history,
      pending: {
        actions: active.length,
        waits: run.waits.filter((w) => w.status === 'pending').length,
        evidenceWaits: (run.evidenceWaits ?? []).filter((w) => w.status === 'pending').length,
      },
    });
  if (request.view === 'current')
    return materializeJsonValueProjection({
      ...header,
      input: run.input,
      ...(run.state === undefined ? {} : { state: run.state }),
      ...(run.reason === undefined ? {} : { reason: run.reason }),
      actions: active,
      waits: run.waits.filter((w) => w.status === 'pending'),
      evidenceWaits: (run.evidenceWaits ?? []).filter((w) => w.status === 'pending'),
      outputs: run.outputs,
      history,
    });
  if (request.view === 'action' || request.view === 'artifact') {
    const action = run.actions.find((a) => a.id === request.actionId);
    if (!action) invalid('query.actionId 不属于当前 Run');
    if (request.view === 'action')
      return materializeJsonValueProjection({
        ...header,
        action,
        context: run.actionContexts[action!.id],
      });
    // 只返回 Run 已绑定证据；不解析路径或读取 ref 指向的资源。
    const bound = (action!.outcome?.artifacts ?? []).map((artifact) => ({
      ...artifact,
      artifactId: hashRuntimeValue({ actionId: action!.id, ...artifact }),
    }));
    const artifacts =
      request.artifactId === undefined
        ? bound
        : bound.filter((artifact) => artifact.artifactId === request.artifactId);
    if (request.artifactId !== undefined && !artifacts.length)
      invalid('query.artifactId 不属于所选 Action');
    return materializeJsonValueProjection({ ...header, actionId: action!.id, artifacts });
  }
  const limit = request.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    invalid('query.limit 必须在 1–100 之间');
  const filter = request.filter ?? 'all';
  if (!['all', 'actions', 'waits', 'evidenceWaits'].includes(filter)) invalid('query.filter 无效');
  const binding = hashRuntimeValue({ scope, runId: run.runId, revision: run.revision, filter });
  let offset = 0;
  if (request.cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'));
      if (
        parsed.binding !== binding ||
        !Number.isSafeInteger(parsed.offset) ||
        parsed.offset < 0 ||
        Object.keys(parsed).some((k) => !['binding', 'offset'].includes(k))
      )
        invalid('query.cursor 与当前存储、版本或筛选不匹配');
      offset = parsed.offset;
    } catch {
      invalid('query.cursor 无效或已经过期');
    }
  }
  const records = [
    ...(filter === 'all' || filter === 'actions'
      ? run.actions.map((value, index) => ({
          kind: 'action',
          sequence: run.actionContexts[value.id].sequence,
          path: ['actions', String(index)],
        }))
      : []),
    ...(filter === 'all' || filter === 'waits'
      ? run.waits.map((value, index) => ({
          kind: 'wait',
          sequence: value.sequence,
          path: ['waits', String(index)],
        }))
      : []),
    ...(filter === 'all' || filter === 'evidenceWaits'
      ? (run.evidenceWaits ?? []).map((value, index) => ({
          kind: 'evidenceWait',
          sequence: value.sequence,
          path: ['evidenceWaits', String(index)],
        }))
      : []),
  ].sort((a, b) => b.sequence - a.sequence);
  if (offset > records.length) invalid('query.cursor 超出历史范围');
  return {
    ...materializeJsonValueProjection(header),
    records: records.slice(offset, offset + limit).map((item) => ({
      kind: item.kind,
      sequence: item.sequence,
      value: projection.materialize(item.path),
    })),
    total: records.length,
    ...(offset + limit < records.length
      ? {
          nextCursor: Buffer.from(JSON.stringify({ binding, offset: offset + limit })).toString(
            'base64url',
          ),
        }
      : {}),
  };
}
