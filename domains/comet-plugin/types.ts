import type {
  AgentContextCandidate,
  AgentLearningConsolidationRequest,
  AgentReflectionOutput,
  AgentReflectionRequest,
  AgentExperienceEvent,
  AgentExperienceEventType,
} from '../agent-learning/index.js';

export type PluginKind = 'first-party' | 'third-party';
export type PluginScope = 'user' | 'project';
export type PluginStatus = 'enabled' | 'disabled' | 'uninstalled';
export type PluginActionSource = 'user' | 'system';

export interface PluginScopeContext {
  readonly scope: PluginScope;
  readonly projectId?: string;
}

export interface PluginContextRequest {
  readonly task: string;
  readonly path?: string;
  readonly phase?: string;
  readonly operation?: string;
  readonly sessionId?: string;
  readonly charBudget?: number;
  readonly projectId?: string;
}

export interface PluginDashboardContext {
  readonly projectId: string;
  readonly invoke: (capability: string, input?: unknown) => Promise<unknown>;
}

export interface PluginDashboardContribution {
  readonly id: string;
  readonly label: string;
  readonly route: string;
  readonly load?: (context: PluginDashboardContext) => Promise<unknown>;
}

export interface PluginDashboardPage extends PluginDashboardContribution {
  readonly pluginId: string;
}

export interface PluginDiagnostic {
  readonly pluginId: string;
  readonly code: 'missing' | 'incompatible' | 'execution-failed';
  readonly phase: 'load' | 'event' | 'context' | 'dashboard' | 'invoke';
  readonly source?: string;
  readonly message: string;
}

export interface PluginStorage {
  read(): Promise<unknown | null>;
  write(value: unknown): Promise<void>;
  withLock?<T>(operation: () => Promise<T>): Promise<T>;
}

export interface PluginStorageStore {
  open(pluginId: string, scope: PluginScope, projectId?: string): Promise<PluginStorage>;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly cometVersion: string;
  readonly scope: PluginScope;
  readonly projectId?: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly storage: PluginStorage;
  readonly reportDiagnostic: (diagnostic: Omit<PluginDiagnostic, 'pluginId'>) => void;
}

export interface PluginModule {
  readonly events?: readonly AgentExperienceEventType[];
  /** First-party learning path; Reflection is pure and returns normalized Deltas. */
  readonly reflect?: (
    request: AgentReflectionRequest,
  ) => AgentReflectionOutput | Promise<AgentReflectionOutput>;
  /** Provider-owned durable consolidation for a single idempotent Delta. */
  readonly consolidate?: (request: AgentLearningConsolidationRequest) => void | Promise<void>;
  /** Event callback for non-learning plugins. */
  readonly onEvent?: (event: AgentExperienceEvent) => void | Promise<void>;
  readonly provideContext?: (
    request: PluginContextRequest,
  ) =>
    | readonly AgentContextCandidate[]
    | AgentContextCandidate
    | null
    | Promise<readonly AgentContextCandidate[] | AgentContextCandidate | null>;
  readonly resolveContext?: (
    id: string,
    request: PluginContextRequest,
  ) => AgentContextCandidate | null | Promise<AgentContextCandidate | null>;
  readonly dashboard?: PluginDashboardContribution;
  readonly invoke?: (capability: string, input: unknown) => unknown | Promise<unknown>;
  readonly dispose?: () => void | Promise<void>;
}

export interface PluginDescriptor {
  readonly id: string;
  readonly kind: PluginKind;
  readonly version: string;
  readonly scopes: readonly PluginScope[];
  readonly compatible: (cometVersion: string) => boolean;
  readonly create: (context: PluginContext) => PluginModule | Promise<PluginModule>;
}

export interface PluginRecord {
  readonly id: string;
  readonly version: string;
  readonly status: PluginStatus;
  readonly explicitRemoval: boolean;
  readonly disabledProjects: readonly string[];
  readonly updatedAt: string;
}

export interface PluginState {
  readonly plugins: readonly PluginRecord[];
}

export interface PluginStateStore {
  read(): Promise<PluginState>;
  write(state: PluginState): Promise<void>;
}

export interface PluginStateFile {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}

export interface PluginView extends PluginRecord {
  readonly kind: PluginKind | null;
  readonly scopes: readonly PluginScope[];
}
