import {
  readRuntimePerformanceRecords,
  type RuntimePerformanceRecord,
} from '../../platform/process/runtime-performance.js';
import { withinObservationRange, type ObservabilityRange } from './observability-range.js';

function summary(rows: RuntimePerformanceRecord[]) {
  const durations = rows.map((row) => row.durationMs).sort((a, b) => a - b);
  const quantile = (value: number) =>
    durations.length ? durations[Math.ceil(durations.length * value) - 1] : null;
  const failures = rows.filter((row) => row.exitCode !== 0).length;
  const successes = rows.length - failures;
  const fastSuccesses = rows.filter((row) => row.exitCode === 0 && row.durationMs <= 1000).length;
  return {
    count: rows.length,
    successes,
    successRate: rows.length ? successes / rows.length : null,
    fastSuccesses,
    fastSuccessRate: rows.length ? fastSuccesses / rows.length : null,
    totalDurationMs: durations.reduce((sum, value) => sum + value, 0),
    failures,
    failureRate: rows.length ? failures / rows.length : null,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
    gitCommands: rows.reduce((sum, row) => sum + row.gitCommands, 0),
    gitDurationMs: rows.reduce((sum, row) => sum + row.gitDurationMs, 0),
  };
}

/** 只读取观测记录；Dashboard 访问本身不参与统计。 */
export async function collectRuntimePerformance(
  projectRoot: string,
  workflow: 'all' | 'native' | 'classic' = 'all',
  range?: ObservabilityRange,
) {
  const { records, ...sample } = await readRuntimePerformanceRecords(projectRoot);
  const inRange = records.filter((row) => withinObservationRange(row.occurredAt, range));
  const selected = inRange.filter((row) => workflow === 'all' || row.workflow === workflow);
  const commands = selected.filter((row) => row.kind === 'command');
  const checks = selected.filter((row) => row.kind === 'check');
  const groups = new Map<string, typeof commands>();
  const outcomes = new Map<
    string,
    { workflow: string; command: string; exitCode: number; count: number }
  >();
  for (const row of commands) {
    const key = `${row.workflow}:${row.command}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
    const outcomeKey = `${key}:${row.exitCode}`;
    const outcome = outcomes.get(outcomeKey) ?? {
      workflow: row.workflow,
      command: row.command,
      exitCode: row.exitCode,
      count: 0,
    };
    outcome.count++;
    outcomes.set(outcomeKey, outcome);
  }
  return {
    ...sample,
    available: true,
    workflow,
    commands: summary(commands),
    checks: summary(checks),
    hotspots: [...groups.values()]
      .map((rows) => ({ workflow: rows[0].workflow, command: rows[0].command, ...summary(rows) }))
      .sort(
        (a, b) =>
          b.totalDurationMs - a.totalDurationMs ||
          `${a.workflow}:${a.command}`.localeCompare(`${b.workflow}:${b.command}`),
      ),
    outcomes: [...outcomes.values()].sort(
      (a, b) =>
        a.workflow.localeCompare(b.workflow) ||
        a.command.localeCompare(b.command) ||
        a.exitCode - b.exitCode,
    ),
    workflows: (['native', 'classic'] as const).map((name) => ({
      workflow: name,
      ...summary(inRange.filter((row) => row.workflow === name && row.kind === 'command')),
    })),
    recent: commands.slice(0, 20),
    slowest: [...selected].sort((a, b) => b.durationMs - a.durationMs).slice(0, 20),
  };
}
