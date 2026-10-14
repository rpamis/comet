import {
  listEvalRunSources,
  listEvalArchiveSources,
  readEvalRunSummary,
  summarizeEvalRun,
  reconcileEvalRun,
  readEvalArchive,
  archiveEvalDetail,
  archiveEvalError,
  readEvalBaselines,
  EvalRunError,
  collectEvalRuns,
  type EvalRunSummary,
} from '../eval/index.js';
import {
  DashboardSummaryIndex,
  DashboardSummaryIndexError,
  type DashboardSummaryRecord,
  type DashboardSummarySource,
} from './summary-index.js';

const terminalStatuses = ['completed', 'stopped', 'interrupted', 'unknown'];
function indexed(run: EvalRunSummary): DashboardSummaryRecord {
  return {
    key: run.id,
    sortKey: `${run.createdAt ?? ''}\0${run.id}`,
    search: `${run.id} ${run.target.name} ${run.target.path ?? ''}`,
    status: run.executionStatus,
    group: run.baselineScope,
    attention: run.baselineEligible,
    volatile: !terminalStatuses.includes(run.executionStatus),
    payload: run,
  };
}
function index(projectRoot: string) {
  return new DashboardSummaryIndex({
    projectRoot,
    namespace: 'eval-v1',
    refreshIntervalMs: 3000,
    discover: async () => {
      const [runs, archives] = await Promise.all([
        listEvalRunSources(projectRoot),
        listEvalArchiveSources(projectRoot),
      ]);
      const sources: DashboardSummarySource[] = runs.map((source) => ({
        ...source,
        key: source.id,
        read: async () => {
          const summary = await readEvalRunSummary(projectRoot, source.id);
          return [
            indexed(
              terminalStatuses.includes(summary.executionStatus)
                ? summary
                : summarizeEvalRun(await reconcileEvalRun(projectRoot, source.id)),
            ),
          ];
        },
      }));
      sources.push(
        ...archives.map((source) => ({
          key: `archive:${source.id}`,
          fingerprint: source.fingerprint,
          read: async () => [
            indexed(
              summarizeEvalRun(
                source.error
                  ? archiveEvalError(source.id, source.error)
                  : archiveEvalDetail((await readEvalArchive(projectRoot, source.id)).archive),
              ),
            ),
          ],
        })),
      );
      return sources;
    },
  });
}

export async function collectDashboardEvalRunPage(
  projectRoot: string,
  query: {
    q?: string;
    status?: string;
    limit?: number;
    offset?: number;
    cached?: boolean;
    baselineScope?: string;
  } = {},
) {
  const limit = query.limit ?? 15,
    offset = query.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new EvalRunError('分页参数无效');
  if (query.status && !['all', 'active', 'finished', 'baseline'].includes(query.status))
    throw new EvalRunError('评估筛选无效');
  if ((query.q?.length ?? 0) > 512) throw new EvalRunError('搜索内容过长');
  const store = index(projectRoot);
  try {
    await store.ensure({ fresh: !query.cached });
    const baselines = await readEvalBaselines(projectRoot);
    const keys = Object.values(baselines);
    const statuses =
      query.status === 'finished'
        ? terminalStatuses
        : query.status === 'active'
          ? ['queued', 'preparing', 'generating', 'running', 'judging', 'finalizing', 'stopping']
          : undefined;
    const base = { search: query.q, descending: true };
    const page = await store.query<EvalRunSummary>({
      ...base,
      limit,
      offset,
      statuses,
      keys: query.status === 'baseline' ? keys : undefined,
      group: query.baselineScope,
      attention: query.baselineScope ? true : undefined,
    });
    const [all, active, finished, baseline] = await Promise.all([
      store.query({ ...base, limit: 0 }),
      store.query({
        ...base,
        limit: 0,
        statuses: [
          'queued',
          'preparing',
          'generating',
          'running',
          'judging',
          'finalizing',
          'stopping',
        ],
      }),
      store.query({ ...base, limit: 0, statuses: terminalStatuses }),
      store.query({ ...base, limit: 0, keys }),
    ]);
    return {
      ...page,
      items: page.items.map((run) => ({
        ...run,
        baselineRunId: run.baselineScope ? (baselines[run.baselineScope] ?? null) : null,
        isBaseline: Boolean(run.baselineScope && baselines[run.baselineScope] === run.id),
      })),
      offset,
      nextOffset: offset + page.items.length < page.total ? offset + page.items.length : null,
      counts: {
        all: all.total,
        active: active.total,
        finished: finished.total,
        baseline: baseline.total,
      },
    };
  } catch (error) {
    if (!(error instanceof DashboardSummaryIndexError)) throw error;
    const all = (await collectEvalRuns(projectRoot))
      .map(summarizeEvalRun)
      .filter(
        (run) =>
          !query.q ||
          `${run.id} ${run.target.name} ${run.target.path ?? ''}`
            .toLocaleLowerCase()
            .includes(query.q.toLocaleLowerCase()),
      );
    const selected = all.filter(
      (run) =>
        (!query.baselineScope ||
          (run.baselineEligible && run.baselineScope === query.baselineScope)) &&
        (!query.status ||
          query.status === 'all' ||
          (query.status === 'active'
            ? !terminalStatuses.includes(run.executionStatus)
            : query.status === 'finished'
              ? terminalStatuses.includes(run.executionStatus)
              : run.isBaseline)),
    );
    return {
      items: selected.slice(offset, offset + limit),
      total: selected.length,
      offset,
      nextOffset: offset + limit < selected.length ? offset + limit : null,
      indexing: false,
      indexedCount: 0,
      sourceCount: all.length,
      generation: '',
      errors: ['列表缓存暂不可用，当前直接读取运行记录。'],
      counts: {
        all: all.length,
        active: all.filter((run) => !terminalStatuses.includes(run.executionStatus)).length,
        finished: all.filter((run) => terminalStatuses.includes(run.executionStatus)).length,
        baseline: all.filter((run) => run.isBaseline).length,
      },
    };
  }
}
