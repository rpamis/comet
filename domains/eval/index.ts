import {
  readRepositoryLayout,
  resolveRepositoryPath,
} from '../../platform/paths/repository-layout.js';

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
