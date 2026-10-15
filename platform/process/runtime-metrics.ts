import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

export interface CometRuntimeMetricsSnapshot {
  gitCommands: number;
  gitDurationMs: number;
}

let gitCommands = 0;
let gitDurationMs = 0;
const requestMetrics = new AsyncLocalStorage<CometRuntimeMetricsSnapshot>();

export interface CometRuntimeProgress {
  label: string;
  completed?: number;
  total?: number;
  elapsedMs: number;
}
const requestProgress = new AsyncLocalStorage<{
  label: string;
  completed?: number;
  total?: number;
}>();

/** 进度只用于诊断；不写入工作流，也不能改变执行结果。 */
export function reportCometRuntimeProgress(
  label: string,
  completed?: number,
  total?: number,
): void {
  const current = requestProgress.getStore();
  if (!current) return;
  if (current.label !== label) {
    current.completed = undefined;
    current.total = undefined;
  }
  current.label = label;
  if (completed !== undefined) current.completed = completed;
  if (total !== undefined) current.total = total;
}

export async function withCometRuntimeProgress<T>(
  operation: () => Promise<T>,
  report: (progress: CometRuntimeProgress) => void = (progress) => {
    const count =
      progress.completed === undefined
        ? ''
        : `：${progress.completed}${progress.total === undefined ? '' : `/${progress.total}`} 项`;
    process.stderr.write(
      `[Comet] ${progress.label}${count}，已用 ${Math.floor(progress.elapsedMs / 1000)} 秒\n`,
    );
  },
): Promise<T> {
  if (requestProgress.getStore()) return operation();
  const current = { label: '执行工作流命令' };
  const started = Date.now();
  const timer = setInterval(() => {
    try {
      report({ ...current, elapsedMs: Date.now() - started });
    } catch {
      /* 诊断输出失败不改变工作流。 */
    }
  }, 5000);
  timer.unref?.();
  try {
    return await requestProgress.run(current, operation);
  } finally {
    clearInterval(timer);
  }
}

/**
 * Keep the counter deliberately small and process-local. It is diagnostic
 * telemetry for the optional daemon benchmark, not a cache or a workflow
 * input, so it must never affect command behaviour.
 */
export function recordCometGitCommand(durationMs = 0): void {
  gitCommands += 1;
  gitDurationMs += durationMs;
  const active = requestMetrics.getStore();
  if (active) {
    active.gitCommands += 1;
    active.gitDurationMs += durationMs;
  }
}

export function snapshotCometRuntimeMetrics(): CometRuntimeMetricsSnapshot {
  return { gitCommands, gitDurationMs };
}

/** Attribute Git work to this request even when asynchronous handlers overlap. */
export async function withCometRuntimeMetrics<T>(
  operation: () => Promise<T>,
): Promise<{ result: T; metrics: CometRuntimeMetricsSnapshot }> {
  const metrics = { gitCommands: 0, gitDurationMs: 0 };
  const result = await requestMetrics.run(metrics, operation);
  return { result, metrics };
}

/** Count successful and failed Git subprocesses with their elapsed time. */
export function measureCometGitCommand<T>(operation: () => T): T {
  const started = performance.now();
  try {
    return operation();
  } finally {
    recordCometGitCommand(performance.now() - started);
  }
}

export async function measureCometGitCommandAsync<T>(operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    recordCometGitCommand(performance.now() - started);
  }
}
