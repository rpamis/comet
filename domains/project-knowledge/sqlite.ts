import type { PathLike } from 'node:fs';
import { createRequire } from 'node:module';

type SqliteModule = typeof import('node:sqlite');

export type ProjectKnowledgeDatabase = import('node:sqlite').DatabaseSync;

const requireModule = createRequire(import.meta.url);
const SQLITE_EXPERIMENTAL_WARNING =
  'SQLite is an experimental feature and might change at any time';

let databaseConstructor: SqliteModule['DatabaseSync'] | undefined;

function loadDatabaseConstructor(): SqliteModule['DatabaseSync'] {
  if (databaseConstructor) return databaseConstructor;
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = warning instanceof Error ? warning.message : warning;
    if (message.startsWith(SQLITE_EXPERIMENTAL_WARNING)) return;
    Reflect.apply(originalEmitWarning, process, [warning, ...args]);
  }) as typeof process.emitWarning;
  try {
    databaseConstructor = (requireModule('node:sqlite') as SqliteModule).DatabaseSync;
    return databaseConstructor;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

export function openProjectKnowledgeDatabase(
  databasePath: PathLike,
  options?: import('node:sqlite').DatabaseSyncOptions,
): ProjectKnowledgeDatabase {
  const Database = loadDatabaseConstructor();
  return options === undefined ? new Database(databasePath) : new Database(databasePath, options);
}
