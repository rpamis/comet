import { resolveStableProjectId } from '../../platform/paths/project-identity.js';
import {
  BoundedHttpRequestError,
  runBoundedHttpRequest,
} from '../../platform/http/bounded-request.js';
import type { WorkflowKnowledgeRemoteConfig } from '../workflow-contract/types.js';
import type { AgentLearningDelta } from '../agent-learning/index.js';
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
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_DELTA_EVIDENCE = 32;

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

interface RemoteResponseEnvelope {
  readonly schema: 'comet.project-knowledge.provider.v1';
  readonly operation: RemoteEnvelope['operation'];
  readonly projectId: string;
  readonly result: unknown;
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
  if (mutation.kind === 'upsert')
    return { kind: 'upsert', record: sanitizeRecord(mutation.record) };
  if (mutation.kind !== 'experience-delta') return mutation;
  const delta = mutation.delta;
  let payload = delta.payload;
  if (payload?.kind === 'record') {
    payload = {
      kind: 'record',
      record: sanitizeRecord(parseProjectKnowledgeRecord(payload.record)),
    };
  } else if (payload?.kind === 'verify') {
    payload = {
      kind: 'verify',
      projectId: safeString(payload.projectId, 128) ?? '',
      commands: boundedStrings(payload.commands, 16, 2000),
      ...(typeof payload.updatedAt === 'string'
        ? { updatedAt: payload.updatedAt.slice(0, 64) }
        : {}),
    };
  } else if (payload !== undefined) {
    payload = undefined;
  }
  const { payload: _payload, ...deltaWithoutPayload } = delta;
  void _payload;
  const sanitized: AgentLearningDelta = {
    ...deltaWithoutPayload,
    statement: safeString(delta.statement, 4000) ?? '',
    ...(delta.title === undefined ? {} : { title: safeString(delta.title, 512) ?? '' }),
    applicability: {
      ...(delta.applicability.projectId === undefined
        ? {}
        : { projectId: safeString(delta.applicability.projectId, 128) ?? '' }),
      ...(delta.applicability.paths === undefined
        ? {}
        : { paths: boundedStrings(delta.applicability.paths, 32, 512) }),
      ...(delta.applicability.operations === undefined
        ? {}
        : { operations: boundedStrings(delta.applicability.operations, 16, 128) }),
      ...(delta.applicability.phases === undefined
        ? {}
        : { phases: boundedStrings(delta.applicability.phases, 16, 128) }),
      ...(delta.applicability.tasks === undefined
        ? {}
        : { tasks: boundedStrings(delta.applicability.tasks, 16, 512) }),
    },
    evidence: delta.evidence.slice(0, MAX_DELTA_EVIDENCE).map((entry) => ({
      ...entry,
      summary: safeString(entry.summary, 1000) ?? '',
      ...(entry.source === undefined ? {} : { source: safeString(entry.source, 512) ?? '' }),
      ...(entry.anchor === undefined ? {} : { anchor: safeString(entry.anchor, 256) ?? '' }),
      ...(entry.command === undefined ? {} : { command: safeString(entry.command, 2000) ?? '' }),
    })),
    ...(payload === undefined ? {} : { payload }),
  };
  return {
    ...mutation,
    idempotencyKey: safeString(mutation.idempotencyKey, 256, true) ?? 'invalid',
    delta: sanitized,
  };
}

function boundedStrings(value: unknown, maxEntries: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => safeString(entry, maxChars))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxEntries);
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
  if (request.kind === 'manifest') {
    return {
      kind: 'manifest',
      ...(request.projectId ? { projectId: safeString(request.projectId, 128) } : {}),
      ...(request.state ? { state: request.state } : {}),
      limit: Math.max(1, Math.min(500, request.limit ?? 100)),
    };
  }
  if (request.kind === 'expand') {
    return {
      kind: 'expand',
      id: safeString(request.id, 128) ?? '',
      ...(request.projectId ? { projectId: safeString(request.projectId, 128) } : {}),
    };
  }
  return {
    kind: 'get',
    id: safeString(request.id, 128) ?? '',
    ...(request.projectId ? { projectId: safeString(request.projectId, 128) } : {}),
  };
}

function parseRecordList(
  value: unknown,
  reportInvalid: () => void,
  expectedProjectId: string,
): ProjectKnowledgeRecord[] {
  if (!Array.isArray(value)) return [];
  const records: ProjectKnowledgeRecord[] = [];
  for (const entry of value.slice(0, 500)) {
    try {
      const record = parseProjectKnowledgeRecord(entry);
      if (record.projectId !== expectedProjectId) throw new Error('Project mismatch');
      records.push(record);
    } catch {
      reportInvalid();
    }
  }
  return records;
}

function parseResult(
  value: unknown,
  reportInvalid: () => void,
  expectedProjectId: string,
): ProjectKnowledgeResult | null {
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
      if (record.projectId !== expectedProjectId) throw new Error('Project mismatch');
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
  expectedProjectId: string,
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
      records: parseRecordList(
        (raw as { records?: unknown }).records,
        reportInvalid,
        expectedProjectId,
      ),
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
        if (record.projectId !== expectedProjectId) throw new Error('Project mismatch');
      } catch {
        reportInvalid();
      }
    }
    return { kind: 'get', record, diagnostics };
  }
  if (kind === 'expand') {
    const rawRecord = (raw as { record?: unknown }).record;
    let record: ProjectKnowledgeRecord | null = null;
    if (rawRecord !== null && rawRecord !== undefined) {
      try {
        record = parseProjectKnowledgeRecord(rawRecord);
        if (record.projectId !== expectedProjectId) throw new Error('Project mismatch');
      } catch {
        reportInvalid();
      }
    }
    return { kind: 'expand', record, diagnostics };
  }
  if (kind === 'manifest') {
    const items = Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items.slice(0, 500).flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            reportInvalid();
            return [];
          }
          const item = entry as Record<string, unknown>;
          const id = safeString(item.id, 128, true);
          const title = safeString(item.title, MAX_TITLE_CHARS, true);
          const summary = safeString(item.summary, MAX_CONTENT_CHARS, true);
          const type = item.type;
          const memoryType = item.memoryType;
          const state = item.state;
          const authority = item.authority;
          if (
            !id ||
            !title ||
            !summary ||
            ![
              'topology',
              'fact',
              'dependency',
              'decision',
              'pattern',
              'procedure',
              'constraint',
              'failure-resolution',
            ].includes(String(type)) ||
            (memoryType !== 'project-model' && memoryType !== 'project-policy') ||
            !['trial', 'proven', 'enforced', 'superseded'].includes(String(state)) ||
            !['automatic', 'user', 'repository'].includes(String(authority))
          ) {
            reportInvalid();
            return [];
          }
          const strings = (value: unknown): string[] =>
            Array.isArray(value)
              ? value
                  .map((candidate) => safeString(candidate, 1024))
                  .filter((candidate): candidate is string => candidate !== null)
              : [];
          const verification = Array.isArray(item.verification)
            ? item.verification.slice(0, 16).flatMap((candidate) => {
                if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
                  reportInvalid();
                  return [];
                }
                const command = safeString(
                  (candidate as { command?: unknown }).command,
                  4000,
                  true,
                );
                const expected = safeString((candidate as { expected?: unknown }).expected, 2000);
                return command ? [{ command, ...(expected === null ? {} : { expected }) }] : [];
              })
            : [];
          return [
            {
              id,
              memoryType: memoryType as 'project-model' | 'project-policy',
              type: type as import('./records.js').ProjectKnowledgeRecordType,
              state: state as import('./records.js').ProjectKnowledgeRecordState,
              authority: authority as import('./records.js').ProjectKnowledgeRecordAuthority,
              title,
              summary,
              applicablePaths: strings(item.applicablePaths),
              operations: strings(item.operations),
              phases: strings(item.phases),
              sourceTypes: strings(item.sourceTypes),
              verification,
            },
          ];
        })
      : [];
    return {
      kind: 'manifest',
      items,
      truncated: (raw as { truncated?: unknown }).truncated === true,
      diagnostics,
    };
  }
  const results: ProjectKnowledgeResult[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const entry of Array.isArray((raw as { results?: unknown }).results)
    ? ((raw as { results: unknown[] }).results ?? []).slice(0, 16)
    : []) {
    const result = parseResult(entry, reportInvalid, expectedProjectId);
    if (!result || seen.has(`${result.source}\u0000${result.title ?? ''}`)) continue;
    if (total + result.content.length > MAX_TOTAL_CHARS) break;
    seen.add(`${result.source}\u0000${result.title ?? ''}`);
    total += result.content.length;
    results.push(result);
  }
  const records = parseRecordList(
    (raw as { records?: unknown }).records,
    reportInvalid,
    expectedProjectId,
  );
  const hits: ProjectKnowledgeSearchHit[] = Array.isArray((raw as { hits?: unknown }).hits)
    ? ((raw as { hits: unknown[] }).hits ?? []).slice(0, 40).flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          reportInvalid();
          return [];
        }
        try {
          const record = parseProjectKnowledgeRecord((entry as { record?: unknown }).record);
          if (record.projectId !== expectedProjectId) throw new Error('Project mismatch');
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
  expectedProjectId: string,
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
      if (record.projectId !== expectedProjectId) throw new Error('Project mismatch');
    } catch {
      reportInvalid();
    }
  }
  return {
    kind: mutation.kind,
    changed: (raw as { changed?: unknown }).changed === true,
    ...(record === undefined ? {} : { record }),
    ...(Array.isArray((raw as { records?: unknown }).records)
      ? {
          records: parseRecordList(
            (raw as { records: unknown }).records,
            reportInvalid,
            expectedProjectId,
          ),
        }
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
    const expectedProjectId =
      request.kind === 'search' ? this.projectId : (request.projectId ?? this.projectId);
    const result = await this.request(
      'query',
      boundedQueryInput(request),
      request.kind === 'search' ? undefined : request.projectId,
    );
    if (result === null) return emptyQueryResult(request);
    const invalid = { value: false };
    const parsed = parseQueryResult(
      result,
      request,
      () => {
        invalid.value = true;
      },
      expectedProjectId,
    );
    if (!parsed || invalid.value) {
      this.report('remote-schema', 'Remote Project Knowledge query 响应包含无效数据。');
      return emptyQueryResult(request);
    }
    return parsed;
  }

  public async apply(mutation: ProjectKnowledgeMutation): Promise<ProjectKnowledgeApplyResult> {
    const expectedProjectId =
      (mutation.kind === 'upsert'
        ? mutation.record.projectId
        : mutation.kind === 'experience-delta'
          ? mutation.delta.applicability.projectId
          : mutation.projectId) ?? this.projectId;
    const result = await this.request(
      'apply',
      sanitizeMutation(mutation),
      mutation.kind === 'upsert'
        ? mutation.record.projectId
        : mutation.kind === 'experience-delta'
          ? mutation.delta.applicability.projectId
          : mutation.projectId,
    );
    if (result === null) {
      return {
        kind: mutation.kind,
        changed: false,
        diagnostics: [{ code: 'remote-unavailable', message: 'Remote Project Knowledge 不可用。' }],
      };
    }
    const invalid = { value: false };
    const parsed = parseApplyResult(
      result,
      mutation,
      () => {
        invalid.value = true;
      },
      expectedProjectId,
    );
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
    const serializedBody = JSON.stringify(body);
    if (new TextEncoder().encode(serializedBody).byteLength > MAX_REQUEST_BYTES) {
      this.report('remote-request-size', 'Remote Project Knowledge 请求超过大小限制。');
      return null;
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
          body: serializedBody,
        },
      });
      if (!response.ok) {
        this.report('remote-status', `Remote Project Knowledge 返回 HTTP ${response.status}。`);
        return null;
      }
      try {
        const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        if (!isRemoteResponseEnvelope(value, operation, body.projectId)) {
          this.report('remote-schema', 'Remote Project Knowledge 响应 envelope 无效。');
          return null;
        }
        return value.result;
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

function isRemoteResponseEnvelope(
  value: unknown,
  operation: RemoteEnvelope['operation'],
  projectId: string,
): value is RemoteResponseEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Partial<RemoteResponseEnvelope>;
  return (
    envelope.schema === 'comet.project-knowledge.provider.v1' &&
    envelope.operation === operation &&
    envelope.projectId === projectId &&
    Object.prototype.hasOwnProperty.call(envelope, 'result')
  );
}

function emptyQueryResult(request: ProjectKnowledgeQueryRequest): ProjectKnowledgeQueryResult {
  if (request.kind === 'list') {
    return { kind: 'list', records: [], truncated: false, diagnostics: noServerDiagnostics() };
  }
  if (request.kind === 'get') {
    return { kind: 'get', record: null, diagnostics: noServerDiagnostics() };
  }
  if (request.kind === 'expand') {
    return { kind: 'expand', record: null, diagnostics: noServerDiagnostics() };
  }
  if (request.kind === 'manifest') {
    return { kind: 'manifest', items: [], truncated: false, diagnostics: noServerDiagnostics() };
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
