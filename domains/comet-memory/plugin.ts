import { randomUUID } from 'node:crypto';

import type {
  PluginContext,
  PluginDescriptor,
  PluginEvent,
  PluginModule,
} from '../comet-plugin/index.js';
import type {
  MemoryInput,
  MemoryCorrection,
  MemoryManagementView,
  MemoryRecord,
  MemoryProviderMutation,
  MemoryProviderQuery,
  MemoryQuery,
  MemoryQueryView,
  MemoryObservation,
  MemoryReviewPacket,
  MemoryReviewResult,
  MemoryReviewRequest,
  MemoryProviderConfig,
  MemoryRetrieval,
  PersonalMemoryProvider,
  PersonalMemoryProjectPolicy,
  PersonalMemoryPluginOptions,
  PersonalMemoryServiceLike,
} from './types.js';
import { isMemoryClass } from './types.js';
import { invokeMemoryReviewSkill } from './skill-runtime.js';

export const PERSONAL_MEMORY_PLUGIN_ID = 'comet.personal-memory';

const DEFAULT_PROJECT_POLICY: PersonalMemoryProjectPolicy = {
  learning: true,
  retrieval: true,
};

export function createPersonalMemoryPluginDescriptor(
  options: PersonalMemoryPluginOptions,
): PluginDescriptor {
  return {
    id: PERSONAL_MEMORY_PLUGIN_ID,
    kind: 'first-party',
    version: options.version ?? '1.0.0',
    scopes: ['user', 'project'],
    compatible: options.cometVersionRange ?? (() => true),
    create: async (context) => createModule(context, options),
  };
}

async function createModule(
  context: PluginContext,
  options: PersonalMemoryPluginOptions,
): Promise<PluginModule> {
  const service = options.createService(context);
  const provider = resolveProvider(service);
  const projectPolicy = options.projectPolicy ?? DEFAULT_PROJECT_POLICY;
  const reviewNotices: string[] = [];
  const announcedConflicts = new Set<string>();
  const announcedRetrievals = new Set<string>();

  const notify = async (message: string): Promise<void> => {
    if (reviewNotices.length >= 8) reviewNotices.shift();
    reviewNotices.push(message);
    try {
      await options.onReviewNotice?.(message);
    } catch {
      // Notice delivery is optional and must never affect the workflow.
    }
  };

  const applyReview = async (packet: MemoryReviewPacket): Promise<MemoryReviewResult> => {
    let result: MemoryReviewResult;
    try {
      const actions = await invokeMemoryReviewSkill(packet, options.runMemoryReview);
      result = (await provider.apply({
        operation: 'review',
        input: { packet, actions },
      })) as MemoryReviewResult;
    } catch (error) {
      if (packet.explicitRequest !== undefined) throw error;
      return {
        action: 'skip',
        persisted: false,
        reason:
          packet.language === 'en'
            ? 'Memory review was unavailable.'
            : '记忆评审暂不可用，已跳过。',
      };
    }

    if (packet.explicitRequest !== undefined && !result.persisted) {
      throw new Error(result.reason ?? 'Explicit personal memory request was not persisted.');
    }

    const explicitAction = packet.explicitRequest?.action;
    if (explicitAction !== undefined && result.persisted) {
      await notify(
        packet.language === 'en'
          ? explicitAction === 'remember'
            ? 'Personal memory saved.'
            : explicitAction === 'correct'
              ? 'Personal memory updated.'
              : 'Personal memory forgotten.'
          : explicitAction === 'remember'
            ? '个人记忆已保存。'
            : explicitAction === 'correct'
              ? '个人记忆已更新。'
              : '个人记忆已忘记。',
      );
    }

    if (explicitAction === undefined && reviewHasCandidate(result)) {
      try {
        const management = (await provider.query({
          view: 'manage',
          query:
            packet.projectKey === undefined
              ? { scope: 'global' }
              : { scope: 'project', projectKey: packet.projectKey },
        })) as MemoryManagementView;
        for (const conflict of management.conflicts) {
          const key = `${conflict.updatedAt}:${conflict.texts.join('\u0000')}`;
          if (announcedConflicts.has(key)) continue;
          announcedConflicts.add(key);
          await notify(
            packet.language === 'en'
              ? 'Conflicting memory evidence needs your review.'
              : '发现相互冲突的记忆证据，请在记忆管理中确认。',
          );
        }
      } catch {
        // Conflict inspection is advisory; persistence has already completed.
      }
    }
    return result;
  };

  const retrieveWithNotice = async (query: MemoryQuery): Promise<MemoryRetrieval> => {
    let retrieval;
    try {
      retrieval = (await provider.query({
        view: retrievalView(query.view),
        query,
      })) as MemoryRetrieval;
    } catch {
      return { records: [], text: '', truncated: false, disabled: false };
    }
    const firstUse = retrieval.records.some((record) => !announcedRetrievals.has(record.id));
    retrieval.records.forEach((record) => announcedRetrievals.add(record.id));
    if (firstUse) {
      await notify(
        options.language === 'en'
          ? 'A saved preference was applied to this task.'
          : '这次任务已应用一条已保存的协作偏好。',
      );
    }
    return retrieval;
  };

  return {
    events: [
      'change.completed',
      'task.completed',
      'review.completed',
      'verification.completed',
      'memory.observe',
    ],
    dashboard: {
      id: 'personal-memory',
      label: options.language === 'en' ? 'Personal Memory' : '个人记忆',
      route: '/plugins/personal-memory',
      load: async ({ projectId, invoke }) => ({
        projectKey: projectId,
        policy: projectPolicy,
        status: await invoke('status'),
        providerConfig: await options.getProviderConfig?.(),
        retrieval: await invoke('retrieve', { view: 'combined', projectKey: projectId }),
        management: await invoke('manage', { projectKey: projectId }),
        operations: [
          'remember',
          'manage',
          'correct',
          'remove',
          'rollback',
          'sync',
          'remote',
          'configure-remote',
          'set-learning',
          'set-retrieval',
          'pause-project-learning',
          'pause-project-retrieval',
          'get-provider-config',
          'test-provider',
          'configure-provider',
        ],
        notifications: reviewNotices.splice(0),
      }),
    },
    onEvent: async (event) => {
      if (!projectPolicy.learning) return;
      const observation = observationFromEvent(event);
      if (observation !== null) {
        if (
          observation.source?.kind !== 'user' &&
          (observation.userEvidence?.length ?? 0) === 0 &&
          observation.explicitRequest === undefined
        ) {
          return;
        }
        const review = async () => {
          const packet = await reviewPacketFromObservation(
            provider,
            observation,
            event.name,
            options.language,
          );
          await applyReview(packet);
        };
        if (options.runReviewInBackground !== undefined) {
          try {
            await options.runReviewInBackground(review);
          } catch {
            // Host background adapters are optional; a failed review is non-blocking.
          }
        } else {
          await review();
        }
      }
    },
    provideContext: async (request) => {
      if (!projectPolicy.retrieval) return null;
      const retrieval = await retrieveWithNotice({
        view: 'combined',
        projectKey: request.projectId ?? context.projectId,
        task: request.task,
        path: request.path,
      });
      if (retrieval.disabled || retrieval.records.length === 0) return null;
      return { text: retrieval.text, records: retrieval.records };
    },
    invoke: async (capability, input) =>
      invokeCapability(
        provider,
        service,
        capability,
        input,
        options.language,
        projectPolicy,
        applyReview,
        retrieveWithNotice,
        options.getProviderConfig,
        options.configureProvider,
      ),
  };
}

async function invokeCapability(
  provider: PersonalMemoryProvider,
  service: PersonalMemoryServiceLike,
  capability: string,
  input: unknown,
  language: 'zh-CN' | 'en' | undefined,
  projectPolicy: PersonalMemoryProjectPolicy,
  applyReview: (packet: MemoryReviewPacket) => Promise<MemoryReviewResult>,
  retrieveWithNotice: (query: MemoryQuery) => Promise<MemoryRetrieval>,
  getProviderConfig?: () => Promise<MemoryProviderConfig>,
  configureProvider?: (config: MemoryProviderConfig) => Promise<void>,
): Promise<unknown> {
  switch (capability) {
    case 'remember':
      return reviewExplicitMemoryRequest(
        service,
        {
          action: 'remember',
          input: asRecord<MemoryInput>(input, 'remember'),
        },
        language,
        applyReview,
        provider,
      );
    case 'correct': {
      const value = asObject(input, 'correct');
      return reviewExplicitMemoryRequest(
        service,
        {
          action: 'correct',
          id: asString(value.id, 'correct.id'),
          correction: value.correction as never,
        },
        language,
        applyReview,
        provider,
      );
    }
    case 'remove': {
      const value = asObject(input, 'remove');
      return reviewExplicitMemoryRequest(
        service,
        {
          action: 'forget',
          id: asString(value.id, 'remove.id'),
          permanent: value.permanent === true,
        },
        language,
        applyReview,
        provider,
      );
    }
    case 'rollback': {
      const value = asObject(input, 'rollback');
      return provider.apply({
        operation: 'rollback',
        input: { id: asString(value.id, 'rollback.id') },
      });
    }
    case 'observe': {
      if (!projectPolicy.learning) {
        return {
          deduplicated: false,
          ignored: true,
          candidate: false,
          activated: false,
          record: null,
        };
      }
      const observation = asRecord<MemoryObservation>(input, 'observe');
      const packet = await reviewPacketFromObservation(
        provider,
        observation,
        'memory.observe',
        language,
      );
      return applyReview(packet);
    }
    case 'retrieve':
      return retrieveWithNotice(asRecord(input, 'retrieve') as MemoryQuery);
    case 'manage':
      return provider.query({
        view: 'manage',
        query: asRecord<MemoryQuery>(input, 'manage'),
      });
    case 'status':
      return provider.status();
    case 'test-provider':
      if (service.testProvider === undefined) throw new Error('Provider test is unavailable');
      return service.testProvider();
    case 'get-provider-config':
      if (getProviderConfig === undefined) throw new Error('Provider settings are unavailable');
      return getProviderConfig();
    case 'configure-provider':
      if (configureProvider === undefined) throw new Error('Provider settings are unavailable');
      return configureProvider(asRecord<MemoryProviderConfig>(input, 'configure-provider'));
    case 'sync':
      return service.sync();
    case 'remote':
      return service.remote?.() ?? null;
    case 'configure-remote': {
      if (service.configureRemote === undefined) throw new Error('Memory Git sync is unavailable');
      return service.configureRemote(asString(asObject(input, 'configure-remote').url, 'url'));
    }
    case 'set-learning':
      if (service.setLearningEnabled === undefined)
        throw new Error('Learning settings are unavailable');
      return service.setLearningEnabled(asBoolean(asObject(input, 'set-learning').enabled));
    case 'set-retrieval':
      if (service.setRetrievalEnabled === undefined)
        throw new Error('Retrieval settings are unavailable');
      return service.setRetrievalEnabled(asBoolean(asObject(input, 'set-retrieval').enabled));
    case 'pause-project-learning':
      if (service.pauseProjectLearning === undefined)
        throw new Error('Project learning settings are unavailable');
      return service.pauseProjectLearning(
        asString(asObject(input, 'pause-project-learning').projectKey, 'projectKey'),
        asBoolean(asObject(input, 'pause-project-learning').paused),
      );
    case 'pause-project-retrieval':
      if (service.pauseProjectRetrieval === undefined)
        throw new Error('Project retrieval settings are unavailable');
      return service.pauseProjectRetrieval(
        asString(asObject(input, 'pause-project-retrieval').projectKey, 'projectKey'),
        asBoolean(asObject(input, 'pause-project-retrieval').paused),
      );
    default:
      throw new Error(`Unknown personal memory capability: ${capability}`);
  }
}

async function reviewExplicitMemoryRequest(
  service: PersonalMemoryServiceLike,
  input:
    | { readonly action: 'remember'; readonly input: MemoryInput }
    | { readonly action: 'correct'; readonly id: string; readonly correction: MemoryCorrection }
    | { readonly action: 'forget'; readonly id: string; readonly permanent: boolean },
  language: 'zh-CN' | 'en' | undefined,
  applyReview: (packet: MemoryReviewPacket) => Promise<MemoryReviewResult>,
  provider: PersonalMemoryProvider,
): Promise<MemoryRecord | null | void> {
  const target = input.action === 'remember' ? null : await service.get(input.id);
  const request =
    input.action === 'remember'
      ? {
          action: 'remember' as const,
          scope: input.input.scope,
          ...(input.input.projectKey === undefined ? {} : { projectKey: input.input.projectKey }),
          ...(input.input.category === undefined ? {} : { category: input.input.category }),
          ...(input.input.memoryClass === undefined
            ? {}
            : { memoryClass: input.input.memoryClass }),
          ...(input.input.title === undefined ? {} : { title: input.input.title }),
          ...(input.input.reason === undefined ? {} : { reason: input.input.reason }),
          text: input.input.text,
          ...(input.input.tags === undefined ? {} : { tags: input.input.tags }),
          ...(input.input.pathPatterns === undefined
            ? {}
            : { pathPatterns: input.input.pathPatterns }),
          ...(input.input.taskTypes === undefined ? {} : { taskTypes: input.input.taskTypes }),
          ...(input.input.operations === undefined ? {} : { operations: input.input.operations }),
        }
      : input.action === 'correct'
        ? {
            action: 'correct' as const,
            targetId: input.id,
            ...(input.correction.text === undefined ? {} : { text: input.correction.text }),
            ...(input.correction.category === undefined
              ? {}
              : { category: input.correction.category }),
            ...(input.correction.memoryClass === undefined
              ? {}
              : { memoryClass: input.correction.memoryClass }),
            ...(input.correction.title === undefined ? {} : { title: input.correction.title }),
            ...(input.correction.reason === undefined ? {} : { reason: input.correction.reason }),
            ...(input.correction.tags === undefined ? {} : { tags: input.correction.tags }),
            ...(input.correction.pathPatterns === undefined
              ? {}
              : { pathPatterns: input.correction.pathPatterns }),
            ...(input.correction.taskTypes === undefined
              ? {}
              : { taskTypes: input.correction.taskTypes }),
            ...(input.correction.operations === undefined
              ? {}
              : { operations: input.correction.operations }),
          }
        : { action: 'forget' as const, targetId: input.id, permanent: input.permanent };
  const scope =
    target?.scope ?? (input.action === 'remember' ? input.input.scope : undefined) ?? 'project';
  const projectKey =
    scope === 'project'
      ? (target?.projectKey ?? (input.action === 'remember' ? input.input.projectKey : undefined))
      : undefined;
  const category =
    (input.action === 'remember' ? input.input.category : target?.category) ??
    (language === 'en' ? 'Reusable preference' : '可复用偏好');
  const text =
    (input.action === 'remember'
      ? input.input.text
      : input.action === 'correct'
        ? input.correction.text
        : target?.text) ??
    (language === 'en' ? 'Explicit personal memory request' : '用户明确的个人记忆操作');
  const observation: MemoryObservation = {
    scope,
    ...(projectKey === undefined ? {} : { projectKey }),
    projectIdentity: projectKey ?? 'comet-project',
    category,
    ...(input.action === 'remember' && input.input.memoryClass === undefined
      ? {}
      : input.action === 'remember'
        ? { memoryClass: input.input.memoryClass }
        : {}),
    text,
    language: input.action === 'remember' ? (input.input.language ?? language) : language,
    workflow: 'cli',
    changeId: `cli:${input.action}:${randomUUID()}`,
    candidateKey: `cli:${input.action}`,
    success: true,
    userEvidence: [text],
    explicitRequest: request,
    source: { kind: 'user' },
  };
  const packet = await reviewPacketFromObservation(provider, observation, 'memory.cli', language);
  const result = await applyReview(packet);
  if (input.action === 'remember') return result.observation?.record ?? null;
  if (input.action === 'correct') return await service.get(input.id);
}

function retrievalView(view: MemoryQueryView | undefined): Exclude<MemoryQueryView, 'manage'> {
  return view === 'profile' || view === 'task' ? view : 'combined';
}

function resolveProvider(service: PersonalMemoryServiceLike): PersonalMemoryProvider {
  if (service.query !== undefined && service.apply !== undefined) {
    return service as PersonalMemoryProvider;
  }
  return {
    status: () => service.status(),
    query: async (request: MemoryProviderQuery) =>
      request.view === 'manage'
        ? service.manage(request.query)
        : service.retrieve({ ...request.query, view: request.view }),
    apply: async (mutation: MemoryProviderMutation) => {
      switch (mutation.operation) {
        case 'remember':
          return service.remember(mutation.input as MemoryInput);
        case 'correct': {
          const input = mutation.input as {
            readonly id: string;
            readonly correction: MemoryCorrection;
          };
          return service.correct(input.id, input.correction);
        }
        case 'forget': {
          const input = mutation.input as { readonly id: string; readonly permanent?: boolean };
          return service.remove(input.id, { permanent: input.permanent });
        }
        case 'rollback':
          return service.rollback((mutation.input as { readonly id: string }).id);
        case 'observe':
          return service.observe(mutation.input as MemoryObservation);
        case 'review': {
          const input = mutation.input as {
            readonly packet: MemoryReviewPacket;
            readonly actions: import('./types.js').MemoryReviewActionSet;
          };
          return service.reviewAndApply(input.packet, input.actions);
        }
      }
    },
  };
}

function reviewHasCandidate(result: MemoryReviewResult): boolean {
  if (result.observation?.candidate === true) return true;
  return result.results?.some((entry) => reviewHasCandidate(entry)) ?? false;
}

function observationFromEvent(event: PluginEvent): MemoryObservation | null {
  const payload = event.payload;
  if (typeof payload.text !== 'string' || typeof payload.category !== 'string') return null;
  const workflow =
    typeof payload.workflow === 'string' ? payload.workflow : event.source.name || 'unknown';
  const changeId =
    typeof payload.changeId === 'string'
      ? payload.changeId
      : (event.source.change ?? `${event.name}:${event.source.name}`);
  if (changeId.trim().length === 0) return null;
  return {
    scope: event.scope === 'project' ? 'project' : 'global',
    projectKey:
      event.projectId ??
      event.source.projectId ??
      (typeof payload.projectKey === 'string' ? payload.projectKey : undefined),
    category: payload.category,
    text: payload.text,
    memoryClass: isMemoryClass(payload.memoryClass) ? payload.memoryClass : undefined,
    title: typeof payload.title === 'string' ? payload.title : undefined,
    reason: typeof payload.reason === 'string' ? payload.reason : undefined,
    tags: strings(payload.tags),
    pathPatterns: strings(payload.pathPatterns),
    taskTypes: strings(payload.taskTypes),
    operations: strings(payload.operations),
    language:
      payload.language === 'en' || payload.language === 'zh-CN' ? payload.language : undefined,
    candidateKey: typeof payload.candidateKey === 'string' ? payload.candidateKey : undefined,
    workflow,
    changeId,
    success: payload.success !== false,
    userEvidence: strings(payload.userEvidence),
    explicitRequest: isRecord(payload.explicitRequest)
      ? (payload.explicitRequest as unknown as MemoryReviewRequest)
      : undefined,
    source: {
      kind: 'workflow',
      label: event.name,
      workflow,
      changeId,
      projectKey:
        event.projectId ??
        event.source.projectId ??
        (typeof payload.projectKey === 'string' ? payload.projectKey : undefined),
    },
  };
}

async function reviewPacketFromObservation(
  provider: PersonalMemoryProvider,
  observation: MemoryObservation,
  checkpoint: string,
  defaultLanguage: 'zh-CN' | 'en' | undefined,
): Promise<MemoryReviewPacket> {
  const projectIdentity = observation.projectIdentity ?? observation.projectKey ?? 'comet-project';
  const observedAt = observation.observedAt ?? new Date().toISOString();
  const candidateKey = observation.candidateKey;
  const evidenceKey = [observation.workflow, observation.changeId, candidateKey ?? 'default'].join(
    ':',
  );
  const management = (await provider.query({
    view: 'manage',
    query:
      observation.scope === 'project' && observation.projectKey !== undefined
        ? { scope: 'project', projectKey: observation.projectKey }
        : { scope: 'global' },
  })) as MemoryManagementView;
  return {
    schema: 'comet.memory.review.v1',
    language: observation.language ?? defaultLanguage ?? 'zh-CN',
    projectIdentity,
    ...(observation.scope === 'project' && observation.projectKey !== undefined
      ? { projectKey: observation.projectKey }
      : {}),
    workflow: observation.workflow,
    changeId: observation.changeId,
    createdAt: observedAt,
    checkpoint,
    category: observation.category,
    userEvidence: observation.userEvidence ?? [],
    ...(observation.explicitRequest === undefined
      ? {}
      : { explicitRequest: observation.explicitRequest }),
    evidence: [
      {
        key: evidenceKey,
        scope: observation.scope,
        projectIdentity,
        ...(observation.scope === 'project' && observation.projectKey !== undefined
          ? { projectKey: observation.projectKey }
          : {}),
        ...(candidateKey === undefined ? {} : { candidateKey }),
        changeId: observation.changeId,
        success: observation.success,
        observedAt,
        text: observation.text,
        category: observation.category,
        memoryClass: observation.memoryClass,
        tags: observation.tags,
        pathPatterns: observation.pathPatterns,
        taskTypes: observation.taskTypes,
        operations: observation.operations,
      },
    ],
    memories: management.records.slice(0, 16).map((record) => ({
      id: record.id,
      scope: record.scope,
      ...(record.projectKey === undefined ? {} : { projectKey: record.projectKey }),
      ...(record.title === undefined ? {} : { title: record.title }),
      ...(record.reason === undefined ? {} : { reason: record.reason }),
      ...(record.memoryClass === undefined ? {} : { memoryClass: record.memoryClass }),
      category: record.category,
      text: record.text,
      kind: record.kind,
      active: record.status === 'active',
    })),
    budget: { maxActions: 4, maxEvidence: 8, maxBytes: 4096 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} input must be an object`);
  return value as Record<string, unknown>;
}

function asRecord<T>(value: unknown, name: string): T {
  return asObject(value, name) as T;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string`);
  return value;
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('enabled must be a boolean');
  return value;
}
