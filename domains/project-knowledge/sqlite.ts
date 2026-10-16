import type { PathLike } from 'node:fs';
import { openSqliteDatabase } from '../../platform/fs/sqlite.js';

export type ProjectKnowledgeDatabase = import('node:sqlite').DatabaseSync;

export function openProjectKnowledgeDatabase(
  databasePath: PathLike,
  options?: import('node:sqlite').DatabaseSyncOptions,
): ProjectKnowledgeDatabase {
  return openSqliteDatabase(databasePath, options);
}
