import { createHash } from 'node:crypto';
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
export function canonicalRuntimeJson(value: unknown): string {
  const ancestors = new Set<object>();
  function normalize(current: unknown, depth: number): RuntimeValue {
    if (depth > 64) throw new RuntimeProtocolError('INVALID_JSON', '数据嵌套超过 64 层');
    if (current === null || typeof current === 'string' || typeof current === 'boolean') {
      return current;
    }
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (typeof current !== 'object' || current === null) {
      throw new RuntimeProtocolError('INVALID_JSON', '数据必须能无损保存为 JSON');
    }
    if (ancestors.has(current)) throw new RuntimeProtocolError('INVALID_JSON', '数据包含循环引用');
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Reflect.ownKeys(current).length !== current.length + 1) {
          throw new RuntimeProtocolError('INVALID_JSON', '数组不能包含空洞或额外属性');
        }
        return Array.from({ length: current.length }, (_, index) => {
          const property = Object.getOwnPropertyDescriptor(current, String(index));
          if (!property || !('value' in property)) {
            throw new RuntimeProtocolError('INVALID_JSON', '数组元素必须是普通数据');
          }
          return normalize(property.value, depth + 1);
        });
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new RuntimeProtocolError('INVALID_JSON', '仅接受普通 JSON 对象');
      }
      const entries: [string, RuntimeValue][] = [];
      for (const key of Reflect.ownKeys(current).sort((a, b) =>
        String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
      )) {
        const property = Object.getOwnPropertyDescriptor(current, key)!;
        if (typeof key !== 'string' || !property.enumerable || !('value' in property)) {
          throw new RuntimeProtocolError('INVALID_JSON', '对象属性必须是可枚举的字符串数据属性');
        }
        entries.push([key, normalize(property.value, depth + 1)]);
      }
      return Object.fromEntries(entries);
    } finally {
      ancestors.delete(current);
    }
  }
  return JSON.stringify(normalize(value, 0));
}

export function cloneRuntimeValue(value: unknown): RuntimeValue {
  return JSON.parse(canonicalRuntimeJson(value)) as RuntimeValue;
}

export function hashRuntimeValue(value: unknown): string {
  return createHash('sha256').update(canonicalRuntimeJson(value)).digest('hex');
}
