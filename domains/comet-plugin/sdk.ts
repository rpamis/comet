/** Public plugin contracts; Comet's built-in assembly lives in ./comet.js. */
export { definePluginCapability, definePlugin, createPluginClient } from './plugin-capabilities.js';
export type {
  PluginCapability,
  PluginCapabilityOptions,
  PluginCapabilities,
  PluginCapabilityModule,
  DefinePluginOptions,
  TypedPluginDescriptor,
  PluginClient,
} from './plugin-capabilities.js';
export {
  PluginRuntime,
  PluginRuntimeError,
  MemoryPluginStateStore,
  MemoryPluginStorageStore,
  JsonPluginStateStore,
} from './plugin-runtime.js';
export type { PluginRuntimeOptions } from './plugin-runtime.js';
export type {
  PluginActionSource,
  PluginContext,
  PluginContextRequest,
  PluginDashboardContext,
  PluginDashboardContribution,
  PluginDashboardPage,
  PluginDescriptor,
  PluginDiagnostic,
  PluginKind,
  PluginModule,
  PluginRecord,
  PluginScope,
  PluginScopeContext,
  PluginState,
  PluginStateFile,
  PluginStateStore,
  PluginStatus,
  PluginStorage,
  PluginStorageStore,
  PluginView,
} from './types.js';
export {
  AGENT_EXPERIENCE_SCHEMA,
  AgentExperienceJournal,
  MemoryAgentExperienceJournalStore,
  StorageAgentExperienceJournalStore,
} from '../agent-learning/index.js';
export type {
  AgentContextCandidate,
  AgentContextSelectors,
  AgentContextSourceRef,
  AgentContextVerification,
  AgentExperienceEvent,
  AgentExperienceEventType,
  AgentExperienceJournalStore,
  AgentExperienceJournalStorage,
  AgentExperienceJournalState,
  AgentLearningDelta,
} from '../agent-learning/index.js';
export type {
  AgentLearningConsolidationRequest,
  AgentReflectionOutput,
  AgentReflectionRequest,
} from '../agent-learning/index.js';
