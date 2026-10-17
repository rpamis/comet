import { readCometDaemonStatus } from '../../platform/process/comet-daemon.js';
import { listCreatorRunSources, readCreatorRunRecord } from '../workflow-creation/index.js';
import {
  listWorkflowApplicationRunSources,
  readWorkflowApplicationRunObservation,
} from '../workflow-application/index.js';

async function collectHealth(projectRoot: string) {
  const observedAt = new Date().toISOString();
  try {
    const status = await readCometDaemonStatus(projectRoot);
    if (!status) return { state: 'idle' as const, observedAt };
    return {
      state: 'running' as const,
      observedAt,
      activeRequests: status.activeRequests,
      requestCount: status.requestCount,
      memoryRssBytes: status.memoryRssBytes,
      memoryHeapUsedBytes: status.memoryHeapUsedBytes,
      uptimeSeconds: Math.max(0, (Date.now() - Date.parse(status.startedAt)) / 1000),
      lastDurationMs: status.lastRequest?.durationMs ?? null,
    };
  } catch {
    return { state: 'unavailable' as const, observedAt };
  }
}

async function collectQuality(projectRoot: string) {
  type Run = NonNullable<Awaited<ReturnType<typeof readCreatorRunRecord>>>;
  const sampleLimit = 50;
  const sources = new Map<string, () => Promise<Run | null>>();
  const discovered = await Promise.allSettled([
    listCreatorRunSources(projectRoot),
    listWorkflowApplicationRunSources(projectRoot),
  ]);
  if (discovered[0].status === 'fulfilled')
    for (const source of discovered[0].value) {
      const id = source.runId;
      sources.set(`creator:${id ?? source.storageKey}`, () =>
        id && !source.error ? readCreatorRunRecord(projectRoot, id) : Promise.resolve(null),
      );
    }
  if (discovered[1].status === 'fulfilled')
    for (const source of discovered[1].value) {
      const id = source.runId;
      sources.set(`application:${source.applicationId}:${id ?? source.storageKey}`, async () =>
        id && !source.error
          ? ((await readWorkflowApplicationRunObservation(projectRoot, source.applicationId, id))
              .record?.run ?? null)
          : null,
      );
    }
  const reads = [...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, sampleLimit);
  const result = {
    available: discovered.some((source) => source.status === 'fulfilled'),
    sourceErrors: discovered.filter((source) => source.status === 'rejected').length,
    sourceCount: sources.size,
    sampleLimit,
    truncated: sources.size > sampleLimit,
    sampledRuns: 0,
    unreadableRuns: 0,
    completedRuns: 0,
    succeededActions: 0,
    terminalActions: 0,
    firstPassSucceeded: 0,
    firstPassRate: null as number | null,
    retries: 0,
    activeActions: 0,
    unknownActions: 0,
    waitingDecisions: 0,
  };
  for (let offset = 0; offset < reads.length; offset += 4) {
    const batch = await Promise.allSettled(
      reads.slice(offset, offset + 4).map(([, read]) => read()),
    );
    for (const item of batch) {
      const run = item.status === 'fulfilled' ? item.value : null;
      if (!run) {
        result.unreadableRuns++;
        continue;
      }
      result.sampledRuns++;
      if (run.status === 'completed') result.completedRuns++;
      result.waitingDecisions += run.waits.filter((wait) => wait.status === 'pending').length;
      for (const action of run.actions) {
        result.retries += Math.max(0, action.attempt - 1);
        if (action.status === 'succeeded') {
          result.succeededActions++;
          if (action.attempt === 1) result.firstPassSucceeded++;
        }
        if (action.status === 'succeeded' || action.status === 'failed') result.terminalActions++;
        if (action.status === 'pending' || action.status === 'running') result.activeActions++;
        if (action.status === 'unknown') result.unknownActions++;
      }
    }
  }
  result.firstPassRate = result.terminalActions
    ? result.firstPassSucceeded / result.terminalActions
    : null;
  return result;
}

/** 仅观测当前进程和 SDK 快照，不加载应用执行模块或推进工作流。 */
export async function collectRuntimeInsights(projectRoot: string) {
  const [health, quality] = await Promise.all([
    collectHealth(projectRoot),
    collectQuality(projectRoot),
  ]);
  return { health, quality };
}
