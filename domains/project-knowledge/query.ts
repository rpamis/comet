import type { ProjectKnowledgeQuery } from './types.js';

const MAX_TASK_CHARS = 2000;
export const PROJECT_KNOWLEDGE_QUERY_BUDGETS = {
  strong: 8,
  phrase: 8,
  weak: 12,
} as const;
const EN_STOP_WORDS = new Set(
  'a an and are as at be by for from in is it of on or that the this to with you your'.split(' '),
);
const ZH_STOP_WORDS = new Set(['请', '帮我', '一下', '这个', '进行', '实现', '需要', '如何']);

function normalizedText(value: string, max = MAX_TASK_CHARS): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max);
}

function relativePathOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizedText(value, 512).replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    return undefined;
  }
  return normalized;
}

function removeAbsolutePaths(value: string): string {
  return value
    .replace(/(^|[\s([{"'])(?:[A-Za-z]:[\\/]|\\\\)[^\s)\]}>,;"']+/gu, '$1')
    .replace(/(^|[\s([{"',;:])\/(?!\/)[^\s)\]}>,;"']+/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

function addTerm(terms: string[], value: string): void {
  const normalized = value.trim();
  if (normalized.length < 2 || terms.includes(normalized)) return;
  terms.push(normalized);
}

function addChineseTerms(phrases: string[], weak: string[], text: string): void {
  for (const match of text.matchAll(/[\u3400-\u9fff]{2,}/gu)) {
    const value = match[0];
    if (ZH_STOP_WORDS.has(value)) continue;
    addTerm(phrases, value);
    for (let width = Math.min(4, value.length); width >= 2; width -= 1) {
      for (let index = 0; index + width <= value.length; index += width) {
        const chunk = value.slice(index, index + width);
        if (!ZH_STOP_WORDS.has(chunk) && chunk !== value) addTerm(weak, chunk);
      }
    }
  }
}

function addLatinTerms(strong: string[], weak: string[], text: string): void {
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9_./:-]*/gu)) {
    const value = match[0].replace(/^[./:]+|[./:]+$/gu, '');
    if (!value) continue;
    const lower = value.toLowerCase();
    if (EN_STOP_WORDS.has(lower)) continue;
    addTerm(looksExplicit(value) ? strong : weak, value);
    if (value.includes('/')) {
      for (const segment of value.split(/[/:.]/u)) addTerm(weak, segment);
    }
  }
  for (const match of text.matchAll(/\b\d+(?:\.\d+)?\b/gu)) addTerm(strong, match[0]);
}

function looksExplicit(value: string): boolean {
  return (
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('_') ||
    /[a-z][A-Z]/u.test(value) ||
    /[A-Z]{2,}/u.test(value) ||
    /[A-Za-z][A-Za-z0-9]*\d[A-Za-z0-9]*/u.test(value) ||
    /\d{2,}/u.test(value) ||
    /(?:^|[^A-Za-z0-9])[A-Za-z0-9]+\.[A-Za-z0-9]+(?:$|[^A-Za-z0-9])/u.test(value)
  );
}

function taskPhrase(value: string): string | undefined {
  if (value.length > 256 || !/\s/u.test(value)) return undefined;
  const meaningful = value.split(/\s+/u).filter((word) => {
    const lower = word.toLowerCase();
    return word.length >= 2 && !EN_STOP_WORDS.has(lower) && !ZH_STOP_WORDS.has(word);
  });
  return meaningful.length >= 2 ? value : undefined;
}

export function createProjectKnowledgeQuery(input: {
  readonly task: string;
  readonly path?: string;
  readonly phase?: string;
  readonly operation?: string;
}): ProjectKnowledgeQuery {
  const task = normalizedText(input.task);
  if (!task) throw new Error('Project knowledge task must not be empty');
  const targetPath = relativePathOrUndefined(input.path);
  const phase = input.phase ? normalizedText(input.phase, 128) : undefined;
  const operation = input.operation ? normalizedText(input.operation, 128) : undefined;
  const strong: string[] = [];
  const phrases: string[] = [];
  const weak: string[] = [];
  addChineseTerms(phrases, weak, task);
  addLatinTerms(strong, weak, task);
  if (targetPath) {
    addTerm(strong, targetPath);
    addLatinTerms(strong, weak, targetPath);
    addChineseTerms(phrases, weak, targetPath);
  }
  if (phase) {
    addLatinTerms(strong, weak, phase);
    addChineseTerms(phrases, weak, phase);
  }
  if (operation) {
    addLatinTerms(strong, weak, operation);
    addChineseTerms(phrases, weak, operation);
  }
  const phrase = taskPhrase(task);
  if (phrase) addTerm(phrases, phrase);
  const strongTerms = strong.slice(0, PROJECT_KNOWLEDGE_QUERY_BUDGETS.strong);
  const phraseTerms = phrases.slice(0, PROJECT_KNOWLEDGE_QUERY_BUDGETS.phrase);
  const weakTerms = weak
    .filter((term) => !strongTerms.includes(term) && !phraseTerms.includes(term))
    .slice(0, PROJECT_KNOWLEDGE_QUERY_BUDGETS.weak);
  const terms = [...strongTerms, ...phraseTerms, ...weakTerms];
  const remoteQuery = [
    removeAbsolutePaths(task),
    ...(targetPath ? [`Target path: ${targetPath}`] : []),
    ...(phase ? [`Phase: ${removeAbsolutePaths(phase)}`] : []),
    ...(operation ? [`Operation: ${removeAbsolutePaths(operation)}`] : []),
  ].join('\n');
  return {
    task,
    ...(targetPath ? { path: targetPath } : {}),
    ...(phase ? { phase } : {}),
    ...(operation ? { operation } : {}),
    terms,
    strongTerms,
    phraseTerms,
    weakTerms,
    remoteQuery,
  };
}

export function queryContainsTerm(text: string, term: string): boolean {
  return text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

export function queryHasStrongMatch(query: ProjectKnowledgeQuery, text: string): boolean {
  return query.strongTerms.some((term) => queryContainsTerm(text, term));
}
