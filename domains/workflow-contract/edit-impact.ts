import { createHash } from 'node:crypto';
import path from 'node:path';
import { parse as parseJavaScript, type ParserPlugin } from '@babel/parser';
import { parseDocument, visit } from 'yaml';
import { parse as parseToml } from 'smol-toml';
import { Lexer } from 'marked';
import { isAgentInstructionPath } from './neutral-document-path.js';

export type EditImpactKind =
  | 'unchanged'
  | 'non-behavioral'
  | 'implementation-changed'
  | 'requirements-changed'
  | 'review-required';
export interface EditImpact {
  kind: EditImpactKind;
  reason: string;
  fingerprint: string | null;
}
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);
const DATA_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml']);
const COMMENT_DIRECTIVE =
  /[@#!]|eslint|prettier|istanbul|c8\s+ignore|v8\s+ignore|webpack|vite|rollup|yamllint|yaml-language-server|shellcheck|source(?:Mapping)?URL|<reference|::/iu;
const METADATA = new Set([
  'start',
  'end',
  'loc',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'tokens',
  'parenStart',
]);
const ATTACHED_COMMENTS = new Set(['leadingComments', 'trailingComments', 'innerComments']);
const GLOBAL_DIRECTIVE =
  /@ts-(?:no)?check\b|(?:istanbul|c8|v8)\s+ignore\s+file|source(?:Mapping)?URL|<reference\b/iu;
const LINE_DIRECTIVE =
  /next[- ]line|@ts-(?:ignore|expect-error)|eslint-disable-line|(?:istanbul|c8|v8)\s+ignore\s+next/iu;

export function editContentHash(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}
export function supportsEditFingerprint(file: string): boolean {
  const extension = path.extname(file).toLowerCase();
  return (
    SOURCE_EXTENSIONS.has(extension) ||
    DATA_EXTENSIONS.has(extension) ||
    ['.md', '.markdown'].includes(extension)
  );
}

function syntaxValue(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) return value.map((child) => syntaxValue(child));
  if (value && typeof value === 'object') {
    const node = value as { loc?: { start: { line: number }; end: { line: number } } };
    const normalized = Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !METADATA.has(key) &&
            !(parentKey === 'extra' && ['raw', 'rawValue', 'parenthesized'].includes(key)),
        )
        .map(([key, child]) => [key, syntaxValue(child, key)]),
    );
    for (const key of ATTACHED_COMMENTS) {
      const comments = (value as Record<string, unknown>)[key];
      if (!Array.isArray(comments)) continue;
      // 指令与其语法节点、相邻行绑定；前面增加普通说明不改变指令的作用对象。
      const directives = comments
        .filter(
          (comment) =>
            COMMENT_DIRECTIVE.test(comment.value) && !GLOBAL_DIRECTIVE.test(comment.value),
        )
        .map((comment) => ({
          type: comment.type,
          value: comment.value,
          ...(LINE_DIRECTIVE.test(comment.value)
            ? {
                lineOffset:
                  key === 'trailingComments'
                    ? comment.loc.start.line - (node.loc?.end.line ?? 0)
                    : (node.loc?.start.line ?? 0) - comment.loc.end.line,
              }
            : {}),
        }));
      if (directives.length) normalized[key] = directives;
    }
    return normalized;
  }
  return value;
}
function markdownValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.filter((entry) => entry?.type !== 'space').map(markdownValue);
  if (value && typeof value === 'object') {
    const token = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(token)
        .filter(([key]) => key !== 'raw' && !(key === 'text' && Array.isArray(token.tokens)))
        .map(([key, child]) => [
          key,
          key === 'text' && token.type === 'text' && typeof child === 'string'
            ? child.replace(/[\t ]*\n[\t ]*/gu, ' ')
            : markdownValue(child),
        ]),
    );
  }
  return value;
}

function dataValue(value: unknown): unknown {
  if (typeof value === 'number')
    return {
      type: 'number',
      value: Number.isNaN(value)
        ? 'NaN'
        : value === Infinity
          ? '+Infinity'
          : value === -Infinity
            ? '-Infinity'
            : Object.is(value, -0)
              ? '-0'
              : value,
    };
  if (typeof value === 'bigint') return { type: 'bigint', value: String(value) };
  if (value instanceof Date) return { type: 'date', value: value.toJSON() };
  if (Array.isArray(value)) return { type: 'array', value: value.map(dataValue) };
  if (value && typeof value === 'object')
    return {
      type: 'object',
      value: Object.entries(value).map(([key, child]) => [key, dataValue(child)]),
    };
  return { type: typeof value, value };
}

/** 只判定可由本地解析证明的排版或普通注释；模板 raw、类型和工具指令仍保持绑定。 */
export function editSemanticFingerprint(file: string, source: string): string | null {
  if (isAgentInstructionPath(file)) return null;
  if (Buffer.byteLength(source) > 1024 * 1024) return null;
  const extension = path.extname(file).toLowerCase();
  try {
    let value: unknown;
    if (SOURCE_EXTENSIONS.has(extension)) {
      const plugins: ParserPlugin[] = [];
      if (['.ts', '.mts', '.cts', '.tsx'].includes(extension)) plugins.push('typescript');
      if (['.jsx', '.tsx'].includes(extension)) plugins.push('jsx');
      const ast = parseJavaScript(source, {
        sourceType: extension === '.cjs' ? 'commonjs' : 'unambiguous',
        plugins,
        attachComment: true,
      });
      value = {
        syntax: syntaxValue(ast.program),
        directives: (ast.comments ?? [])
          .filter((comment) => COMMENT_DIRECTIVE.test(comment.value))
          .map((comment) => ({
            type: comment.type,
            value: comment.value,
            ...(GLOBAL_DIRECTIVE.test(comment.value)
              ? { beforeCode: (comment.end ?? 0) <= (ast.program.body[0]?.start ?? source.length) }
              : {}),
          })),
      };
    } else if (extension === '.json') {
      const document = parseDocument(source, { uniqueKeys: true });
      if (document.errors.length) return null;
      value = dataValue(JSON.parse(source));
    } else if (extension === '.yaml' || extension === '.yml') {
      const document = parseDocument(source, { uniqueKeys: true });
      if (document.errors.length || document.warnings.length) return null;
      const annotations: unknown[] = [];
      visit(document, (_, node) => {
        if (node && typeof node === 'object') {
          if ('anchor' in node && node.anchor) annotations.push({ anchor: node.anchor });
          if ('tag' in node && node.tag) annotations.push({ tag: node.tag });
          if ('source' in node && typeof node.source === 'string')
            annotations.push({ alias: node.source });
        }
      });
      value = {
        data: dataValue(document.toJS({ maxAliasCount: 100 })),
        directives: document.directives,
        annotations,
        controls: source
          .split(/\r?\n/u)
          .filter((line) => line.includes('#') && COMMENT_DIRECTIVE.test(line.replace('#', ''))),
      };
    } else if (extension === '.toml') {
      value = {
        data: dataValue(parseToml(source)),
        controls: source
          .split(/\r?\n/u)
          .filter((line) => line.includes('#') && COMMENT_DIRECTIVE.test(line.replace('#', ''))),
      };
    } else if (extension === '.md' || extension === '.markdown')
      value = markdownValue(Lexer.lex(source.replace(/\r\n?/gu, '\n')));
    else return null;
    return editContentHash(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function classifyEditImpact(
  file: string,
  before: string,
  after: string,
  options: { formal?: boolean } = {},
): EditImpact {
  const previous = editSemanticFingerprint(file, before);
  if (before === after)
    return { kind: 'unchanged', reason: '文件内容未改变', fingerprint: previous };
  const current = editSemanticFingerprint(file, after);
  if (options.formal)
    return {
      kind: 'requirements-changed',
      reason: '正式需求或验收材料发生内容变化，需要原工作流确认',
      fingerprint: current,
    };
  if (isAgentInstructionPath(file))
    return {
      kind: 'implementation-changed',
      reason: 'Agent 执行指令发生变化',
      fingerprint: current,
    };
  // 解析器只提供等价证据。结构不同或格式未知都不能据此判断行为影响。
  if (previous !== null && previous === current)
    return { kind: 'non-behavioral', reason: '解析后的结构和有效值未改变', fingerprint: current };
  return {
    kind: 'review-required',
    reason: '本地无法证明行为等价，需要结合具体差异、文件用途和验收条件复核',
    fingerprint: current,
  };
}
