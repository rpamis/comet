import { Lexer, Tokenizer, walkTokens } from 'marked';
import { applicationError } from './skill-adapter.js';

interface TargetSpan {
  start: number;
  end: number;
  angled: boolean;
}
function bracketEnd(raw: string): number {
  let depth = 0;
  for (let index = raw.startsWith('!') ? 1 : 0; index < raw.length; index++) {
    if (raw[index] === '\\') {
      index++;
      continue;
    }
    if (raw[index] === '[') depth++;
    if (raw[index] === ']' && --depth === 0) return index;
  }
  return -1;
}
function targetSpan(raw: string, definition = false): TargetSpan | null {
  const bracket = bracketEnd(raw);
  if (bracket < 0 || raw[bracket + 1] !== (definition ? ':' : '(')) return null;
  let start = bracket + 2;
  while (/\s/u.test(raw[start] ?? '') && start < raw.length) start++;
  if (raw[start] === '<') {
    let end = start + 1;
    while (end < raw.length) {
      if (raw[end] === '\\') {
        end += 2;
        continue;
      }
      if (raw[end] === '>') return { start: start + 1, end, angled: true };
      end++;
    }
    return null;
  }
  let end = start;
  let depth = 0;
  while (end < raw.length) {
    if (raw[end] === '\\') {
      end += 2;
      continue;
    }
    if (/\s/u.test(raw[end]) && (definition || depth === 0)) break;
    if (!definition && raw[end] === ')' && depth === 0) break;
    if (raw[end] === '(') depth++;
    else if (raw[end] === ')') depth--;
    end++;
  }
  return { start, end, angled: false };
}

/** 改写资源目标时保留 Agent 正文、标题、引用定义和代码示例；校验回调可返回原目标。 */
export function rewriteMarkdownResourceLinks(
  content: string,
  rewriteTarget: (target: string) => string,
): string {
  const offsets: number[] = [];
  let normalized = '';
  for (let index = 0; index < content.length; index++) {
    offsets.push(index);
    if (content[index] === '\r') {
      normalized += '\n';
      if (content[index + 1] === '\n') index++;
    } else normalized += content[index];
  }
  offsets.push(content.length);
  const tokenizer = new Tokenizer();
  const lexer = new Lexer({ tokenizer });
  const tokens = lexer.lex(normalized);
  const excluded: Array<[number, number]> = [];
  let unquoted = '';
  const quoteOffsets: number[] = [];
  let lineOffset = 0;
  for (const line of normalized.split(/(?<=\n)/u)) {
    const prefix = /^(?: {0,3}> ?)+/u.exec(line)?.[0].length ?? 0;
    for (let index = prefix; index < line.length; index++) {
      quoteOffsets.push(lineOffset + index);
      unquoted += line[index];
    }
    lineOffset += line.length;
  }
  quoteOffsets.push(normalized.length);
  const inline: Array<{ raw: string; href: string }> = [];
  const occurrences = (raw: string): number[] => {
    const result: number[] = [];
    for (
      let at = normalized.indexOf(raw);
      raw && at >= 0;
      at = normalized.indexOf(raw, at + raw.length)
    )
      result.push(at);
    return result;
  };
  const referenceId = (id: string) => id.trim().replace(/\s+/gu, ' ').toLowerCase();
  walkTokens(tokens, (token) => {
    if (token.type === 'code' || token.type === 'codespan') {
      for (const at of occurrences(token.raw)) excluded.push([at, at + token.raw.length]);
      for (
        let at = unquoted.indexOf(token.raw);
        token.raw && at >= 0;
        at = unquoted.indexOf(token.raw, at + token.raw.length)
      )
        excluded.push([quoteOffsets[at], quoteOffsets[at + token.raw.length]]);
    }
    if (token.type === 'link' || token.type === 'image')
      inline.push({ raw: token.raw, href: token.href });
    if (token.type === 'text')
      for (const match of token.raw.matchAll(/!?\[([^\]]+)\]\[([^\]]*)\]/gu)) {
        const id = referenceId(match[2] || match[1]);
        if (!Object.hasOwn(tokens.links, id))
          applicationError(`Markdown 资源引用没有对应定义：${id}`);
      }
  });
  const inCode = (at: number) => excluded.some(([start, end]) => at >= start && at < end);
  const escaped = (at: number) => {
    let slashes = 0;
    for (let index = at - 1; index >= 0 && normalized[index] === '\\'; index--) slashes++;
    return slashes % 2 !== 0;
  };
  const edits = new Map<number, { end: number; replacement: string }>();
  const edit = (at: number, span: TargetSpan, target: string) => {
    const replacement = rewriteTarget(target);
    if (replacement === target) return;
    edits.set(offsets[at + span.start], {
      end: offsets[at + span.end],
      replacement: !span.angled && /\s/u.test(replacement) ? `<${replacement}>` : replacement,
    });
  };
  const seenDefinitions = new Set<string>();
  for (const match of normalized.matchAll(/^ {0,3}\[/gmu)) {
    const at = match.index;
    if (inCode(at)) continue;
    const definition = tokenizer.def(normalized.slice(at));
    if (!definition || seenDefinitions.has(definition.tag)) continue;
    const span = targetSpan(definition.raw, true);
    if (!span) continue;
    seenDefinitions.add(definition.tag);
    edit(at, span, definition.href);
  }
  for (const link of inline) {
    const span = targetSpan(link.raw);
    if (!span) continue;
    for (const at of occurrences(link.raw))
      if (!inCode(at) && !escaped(at)) edit(at, span, link.href);
  }
  let result = content;
  for (const [start, { end, replacement }] of [...edits.entries()].sort(
    ([left], [right]) => right - left,
  ))
    result = result.slice(0, start) + replacement + result.slice(end);
  return result;
}
