import { encodeJsonValueMaps, type JsonValuePool } from '../../platform/fs/json-value-pool.js';
import type { RuntimeRecord } from './runtime-store.js';

/** 上游结果映射按版本共享；不删减 Action 输入、审批提案或恢复历史。 */
export function encodeRuntimeHistory<T extends RuntimeRecord>(record: T) {
  return serializeRuntimeHistory(record).encoded;
}

/** 复用本次压缩比较所需的 JSON；仅供文件 envelope 写入，不用于 canonical hash。 */
export function serializeRuntimeHistory<T extends RuntimeRecord>(
  record: T,
): {
  encoded: { record: T; pool?: JsonValuePool };
  json: string;
} {
  const originalJson = JSON.stringify(record);
  const originalBytes = originalJson.length;
  const original = () => ({ encoded: { record }, json: `{"record":${originalJson}}` });
  if (originalBytes < 128 * 1024) return original();
  const paths: { path: string[]; group: string }[] = [];
  const collect = (value: unknown, prefix: string[]) => {
    if (!value || typeof value !== 'object') return;
    const run = value as {
      protocolVersion?: unknown;
      actions?: { input?: unknown }[];
      actionContexts?: Record<string, { results?: unknown }>;
      outputs?: unknown;
      ready?: { results?: unknown }[];
      waits?: { results?: unknown; proposal?: unknown }[];
      evidenceWaits?: { results?: unknown }[];
    };
    if (run.protocolVersion !== 1 || !Array.isArray(run.actions) || !run.actionContexts) return;
    for (const [i, action] of run.actions.entries())
      if (
        action.input &&
        typeof action.input === 'object' &&
        Object.hasOwn(action.input, 'outputs')
      )
        paths.push({
          path: [...prefix, 'actions', String(i), 'input', 'outputs'],
          group: 'outputs',
        });
    for (const [id, context] of Object.entries(run.actionContexts))
      if (context?.results)
        paths.push({ path: [...prefix, 'actionContexts', id, 'results'], group: 'results' });
    if (run.outputs) paths.push({ path: [...prefix, 'outputs'], group: 'results' });
    for (const field of ['ready', 'waits', 'evidenceWaits'] as const)
      for (const [i, entry] of (run[field] ?? []).entries())
        if (entry.results)
          paths.push({ path: [...prefix, field, String(i), 'results'], group: 'results' });
  };
  collect(record, []);
  collect((record as unknown as { run?: unknown }).run, ['run']);
  if (!paths.length) return original();
  const encoded = encodeJsonValueMaps(record, paths);
  const json = JSON.stringify(encoded);
  return json.length < originalBytes * 0.9 ? { encoded, json } : original();
}
