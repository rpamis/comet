import {
  defaultProjectKnowledgeStorageRoot,
  resolveProjectKnowledgeStorageLocation,
  type ProjectKnowledgeStorageLocation,
} from './project-knowledge-storage.js';

export type ProjectKnowledgeCacheLocation = ProjectKnowledgeStorageLocation;

export const defaultProjectKnowledgeCacheRoot = defaultProjectKnowledgeStorageRoot;

export function resolveProjectKnowledgeCacheLocation(
  projectRoot: string,
  cacheRoot = defaultProjectKnowledgeCacheRoot(),
): ProjectKnowledgeCacheLocation {
  return resolveProjectKnowledgeStorageLocation(projectRoot, cacheRoot);
}
