import type { WorkflowKnowledgeRemoteConfig } from '../workflow-contract/types.js';
import {
  BoundedHttpRequestError,
  runBoundedHttpRequest,
} from '../../platform/http/bounded-request.js';
import type {
  ProjectKnowledgeDiagnosticReporter,
  ProjectKnowledgeLegacyProvider,
  ProjectKnowledgeQuery,
  ProjectKnowledgeResult,
} from './types.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_SOURCE_CHARS = 512;
const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_CHARS = 1600;
const MAX_TOTAL_CHARS = 5000;

export interface RemoteProjectKnowledgeProviderOptions {
  readonly config: WorkflowKnowledgeRemoteConfig;
  readonly reportDiagnostic?: ProjectKnowledgeDiagnosticReporter;
  readonly fetch?: typeof globalThis.fetch;
  readonly env?: NodeJS.ProcessEnv;
}

function safeString(value: unknown, max: number, required: boolean): string | null {
  if (typeof value !== 'string') return null;
  const text = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .trim();
  if (required && !text) return null;
  return text.slice(0, max);
}

export class RemoteProjectKnowledgeProvider implements ProjectKnowledgeLegacyProvider {
  private readonly options: RemoteProjectKnowledgeProviderOptions;

  public constructor(options: RemoteProjectKnowledgeProviderOptions) {
    this.options = options;
  }

  public async retrieve(query: ProjectKnowledgeQuery): Promise<readonly ProjectKnowledgeResult[]> {
    const tokenEnv = this.options.config.token_env;
    const token = tokenEnv ? (this.options.env?.[tokenEnv] ?? process.env[tokenEnv]) : undefined;
    if (tokenEnv && !token) {
      this.options.reportDiagnostic?.({
        code: 'remote-token',
        message: `Remote project knowledge skipped because ${tokenEnv} is not set.`,
      });
      return [];
    }
    try {
      const { response, bytes } = await runBoundedHttpRequest({
        url: this.options.config.endpoint,
        timeoutMs: this.options.config.timeout_ms,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        fetch: this.options.fetch,
        init: {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            query: query.remoteQuery,
            limit: 4,
            ...(this.options.config.scope ? { scope: this.options.config.scope } : {}),
          }),
        },
      });
      if (!response.ok) {
        this.options.reportDiagnostic?.({
          code: 'remote-status',
          message: `Remote project knowledge returned HTTP ${response.status}.`,
        });
        return [];
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      } catch {
        this.options.reportDiagnostic?.({
          code: 'remote-json',
          message: 'Remote project knowledge returned invalid JSON.',
        });
        return [];
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !Array.isArray((parsed as { results?: unknown }).results)
      ) {
        this.options.reportDiagnostic?.({
          code: 'remote-schema',
          message: 'Remote project knowledge response must contain a results array.',
        });
        return [];
      }
      const results: ProjectKnowledgeResult[] = [];
      let total = 0;
      const seen = new Set<string>();
      let invalidResult = false;
      for (const item of (parsed as { results: unknown[] }).results) {
        if (!item || typeof item !== 'object') {
          invalidResult = true;
          continue;
        }
        const content = safeString(
          (item as { content?: unknown }).content,
          MAX_CONTENT_CHARS,
          true,
        );
        const source = safeString((item as { source?: unknown }).source, MAX_SOURCE_CHARS, true);
        if (!content || !source) {
          invalidResult = true;
          continue;
        }
        const rawTitle = (item as { title?: unknown }).title;
        if (rawTitle !== undefined && typeof rawTitle !== 'string') {
          invalidResult = true;
          continue;
        }
        const title = safeString(rawTitle, MAX_TITLE_CHARS, false) ?? undefined;
        const key = `${source}\u0000${title ?? ''}`;
        if (seen.has(key)) continue;
        if (total + content.length > MAX_TOTAL_CHARS) break;
        const score = (item as { score?: unknown }).score;
        if (score !== undefined && (typeof score !== 'number' || !Number.isFinite(score))) {
          invalidResult = true;
          continue;
        }
        results.push({
          content,
          source,
          ...(title ? { title } : {}),
          ...(score === undefined ? {} : { score }),
        });
        seen.add(key);
        total += content.length;
        if (results.length >= 4) break;
      }
      if (invalidResult) {
        this.options.reportDiagnostic?.({
          code: 'remote-schema',
          message: 'Remote project knowledge response contained an invalid result.',
        });
      }
      return results;
    } catch (error) {
      this.options.reportDiagnostic?.({
        code: 'remote-failed',
        message:
          error instanceof BoundedHttpRequestError && error.code === 'timeout'
            ? 'Remote project knowledge request timed out.'
            : 'Remote project knowledge request failed.',
      });
      return [];
    }
  }
}

export {
  MAX_CONTENT_CHARS,
  MAX_RESPONSE_BYTES,
  MAX_SOURCE_CHARS,
  MAX_TITLE_CHARS,
  MAX_TOTAL_CHARS,
};
