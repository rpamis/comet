import { parseProjectKnowledgeSections } from './index-store.js';
import { independentQueryTermCount, queryContainsTerm } from './query.js';
import type { ProjectKnowledgeQuery } from './types.js';

const MAX_EXCERPT_CHARS = 1600;

function excerpt(
  body: string,
  headingPath: string,
  query: ProjectKnowledgeQuery,
  limit: number,
): string {
  if (body.length <= limit) return body;
  const prefix = `${headingPath.slice(0, Math.floor(limit / 3))}\n…\n`;
  const windowSize = limit - prefix.length;
  const text = body.toLocaleLowerCase();
  const starts = new Set([0]);
  for (const term of query.terms) {
    let from = 0;
    for (let count = 0; count < 8; count += 1) {
      const offset = text.indexOf(term.toLocaleLowerCase(), from);
      if (offset < 0) break;
      starts.add(Math.max(0, offset - Math.min(240, Math.floor(windowSize / 3))));
      from = offset + Math.max(1, term.length);
    }
  }
  let best = { start: 0, score: -1 };
  for (const start of starts) {
    const value = score(body.slice(start, start + windowSize), query);
    if (value > best.score || (value === best.score && start < best.start))
      best = { start, score: value };
  }
  return `${best.start ? prefix : ''}${body.slice(best.start, best.start + windowSize)}`;
}

function score(text: string, query: ProjectKnowledgeQuery): number {
  return (
    query.strongTerms.filter((term) => queryContainsTerm(text, term)).length * 8 +
    query.phraseTerms.filter((term) => queryContainsTerm(text, term)).length * 4 +
    independentQueryTermCount(query.terms.filter((term) => queryContainsTerm(text, term)))
  );
}

/** Return supporting text, including matches beyond a section's introductory prefix. */
export function selectProjectKnowledgePassage(
  source: string,
  markdown: string,
  query: ProjectKnowledgeQuery,
): { title: string; headingPath: string; content: string } | undefined {
  const sections = parseProjectKnowledgeSections(source, markdown)
    .filter((section) => section.body.replace(/^\s{0,3}#{1,6}\s+.*$/gmu, '').trim())
    .map((section, index) => ({
      section,
      index,
      score: score(section.body, query),
      terms: query.terms.filter((term) => queryContainsTerm(section.body, term)),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const section = sections[0]?.section;
  if (!section) return undefined;
  const selected = [sections[0]];
  const covered = new Set(sections[0].terms);
  for (const candidate of sections.slice(1)) {
    if (selected.length >= 3) break;
    const next = new Set([...covered, ...candidate.terms]);
    if (independentQueryTermCount([...next]) <= independentQueryTermCount([...covered])) continue;
    selected.push(candidate);
    for (const term of candidate.terms) covered.add(term);
  }
  const limit = Math.floor((MAX_EXCERPT_CHARS - (selected.length - 1) * 2) / selected.length);
  const content = selected
    .map(({ section }) => excerpt(section.body, section.headingPath, query, limit))
    .join('\n\n');
  return { title: section.title, headingPath: section.headingPath, content };
}
