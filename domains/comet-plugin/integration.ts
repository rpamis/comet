import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  createPersonalMemoryPluginDescriptor,
  FileMemoryRepository,
  GitMemorySync,
  PersonalMemoryService,
  RemotePersonalMemoryService,
  type MemoryInput,
  type MemoryCorrection,
  type MemoryLanguage,
  type MemoryManagementView,
  type MemoryQuery,
  type MemoryRecord,
  type MemoryRetrieval,
  type MemoryReviewSkillRunner,
  type MemoryProviderConfig,
  readPersonalMemoryConfig,
  writePersonalMemoryConfig,
} from '../comet-memory/index.js';
import { getCurrentVersion } from '../../platform/version/version.js';
import { resolveProjectName } from '../../platform/paths/project-identity.js';
import { defaultProjectKnowledgeStorageRoot } from '../../platform/paths/project-knowledge-storage.js';
import { JsonFilePluginStorageStore, JsonFileTextStore } from '../../platform/fs/plugin-store.js';
import { JsonPluginStateStore, PluginRuntime } from './plugin-runtime.js';
import type { PluginScopeContext } from './types.js';
import {
  AGENT_EXPERIENCE_SCHEMA,
  AgentExperienceJournal,
  ContextDirector,
  contextExpansionId,
  parseContextExpansionId,
  StorageAgentContextApplicationStore,
  StorageAgentExperienceJournalStore,
  type AgentContextApplicationStore,
  type AgentContextApplicationRecord,
  type AgentContextCandidate,
  type AgentContextExpansion,
  type AgentContextManifestItem,
  type AgentContextOutcomeStatus,
  type AgentExperienceEvent,
} from '../agent-learning/index.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import { writeWorkflowProjectConfig } from '../workflow-contract/project-config-writer.js';
import { DEFAULT_WORKFLOW_MEMORY_PROJECT_CONFIG } from '../workflow-contract/project-config.js';
import type { WorkflowMemoryProjectConfig } from '../workflow-contract/types.js';
import { createProjectKnowledgePluginDescriptor } from '../project-knowledge/index.js';
import type { WorkflowKnowledgeProjectConfig } from '../workflow-contract/types.js';
import { DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG } from '../workflow-contract/project-config.js';
import type { ProjectKnowledgeSemanticReviewer } from '../project-knowledge/learning.js';

export interface CometPluginBridgeOptions {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly language?: MemoryLanguage;
  /** Optional isolated user home, primarily for hosts and tests. */
  readonly homeDirectory?: string;
  readonly memoryRoot?: string;
  /** Optional user-level Provider selection, primarily for hosts and tests. */
  readonly memoryProviderConfig?: MemoryProviderConfig;
  readonly stateRoot?: string;
  readonly knowledgeCacheRoot?: string;
  readonly cometVersion?: string;
  /** Host-owned scheduler for the durable Reflection queue. */
  readonly scheduleLearning?: (task: () => Promise<void>) => void | Promise<void>;
  /** Optional host adapter that invokes the installed comet-memory Skill. */
  readonly runMemoryReview?: MemoryReviewSkillRunner;
  /** Optional host callback for the small number of user-visible memory notices. */
  readonly onMemoryReviewNotice?: (notice: string) => void | Promise<void>;
  /** Optional host-owned adapter for nonblocking project knowledge review. */
  readonly runProjectKnowledgeReview?: ProjectKnowledgeSemanticReviewer;
}

export interface CometPluginContextRequest {
  readonly task: string;
  readonly path?: string;
  readonly phase?: string;
  readonly operation?: string;
  readonly sessionId?: string;
  readonly charBudget?: number;
}

export interface CometPluginContextContribution {
  readonly pluginId: 'comet.context-director';
  readonly text: string;
  readonly episodeId: string;
  readonly manifest: readonly AgentContextManifestItem[];
  readonly applications: readonly AgentContextApplicationRecord[];
}

export class CometPluginBridge {
  public constructor(
    private readonly runtime: PluginRuntime,
    private readonly projectId: string,
    private readonly language: MemoryLanguage = 'zh-CN',
    private readonly contextDirector: ContextDirector = new ContextDirector(),
    private readonly applicationStore?: AgentContextApplicationStore,
  ) {}

  public get pluginRuntime(): PluginRuntime {
    return this.runtime;
  }

  public get currentProjectId(): string {
    return this.projectId;
  }

  public get currentLanguage(): MemoryLanguage {
    return this.language;
  }

  public async collectContext(
    request: CometPluginContextRequest,
  ): Promise<CometPluginContextContribution[]> {
    const candidates = await this.collectCandidates(request);
    const selection = await this.contextDirector.select(candidates, {
      ...request,
      projectId: this.projectId,
      language: this.language,
    });
    if (!selection.text) return [];
    await this.recordContextApplications(selection.applications);
    return [
      {
        pluginId: 'comet.context-director',
        text: selection.text,
        episodeId: selection.episodeId,
        manifest: selection.manifest,
        applications: selection.applications,
      },
    ];
  }

  public async expandContext(
    id: string,
    request: CometPluginContextRequest,
  ): Promise<AgentContextExpansion | null> {
    const target: PluginScopeContext = { scope: 'project', projectId: this.projectId };
    const selector = parseContextExpansionId(id);
    const candidateId = selector?.candidateId ?? id;
    const [global, project] = await Promise.all([
      this.runtime.resolveContext(
        candidateId,
        { ...request, projectId: this.projectId },
        'user',
        selector?.owner,
      ),
      this.runtime.resolveContext(
        candidateId,
        { ...request, projectId: this.projectId },
        target,
        selector?.owner,
      ),
    ]);
    const candidates = [
      ...new Map(
        [...global, ...project].map((candidate) => [
          `${candidate.owner}:${candidate.id}`,
          candidate,
        ]),
      ).values(),
    ];
    return this.contextDirector.expand(candidates, id, {
      ...request,
      projectId: this.projectId,
      language: this.language,
    });
  }

  public async recordContextOutcome(
    applicationId: string,
    outcome: AgentContextOutcomeStatus,
  ): Promise<void> {
    const update = await this.contextDirector.recordOutcome(applicationId, outcome, this.projectId);
    if (update === null) throw new Error(`Unknown context application: ${applicationId}`);
    await this.flushContextApplicationOutbox();
  }

  private async collectCandidates(
    request: CometPluginContextRequest,
  ): Promise<AgentContextCandidate[]> {
    const target: PluginScopeContext = { scope: 'project', projectId: this.projectId };
    const [global, project] = await Promise.all([
      this.runtime.collectContext({ ...request, projectId: this.projectId }, 'user'),
      this.runtime.collectContext({ ...request, projectId: this.projectId }, target),
    ]);
    const merged = new Map<string, AgentContextCandidate>();
    for (const candidate of [...global, ...project]) {
      const key = `${candidate.owner}:${candidate.id}`;
      if (!merged.has(key)) merged.set(key, candidate);
    }
    return [...merged.values()];
  }

  private async recordContextApplications(
    _applications: readonly AgentContextApplicationRecord[],
  ): Promise<void> {
    await this.flushContextApplicationOutbox();
  }

  /** Replay persisted Context application/outcome events into the idempotent Journal. */
  public async flushContextApplicationOutbox(): Promise<void> {
    if (this.applicationStore === undefined) return;
    const applications = (await this.applicationStore.list()).filter(
      (application) => application.scope === 'user' || application.projectId === this.projectId,
    );
    for (const application of applications) {
      let applicationEventReady = application.appliedEventDispatchedAt !== undefined;
      if (application.appliedEventDispatchedAt === undefined) {
        try {
          await this.runtime.dispatch(contextAppliedEvent(application, this.projectId));
          await this.applicationStore.markAppliedEventDispatched(application.applicationId);
          applicationEventReady = true;
        } catch {
          // The durable outbox entry remains pending and will be retried on the next bridge use.
        }
      }
      if (!applicationEventReady) continue;
      for (const outcomeEvent of application.outcomeEvents ?? []) {
        if (outcomeEvent.dispatchedAt !== undefined) continue;
        try {
          await this.runtime.dispatch(
            contextOutcomeEvent(application, outcomeEvent, this.projectId),
          );
          await this.applicationStore.markOutcomeEventDispatched(
            application.applicationId,
            outcomeEvent.revision,
          );
        } catch {
          // Later revisions stay queued until the missing earlier revision is captured.
          break;
        }
      }
    }
  }

  public async dispatchExperience(event: AgentExperienceEvent): Promise<void> {
    await this.runtime.dispatch(event);
    try {
      await this.syncMemory();
    } catch {
      // A remote or Git installation failure is a diagnostic, not a workflow failure.
    }
  }

  public async remember(input: MemoryInput): Promise<MemoryRecord | null> {
    const normalized = scopedMemoryInput(input, this.projectId);
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'remember',
      { ...normalized, language: normalized.language ?? this.language },
      'user',
      { throwOnError: true },
    )) as MemoryRecord | null;
  }

  public async observe(input: AgentExperienceEvent): Promise<unknown> {
    await this.dispatchExperience(input);
    return this.runtime.invoke('comet.personal-memory', 'status', {}, 'user');
  }

  public async status(): Promise<unknown> {
    return this.runtime.invoke('comet.personal-memory', 'status', {}, 'user');
  }

  public async retrieve(query: MemoryQuery): Promise<MemoryRetrieval> {
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'retrieve',
      scopedMemoryQuery(query, this.projectId),
      'user',
    )) as MemoryRetrieval;
  }

  public async manage(query: MemoryQuery = {}): Promise<MemoryManagementView> {
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'manage',
      scopedMemoryQuery(query, this.projectId),
      'user',
    )) as MemoryManagementView;
  }

  public async correct(id: string, correction: MemoryCorrection): Promise<MemoryRecord> {
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'correct',
      { id, correction, projectKey: this.projectId },
      'user',
      { throwOnError: true },
    )) as MemoryRecord;
  }

  public async forget(id: string, permanent = false): Promise<void> {
    await this.runtime.invoke(
      'comet.personal-memory',
      'remove',
      { id, permanent, projectKey: this.projectId },
      'user',
      { throwOnError: true },
    );
  }

  public async rollback(id: string): Promise<MemoryRecord> {
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'rollback',
      { id, projectKey: this.projectId },
      'user',
      { throwOnError: true },
    )) as MemoryRecord;
  }

  public async syncMemory(): Promise<unknown> {
    return this.runtime.invoke('comet.personal-memory', 'sync', {}, 'user');
  }

  public async memoryRemote(): Promise<unknown> {
    return this.runtime.invoke('comet.personal-memory', 'remote', {}, 'user');
  }

  public async configureMemoryRemote(url: string): Promise<unknown> {
    return this.runtime.invoke('comet.personal-memory', 'configure-remote', { url }, 'user');
  }

  public async pauseProjectLearning(
    paused: boolean,
    projectKey = this.projectId,
  ): Promise<unknown> {
    assertCurrentProjectKey(projectKey, this.projectId, 'pause-project-learning');
    return this.runtime.invoke(
      'comet.personal-memory',
      'pause-project-learning',
      { projectKey, paused },
      'user',
    );
  }

  public async pauseProjectRetrieval(
    paused: boolean,
    projectKey = this.projectId,
  ): Promise<unknown> {
    assertCurrentProjectKey(projectKey, this.projectId, 'pause-project-retrieval');
    return this.runtime.invoke(
      'comet.personal-memory',
      'pause-project-retrieval',
      { projectKey, paused },
      'user',
    );
  }

  public async diagnostics(): Promise<ReturnType<PluginRuntime['diagnostics']>> {
    return this.runtime.diagnostics();
  }
}

export async function createDefaultCometPluginBridge(
  options: CometPluginBridgeOptions,
): Promise<CometPluginBridge> {
  const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
  const memoryRoot = path.resolve(
    options.memoryRoot ?? path.join(homeDirectory, '.comet', 'memory'),
  );
  const stateRoot = path.resolve(
    options.stateRoot ?? path.join(homeDirectory, '.comet', 'plugins'),
  );
  const projectRoot = path.resolve(options.projectRoot);
  const projectName = resolveProjectName(projectRoot);
  const language = options.language ?? (await resolveProjectMemoryLanguage(projectRoot));
  const projectPolicy = await resolveProjectMemoryPolicy(projectRoot);
  const memoryProviderConfig =
    options.memoryProviderConfig ?? (await readPersonalMemoryConfig(homeDirectory));
  const storage = new JsonFilePluginStorageStore(path.join(stateRoot, 'storage'));
  const userJournal = new AgentExperienceJournal(
    new StorageAgentExperienceJournalStore(await storage.open('comet.agent-learning', 'user')),
  );
  const projectJournal = new AgentExperienceJournal(
    new StorageAgentExperienceJournalStore(
      await storage.open('comet.agent-learning', 'project', options.projectId),
    ),
  );
  const applicationStore = new StorageAgentContextApplicationStore(
    await storage.open('comet.agent-context', 'user'),
  );
  const contextDirector = new ContextDirector({
    applications: applicationStore,
    defaultCharBudget: memoryProviderConfig.taskContextCharLimit,
  });
  const runtime = new PluginRuntime({
    cometVersion: options.cometVersion ?? getCurrentVersion(),
    store: new JsonPluginStateStore(new JsonFileTextStore(path.join(stateRoot, 'state.json'))),
    storage,
    journals: { user: userJournal, project: projectJournal },
    ...(options.scheduleLearning === undefined
      ? {}
      : { scheduleLearning: options.scheduleLearning }),
    descriptors: [
      createPersonalMemoryPluginDescriptor({
        projectId: options.projectId,
        language,
        projectPolicy,
        ...(options.runMemoryReview === undefined
          ? {}
          : { runMemoryReview: options.runMemoryReview }),
        ...(options.onMemoryReviewNotice === undefined
          ? {}
          : { onReviewNotice: options.onMemoryReviewNotice }),
        getProviderConfig: () => readPersonalMemoryConfig(homeDirectory),
        configureProvider: (config) => writePersonalMemoryConfig(homeDirectory, config),
        listContextApplications: async (candidateId) =>
          (await applicationStore.list(candidateId)).filter(
            (application) =>
              application.owner === 'comet.personal-memory' &&
              (application.scope === 'user' || application.projectId === options.projectId),
          ),
        createService: () => {
          if (memoryProviderConfig.provider === 'remote') {
            if (memoryProviderConfig.remote === undefined) {
              throw new Error('Remote Provider endpoint is not configured');
            }
            return new RemotePersonalMemoryService({
              ...memoryProviderConfig.remote,
              profileCharLimit: memoryProviderConfig.profileCharLimit,
              taskContextCharLimit: memoryProviderConfig.taskContextCharLimit,
              projectKey: options.projectId,
            });
          }
          return new PersonalMemoryService({
            language,
            profileMaxChars: memoryProviderConfig.profileCharLimit,
            taskMaxChars: memoryProviderConfig.taskContextCharLimit,
            repository: new FileMemoryRepository(memoryRoot, {
              git: new GitMemorySync(memoryRoot),
              projectKey: options.projectId,
              projectName,
            }),
          });
        },
      }),
      createProjectKnowledgePluginDescriptor({
        projectRoot,
        knowledgeConfig: await resolveProjectKnowledgeConfig(projectRoot),
        updateKnowledgeConfig: async (knowledge) => {
          const current = await readWorkflowProjectConfig(projectRoot);
          if (current === null) throw new Error('Project config is not available');
          await writeWorkflowProjectConfig(projectRoot, { ...current, knowledge });
        },
        language,
        listContextApplications: async (candidateId) =>
          (await applicationStore.list(candidateId)).filter(
            (application) =>
              application.owner === 'comet.project-knowledge' &&
              application.scope === 'project' &&
              application.projectId === options.projectId,
          ),
        ...(options.knowledgeCacheRoot
          ? { cacheRoot: path.resolve(options.knowledgeCacheRoot) }
          : options.stateRoot
            ? { cacheRoot: path.join(stateRoot, 'knowledge-cache') }
            : options.homeDirectory
              ? { cacheRoot: defaultProjectKnowledgeStorageRoot(homeDirectory) }
              : {}),
        ...(options.runProjectKnowledgeReview
          ? { semanticReviewer: options.runProjectKnowledgeReview }
          : {}),
      }),
    ],
  });
  await runtime.reconcileFirstParty();
  const bridge = new CometPluginBridge(
    runtime,
    options.projectId,
    language,
    contextDirector,
    applicationStore,
  );
  await bridge.flushContextApplicationOutbox();
  return bridge;
}

function contextAppliedEvent(
  application: AgentContextApplicationRecord,
  fallbackProjectId: string,
): AgentExperienceEvent {
  return {
    schema: AGENT_EXPERIENCE_SCHEMA,
    eventId: `context-applied:${application.applicationId}`,
    episodeId: application.episodeId,
    occurredAt: application.appliedAt,
    type: 'context.applied',
    actor: 'agent',
    scope: application.scope,
    ...(application.scope === 'project'
      ? { projectId: application.projectId ?? fallbackProjectId }
      : {}),
    source: { kind: 'system', name: 'context-director' },
    context: {
      task: application.task,
      ...(application.path === undefined ? {} : { paths: [application.path] }),
      ...(application.operation === undefined ? {} : { operation: application.operation }),
      ...(application.phase === undefined ? {} : { phase: application.phase }),
    },
    evidence: [
      {
        id: application.candidateId,
        kind: 'outcome',
        summary: application.whyApplied,
        digest: application.candidateDigest,
      },
    ],
  };
}

function contextOutcomeEvent(
  application: AgentContextApplicationRecord,
  outcomeEvent: NonNullable<AgentContextApplicationRecord['outcomeEvents']>[number],
  fallbackProjectId: string,
): AgentExperienceEvent {
  const outcomeId = createHash('sha256')
    .update(`${application.applicationId}:${outcomeEvent.revision}:${outcomeEvent.status}`)
    .digest('hex');
  return {
    schema: AGENT_EXPERIENCE_SCHEMA,
    eventId: `context-outcome:${outcomeId}`,
    episodeId: application.episodeId,
    occurredAt: outcomeEvent.occurredAt,
    type: 'context.outcome',
    actor: 'agent',
    scope: application.scope,
    ...(application.scope === 'project'
      ? { projectId: application.projectId ?? fallbackProjectId }
      : {}),
    source: { kind: 'system', name: 'context-director' },
    context: {},
    evidence: [],
    outcome: {
      status: outcomeEvent.status,
      ...(outcomeEvent.previousStatus === undefined
        ? {}
        : { previousStatus: outcomeEvent.previousStatus }),
      revision: outcomeEvent.revision,
      applicationId: application.applicationId,
      unitIds: [contextExpansionId(application.owner, application.candidateId)],
    },
  };
}

function scopedMemoryQuery(query: MemoryQuery, projectId: string): MemoryQuery {
  if (query.projectKey !== undefined) {
    assertCurrentProjectKey(query.projectKey, projectId, 'memory-query');
  }
  if (query.scope === 'global') {
    const { projectKey, ...globalQuery } = query;
    void projectKey;
    return globalQuery;
  }
  return { ...query, projectKey: query.projectKey ?? projectId };
}

function scopedMemoryInput(input: MemoryInput, projectId: string): MemoryInput {
  if (input.projectKey !== undefined) {
    assertCurrentProjectKey(input.projectKey, projectId, 'remember');
  }
  if (input.scope === 'project') return { ...input, projectKey: projectId };
  const { projectKey, ...globalInput } = input;
  void projectKey;
  return globalInput;
}

function assertCurrentProjectKey(requested: string, current: string, capability: string): void {
  if (requested !== current) {
    throw new Error(`${capability}.projectKey does not match the current project`);
  }
}

async function resolveProjectMemoryLanguage(projectRoot: string): Promise<MemoryLanguage> {
  try {
    const config = await readWorkflowProjectConfig(projectRoot);
    if (config?.default_workflow === 'classic') {
      return config?.classic?.language ?? config?.native?.language ?? 'zh-CN';
    }
    return config?.native?.language ?? config?.classic?.language ?? 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

async function resolveProjectMemoryPolicy(
  projectRoot: string,
): Promise<WorkflowMemoryProjectConfig> {
  const config = await readWorkflowProjectConfig(projectRoot);
  return config?.memory ?? { ...DEFAULT_WORKFLOW_MEMORY_PROJECT_CONFIG };
}

async function resolveProjectKnowledgeConfig(
  projectRoot: string,
): Promise<WorkflowKnowledgeProjectConfig> {
  const config = await readWorkflowProjectConfig(projectRoot);
  return config?.knowledge ?? { ...DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG };
}
