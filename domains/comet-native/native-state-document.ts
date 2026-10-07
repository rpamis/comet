import { parseDocument, stringify } from 'yaml';

import { PORTABLE_RUN_CHECKPOINT_KEY } from '../engine/runtime.js';

export const NATIVE_MANAGED_RUN_MARKER = '# comet-execution: managed-run\n';
const CHECKPOINT_LINE = `\n${PORTABLE_RUN_CHECKPOINT_KEY}: `;

function parseYamlDocument(source: string, label: string): unknown {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`${label} is invalid YAML: ${document.errors[0].message}`);
  }
  return document.toJS({ mapAsMap: false });
}

/** 普通状态保留 YAML；Runtime 生成的末行 checkpoint 是兼容 YAML 的 JSON 对象。 */
export function parseNativeStateDocument(source: string, label: string): unknown {
  const offset = source.lastIndexOf(CHECKPOINT_LINE);
  if (source.startsWith(NATIVE_MANAGED_RUN_MARKER) && offset >= 0 && source.endsWith('\n')) {
    const serialized = source.slice(offset + CHECKPOINT_LINE.length, -1);
    try {
      const checkpoint: unknown = JSON.parse(serialized);
      // 逐字往返排除重复 JSON key、非标准空白或表示差异；这些情况仍完整解析 YAML。
      if (JSON.stringify(checkpoint) === serialized) {
        const prefix = source.slice(0, offset + 1);
        const data = parseYamlDocument(prefix, label);
        if (
          data &&
          typeof data === 'object' &&
          !Array.isArray(data) &&
          !Object.hasOwn(data, PORTABLE_RUN_CHECKPOINT_KEY) &&
          // 完整前缀也须由 Runtime 生成，避免把 ... 终止符或第二个文档截去后误接 checkpoint。
          NATIVE_MANAGED_RUN_MARKER + stringify(data) === prefix
        ) {
          return { ...data, [PORTABLE_RUN_CHECKPOINT_KEY]: checkpoint };
        }
      }
    } catch {
      // 用户编辑、注释、anchor 和旧格式均沿用原来的严格 YAML 解析。
    }
  }
  return parseYamlDocument(source, label);
}
