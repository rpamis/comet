import os from 'node:os';
import path from 'node:path';

import { resolveStableProjectId, stableProjectId } from './project-identity.js';

export interface ProjectKnowledgeStorageLocation {
  readonly repositoryId: string;
  readonly workspaceId: string;
  readonly databasePath: string;
}

export function defaultProjectKnowledgeStorageRoot(): string {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches');
  return process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
}

export function resolveProjectKnowledgeStorageLocation(
  projectRoot: string,
  storageRoot = defaultProjectKnowledgeStorageRoot(),
): ProjectKnowledgeStorageLocation {
  const root = path.resolve(projectRoot);
  const repositoryId = resolveStableProjectId(root);
  const workspaceId = stableProjectId(`workspace:${root}`);
  const productDirectory = process.platform === 'linux' ? 'comet' : 'Comet';
  return {
    repositoryId,
    workspaceId,
    databasePath: path.join(
      storageRoot,
      productDirectory,
      'project-knowledge',
      repositoryId,
      'knowledge.sqlite',
    ),
  };
}
