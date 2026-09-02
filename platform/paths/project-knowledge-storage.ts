import os from 'node:os';
import path from 'node:path';

import { resolveStableProjectId, stableProjectId } from './project-identity.js';

export interface ProjectKnowledgeStorageLocation {
  readonly repositoryId: string;
  readonly workspaceId: string;
  readonly databasePath: string;
}

export function defaultProjectKnowledgeStorageRoot(homeDirectory?: string): string {
  const home = homeDirectory ?? os.homedir();
  if (process.platform === 'win32') {
    return homeDirectory === undefined && process.env.LOCALAPPDATA
      ? process.env.LOCALAPPDATA
      : path.join(home, 'AppData', 'Local');
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches');
  return homeDirectory === undefined && process.env.XDG_CACHE_HOME
    ? process.env.XDG_CACHE_HOME
    : path.join(home, '.cache');
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
