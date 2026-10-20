export interface JsonValuePool {
  readonly version: 1;
  readonly values: readonly unknown[];
  readonly maps: readonly {
    readonly base?: number;
    readonly entries: readonly (readonly [string, number])[];
    readonly removed: readonly string[];
  }[];
  readonly bindings: readonly { readonly path: readonly string[]; readonly map: number }[];
}

interface SharedMapNode {
  base?: SharedMapNode;
  entries: [string, unknown][];
  removed: string[];
}
const immutableMaps = new WeakMap<object, SharedMapNode>();

/** 输入由调用方先按 JSON 契约校验。字段仍保留原位，公共协议无需识别内部引用。 */
export function encodeJsonValueMaps<T>(
  value: T,
  paths: readonly { readonly path: readonly string[]; readonly group: string }[],
  isImmutable?: (value: object) => boolean,
): { record: T; pool?: JsonValuePool } {
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
              ([key, item]) => !Object.hasOwn(prior.source, key) || prior.source[key] !== item,
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
      sharedPrevious.set(binding.group, { source: current as Record<string, unknown>, node });
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

export function decodeJsonValueMaps<T>(record: T, value: unknown, materialize = true): T {
  const pool = value as JsonValuePool;
  if (
    !pool ||
    pool.version !== 1 ||
    !Array.isArray(pool.values) ||
    !Array.isArray(pool.maps) ||
    !Array.isArray(pool.bindings) ||
    Object.keys(pool).some((key) => !['version', 'values', 'maps', 'bindings'].includes(key))
  )
    throw new Error('Invalid JSON value pool');
  const maps: Record<string, unknown>[] = [];
  const index = (value: unknown, limit: number): value is number =>
    Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < limit;
  for (const node of pool.maps) {
    if (
      !node ||
      !Array.isArray(node.entries) ||
      !Array.isArray(node.removed) ||
      Object.keys(node).some((key) => !['base', 'entries', 'removed'].includes(key)) ||
      (node.base !== undefined && !index(node.base, maps.length))
    )
      throw new Error('Invalid JSON map reference');
    const map = !materialize || node.base === undefined ? {} : { ...maps[node.base] };
    const keys = new Set<string>();
    for (const key of node.removed) {
      if (typeof key !== 'string' || keys.has(key)) throw new Error('Invalid removed JSON map key');
      keys.add(key);
      delete map[key];
    }
    for (const entry of node.entries) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        !index(entry[1], pool.values.length) ||
        keys.has(entry[0])
      )
        throw new Error('Invalid JSON value reference');
      keys.add(entry[0]);
      if (materialize)
        Object.defineProperty(map, entry[0], {
          value: pool.values[entry[1]],
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    maps.push(map);
  }
  const restored = structuredClone(record);
  const paths = new Set<string>();
  for (const binding of pool.bindings) {
    if (
      !binding ||
      !Array.isArray(binding.path) ||
      binding.path.length < 1 ||
      binding.path.length > 16 ||
      binding.path.some(
        (field: unknown) =>
          typeof field !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(field),
      ) ||
      !index(binding.map, maps.length) ||
      Object.keys(binding).some((key) => !['path', 'map'].includes(key))
    )
      throw new Error('Invalid JSON pool binding');
    const identity = JSON.stringify(binding.path);
    if (paths.has(identity)) throw new Error('Duplicate JSON pool binding');
    paths.add(identity);
    let parent = restored as unknown as Record<string, unknown>;
    for (const field of binding.path.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, field))
        throw new Error('Missing JSON pool binding');
      parent = parent[field] as Record<string, unknown>;
    }
    const field = binding.path.at(-1)!;
    if (
      !parent ||
      typeof parent !== 'object' ||
      !Object.hasOwn(parent, field) ||
      !parent[field] ||
      typeof parent[field] !== 'object' ||
      Array.isArray(parent[field]) ||
      Object.keys(parent[field]).length
    )
      throw new Error('JSON pool binding must replace an empty object');
    Object.defineProperty(parent, field, {
      value: materialize ? maps[binding.map] : {},
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return restored;
}
