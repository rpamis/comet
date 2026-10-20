import {
  readRepositoryLayout,
  resolveRepositoryPath,
} from '../../platform/paths/repository-layout.js';

export {
  previewEvalRun,
  normalizeEvalRunConfig,
  evalEnvironmentChecks,
  EVAL_AGENT_IDS,
} from './eval-run-preview.js';
export {
  startEvalRun,
  repairManagedEvalRun,
  requestStopEvalRun,
  reconcileEvalRun,
  collectEvalRuns,
} from './eval-run-manager.js';
export {
  readEvalRun,
  readEvalCasePage,
  readEvalCase,
  listEvalRuns,
  setEvalBaseline,
  clearEvalBaseline,
  compareEvalRuns,
  readEvalArtifact,
  EvalRunError,
} from './eval-run-store.js';
export type { EvalRunPreview } from './eval-run-preview.js';
export type { EvalRunConfig, EvalRunDetail, EvalRunComparison } from './eval-run-types.js';
export type { EvalRunSummary } from './eval-run-types.js';
export {
  listEvalRunSources,
  listEvalArchiveSources,
  readEvalRunSummary,
  summarizeEvalRun,
} from './eval-run-sources.js';
export { readEvalBaselines } from './eval-run-store.js';
export { resolveEvalExecution } from './eval-execution-config.js';
export {
  beginCliEvalTracking,
  finishCliEvalTracking,
  registerCliEvalRun,
  updateManagedEvalRun,
} from './eval-run-manager.js';

export interface RepositoryEvalWorkspace {
  root: string;
  localRoot: string;
  langsmithRoot: string;
}

export {
  canonicalPath,
  isPathWithin,
  resolveEvalContext,
  type EvalManifestSource,
  type EvalTargetOptions,
  type ResolvedEvalContext,
} from './standalone-context.js';
export {
  collectStandaloneTasks,
  loadInstalledCustomAgent,
  validateInlineTask,
  type InstalledCustomAgent,
  type StaticCollectOptions,
} from './standalone-static-collect.js';
export { loadUserEvalEnvironment } from './user-environment.js';
export { readUserEvalSettings, saveUserEvalSettings } from './eval-user-settings.js';
export {
  previewWorkflowApplicationEval,
  prepareWorkflowApplicationEval,
  readWorkflowApplicationEvalResult,
  runWorkflowApplicationEval,
  normalizeApplicationEvalSettings,
} from './application-eval.js';
export type {
  ApplicationEvalTaskSet,
  ApplicationEvalSettings,
  ApplicationEvalPreview,
  PreparedApplicationEval,
  ApplicationEvalResult,
} from './application-eval.js';
export {
  runSemanticMemoryEval,
  SEMANTIC_MEMORY_EVAL_SCHEMA,
  SEMANTIC_MEMORY_FAILURE_CATEGORIES,
  type SemanticMemoryEvalCase,
  type SemanticMemoryEvalMetrics,
  type SemanticMemoryEvalReport,
} from './semantic-memory-eval.js';
export {
  SEMANTIC_MEMORY_EVAL_CONFIG_HASH,
  SEMANTIC_MEMORY_EVAL_CONFIG_VERSION,
  SEMANTIC_MEMORY_EVAL_THRESHOLDS,
} from './semantic-memory-eval-config.js';
export {
  AGENT_LEARNING_EVAL_SCHEMA,
  runAgentLearningEval,
  type AgentLearningEvalReport,
  type AgentLearningFormationEvalCase,
  type AgentLearningFormationCaseId,
  type AgentLearningRetrievalEvalMetrics,
} from './agent-learning-eval.js';

export function resolveRepositoryEvalWorkspace(): RepositoryEvalWorkspace {
  const layout = readRepositoryLayout();
  void layout;
  return {
    root: resolveRepositoryPath('eval'),
    localRoot: resolveRepositoryPath('eval/local'),
    langsmithRoot: resolveRepositoryPath('eval/langsmith'),
  };
}

export { listEvalPresets, saveEvalPreset, deleteEvalPreset } from './eval-run-presets.js';
export { readEvalRetrySelection } from './eval-run-retry.js';
export {
  listEvalArchives,
  readEvalArchive,
  readEvalArchiveManifest,
  archiveEvalDetail,
  archiveEvalError,
  readEvalArchiveFile,
  evalArchiveRoot,
  evalArchiveRunId,
} from './eval-archives.js';
export type { EvalArchiveObservation, EvalArchive } from './eval-archives.js';
