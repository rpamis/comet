import {
  EVAL_AGENT_IDS,
  EvalRunError,
  reconcileEvalRun,
  previewEvalRun,
  startEvalRun,
  repairManagedEvalRun,
  requestStopEvalRun,
  setEvalBaseline,
  clearEvalBaseline,
  compareEvalRuns,
  readEvalArtifact,
  readEvalCasePage,
  readEvalCase,
  listEvalPresets,
  saveEvalPreset,
  deleteEvalPreset,
} from '../eval/index.js';
import { collectDashboardEvalRunPage } from './eval-collector.js';
import { markDashboardSummaryIndexDirty } from './summary-index.js';

export async function handleDashboardEvalRequest(
  project: string,
  method: string,
  subpath: string,
  query: URLSearchParams,
  input?: unknown,
): Promise<{ status: number; body: unknown }> {
  const body =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const read = method === 'GET' || method === 'HEAD';
  if (!read) markDashboardSummaryIndexDirty(project, 'eval-v1');
  if (read && subpath === '/presets')
    return { status: 200, body: { items: await listEvalPresets(project) } };
  if (method === 'POST' && subpath === '/presets')
    return { status: 200, body: await saveEvalPreset(project, body) };
  const preset = /^\/presets\/(preset-[\w-]+)\/delete$/u.exec(subpath);
  if (method === 'POST' && preset) {
    await deleteEvalPreset(project, preset[1], body.expectedUpdatedAt);
    return { status: 200, body: { deleted: true } };
  }
  if (read && subpath === '/capabilities')
    return {
      status: 200,
      body: {
        agents: EVAL_AGENT_IDS,
        targetTypes: ['skill', 'application'],
        suites: ['local', 'langsmith', 'langfuse'],
        configurationPath: '~/.comet/eval/.env',
      },
    };
  if (read && subpath === '/runs') {
    return {
      status: 200,
      body: await collectDashboardEvalRunPage(project, {
        q: query.get('q') ?? undefined,
        status: query.get('status') ?? undefined,
        limit: query.has('limit') ? Number(query.get('limit')) : undefined,
        offset: query.has('offset') ? Number(query.get('offset')) : undefined,
        baselineScope: query.get('baselineScope') ?? undefined,
        cached: query.get('refresh') !== '1',
      }),
    };
  }
  if (method === 'POST' && subpath === '/preview') {
    try {
      return { status: 200, body: await previewEvalRun(project, body) };
    } catch (error) {
      throw error instanceof EvalRunError ? error : new EvalRunError((error as Error).message);
    }
  }
  if (method === 'POST' && subpath === '/runs')
    return {
      status: 202,
      body: await startEvalRun(project, {
        config: body.config,
        confirmationHash: typeof body.confirmationHash === 'string' ? body.confirmationHash : '',
        requestId: typeof body.requestId === 'string' ? body.requestId : '',
        ...(typeof body.baselineRunId === 'string' ? { baselineRunId: body.baselineRunId } : {}),
      }),
    };
  const match =
    /^\/runs\/([^/]+)(?:\/(repair-managed-record|cases|case|artifact|stop|baseline|baseline\/clear|compare|rerun-preview))?$/u.exec(
      subpath,
    );
  if (!match) throw new EvalRunError('Eval 接口不存在', 404);
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    throw new EvalRunError('运行身份编码无效');
  }
  const action = match[2];
  if (read && !action)
    return {
      status: 200,
      body: await reconcileEvalRun(project, id, { includeCaseContent: false }),
    };
  if (read && action === 'cases')
    return {
      status: 200,
      body: await readEvalCasePage(project, id, {
        limit: query.has('limit') ? Number(query.get('limit')) : undefined,
        offset: query.has('offset') ? Number(query.get('offset')) : undefined,
        status: query.get('status') ?? undefined,
        q: query.get('q') ?? undefined,
      }),
    };
  if (read && action === 'case')
    return { status: 200, body: await readEvalCase(project, id, query.get('id') ?? '') };
  if (method === 'POST' && action === 'repair-managed-record')
    return {
      status: 200,
      body: await repairManagedEvalRun(
        project,
        id,
        typeof body.expectedHash === 'string' ? body.expectedHash : '',
        body.confirmedStopped === true,
      ),
    };
  if (read && action === 'artifact')
    return {
      status: 200,
      body: await readEvalArtifact(project, id, query.get('ref') ?? '', {
        tail: query.get('tail') === '1',
      }),
    };
  if (read && action === 'compare')
    return { status: 200, body: await compareEvalRuns(project, id, query.get('baseline') ?? '') };
  if (method === 'POST' && action === 'stop')
    return { status: 202, body: await requestStopEvalRun(project, id) };
  if (method === 'POST' && action === 'baseline/clear')
    return { status: 200, body: await clearEvalBaseline(project, id) };
  if (method === 'POST' && action === 'baseline') {
    if (body.expectedPrevious !== undefined && typeof body.expectedPrevious !== 'string')
      throw new EvalRunError('旧基线身份无效');
    return {
      status: 200,
      body: await setEvalBaseline(project, id, body.expectedPrevious as string | undefined),
    };
  }
  if (method === 'POST' && action === 'rerun-preview') {
    if (body.failedOnly !== undefined && typeof body.failedOnly !== 'boolean')
      throw new EvalRunError('failedOnly 必须是布尔值');
    const run = await reconcileEvalRun(project, id);
    if (run.archiveId) throw new EvalRunError('历史归档只读，请选择原应用创建新的评估', 409);
    if (!run.config.target) throw new EvalRunError('旧报告缺少目标路径，请重新选择评估目标', 409);
    const config = {
      ...run.config,
      ...body,
      target: body.target ?? run.config.target,
      targetType: run.target.type === 'application' ? 'application' : 'skill',
      ...(body.failedOnly === true ? { retrySourceRunId: id } : {}),
    };
    delete (config as Record<string, unknown>).failedOnly;
    if (!body.failedOnly) delete (config as Record<string, unknown>).retrySourceRunId;
    if (run.target.type === 'application')
      config.previousExperimentId = run.config.previousExperimentId ?? id;
    return { status: 200, body: await previewEvalRun(project, config) };
  }
  throw new EvalRunError('不支持的 Eval 请求方法', 405);
}
