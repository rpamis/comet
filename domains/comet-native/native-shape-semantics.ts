import { editSemanticFingerprint } from '../workflow-contract/edit-impact.js';
import { createHash } from 'node:crypto';
import { Lexer, type Tokens } from 'marked';
import { canonicalHash } from './native-canonical-hash.js';

export interface NativeShapeArtifactSnapshot {
  source: string;
  contentHash: string;
  inputHash: string;
  legacyFingerprint: string | null;
  contractHash: string;
  commentsHash: string;
  auxiliary: Array<{ kind: 'test-plan-line'; key: string; value: string }>;
}

export interface NativeShapeSemanticSnapshot {
  schema: 'comet.native.shape-semantics.v1';
  artifacts: NativeShapeArtifactSnapshot[];
}

const FIELDS = new Set([
  'type',
  'text',
  'tokens',
  'depth',
  'ordered',
  'start',
  'loose',
  'items',
  'task',
  'checked',
  'href',
  'title',
  'tag',
  'lang',
  'codeBlockStyle',
  'escaped',
  'pre',
  'block',
  'inLink',
  'inRawBlock',
  'align',
  'header',
  'rows',
]);
const HASH = /^[a-f0-9]{64}$/u;
const LINE = /^(?:planned|pending|待补充|待填写|[1-9]\d*(?:\s*[-–:]\s*[1-9]\d*)?)$/iu;

/** 只划分可明确识别的辅助字段；未知章节、表格和注释均不能自行获得豁免。 */
export function nativeShapeArtifactSnapshot(
  source: string,
  text: string,
): NativeShapeArtifactSnapshot {
  const tokens = Lexer.lex(text.replace(/\r\n?/gu, '\n'));
  const auxiliary: NativeShapeArtifactSnapshot['auxiliary'] = [];
  const comments: unknown[] = [];
  let planDepth: number | null = null;
  let tableIndex = 0;
  for (const token of tokens) {
    if (token.type === 'heading') {
      if (planDepth !== null && token.depth <= planDepth) planDepth = null;
      if (/^(?:test(?:ing)? plan|测试计划|Spec → 测试名与断言计划)$/iu.test(token.text.trim()))
        planDepth = token.depth;
    }
    if (token.type !== 'table' || planDepth === null) continue;
    const table = token as Tokens.Table;
    const columns = table.header.flatMap((cell, index) =>
      /^(?:line|line number|行号|计划行号)$/iu.test(cell.text.trim()) ? [index] : [],
    );
    if (columns.length !== 1) continue;
    const column = columns[0];
    for (const [rowIndex, row] of table.rows.entries()) {
      const cell = row[column];
      if (!cell || cell.text.trim().length > 64 || !LINE.test(cell.text.trim())) continue;
      const key = `${tableIndex}/${rowIndex}/${column}`;
      auxiliary.push({ kind: 'test-plan-line', key, value: cell.text.trim() });
      cell.text = '<approved-test-plan-line>';
      cell.tokens = [{ type: 'text', raw: cell.text, text: cell.text }];
    }
    tableIndex += 1;
  }
  const normalize = (
    value: unknown,
    prose = false,
    trimTrailing = false,
    structuralPath: Array<string | number> = [],
  ): unknown => {
    if (Array.isArray(value)) {
      const normalized: unknown[] = [];
      for (const [index, item] of value.entries()) {
        if (item?.type === 'space') continue;
        // 注释绑定去掉空白与注释后的 AST 路径；跨章节或节点移动也必须复核。
        if (
          (item?.type === 'html' && /^\s*<!--(?:(?!-->)[\s\S])*-->\s*$/u.test(item.text)) ||
          (item?.type === 'def' && item.tag === '//' && item.href === '#')
        ) {
          comments.push({
            path: [...structuralPath, normalized.length],
            type: item.type,
            text: item.text ?? item.title ?? '',
            tag: item.tag ?? null,
          });
          continue;
        }
        normalized.push(
          normalize(item, prose, index === value.length - 1, [
            ...structuralPath,
            normalized.length,
          ]),
        );
      }
      return normalized;
    }
    if (value && typeof value === 'object') {
      const token = value as Record<string, unknown>;
      const proseToken = !['code', 'codespan', 'html'].includes(String(token.type));
      return Object.fromEntries(
        Object.entries(token)
          .filter(([key]) => FIELDS.has(key) && !(key === 'text' && Array.isArray(token.tokens)))
          .map(([key, child]) => {
            if (key === 'text' && token.type === 'text' && typeof child === 'string' && prose) {
              const text = child.replace(/[\t ]*\n[\t ]*/gu, ' ');
              return [key, trimTrailing ? text.replace(/[\t ]+$/u, '') : text];
            }
            return [key, normalize(child, proseToken, false, [...structuralPath, key])];
          }),
      );
    }
    return value;
  };
  const contract = normalize(tokens);
  return {
    source,
    contentHash: createHash('sha256').update(text).digest('hex'),
    inputHash: createHash('sha256').update(Buffer.from(text).toString('base64')).digest('hex'),
    legacyFingerprint: editSemanticFingerprint(source, text),
    contractHash: canonicalHash('comet.native.shape-contract.v1', contract),
    commentsHash: canonicalHash('comet.native.shape-comments.v1', comments),
    auxiliary,
  };
}

export function nativeShapeArtifactContractHash(artifact: NativeShapeArtifactSnapshot): string {
  return canonicalHash('comet.native.shape-semantic-artifact.v1', {
    contractHash: artifact.contractHash,
    commentsHash: artifact.commentsHash,
    auxiliary: artifact.auxiliary.map(({ kind, key }) => ({ kind, key })),
  });
}

export function parseNativeShapeSemanticSnapshot(value: unknown): NativeShapeSemanticSnapshot {
  const snapshot = value as NativeShapeSemanticSnapshot;
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    Object.keys(snapshot).sort().join(',') !== 'artifacts,schema' ||
    snapshot.schema !== 'comet.native.shape-semantics.v1' ||
    !Array.isArray(snapshot.artifacts) ||
    snapshot.artifacts.length === 0 ||
    snapshot.artifacts.length > 1025
  )
    throw new Error('Native Shape semantic snapshot is invalid');
  const sources = new Set<string>();
  for (const artifact of snapshot.artifacts) {
    if (
      !artifact ||
      typeof artifact !== 'object' ||
      Array.isArray(artifact) ||
      Object.keys(artifact).sort().join(',') !==
        'auxiliary,commentsHash,contentHash,contractHash,inputHash,legacyFingerprint,source' ||
      typeof artifact.source !== 'string' ||
      !/^(?:brief\.md|specs\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/spec\.md)$/u.test(artifact.source) ||
      sources.has(artifact.source) ||
      typeof artifact.contentHash !== 'string' ||
      typeof artifact.inputHash !== 'string' ||
      typeof artifact.contractHash !== 'string' ||
      typeof artifact.commentsHash !== 'string' ||
      (artifact.legacyFingerprint !== null &&
        (typeof artifact.legacyFingerprint !== 'string' ||
          !HASH.test(artifact.legacyFingerprint))) ||
      !HASH.test(artifact.contentHash) ||
      !HASH.test(artifact.inputHash) ||
      !HASH.test(artifact.contractHash) ||
      !HASH.test(artifact.commentsHash) ||
      !Array.isArray(artifact.auxiliary) ||
      artifact.auxiliary.length > 4096
    )
      throw new Error('Native Shape artifact snapshot is invalid');
    sources.add(artifact.source);
    const keys = new Set<string>();
    for (const field of artifact.auxiliary) {
      if (
        !field ||
        Object.keys(field).sort().join(',') !== 'key,kind,value' ||
        field.kind !== 'test-plan-line' ||
        typeof field.key !== 'string' ||
        !/^\d+\/\d+\/\d+$/u.test(field.key) ||
        keys.has(field.key) ||
        typeof field.value !== 'string' ||
        field.value.length > 64 ||
        !LINE.test(field.value)
      )
        throw new Error('Native Shape auxiliary field is invalid');
      keys.add(field.key);
    }
  }
  return structuredClone(snapshot);
}
