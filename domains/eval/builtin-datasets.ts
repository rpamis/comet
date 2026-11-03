import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse as toml } from 'smol-toml';
import { parse as yaml } from 'yaml';

const DATASETS = [
  {
    id: 'workbuddy-code',
    version: '1.0',
    revision: '625b2233093ae4f23e76be28c1f341d41cc70373',
    tasks: 80,
    source: 'https://huggingface.co/datasets/tencent/workbuddy-bench',
    license: 'Tencent WorkBuddy Bench License',
    format: 'harbor',
    subset: 'code',
  },
  {
    id: 'skillsbench',
    version: '1.1',
    revision: 'b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af',
    tasks: 87,
    source: 'https://github.com/benchflow-ai/skillsbench',
    license: 'Apache-2.0',
    format: 'benchflow',
    subset: 'tasks',
  },
] as const;
export const listBuiltinDatasets = () => DATASETS.map((item) => ({ ...item }));
export interface DatasetOptions {
  dataset: string;
  datasetTreatment?: 'native' | 'goal';
  agent?: string;
  datasetRoot?: string;
  task?: string;
  count?: number | string;
  acceptDatasetLicense?: boolean;
}
export interface DatasetTask {
  id: string;
  source: string;
  instruction: string;
  workdir: string;
  timeout: number;
  verifierTimeout: number;
  contentHash: string;
  supported: boolean;
  reason?: string;
}
export interface DatasetPlan {
  scorerHash: string;
  datasetConfigHash: string;
  sharedHash: string;
  provenance: Record<string, unknown>;
  schema: 'comet.eval.dataset.v1';
  dataset: (typeof DATASETS)[number];
  root: string;
  treatment: 'COMET_NATIVE_SDK_CURRENT' | 'CLAUDE_CODE_GOAL';
  count: number;
  tasks: DatasetTask[];
  contentHash: string;
}
const digest = (value: string | Uint8Array) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;
async function treeHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(directory: string) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (['.git', '__pycache__'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`数据集不允许符号链接：${file}`);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        hash.update(path.relative(root, file).replaceAll('\\', '/'));
        hash.update('\0');
        // 文件内容按块读取，避免将大型工作区归档放入内存。
        const handle = await fs.open(file, 'r');
        try {
          const before = await handle.stat();
          for await (const chunk of handle.createReadStream({ autoClose: false }))
            hash.update(chunk);
          const after = await handle.stat();
          const current = await fs.lstat(file);
          if (
            !before.isFile() ||
            current.isSymbolicLink() ||
            before.ino !== current.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            before.ctimeMs !== after.ctimeMs
          )
            throw new Error(`数据集快照不完整，读取时文件发生变化：${file}`);
        } finally {
          await handle.close();
        }
        hash.update('\0');
      } else throw new Error(`数据集含不支持的文件：${file}`);
    }
  }
  await visit(root);
  return `sha256:${hash.digest('hex')}`;
}
export async function inspectBuiltinDataset(options: DatasetOptions): Promise<DatasetPlan> {
  if (
    options.datasetTreatment !== undefined &&
    !['native', 'goal'].includes(options.datasetTreatment)
  )
    throw new Error('数据集执行方式须为 native 或 goal');
  if (options.datasetTreatment === 'goal' && options.agent && options.agent !== 'claude-code')
    throw new Error('Goal 对照组仅支持 Claude Code');
  const dataset = DATASETS.find((item) => item.id === options.dataset);
  if (!dataset) throw new Error(`未知内置数据集：${options.dataset}`);
  const count = Number(options.count ?? 1);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100)
    throw new Error('count 须为 1–100 的整数');
  if (!options.datasetRoot)
    throw new Error('请用 --dataset-root 指定已获取的数据集目录；--list-datasets 可查看固定来源');
  const root = await fs.realpath(options.datasetRoot);
  let datasetConfigHash = '';
  if (dataset.id === 'workbuddy-code') {
    const file = path.join(root, 'dataset.toml');
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink())
      throw new Error('WorkBuddy 数据集缺少有效的 dataset.toml；请重新下载完整数据集');
    const config = await fs.readFile(file);
    toml(config.toString('utf8'));
    datasetConfigHash = digest(config);
  }
  const tasksRoot = path.join(root, 'tasks');
  if ((await fs.lstat(tasksRoot)).isSymbolicLink()) throw new Error('数据集 tasks 不能是链接');
  if (
    options.task &&
    !options.task.split(',').every((id) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(id))
  )
    throw new Error('任务 ID 无效');
  const ids = options.task
    ? [...new Set(options.task.split(','))]
    : (await fs.readdir(tasksRoot, { withFileTypes: true }))
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        .sort();
  const tasks: DatasetTask[] = [];
  for (const id of ids) {
    const source = path.join(tasksRoot, id);
    if ((await fs.lstat(source)).isSymbolicLink()) throw new Error('任务目录不能是链接');
    const contentHash = await treeHash(source);
    let instruction: string,
      metadata: {
        environment?: { workdir?: string; gpus?: number; os?: string };
        agent?: { timeout_sec?: number };
        verifier?: { timeout_sec?: number };
      };
    if (dataset.id === 'skillsbench') {
      const text = await fs.readFile(path.join(source, 'task.md'), 'utf8');
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(text);
      if (!match) throw new Error(`缺少 task.md 元数据：${id}`);
      metadata = yaml(match[1]);
      instruction = match[2];
    } else {
      metadata = toml(await fs.readFile(path.join(source, 'task.toml'), 'utf8'));
      instruction = await fs.readFile(path.join(source, 'instruction.md'), 'utf8');
    }
    const dockerfile = await fs.readFile(path.join(source, 'environment/Dockerfile'), 'utf8');
    const workdir =
      metadata.environment?.workdir ??
      [...dockerfile.matchAll(/^WORKDIR\s+(\S+)\s*$/gmu)].at(-1)?.[1] ??
      '/workspace';
    const timeout = metadata.agent?.timeout_sec ?? 900;
    const verifierTimeout = metadata.verifier?.timeout_sec ?? 900;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 86400)
      throw new Error(`任务时限无效：${id}`);
    if (!Number.isSafeInteger(verifierTimeout) || verifierTimeout < 1 || verifierTimeout > 86400)
      throw new Error(`评分时限无效：${id}`);
    let reason: string | undefined;
    if (
      metadata.environment?.gpus ||
      (metadata.environment?.os && metadata.environment.os !== 'linux')
    )
      reason = '首期仅支持无 GPU 的 Linux 任务';
    if (!['/workspace', '/root', '/app', '/data'].includes(workdir))
      reason = `尚不支持工作目录 ${workdir}`;
    if (dataset.id === 'workbuddy-code') {
      const verifier = toml(await fs.readFile(path.join(source, 'tests/verifier.toml'), 'utf8'));
      if (JSON.stringify(verifier).includes('repo_understanding'))
        reason = '原评分禁止 Native 元数据修改；尚不支持此任务类型';
    }
    if (/^FROM\s+\S*alpine/gmu.test(dockerfile)) reason = '首期运行层需要 Debian/Ubuntu 兼容镜像';
    tasks.push({
      id,
      source,
      instruction,
      workdir,
      timeout,
      verifierTimeout,
      contentHash,
      supported: !reason,
      ...(reason ? { reason } : {}),
    });
  }
  if (!tasks.length) throw new Error('数据集没有任务');
  // 数据集级插件同样属于评分输入，必须绑定到内容身份。
  const sharedHash =
    dataset.id === 'workbuddy-code' ? await treeHash(path.join(root, 'shared')) : '';
  let provenance: Record<string, unknown> = { kind: 'local-snapshot', verifiedRelease: false };
  try {
    const receipt = JSON.parse(await fs.readFile(path.join(root, 'dataset-source.json'), 'utf8'));
    provenance = { ...receipt, kind: 'download-receipt', verifiedRelease: false };
  } catch {
    /* 本地导入明确标为非官方版本验证。 */
  }
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const packageRoot = path.basename(moduleRoot) === 'dist' ? path.dirname(moduleRoot) : moduleRoot;
  const scorerHash = digest(
    await fs.readFile(path.join(packageRoot, 'eval/scaffold/python/dataset_score.py')),
  );
  return {
    scorerHash,
    schema: 'comet.eval.dataset.v1',
    dataset,
    root,
    treatment:
      options.datasetTreatment === 'goal' ? 'CLAUDE_CODE_GOAL' : 'COMET_NATIVE_SDK_CURRENT',
    count,
    tasks,
    sharedHash,
    datasetConfigHash,
    provenance,
    contentHash: digest(
      JSON.stringify({ dataset, tasks, count, sharedHash, datasetConfigHash, scorerHash }),
    ),
  };
}
