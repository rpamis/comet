import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { openSqliteDatabase } from '../fs/sqlite.js';
import { runtimeObservabilityDatabasePath as databasePath } from './runtime-observability-store.js';
import { observeRuntimeSpan } from './runtime-trace.js';
import { withCometRuntimeMetrics } from './runtime-metrics.js';

export interface RuntimePerformanceRecord {
  id: string;
  workflow: 'native' | 'classic';
  kind: 'command' | 'check';
  command: string;
  occurredAt: string;
  durationMs: number;
  exitCode: number;
  gitCommands: number;
  gitDurationMs: number;
}
const RETENTION_MS = 7 * 86400000;
const MAX_RECORDS = 10000;

/** 本地诊断记录有界保存；不包含命令参数、输出或环境变量。 */
export async function recordRuntimePerformance(
  projectRoot: string,
  record: Omit<RuntimePerformanceRecord, 'id'>,
): Promise<void> {
  const db = openSqliteDatabase(await databasePath(projectRoot, true));
  try {
    db.exec(`PRAGMA busy_timeout=25; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS samples (
        id TEXT PRIMARY KEY, workflow TEXT NOT NULL, kind TEXT NOT NULL, command TEXT NOT NULL,
        occurredAt TEXT NOT NULL, durationMs REAL NOT NULL, exitCode INTEGER NOT NULL,
        gitCommands INTEGER NOT NULL, gitDurationMs REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS samples_time ON samples(occurredAt);
      BEGIN IMMEDIATE;`);
    db.prepare('DELETE FROM samples WHERE occurredAt < ?').run(
      new Date(Date.now() - RETENTION_MS).toISOString(),
    );
    db.prepare('INSERT INTO samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      randomUUID(),
      record.workflow,
      record.kind,
      record.command,
      record.occurredAt,
      record.durationMs,
      record.exitCode,
      record.gitCommands,
      record.gitDurationMs,
    );
    db.prepare(
      'DELETE FROM samples WHERE id IN (SELECT id FROM samples ORDER BY occurredAt DESC, rowid DESC LIMIT -1 OFFSET ?)',
    ).run(MAX_RECORDS);
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

export async function readRuntimePerformanceRecords(
  projectRoot: string,
  sampleLimit = 5000,
): Promise<{
  records: RuntimePerformanceRecord[];
  truncated: boolean;
  sampleLimit: number;
  days: number;
}> {
  const empty = {
    records: [] as RuntimePerformanceRecord[],
    truncated: false,
    sampleLimit,
    days: 7,
  };
  let file: string;
  try {
    file = await databasePath(projectRoot, false);
    await fs.access(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty;
    throw error;
  }
  const db = openSqliteDatabase(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=25');
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='samples'").get())
      return empty;
    const records = db
      .prepare(
        'SELECT * FROM samples WHERE occurredAt >= ? AND occurredAt <= ? ORDER BY occurredAt DESC, rowid DESC LIMIT ?',
      )
      .all(
        new Date(Date.now() - RETENTION_MS).toISOString(),
        new Date().toISOString(),
        sampleLimit + 1,
      ) as unknown as RuntimePerformanceRecord[];
    return {
      ...empty,
      records: records.slice(0, sampleLimit),
      truncated: records.length > sampleLimit,
    };
  } finally {
    db.close();
  }
}

/** 采集失败只丢弃本次诊断，保持原操作的结果与异常。 */
export async function observeRuntimeOperation<T extends { exitCode: number | null }>(
  options: {
    projectRoot: () => string | Promise<string>;
    workflow: RuntimePerformanceRecord['workflow'];
    command: string;
    traceName?: string;
    kind?: RuntimePerformanceRecord['kind'];
    exitCode?: (result: T) => number;
    errorExitCode?: (error: unknown) => number;
  },
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  let recordedExitCode = 1;
  let exitCodeAvailable = true;
  const { metrics } = await observeRuntimeSpan(
    {
      projectRoot: options.projectRoot,
      workflow: options.workflow,
      kind: options.kind ?? 'command',
      name: options.traceName ?? options.command,
      status: () => {
        try {
          recordedExitCode = result
            ? (options.exitCode?.(result) ?? result.exitCode ?? 1)
            : (options.errorExitCode?.(failure) ?? 1);
        } catch {
          exitCodeAvailable = false;
          return 'unknown';
        }
        return recordedExitCode === 0 ? 'succeeded' : 'failed';
      },
    },
    () =>
      withCometRuntimeMetrics(async () => {
        try {
          result = await operation();
        } catch (error) {
          failed = true;
          failure = error;
        }
      }),
  );
  const durationMs = Math.max(0, performance.now() - started);
  try {
    if (!exitCodeAvailable) throw new Error('Runtime result classification unavailable');
    await recordRuntimePerformance(await options.projectRoot(), {
      workflow: options.workflow,
      kind: options.kind ?? 'command',
      command: options.command,
      occurredAt: new Date().toISOString(),
      durationMs,
      exitCode: recordedExitCode,
      ...metrics,
    });
  } catch {
    /* 统计不可用不阻塞命令。 */
  }
  if (failed) throw failure;
  return result!;
}
