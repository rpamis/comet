import { contextPathMatches } from '../agent-learning/index.js';
import { readProjectMemory, readProjectMemorySearchEntries } from './project-memory.js';
import { independentQueryTermCount, queryContainsTerm } from './query.js';
import type {
  ProjectKnowledgeProvider,
  ProjectKnowledgeSearchRequest,
  ProjectKnowledgeSearchResult,
  ProjectKnowledgeResult,
} from './types.js';

/** Search durable local lessons together with the selected provider, without uploading them. */
export async function searchProjectKnowledge(options: {
  readonly projectRoot: string;
  readonly cacheRoot?: string;
  readonly provider: ProjectKnowledgeProvider;
  readonly request: ProjectKnowledgeSearchRequest;
  readonly allowProviderFailure?: boolean;
}): Promise<ProjectKnowledgeSearchResult> {
  const { query } = options.request;
  const limit = Math.max(1, Math.min(40, options.request.limit ?? 8));
  const entries = await readProjectMemorySearchEntries(options.projectRoot, options.cacheRoot);
  const matches = entries
    .map((entry, index) => {
      const text = `${entry.title}\n${entry.description}\n${entry.slug}\n${entry.body}`;
      const strong = query.strongTerms.filter((term) => queryContainsTerm(text, term)).length;
      const phrase = query.phraseTerms.filter((term) => queryContainsTerm(text, term)).length;
      const terms = independentQueryTermCount(
        query.terms.filter((term) => queryContainsTerm(text, term)),
      );
      return {
        entry,
        index,
        score: strong * 8 + phrase * 4 + terms,
        eligible: strong > 0 || phrase > 0 || terms >= 2,
      };
    })
    .filter((entry) => entry.eligible)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.entry.updated.localeCompare(left.entry.updated) ||
        left.index - right.index,
    );
  const memories: ProjectKnowledgeResult[] = [];
  for (const { entry, score } of matches) {
    const memory = await readProjectMemory(options.projectRoot, entry.slug, options.cacheRoot);
    if (!memory || memory.sourceStatus === 'changed') continue;
    if (
      query.path !== undefined &&
      memory.paths.length > 0 &&
      !contextPathMatches(memory.paths, query.path)
    )
      continue;
    memories.push({
      source: `project-memory:${memory.slug}`,
      title: memory.title,
      content: `${memory.description}\n\n${memory.body}`,
      score,
      memory,
    });
    if (memories.length >= limit) break;
  }
  let response: ProjectKnowledgeSearchResult;
  try {
    const result = await options.provider.query(options.request);
    if (result.kind !== 'search')
      throw new Error('Project knowledge provider returned an invalid search result');
    response = result;
  } catch (error) {
    if (!options.allowProviderFailure) throw error;
    response = {
      kind: 'search',
      hits: [],
      results: [],
      records: [],
      truncated: false,
      diagnostics: [
        {
          code: 'context-provider-unavailable',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  const results = [...memories, ...response.results].slice(0, limit);
  return {
    ...response,
    results,
    hits: response.hits.filter((hit) =>
      results.some((entry) => entry.record?.id === hit.record.id),
    ),
    records: results.flatMap((entry) => (entry.record ? [entry.record] : [])),
    truncated: response.truncated || memories.length + response.results.length > limit,
  };
}
