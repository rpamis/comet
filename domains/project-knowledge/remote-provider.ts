import { resolveStableProjectId } from '../../platform/paths/project-identity.js';
import {
  BoundedHttpRequestError,
  runBoundedHttpRequest,
} from '../../platform/http/bounded-request.js';
import type { WorkflowKnowledgeRemoteConfig } from '../workflow-contract/types.js';
import { parseProjectKnowledgeRecord, type ProjectKnowledgeRecord } from './records.js';
import type {
  ProjectKnowledgeApplyResult,
  ProjectKnowledgeDiagnostic,
  ProjectKnowledgeDiagnosticReporter,
  ProjectKnowledgeMutation,
  ProjectKnowledgeProvider,
  ProjectKnowledgeQueryRequest,
  ProjectKnowledgeQueryResult,
  ProjectKnowledgeResult,
  ProjectKnowledgeSearchHit,
  ProjectKnowledgeStatus,
} from './types.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_SOURCE_CHARS = 512;
const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_CHARS = 1600;
const MAX_TOTAL_CHARS = 5000;
const MAX_DIAGNOSTICS = 8;

export interface RemoteProjectKnowledgeProviderOptions {
  readonly config: WorkflowKnowledgeRemoteConfig;
  readonly projectRoot?: string;
  readonly projectId?: string;
  readonly reportDiagnostic?: ProjectKnowledgeDiagnosticReporter;
  readonly fetch?: typeof globalThis.fetch;
  readonly env?: NodeJS.ProcessEnv;
}

interface RemoteEnvelope {
  readonly schema: 'comet.project-knowledge.provider.v1';
  readonly operation: 'status' | 'query' | 'apply';
  readonly scope?: string;
  readonly projectId: string;
  readonly input: unknown;
}

function safeString(value: unknown, max: number, required = false): string | null {
  if (typeof value !== 'string') return null;
  const text = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .trim()
    .slice(0, max);
  return required && !text ? null : text;
}

function boundedDiagnostics(value: unknown): ProjectKnowledgeDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): ProjectKnowledgeDiagnostic | null => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const code = safeString((entry as { code?: unknown }).code, 64, true);
      const message = safeString((entry as { message?: unknown }).message, 240, true);
      return code && message ? { code, message } : null;
    })
    .filter((entry): entry is ProjectKnowledgeDiagnostic => entry !== null)
    .slice(0, MAX_DIAGNOSTICS);
}

function noServerDiagnostics(): readonly ProjectKnowledgeDiagnostic[] {
  return [];
}

function stripSourceEvidence<
  T extends { source: string; anchor?: string; lineStart?: number; lineEnd?: number },
>(source: T): Omit<T, 'evidence'> {
  const withoutEvidence = { ...source } as T & { evidence?: unknown };
  delete withoutEvidence.evidence;
  return withoutEvidence;
}

function sanitizeRecord(record: ProjectKnowledgeRecord): ProjectKnowledgeRecord {
  return {
    ...record,
    conclusions: record.conclusions.map((conclusion) => ({
      ...conclusion,
      sources: conclusion.sources.map(stripSourceEvidence),
    })),
    relations: record.relations.map((relation) => ({
      ...relation,
      sources: relation.sources.map(stripSourceEvidence),
    })),
  };
}

function sanitizeMutation(mutation: ProjectKnowledgeMutation): ProjectKnowledgeMutation {
  return mutation.kind === 'upsert'
    ? { kind: 'upsert', record: sanitizeRecord(mutation.record) }
    : mutation;
}

function boundedQueryInput(request: ProjectKnowledgeQueryRequest): Record<string, unknown> {
  if (request.kind === 'search') {
    const query = request.query;
    return {
      kind: 'search',
      task: safeString(query.task, 2000) ?? '',
      ...(query.path ? { path: safeString(query.path, 512) } : {}),
      ...(query.phase ? { phase: safeString(query.phase, 128) } : {}),
      ...(query.operation ? { operation: safeString(query.operation, 128) } : {}),
      terms: query.terms
        .slice(0, 28)
        .map((term) => safeString(term, 128))
        .filter(Boolean),
      limit: Math.max(1, Math.min(8, request.limit ?? 8)),
    };
  }
  if (request.kind === 'list') {
    return {
      kind: 'list',
      ...(request.projectId ? { projectId: safeString(request.projectId, 128) } : {}),
      ...(request.type ? { type: request.type } : {}),
      ...(request.state ? { state: request.state } : {}),
      ...(request.authority ? { authority: request.authority } : {}),
      limit: Math.max(1, Math.min(500, request.limit ?? 100)),
    };
  }
  return {
    kind: 'get',
    id: safeString(request.id, 128) ?? '',
    ...(request.projectId ? { projectId: safeString(request.projectId, 128) } : {}),
  };
}

function parseRecordList(value: unknown, reportInvalid: () => void): ProjectKnowledgeRecord[] {
  if (!Array.isArray(value)) return [];
  const records: ProjectKnowledgeRecord[] = [];
  for (const entry of value.slice(0, 500)) {
    try {
      records.push(parseProjectKnowledgeRecord(entry));
    } catch {
      reportInvalid();
    }
  }
  return records;
}

function parseResult(value: unknown, reportInvalid: () => void): ProjectKnowledgeResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reportInvalid();
    return null;
  }
  const content = safeString((value as { content?: unknown }).content, MAX_CONTENT_CHARS, true);
  const source = safeString((value as { source?: unknown }).source, MAX_SOURCE_CHARS, true);
  if (!content || !source) {
    reportInvalid();
    return null;
  }
  const titleValue = (value as { title?: unknown }).title;
  const title = titleValue === undefined ? undefined : safeString(titleValue, MAX_TITLE_CHARS);
  if (titleValue !== undefined && title === null) {
    reportInvalid();
    return null;
  }
  const scoreValue = (value as { score?: unknown }).score;
  if (
    scoreValue !== undefined &&
    (typeof scoreValue !== 'number' || !Number.isFinite(scoreValue))
  ) {
    reportInvalid();
    return null;
  }
  let record: ProjectKnowledgeRecord | undefined;
  const rawRecord = (value as { record?: unknown }).record;
  if (rawRecord !== undefined) {
    try {
      record = parseProjectKnowledgeRecord(rawRecord);
    } catch {
      reportInvalid();
      return null;
    }
  }
  return {
    content,
    source,
    ...(title ? { title } : {}),
    ...(scoreValue === undefined ? {} : { score: scoreValue }),
    ...(record ? { record } : {}),
  };
}

function parseStatus(value: unknown, reportInvalid: () => void): ProjectKnowledgeStatus | null {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value) && 'status' in value
      ? (value as { status?: unknown }).status
      : value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    reportInvalid();
    return null;
  }
  const provider = (raw as { provider?: unknown }).provider;
  const healthy = (raw as { healthy?: unknown }).healthy;
  const writable = (raw as { writable?: unknown }).writable;
  if (provider !== 'remote' || typeof healthy !== 'boolean' || typeof writable !== 'boolean') {
    reportInvalid();
    return null;
  }
  const recordCount = (raw as { recordCount?: unknown }).recordCount;
  const updatedAtValue = (raw as { updatedAt?: unknown }).updatedAt;
  return {
    provider: 'remote',
    healthy,
    writable,
    ...(Number.isSafeInteger(recordCount) && Number(recordCount) >= 0
      ? { recordCount: Number(recordCount) }
      : {}),
    ...(typeof updatedAtValue === 'string' ? { updatedAt: updatedAtValue.slice(0, 64) } : {}),
    diagnostics: boundedDiagnostics((raw as { diagnostics?: unknown }).diagnostics),
  };
}

function parseQueryResult(
  value: unknown,
  request: ProjectKnowledgeQueryRequest,
  reportInvalid: () => void,
): ProjectKnowledgeQueryResult | null {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value) && 'result' in value
      ? (value as { result?: unknown }).result
      : value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    reportInvalid();
    return null;
  }
  const kind = (raw as { kind?: unknown }).kind ?? request.kind;
  const diagnostics = boundedDiagnostics((raw as { diagnostics?: unknown }).diagnostics);
  if (kind === 'list') {
    return {
      kind: 'list',
      records: parseRecordList((raw as { records?: unknown }).records, reportInvalid),
      truncated: (raw as { truncated?: unknown }).truncated === true,
      diagnostics,
    };
  }
  if (kind === 'get') {
    const rawRecord = (raw as { record?: unknown }).record;
    let record: ProjectKnowledgeRecord | null = null;
    if (rawRecord !== null && rawRecord !== undefined) {
      try {
        record = parseProjectKnowledgeRecord(rawRecord);
      } catch {
        reportInvalid();
      }
    }
    return { kind: 'get', record, diagnostics };
  }
  const results: ProjectKnowledgeResult[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const entry of Array.isArray((raw as { results?: unknown }).results)
    ? ((raw as { results: unknown[] }).results ?? []).slice(0, 16)
    : []) {
    const result = parseResult(entry, reportInvalid);
    if (!result || seen.has(`${result.source}\u0000${result.title ?? ''}`)) continue;
    if (total + result.content.length > MAX_TOTAL_CHARS) break;
    seen.add(`${result.source}\u0000${result.title ?? ''}`);
    total += result.content.length;
    results.push(result);
  }
  const records = parseRecordList((raw as { records?: unknown }).records, reportInvalid);
  const hits: ProjectKnowledgeSearchHit[] = Array.isArray((raw as { hits?: unknown }).hits)
    ? ((raw as { hits: unknown[] }).hits ?? []).slice(0, 40).flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          reportInvalid();
          return [];
        }
        try {
          const record = parseProjectKnowledgeRecord((entry as { record?: unknown }).record);
          const score = (entry as { score?: unknown }).score;
          if (score !== undefined && (typeof score !== 'number' || !Number.isFinite(score))) {
            reportInvalid();
            return [];
          }
          return [{ record, ...(score === undefined ? {} : { score }) }];
        } catch {
          reportInvalid();
          return [];
        }
      })
    : records.map((record) => ({ record }));
  return {
    kind: 'search',
    hits,
    results,
    records,
    truncated: (raw as { truncated?: unknown }).truncated === true,
    diagnostics,
  };
}

function parseApplyResult(
  value: unknown,
  mutation: ProjectKnowledgeMutation,
  reportInvalid: () => void,
): ProjectKnowledgeApplyResult | null {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value) && 'result' in value
      ? (value as { result?: unknown }).result
      : value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    reportInvalid();
    return null;
  }
  const rawRecord = (raw as { record?: unknown }).record;
  let record: ProjectKnowledgeRecord | null | undefined;
  if (rawRecord === null) record = null;
  else if (rawRecord !== undefined) {
    try {
      record = parseProjectKnowledgeRecord(rawRecord);
    } catch {
      reportInvalid();
    }
  }
  return {
    kind: mutation.kind,
    changed: (raw as { changed?: unknown }).changed === true,
    ...(record === undefined ? {} : { record }),
    ...(Array.isArray((raw as { records?: unknown }).records)
      ? { records: parseRecordList((raw as { records: unknown }).records, reportInvalid) }
      : {}),
    diagnostics: boundedDiagnostics((raw as { diagnostics?: unknown }).diagnostics),
  };
}

export class RemoteProjectKnowledgeProvider implements ProjectKnowledgeProvider {
  private readonly options: RemoteProjectKnowledgeProviderOptions;
  private readonly projectId: string;

  public constructor(options: RemoteProjectKnowledgeProviderOptions) {
    this.options = options;
    this.projectId =
      options.projectId ??
      (options.projectRoot ? resolveStableProjectId(options.projectRoot) : 'project');
  }

  public async status(): Promise<ProjectKnowledgeStatus> {
    const tokenEnv = this.options.config.token_env;
    if (tokenEnv && !this.token()) {
      const diagnostic = {
        code: 'remote-token',
        message: `Remote Project Knowledge 未配置环境变量 ${tokenEnv}。`,
      };
      this.report(diagnostic.code, diagnostic.message);
      return {
        provider: 'remote',
        healthy: false,
        writable: false,
        diagnostics: [diagnostic],
      };
    }
    const result = await this.request('status', {});
    if (result === null) {
      return {
        provider: 'remote',
        healthy: false,
        writable: false,
        diagnostics: [{ code: 'remote-unavailable', message: 'Remote Project Knowledge 不可用。' }],
      };
    }
    const invalid = { value: false };
    const parsed = parseStatus(result, () => {
      invalid.value = true;
    });
    if (!parsed || invalid.value) {
      this.report('remote-schema', 'Remote Project Knowledge status 响应格式无效。');
      return {
        provider: 'remote',
        healthy: false,
        writable: false,
        diagnostics: [
          { code: 'remote-schema', message: 'Remote Project Knowledge status 响应格式无效。' },
        ],
      };
    }
    return parsed;
  }

  public async query(request: ProjectKnowledgeQueryRequest): Promise<ProjectKnowledgeQueryResult> {
    const result = await this.request(
      'query',
      boundedQueryInput(request),
      request.kind === 'search' ? undefined : request.projectId,
    );
    if (result === null) return emptyQueryResult(request);
    const invalid = { value: false };
    const parsed = parseQueryResult(result, request, () => {
      invalid.value = true;
    });
    if (!parsed || invalid.value) {
      this.report('remote-schema', 'Remote Project Knowledge query 响应包含无效数据。');
      return emptyQueryResult(request);
    }
    return parsed;
  }

  public async apply(mutation: ProjectKnowledgeMutation): Promise<ProjectKnowledgeApplyResult> {
    const result = await this.request(
      'apply',
      sanitizeMutation(mutation),
      mutation.kind === 'upsert' ? mutation.record.projectId : mutation.projectId,
    );
    if (result === null) {
      return {
        kind: mutation.kind,
        changed: false,
        diagnostics: [{ code: 'remote-unavailable', message: 'Remote Project Knowledge 不可用。' }],
      };
    }
    const invalid = { value: false };
    const parsed = parseApplyResult(result, mutation, () => {
      invalid.value = true;
    });
    if (!parsed || invalid.value) {
      this.report('remote-schema', 'Remote Project Knowledge apply 响应格式无效。');
      return {
        kind: mutation.kind,
        changed: false,
        diagnostics: [
          { code: 'remote-schema', message: 'Remote Project Knowledge apply 响应格式无效。' },
        ],
      };
    }
    return parsed;
  }

  private async request(
    operation: RemoteEnvelope['operation'],
    input: unknown,
    projectId = this.projectId,
  ): Promise<unknown | null> {
    const tokenEnv = this.options.config.token_env;
    const token = this.token();
    if (tokenEnv && !token) {
      this.report('remote-token', `Remote Project Knowledge 未配置环境变量 ${tokenEnv}。`);
      return null;
    }
    const body: RemoteEnvelope = {
      schema: 'comet.project-knowledge.provider.v1',
      operation,
      ...(this.options.config.scope ? { scope: this.options.config.scope } : {}),
      projectId: safeString(projectId, 128, true) ?? this.projectId,
      input,
    };
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
          body: JSON.stringify(body),
        },
      });
      if (!response.ok) {
        this.report('remote-status', `Remote Project Knowledge 返回 HTTP ${response.status}。`);
        return null;
      }
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      } catch {
        this.report('remote-json', 'Remote Project Knowledge 返回了无效 JSON。');
        return null;
      }
    } catch (error) {
      this.report(
        'remote-failed',
        error instanceof BoundedHttpRequestError && error.code === 'timeout'
          ? 'Remote Project Knowledge 请求超时。'
          : 'Remote Project Knowledge 请求失败。',
      );
      return null;
    }
  }

  private report(code: string, message: string): void {
    this.options.reportDiagnostic?.({ code, message });
  }

  private token(): string | undefined {
    const tokenEnv = this.options.config.token_env;
    return tokenEnv ? (this.options.env?.[tokenEnv] ?? process.env[tokenEnv]) : undefined;
  }
}

function emptyQueryResult(request: ProjectKnowledgeQueryRequest): ProjectKnowledgeQueryResult {
  if (request.kind === 'list') {
    return { kind: 'list', records: [], truncated: false, diagnostics: noServerDiagnostics() };
  }
  if (request.kind === 'get') {
    return { kind: 'get', record: null, diagnostics: noServerDiagnostics() };
  }
  return {
    kind: 'search',
    hits: [],
    results: [],
    records: [],
    truncated: false,
    diagnostics: noServerDiagnostics(),
  };
}

export {
  MAX_CONTENT_CHARS,
  MAX_RESPONSE_BYTES,
  MAX_SOURCE_CHARS,
  MAX_TITLE_CHARS,
  MAX_TOTAL_CHARS,
};
