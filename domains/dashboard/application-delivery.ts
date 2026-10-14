import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  previewWorkflowApplicationInstall,
  installWorkflowApplication,
  exportWorkflowApplication,
  inspectApplicationSkill,
} from '../workflow-application/index.js';
import { PLATFORMS } from '../../platform/install/platforms.js';
import {
  collectDashboardApplicationDeliverySource,
  DashboardApplicationQueryError,
} from './application-collector.js';

const requiredText = (body: Record<string, unknown>, key: string) => {
  if (typeof body[key] !== 'string' || !body[key].trim())
    throw new DashboardApplicationQueryError(`缺少 ${key}`);
  return body[key].trim();
};
const directory = (value: string, projectRoot: string) =>
  path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value);

/** 复用 CLI 的完整应用分发；浏览器确认仅授权当前内容和当前目标。 */
export async function handleDashboardApplicationDeliveryRequest(
  projectRoot: string,
  method: string,
  input: unknown,
): Promise<{ status: number; body: unknown }> {
  if (method === 'GET' || method === 'HEAD')
    return {
      status: 200,
      body: { platforms: PLATFORMS.map(({ id, name }) => ({ id, name })), projectRoot },
    };
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
  const body =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const action = requiredText(body, 'action');
  if (!['preview-install', 'install', 'preview-export', 'export'].includes(action))
    throw new DashboardApplicationQueryError('未知分发操作');
  const source = await collectDashboardApplicationDeliverySource(
    projectRoot,
    requiredText(body, 'locator'),
  );
  try {
    if (action === 'preview-export' || action === 'export') {
      const destination = directory(requiredText(body, 'destination'), projectRoot);
      try {
        await fs.lstat(destination);
        throw new DashboardApplicationQueryError('导出目标已存在，请选择尚不存在的目录', 409);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const inspected = await inspectApplicationSkill(path.dirname(source.file));
      if (inspected.contentHash !== source.contentHash)
        throw new DashboardApplicationQueryError('应用内容已变化，请重新预览', 409);
      const preview = {
        ...source,
        destination,
        files: Object.keys(inspected.files),
        noFilesWritten: true,
      };
      const confirmationHash = createHash('sha256').update(JSON.stringify(preview)).digest('hex');
      if (action === 'preview-export')
        return { status: 200, body: { ...preview, confirmationHash } };
      if (requiredText(body, 'confirmationHash') !== confirmationHash)
        throw new DashboardApplicationQueryError('导出预览已变化，请重新预览并确认', 409);
      return {
        status: 200,
        body: await exportWorkflowApplication({
          file: source.file,
          projectRoot,
          destination,
          expectedContentHash: source.contentHash,
        }),
      };
    }
    if (body.scope !== 'project' && body.scope !== 'user')
      throw new DashboardApplicationQueryError('请选择项目或用户安装范围');
    if (
      !Array.isArray(body.platforms) ||
      !body.platforms.length ||
      body.platforms.some(
        (p) => typeof p !== 'string' || !['all', ...PLATFORMS.map(({ id }) => id)].includes(p),
      )
    )
      throw new DashboardApplicationQueryError('请选择 Comet 支持的平台');
    if (body.upgrade !== undefined && typeof body.upgrade !== 'boolean')
      throw new DashboardApplicationQueryError('升级选项无效');
    if (body.targetDirectory !== undefined && typeof body.targetDirectory !== 'string')
      throw new DashboardApplicationQueryError('目标目录无效');
    const target =
      typeof body.targetDirectory === 'string' && body.targetDirectory.trim()
        ? directory(body.targetDirectory.trim(), projectRoot)
        : undefined;
    const options = {
      file: source.file,
      projectRoot: body.scope === 'project' ? (target ?? projectRoot) : projectRoot,
      scope: body.scope,
      ...(body.scope === 'user' && target ? { userRoot: target } : {}),
      platforms: body.platforms as string[],
      upgrade: body.upgrade === true,
    } as const;
    if (action === 'preview-install')
      return { status: 200, body: await previewWorkflowApplicationInstall(options) };
    const confirmationHash = requiredText(body, 'confirmationHash');
    return {
      status: 200,
      body: await installWorkflowApplication({ ...options, confirmationHash }),
    };
  } catch (error) {
    if (error instanceof DashboardApplicationQueryError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new DashboardApplicationQueryError(
      message,
      /确认|预览|冲突|已存在|变化|覆盖|意图/u.test(message) ? 409 : 400,
    );
  }
}
