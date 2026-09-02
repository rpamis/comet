import type {
  PluginContext,
  PluginDescriptor,
  PluginDiagnostic,
  PluginModule,
} from '../comet-plugin/index.js';
import type {
  AgentLearningDelta,
  AgentContextApplicationRecord,
  AgentContextOutcomeStatus,
} from '../agent-learning/index.js';
import type {
  WorkflowKnowledgeProjectConfig,
  WorkflowKnowledgeProvider,
} from '../workflow-contract/types.js';
import type { MemoryLanguage } from '../comet-memory/types.js';
import type {
  ProjectKnowledgeRecord,
  ProjectKnowledgeRecordAuthority,
  ProjectKnowledgeRecordConclusion,
  ProjectKnowledgeRecordRelation,
  ProjectKnowledgeRecordState,
  ProjectKnowledgeRecordType,
  ProjectKnowledgeRecordVerification,
} from './records.js';
import type { ProjectKnowledgeSemanticReviewer } from './learning.js';

export type ProjectKnowledgeDocumentKind =
  'native-spec' | 'native-archive' | 'classic-spec' | 'classic-archive' | 'superpowers' | 'custom';

export interface ProjectKnowledgeDocument {
  readonly absolutePath: string;
  readonly source: string;
  readonly kind: ProjectKnowledgeDocumentKind;
  readonly archivedAt?: string;
}

export interface ProjectKnowledgeQuery {
  readonly task: string;
  readonly path?: string;
  readonly phase?: string;
  readonly operation?: string;
  readonly terms: readonly string[];
  readonly strongTerms: readonly string[];
  readonly phraseTerms: readonly string[];
  readonly weakTerms: readonly string[];
  readonly remoteQuery: string;
}

export interface ProjectKnowledgeResult {
  readonly content: string;
  readonly source: string;
  readonly title?: string;
  readonly score?: number;
  readonly document?: ProjectKnowledgeDocument;
  readonly record?: ProjectKnowledgeRecord;
}

export interface ProjectKnowledgeDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type ProjectKnowledgeDiagnosticReporter = (diagnostic: ProjectKnowledgeDiagnostic) => void;

export interface ProjectKnowledgeStatus {
  readonly provider: WorkflowKnowledgeProvider;
  readonly healthy: boolean;
  readonly writable: boolean;
  readonly recordCount?: number;
  readonly updatedAt?: string;
  readonly diagnostics: readonly ProjectKnowledgeDiagnostic[];
}

export interface ProjectKnowledgeSearchRequest {
  readonly kind: 'search';
  readonly query: ProjectKnowledgeQuery;
  readonly limit?: number;
}

export interface ProjectKnowledgeListRequest {
  readonly kind: 'list';
  readonly projectId?: string;
  readonly type?: ProjectKnowledgeRecordType;
  readonly state?: ProjectKnowledgeRecordState | 'all';
  readonly authority?: ProjectKnowledgeRecordAuthority;
  readonly limit?: number;
}

export interface ProjectKnowledgeGetRequest {
  readonly kind: 'get';
  readonly id: string;
  readonly projectId?: string;
}

export interface ProjectKnowledgeManifestRequest {
  readonly kind: 'manifest';
  readonly projectId?: string;
  readonly state?: ProjectKnowledgeRecordState | 'all';
  readonly limit?: number;
}

export interface ProjectKnowledgeExpandRequest {
  readonly kind: 'expand';
  readonly id: string;
  readonly projectId?: string;
}

export type ProjectKnowledgeQueryRequest =
  | ProjectKnowledgeSearchRequest
  | ProjectKnowledgeListRequest
  | ProjectKnowledgeGetRequest
  | ProjectKnowledgeManifestRequest
  | ProjectKnowledgeExpandRequest;

export interface ProjectKnowledgeSearchHit {
  readonly record: ProjectKnowledgeRecord;
  readonly score?: number;
}

export interface ProjectKnowledgeSearchResult {
  readonly kind: 'search';
  readonly hits: readonly ProjectKnowledgeSearchHit[];
  readonly results: readonly ProjectKnowledgeResult[];
  readonly records: readonly ProjectKnowledgeRecord[];
  readonly truncated: boolean;
  readonly diagnostics: readonly ProjectKnowledgeDiagnostic[];
}

export interface ProjectKnowledgeListResult {
  readonly kind: 'list';
  readonly records: readonly ProjectKnowledgeRecord[];
  readonly truncated: boolean;
  readonly diagnostics: readonly ProjectKnowledgeDiagnostic[];
}

export interface ProjectKnowledgeGetResult {
  readonly kind: 'get';
  readonly record: ProjectKnowledgeRecord | null;
  readonly diagnostics: readonly ProjectKnowledgeDiagnostic[];
}

export interface ProjectKnowledgeManifestItem {
  readonly id: string;
  readonly memoryType: 'project-model' | 'project-policy';
  readonly type: ProjectKnowledgeRecordType;
  readonly state: ProjectKnowledgeRecordState;
  readonly authority: ProjectKnowledgeRecordAuthority;
  readonly title: string;
  readonly summary: string;
  readonly applicablePaths: readonly string[];
  readonly operations: readonly string[];
  readonly phases: readonly string[];
  readonly sourceTypes: readonly string[];
  readonly verification: readonly ProjectKnowledgeRecordVerification[];
}

export interface ProjectKnowledgeManifestResult {
  readonly kind: 'manifest';
  readonly items: readonly ProjectKnowledgeManifestItem[];
  readonly truncated: boolean;
  readonly diagnostics: readonly ProjectKnowledgeDiagnostic[];
}

export interface ProjectKnowledgeExpandResult {
  readonly kind: 'expand';
  readonly record: ProjectKnowledgeRecord | null;
  readonly diagnostics: readonly ProjectKnowledgeDiagnostic[];
}

export type ProjectKnowledgeQueryResult =
  | ProjectKnowledgeSearchResult
  | ProjectKnowledgeListResult
  | ProjectKnowledgeGetResult
  | ProjectKnowledgeManifestResult
  | ProjectKnowledgeExpandResult;

export interface ProjectKnowledgeUpsertMutation {
  readonly kind: 'upsert';
  readonly record: ProjectKnowledgeRecord;
}

export interface ProjectKnowledgeCorrectMutation {
  readonly kind: 'correct';
  readonly id: string;
  readonly projectId: string;
  readonly title?: string;
  readonly summary?: string;
  readonly applicablePaths?: readonly string[];
  readonly operations?: readonly string[];
  readonly phases?: readonly string[];
  readonly conclusions?: readonly ProjectKnowledgeRecordConclusion[];
  readonly relations?: readonly ProjectKnowledgeRecordRelation[];
  readonly verification?: readonly ProjectKnowledgeRecordVerification[];
  readonly updatedAt: string;
}

export interface ProjectKnowledgeSupersedeMutation {
  readonly kind: 'supersede';
  readonly id: string;
  readonly projectId: string;
  readonly updatedAt: string;
  readonly reason?: string;
}

export interface ProjectKnowledgeRefreshMutation {
  readonly kind: 'refresh';
  readonly id?: string;
  readonly projectId?: string;
}

export interface ProjectKnowledgeFeedbackMutation {
  readonly kind: 'feedback';
  readonly id: string;
  readonly projectId: string;
  readonly outcome: AgentContextOutcomeStatus;
  readonly previousOutcome?: AgentContextOutcomeStatus;
  readonly applicationId?: string;
  readonly revision?: number;
  readonly idempotencyKey?: string;
  readonly updatedAt: string;
}

export interface ProjectKnowledgeVerifyMutation {
  readonly kind: 'verify';
  readonly projectId: string;
  readonly commands: readonly string[];
  readonly updatedAt: string;
}

export interface ProjectKnowledgeExperienceDeltaMutation {
  readonly kind: 'experience-delta';
  readonly delta: AgentLearningDelta;
  readonly idempotencyKey: string;
  readonly updatedAt: string;
}

export type ProjectKnowledgeMutation =
  | ProjectKnowledgeUpsertMutation
  | ProjectKnowledgeCorrectMutation
  | ProjectKnowledgeSupersedeMutation
  | ProjectKnowledgeRefreshMutation
  | ProjectKnowledgeFeedbackMutation
  | ProjectKnowledgeVerifyMutation
  | ProjectKnowledgeExperienceDeltaMutation;

export interface ProjectKnowledgeApplyResult {
  readonly kind: ProjectKnowledgeMutation['kind'];
  readonly changed: boolean;
  readonly record?: ProjectKnowledgeRecord | null;
  readonly records?: readonly ProjectKnowledgeRecord[];
  readonly diagnostics: readonly ProjectKnowledgeDiagnostic[];
}

export interface ProjectKnowledgeProvider {
  status(): Promise<ProjectKnowledgeStatus>;
  query(request: ProjectKnowledgeQueryRequest): Promise<ProjectKnowledgeQueryResult>;
  apply(mutation: ProjectKnowledgeMutation): Promise<ProjectKnowledgeApplyResult>;
}

export interface ProjectKnowledgeCorpusOptions {
  readonly projectRoot: string;
  readonly reportDiagnostic?: ProjectKnowledgeDiagnosticReporter;
}

export interface ProjectKnowledgeProviderOptions extends ProjectKnowledgeCorpusOptions {
  readonly corpus: readonly ProjectKnowledgeDocument[];
}

export interface ProjectKnowledgePluginOptions {
  readonly projectRoot: string;
  readonly knowledgeConfig: WorkflowKnowledgeProjectConfig;
  readonly language?: MemoryLanguage;
  readonly version?: string;
  readonly cometVersionRange?: (cometVersion: string) => boolean;
  readonly cacheRoot?: string;
  readonly semanticReviewer?: ProjectKnowledgeSemanticReviewer;
  readonly updateKnowledgeConfig?: (config: WorkflowKnowledgeProjectConfig) => void | Promise<void>;
  readonly listContextApplications?: (
    candidateId?: string,
  ) => Promise<readonly AgentContextApplicationRecord[]>;
}

export interface ProjectKnowledgeDashboardRemoteSummary {
  readonly endpoint: string;
  readonly tokenEnv?: string;
  readonly tokenConfigured: boolean;
  readonly scope?: string;
  readonly timeoutMs: number;
}

export interface ProjectKnowledgeDashboardDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface ProjectKnowledgeDashboardSnapshot {
  readonly provider: WorkflowKnowledgeProvider;
  readonly configured: boolean;
  readonly remote?: ProjectKnowledgeDashboardRemoteSummary;
  readonly local?: {
    readonly available: boolean;
    readonly repositoryId: string;
    readonly workspaceId: string;
    readonly sourceCount: number;
    readonly sources: readonly {
      readonly source: string;
      readonly kind: ProjectKnowledgeDocument['kind'];
      readonly archivedAt?: string;
      readonly updatedAt: string;
    }[];
    readonly sectionCount: number;
    readonly updatedAt?: string;
    readonly channels: readonly string[];
  };
  readonly retrieval: string;
  readonly status?: ProjectKnowledgeStatus;
  readonly records?: readonly (ProjectKnowledgeRecord & {
    readonly contextApplicationCount?: number;
    readonly lastApplication?: AgentContextApplicationRecord;
    readonly applicationHistory?: readonly AgentContextApplicationRecord[];
  })[];
  readonly counts?: {
    readonly trial: number;
    readonly proven: number;
    readonly enforced: number;
    readonly superseded: number;
  };
  readonly manifestPreview?: readonly {
    readonly id: string;
    readonly memoryType: 'project-model' | 'project-policy';
    readonly state: ProjectKnowledgeRecordState;
    readonly title: string;
    readonly summary: string;
    readonly whyApplied: string;
    readonly applicationCount: number;
    readonly successCount: number;
    readonly failureCount: number;
    readonly delivery: AgentContextApplicationRecord['delivery'];
    readonly appliedAt: string;
    readonly outcome?: AgentContextOutcomeStatus;
    readonly lastApplication: AgentContextApplicationRecord;
  }[];
  readonly diagnostics: readonly ProjectKnowledgeDashboardDiagnostic[];
}

export interface ProjectKnowledgeDashboardSnapshotOptions {
  readonly config: WorkflowKnowledgeProjectConfig;
  readonly language?: MemoryLanguage;
  readonly env?: NodeJS.ProcessEnv;
}

export interface ProjectKnowledgePluginDescriptorFactory {
  (options: ProjectKnowledgePluginOptions): PluginDescriptor;
}

export interface ProjectKnowledgePluginFactoryResult {
  readonly descriptor: PluginDescriptor;
  readonly createModule: (context: PluginContext) => Promise<PluginModule>;
}

export type { PluginDiagnostic, WorkflowKnowledgeProjectConfig, WorkflowKnowledgeProvider };
