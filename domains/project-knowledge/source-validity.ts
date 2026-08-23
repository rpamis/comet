import type { ProjectKnowledgeRecordSource } from './records.js';

function normalizeAnchor(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function sourceAnchorExists(text: string, anchor: string): boolean {
  const expected = normalizeAnchor(anchor);
  if (!expected) return false;
  const headings = text
    .split(/\r?\n/u)
    .map((line) => /^#{1,6}\s+(.+?)(?:\s+#+)?$/u.exec(line)?.[1])
    .filter((heading): heading is string => heading !== undefined);
  if (headings.some((heading) => normalizeAnchor(heading) === expected)) return true;
  return [...text.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/giu)].some(
    (match) => normalizeAnchor(match[1] ?? '') === expected,
  );
}

export function projectKnowledgeSourceReferenceMatchesText(
  text: string,
  source: ProjectKnowledgeRecordSource,
): boolean {
  if (source.anchor !== undefined && !sourceAnchorExists(text, source.anchor)) return false;
  if (source.lineStart !== undefined || source.lineEnd !== undefined) {
    const lineCount = text.split(/\r?\n/u).length;
    if (
      (source.lineStart ?? 1) > lineCount ||
      (source.lineEnd ?? source.lineStart ?? 1) > lineCount
    ) {
      return false;
    }
  }
  return true;
}
