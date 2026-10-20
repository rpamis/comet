import { types as utilTypes } from 'node:util';
import { createHash, type Hash } from 'node:crypto';
interface LegacyJsonValuePool {
  readonly version: 1;
  readonly values: readonly unknown[];
  readonly maps: readonly {
    readonly base?: number;
    readonly entries: readonly (readonly [string, number])[];
    readonly removed: readonly string[];
  }[];
  readonly bindings: readonly {
    readonly path: readonly string[];
    readonly map: number;
  }[];
}

interface SharedMapNode {
  base?: SharedMapNode;
  entries: [string, unknown][];
  removed: string[];
}
const immutableMaps = new WeakMap<object, SharedMapNode>();

/** 输入由调用方先按 JSON 契约校验。字段仍保留原位，公共协议无需识别内部引用。 */
function encodeLegacyJsonValueMaps<T>(
  value: T,
  paths: readonly {
    readonly path: readonly string[];
    readonly group: string;
  }[],
  isImmutable?: (value: object) => boolean,
): { record: T; pool?: LegacyJsonValuePool } {
  const copies = new WeakMap<object, Record<string, unknown>>();
  const shallow = (source: object) => {
    const existing = copies.get(source);
    if (existing) return existing;
    const copy = (Array.isArray(source) ? [...source] : { ...source }) as unknown as Record<
      string,
      unknown
    >;
    copies.set(source, copy);
    return copy;
  };
  const record = shallow(value as object) as T;
  const values: unknown[] = [],
    maps: { base?: number; entries: [string, number][]; removed: string[] }[] = [],
    bindings: { path: readonly string[]; map: number }[] = [];
  const valueIds = new Map<string, number>(),
    mapIds = new Map<string, number>();
  const objectIds = new WeakMap<object, number>();
  const previous = new Map<string, { id: number; entries: Map<string, number> }>();
  const sharedPrevious = new Map<
    string,
    { source: Record<string, unknown>; node: SharedMapNode }
  >();
  const nodeIds = new Map<SharedMapNode, number>();
  const valueId = (item: unknown): number => {
    let id = item && typeof item === 'object' ? objectIds.get(item) : undefined;
    if (id !== undefined) return id;
    const identity = JSON.stringify(item);
    id = valueIds.get(identity);
    if (id === undefined) {
      id = values.length;
      values.push(item);
      valueIds.set(identity, id);
    }
    if (item && typeof item === 'object') objectIds.set(item, id);
    return id;
  };
  const emitNode = (node: SharedMapNode): number => {
    const cached = nodeIds.get(node);
    if (cached !== undefined) return cached;
    const base = node.base === undefined ? undefined : emitNode(node.base);
    const id = maps.length;
    maps.push({
      ...(base === undefined ? {} : { base }),
      entries: node.entries.map(([key, item]) => [key, valueId(item)]),
      removed: [...node.removed],
    });
    nodeIds.set(node, id);
    return id;
  };
  for (const binding of paths) {
    let parent = record as unknown as Record<string, unknown>;
    let source = value as unknown as Record<string, unknown>;
    for (const field of binding.path.slice(0, -1)) {
      source = source[field] as Record<string, unknown>;
      const copied = shallow(source);
      Object.defineProperty(parent, field, {
        value: copied,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      parent = copied;
    }
    const field = binding.path.at(-1)!;
    const current = parent[field];
    if (!current || typeof current !== 'object' || Array.isArray(current)) continue;
    if (isImmutable?.(current)) {
      let node = immutableMaps.get(current);
      if (!node) {
        const source = current as Record<string, unknown>;
        const prior = sharedPrevious.get(binding.group);
        const entries = Object.entries(source);
        const changes = prior
          ? entries.filter(
              ([key, item]) =>
                !Object.hasOwn(prior.source, key) || valueId(prior.source[key]) !== valueId(item),
            )
          : entries;
        const removed = prior
          ? Object.keys(prior.source).filter((key) => !Object.hasOwn(source, key))
          : [];
        const incremental = prior && changes.length + removed.length < entries.length;
        node = {
          ...(incremental ? { base: prior.node } : {}),
          entries: incremental ? changes : entries,
          removed: incremental ? removed : [],
        };
        immutableMaps.set(current, node);
      }
      sharedPrevious.set(binding.group, {
        source: current as Record<string, unknown>,
        node,
      });
      bindings.push({ path: binding.path, map: emitNode(node) });
      Object.defineProperty(parent, field, {
        value: {},
        enumerable: true,
        writable: true,
        configurable: true,
      });
      continue;
    }
    const entries = new Map<string, number>();
    for (const [key, item] of Object.entries(current)) {
      let id = item && typeof item === 'object' ? objectIds.get(item) : undefined;
      if (id === undefined) {
        const identity = JSON.stringify(item);
        id = valueIds.get(identity);
        if (id === undefined) {
          id = values.length;
          values.push(item);
          valueIds.set(identity, id);
        }
        if (item && typeof item === 'object') objectIds.set(item, id);
      }
      entries.set(key, id);
    }
    const shape = JSON.stringify([...entries]);
    let id = mapIds.get(shape);
    if (id === undefined) {
      const prior = previous.get(binding.group);
      const changes = [...entries].filter(([key, value]) => prior?.entries.get(key) !== value);
      const removed = prior ? [...prior.entries.keys()].filter((key) => !entries.has(key)) : [];
      const incremental = prior && changes.length + removed.length < entries.size;
      id = maps.length;
      maps.push({
        ...(incremental ? { base: prior.id } : {}),
        entries: incremental ? changes : [...entries],
        removed: incremental ? removed : [],
      });
      mapIds.set(shape, id);
    }
    previous.set(binding.group, { id, entries });
    bindings.push({ path: binding.path, map: id });
    Object.defineProperty(parent, field, {
      value: {},
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return bindings.length ? { record, pool: { version: 1, values, maps, bindings } } : { record };
}

interface TreeNode {
  key: string;
  value: number;
  left: number | null;
  right: number | null;
  height: number;
}
export interface JsonValuePool {
  readonly version: 3;
  readonly values: readonly unknown[];
  readonly nodes: readonly TreeNode[];
  readonly maps: readonly (number | null)[];
  readonly bindings: readonly {
    readonly path: readonly string[];
    readonly map: number;
  }[];
}
function trees() {
  const nodes: TreeNode[] = [];
  const height = (id: number | null): number => (id === null ? 0 : nodes[id].height);
  const make = (key: string, value: number, left: number | null, right: number | null): number => {
    const id = nodes.length;
    nodes.push({
      key,
      value,
      left,
      right,
      height: 1 + Math.max(height(left), height(right)),
    });
    return id;
  };
  const balance = (
    key: string,
    value: number,
    left: number | null,
    right: number | null,
  ): number => {
    if (height(left) > height(right) + 1) {
      const l = nodes[left!];
      if (height(l.left) >= height(l.right))
        return make(l.key, l.value, l.left, make(key, value, l.right, right));
      const m = nodes[l.right!];
      return make(
        m.key,
        m.value,
        make(l.key, l.value, l.left, m.left),
        make(key, value, m.right, right),
      );
    }
    if (height(right) > height(left) + 1) {
      const r = nodes[right!];
      if (height(r.right) >= height(r.left))
        return make(r.key, r.value, make(key, value, left, r.left), r.right);
      const m = nodes[r.left!];
      return make(
        m.key,
        m.value,
        make(key, value, left, m.left),
        make(r.key, r.value, m.right, r.right),
      );
    }
    return make(key, value, left, right);
  };
  const set = (root: number | null, key: string, value: number | undefined): number | null => {
    if (root === null) return value === undefined ? null : make(key, value, null, null);
    const n = nodes[root];
    if (key < n.key) {
      const left = set(n.left, key, value);
      return left === n.left ? root : balance(n.key, n.value, left, n.right);
    }
    if (key > n.key) {
      const right = set(n.right, key, value);
      return right === n.right ? root : balance(n.key, n.value, n.left, right);
    }
    if (value !== undefined) return value === n.value ? root : make(key, value, n.left, n.right);
    if (n.left === null) return n.right;
    if (n.right === null) return n.left;
    let successor = nodes[n.right];
    while (successor.left !== null) successor = nodes[successor.left];
    return balance(successor.key, successor.value, n.left, set(n.right, successor.key, undefined));
  };
  return { nodes, set };
}
function upgrade(pool: LegacyJsonValuePool): JsonValuePool {
  const { nodes, set } = trees();
  const maps: (number | null)[] = [];
  for (const map of pool.maps) {
    let root = map.base === undefined ? null : maps[map.base];
    for (const key of map.removed) root = set(root, key, undefined);
    for (const [key, value] of map.entries) root = set(root, key, value);
    maps.push(root);
  }
  // 旋转和连续更新的中间节点不属于任何历史映射，不能随 checkpoint 累积保存。
  const compactNodes: TreeNode[] = [],
    compactIds = new Map<number, number>();
  const retain = (id: number | null): number | null => {
    if (id === null) return null;
    const existing = compactIds.get(id);
    if (existing !== undefined) return existing;
    const source = nodes[id],
      left = retain(source.left),
      right = retain(source.right);
    const next = compactNodes.length;
    compactNodes.push({ ...source, left, right });
    compactIds.set(id, next);
    return next;
  };
  const compactMaps = maps.map(retain);
  return {
    version: 3,
    values: pool.values,
    nodes: compactNodes,
    maps: compactMaps,
    bindings: pool.bindings,
  };
}
export function encodeJsonValueMaps<T>(
  value: T,
  paths: readonly {
    readonly path: readonly string[];
    readonly group: string;
  }[],
  isImmutable?: (value: object) => boolean,
): { record: T; pool?: JsonValuePool } {
  const encoded = encodeLegacyJsonValueMaps(value, paths, isImmutable);
  return {
    record: encoded.record,
    ...(encoded.pool ? { pool: upgrade(encoded.pool) } : {}),
  };
}
export interface JsonProjectionStats {
  validatedNodes: number;
  validationActions: number;
  validationResultMaps: number;
  validationEntries: number;
  validationMaterializedEntries: number;
  materializedMaps: number;
  materializedEntries: number;
  hashBytes: number;
  logicalHashBytes: number;
}
interface MapView {
  pool: JsonValuePool;
  root: number | null;
  stats: JsonProjectionStats;
  checked: Set<number>;
  origins: Map<ReadonlyMap<number, string>, Map<number, number>>;
}
const views = new WeakMap<object, MapView>();
const projections = new WeakMap<object, JsonProjectionStats>();
function* entries(view: MapView, root = view.root): Generator<[string, unknown]> {
  if (root === null) return;
  const n = view.pool.nodes[root];
  yield* entries(view, n.left);
  yield [n.key, view.pool.values[n.value]];
  yield* entries(view, n.right);
}
function proxy(view: MapView): Record<string, unknown> {
  const find = (key: string) => {
    let id = view.root;
    while (id !== null) {
      const n = view.pool.nodes[id];
      if (key === n.key) return n.value;
      id = key < n.key ? n.left : n.right;
    }
    return undefined;
  };
  const result = new Proxy(
    {},
    {
      ownKeys: () => [...entries(view)].map(([key]) => key),
      get: (_, key) => (typeof key === 'string' ? view.pool.values[find(key) ?? -1] : undefined),
      has: (_, key) => typeof key === 'string' && find(key) !== undefined,
      getOwnPropertyDescriptor: (_, key) =>
        typeof key === 'string' && find(key) !== undefined
          ? {
              value: view.pool.values[find(key)!],
              enumerable: true,
              configurable: true,
              writable: false,
            }
          : undefined,
      set: () => false,
      deleteProperty: () => false,
      defineProperty: () => false,
    },
  );
  views.set(result, view);
  return result;
}
const fail = (message: string): never => {
  throw new Error(message);
};
const index = (x: unknown, n: number): x is number =>
  Number.isSafeInteger(x) && Number(x) >= 0 && Number(x) < n;
function validatePool(raw: unknown): JsonValuePool {
  const p = raw as JsonValuePool;
  if (!p || !Array.isArray(p.values) || !Array.isArray(p.maps) || !Array.isArray(p.bindings))
    return fail('JSON 引用池格式无效');
  if ((raw as { version: number }).version === 1) {
    const old = raw as LegacyJsonValuePool;
    if (Object.keys(old).some((k) => !['version', 'values', 'maps', 'bindings'].includes(k)))
      fail('JSON 引用池字段无效');
    old.maps.forEach((m, i) => {
      if (
        !m ||
        !Array.isArray(m.entries) ||
        !Array.isArray(m.removed) ||
        (m.base !== undefined && !index(m.base, i)) ||
        Object.keys(m).some((k) => !['base', 'entries', 'removed'].includes(k))
      )
        fail('JSON 映射引用无效');
      const keys = new Set<string>();
      for (const k of m.removed) {
        if (typeof k !== 'string' || keys.has(k)) fail('JSON 删除键无效');
        keys.add(k);
      }
      for (const e of m.entries) {
        if (
          !Array.isArray(e) ||
          e.length !== 2 ||
          typeof e[0] !== 'string' ||
          !index(e[1], old.values.length) ||
          keys.has(e[0])
        )
          fail('JSON 值引用无效');
        keys.add(e[0]);
      }
    });
    return validatePool(upgrade(old));
  }
  const pool = raw as JsonValuePool;
  if (
    pool.version !== 3 ||
    !Array.isArray(pool.nodes) ||
    Object.keys(pool).some((k) => !['version', 'values', 'maps', 'bindings', 'nodes'].includes(k))
  )
    return fail('JSON 引用池版本或字段无效');
  const ranges: { min: string; max: string }[] = [];
  pool.nodes.forEach((n, i) => {
    if (
      !n ||
      typeof n.key !== 'string' ||
      !index(n.value, pool.values.length) ||
      ![n.left, n.right].every((v) => v === null || index(v, i)) ||
      Object.keys(n).some((k) => !['key', 'value', 'left', 'right', 'height'].includes(k))
    )
      fail('JSON 树引用无效');
    const l = n.left === null ? undefined : pool.nodes[n.left],
      r = n.right === null ? undefined : pool.nodes[n.right];
    if (
      n.height !== 1 + Math.max(l?.height ?? 0, r?.height ?? 0) ||
      Math.abs((l?.height ?? 0) - (r?.height ?? 0)) > 1 ||
      (n.left !== null && ranges[n.left].max >= n.key) ||
      (n.right !== null && ranges[n.right].min <= n.key)
    )
      fail('JSON 树顺序或平衡无效');
    ranges.push({
      min: n.left === null ? n.key : ranges[n.left].min,
      max: n.right === null ? n.key : ranges[n.right].max,
    });
  });
  if (pool.maps.some((root) => root !== null && !index(root, pool.nodes.length)))
    fail('JSON 映射根无效');
  return pool;
}
export function readJsonValueMapProjection<T>(record: T, raw: unknown) {
  const check = (value: unknown, depth = 0, seen = new Set<object>()): void => {
    if (depth > 64) fail('JSON 数据嵌套过深');
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return;
    if (typeof value !== 'object' || value === null || utilTypes.isProxy(value) || seen.has(value))
      return fail('JSON 数据无效');
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null &&
      !Array.isArray(value)
    )
      fail('JSON 数据必须为普通对象');
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== 'string' || !d.enumerable || !('value' in d))
        fail('JSON 数据不能包含访问器');
      check(d.value, depth + 1, seen);
    }
    if (Array.isArray(value) && Object.keys(value).length !== value.length)
      fail('JSON 数组不能稀疏');
    seen.delete(value);
  };
  check(record);
  check(raw);
  const pool = validatePool(structuredClone(raw));
  const value = structuredClone(record);
  const stats: JsonProjectionStats = {
    validatedNodes: pool.nodes.length,
    validationActions: 0,
    validationResultMaps: 0,
    validationEntries: 0,
    validationMaterializedEntries: 0,
    materializedMaps: 0,
    materializedEntries: 0,
    hashBytes: 0,
    logicalHashBytes: 0,
  };
  const paths = new Set<string>(),
    prefixes = new Set<string>();
  const checked = new Set<number>(),
    origins = new Map<ReadonlyMap<number, string>, Map<number, number>>();
  for (const b of pool.bindings) {
    if (
      !b ||
      !Array.isArray(b.path) ||
      b.path.length < 1 ||
      b.path.length > 16 ||
      b.path.some(
        (k) => typeof k !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(k),
      ) ||
      !index(b.map, pool.maps.length) ||
      Object.keys(b).some((k) => !['path', 'map'].includes(k))
    )
      fail('JSON 池绑定无效');
    const identity = JSON.stringify(b.path);
    if (
      prefixes.has(identity) ||
      b.path.some((_, i) => paths.has(JSON.stringify(b.path.slice(0, i + 1))))
    )
      fail('JSON 池绑定重复或重叠');
    paths.add(identity);
    b.path.forEach((_, i) => prefixes.add(JSON.stringify(b.path.slice(0, i + 1))));
    let parent = value as Record<string, unknown>;
    for (const key of b.path.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key))
        fail('JSON 池绑定缺失');
      parent = parent[key] as Record<string, unknown>;
    }
    const key = b.path.at(-1)!;
    if (
      !parent ||
      !Object.hasOwn(parent, key) ||
      !parent[key] ||
      typeof parent[key] !== 'object' ||
      Array.isArray(parent[key]) ||
      Object.keys(parent[key]).length
    )
      fail('JSON 池绑定必须替换空对象');
    Object.defineProperty(parent, key, {
      value: proxy({ pool, root: pool.maps[b.map], stats, checked, origins }),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const objectHeights = new WeakMap<object, number>();
  const nodeHeights = new Map<number, number>();
  const height = (item: unknown): number => {
    if (!item || typeof item !== 'object') return 0;
    const cached = objectHeights.get(item);
    if (cached !== undefined) return cached;
    const view = views.get(item);
    const treeHeight = (id: number | null): number => {
      if (id === null) return 0;
      const cached = nodeHeights.get(id);
      if (cached !== undefined) return cached;
      const n = pool.nodes[id];
      const result = Math.max(
        1 + height(pool.values[n.value]),
        treeHeight(n.left),
        treeHeight(n.right),
      );
      nodeHeights.set(id, result);
      return result;
    };
    const result = view
      ? treeHeight(view.root)
      : Object.values(item).reduce<number>(
          (maximum, child) => Math.max(maximum, 1 + height(child)),
          0,
        );
    objectHeights.set(item, result);
    return result;
  };
  if (height(value) > 64) fail('JSON 逻辑数据嵌套超过 64 层');
  freezeJsonValueProjection(pool);
  freezeJsonValueProjection(value);

  if (value && typeof value === 'object') projections.set(value, stats);
  return {
    value,
    stats,
    materialize: (path: readonly string[] = []) =>
      materializeJsonValueProjection(
        path.reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], value),
      ),
    hash: () => hashJsonValueProjection(value),
  };
}
/** 仅冻结已经完成 JSON 校验的投影数据，不登记或扩大可信来源。 */
export function freezeJsonValueProjection<T>(value: T): T {
  const frozen = new WeakSet<object>();
  const freeze = (item: unknown): void => {
    // 私有映射视图的虚拟键由只读 Proxy 提供；其底层值在池登记之前已冻结。
    if (!item || typeof item !== 'object' || views.has(item) || frozen.has(item)) return;
    frozen.add(item);
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(value);
  return value;
}
export function materializeJsonValueProjection<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  const view = views.get(value);
  if (view) {
    view.stats.materializedMaps++;
    const e = [...entries(view)];
    view.stats.materializedEntries += e.length;
    return Object.fromEntries(e.map(([k, v]) => [k, materializeJsonValueProjection(v)])) as T;
  }
  if (Array.isArray(value)) return value.map(materializeJsonValueProjection) as T;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, materializeJsonValueProjection(v)]),
  ) as T;
}
export function visitJsonValueMap(
  value: object,
  visitor: (key: string, result: unknown) => void,
): void {
  const view = views.get(value);
  if (!view) {
    for (const [key, item] of Object.entries(value)) visitor(key, item);
    return;
  }
  view.stats.validationResultMaps++;
  const visit = (id: number | null) => {
    if (id === null || view.checked.has(id)) return;
    const n = view.pool.nodes[id];
    visit(n.left);
    visitor(n.key, view.pool.values[n.value]);
    view.stats.validationEntries++;
    visit(n.right);
    view.checked.add(id);
  };
  visit(view.root);
}
export function validateJsonValueMapOrigins(
  value: object,
  sequences: ReadonlyMap<number, string>,
  bound: number,
): void {
  const view = views.get(value);
  const check = (key: string, result: unknown) => {
    const seq = (result as { sequence: number }).sequence;
    if (sequences.get(seq) !== key) fail('WorkflowRun 结果来源不一致');
    return seq;
  };
  if (!view) {
    for (const [key, item] of Object.entries(value))
      if (check(key, item) >= bound) fail('WorkflowRun 结果序号无效');
    return;
  }
  let cache = view.origins.get(sequences);
  if (!cache) {
    cache = new Map();
    view.origins.set(sequences, cache);
  }
  const max = (id: number | null): number => {
    if (id === null) return 0;
    const old = cache!.get(id);
    if (old !== undefined) return old;
    const n = view.pool.nodes[id];
    const result = Math.max(check(n.key, view.pool.values[n.value]), max(n.left), max(n.right));
    cache!.set(id, result);
    return result;
  };
  if (max(view.root) >= bound) fail('WorkflowRun 结果序号无效');
}
function sortedKeys(value: object): string[] {
  return Object.keys(value).sort((a, b) => {
    const index = (s: string) =>
      String(Number(s)) === s &&
      Number.isInteger(Number(s)) &&
      Number(s) >= 0 &&
      Number(s) < 4294967295;
    return index(a) || index(b)
      ? index(a) && index(b)
        ? Number(a) - Number(b)
        : index(a)
          ? -1
          : 1
      : a < b
        ? -1
        : a > b
          ? 1
          : 0;
  });
}
interface HashPrefix {
  hash: Hash;
  next: Map<string, HashPrefix>;
}
const hashPrefixes = new WeakMap<JsonProjectionStats, { root: HashPrefix; size: number }>();
export function hashJsonValueProjection(value: unknown): string {
  let hash = createHash('sha256');
  let stats = value && typeof value === 'object' ? projections.get(value) : undefined;
  const findStats = (v: unknown): JsonProjectionStats | undefined => {
    if (!v || typeof v !== 'object') return;
    const known = views.get(v)?.stats ?? projections.get(v);
    if (known) return known;
    for (const item of Object.values(v)) {
      const found = findStats(item);
      if (found) return found;
    }
    return;
  };
  stats ??= findStats(value);
  let cache = stats ? hashPrefixes.get(stats) : undefined;
  if (stats && !cache) {
    cache = { root: { hash: hash.copy(), next: new Map() }, size: 0 };
    hashPrefixes.set(stats, cache);
  }
  let prefix = cache?.root;
  const write = (s: string) => {
    const bytes = Buffer.byteLength(s);
    if (stats) stats.logicalHashBytes += bytes;
    const existing = prefix?.next.get(s);
    if (existing) {
      hash = existing.hash.copy();
      prefix = existing;
      return;
    }
    hash.update(s);
    if (stats) stats.hashBytes += bytes;
    if (prefix && cache && cache.size < 100000) {
      const next = { hash: hash.copy(), next: new Map<string, HashPrefix>() };
      prefix.next.set(s, next);
      prefix = next;
      cache.size++;
    } else prefix = undefined;
  };
  const visit = (v: unknown) => {
    if (v === null || typeof v !== 'object') {
      write(JSON.stringify(v));
      return;
    }
    if (Array.isArray(v)) {
      write('[');
      v.forEach((x, i) => {
        if (i) write(',');
        visit(x);
      });
      write(']');
      return;
    }
    write('{');
    sortedKeys(v).forEach((key, i) => {
      if (i) write(',');
      write(JSON.stringify(key) + ':');
      visit((v as Record<string, unknown>)[key]);
    });
    write('}');
  };
  visit(value);
  return hash.digest('hex');
}
export function getJsonValueProjectionStats(value: object): JsonProjectionStats | undefined {
  return projections.get(value) ?? views.get(value)?.stats;
}
export function decodeJsonValueMaps<T>(record: T, pool: unknown, materialize = true): T {
  const result = readJsonValueMapProjection(record, pool);
  return materialize ? (result.materialize() as T) : result.value;
}
