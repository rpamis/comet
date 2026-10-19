import { Buffer } from 'node:buffer';

const COMPACT_OBJECT_FIELDS = new Set([
  'continuation',
  'input',
  'commandArgs',
  'userCommunication',
  'current',
  'pendingAction',
  'changedPaths',
  'artifactRefs',
  'artifacts',
]);

/** 可逆的 JSON 展示投影；不修改领域数据、证据摘要或可提交的 Request 模板。 */
export function compactCliJson(value: Record<string, unknown>): Record<string, unknown> {
  if ('outputView' in value) return value;
  const references: Record<string, string> = {};
  const seen = new Map<string, string>();
  const requestCache = new WeakMap<object, boolean>();
  const escape = (key: string): string => key.replace(/~/gu, '~0').replace(/\//gu, '~1');
  const request = (key: string, item: unknown): boolean =>
    /requests?$/iu.test(key) || (item !== null && typeof item === 'object' && 'operation' in item);
  // 每个对象最多检查一次；Request 模板内部不遍历、不投影。
  const containsRequest = (item: unknown): boolean => {
    if (item === null || typeof item !== 'object') return false;
    const cached = requestCache.get(item);
    if (cached !== undefined) return cached;
    const found = Object.entries(item).some(
      ([key, child]) => request(key, child) || containsRequest(child),
    );
    requestCache.set(item, found);
    return found;
  };
  const visit = (item: unknown, pointer: string, key: string, canOmit: boolean): unknown => {
    if (
      request(key, item) ||
      /(?:hash|revision|attempt|claim|token|blockers|workspace)$/iu.test(key)
    ) {
      return item;
    }
    // 对象只检查已知重复字段。保留首份完整对象后不再扫描其内部，避免逐层序列化长 Run。
    const candidate =
      canOmit &&
      ((typeof item === 'string' && item.length >= 160) ||
        (COMPACT_OBJECT_FIELDS.has(key) &&
          item !== null &&
          typeof item === 'object' &&
          !containsRequest(item)));
    if (candidate) {
      const encoded = JSON.stringify(item);
      if (encoded.length >= 160) {
        const original = seen.get(encoded);
        if (original !== undefined && original.length + pointer.length + 8 < encoded.length) {
          references[pointer] = original;
          return undefined;
        }
        seen.set(encoded, pointer);
        return item;
      }
    }
    if (Array.isArray(item)) {
      return item.map((child, index) => visit(child, `${pointer}/${index}`, '', false));
    }
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item).flatMap(([childKey, child]) => {
          const projected = visit(child, `${pointer}/${escape(childKey)}`, childKey, true);
          return projected === undefined ? [] : [[childKey, projected]];
        }),
      );
    }
    return item;
  };
  const ordered = { ...('data' in value ? { data: value.data } : {}), ...value };
  const projected = visit(ordered, '', '', false) as Record<string, unknown>;
  return {
    ...projected,
    outputView: {
      schema: 'comet.cli.compact.v1',
      mode: 'compact',
      references,
      instruction:
        'references maps omitted JSON Pointers to equal values in this response (RFC 6901). Resolve references recursively to restore the full JSON. Request templates remain complete. Omit --compact for the full envelope.',
    },
  };
}

/** 仅显式 JSON 精简视图调用；未启用时逐字保留原 stdout。 */
export function compactCliStdout(stdout: string | undefined, enabled: boolean): string | undefined {
  if (!enabled || !stdout) return stdout;
  const value: unknown = JSON.parse(stdout);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return stdout;
  const projected = compactCliJson(value as Record<string, unknown>);
  const view = projected.outputView as { references?: Record<string, string> } | undefined;
  if (!view?.references || Object.keys(view.references).length === 0) return stdout;
  const compact = `${JSON.stringify(projected)}\n`;
  // 显式精简也是尽力而为：索引开销没有抵消重复正文时，保留完整原 stdout。
  return Buffer.byteLength(compact) < Buffer.byteLength(stdout) ? compact : stdout;
}
