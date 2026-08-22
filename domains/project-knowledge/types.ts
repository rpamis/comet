import type {
  PluginContext,
  PluginDescriptor,
  PluginDiagnostic,
  PluginModule,
} from '../comet-plugin/index.js';
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
import type { ProjectKnowledgeUnit } from './units.js';
import type { ProjectKnowledgeChangedHint, ProjectKnowledgeSemanticReviewer } from './learning.js';

export type ProjectKnowledgeDocumentKind =
  | 'native-spec'
  | 'native-archive'
  | 'classic-spec'
  | 'classic-archive'
  | 'superpowers';

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
  readonly unit?: ProjectKnowledgeUnit;
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
  readonly state?: ProjectKnowledgeRecordState;
  readonly authority?: ProjectKnowledgeRecordAuthority;
  readonly limit?: number;
}

export interface ProjectKnowledgeGetRequest {
  readonly kind: 'get';
  readonly id: string;
  readonly projectId?: string;
}

export type ProjectKnowledgeQueryRequest =
  | ProjectKnowledgeSearchRequest
  | ProjectKnowledgeListRequest
  | ProjectKnowledgeGetRequest;

export interface ProjectKnowledgeSearchHit {
  readonly record: ProjectKnowledgeRecord;
  readonly score?: number;
}

export interface ProjectKnowledgeSearchResult {
  readonly kind: 'search';
  readonly hits: readonly ProjectKnowledgeSearchHit[];
  readonly truncated: boolean;
}

export interface ProjectKnowledgeListResult {
  readonly kind: 'list';
  readonly records: readonly ProjectKnowledgeRecord[];
  readonly truncated: boolean;
}

export interface ProjectKnowledgeGetResult {
  readonly kind: 'get';
  readonly record: ProjectKnowledgeRecord | null;
}

export type ProjectKnowledgeQueryResult =
  | ProjectKnowledgeSearchResult
  | ProjectKnowledgeListResult
  | ProjectKnowledgeGetResult;

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
  readonly conclusions?: readonly ProjectKnowledgeRecordConclusion[];
  readonly relations?: readonly ProjectKnowledgeRecordRelation[];
  readonly verification?: readonly ProjectKnowledgeRecordVerification[];
  readonly updatedAt: string;
}

export interface ProjectKnowledgeRetireMutation {
  readonly kind: 'retire';
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

export type ProjectKnowledgeMutation =
  | ProjectKnowledgeUpsertMutation
  | ProjectKnowledgeCorrectMutation
  | ProjectKnowledgeRetireMutation
  | ProjectKnowledgeRefreshMutation;

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

export interface ProjectKnowledgeLegacyProvider {
  retrieve(query: ProjectKnowledgeQuery): Promise<readonly ProjectKnowledgeResult[]>;
}

export interface ProjectKnowledgeProviderAdapter {
  readonly legacy: ProjectKnowledgeLegacyProvider;
  readonly provider: ProjectKnowledgeProvider;
}

type LegacyProviderMustNotSatisfyMainContract =
  ProjectKnowledgeLegacyProvider extends ProjectKnowledgeProvider ? false : true;
const legacyProviderMustNotSatisfyMainContract: LegacyProviderMustNotSatisfyMainContract = true;

type AdapterProviderMustSatisfyMainContract =
  ProjectKnowledgeProviderAdapter['provider'] extends ProjectKnowledgeProvider ? true : false;
const adapterProviderMustSatisfyMainContract: AdapterProviderMustSatisfyMainContract = true;

void legacyProviderMustNotSatisfyMainContract;
void adapterProviderMustSatisfyMainContract;

export interface ProjectKnowledgeCorpusOptions {
  readonly projectRoot: string;
  readonly reportDiagnostic?: ProjectKnowledgeDiagnosticReporter;
}

export interface ProjectKnowledgeProviderOptions extends ProjectKnowledgeCorpusOptions {
  readonly corpus: readonly ProjectKnowledgeDocument[];
  /** Recent lifecycle hints used to bound the ripgrep supplement. */
  readonly changedPaths?: readonly string[];
}

export interface ProjectKnowledgePluginOptions {
  readonly projectRoot: string;
  readonly knowledgeConfig: WorkflowKnowledgeProjectConfig;
  readonly language?: MemoryLanguage;
  readonly version?: string;
  readonly cometVersionRange?: (cometVersion: string) => boolean;
  readonly cacheRoot?: string;
  readonly semanticReviewer?: ProjectKnowledgeSemanticReviewer;
  /** Host-owned boundary for review work that must not delay workflow events. */
  readonly runReviewInBackground?: (task: () => Promise<void>) => void | Promise<void>;
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
    readonly sectionCount: number;
    readonly updatedAt?: string;
    readonly lastQueryMs?: number;
    readonly lastCandidateCount?: number;
    readonly channels: readonly string[];
    readonly unitCount?: number;
    readonly activeUnitCount?: number;
    readonly draftUnitCount?: number;
    readonly retiredUnitCount?: number;
    readonly relationCount?: number;
    readonly units?: readonly ProjectKnowledgeUnit[];
    readonly changedHints?: readonly ProjectKnowledgeChangedHint[];
  };
  readonly retrieval: string;
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
