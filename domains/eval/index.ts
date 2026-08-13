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

export function resolveRepositoryEvalWorkspace(): RepositoryEvalWorkspace {
  const layout = readRepositoryLayout();
  void layout;
  return {
    root: resolveRepositoryPath('eval'),
    localRoot: resolveRepositoryPath('eval/local'),
    langsmithRoot: resolveRepositoryPath('eval/langsmith'),
  };
}
