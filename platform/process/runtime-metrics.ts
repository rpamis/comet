export interface CometRuntimeMetricsSnapshot {
  gitCommands: number;
}

let gitCommands = 0;

/**
 * Keep the counter deliberately small and process-local. It is diagnostic
 * telemetry for the optional daemon benchmark, not a cache or a workflow
 * input, so it must never affect command behaviour.
 */
export function recordCometGitCommand(): void {
  gitCommands += 1;
}

export function snapshotCometRuntimeMetrics(): CometRuntimeMetricsSnapshot {
  return { gitCommands };
}
