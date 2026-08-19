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
  readonly terms: readonly string[];
  readonly strongTerms: readonly string[];
  readonly remoteQuery: string;
}

export interface ProjectKnowledgeResult {
  readonly content: string;
  readonly source: string;
  readonly title?: string;
  readonly score?: number;
  readonly document?: ProjectKnowledgeDocument;
}

export interface ProjectKnowledgeDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type ProjectKnowledgeDiagnosticReporter = (diagnostic: ProjectKnowledgeDiagnostic) => void;

export interface ProjectKnowledgeProvider {
  retrieve(query: ProjectKnowledgeQuery): Promise<readonly ProjectKnowledgeResult[]>;
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
}

export interface ProjectKnowledgePluginDescriptorFactory {
  (options: ProjectKnowledgePluginOptions): PluginDescriptor;
}

export interface ProjectKnowledgePluginFactoryResult {
  readonly descriptor: PluginDescriptor;
  readonly createModule: (context: PluginContext) => Promise<PluginModule>;
}

export type { PluginDiagnostic, WorkflowKnowledgeProjectConfig, WorkflowKnowledgeProvider };
