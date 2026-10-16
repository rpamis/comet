import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  withOperationBudget,
  operationSignal,
  withoutOperationBudget,
} from '../../platform/process/operation-budget.js';

import {
  createPersonalMemoryPluginDescriptor,
  FileMemoryRepository,
  GitMemorySync,
  PersonalMemoryService,
  RemotePersonalMemoryService,
  type MemoryInput,
  type MemoryCorrection,
  type MemoryLanguage,
  type MemoryObservation,
  type MemoryLearningCheckKind,
  type MemoryLearningCheckContext,
  type MemoryLearningStatus,
  type MemoryReviewResult,
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
import { resolveProjectWorktreeRoot } from '../../platform/paths/project-worktree-root.js';
import { defaultProjectKnowledgeStorageRoot } from '../../platform/paths/project-knowledge-storage.js';
import {
  JsonFilePluginStorageStore,
  JsonFileTextStore,
  type RecoverableFileLockOptions,
} from '../../platform/fs/plugin-store.js';
import { JsonPluginStateStore, PluginRuntime } from './plugin-runtime.js';
import type { PluginDescriptor, PluginScopeContext } from './types.js';
import {
  AGENT_EXPERIENCE_SCHEMA,
  AgentExperienceJournal,
  ContextDirector,
  ContextUsageTracker,
  candidateCanBeConsidered,
  type ContextQuerySample,
  contextExpansionId,
  parseContextExpansionId,
  SqliteAgentContextApplicationStore,
  MemoryAgentContextApplicationStore,
  StorageAgentExperienceJournalStore,
  type AgentContextApplicationStore,
  type AgentContextApplicationRecord,
  type AgentContextCandidate,
  type AgentContextExpansion,
  type AgentContextManifestItem,
  type AgentContextOutcomeStatus,
  type AgentContextOutcomeEvidence,
  type AgentExperienceEvent,
} from '../agent-learning/index.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import { writeWorkflowProjectConfig } from '../workflow-contract/project-config-writer.js';
import { DEFAULT_WORKFLOW_MEMORY_PROJECT_CONFIG } from '../workflow-contract/project-config.js';
import type { WorkflowMemoryProjectConfig } from '../workflow-contract/types.js';
import {
  createProjectKnowledgePluginDescriptor,
  ProjectKnowledgeHostReview,
} from '../project-knowledge/index.js';
import type { WorkflowKnowledgeProjectConfig } from '../workflow-contract/types.js';
import { DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG } from '../workflow-contract/project-config.js';
import type { ProjectKnowledgeSemanticReviewer } from '../project-knowledge/learning.js';

export interface CometPluginBridgeOptions {
  readonly projectRoot: string;
  readonly projectId: string;
  /** Additional host-provided plugins; built-in IDs cannot be replaced. */
  readonly descriptors?: readonly PluginDescriptor[];
  /** Runtime configuration keyed by plugin ID; not persisted as provider settings. */
  readonly config?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
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
  /** Optional shorter lock budget for best-effort context injection. */
  readonly lockTimeoutMs?: number;
  /** Hook context is optional; avoid durable writes and reflection replay on this path. */
  readonly bestEffortContext?: boolean;
}

export interface CometPluginContextRequest {
  readonly task: string;
  readonly path?: string;
  readonly phase?: string;
  readonly operation?: string;
  readonly sessionId?: string;
  readonly contextMode?: 'incremental' | 'snapshot';
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
    private readonly persistContextApplications = true,
    private readonly usageTracker?: ContextUsageTracker,
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
    const samples: ContextQuerySample[] = [];
    const candidates = await this.collectCandidates(request, (sample) => samples.push(sample));
    const selection = await this.contextDirector.select(candidates, {
      ...request,
      projectId: this.projectId,
      language: this.language,
    });
    if (this.usageTracker) {
      try {
        await this.usageTracker.record({
          request: { ...request, projectId: this.projectId },
          episodeId: selection.episodeId,
          samples: samples.filter((sample) =>
            ['comet.personal-memory', 'comet.project-knowledge'].includes(sample.owner),
          ),
          candidates: candidates.filter(
            (candidate) =>
              candidate.id !== 'project-memory-index' &&
              candidate.state !== 'superseded' &&
              candidateCanBeConsidered(candidate, { ...request, projectId: this.projectId }),
          ),
          applications: selection.applications.filter(
            (application) => application.candidateId !== 'project-memory-index',
          ),
        });
      } catch {
        /* Optional usage statistics must not prevent context delivery. */
      }
    }
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
    const expansion = this.contextDirector.expand(candidates, id, {
      ...request,
      projectId: this.projectId,
      language: this.language,
    });
    const candidate = candidates.find(
      (entry) => contextExpansionId(entry.owner, entry.id) === expansion?.id,
    );
    if (expansion && candidate && candidate.id !== 'project-memory-index' && this.usageTracker) {
      try {
        await this.usageTracker.recordExpansion(
          { ...request, projectId: this.projectId },
          candidate.owner,
          candidate.id,
          expansion.title,
        );
      } catch {
        /* Expansion still succeeds if optional telemetry is unavailable. */
      }
    }
    return expansion;
  }

  public async recordContextOutcome(
    applicationId: string,
    outcome: AgentContextOutcomeStatus,
    evidence?: AgentContextOutcomeEvidence,
  ): Promise<void> {
    const update = await this.contextDirector.recordOutcome(
      applicationId,
      outcome,
      this.projectId,
      evidence,
    );
    if (update === null) throw new Error(`Unknown context application: ${applicationId}`);
    if (await this.transferContextApplicationOutbox([applicationId])) {
      const latest = update.record.outcomeEvents?.at(-1);
      if (latest) {
        try {
          // An explicit feedback write processes its own episode, never the historical queue.
          await this.runtime.dispatch(contextOutcomeEvent(update.record, latest, this.projectId));
        } catch {
          // The captured event remains available to explicit maintenance after a Provider failure.
        }
      }
    }
  }

  private async collectCandidates(
    request: CometPluginContextRequest,
    onQuery?: (sample: ContextQuerySample) => void,
  ): Promise<AgentContextCandidate[]> {
    const target: PluginScopeContext = { scope: 'project', projectId: this.projectId };
    const [global, project] = await Promise.all([
      this.runtime.collectContext({ ...request, projectId: this.projectId }, 'user', onQuery),
      this.runtime.collectContext({ ...request, projectId: this.projectId }, target, onQuery),
    ]);
    const merged = new Map<string, AgentContextCandidate>();
    for (const candidate of [...global, ...project]) {
      const key = `${candidate.owner}:${candidate.id}`;
      if (!merged.has(key)) merged.set(key, candidate);
    }
    return [...merged.values()];
  }

  private async recordContextApplications(
    applications: readonly AgentContextApplicationRecord[],
  ): Promise<void> {
    if (!this.persistContextApplications) return;
    await this.transferContextApplicationOutbox(
      applications.map((application) => application.applicationId),
    );
  }

  /** Transfer the outbox atomically per scope without running Provider reflection. */
  public async flushContextApplicationOutbox(): Promise<void> {
    await withOperationBudget({ timeoutMs: 5000 }, async () => {
      do {
        if (operationSignal()?.aborted) return;
        if (!(await this.transferContextApplicationOutbox())) return;
      } while (
        this.applicationStore?.query &&
        (
          await this.applicationStore.query({
            projectId: this.projectId,
            undispatched: true,
            limit: 1,
          })
        ).total > 0
      );
    });
  }

  private async transferContextApplicationOutbox(
    applicationIds?: readonly string[],
  ): Promise<boolean> {
    if (this.applicationStore === undefined) return true;
    const applications = (
      this.applicationStore.query
        ? (
            await this.applicationStore.query({
              projectId: this.projectId,
              undispatched: true,
              applicationIds,
              limit: 100,
            })
          ).items
        : await this.applicationStore.list()
    ).filter((application) =>
      application.scope === 'user'
        ? application.contextProjectId === undefined ||
          application.contextProjectId === this.projectId
        : application.projectId === this.projectId,
    );
    let captured = true;
    for (const scope of ['user', 'project'] as const) {
      const events: AgentExperienceEvent[] = [];
      const receipts: { applicationId: string; outcomeRevision?: number }[] = [];
      for (const application of applications) {
        if (application.scope !== scope) continue;
        if (application.appliedEventDispatchedAt === undefined) {
          events.push(contextAppliedEvent(application, this.projectId));
          receipts.push({ applicationId: application.applicationId });
        }
        for (const outcomeEvent of application.outcomeEvents ?? []) {
          if (outcomeEvent.dispatchedAt !== undefined) continue;
          events.push(contextOutcomeEvent(application, outcomeEvent, this.projectId));
          receipts.push({
            applicationId: application.applicationId,
            outcomeRevision: outcomeEvent.revision,
          });
        }
      }
      if (events.length === 0) continue;
      try {
        await this.runtime.enqueueEvents(events, { finalizeUnobserved: true });
        if (this.applicationStore.markEventsDispatched)
          await this.applicationStore.markEventsDispatched(receipts);
        else
          for (const receipt of receipts) {
            if (receipt.outcomeRevision === undefined)
              await this.applicationStore.markAppliedEventDispatched(receipt.applicationId);
            else
              await this.applicationStore.markOutcomeEventDispatched(
                receipt.applicationId,
                receipt.outcomeRevision,
              );
          }
      } catch {
        captured = false;
        // Capture precedes acknowledgement. A crash or failed acknowledgement replays the same IDs.
      }
    }
    return captured;
  }

  public async dispatchExperience(event: AgentExperienceEvent): Promise<void> {
    await this.runtime.dispatch(event);
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

  public async observeMemory(input: MemoryObservation): Promise<MemoryReviewResult> {
    const scope = input.scope === 'project' ? 'project' : 'user';
    const result = (await this.runtime.invoke(
      'comet.personal-memory',
      'observe',
      input,
      { scope, ...(scope === 'project' ? { projectId: this.projectId } : {}) },
      { throwOnError: true },
    )) as MemoryReviewResult;
    if (result.deferred === true) {
      await this.runtime.dispatch(memoryObservationEvent(input, this.projectId));
    }
    return result;
  }

  public async recordMemoryLearningCheck(
    check: MemoryLearningCheckKind,
    context?: MemoryLearningCheckContext,
  ): Promise<MemoryLearningStatus | undefined> {
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'learning-check',
      { check, ...(context === undefined ? {} : { context }) },
      { scope: 'project', projectId: this.projectId },
      { throwOnError: true },
    )) as MemoryLearningStatus | undefined;
  }

  public async status(): Promise<unknown> {
    // Status is consumed by task and Dashboard callers for the current project.
    // Use the project scope so a shared memory repository cannot expose another
    // project's last learning check in this project's diagnostics.
    return this.runtime.invoke(
      'comet.personal-memory',
      'status',
      {},
      { scope: 'project', projectId: this.projectId },
      {
        throwOnError: true,
      },
    );
  }

  public async retrieve(query: MemoryQuery): Promise<MemoryRetrieval> {
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'retrieve',
      scopedMemoryQuery(query, this.projectId),
      'user',
      { throwOnError: true },
    )) as MemoryRetrieval;
  }

  public async manage(query: MemoryQuery = {}): Promise<MemoryManagementView> {
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'manage',
      scopedMemoryQuery(query, this.projectId),
      'user',
      { throwOnError: true },
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

  public async syncMemory(
    options: {
      readonly timeoutMs?: number;
      readonly learningTimeoutMs?: number;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<unknown> {
    if (
      options.learningTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.learningTimeoutMs) ||
        options.learningTimeoutMs < 1 ||
        options.learningTimeoutMs > 2147483647)
    )
      throw new Error('Learning timeout must be a positive integer within the timer limit');
    return withOperationBudget(
      { timeoutMs: options.timeoutMs ?? 30000, signal: options.signal },
      async () => {
        let learningPartial = false;
        try {
          await withOperationBudget(
            { timeoutMs: options.learningTimeoutMs ?? 5000 },
            async (signal) => {
              await this.flushContextApplicationOutbox();
              await this.runtime.replayLearning();
              learningPartial = signal.aborted;
            },
          );
        } catch {
          learningPartial = true;
        }
        const learning = await withoutOperationBudget(() => this.runtime.learningStatus('all'));
        const outboxPending = this.applicationStore?.query
          ? (
              await this.applicationStore.query({
                projectId: this.projectId,
                undispatched: true,
                limit: 1,
              })
            ).total
          : 0;
        const progress = {
          status:
            learningPartial ||
            outboxPending > 0 ||
            Object.values(learning).some((count) => (count ?? 0) > 0)
              ? 'partial'
              : 'complete',
          ...learning,
          outboxPending,
        };
        if (operationSignal()?.aborted)
          return {
            status: 'failed',
            retryable: true,
            message:
              'Memory maintenance reached its time budget; unfinished learning is saved for the next run.',
            learning: progress,
          };
        const sync = await this.runtime.invoke('comet.personal-memory', 'sync', {}, 'user', {
          throwOnError: true,
        });
        return typeof sync === 'object' && sync !== null ? { ...sync, learning: progress } : sync;
      },
    );
  }

  public async memoryRemote(): Promise<unknown> {
    return this.runtime.invoke('comet.personal-memory', 'remote', {}, 'user', {
      throwOnError: true,
    });
  }

  public async configureMemoryRemote(url: string): Promise<unknown> {
    return this.runtime.invoke('comet.personal-memory', 'configure-remote', { url }, 'user', {
      throwOnError: true,
    });
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
      { throwOnError: true },
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
      { throwOnError: true },
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
  const projectRoot = resolveProjectWorktreeRoot(options.projectRoot);
  const bestEffortContext = options.bestEffortContext === true;
  const contextLockTimeoutMs = bestEffortContext
    ? Math.max(100, Math.min(options.lockTimeoutMs ?? 750, 750))
    : options.lockTimeoutMs;
  const projectName = resolveProjectName(projectRoot);
  const language = options.language ?? (await resolveProjectMemoryLanguage(projectRoot));
  const projectPolicy = await resolveProjectMemoryPolicy(projectRoot);
  const memoryProviderConfig =
    options.memoryProviderConfig ?? (await readPersonalMemoryConfig(homeDirectory));
  const lockOptions: RecoverableFileLockOptions =
    contextLockTimeoutMs === undefined ? {} : { timeoutMs: contextLockTimeoutMs };
  const storage = new JsonFilePluginStorageStore(path.join(stateRoot, 'storage'), lockOptions);
  const userJournal = new AgentExperienceJournal(
    new StorageAgentExperienceJournalStore(await storage.open('comet.agent-learning', 'user')),
  );
  const projectJournal = new AgentExperienceJournal(
    new StorageAgentExperienceJournalStore(
      await storage.open('comet.agent-learning', 'project', options.projectId),
    ),
  );
  const applicationStore: AgentContextApplicationStore = bestEffortContext
    ? new MemoryAgentContextApplicationStore()
    : new SqliteAgentContextApplicationStore(
        path.join(stateRoot, 'storage', 'context-applications.sqlite'),
        await storage.open('comet.agent-context', 'user'),
      );
  const usageTracker = bestEffortContext
    ? undefined
    : new ContextUsageTracker(
        // A busy statistics file must not consume the normal context lock budget.
        await new JsonFilePluginStorageStore(path.join(stateRoot, 'storage'), {
          ...lockOptions,
          timeoutMs: Math.min(contextLockTimeoutMs ?? 150, 150),
        }).open('comet.agent-context', 'project', options.projectId),
      );
  const readUsage = async (
    owner: string,
    applications: readonly AgentContextApplicationRecord[],
  ) => {
    try {
      return await usageTracker?.snapshot(
        owner,
        options.projectId,
        applicationStore.query
          ? async (ids) => {
              const results: AgentContextApplicationRecord[] = [];
              for (let offset = 0; offset < ids.length; offset += 100)
                results.push(
                  ...(
                    await applicationStore.query!({
                      owner,
                      projectId: options.projectId,
                      applicationIds: ids.slice(offset, offset + 100),
                      limit: 100,
                    })
                  ).items,
                );
              return results;
            }
          : applications,
      );
    } catch {
      return undefined;
    }
  };
  const effectiveMemoryProviderConfig =
    bestEffortContext && memoryProviderConfig.provider === 'remote' && memoryProviderConfig.remote
      ? {
          ...memoryProviderConfig,
          remote: {
            ...memoryProviderConfig.remote,
            timeoutMs: Math.min(
              memoryProviderConfig.remote.timeoutMs ?? contextLockTimeoutMs ?? 750,
              contextLockTimeoutMs ?? 750,
            ),
          },
        }
      : memoryProviderConfig;
  const knowledgeConfig = await resolveProjectKnowledgeConfig(projectRoot);
  const effectiveKnowledgeConfig =
    bestEffortContext && knowledgeConfig.provider === 'remote' && knowledgeConfig.remote
      ? {
          ...knowledgeConfig,
          remote: {
            ...knowledgeConfig.remote,
            timeout_ms: Math.min(knowledgeConfig.remote.timeout_ms, contextLockTimeoutMs ?? 750),
          },
        }
      : knowledgeConfig;
  const contextDirector = new ContextDirector({
    applications: applicationStore,
    defaultCharBudget: effectiveMemoryProviderConfig.taskContextCharLimit,
  });
  const knowledgeCacheRoot = options.knowledgeCacheRoot
    ? path.resolve(options.knowledgeCacheRoot)
    : options.stateRoot
      ? path.join(stateRoot, 'knowledge-cache')
      : options.homeDirectory
        ? defaultProjectKnowledgeStorageRoot(homeDirectory)
        : undefined;
  const hostReview = new ProjectKnowledgeHostReview(projectRoot, knowledgeCacheRoot);
  const runtime = new PluginRuntime({
    cometVersion: options.cometVersion ?? getCurrentVersion(),
    config: options.config,
    store: new JsonPluginStateStore(
      new JsonFileTextStore(path.join(stateRoot, 'state.json'), lockOptions),
    ),
    storage,
    journals: { user: userJournal, project: projectJournal },
    replayPendingLearningOnContext: false,
    isLearningWaitResolved: (wait) => hostReview.isSubmitted(wait),
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
        readContextUsage: (applications) => readUsage('comet.personal-memory', applications),
        queryContextApplications: applicationStore.query
          ? (query) =>
              applicationStore.query!({
                ...query,
                owner: 'comet.personal-memory',
                projectId: options.projectId,
              })
          : undefined,
        listContextApplications: async (candidateId) =>
          (await applicationStore.list(candidateId)).filter(
            (application) =>
              application.owner === 'comet.personal-memory' &&
              (application.scope === 'user' || application.projectId === options.projectId),
          ),
        createService: () => {
          if (effectiveMemoryProviderConfig.provider === 'remote') {
            if (effectiveMemoryProviderConfig.remote === undefined) {
              throw new Error('Remote Provider endpoint is not configured');
            }
            return new RemotePersonalMemoryService({
              ...effectiveMemoryProviderConfig.remote,
              profileCharLimit: effectiveMemoryProviderConfig.profileCharLimit,
              taskContextCharLimit: effectiveMemoryProviderConfig.taskContextCharLimit,
              projectKey: options.projectId,
            });
          }
          return new PersonalMemoryService({
            language,
            profileMaxChars: effectiveMemoryProviderConfig.profileCharLimit,
            taskMaxChars: effectiveMemoryProviderConfig.taskContextCharLimit,
            repository: new FileMemoryRepository(memoryRoot, {
              git: new GitMemorySync(memoryRoot),
              ...(contextLockTimeoutMs === undefined
                ? {}
                : { lockTimeoutMs: contextLockTimeoutMs }),
              projectKey: options.projectId,
              projectName,
            }),
          });
        },
      }),
      createProjectKnowledgePluginDescriptor({
        projectRoot,
        knowledgeConfig: effectiveKnowledgeConfig,
        updateKnowledgeConfig: async (knowledge) => {
          const current = await readWorkflowProjectConfig(projectRoot);
          if (current === null) throw new Error('Project config is not available');
          await writeWorkflowProjectConfig(projectRoot, { ...current, knowledge });
        },
        language,
        readContextUsage: (applications) => readUsage('comet.project-knowledge', applications),
        queryContextApplications: applicationStore.query
          ? (query) =>
              applicationStore.query!({
                ...query,
                owner: 'comet.project-knowledge',
                projectId: options.projectId,
              })
          : undefined,
        listContextApplications: async (candidateId) =>
          (await applicationStore.list(candidateId)).filter(
            (application) =>
              application.owner === 'comet.project-knowledge' &&
              application.scope === 'project' &&
              application.projectId === options.projectId,
          ),
        ...(knowledgeCacheRoot ? { cacheRoot: knowledgeCacheRoot } : {}),
        ...(options.runProjectKnowledgeReview
          ? { semanticReviewer: options.runProjectKnowledgeReview }
          : {}),
      }),
      ...(options.descriptors ?? []),
    ],
  });
  if (!bestEffortContext) await runtime.reconcileFirstParty();
  const bridge = new CometPluginBridge(
    runtime,
    options.projectId,
    language,
    contextDirector,
    bestEffortContext ? undefined : applicationStore,
    !bestEffortContext,
    usageTracker,
  );
  return bridge;
}

export async function readDefaultProjectLearningStatus(
  projectId: string,
  homeDirectory = os.homedir(),
): Promise<import('../agent-learning/index.js').AgentLearningStatus> {
  const stateRoot = path.join(path.resolve(homeDirectory), '.comet', 'plugins');
  const storage = new JsonFilePluginStorageStore(path.join(stateRoot, 'storage'));
  const journal = new AgentExperienceJournal(
    new StorageAgentExperienceJournalStore(
      await storage.open('comet.agent-learning', 'project', projectId),
    ),
  );
  return journal.status();
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
    context: {
      task: application.task,
      ...(application.path === undefined ? {} : { paths: [application.path] }),
      ...(application.operation === undefined ? {} : { operation: application.operation }),
      ...(application.phase === undefined ? {} : { phase: application.phase }),
    },
    evidence:
      outcomeEvent.evidence === undefined
        ? []
        : [
            { id: 'adoption', kind: 'outcome', summary: outcomeEvent.evidence.decision },
            {
              id: 'adoption-verification',
              kind: 'verification',
              summary: outcomeEvent.evidence.verification.success
                ? 'Host reported verification passed'
                : 'Host reported verification failed',
              ...outcomeEvent.evidence.verification,
            },
          ],
    outcome: {
      status: outcomeEvent.status,
      ...(outcomeEvent.evidence === undefined ? {} : { summary: outcomeEvent.evidence.decision }),
      ...(outcomeEvent.previousStatus === undefined
        ? {}
        : { previousStatus: outcomeEvent.previousStatus }),
      revision: outcomeEvent.revision,
      applicationId: application.applicationId,
      unitIds: [contextExpansionId(application.owner, application.candidateId)],
    },
  };
}

function memoryObservationEvent(
  observation: MemoryObservation,
  fallbackProjectId: string,
): AgentExperienceEvent {
  const identity = createHash('sha256')
    .update(
      JSON.stringify({
        scope: observation.scope,
        projectKey: observation.projectKey,
        workflow: observation.workflow,
        changeId: observation.changeId,
        candidateKey: observation.candidateKey ?? 'default',
        text: observation.text,
      }),
    )
    .digest('hex');
  const projectId =
    observation.scope === 'project' ? (observation.projectKey ?? fallbackProjectId) : undefined;
  return {
    schema: AGENT_EXPERIENCE_SCHEMA,
    eventId: `memory-observation:${identity}`,
    episodeId: `memory-observation:${identity}`,
    occurredAt: observation.observedAt ?? new Date().toISOString(),
    type: 'user.signal',
    actor: 'agent',
    scope: observation.scope === 'project' ? 'project' : 'user',
    ...(projectId === undefined ? {} : { projectId }),
    source: {
      kind: 'workflow',
      name: 'memory.observe',
      workflow: observation.workflow,
      changeId: observation.changeId,
    },
    context: {
      workflow: observation.workflow,
      changeId: observation.changeId,
      operation: 'memory.observe',
      ...(observation.pathPatterns === undefined ? {} : { paths: observation.pathPatterns }),
    },
    signal: {
      kind: 'preference',
      explicit: false,
      longTerm: true,
      text: observation.text,
      category: observation.category,
      ...(observation.candidateKey === undefined ? {} : { targetId: observation.candidateKey }),
      selectors: {
        ...(observation.pathPatterns === undefined ? {} : { paths: observation.pathPatterns }),
        ...(observation.taskTypes === undefined ? {} : { tasks: observation.taskTypes }),
        ...(observation.operations === undefined ? {} : { operations: observation.operations }),
        ...(observation.phases === undefined ? {} : { phases: observation.phases }),
      },
    },
    evidence:
      observation.evidence === undefined || observation.evidence.length === 0
        ? [
            {
              id: `memory-observation-evidence:${identity}`,
              kind: 'source',
              summary: observation.text,
              success: observation.success,
            },
          ]
        : observation.evidence,
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
