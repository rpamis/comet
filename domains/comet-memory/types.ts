import type { PluginContext, PluginDescriptor } from '../comet-plugin/index.js';

export type MemoryScope = 'global' | 'project';
export type MemoryKind = 'explicit' | 'inferred';
export type MemorySourceKind = 'user' | 'workflow' | 'review' | 'repository';

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
}

export interface MemoryRuntimeState {
  readonly version: 1;
  readonly records: readonly MemoryRecord[];
  readonly history: Readonly<Record<string, readonly MemoryRecord[]>>;
  readonly evidence: Readonly<Record<string, readonly string[]>>;
  readonly observations: readonly MemoryStoredObservation[];
  readonly conflicts: readonly MemoryConflict[];
  readonly settings: MemorySettings;
  readonly files: Readonly<Record<string, MemoryFileState>>;
}

export interface MemoryStoredObservation {
  readonly key: string;
  readonly scope: MemoryScope;
  readonly projectKey?: string;
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
  readonly updatedAt: string;
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
}

export type PersonalMemoryPluginDescriptorFactory = (
  options: PersonalMemoryPluginOptions,
) => PluginDescriptor;
