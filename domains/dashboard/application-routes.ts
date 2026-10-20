import {
  collectDashboardApplicationRunPage,
  collectDashboardApplicationRunDetail,
  collectDashboardApplicationRunRecords,
  readDashboardApplicationArtifact,
  DashboardApplicationQueryError,
} from './application-collector.js';

export async function handleDashboardApplicationRequest(
  projectRoot: string,
  subpath: string,
  query: URLSearchParams,
): Promise<{ status: number; body: unknown }> {
  if (subpath === '/application-runs')
    return {
      status: 200,
      body: await collectDashboardApplicationRunPage(projectRoot, {
        kind: query.get('kind') ?? undefined,
        status: query.get('status') ?? undefined,
        applicationId: query.get('applicationId') ?? undefined,
        q: query.get('q') ?? undefined,
        limit: query.has('limit') ? Number(query.get('limit')) : undefined,
        cursor: query.get('cursor') ?? undefined,
        cached: query.get('refresh') !== '1',
        scope: query.get('scope') ?? undefined,
      }),
    };
  const locator = query.get('locator');
  if (!locator) throw new DashboardApplicationQueryError('缺少运行记录定位信息');
  const body =
    subpath === '/application-run'
      ? await collectDashboardApplicationRunDetail(projectRoot, locator, {
          recordLimit: query.has('recordLimit') ? Number(query.get('recordLimit')) : undefined,
          recordId: query.get('recordId') ?? undefined,
        })
      : subpath === '/application-run-records'
        ? await collectDashboardApplicationRunRecords(projectRoot, locator, {
            limit: query.has('limit') ? Number(query.get('limit')) : undefined,
            cursor: query.get('cursor') ?? undefined,
          })
        : subpath === '/application-run-artifact'
          ? await readDashboardApplicationArtifact(
              projectRoot,
              locator,
              query.get('artifactId') ?? '',
            )
          : null;
  return body
    ? { status: 200, body }
    : {
        status: 404,
        body: {
          code: 'APPLICATION_RUN_NOT_FOUND',
          error: '运行记录不存在或已移除，请保留当前选择并重新读取列表',
        },
      };
}
