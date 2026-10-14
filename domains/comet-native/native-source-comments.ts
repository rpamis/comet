import { createHash } from 'node:crypto';
import path from 'node:path';
import { parse, type ParserPlugin } from '@babel/parser';

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);
const METADATA = new Set([
  'start',
  'end',
  'loc',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'tokens',
]);

function syntaxValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(syntaxValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !METADATA.has(key) && key !== 'parenStart')
        .map(([key, child]) => [key, syntaxValue(child)]),
    );
  }
  return value;
}

/** 仅忽略普通注释；词法、自动分号和工具指令仍参与候选绑定。 */
export function nativeSourceCommentFingerprint(file: string, source: string): string | null {
  const extension = path.extname(file).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(extension) || Buffer.byteLength(source) > 1024 * 1024) return null;
  const plugins: ParserPlugin[] = [];
  if (['.ts', '.mts', '.cts', '.tsx'].includes(extension)) plugins.push('typescript');
  if (['.jsx', '.tsx'].includes(extension)) plugins.push('jsx');
  try {
    const ast = parse(source, {
      sourceType: 'unambiguous',
      plugins,
      tokens: true,
      attachComment: false,
    });
    const directives = (ast.comments ?? [])
      .filter((comment) =>
        /[@#!]|eslint|prettier|istanbul|c8\s+ignore|v8\s+ignore|webpack|vite|rollup|source(?:Mapping)?URL|<reference|::/iu.test(
          comment.value,
        ),
      )
      .map((comment) => ({ value: comment.value, loc: comment.loc }));
    const tokens = (ast.tokens ?? [])
      .filter((token) => typeof token.type !== 'string' || !token.type.startsWith('Comment'))
      .map((token) => source.slice(token.start, token.end));
    return createHash('sha256')
      .update(JSON.stringify({ syntax: syntaxValue(ast.program), tokens, directives }))
      .digest('hex');
  } catch {
    // 不支持的语法或无法完整解析的输入继续使用真实内容 hash。
    return null;
  }
}

export function supportsNativeSourceComments(file: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export function isNativeOrdinaryCommentEdit(file: string, before: string, after: string): boolean {
  if (before === after) return true;
  const fingerprint = nativeSourceCommentFingerprint(file, before);
  return fingerprint !== null && fingerprint === nativeSourceCommentFingerprint(file, after);
}
