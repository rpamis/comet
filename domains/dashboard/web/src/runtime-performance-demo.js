import { inObservabilityRange } from './observability-time-range.js';

// 仅用于显式演示模式，不合并到本地观测记录。
const records = Array.from({ length: 32 }, (_, index) => ({
  id: `demo-runtime-${index}`,
  workflow: index % 3 === 0 ? 'classic' : 'native',
  kind: index % 7 === 0 ? 'check' : 'command',
  command: index % 7 === 0 ? 'check' : ['status', 'next', 'show', 'state'][index % 4],
  occurredAt: new Date(Date.now() - index * 1200000 - 1000).toISOString(),
  durationMs:
    index % 7 === 0 ? 1400 + index * 110 : [86, 124, 52, 218, 145, 380, 94, 176][index % 8],
  exitCode: index % 11 === 0 ? 1 : 0,
  gitCommands: index % 7 === 0 ? 0 : 1 + (index % 5),
  gitDurationMs: index % 7 === 0 ? 0 : 12 + (index % 8) * 6,
}));
function summary(rows) {
  const sorted = rows.map((row) => row.durationMs).sort((a, b) => a - b);
  const failures = rows.filter((row) => row.exitCode !== 0).length;
  return {
    count: rows.length,
    successes: rows.length - failures,
    successRate: rows.length ? (rows.length - failures) / rows.length : null,
    fastSuccesses: rows.filter((row) => row.exitCode === 0 && row.durationMs <= 1000).length,
    fastSuccessRate: rows.length
      ? rows.filter((row) => row.exitCode === 0 && row.durationMs <= 1000).length / rows.length
      : null,
    totalDurationMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
    failures,
    failureRate: rows.length ? failures / rows.length : null,
    p50Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.5) - 1] : null,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    gitCommands: rows.reduce((sum, row) => sum + row.gitCommands, 0),
    gitDurationMs: rows.reduce((sum, row) => sum + row.gitDurationMs, 0),
  };
}
function demoRuntimePerformance(range) {
  return Object.fromEntries(
    ['all', 'native', 'classic'].map((workflow) => {
      const inRange = records.filter((row) => inObservabilityRange(row.occurredAt, range));
      const selected = inRange.filter((row) => workflow === 'all' || row.workflow === workflow);
      const commands = selected.filter((row) => row.kind === 'command');
      const keys = [...new Set(commands.map((row) => row.workflow + ':' + row.command))];
      const hotspots = keys.map((key) => {
        const rows = commands.filter((row) => row.workflow + ':' + row.command === key);
        return { workflow: rows[0].workflow, command: rows[0].command, ...summary(rows) };
      });
      const outcomeKeys = [
        ...new Set(commands.map((row) => row.workflow + ':' + row.command + ':' + row.exitCode)),
      ];
      const outcomes = outcomeKeys.map((key) => {
        const rows = commands.filter(
          (row) => row.workflow + ':' + row.command + ':' + row.exitCode === key,
        );
        return {
          workflow: rows[0].workflow,
          command: rows[0].command,
          exitCode: rows[0].exitCode,
          count: rows.length,
        };
      });
      return [
        workflow,
        {
          available: true,
          demo: true,
          workflow,
          days: 7,
          sampleLimit: 5000,
          truncated: false,
          hotspots,
          outcomes,
          commands: summary(selected.filter((row) => row.kind === 'command')),
          checks: summary(selected.filter((row) => row.kind === 'check')),
          workflows: ['native', 'classic'].map((name) => ({
            workflow: name,
            ...summary(inRange.filter((row) => row.workflow === name && row.kind === 'command')),
          })),
          recent: selected.filter((row) => row.kind === 'command').slice(0, 20),
          slowest: [...selected].sort((a, b) => b.durationMs - a.durationMs).slice(0, 20),
        },
      ];
    }),
  );
}
export const DEMO_RUNTIME_PERFORMANCE = demoRuntimePerformance();
export const getDemoRuntimePerformance = (workflow, range) =>
  demoRuntimePerformance(range)[workflow];

export const DEMO_RUNTIME_INSIGHTS = {
  health: {
    state: 'running',
    observedAt: '2026-08-29T12:00:00Z',
    requestCount: 186,
    activeRequests: 0,
    memoryRssBytes: 84541440,
    memoryHeapUsedBytes: 28311552,
    uptimeSeconds: 6840,
    lastDurationMs: 124,
  },
  quality: {
    available: true,
    sourceErrors: 0,
    sourceCount: 12,
    sampleLimit: 50,
    truncated: false,
    sampledRuns: 12,
    unreadableRuns: 0,
    completedRuns: 8,
    succeededActions: 56,
    terminalActions: 58,
    firstPassSucceeded: 52,
    firstPassRate: 52 / 58,
    retries: 6,
    activeActions: 4,
    unknownActions: 1,
    waitingDecisions: 3,
  },
};
