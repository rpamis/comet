import { createRequire } from 'node:module';
import type { PathLike } from 'node:fs';

const requireModule = createRequire(import.meta.url);
let Database: typeof import('node:sqlite').DatabaseSync | undefined;

/** 延迟加载本地 SQLite，避免未使用数据库的命令加载实验模块。 */
export function openSqliteDatabase(
  file: PathLike,
  options?: import('node:sqlite').DatabaseSyncOptions,
): import('node:sqlite').DatabaseSync {
  if (!Database) {
    const emitWarning = process.emitWarning;
    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      if (
        String(warning instanceof Error ? warning.message : warning).startsWith(
          'SQLite is an experimental feature and might change at any time',
        )
      )
        return;
      Reflect.apply(emitWarning, process, [warning, ...args]);
    }) as typeof process.emitWarning;
    try {
      Database = (requireModule('node:sqlite') as typeof import('node:sqlite')).DatabaseSync;
    } finally {
      process.emitWarning = emitWarning;
    }
  }
  return options === undefined ? new Database(file) : new Database(file, options);
}
