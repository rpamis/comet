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
  instructionHash: string;
  execution: DatasetExecution;
  contentHash: string;
  supported: boolean;
  reason?: string;
}
export interface DatasetExecution {
  timeoutSeconds: number;
  buildTimeoutSeconds: number;
  candidateDirectories: string[];
  networkMode: string;
  cpus?: number;
  memoryMb?: number;
  storageMb?: number;
  storageEnforcement: 'candidate-monitor' | 'not-requested';
  limitations: string[];
  controllerFilePolicy: 'exclude-harness-created-paths';
  verifier: {
    env: Record<string, string>;
    pytestPlugins: string[];
    cleanupConftests: boolean;
    importPath?: string;
  };
  metadata: Record<string, unknown>;
}
type DatasetMetadata = {
  metadata?: Record<string, unknown>;
  environment?: Record<string, unknown> & { workdir?: string; gpus?: number; os?: string };
  agent?: { timeout_sec?: number };
  verifier?: Record<string, unknown> & { timeout_sec?: number };
};
function executionPolicy(
  metadata: DatasetMetadata,
  instruction: string,
  dockerfile: string,
  timeout: number,
  datasetId: string,
) {
  const environment = metadata.environment ?? {};
  const verifier = metadata.verifier ?? {};
  const reasons: string[] = [];
  const number = (value: unknown, name: string, maximum: number) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum)
      throw new Error(`数据集 ${name} 必须为 0–${maximum} 范围内的正数`);
    return value;
  };
  const cpus = number(environment.cpus, 'cpus', 256);
  const memoryMb = number(environment.memory_mb, 'memory_mb', 1048576);
  const storageMb = number(environment.storage_mb, 'storage_mb', 10485760);
  const originalBuild = number(environment.build_timeout_sec, 'build_timeout_sec', 86400) ?? 600;
  const networkMode = String(environment.network_mode ?? 'public');
  if (networkMode !== 'public')
    reasons.push(`尚不支持任务网络模式 ${networkMode}：任务与 Agent API 共用容器网络`);
  const environmentKeys = new Set([
    'workdir',
    'gpus',
    'os',
    'cpus',
    'memory_mb',
    'storage_mb',
    'network_mode',
    'build_timeout_sec',
    'bugswarm_image_tag',
    'mcp_servers',
  ]);
  for (const key of Object.keys(environment))
    if (!environmentKeys.has(key)) reasons.push(`尚不支持环境字段 ${key}`);
  for (const key of Object.keys(verifier))
    if (
      ![
        'timeout_sec',
        'type',
        'service',
        'env',
        'hardening',
        'pytest_plugins',
        'import_path',
      ].includes(key)
    )
      reasons.push(`尚不支持评分字段 ${key}`);
  if (
    environment.mcp_servers !== undefined &&
    (!Array.isArray(environment.mcp_servers) || environment.mcp_servers.length)
  )
    reasons.push('尚不支持此题要求的 MCP 服务');
  const importPath = verifier.import_path;
  if (
    importPath !== undefined &&
    (datasetId !== 'workbuddy-code' || importPath !== 'workbuddy_bench.judge:CompositeVerifier')
  )
    reasons.push(`尚不支持评分入口 ${String(importPath)}`);
  if (verifier.service && verifier.service !== 'main')
    reasons.push(`尚不支持评分服务 ${verifier.service}`);
  const hardening = (verifier.hardening ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(hardening))
    if (key !== 'cleanup_conftests') reasons.push(`尚不支持评分隔离字段 ${key}`);
  if (hardening.cleanup_conftests !== undefined && typeof hardening.cleanup_conftests !== 'boolean')
    throw new Error('cleanup_conftests 必须为布尔值');
  const env: Record<string, string> = {};
  if (verifier.env && (typeof verifier.env !== 'object' || Array.isArray(verifier.env)))
    throw new Error('verifier.env 必须为对象');
  for (const [key, value] of Object.entries(verifier.env ?? {})) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ||
      /secret|password|token|api_?key|credential/iu.test(key)
    )
      throw new Error(`评分环境字段不能持久保存凭据：${key}`);
    if (!['string', 'number', 'boolean'].includes(typeof value))
      throw new Error(`评分环境变量无效：${key}`);
    env[key] = String(value);
  }
  const plugins = verifier.pytest_plugins ?? [];
  if (
    !Array.isArray(plugins) ||
    plugins.some((item) => typeof item !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.]*$/u.test(item))
  )
    throw new Error('pytest_plugins 必须为 Python 模块名列表');
  const candidateDirectories = ['/root', '/app', '/data', '/home/agent'];
  for (const directory of ['/outputs', '/opt/syzkaller'])
    if ((instruction + '\n' + dockerfile).includes(directory)) candidateDirectories.push(directory);
  const execution: DatasetExecution = {
    // 包含 Shape/Build/Verify 的实验使用原 Agent 预算的四倍，最多一天；原预算仍单独保留。
    timeoutSeconds: Math.min(86400, timeout * 4),
    buildTimeoutSeconds: Math.min(86400, originalBuild + 1200),
    candidateDirectories,
    networkMode,
    ...(cpus === undefined ? {} : { cpus }),
    ...(memoryMb === undefined ? {} : { memoryMb }),
    ...(storageMb === undefined ? {} : { storageMb }),
    storageEnforcement: storageMb === undefined ? 'not-requested' : 'candidate-monitor',
    controllerFilePolicy: 'exclude-harness-created-paths',
    limitations:
      storageMb === undefined
        ? []
        : [
            'Storage is monitored across candidate files every two seconds; this is not a kernel quota for the image filesystem.',
          ],
    verifier: {
      env,
      pytestPlugins: plugins,
      cleanupConftests: hardening.cleanup_conftests === true,
      ...(typeof importPath === 'string' ? { importPath } : {}),
    },
    metadata: metadata.metadata ?? {},
  };
  return { execution, reasons };
}
export interface DatasetPlan {
  scorerHash: string;
  observerHash: string;
  adapterHash: string;
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
  comparisonHash: string;
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
    let instruction: string, metadata: DatasetMetadata;
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
    const policy = executionPolicy(metadata, instruction, dockerfile, timeout, dataset.id);
    let reason: string | undefined = policy.reasons.length ? policy.reasons.join('；') : undefined;
    if (
      metadata.environment?.gpus ||
      (metadata.environment?.os && metadata.environment.os !== 'linux')
    )
      reason = '首期仅支持无 GPU 的 Linux 任务';
    if (!['/workspace', '/root', '/app', '/data'].includes(workdir))
      reason = `尚不支持工作目录 ${workdir}`;
    if (dataset.id === 'workbuddy-code') {
      const verifier = toml(await fs.readFile(path.join(source, 'tests/verifier.toml'), 'utf8'));
      if (
        options.datasetTreatment !== 'goal' &&
        (JSON.stringify(verifier).includes('repo_understanding') ||
          [
            'testing-hard-router_matching',
            'testing-medium-format_errors',
            'testing-medium-option_resolution',
            'testing-medium-request_builder',
          ].includes(id))
      )
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
      instructionHash: digest(instruction),
      execution: policy.execution,
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
  const observerHash = digest(
    await fs.readFile(path.join(packageRoot, 'eval/scaffold/python/dataset_pytest_observer.py')),
  );
  const adapterFiles: string[] = JSON.parse(
    await fs.readFile(path.join(packageRoot, 'eval/scaffold/dataset-adapter-files.json'), 'utf8'),
  );
  const adapter = createHash('sha256');
  for (const file of [...adapterFiles].sort()) {
    if (!file.startsWith('eval/') || file.includes('..') || path.isAbsolute(file))
      throw new Error('数据集适配器输入路径无效');
    adapter
      .update(file)
      .update('\0')
      .update(await fs.readFile(path.join(packageRoot, file)))
      .update('\0');
  }
  const adapterHash = `sha256:${adapter.digest('hex')}`;
  const comparisonHash = digest(
    JSON.stringify({
      dataset,
      tasks,
      count,
      sharedHash,
      datasetConfigHash,
      scorerHash,
      observerHash,
      adapterHash,
    }),
  );
  return {
    scorerHash,
    observerHash,
    adapterHash,
    comparisonHash,
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
      JSON.stringify({
        dataset,
        tasks,
        count,
        sharedHash,
        datasetConfigHash,
        scorerHash,
        observerHash,
        adapterHash,
      }),
    ),
  };
}
