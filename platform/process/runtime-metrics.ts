import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

export interface CometRuntimeMetricsSnapshot {
  gitCommands: number;
  gitDurationMs: number;
}

let gitCommands = 0;
let gitDurationMs = 0;
const requestMetrics = new AsyncLocalStorage<CometRuntimeMetricsSnapshot>();

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
