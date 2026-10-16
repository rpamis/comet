import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { RuntimeProtocolError } from './runtime-errors.js';

export type RuntimeValue =
  | null
  | boolean
  | number
  | string
  | RuntimeValue[]
  | {
      [key: string]: RuntimeValue;
    };

/** 只接受无损、无执行行为的 JSON 数据；字段排序使输入绑定不依赖属性插入顺序。 */
function normalizeRuntimeValue(value: unknown, copy = true, serialize = false): RuntimeValue {
  const ancestors = new Set<object>();
  const templates = new WeakMap<object, { value: RuntimeValue; height: number }>();
  function normalize(current: unknown, depth: number): RuntimeValue {
    if (depth > 64) throw new RuntimeProtocolError('INVALID_JSON', '数据嵌套超过 64 层');
    if (current === null || typeof current === 'string' || typeof current === 'boolean') {
      return serialize ? JSON.stringify(current) : current;
    }
    // 保持 JSON 往返的数值语义，避免直接返回规范化副本时保留 -0。
    if (typeof current === 'number' && Number.isFinite(current))
      return serialize ? JSON.stringify(current) : current === 0 ? 0 : current;
    if (typeof current !== 'object' || current === null) {
      throw new RuntimeProtocolError('INVALID_JSON', '数据必须能无损保存为 JSON');
    }
    if (ancestors.has(current)) throw new RuntimeProtocolError('INVALID_JSON', '数据包含循环引用');
    if (utilTypes.isProxy(current))
      throw new RuntimeProtocolError('INVALID_JSON', '仅接受无执行行为的 JSON 数据');
    const template = templates.get(current);
    if (template) {
      if (depth + template.height > 64)
        throw new RuntimeProtocolError('INVALID_JSON', '数据嵌套超过 64 层');
      return copy
        ? copyRuntimeSnapshot(template.value)
        : serialize
          ? template.value
          : (current as RuntimeValue);
    }
    ancestors.add(current);
    let height = 0;
    const childHeight = (child: unknown) =>
      child && typeof child === 'object' ? (templates.get(child)?.height ?? 0) : 0;
    const completed = (value: RuntimeValue) => {
      templates.set(current, { value, height });
      return value;
    };
    try {
      if (Array.isArray(current)) {
        if (Reflect.ownKeys(current).length !== current.length + 1) {
          throw new RuntimeProtocolError('INVALID_JSON', '数组不能包含空洞或额外属性');
        }
        const values: RuntimeValue[] = [];
        for (let index = 0; index < current.length; index += 1) {
          const property = Object.getOwnPropertyDescriptor(current, String(index));
          if (!property || !('value' in property)) {
            throw new RuntimeProtocolError('INVALID_JSON', '数组元素必须是普通数据');
          }
          const normalized = normalize(property.value, depth + 1);
          height = Math.max(height, 1 + childHeight(property.value));
          if (copy || serialize) values.push(normalized);
        }
        return completed(
          serialize ? `[${values.join(',')}]` : copy ? values : (current as RuntimeValue[]),
        );
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new RuntimeProtocolError('INVALID_JSON', '仅接受普通 JSON 对象');
      }
      const entries: [string, RuntimeValue][] = [];
      const keys = Reflect.ownKeys(current);
      if (copy || serialize)
        keys.sort((a, b) => {
          const left = String(a),
            right = String(b);
          const leftIndex =
            String(Number(left)) === left &&
            Number.isInteger(Number(left)) &&
            Number(left) >= 0 &&
            Number(left) < 4294967295;
          const rightIndex =
            String(Number(right)) === right &&
            Number.isInteger(Number(right)) &&
            Number(right) >= 0 &&
            Number(right) < 4294967295;
          if (leftIndex || rightIndex)
            return leftIndex && rightIndex ? Number(left) - Number(right) : leftIndex ? -1 : 1;
          return left < right ? -1 : left > right ? 1 : 0;
        });
      for (const key of keys) {
        const property = Object.getOwnPropertyDescriptor(current, key)!;
        if (typeof key !== 'string' || !property.enumerable || !('value' in property)) {
          throw new RuntimeProtocolError('INVALID_JSON', '对象属性必须是可枚举的字符串数据属性');
        }
        const normalized = normalize(property.value, depth + 1);
        height = Math.max(height, 1 + childHeight(property.value));
        if (copy || serialize) entries.push([key, normalized]);
      }
      return completed(
        serialize
          ? `{${entries.map(([key, encoded]) => `${JSON.stringify(key)}:${encoded}`).join(',')}}`
          : copy
            ? Object.fromEntries(entries)
            : (current as RuntimeValue),
      );
    } finally {
      ancestors.delete(current);
    }
  }
  return normalize(value, 0);
}

export function canonicalRuntimeJson(value: unknown): string {
  return normalizeRuntimeValue(value, false, true) as string;
}

export function cloneRuntimeValue(value: unknown): RuntimeValue {
  return normalizeRuntimeValue(value);
}

/** 仅复制调用内已经校验的 JSON 快照；外部输入仍须使用 cloneRuntimeValue。 */
export function copyRuntimeSnapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index++)
      result.push(copyRuntimeSnapshot(value[index]));
    return result as T;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const copied = copyRuntimeSnapshot((value as Record<string, unknown>)[key]);
    if (key === '__proto__')
      Object.defineProperty(result, key, {
        value: copied,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    else result[key] = copied;
  }
  return result as T;
}

/** 校验已解析的记录，不创建随后会被丢弃的完整副本或 JSON 字符串。 */
export function validateRuntimeValue(value: unknown): void {
  normalizeRuntimeValue(value, false);
}

export function hashRuntimeValue(value: unknown): string {
  return createHash('sha256').update(canonicalRuntimeJson(value)).digest('hex');
}
