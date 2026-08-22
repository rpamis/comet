import os from 'node:os';
import path from 'node:path';

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
  type MemoryManagementRecord,
  type MemoryQuery,
  type MemoryRecord,
  type MemoryRetrieval,
  type MemoryReviewSkillRunner,
  type MemoryReviewRequest,
  type MemoryProviderConfig,
  readPersonalMemoryConfig,
  writePersonalMemoryConfig,
} from '../comet-memory/index.js';
import { getCurrentVersion } from '../../platform/version/version.js';
import { resolveProjectName } from '../../platform/paths/project-identity.js';
import { JsonFilePluginStorageStore, JsonFileTextStore } from '../../platform/fs/plugin-store.js';
import { JsonPluginStateStore, PluginRuntime } from './plugin-runtime.js';
import type { PluginContextContribution, PluginEvent, PluginScopeContext } from './types.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import { DEFAULT_WORKFLOW_MEMORY_PROJECT_CONFIG } from '../workflow-contract/project-config.js';
import type { WorkflowMemoryProjectConfig } from '../workflow-contract/types.js';
import { createProjectKnowledgePluginDescriptor } from '../project-knowledge/index.js';
import type { WorkflowKnowledgeProjectConfig } from '../workflow-contract/types.js';
import { DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG } from '../workflow-contract/project-config.js';
import type { ProjectKnowledgeSemanticReviewer } from '../project-knowledge/learning.js';
import { sanitizeProjectPreferenceForSharing } from '../project-knowledge/learning.js';

export interface CometLifecycleObservation {
  readonly name:
    | 'change.completed'
    | 'task.completed'
    | 'review.completed'
    | 'verification.completed';
  readonly workflow: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly category: string;
  readonly text: string;
  readonly candidateKey?: string;
  readonly projectKey?: string;
  readonly language?: MemoryLanguage;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly userEvidence?: readonly string[];
  readonly explicitRequest?: MemoryReviewRequest;
  /** Structured workflow evidence used by project knowledge learning. */
  readonly changedPaths?: readonly string[];
  readonly artifactRefs?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly verificationResults?: readonly {
    readonly command: string;
    readonly success: boolean;
  }[];
}

export interface CometPluginBridgeOptions {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly language?: MemoryLanguage;
  readonly memoryRoot?: string;
  /** Optional user-level Provider selection, primarily for hosts and tests. */
  readonly memoryProviderConfig?: MemoryProviderConfig;
  readonly stateRoot?: string;
  readonly knowledgeCacheRoot?: string;
  readonly cometVersion?: string;
  /** Optional host-owned adapter for nonblocking semantic memory review. */
  readonly runMemoryReviewInBackground?: (task: () => Promise<void>) => void | Promise<void>;
  /** Optional host adapter that invokes the installed comet-memory Skill. */
  readonly runMemoryReview?: MemoryReviewSkillRunner;
  /** Optional host callback for the small number of user-visible memory notices. */
  readonly onMemoryReviewNotice?: (notice: string) => void | Promise<void>;
  /** Optional host-owned adapter for nonblocking project knowledge review. */
  readonly runProjectKnowledgeReview?: ProjectKnowledgeSemanticReviewer;
  /** Optional host-owned scheduler for project knowledge semantic review. */
  readonly runProjectKnowledgeReviewInBackground?: (
    task: () => Promise<void>,
  ) => void | Promise<void>;
}

export interface CometPluginContextRequest {
  readonly task: string;
  readonly path?: string;
  readonly phase?: string;
}

export class CometPluginBridge {
  public constructor(
    private readonly runtime: PluginRuntime,
    private readonly projectId: string,
    private readonly language: MemoryLanguage = 'zh-CN',
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
  ): Promise<PluginContextContribution[]> {
    const target: PluginScopeContext = { scope: 'project', projectId: this.projectId };
    const [global, project] = await Promise.all([
      this.runtime.collectContext({ ...request, projectId: this.projectId }, 'user'),
      this.runtime.collectContext({ ...request, projectId: this.projectId }, target),
    ]);
    const merged = new Map<string, PluginContextContribution>();
    for (const contribution of [...global, ...project]) {
      const previous = merged.get(String(contribution.pluginId));
      if (previous === undefined) {
        merged.set(String(contribution.pluginId), contribution);
        continue;
      }
      merged.set(String(contribution.pluginId), {
        ...previous,
        text: [...new Set([previous.text, contribution.text].filter(Boolean))].join('\n\n'),
        ...(Array.isArray(previous.records) || Array.isArray(contribution.records)
          ? {
              records: deduplicateRecords([
                ...arrayValue(previous.records),
                ...arrayValue(contribution.records),
              ]),
            }
          : {}),
      });
    }
    return [...merged.values()];
  }

  public async dispatchLifecycle(observation: CometLifecycleObservation): Promise<void> {
    const payload = {
      ...observation,
      projectKey: observation.projectKey ?? this.projectId,
      language: observation.language ?? this.language,
      ...(observation.candidateKey ? { candidateKey: observation.candidateKey } : {}),
    };
    const source = {
      kind: 'workflow' as const,
      name: observation.workflow,
      change: observation.changeId,
      projectId: this.projectId,
    };
    const base: Omit<PluginEvent, 'scope' | 'projectId'> = {
      name: observation.name,
      source,
      payload,
    };
    await this.runtime.dispatch({ ...base, scope: 'project', projectId: this.projectId });
    try {
      await this.syncMemory();
    } catch {
      // A remote or Git installation failure is a diagnostic, not a workflow failure.
    }
  }

  public async remember(input: MemoryInput): Promise<MemoryRecord | null> {
    const normalized =
      input.scope === 'project' && input.projectKey === undefined
        ? { ...input, projectKey: this.projectId }
        : input;
    return (await this.runtime.invoke(
      'comet.personal-memory',
      'remember',
      { ...normalized, language: normalized.language ?? this.language },
      'user',
      { throwOnError: true },
    )) as MemoryRecord | null;
  }

  public async observe(input: CometLifecycleObservation): Promise<unknown> {
    await this.dispatchLifecycle(input);
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
      { id, correction },
      'user',
      { throwOnError: true },
    )) as MemoryRecord;
  }

  public async forget(id: string, permanent = false): Promise<void> {
    await this.runtime.invoke('comet.personal-memory', 'remove', { id, permanent }, 'user', {
      throwOnError: true,
    });
  }

  public async rollback(id: string): Promise<MemoryRecord> {
    return (await this.runtime.invoke('comet.personal-memory', 'rollback', { id }, 'user', {
      throwOnError: true,
    })) as MemoryRecord;
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
    return this.runtime.invoke(
      'comet.personal-memory',
      'pause-project-retrieval',
      { projectKey, paused },
      'user',
    );
  }

  public async shareProjectPreference(
    memoryId: string,
    options: {
      readonly confirm: boolean;
      readonly sources: readonly { readonly source: string; readonly anchor?: string }[];
    },
  ): Promise<unknown> {
    if (!options.confirm)
      throw new Error('Sharing a personal project preference requires confirmation');
    const management = await this.manage({ scope: 'project' });
    const record = management.records.find((entry) => entry.id === memoryId);
    if (record === undefined) throw new Error(`Personal memory is not found: ${memoryId}`);
    const preference = memoryManagementRecordToPreference(record, options.sources);
    const unit = sanitizeProjectPreferenceForSharing(preference);
    return this.runtime.invoke(
      'comet.project-knowledge',
      'share-memory',
      { unit, confirm: options.confirm },
      { scope: 'project', projectId: this.projectId },
    );
  }

  public async diagnostics(): Promise<ReturnType<PluginRuntime['diagnostics']>> {
    return this.runtime.diagnostics();
  }
}

function memoryManagementRecordToPreference(
  record: MemoryManagementRecord,
  sources: readonly { readonly source: string; readonly anchor?: string }[],
): Parameters<typeof sanitizeProjectPreferenceForSharing>[0] {
  return {
    category: record.category,
    text: record.text,
    ...(record.title === undefined ? {} : { title: record.title }),
    pathPatterns: record.pathPatterns,
    operations: record.operations,
    sources,
  };
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function deduplicateRecords(records: readonly unknown[]): readonly unknown[] {
  const unique = new Map<string, unknown>();
  for (const record of records) {
    const key =
      record !== null && typeof record === 'object' && 'id' in record
        ? String((record as { id?: unknown }).id)
        : JSON.stringify(record);
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()];
}

export async function createDefaultCometPluginBridge(
  options: CometPluginBridgeOptions,
): Promise<CometPluginBridge> {
  const memoryRoot = path.resolve(
    options.memoryRoot ?? path.join(os.homedir(), '.comet', 'memory'),
  );
  const stateRoot = path.resolve(options.stateRoot ?? path.join(os.homedir(), '.comet', 'plugins'));
  const projectRoot = path.resolve(options.projectRoot);
  const projectName = resolveProjectName(projectRoot);
  const language = options.language ?? (await resolveProjectMemoryLanguage(projectRoot));
  const projectPolicy = await resolveProjectMemoryPolicy(projectRoot);
  const memoryProviderConfig =
    options.memoryProviderConfig ?? (await readPersonalMemoryConfig(os.homedir()));
  const runtime = new PluginRuntime({
    cometVersion: options.cometVersion ?? getCurrentVersion(),
    store: new JsonPluginStateStore(new JsonFileTextStore(path.join(stateRoot, 'state.json'))),
    storage: new JsonFilePluginStorageStore(path.join(stateRoot, 'storage')),
    descriptors: [
      createPersonalMemoryPluginDescriptor({
        language,
        projectPolicy,
        ...(options.runMemoryReviewInBackground === undefined
          ? {}
          : { runReviewInBackground: options.runMemoryReviewInBackground }),
        ...(options.runMemoryReview === undefined
          ? {}
          : { runMemoryReview: options.runMemoryReview }),
        ...(options.onMemoryReviewNotice === undefined
          ? {}
          : { onReviewNotice: options.onMemoryReviewNotice }),
        getProviderConfig: () => readPersonalMemoryConfig(os.homedir()),
        configureProvider: (config) => writePersonalMemoryConfig(os.homedir(), config),
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
        language,
        ...(options.knowledgeCacheRoot
          ? { cacheRoot: path.resolve(options.knowledgeCacheRoot) }
          : options.stateRoot
            ? { cacheRoot: path.join(stateRoot, 'knowledge-cache') }
            : {}),
        ...(options.runProjectKnowledgeReview
          ? { semanticReviewer: options.runProjectKnowledgeReview }
          : {}),
        ...(options.runProjectKnowledgeReviewInBackground
          ? { runReviewInBackground: options.runProjectKnowledgeReviewInBackground }
          : {}),
      }),
    ],
  });
  await runtime.reconcileFirstParty();
  return new CometPluginBridge(runtime, options.projectId, language);
}

function scopedMemoryQuery(query: MemoryQuery, projectId: string): MemoryQuery {
  if (query.scope === 'global') return query;
  return { ...query, projectKey: query.projectKey ?? projectId };
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
