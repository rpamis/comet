import type { PluginContext, PluginDescriptor } from '../comet-plugin/index.js';

export type MemoryScope = 'global' | 'project';
export type MemoryKind = 'explicit' | 'inferred';
export type MemorySourceKind = 'user' | 'workflow' | 'review' | 'repository';
export type MemoryLanguage = 'zh-CN' | 'en';
export type MemoryReviewActionKind = 'create' | 'update' | 'forget' | 'skip';

export interface MemorySource {
  readonly kind: MemorySourceKind;
  readonly label?: string;
  readonly workflow?: string;
  readonly changeId?: string;
  readonly projectKey?: string;
}

export interface MemoryInput {
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly language?: MemoryLanguage;
  readonly category: string;
  readonly text: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly source?: MemorySource;
}

export interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly category: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly pathPatterns: readonly string[];
  readonly taskTypes: readonly string[];
  readonly operations: readonly string[];
  readonly language?: MemoryLanguage;
  readonly kind: MemoryKind;
  readonly active: boolean;
  readonly source: MemorySource;
  readonly sources: readonly MemorySource[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryCorrection {
  readonly text?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
}

export interface MemoryObservation {
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly category: string;
  readonly text: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly language?: MemoryLanguage;
  readonly projectIdentity?: string;
  readonly candidateKey?: string;
  readonly observedAt?: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly source?: MemorySource;
}

export interface MemoryObservationResult {
  readonly deduplicated: boolean;
  readonly ignored: boolean;
  readonly candidate: boolean;
  readonly activated: boolean;
  readonly record: MemoryRecord | null;
}

export interface MemoryQuery {
  readonly scope?: MemoryScope;
  readonly projectKey?: string;
  readonly task?: string;
  readonly path?: string;
  readonly operation?: string;
  readonly query?: string;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

export interface MemoryRetrieval {
  readonly records: readonly MemoryRecord[];
  readonly text: string;
  readonly truncated: boolean;
  readonly disabled: boolean;
}

export interface MemorySyncResult {
  readonly status: 'synced' | 'local-only' | 'failed' | 'conflict';
  readonly message?: string;
  readonly retryable: boolean;
}

export interface MemoryGitSync {
  sync(): Promise<MemorySyncResult>;
  remote?(): Promise<string | null>;
  configureRemote?(url: string): Promise<void>;
}

export interface MemoryRuntimeState {
  readonly version: 1;
  readonly records: readonly MemoryRecord[];
  readonly history: Readonly<Record<string, readonly MemoryRecord[]>>;
  readonly evidence: Readonly<Record<string, readonly string[]>>;
  readonly observations: readonly MemoryStoredObservation[];
  readonly conflicts: readonly MemoryConflict[];
  readonly tombstones?: readonly MemoryTombstone[];
  readonly settings: MemorySettings;
  readonly files: Readonly<Record<string, MemoryFileState>>;
}

export interface MemoryStoredObservation {
  readonly key: string;
  readonly changeId: string;
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly projectIdentity?: string;
  readonly candidateKey: string;
  readonly identity: string;
  readonly text: string;
  readonly normalizedText: string;
  readonly success: boolean;
  readonly source: MemorySource;
  readonly observedAt: string;
}

export interface MemoryConflict {
  readonly identity: string;
  readonly texts: readonly string[];
  readonly recordIds?: readonly string[];
  readonly updatedAt: string;
}

export interface MemoryTombstone {
  readonly identity: string;
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly recordId: string;
  readonly removedAt: string;
}

export interface MemoryReviewBudget {
  readonly maxActions: number;
  readonly maxEvidence: number;
  readonly maxBytes: number;
}

export interface MemoryReviewEvidence {
  readonly key: string;
  readonly projectIdentity?: string;
  readonly projectKey?: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly text?: string;
}

export interface MemoryReviewMemorySummary {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly category: string;
  readonly text: string;
  readonly kind: MemoryKind;
  readonly active: boolean;
}

export interface MemoryReviewPacket {
  readonly schema: 'comet.memory.review.v1';
  readonly language: MemoryLanguage;
  readonly projectIdentity?: string;
  readonly projectKey?: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly checkpoint: string;
  readonly userEvidence: readonly string[];
  readonly evidence: readonly MemoryReviewEvidence[];
  readonly memories: readonly MemoryReviewMemorySummary[];
  readonly budget: MemoryReviewBudget;
}

export interface MemoryReviewActionBase {
  readonly action: MemoryReviewActionKind;
  readonly language: MemoryLanguage;
  readonly scope?: MemoryScope;
  readonly projectKey?: string;
  readonly candidateKey?: string;
  readonly evidenceKeys?: readonly string[];
  readonly reason?: string;
}

export interface MemoryReviewCreateAction extends MemoryReviewActionBase {
  readonly action: 'create';
  readonly scope: MemoryScope;
  readonly category: string;
  readonly text: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
}

export interface MemoryReviewUpdateAction extends MemoryReviewActionBase {
  readonly action: 'update';
  readonly targetId: string;
  readonly text?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
}

export interface MemoryReviewForgetAction extends MemoryReviewActionBase {
  readonly action: 'forget';
  readonly targetId: string;
}

export interface MemoryReviewSkipAction extends MemoryReviewActionBase {
  readonly action: 'skip';
  readonly reason: string;
}

export type MemoryReviewAction =
  | MemoryReviewCreateAction
  | MemoryReviewUpdateAction
  | MemoryReviewForgetAction
  | MemoryReviewSkipAction;

export interface MemoryReviewActionSet {
  readonly schema: 'comet.memory.actions.v1';
  readonly actions: readonly MemoryReviewAction[];
}

export interface MemorySettings {
  readonly learningEnabled: boolean;
  readonly retrievalEnabled: boolean;
  readonly pausedProjects: readonly string[];
  readonly pausedLearningProjects: readonly string[];
  readonly pausedRetrievalProjects: readonly string[];
}

export interface MemoryFileState {
  readonly hash: string;
  readonly observedAt: string;
}

export interface MemoryRepository {
  readText(relativePath: string): Promise<string | null>;
  writeText(relativePath: string, content: string): Promise<void>;
  readState(): Promise<MemoryRuntimeState>;
  writeState(state: MemoryRuntimeState): Promise<void>;
  withLock<T>(operation: () => Promise<T>): Promise<T>;
  sync(): Promise<MemorySyncResult>;
  remote?(): Promise<string | null>;
  configureRemote?(url: string): Promise<void>;
}

export interface FileMemoryRepositoryOptions {
  readonly git?: MemoryGitSync;
  readonly lockTimeoutMs?: number;
  readonly lockRetryMs?: number;
}

export interface GitMemorySyncOptions {
  readonly remoteName?: string;
  readonly commitMessage?: string;
  readonly run?: (
    args: readonly string[],
  ) => Promise<{ readonly stdout: string; readonly stderr: string }>;
}

export interface PersonalMemoryOptions {
  readonly repository: MemoryRepository;
  readonly now?: () => Date;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

export interface PersonalMemoryStatus {
  readonly learningEnabled: boolean;
  readonly retrievalEnabled: boolean;
  readonly pausedProjects: readonly string[];
  readonly pausedLearningProjects: readonly string[];
  readonly pausedRetrievalProjects: readonly string[];
  readonly files: readonly string[];
  readonly remote: string | null;
  readonly sync: MemorySyncResult | null;
}

export interface PersonalMemoryPluginOptions {
  readonly version?: string;
  readonly cometVersionRange?: (cometVersion: string) => boolean;
  readonly createService: (context: PluginContext) => PersonalMemoryServiceLike;
}

export interface PersonalMemoryServiceLike {
  remember(input: MemoryInput): Promise<MemoryRecord>;
  correct(id: string, correction: MemoryCorrection): Promise<MemoryRecord>;
  remove(id: string, options?: { readonly permanent?: boolean }): Promise<void>;
  rollback(id: string): Promise<MemoryRecord>;
  observe(observation: MemoryObservation): Promise<MemoryObservationResult>;
  retrieve(query: MemoryQuery): Promise<MemoryRetrieval>;
  status(): Promise<PersonalMemoryStatus>;
  sync(): Promise<MemorySyncResult>;
  remote?(): Promise<string | null>;
  configureRemote?(url: string): Promise<void>;
  setLearningEnabled?(enabled: boolean): Promise<void>;
  setRetrievalEnabled?(enabled: boolean): Promise<void>;
  pauseProjectLearning?(projectKey: string, paused: boolean): Promise<void>;
  pauseProjectRetrieval?(projectKey: string, paused: boolean): Promise<void>;
}

export type PersonalMemoryPluginDescriptorFactory = (
  options: PersonalMemoryPluginOptions,
) => PluginDescriptor;
