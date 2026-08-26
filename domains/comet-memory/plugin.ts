import { randomUUID } from 'node:crypto';

import type { PluginContext, PluginDescriptor, PluginModule } from '../comet-plugin/index.js';
import type {
  AgentContextCandidate,
  AgentExperienceEvent,
  AgentExperienceEvidence,
  AgentLearningDelta,
} from '../agent-learning/index.js';
import { contextOutcomeTargetIds, reflectionEvents } from '../agent-learning/index.js';
import type {
  MemoryInput,
  MemoryCorrection,
  MemoryManagementView,
  MemoryLifecycleState,
  MemoryRecord,
  MemoryProviderMutation,
  MemoryProviderQuery,
  MemoryQuery,
  MemoryQueryView,
  MemoryObservation,
  MemoryReviewPacket,
  MemoryReviewActionSet,
  MemoryReviewResult,
  MemoryReviewRequest,
  MemoryProviderConfig,
  MemoryRetrieval,
  PersonalMemoryProvider,
  PersonalMemoryProjectPolicy,
  PersonalMemoryPluginOptions,
  PersonalMemoryServiceLike,
} from './types.js';
import { invokeMemoryReviewSkill } from './skill-runtime.js';
import { reviewMemoryPacket } from './semantic-review.js';

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

  const resolveReviewActions = async (
    packet: MemoryReviewPacket,
  ): Promise<{ readonly actions: MemoryReviewActionSet; readonly deferred: boolean }> => {
    try {
      return {
        actions: await invokeMemoryReviewSkill(packet, options.runMemoryReview),
        deferred: false,
      };
    } catch {
      if (packet.explicitRequest !== undefined) {
        return { actions: reviewMemoryPacket(packet), deferred: false };
      }
      return {
        actions: {
          schema: 'comet.memory.actions.v1',
          actions: [
            {
              action: 'skip',
              language: packet.language,
              reason:
                packet.language === 'en'
                  ? 'Memory review was unavailable and has been deferred.'
                  : '记忆评审暂不可用，已延后处理。',
            },
          ],
        },
        deferred: true,
      };
    }
  };

  const applyReview = async (packet: MemoryReviewPacket): Promise<MemoryReviewResult> => {
    const { actions } = await resolveReviewActions(packet);
    const result = (await provider.apply({
      operation: 'review',
      input: { packet, actions },
    })) as MemoryReviewResult;

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

  const retrieveWithoutNotice = async (query: MemoryQuery): Promise<MemoryRetrieval> => {
    try {
      return (await provider.query({
        view: retrievalView(query.view),
        query,
      })) as MemoryRetrieval;
    } catch {
      return { records: [], text: '', truncated: false, disabled: false };
    }
  };

  const retrieveWithNotice = async (query: MemoryQuery): Promise<MemoryRetrieval> => {
    const retrieval = await retrieveWithoutNotice(query);
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
      'user.signal',
      'episode.completed',
      'review.resolved',
      'verification.completed',
      'failure.resolved',
      'change.archived',
      'context.outcome',
    ],
    dashboard: {
      id: 'personal-memory',
      label: options.language === 'en' ? 'Personal Memory' : '个人记忆',
      route: '/plugins/personal-memory',
      load: async ({ projectId, invoke }) => {
        const [status, providerConfig, retrieval, management, applications] = await Promise.all([
          invoke('status'),
          options.getProviderConfig?.(),
          retrieveWithoutNotice({ view: 'combined', projectKey: projectId }),
          invoke('manage', { projectKey: projectId }),
          options.listContextApplications?.(),
        ]);
        const managed = management as MemoryManagementView;
        const dashboardManagement = {
          ...managed,
          records: managed.records.map((record) => ({
            ...record,
            ...contextApplicationProjection(
              record.id,
              applications ?? [],
              PERSONAL_MEMORY_PLUGIN_ID,
            ),
          })),
        };
        const currentManifest = latestApplicationBatch(
          applications ?? [],
          PERSONAL_MEMORY_PLUGIN_ID,
        );
        const recordsById = new Map(
          dashboardManagement.records
            .filter((record) => record.status === 'trial' || record.status === 'proven')
            .map((record) => [record.id, record]),
        );
        return {
          projectKey: projectId,
          policy: projectPolicy,
          status,
          providerConfig,
          retrieval,
          management: dashboardManagement,
          manifestPreview: currentManifest.flatMap((application) => {
            const record = recordsById.get(application.candidateId);
            if (record === undefined) return [];
            return [
              {
                id: record.id,
                memoryType: record.memoryType,
                state: record.status,
                title: record.title ?? record.category,
                summary: record.text,
                whyApplied: application.whyApplied,
                applicationCount: record.applicationCount,
                successCount: record.successCount,
                failureCount: record.failureCount,
                delivery: application.delivery,
                appliedAt: application.appliedAt,
                ...(application.outcome === undefined ? {} : { outcome: application.outcome }),
                lastApplication: application,
              },
            ];
          }),
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
        };
      },
    },
    reflect: async (request) => {
      if (!projectPolicy.learning) return [];
      const deltas: AgentLearningDelta[] = [];
      let deferred = false;
      for (const event of reflectionEvents(request)) {
        if (event.type === 'context.outcome' && event.outcome !== undefined) {
          for (const id of contextOutcomeTargetIds(
            event.outcome.unitIds,
            PERSONAL_MEMORY_PLUGIN_ID,
          )) {
            deltas.push({
              action: 'update',
              owner: PERSONAL_MEMORY_PLUGIN_ID,
              targetId: id,
              memoryType: 'collaboration-policy',
              kind: 'application-feedback',
              statement: event.outcome.summary ?? `Context outcome: ${event.outcome.status}`,
              applicability: experienceApplicability(event),
              evidence: event.evidence,
              ...(event.outcome.applicationId === undefined || event.outcome.revision === undefined
                ? {}
                : {
                    feedback: {
                      applicationId: event.outcome.applicationId,
                      status: event.outcome.status,
                      ...(event.outcome.previousStatus === undefined
                        ? {}
                        : { previousStatus: event.outcome.previousStatus }),
                      revision: event.outcome.revision,
                    },
                  }),
              recommendedState:
                event.outcome.status === 'corrected' ||
                event.outcome.status === 'contributed-to-failure'
                  ? 'superseded'
                  : 'proven',
            });
          }
          continue;
        }
        const observation = observationFromExperience(event, options.language);
        if (observation !== null) {
          const review = async () => {
            const packet = await reviewPacketFromObservation(
              provider,
              observation,
              event.type,
              options.language,
            );
            const reviewed = await resolveReviewActions(packet);
            deferred ||= reviewed.deferred;
            deltas.push(...memoryReviewActionDeltas(packet, reviewed.actions, event));
          };
          await review();
        }
      }
      return { deltas, deferred };
    },
    consolidate: async ({ deltas }) => {
      for (const { delta, idempotencyKey } of deltas) {
        await provider.apply({
          operation: 'experience-delta',
          input: { delta, idempotencyKey },
        });
      }
    },
    provideContext: async (request) => {
      if (!projectPolicy.retrieval) return null;
      const retrieval = await retrieveWithNotice({
        view: 'combined',
        projectKey: request.projectId ?? context.projectId,
        task: request.task,
        path: request.path,
        operation: request.operation,
        phase: request.phase,
      });
      if (retrieval.disabled || retrieval.records.length === 0) return null;
      return retrieval.records.map((record) => memoryContextCandidate(record, request));
    },
    resolveContext: async (id, request) => {
      const expanded = await provider.query({
        view: 'expand',
        query: { id, projectKey: request.projectId ?? context.projectId },
      });
      const record = 'kind' in expanded && expanded.kind === 'expand' ? expanded.record : null;
      return record === null || record.state === 'superseded'
        ? null
        : memoryContextCandidate(record, request);
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
        context.projectId ?? options.projectId,
      ),
  };
}

function contextApplicationProjection(
  candidateId: string,
  applications: readonly import('../agent-learning/index.js').AgentContextApplicationRecord[],
  owner: string,
): {
  readonly contextApplicationCount?: number;
  readonly lastApplication?: import('../agent-learning/index.js').AgentContextApplicationRecord;
  readonly applicationHistory?: readonly import('../agent-learning/index.js').AgentContextApplicationRecord[];
} {
  const matches = applications
    .filter((application) => application.owner === owner && application.candidateId === candidateId)
    .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt));
  return matches[0] === undefined
    ? {}
    : {
        contextApplicationCount: matches.length,
        lastApplication: matches[0],
        applicationHistory: matches,
      };
}

function latestApplicationBatch(
  applications: readonly import('../agent-learning/index.js').AgentContextApplicationRecord[],
  owner: string,
): readonly import('../agent-learning/index.js').AgentContextApplicationRecord[] {
  const ordered = applications
    .filter((application) => application.owner === owner)
    .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt));
  const episodeId = ordered[0]?.episodeId;
  return episodeId === undefined
    ? []
    : ordered
        .filter((application) => application.episodeId === episodeId)
        .sort((left, right) => left.applicationId.localeCompare(right.applicationId));
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
  currentProjectId?: string,
): Promise<unknown> {
  switch (capability) {
    case 'remember': {
      const memory = asRecord<MemoryInput>(input, 'remember');
      if (memory.projectKey !== undefined) {
        mutationProjectKey(memory, currentProjectId, 'remember');
      }
      const projectKey =
        memory.scope === 'project'
          ? mutationProjectKey(memory, currentProjectId, 'remember')
          : undefined;
      const normalizedMemory = normalizeCapabilityMemoryInput(memory, projectKey);
      return reviewExplicitMemoryRequest(
        service,
        {
          action: 'remember',
          input: normalizedMemory,
        },
        language,
        applyReview,
        provider,
      );
    }
    case 'correct': {
      const value = asObject(input, 'correct');
      const projectKey = mutationProjectKey(value, currentProjectId, 'correct');
      return reviewExplicitMemoryRequest(
        service,
        {
          action: 'correct',
          id: asString(value.id, 'correct.id'),
          correction: value.correction as never,
          ...(projectKey === undefined ? {} : { projectKey }),
        },
        language,
        applyReview,
        provider,
      );
    }
    case 'remove': {
      const value = asObject(input, 'remove');
      const projectKey = mutationProjectKey(value, currentProjectId, 'remove');
      return reviewExplicitMemoryRequest(
        service,
        {
          action: 'forget',
          id: asString(value.id, 'remove.id'),
          permanent: value.permanent === true,
          ...(projectKey === undefined ? {} : { projectKey }),
        },
        language,
        applyReview,
        provider,
      );
    }
    case 'rollback': {
      const value = asObject(input, 'rollback');
      const id = asString(value.id, 'rollback.id');
      const projectKey = mutationProjectKey(value, currentProjectId, 'rollback');
      assertMemoryMutationScope(await service.get(id), projectKey, id);
      return provider.apply({
        operation: 'rollback',
        input: { id },
      });
    }
    case 'observe': {
      if (!projectPolicy.learning) {
        return {
          deduplicated: false,
          ignored: true,
          candidate: false,
          promoted: false,
          record: null,
        };
      }
      const observation = scopedMemoryObservation(
        asRecord<MemoryObservation>(input, 'observe'),
        currentProjectId,
      );
      const packet = await reviewPacketFromObservation(
        provider,
        observation,
        'memory.observe',
        language,
      );
      return applyReview(packet);
    }
    case 'retrieve':
      return retrieveWithNotice(
        capabilityMemoryQuery(
          asRecord(input, 'retrieve') as MemoryQuery,
          currentProjectId,
          'retrieve',
        ),
      );
    case 'manage':
      return provider.query({
        view: 'manage',
        query: capabilityMemoryQuery(
          asRecord<MemoryQuery>(input, 'manage'),
          currentProjectId,
          'manage',
        ),
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
      {
        const value = asObject(input, 'pause-project-learning');
        const projectKey = mutationProjectKey(value, currentProjectId, 'pause-project-learning');
        if (projectKey === undefined)
          throw new Error('pause-project-learning.projectKey is required');
        return service.pauseProjectLearning(projectKey, asBoolean(value.paused));
      }
    case 'pause-project-retrieval':
      if (service.pauseProjectRetrieval === undefined)
        throw new Error('Project retrieval settings are unavailable');
      {
        const value = asObject(input, 'pause-project-retrieval');
        const projectKey = mutationProjectKey(value, currentProjectId, 'pause-project-retrieval');
        if (projectKey === undefined)
          throw new Error('pause-project-retrieval.projectKey is required');
        return service.pauseProjectRetrieval(projectKey, asBoolean(value.paused));
      }
    default:
      throw new Error(`Unknown personal memory capability: ${capability}`);
  }
}

async function reviewExplicitMemoryRequest(
  service: PersonalMemoryServiceLike,
  input:
    | { readonly action: 'remember'; readonly input: MemoryInput }
    | {
        readonly action: 'correct';
        readonly id: string;
        readonly correction: MemoryCorrection;
        readonly projectKey?: string;
      }
    | {
        readonly action: 'forget';
        readonly id: string;
        readonly permanent: boolean;
        readonly projectKey?: string;
      },
  language: 'zh-CN' | 'en' | undefined,
  applyReview: (packet: MemoryReviewPacket) => Promise<MemoryReviewResult>,
  provider: PersonalMemoryProvider,
): Promise<MemoryRecord | null | void> {
  const target = input.action === 'remember' ? null : await service.get(input.id);
  if (input.action !== 'remember') {
    assertMemoryMutationScope(target, input.projectKey, input.id);
  }
  if (input.action === 'forget' && target !== null && target.state === 'superseded') {
    await service.remove(input.id, { permanent: input.permanent });
    return;
  }
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
          ...(input.input.phases === undefined ? {} : { phases: input.input.phases }),
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
            ...(input.correction.phases === undefined ? {} : { phases: input.correction.phases }),
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
  const packet = await reviewPacketFromObservation(
    provider,
    observation,
    'memory.cli',
    language,
    target,
  );
  const result = await applyReview(packet);
  if (input.action === 'remember') return result.observation?.record ?? null;
  if (input.action === 'correct') return await service.get(input.id);
}

function mutationProjectKey(
  value: Readonly<{ projectKey?: unknown }>,
  currentProjectId: string | undefined,
  capability: string,
): string | undefined {
  const requested =
    value.projectKey === undefined
      ? undefined
      : asString(value.projectKey, `${capability}.projectKey`);
  if (currentProjectId !== undefined && requested !== undefined && requested !== currentProjectId) {
    throw new Error(`${capability}.projectKey does not match the current project`);
  }
  return currentProjectId ?? requested;
}

function capabilityMemoryQuery(
  query: MemoryQuery,
  currentProjectId: string | undefined,
  capability: string,
): MemoryQuery {
  const projectKey = mutationProjectKey(query, currentProjectId, capability);
  if (query.scope === 'global') {
    const { projectKey: ignored, ...globalQuery } = query;
    void ignored;
    return globalQuery;
  }
  return projectKey === undefined ? query : { ...query, projectKey };
}

function normalizeCapabilityMemoryInput(
  memory: MemoryInput,
  projectKey: string | undefined,
): MemoryInput {
  if (memory.scope === 'project') {
    return projectKey === undefined ? memory : { ...memory, projectKey };
  }
  const { projectKey: ignored, ...globalMemory } = memory;
  void ignored;
  return globalMemory;
}

function scopedMemoryObservation(
  observation: MemoryObservation,
  currentProjectId: string | undefined,
): MemoryObservation {
  if (observation.projectKey !== undefined) {
    mutationProjectKey(observation, currentProjectId, 'observe');
  }
  if (observation.scope === 'project') {
    const projectKey = mutationProjectKey(observation, currentProjectId, 'observe');
    return projectKey === undefined ? observation : { ...observation, projectKey };
  }
  const { projectKey, ...globalObservation } = observation;
  void projectKey;
  return globalObservation;
}

function assertMemoryMutationScope(
  target: MemoryRecord | null,
  projectKey: string | undefined,
  id: string,
): void {
  if (target?.scope !== 'project') return;
  if (projectKey === undefined || target.projectKey !== projectKey) {
    throw new Error(`Memory is not available in the current project: ${id}`);
  }
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
        case 'feedback': {
          const input = mutation.input as import('./types.js').MemoryApplicationFeedback;
          return service.recordApplicationOutcome(input.id, input.outcome, {
            ...(input.previousOutcome === undefined
              ? {}
              : { previousOutcome: input.previousOutcome }),
            ...(input.applicationId === undefined ? {} : { applicationId: input.applicationId }),
            ...(input.revision === undefined ? {} : { revision: input.revision }),
            ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
          });
        }
        case 'experience-delta':
          return service.apply?.(mutation);
      }
    },
  };
}

function reviewHasCandidate(result: MemoryReviewResult): boolean {
  if (result.observation?.candidate === true) return true;
  return result.results?.some((entry) => reviewHasCandidate(entry)) ?? false;
}

function experienceApplicability(event: AgentExperienceEvent) {
  return {
    ...(event.projectId === undefined ? {} : { projectId: event.projectId }),
    ...(event.context.paths === undefined ? {} : { paths: event.context.paths }),
    ...(event.context.operation === undefined ? {} : { operations: [event.context.operation] }),
    ...(event.context.phase === undefined ? {} : { phases: [event.context.phase] }),
    ...(event.context.task === undefined ? {} : { tasks: [event.context.task] }),
  };
}

function memoryReviewActionDeltas(
  packet: MemoryReviewPacket,
  actionSet: MemoryReviewActionSet,
  event: AgentExperienceEvent,
): AgentLearningDelta[] {
  return actionSet.actions.map((entry) => {
    const request = packet.explicitRequest;
    const memoryClass =
      ('memoryClass' in entry ? entry.memoryClass : undefined) ??
      request?.memoryClass ??
      packet.evidence[0]?.memoryClass;
    const inferred = request === undefined;
    const memoryType =
      !inferred && (memoryClass === 'user-fact' || memoryClass === 'user-preference')
        ? ('core-profile' as const)
        : memoryClass === 'collaboration-habit' || memoryClass === 'project-convention'
          ? ('collaboration-policy' as const)
          : ('personal-episode' as const);
    const action =
      entry.action === 'skip'
        ? ('noop' as const)
        : entry.action === 'forget'
          ? ('forget' as const)
          : entry.action;
    const statement =
      ('text' in entry ? entry.text : undefined) ??
      request?.text ??
      event.signal?.text ??
      packet.evidence.find((item) => item.text)?.text ??
      entry.reason ??
      packet.category ??
      'No reusable personal learning unit.';
    const episode =
      memoryType === 'personal-episode'
        ? {
            situation:
              event.context.task ??
              entry.title ??
              request?.title ??
              packet.category ??
              (packet.language === 'en' ? 'Reusable experience' : '可复用经验'),
            actionSummary:
              event.evidence
                .map((item) => item.summary)
                .filter(Boolean)
                .join('; ') || statement,
            outcome:
              event.outcome?.status === 'used-successfully'
                ? packet.language === 'en'
                  ? 'Successful'
                  : '成功'
                : (event.outcome?.summary ??
                  entry.reason ??
                  (packet.language === 'en' ? 'Observed' : '已记录')),
            lesson: event.signal?.text ?? statement,
          }
        : undefined;
    return {
      action,
      owner: PERSONAL_MEMORY_PLUGIN_ID,
      ...(!('targetId' in entry) || entry.targetId === undefined
        ? request?.targetId === undefined
          ? {}
          : { targetId: request.targetId }
        : { targetId: entry.targetId }),
      memoryType,
      kind: memoryClass ?? request?.category ?? packet.category ?? 'personal-learning',
      ...((entry.title ?? request?.title) === undefined
        ? {}
        : { title: entry.title ?? request?.title }),
      statement,
      applicability: {
        ...experienceApplicability(event),
        ...(entry.projectKey === undefined ? {} : { projectId: entry.projectKey }),
        ...(!('pathPatterns' in entry) || entry.pathPatterns === undefined
          ? request?.pathPatterns === undefined
            ? {}
            : { paths: request.pathPatterns }
          : { paths: entry.pathPatterns }),
        ...(!('operations' in entry) || entry.operations === undefined
          ? request?.operations === undefined
            ? {}
            : { operations: request.operations }
          : { operations: entry.operations }),
        ...(!('phases' in entry) || entry.phases === undefined
          ? request?.phases === undefined
            ? {}
            : { phases: request.phases }
          : { phases: entry.phases }),
        ...(!('taskTypes' in entry) || entry.taskTypes === undefined
          ? request?.taskTypes === undefined
            ? {}
            : { tasks: request.taskTypes }
          : { tasks: entry.taskTypes }),
      },
      evidence: event.evidence,
      authority: request === undefined ? ('inferred' as const) : ('explicit' as const),
      payload: {
        kind: 'memory-action',
        ...(entry.candidateKey === undefined ? {} : { candidateKey: entry.candidateKey }),
        language: entry.language,
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
        ...(memoryClass === undefined ? {} : { memoryClass }),
        ...(episode === undefined ? {} : { episode }),
      },
      recommendedState:
        action === 'forget'
          ? ('superseded' as const)
          : request === undefined
            ? ('trial' as const)
            : ('proven' as const),
    };
  });
}

function observationFromExperience(
  event: AgentExperienceEvent,
  language: 'zh-CN' | 'en' | undefined,
): MemoryObservation | null {
  const signal = event.signal;
  if (event.type === 'user.signal' && signal?.longTerm !== true) return null;
  const userEvidence = event.evidence
    .filter((entry) => entry.kind === 'user')
    .map((entry) => entry.summary);
  if (
    signal?.explicit !== true &&
    signal?.longTerm !== true &&
    event.actor !== 'user' &&
    userEvidence.length === 0
  )
    return null;
  const evidence = usefulEvidence(event.evidence);
  const text = signal?.text ?? evidence?.summary;
  if (text === undefined) return null;
  const projectKey = event.scope === 'project' ? event.projectId : undefined;
  const workflow = event.context.workflow ?? event.source.workflow ?? event.source.name;
  const changeId = event.context.changeId ?? event.source.changeId ?? event.episodeId;
  const explicitRequest = signal?.explicit
    ? signal.kind === 'forget'
      ? signal.targetId
        ? ({ action: 'forget', targetId: signal.targetId } as MemoryReviewRequest)
        : undefined
      : signal.kind === 'correction'
        ? signal.targetId
          ? ({
              action: 'correct',
              targetId: signal.targetId,
              text: signal.text,
            } as MemoryReviewRequest)
          : undefined
        : ({
            action: 'remember',
            scope: event.scope === 'project' ? 'project' : 'global',
            ...(projectKey === undefined ? {} : { projectKey }),
            category: signal.category ?? (language === 'en' ? 'Reusable preference' : '可复用偏好'),
            text: signal.text,
            pathPatterns: signal.selectors?.paths,
            taskTypes: signal.selectors?.tasks,
            operations: signal.selectors?.operations,
            phases: signal.selectors?.phases,
          } as MemoryReviewRequest)
    : undefined;
  return {
    scope: event.scope === 'project' ? 'project' : 'global',
    ...(projectKey === undefined ? {} : { projectKey }),
    projectIdentity: event.projectId,
    category: signal?.category ?? (language === 'en' ? 'Reusable experience' : '可复用经验'),
    text,
    title: signal?.category,
    reason: event.type,
    pathPatterns: signal?.selectors?.paths ?? event.context.paths,
    taskTypes: signal?.selectors?.tasks,
    operations:
      signal?.selectors?.operations ??
      (event.context.operation === undefined ? undefined : [event.context.operation]),
    phases:
      signal?.selectors?.phases ??
      (event.context.phase === undefined ? undefined : [event.context.phase]),
    evidence: event.evidence,
    language,
    candidateKey: signal?.targetId ?? `${event.type}:${event.source.name}`,
    workflow,
    changeId,
    success: event.outcome?.status !== 'contributed-to-failure' && evidence?.success !== false,
    userEvidence: [
      ...userEvidence,
      ...(event.actor === 'user' || signal?.explicit ? [text] : []),
    ].filter((entry, index, all) => all.indexOf(entry) === index),
    ...(explicitRequest === undefined ? {} : { explicitRequest }),
    source: {
      kind:
        event.actor === 'user' ? 'user' : event.type === 'review.resolved' ? 'review' : 'workflow',
      label: event.type,
      workflow,
      changeId,
      ...(projectKey === undefined ? {} : { projectKey }),
    },
  };
}

function usefulEvidence(
  evidence: readonly AgentExperienceEvidence[],
): AgentExperienceEvidence | undefined {
  return evidence.find((entry) => entry.kind === 'user') ?? evidence.find((entry) => entry.summary);
}

function memoryContextCandidate(
  record: MemoryRecord,
  request: { readonly projectId?: string },
): AgentContextCandidate {
  return {
    id: record.id,
    owner: PERSONAL_MEMORY_PLUGIN_ID,
    scope: record.scope === 'project' ? 'project' : 'user',
    memoryType: record.memoryType,
    kind: record.memoryClass ?? 'personal-episode',
    state: record.state,
    authority: record.authority,
    title: record.title ?? record.category,
    summary: record.text,
    content: record.text,
    selectors: {
      ...(record.scope === 'project' ? { projectId: record.projectKey ?? request.projectId } : {}),
      paths: record.pathPatterns,
      operations: record.operations,
      phases: record.phases,
      tasks: record.taskTypes,
    },
    sources: record.sources.map((source) => ({
      type:
        source.kind === 'user'
          ? 'user'
          : source.kind === 'repository'
            ? 'repository'
            : source.kind === 'review'
              ? 'review'
              : 'workflow',
    })),
    verification: [],
    matchReasons: record.reason ? [record.reason] : undefined,
  };
}

async function reviewPacketFromObservation(
  provider: PersonalMemoryProvider,
  observation: MemoryObservation,
  checkpoint: string,
  defaultLanguage: 'zh-CN' | 'en' | undefined,
  targetRecord?: MemoryRecord | null,
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
    memories: (observation.explicitRequest === undefined
      ? management.records
      : targetRecord === undefined || targetRecord === null
        ? []
        : [targetRecord]
    ).map((record) => ({
      id: record.id,
      scope: record.scope,
      ...(record.scope === 'project' && record.projectKey !== undefined
        ? { projectKey: record.projectKey }
        : {}),
      ...(record.title === undefined ? {} : { title: record.title }),
      ...(record.reason === undefined ? {} : { reason: record.reason }),
      ...(record.memoryClass === undefined ? {} : { memoryClass: record.memoryClass }),
      category: record.category,
      text: record.text,
      kind: record.kind,
      memoryType: record.memoryType,
      state: 'status' in record ? reviewMemoryState(record.status) : record.state,
    })),
    budget: { maxActions: 4, maxEvidence: 8, maxBytes: 4096 },
  };
}

function reviewMemoryState(
  status: MemoryManagementView['records'][number]['status'],
): MemoryLifecycleState {
  return status === 'conflict' || status === 'tombstoned' ? 'superseded' : status;
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
