import type {
  AgentContextOutcomeStatus,
  AgentExperienceEvidence,
} from '../agent-learning/index.js';
import type {
  MemoryCorrection,
  MemoryApplicationFeedback,
  MemoryInput,
  MemoryManagementRecord,
  MemoryManagementView,
  MemoryManifestView,
  MemoryObservation,
  MemoryObservationResult,
  MemoryProviderConfig,
  MemoryProviderMutation,
  MemoryProviderQuery,
  MemoryProviderQueryResult,
  MemoryQuery,
  MemoryRecord,
  MemoryReviewActionSet,
  MemoryReviewPacket,
  MemoryReviewResult,
  MemoryRetrieval,
  MemorySyncResult,
  PersonalMemoryProvider,
  PersonalMemoryServiceLike,
  PersonalMemoryStatus,
} from './types.js';
import { isMemoryClass } from './types.js';
import { runBoundedHttpRequest } from '../../platform/http/bounded-request.js';

const MAX_REMOTE_RESPONSE_BYTES = 1024 * 1024;
const MAX_REMOTE_REQUEST_BYTES = 512 * 1024;

export interface RemotePersonalMemoryServiceOptions extends Partial<
  Pick<MemoryProviderConfig, 'profileCharLimit' | 'taskContextCharLimit'>
> {
  readonly endpoint: string;
  readonly tokenEnv?: string;
  readonly profile?: string;
  readonly timeoutMs?: number;
  readonly projectKey?: string;
  readonly fetchImpl?: typeof fetch;
}

export class RemotePersonalMemoryService
  implements PersonalMemoryServiceLike, PersonalMemoryProvider
{
  private readonly endpoint: string;
  private readonly tokenEnv: string | undefined;
  private readonly profile: string;
  private readonly timeoutMs: number;
  private readonly projectKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: RemotePersonalMemoryServiceOptions) {
    this.endpoint = options.endpoint.trim();
    if (!this.endpoint) throw new Error('Remote Provider endpoint must not be empty');
    this.tokenEnv = options.tokenEnv;
    this.profile = options.profile?.trim() || 'default';
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.projectKey = options.projectKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async status(): Promise<PersonalMemoryStatus> {
    return {
      learningEnabled: true,
      retrievalEnabled: true,
      pausedProjects: [],
      pausedLearningProjects: [],
      pausedRetrievalProjects: [],
      files: [],
      remote: null,
      sync: null,
      provider: {
        provider: 'remote',
        configured: true,
        endpoint: redactEndpoint(this.endpoint),
        profile: this.profile,
        tokenConfigured: this.tokenEnv === undefined || Boolean(process.env[this.tokenEnv]),
        timeoutMs: this.timeoutMs,
      },
    };
  }

  public async query(request: MemoryProviderQuery): Promise<MemoryProviderQueryResult> {
    if (request.view === 'manage') return this.manage(request.query);
    if (request.view === 'expand') {
      if (!request.query.id) throw new Error('Memory expand requires an id');
      return { kind: 'expand', record: await this.get(request.query.id) };
    }
    if (request.view === 'manifest') {
      const result = await this.request<unknown>('query', {
        view: 'manifest',
        query: { ...request.query, projectKey: request.query.projectKey ?? this.projectKey },
      });
      return normalizeManifest(result, request.query.projectKey ?? this.projectKey);
    }
    return this.retrieve({ ...request.query, view: request.view });
  }

  public async apply(mutation: MemoryProviderMutation): Promise<unknown> {
    const result = await this.request('apply', mutation);
    return normalizeMutationResult(result, mutation.operation, this.projectKey);
  }

  public async get(id: string): Promise<MemoryRecord | null> {
    const result = await this.request<unknown>('get', { id });
    if (
      !isRecord(result) ||
      (result.record !== null && result.record !== undefined && !isRecord(result.record))
    ) {
      throw new Error('Remote Provider returned an invalid memory record');
    }
    return result.record === null || result.record === undefined
      ? null
      : normalizeMemoryRecord(result.record, this.projectKey, false);
  }

  public async remember(input: MemoryInput): Promise<MemoryRecord> {
    const result = await this.request<unknown>('apply', {
      operation: 'remember',
      input,
    });
    return requireMutationRecord(result, this.projectKey);
  }

  public async correct(id: string, correction: MemoryCorrection): Promise<MemoryRecord> {
    const result = await this.request<unknown>('apply', {
      operation: 'correct',
      input: { id, correction },
    });
    return requireMutationRecord(result, this.projectKey);
  }

  public async remove(id: string, options: { readonly permanent?: boolean } = {}): Promise<void> {
    const result = await this.request<unknown>('apply', {
      operation: 'forget',
      input: { id, ...options },
    });
    normalizeAcknowledgement(result);
  }

  public async rollback(id: string): Promise<MemoryRecord> {
    const result = await this.request<unknown>('apply', {
      operation: 'rollback',
      input: { id },
    });
    return requireMutationRecord(result, this.projectKey);
  }

  public async recordApplicationOutcome(
    id: string,
    outcome: AgentContextOutcomeStatus,
    options: Omit<MemoryApplicationFeedback, 'id' | 'outcome'> = {},
  ): Promise<MemoryRecord | null> {
    const result = await this.request<unknown>('apply', {
      operation: 'feedback',
      input: { id, outcome, ...options },
    });
    if (!isRecord(result) || (result.record !== null && !isRecord(result.record))) {
      throw new Error('Remote Provider returned an invalid memory feedback result');
    }
    return result.record === null
      ? null
      : normalizeMemoryRecord(result.record, this.projectKey, false);
  }

  public async observe(observation: MemoryObservation): Promise<MemoryObservationResult> {
    const result = await this.request<unknown>('apply', {
      operation: 'observe',
      input: observation,
    });
    return normalizeObservationResult(result, this.projectKey);
  }

  public async reviewAndApply(
    packet: MemoryReviewPacket,
    actions: MemoryReviewActionSet,
  ): Promise<MemoryReviewResult> {
    const result = await this.request<unknown>('apply', {
      operation: 'review',
      input: { packet, actions },
    });
    return normalizeReviewResult(result, this.projectKey);
  }

  public async retrieve(query: MemoryQuery): Promise<MemoryRetrieval> {
    const result = await this.request<MemoryRetrieval>('query', {
      view: query.view === 'profile' || query.view === 'task' ? query.view : 'combined',
      query: { ...query, projectKey: query.projectKey ?? this.projectKey },
    });
    return normalizeRetrieval(result, query.projectKey ?? this.projectKey);
  }

  public async manage(query: MemoryQuery = {}): Promise<MemoryManagementView> {
    const result = await this.request<MemoryManagementView>('query', {
      view: 'manage',
      query: { ...query, projectKey: query.projectKey ?? this.projectKey },
    });
    return normalizeManagement(result, query.projectKey ?? this.projectKey);
  }

  public async sync(): Promise<MemorySyncResult> {
    return {
      status: 'synced',
      retryable: false,
      message: 'Remote Provider is active; Git sync is not used.',
    };
  }

  public async testProvider(): Promise<{ readonly ok: boolean; readonly message?: string }> {
    const result = await this.request<unknown>('test', {});
    if (
      !isRecord(result) ||
      typeof result.ok !== 'boolean' ||
      (result.message !== undefined && typeof result.message !== 'string')
    ) {
      throw new Error('Remote Provider returned an invalid provider test result');
    }
    return result as { readonly ok: boolean; readonly message?: string };
  }

  public async remote(): Promise<string | null> {
    return redactEndpoint(this.endpoint);
  }

  public async configureRemote(): Promise<void> {
    throw new Error('Remote Provider does not use a Git remote');
  }

  public async setLearningEnabled(enabled: boolean): Promise<void> {
    normalizeAcknowledgement(
      await this.request('apply', { operation: 'settings', input: { learningEnabled: enabled } }),
    );
  }

  public async setRetrievalEnabled(enabled: boolean): Promise<void> {
    normalizeAcknowledgement(
      await this.request('apply', { operation: 'settings', input: { retrievalEnabled: enabled } }),
    );
  }

  public async pauseProjectLearning(projectKey: string, paused: boolean): Promise<void> {
    normalizeAcknowledgement(
      await this.request('apply', {
        operation: 'settings',
        input: { projectKey, pausedLearning: paused },
      }),
    );
  }

  public async pauseProjectRetrieval(projectKey: string, paused: boolean): Promise<void> {
    normalizeAcknowledgement(
      await this.request('apply', {
        operation: 'settings',
        input: { projectKey, pausedRetrieval: paused },
      }),
    );
  }

  private async request<T>(operation: string, payload: unknown): Promise<T> {
    const token = this.tokenEnv === undefined ? undefined : process.env[this.tokenEnv];
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const body = JSON.stringify({
      schema: 'comet.personal-memory.provider.v1',
      operation,
      profile: this.profile,
      ...(this.projectKey === undefined ? {} : { projectKey: this.projectKey }),
      payload,
    });
    if (new TextEncoder().encode(body).byteLength > MAX_REMOTE_REQUEST_BYTES) {
      throw new Error('Remote Personal Memory request exceeds byte limit');
    }
    const { response, bytes } = await runBoundedHttpRequest({
      url: this.endpoint,
      timeoutMs: this.timeoutMs,
      maxResponseBytes: MAX_REMOTE_RESPONSE_BYTES,
      fetch: this.fetchImpl,
      init: {
        method: 'POST',
        headers,
        body,
      },
    });
    if (!response.ok) throw new Error(`Remote Provider request failed (${response.status})`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (error) {
      throw new Error('Remote Provider returned invalid JSON', { cause: error });
    }
    if (!isRecord(parsed)) throw new Error('Remote Provider returned an invalid response');
    return (isRecord(parsed.result) ? parsed.result : parsed) as T;
  }
}

function normalizeMutationResult(
  value: unknown,
  operation: MemoryProviderMutation['operation'],
  projectKey?: string,
): unknown {
  switch (operation) {
    case 'remember':
    case 'correct':
    case 'rollback':
      return requireMutationRecord(value, projectKey);
    case 'observe':
      return normalizeObservationResult(value, projectKey);
    case 'review':
      return normalizeReviewResult(value, projectKey);
    case 'forget':
      return normalizeAcknowledgement(value);
    case 'feedback':
      if (!isRecord(value) || (value.record !== null && !isRecord(value.record))) {
        throw new Error('Remote Provider returned an invalid memory feedback result');
      }
      return value.record === null ? null : normalizeMemoryRecord(value.record, projectKey, false);
    case 'experience-delta':
      if (!isRecord(value) || typeof value.changed !== 'boolean') {
        throw new Error('Remote Provider returned an invalid Learning Delta result');
      }
      return {
        changed: value.changed,
        ...(value.record === undefined || value.record === null
          ? { record: null }
          : { record: normalizeMemoryRecord(value.record, projectKey, false) }),
      };
  }
}

function normalizeManifest(value: unknown, projectKey?: string): MemoryManifestView {
  if (!isRecord(value) || value.kind !== 'manifest' || !Array.isArray(value.items)) {
    throw new Error('Remote Provider returned an invalid memory manifest');
  }
  return {
    kind: 'manifest',
    truncated: value.truncated === true,
    items: value.items.map((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.id !== 'string' ||
        typeof entry.memoryType !== 'string' ||
        typeof entry.state !== 'string' ||
        (entry.authority !== 'explicit' && entry.authority !== 'inferred') ||
        typeof entry.title !== 'string' ||
        typeof entry.summary !== 'string' ||
        (entry.scope !== 'global' && entry.scope !== 'project') ||
        !stringArray(entry.pathPatterns) ||
        !stringArray(entry.taskTypes) ||
        !stringArray(entry.operations) ||
        !stringArray(entry.phases) ||
        !Array.isArray(entry.evidence) ||
        !entry.evidence.every(isExperienceEvidence)
      ) {
        throw new Error('Remote Provider returned an invalid memory manifest item');
      }
      return {
        id: entry.id,
        memoryType: entry.memoryType as MemoryManifestView['items'][number]['memoryType'],
        state: entry.state as MemoryManifestView['items'][number]['state'],
        authority: entry.authority,
        title: entry.title,
        summary: entry.summary,
        scope: entry.scope,
        ...(entry.scope === 'project'
          ? { projectKey: String(entry.projectKey ?? projectKey ?? '') }
          : {}),
        pathPatterns: entry.pathPatterns,
        taskTypes: entry.taskTypes,
        operations: entry.operations,
        phases: entry.phases,
        evidence: entry.evidence.map(normalizeExperienceEvidence),
      };
    }),
  };
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function requireMutationRecord(value: unknown, projectKey?: string): MemoryRecord {
  if (!isRecord(value) || !isRecord(value.record)) {
    throw new Error('Remote Provider returned no memory record');
  }
  return normalizeMemoryRecord(value.record, projectKey, false);
}

function normalizeObservationResult(value: unknown, projectKey?: string): MemoryObservationResult {
  if (
    !isRecord(value) ||
    typeof value.deduplicated !== 'boolean' ||
    typeof value.ignored !== 'boolean' ||
    typeof value.candidate !== 'boolean' ||
    typeof value.promoted !== 'boolean' ||
    (value.record !== null && value.record !== undefined && !isRecord(value.record))
  ) {
    throw new Error('Remote Provider returned an invalid observation result');
  }
  return {
    deduplicated: value.deduplicated,
    ignored: value.ignored,
    candidate: value.candidate,
    promoted: value.promoted,
    record:
      value.record === null || value.record === undefined
        ? null
        : normalizeMemoryRecord(value.record, projectKey, false),
  };
}

function normalizeReviewResult(value: unknown, projectKey?: string): MemoryReviewResult {
  if (
    !isRecord(value) ||
    (value.action !== 'create' &&
      value.action !== 'update' &&
      value.action !== 'forget' &&
      value.action !== 'skip') ||
    typeof value.persisted !== 'boolean' ||
    (value.reason !== undefined && typeof value.reason !== 'string') ||
    (value.notification !== undefined && typeof value.notification !== 'string') ||
    (value.observation !== undefined && !isRecord(value.observation)) ||
    (value.results !== undefined &&
      (!Array.isArray(value.results) || !value.results.every((entry) => isRecord(entry))))
  ) {
    throw new Error('Remote Provider returned an invalid review result');
  }
  return {
    action: value.action,
    persisted: value.persisted,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
    ...(value.notification === undefined ? {} : { notification: value.notification }),
    ...(value.observation === undefined
      ? {}
      : { observation: normalizeObservationResult(value.observation, projectKey) }),
    ...(value.results === undefined
      ? {}
      : { results: value.results.map((entry) => normalizeReviewResult(entry, projectKey)) }),
  };
}

function normalizeAcknowledgement(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Remote Provider returned an invalid mutation result');
  return value;
}

function normalizeRetrieval(value: unknown, projectKey?: string): MemoryRetrieval {
  if (!isRecord(value) || !Array.isArray(value.records)) {
    throw new Error('Remote Provider returned an invalid retrieval');
  }
  const records = value.records.map((entry) => normalizeMemoryRecord(entry, projectKey));
  const profileRecords = Array.isArray(value.profileRecords)
    ? value.profileRecords.map((entry) => normalizeMemoryRecord(entry, projectKey))
    : undefined;
  const taskRecords = Array.isArray(value.taskRecords)
    ? value.taskRecords.map((entry) => normalizeMemoryRecord(entry, projectKey))
    : undefined;
  return {
    records,
    text: renderRecords(records),
    truncated: value.truncated === true,
    disabled: value.disabled === true,
    ...(profileRecords === undefined ? {} : { profileRecords }),
    ...(profileRecords === undefined ? {} : { profileText: renderRecords(profileRecords) }),
    ...(value.profileTruncated === true ? { profileTruncated: true } : {}),
    ...(taskRecords === undefined ? {} : { taskRecords }),
    ...(taskRecords === undefined ? {} : { taskText: renderRecords(taskRecords) }),
    ...(value.taskTruncated === true ? { taskTruncated: true } : {}),
  };
}

function normalizeMemoryRecord(
  value: unknown,
  projectKey?: string,
  requireApplicable = true,
): MemoryRecord {
  if (!isRecord(value)) throw new Error('Remote Provider returned an invalid memory record');
  const scope = value.scope;
  if (
    (scope !== 'global' && scope !== 'project') ||
    typeof value.id !== 'string' ||
    value.id.trim().length === 0 ||
    typeof value.category !== 'string' ||
    typeof value.text !== 'string' ||
    (scope === 'project' && typeof value.projectKey !== 'string') ||
    (projectKey !== undefined && scope === 'project' && value.projectKey !== projectKey) ||
    !Array.isArray(value.tags) ||
    !Array.isArray(value.pathPatterns) ||
    !Array.isArray(value.taskTypes) ||
    !Array.isArray(value.operations) ||
    !Array.isArray(value.phases) ||
    !Array.isArray(value.evidence) ||
    !value.tags.every((entry) => typeof entry === 'string') ||
    !value.pathPatterns.every((entry) => typeof entry === 'string') ||
    !value.taskTypes.every((entry) => typeof entry === 'string') ||
    !value.operations.every((entry) => typeof entry === 'string') ||
    !value.phases.every((entry) => typeof entry === 'string') ||
    !value.evidence.every(isExperienceEvidence) ||
    (value.memoryClass !== undefined && !isMemoryClass(value.memoryClass)) ||
    (value.language !== undefined && value.language !== 'zh-CN' && value.language !== 'en') ||
    (value.kind !== 'explicit' && value.kind !== 'inferred') ||
    (value.authority !== 'explicit' && value.authority !== 'inferred') ||
    (value.memoryType !== 'core-profile' &&
      value.memoryType !== 'collaboration-policy' &&
      value.memoryType !== 'personal-episode') ||
    ((value.memoryType === 'personal-episode' || value.episode !== undefined) &&
      !isPersonalEpisodeDetails(value.episode)) ||
    (value.state !== 'trial' && value.state !== 'proven' && value.state !== 'superseded') ||
    (requireApplicable && value.state === 'superseded') ||
    typeof value.applicationCount !== 'number' ||
    typeof value.successCount !== 'number' ||
    typeof value.failureCount !== 'number' ||
    !normalizeSource(value.source) ||
    !Array.isArray(value.sources) ||
    !value.sources.every((entry) => normalizeSource(entry)) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('Remote Provider returned an invalid memory record');
  }
  return value as unknown as MemoryRecord;
}

function normalizeSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === 'user' ||
      value.kind === 'workflow' ||
      value.kind === 'review' ||
      value.kind === 'repository')
  );
}

function renderRecords(records: readonly MemoryRecord[]): string {
  const groups = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    const category = typeof record.category === 'string' ? record.category : 'Personal memory';
    groups.set(category, [...(groups.get(category) ?? []), record]);
  }
  return [...groups.entries()]
    .map(
      ([category, entries]) =>
        `## ${category}\n${entries.map((entry) => `- ${entry.text}`).join('\n')}`,
    )
    .join('\n\n');
}

function normalizeManagement(value: unknown, projectKey?: string): MemoryManagementView {
  if (!isRecord(value) || !Array.isArray(value.records) || !Array.isArray(value.conflicts)) {
    throw new Error('Remote Provider returned an invalid management view');
  }
  return {
    records: value.records.map((entry) => normalizeManagementRecord(entry, projectKey)),
    conflicts: value.conflicts.map((entry) => {
      if (
        !isRecord(entry) ||
        !Array.isArray(entry.texts) ||
        !entry.texts.every((text) => typeof text === 'string') ||
        typeof entry.updatedAt !== 'string'
      ) {
        throw new Error('Remote Provider returned an invalid management view');
      }
      return entry as unknown as MemoryManagementView['conflicts'][number];
    }),
    truncated: value.truncated === true,
  };
}

function normalizeManagementRecord(value: unknown, projectKey?: string): MemoryManagementRecord {
  if (!isRecord(value)) throw new Error('Remote Provider returned an invalid management view');
  const scope = value.scope;
  if (
    (scope !== 'global' && scope !== 'project') ||
    typeof value.id !== 'string' ||
    value.id.trim().length === 0 ||
    typeof value.category !== 'string' ||
    typeof value.text !== 'string' ||
    (scope === 'project' && typeof value.projectKey !== 'string') ||
    (projectKey !== undefined && scope === 'project' && value.projectKey !== projectKey) ||
    !Array.isArray(value.tags) ||
    !Array.isArray(value.pathPatterns) ||
    !Array.isArray(value.taskTypes) ||
    !Array.isArray(value.operations) ||
    !Array.isArray(value.phases) ||
    !Array.isArray(value.evidence) ||
    !value.tags.every((entry) => typeof entry === 'string') ||
    !value.pathPatterns.every((entry) => typeof entry === 'string') ||
    !value.taskTypes.every((entry) => typeof entry === 'string') ||
    !value.operations.every((entry) => typeof entry === 'string') ||
    !value.phases.every((entry) => typeof entry === 'string') ||
    !value.evidence.every(isExperienceEvidence) ||
    (value.memoryClass !== undefined && !isMemoryClass(value.memoryClass)) ||
    (value.language !== undefined && value.language !== 'zh-CN' && value.language !== 'en') ||
    (value.kind !== 'explicit' && value.kind !== 'inferred') ||
    (value.authority !== 'explicit' && value.authority !== 'inferred') ||
    (value.status !== 'trial' &&
      value.status !== 'proven' &&
      value.status !== 'superseded' &&
      value.status !== 'conflict' &&
      value.status !== 'tombstoned') ||
    (value.memoryType !== 'core-profile' &&
      value.memoryType !== 'collaboration-policy' &&
      value.memoryType !== 'personal-episode') ||
    ((value.memoryType === 'personal-episode' || value.episode !== undefined) &&
      !isPersonalEpisodeDetails(value.episode)) ||
    typeof value.applicationCount !== 'number' ||
    typeof value.successCount !== 'number' ||
    typeof value.failureCount !== 'number' ||
    typeof value.evidenceCount !== 'number' ||
    value.evidenceCount < 0 ||
    (value.sourceKind !== 'user' &&
      value.sourceKind !== 'workflow' &&
      value.sourceKind !== 'review' &&
      value.sourceKind !== 'repository') ||
    typeof value.lastConfirmedAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    typeof value.canRollback !== 'boolean'
  ) {
    throw new Error('Remote Provider returned an invalid management view');
  }
  return value as unknown as MemoryManagementRecord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPersonalEpisodeDetails(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.situation === 'string' &&
    value.situation.trim().length > 0 &&
    typeof value.actionSummary === 'string' &&
    value.actionSummary.trim().length > 0 &&
    typeof value.outcome === 'string' &&
    value.outcome.trim().length > 0 &&
    typeof value.lesson === 'string' &&
    value.lesson.trim().length > 0
  );
}

function isExperienceEvidence(value: unknown): value is AgentExperienceEvidence {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    ['user', 'source', 'verification', 'review', 'failure', 'outcome'].includes(
      String(value.kind),
    ) &&
    typeof value.summary === 'string' &&
    (value.source === undefined || typeof value.source === 'string') &&
    (value.anchor === undefined || typeof value.anchor === 'string') &&
    (value.digest === undefined || typeof value.digest === 'string') &&
    (value.command === undefined || typeof value.command === 'string') &&
    (value.success === undefined || typeof value.success === 'boolean')
  );
}

function normalizeExperienceEvidence(value: AgentExperienceEvidence): AgentExperienceEvidence {
  return {
    id: value.id,
    kind: value.kind,
    summary: value.summary,
    ...(value.source === undefined ? {} : { source: value.source }),
    ...(value.anchor === undefined ? {} : { anchor: value.anchor }),
    ...(value.digest === undefined ? {} : { digest: value.digest }),
    ...(value.command === undefined ? {} : { command: value.command }),
    ...(value.success === undefined ? {} : { success: value.success }),
  };
}

function redactEndpoint(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = url.username ? '***' : '';
      url.password = url.password ? '***' : '';
    }
    return url.toString().replace(/\/$/u, '');
  } catch {
    return value.replace(/(\/\/)[^/@]+@/u, '$1***@');
  }
}
