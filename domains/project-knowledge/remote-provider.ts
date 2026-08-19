import type { WorkflowKnowledgeRemoteConfig } from '../workflow-contract/types.js';
import type {
  ProjectKnowledgeDiagnosticReporter,
  ProjectKnowledgeProvider,
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

async function responseBytes(response: Response): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('response exceeds 1 MiB');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error('response exceeds 1 MiB');
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export class RemoteProjectKnowledgeProvider implements ProjectKnowledgeProvider {
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.config.timeout_ms);
    try {
      const fetcher = this.options.fetch ?? globalThis.fetch;
      const response = await fetcher(this.options.config.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: query.remoteQuery,
          limit: 4,
          ...(this.options.config.scope ? { scope: this.options.config.scope } : {}),
        }),
      });
      if (!response.ok) {
        this.options.reportDiagnostic?.({
          code: 'remote-status',
          message: `Remote project knowledge returned HTTP ${response.status}.`,
        });
        return [];
      }
      const bytes = await responseBytes(response);
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
    } catch {
      this.options.reportDiagnostic?.({
        code: 'remote-failed',
        message: controller.signal.aborted
          ? 'Remote project knowledge request timed out.'
          : 'Remote project knowledge request failed.',
      });
      return [];
    } finally {
      clearTimeout(timer);
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
