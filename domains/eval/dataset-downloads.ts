import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { listBuiltinDatasets } from './builtin-datasets.js';
import { EvalRunError, evalStoragePath, readEvalJson } from './eval-run-store.js';
import { renameWithRetry } from '../../platform/fs/transient-retry.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import { runOwnedCommand } from '../../platform/process/run-owned-command.js';

const sources = {
  'workbuddy-code': {
    revision: '3e8ad839685c589d83a1dd60fe2d15eabb75f27a',
    archiveSha256: 'f60394e44341f45f66af17ba69efc51ceadc61f17c08aa89e4af35b51f6f34e1',
    sizeHint: '约 200 MB 归档',
    licenseUrl:
      'https://github.com/Tencent/workbuddy-bench/blob/625b2233093ae4f23e76be28c1f341d41cc70373/LICENSE',
  },
  skillsbench: {
    revision: 'b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af',
    archiveSha256: '525bf1559a1eb3511ca2daaf2a307e2dd882efd646c130a730de0f9f37da34d7',
    sizeHint: '完整仓库归档；正式任务解压后约 542 MB',
    licenseUrl:
      'https://github.com/benchflow-ai/skillsbench/blob/b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af/LICENSE',
  },
};
export type DatasetDownloadStatus =
  'not-downloaded' | 'downloading' | 'cached' | 'failed' | 'version-mismatch';
export interface DatasetDownload {
  id: string;
  name: string;
  version: string;
  source: string;
  license: string;
  licenseUrl: string;
  sizeHint: string;
  root: string;
  status: DatasetDownloadStatus;
  progress?: { phase?: string; bytes?: number; total?: number | null };
  error?: string;
}
const active = new Set<string>();
async function writeEvalJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    await renameWithRetry(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
function dataset(id: string) {
  const entry = listBuiltinDatasets().find((item) => item.id === id);
  if (!entry) throw new EvalRunError('未知内置数据集');
  return entry;
}
async function paths(project: string, id: string) {
  const entry = dataset(id);
  return {
    root: await evalStoragePath(project, 'cache', 'datasets', `${id}-${entry.version}`),
    state: await evalStoragePath(project, 'cache', 'dataset-downloads', `${id}.json`),
    progress: await evalStoragePath(project, 'cache', 'dataset-downloads', `${id}.progress.json`),
  };
}
async function inspect(project: string, id: string): Promise<DatasetDownload> {
  const entry = dataset(id),
    expected = sources[entry.id],
    location = await paths(project, id);
  const state = await readEvalJson(location.state).catch(
    () => ({ status: 'failed', error: '下载状态记录无法读取，请重试' }) as Record<string, unknown>,
  );
  const row: DatasetDownload = {
    id,
    name: id === 'skillsbench' ? 'SkillsBench' : 'WorkBuddy Bench · Code',
    version: entry.version,
    source: entry.source,
    license: entry.license,
    ...expected,
    root: location.root,
    status: 'not-downloaded',
  };
  if (state?.status === 'downloading') {
    let alive = active.has(location.state);
    if (!alive && Number.isSafeInteger(state.ownerPid) && state.ownerPid !== process.pid) {
      try {
        process.kill(Number(state.ownerPid), 0);
        alive = true;
      } catch {
        /* 中断的下载可显式重试。 */
      }
    }
    if (alive)
      return {
        ...row,
        status: 'downloading',
        progress: (await readEvalJson(location.progress)) ?? undefined,
      };
  }
  const receiptFile = await evalStoragePath(
    project,
    'cache',
    'datasets',
    `${id}-${entry.version}`,
    'dataset-source.json',
  );
  const receipt = await readEvalJson(receiptFile).catch(() => null);
  if (
    receipt &&
    receipt.dataset === id &&
    receipt.revision === expected.revision &&
    receipt.archiveSha256 === expected.archiveSha256
  ) {
    const tasks = await fs
      .lstat(await evalStoragePath(project, 'cache', 'datasets', `${id}-${entry.version}`, 'tasks'))
      .catch(() => null);
    if (tasks?.isDirectory()) return { ...row, status: 'cached' };
  }
  if (state?.status === 'failed')
    return { ...row, status: 'failed', error: String(state.error ?? '下载失败') };
  if (state?.status === 'downloading')
    return { ...row, status: 'failed', error: '下载任务已中断，请重试' };
  if (await fs.lstat(location.root).catch(() => null))
    return { ...row, status: 'version-mismatch', error: '缓存版本或归档摘要不匹配，请重新下载' };
  return row;
}
export async function listDatasetDownloads(project: string) {
  return Promise.all(listBuiltinDatasets().map((entry) => inspect(project, entry.id)));
}
export async function requireDatasetCache(project: string, id: string) {
  const row = await inspect(project, id);
  if (row.status !== 'cached') throw new EvalRunError('请先下载所选数据集，完成后再预览评测');
  return row.root;
}
export async function startDatasetDownload(
  project: string,
  id: string,
  licenseAccepted: boolean,
): Promise<DatasetDownload> {
  dataset(id);
  if (id === 'workbuddy-code' && licenseAccepted !== true)
    throw new EvalRunError('请先阅读并接受 WorkBuddy 数据集许可');
  const location = await paths(project, id);
  await fs.mkdir(path.dirname(location.state), { recursive: true });
  return withRecoverableFileLock(location.state + '.lock', async () => {
    const current = await inspect(project, id);
    if (current.status === 'cached' || current.status === 'downloading') return current;
    if (await fs.lstat(location.root).catch(() => null)) {
      const retained = await evalStoragePath(
        project,
        'cache',
        'datasets',
        `${id}.previous-${randomUUID()}`,
      );
      await fs.rename(location.root, retained);
    }
    await writeEvalJson(location.progress, { phase: 'connecting', bytes: 0, total: null });
    await writeEvalJson(location.state, { status: 'downloading', ownerPid: process.pid });
    active.add(location.state);
    const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const packageRoot =
      path.basename(moduleRoot) === 'dist' ? path.dirname(moduleRoot) : moduleRoot;
    void runOwnedCommand(
      process.execPath,
      [
        path.join(packageRoot, 'bin/comet.js'),
        'eval',
        '--dataset',
        id,
        '--fetch-dataset',
        '--dataset-root',
        location.root,
        ...(id === 'workbuddy-code' ? ['--accept-dataset-license'] : []),
      ],
      {
        cwd: project,
        env: { ...process.env, COMET_DATASET_PROGRESS: location.progress },
        timeoutMs: 60 * 60 * 1000,
      },
    )
      .then(async () => {
        await writeEvalJson(location.state, { status: 'completed' });
        if ((await inspect(project, id)).status !== 'cached')
          throw new Error('下载已结束，但缓存版本或摘要校验未通过');
      })
      .catch(async (error: unknown) => {
        const progress = await readEvalJson(location.progress);
        await writeEvalJson(location.state, {
          status: 'failed',
          error:
            typeof progress?.error === 'string'
              ? progress.error
              : error instanceof Error
                ? error.message
                : String(error),
        });
      })
      .finally(() => {
        active.delete(location.state);
      })
      .catch((error: unknown) => {
        console.error('保存数据集下载状态失败', error);
        active.delete(location.state);
      });
    return {
      ...current,
      status: 'downloading',
      error: undefined,
      progress: { phase: 'connecting', bytes: 0, total: null },
    };
  });
}
