import type { PluginContext, PluginDescriptor } from '../comet-plugin/index.js';
import type {
  AgentContextApplicationRecord,
  AgentContextOutcomeStatus,
  AgentExperienceEvidence,
  AgentLearningDelta,
} from '../agent-learning/index.js';

export type MemoryScope = 'global' | 'project';
export type MemoryKind = 'explicit' | 'inferred';
export type PersonalMemoryType = 'core-profile' | 'collaboration-policy' | 'personal-episode';
export type MemoryLifecycleState = 'trial' | 'proven' | 'superseded';
export type MemoryClass =
  'user-fact' | 'user-preference' | 'collaboration-habit' | 'project-convention';

export function isMemoryClass(value: unknown): value is MemoryClass {
  return (
    value === 'user-fact' ||
    value === 'user-preference' ||
    value === 'collaboration-habit' ||
    value === 'project-convention'
  );
}
export type MemorySourceKind = 'user' | 'workflow' | 'review' | 'repository';
export type MemoryLanguage = 'zh-CN' | 'en';
export type MemoryAuthority = 'explicit' | 'inferred';
export type MemoryReviewActionKind = 'create' | 'update' | 'forget' | 'skip';
export type MemoryQueryView = 'combined' | 'profile' | 'task' | 'manage' | 'manifest' | 'expand';

export interface PersonalEpisodeDetails {
  readonly situation: string;
  readonly actionSummary: string;
  readonly outcome: string;
  readonly lesson: string;
}

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
  readonly memoryType?: PersonalMemoryType;
  readonly memoryClass?: MemoryClass;
  readonly language?: MemoryLanguage;
  readonly title?: string;
  readonly reason?: string;
  readonly category: string;
  readonly text: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly phases?: readonly string[];
  readonly evidence?: readonly AgentExperienceEvidence[];
  readonly episode?: PersonalEpisodeDetails;
  readonly candidateKey?: string;
  readonly source?: MemorySource;
}

export interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly memoryClass?: MemoryClass;
  readonly title?: string;
  readonly reason?: string;
  readonly category: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly pathPatterns: readonly string[];
  readonly taskTypes: readonly string[];
  readonly operations: readonly string[];
  readonly phases: readonly string[];
  readonly candidateKey?: string;
  readonly language?: MemoryLanguage;
  readonly kind: MemoryKind;
  readonly authority: MemoryAuthority;
  readonly evidence: readonly AgentExperienceEvidence[];
  readonly episode?: PersonalEpisodeDetails;
  readonly memoryType: PersonalMemoryType;
  readonly state: MemoryLifecycleState;
  readonly applicationCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastAppliedAt?: string;
  readonly source: MemorySource;
  readonly sources: readonly MemorySource[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryCorrection {
  readonly memoryType?: PersonalMemoryType;
  readonly title?: string;
  readonly reason?: string;
  readonly text?: string;
  readonly category?: string;
  readonly memoryClass?: MemoryClass;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly phases?: readonly string[];
  readonly episode?: PersonalEpisodeDetails;
}

export interface MemoryApplicationFeedback {
  readonly id: string;
  readonly outcome: AgentContextOutcomeStatus;
  readonly previousOutcome?: AgentContextOutcomeStatus;
  readonly applicationId?: string;
  readonly revision?: number;
  readonly idempotencyKey?: string;
}

export interface MemoryObservation {
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly memoryType?: PersonalMemoryType;
  readonly memoryClass?: MemoryClass;
  readonly category: string;
  readonly text: string;
  readonly title?: string;
  readonly reason?: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly phases?: readonly string[];
  readonly evidence?: readonly AgentExperienceEvidence[];
  readonly episode?: PersonalEpisodeDetails;
  readonly language?: MemoryLanguage;
  readonly projectIdentity?: string;
  readonly candidateKey?: string;
  readonly observedAt?: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly userEvidence?: readonly string[];
  readonly explicitRequest?: MemoryReviewRequest;
  readonly source?: MemorySource;
}

export interface MemoryObservationResult {
  readonly deduplicated: boolean;
  readonly ignored: boolean;
  readonly candidate: boolean;
  readonly promoted: boolean;
  readonly record: MemoryRecord | null;
}

export interface MemoryQuery {
  readonly view?: MemoryQueryView;
  readonly scope?: MemoryScope;
  readonly projectKey?: string;
  readonly task?: string;
  readonly path?: string;
  readonly operation?: string;
  readonly phase?: string;
  readonly id?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly query?: string;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly maxChars?: number;
  readonly profileMaxChars?: number;
  readonly taskMaxChars?: number;
}

export interface MemoryRetrieval {
  readonly records: readonly MemoryRecord[];
  readonly text: string;
  readonly truncated: boolean;
  readonly disabled: boolean;
  readonly profileRecords?: readonly MemoryRecord[];
  readonly profileText?: string;
  readonly taskRecords?: readonly MemoryRecord[];
  readonly taskText?: string;
  readonly profileTruncated?: boolean;
  readonly taskTruncated?: boolean;
}

export interface MemoryManifestItem {
  readonly id: string;
  readonly memoryType: PersonalMemoryType;
  readonly state: MemoryLifecycleState;
  readonly authority: MemoryAuthority;
  readonly title: string;
  readonly summary: string;
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly pathPatterns: readonly string[];
  readonly taskTypes: readonly string[];
  readonly operations: readonly string[];
  readonly phases: readonly string[];
  readonly evidence: readonly AgentExperienceEvidence[];
}

export interface MemoryManifestView {
  readonly kind: 'manifest';
  readonly items: readonly MemoryManifestItem[];
  readonly truncated: boolean;
}

export interface MemoryExpandedView {
  readonly kind: 'expand';
  readonly record: MemoryRecord | null;
}

export type MemoryProviderQueryResult =
  MemoryRetrieval | MemoryManagementView | MemoryManifestView | MemoryExpandedView;

export type MemoryManagementStatus = MemoryLifecycleState | 'conflict' | 'tombstoned';

export interface MemoryManagementRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly memoryClass?: MemoryClass;
  readonly title?: string;
  readonly reason?: string;
  readonly category: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly pathPatterns: readonly string[];
  readonly taskTypes: readonly string[];
  readonly operations: readonly string[];
  readonly phases: readonly string[];
  readonly language?: MemoryLanguage;
  readonly kind: MemoryKind;
  readonly authority: MemoryAuthority;
  readonly evidence: readonly AgentExperienceEvidence[];
  readonly episode?: PersonalEpisodeDetails;
  readonly memoryType: PersonalMemoryType;
  readonly applicationCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastAppliedAt?: string;
  readonly status: MemoryManagementStatus;
  readonly evidenceCount: number;
  readonly sourceKind: MemorySourceKind;
  readonly lastConfirmedAt: string;
  readonly updatedAt: string;
  readonly canRollback: boolean;
}

export interface MemoryManagementConflict {
  readonly texts: readonly string[];
  readonly updatedAt: string;
}

export interface MemoryManagementView {
  readonly records: readonly MemoryManagementRecord[];
  readonly conflicts: readonly MemoryManagementConflict[];
  readonly truncated: boolean;
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
  readonly version: 3;
  readonly records: readonly MemoryRecord[];
  readonly history: Readonly<Record<string, readonly MemoryRecord[]>>;
  readonly evidence: Readonly<Record<string, readonly string[]>>;
  readonly observations: readonly MemoryStoredObservation[];
  readonly conflicts: readonly MemoryConflict[];
  readonly tombstones?: readonly MemoryTombstone[];
  readonly settings: MemorySettings;
  readonly files: Readonly<Record<string, MemoryFileState>>;
  readonly projectFiles?: Readonly<Record<string, string>>;
  readonly appliedMutationIds?: readonly string[];
  readonly applicationOutcomes?: Readonly<
    Record<
      string,
      {
        readonly recordId: string;
        readonly status: AgentContextOutcomeStatus;
        readonly revision: number;
      }
    >
  >;
  readonly feedbackState?: Readonly<
    Record<
      string,
      {
        readonly baseState: Exclude<MemoryLifecycleState, 'superseded'>;
      }
    >
  >;
  readonly pendingFileProjections?: Readonly<Record<string, MemoryFileProjection>>;
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
  readonly textHash?: string;
  readonly reason?: 'user-remove' | 'markdown-delete' | 'negative-feedback';
  readonly permanent?: boolean;
  readonly removedAt: string;
}

export interface MemoryReviewBudget {
  readonly maxActions: number;
  readonly maxEvidence: number;
  readonly maxBytes: number;
}

export type MemoryReviewRequestAction = 'remember' | 'correct' | 'forget';

export interface MemoryReviewRequest {
  readonly action: MemoryReviewRequestAction;
  readonly targetId?: string;
  readonly permanent?: boolean;
  readonly scope?: MemoryScope;
  readonly projectKey?: string;
  readonly memoryClass?: MemoryClass;
  readonly category?: string;
  readonly title?: string;
  readonly reason?: string;
  readonly text?: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly phases?: readonly string[];
}

export interface MemoryReviewEvidence {
  readonly key: string;
  readonly scope: MemoryScope;
  readonly projectIdentity?: string;
  readonly projectKey?: string;
  readonly memoryClass?: MemoryClass;
  readonly candidateKey?: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly observedAt: string;
  readonly text?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly phases?: readonly string[];
}

export interface MemoryReviewMemorySummary {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly projectIdentity?: string;
  readonly projectKey?: string;
  readonly memoryClass?: MemoryClass;
  readonly title?: string;
  readonly reason?: string;
  readonly category: string;
  readonly text: string;
  readonly kind: MemoryKind;
  readonly memoryType: PersonalMemoryType;
  readonly state: MemoryLifecycleState;
}

export interface MemoryReviewPacket {
  readonly schema: 'comet.memory.review.v1';
  readonly language: MemoryLanguage;
  readonly projectIdentity?: string;
  readonly projectKey?: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly createdAt: string;
  readonly checkpoint: string;
  readonly category?: string;
  readonly userEvidence: readonly string[];
  readonly explicitRequest?: MemoryReviewRequest;
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
  readonly title?: string;
}

export interface MemoryReviewCreateAction extends MemoryReviewActionBase {
  readonly action: 'create';
  readonly scope: MemoryScope;
  readonly memoryClass?: MemoryClass;
  readonly category: string;
  readonly text: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly phases?: readonly string[];
}

export interface MemoryReviewUpdateAction extends MemoryReviewActionBase {
  readonly action: 'update';
  readonly targetId: string;
  readonly memoryClass?: MemoryClass;
  readonly text?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly pathPatterns?: readonly string[];
  readonly taskTypes?: readonly string[];
  readonly operations?: readonly string[];
  readonly phases?: readonly string[];
}

export interface MemoryReviewForgetAction extends MemoryReviewActionBase {
  readonly action: 'forget';
  readonly targetId: string;
  readonly permanent?: boolean;
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

/** Host adapter for invoking the installed comet-memory Skill. */
export type MemoryReviewSkillRunner = (
  packet: MemoryReviewPacket,
) => MemoryReviewActionSet | Promise<MemoryReviewActionSet>;

export interface MemoryReviewResult {
  readonly action: MemoryReviewActionKind;
  readonly persisted: boolean;
  readonly reason?: string;
  readonly notification?: string;
  readonly observation?: MemoryObservationResult;
  readonly results?: readonly MemoryReviewResult[];
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

export interface MemoryFileProjection {
  readonly content: string;
  readonly baseHash?: string;
  readonly scope: MemoryScope;
  readonly projectKey?: string;
  readonly queuedAt: string;
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
  projectFileBinding?(): MemoryProjectFileBinding | undefined;
}

export interface MemoryProjectFileBinding {
  readonly projectKey: string;
  readonly projectName: string;
  readonly path: string;
}

export interface FileMemoryRepositoryOptions {
  readonly git?: MemoryGitSync;
  readonly lockTimeoutMs?: number;
  readonly lockRetryMs?: number;
  readonly projectKey?: string;
  readonly projectName?: string;
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
  readonly language?: MemoryLanguage;
  readonly now?: () => Date;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly profileMaxChars?: number;
  readonly taskMaxChars?: number;
}

export interface PersonalMemoryProjectPolicy {
  readonly learning: boolean;
  readonly retrieval: boolean;
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
  readonly provider?: MemoryProviderStatus;
  readonly profile?: MemoryProfileStatus;
}

export interface MemoryProfileStatus {
  readonly usedChars: number;
  readonly maxChars: number;
}

export interface MemoryProviderStatus {
  readonly provider: 'local' | 'remote';
  readonly configured: boolean;
  readonly endpoint?: string;
  readonly profile?: string;
  readonly tokenConfigured?: boolean;
  readonly timeoutMs?: number;
}

export interface MemoryProviderQuery {
  readonly view: MemoryQueryView;
  readonly query: MemoryQuery;
}

export type MemoryProviderMutation =
  | {
      readonly operation:
        'remember' | 'correct' | 'forget' | 'rollback' | 'observe' | 'review' | 'feedback';
      readonly input: unknown;
    }
  | {
      readonly operation: 'experience-delta';
      readonly input: {
        readonly delta: AgentLearningDelta;
        readonly idempotencyKey: string;
      };
    };

export interface PersonalMemoryProvider {
  status(): Promise<PersonalMemoryStatus>;
  query(request: MemoryProviderQuery): Promise<MemoryProviderQueryResult>;
  apply(mutation: MemoryProviderMutation): Promise<unknown>;
}

export interface MemoryProviderConfig {
  readonly provider: 'local' | 'remote';
  readonly profileCharLimit: number;
  readonly taskContextCharLimit: number;
  readonly remote?: {
    readonly endpoint: string;
    readonly tokenEnv?: string;
    readonly profile?: string;
    readonly timeoutMs?: number;
  };
}

export interface PersonalMemoryPluginOptions {
  readonly language?: MemoryLanguage;
  /** Current repository identity used to authorize project-scoped management mutations. */
  readonly projectId?: string;
  readonly projectPolicy?: PersonalMemoryProjectPolicy;
  readonly version?: string;
  readonly cometVersionRange?: (cometVersion: string) => boolean;
  readonly runMemoryReview?: MemoryReviewSkillRunner;
  readonly onReviewNotice?: (notice: string) => void | Promise<void>;
  readonly getProviderConfig?: () => Promise<MemoryProviderConfig>;
  readonly configureProvider?: (config: MemoryProviderConfig) => Promise<void>;
  readonly listContextApplications?: (
    candidateId?: string,
  ) => Promise<readonly AgentContextApplicationRecord[]>;
  readonly createService: (context: PluginContext) => PersonalMemoryServiceLike;
}

export interface PersonalMemoryServiceLike {
  get(id: string): Promise<MemoryRecord | null>;
  remember(input: MemoryInput): Promise<MemoryRecord>;
  correct(id: string, correction: MemoryCorrection): Promise<MemoryRecord>;
  remove(id: string, options?: { readonly permanent?: boolean }): Promise<void>;
  rollback(id: string): Promise<MemoryRecord>;
  recordApplicationOutcome(
    id: string,
    outcome: AgentContextOutcomeStatus,
    options?: Omit<MemoryApplicationFeedback, 'id' | 'outcome'>,
  ): Promise<MemoryRecord | null>;
  observe(observation: MemoryObservation): Promise<MemoryObservationResult>;
  reviewAndApply(
    packet: MemoryReviewPacket,
    actions: MemoryReviewActionSet,
  ): Promise<MemoryReviewResult>;
  retrieve(query: MemoryQuery): Promise<MemoryRetrieval>;
  manage(query?: MemoryQuery): Promise<MemoryManagementView>;
  status(): Promise<PersonalMemoryStatus>;
  testProvider?(): Promise<{ readonly ok: boolean; readonly message?: string }>;
  sync(): Promise<MemorySyncResult>;
  remote?(): Promise<string | null>;
  configureRemote?(url: string): Promise<void>;
  setLearningEnabled?(enabled: boolean): Promise<void>;
  setRetrievalEnabled?(enabled: boolean): Promise<void>;
  pauseProjectLearning?(projectKey: string, paused: boolean): Promise<void>;
  pauseProjectRetrieval?(projectKey: string, paused: boolean): Promise<void>;
  query?(request: MemoryProviderQuery): Promise<MemoryProviderQueryResult>;
  apply?(mutation: MemoryProviderMutation): Promise<unknown>;
}

export type PersonalMemoryPluginDescriptorFactory = (
  options: PersonalMemoryPluginOptions,
) => PluginDescriptor;
