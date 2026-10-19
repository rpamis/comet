import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evalProjectIdentity,
  readEvalExecutionState,
  recordEvalProcessTermination,
  registerEvalContainerOwnership,
} from '../../../domains/eval/eval-run-cleanup.js';
import { runManagedEvalWorker as executeManagedEvalWorker } from '../../../domains/eval/eval-run-entry.js';
import {
  requestStopEvalRun,
  readManagedEvalRun,
  registerCliEvalRun,
  finishCliEvalTracking,
  updateManagedEvalRun,
  stopEvalContainers,
} from '../../../domains/eval/eval-run-manager.js';
import { writeEvalJson, evalRunPath, readEvalRun } from '../../../domains/eval/eval-run-store.js';
import {
  previewWorkflowApplicationEval,
  prepareWorkflowApplicationEval,
  runWorkflowApplicationEval as executeApplicationEval,
} from '../../../domains/eval/application-eval.js';
import { prepareWorkflowApplicationExample } from '../../../domains/workflow-generation/index.js';
import { runOwnedCommand } from '../../../platform/process/run-owned-command.js';
import { runExternalCommandAsync as executeExternalCommand } from '../../../platform/process/external-command.js';
import {
  inspectProcessTreeLiveness,
  terminateRegisteredProcessTree,
} from '../../../platform/process/process-identity.js';

let packageRoot: string;
vi.mock('../../../domains/eval/eval-run-preview.js', () => ({
  get evalPackageRoot() {
    return packageRoot;
  },
  previewEvalRun: vi.fn(async (_project, config) => ({
    config,
    target: { name: 'writer' },
    confirmationHash: 'preview',
    taskSource: 'authored',
    blockedReasons: [],
  })),
}));

// 持久文件模拟 Docker daemon；杀掉 CLI 进程不会自动删除其容器。
const fakeDocker = String.raw`
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const args = process.argv.slice(2), root = process.env.FAKE_DOCKER_ROOT;
const file = root + '/containers.json';
fs.appendFileSync(root + '/docker-calls.jsonl', JSON.stringify(args) + '\n');
let items = JSON.parse(fs.readFileSync(file, 'utf8'));
const atomicWrite = (target, value) => {
  const temporary = target + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, target);
};
const save = () => atomicWrite(file, items);
if (args[0] === 'run') {
  fs.mkdirSync(root + '/processes', { recursive: true });
  atomicWrite(root + '/processes/' + process.pid + '.json', { pid: process.pid, role: 'docker-client' });
  const label = args.find((value, index) => args[index - 1] === '--label' && value.startsWith('comet.eval.experiment='));
  const projectLabel = args.find((value, index) => args[index - 1] === '--label' && value.startsWith('comet.eval.project='));
  items.push({ id: 'abcdef123456', running: true, label: label ?? null, projectIdentity: projectLabel?.slice('comet.eval.project='.length) });
  save();
  // docker run 客户端随容器退出；杀客户端本身不删除 daemon 中的容器。
  if (!process.env.FAKE_DOCKER_EXIT) setInterval(() => {
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!current.some(item => item.id === 'abcdef123456' && item.running)) process.exit(0);
  }, 25);
} else if (args[0] === 'ps') {
  if (fs.existsSync(root + '/fail-query')) process.exit(1);
  if (fs.existsSync(root + '/hold-cleanup')) {
    fs.writeFileSync(root + '/cleanup-started', '1');
    const wait = new Int32Array(new SharedArrayBuffer(4));
    while (fs.existsSync(root + '/hold-cleanup')) Atomics.wait(wait, 0, 0, 10);
  }
  const filters = args.filter((value, index) => args[index - 1] === '--filter');
  if (!filters.some(value => value.startsWith('label=comet.eval.project=')) && fs.existsSync(root + '/delayed-container')) {
    items.push(JSON.parse(fs.readFileSync(root + '/delayed-container', 'utf8'))); save();
    fs.unlinkSync(root + '/delayed-container');
  }
  if (fs.existsSync(root + '/invalid-id')) console.log('--all');
  else for (const item of items) if (filters.every(filter => filter === 'label=' + item.label || filter === 'label=comet.eval.project=' + item.projectIdentity) && (item.running || args.includes('--all'))) console.log(item.id);
} else if (args[0] === 'inspect') {
  for (const id of args.filter(value => /^[a-f0-9]{12,64}$/.test(value))) {
    const item = items.find(value => value.id === id);
    if (!item) process.exit(1);
    console.log(JSON.stringify({ 'comet.eval.experiment': item.label?.slice('comet.eval.experiment='.length), ...(item.projectIdentity ? { 'comet.eval.project': item.projectIdentity } : {}) }));
  }
} else if (args[0] === 'stop' || args[0] === 'rm') {
  if (fs.existsSync(root + '/fail-cleanup')) process.exit(1);
  const ids = args.filter(value => /^[a-f0-9]{12,64}$/.test(value));
  if (args[0] === 'stop') for (const item of items) if (ids.includes(item.id)) item.running = false;
  else {}
  if (args[0] === 'rm') items = items.filter(item => !ids.includes(item.id));
  save();
} else if (args[0] === 'fixture-rewrite') {
  for (let index = 0; index < 500; index++) save();
}
`;

let project: string;
let pending: Set<Promise<unknown>>;
let managedWorkers: Set<string>;
let executionRuns: Set<string>;
let releaseBlockers: Set<() => void>;
function track<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  // 立即接住后台拒绝；调用方仍通过原 Promise 观察失败。
  void promise.catch(() => {});
  return promise;
}
function runExternalCommandAsync(...args: Parameters<typeof executeExternalCommand>) {
  return track(executeExternalCommand(...args));
}
async function fixtureProcessIsAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
  if (process.platform === 'linux') {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (!stat || /^[ZX] /u.test(stat.slice(stat.lastIndexOf(')') + 2))) return false;
  }
  return true;
}
async function fixtureProcesses(): Promise<Array<{ pid: number; role: string }>> {
  const directory = path.join(project, 'processes');
  const files = await fs.readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [] as string[];
    throw error;
  });
  return Promise.all(
    files
      .filter((name) => name.endsWith('.json'))
      .map(async (file) => JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'))),
  );
}
async function expectFixtureProcessesExited(): Promise<void> {
  await waitFor(async () => {
    for (const { pid } of await fixtureProcesses()) {
      if (await fixtureProcessIsAlive(pid)) return false;
    }
    return true;
  });
}
async function assertReleasedExecution(id: string): Promise<void> {
  const execution = await readEvalExecutionState(project, id);
  if (!['completed', 'interrupted', 'stopped'].includes(String(execution?.status))) return;
  const child = (await readManagedEvalRun(project, id))?.child;
  if (child) expect(await inspectProcessTreeLiveness(child.pid, child.identity)).toBe('dead');
  // 单独核对 CLI 与 Docker 客户端，不能仅凭监管器 PID 消失宣称子进程退出。
  await expectFixtureProcessesExited();
}
function runManagedEvalWorker(root: string, id: string) {
  managedWorkers.add(id);
  executionRuns.add(id);
  return track(executeManagedEvalWorker(root, id).finally(() => assertReleasedExecution(id)));
}
function runWorkflowApplicationEval(options: Parameters<typeof executeApplicationEval>[0]) {
  executionRuns.add(options.experimentId);
  return track(
    executeApplicationEval(options).finally(() => assertReleasedExecution(options.experimentId)),
  );
}
// Windows 首次进程身份探测和 Git Bash 启动较慢；仍让真实监管器触发短时限。
const applicationTimeoutMs = process.platform === 'win32' ? 8000 : 1500;
const lifecycleTimeoutMs = process.platform === 'win32' ? 60000 : 20000;
const startupWaitMs = process.platform === 'win32' ? 30000 : 5000;
async function exists(name: string) {
  return Boolean(await fs.stat(path.join(project, name)).catch(() => null));
}
async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + startupWaitMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('等待测试进程超时');
}
async function containers(): Promise<
  Array<{ id: string; running: boolean; label: string; projectIdentity?: string }>
> {
  return JSON.parse(await fs.readFile(path.join(project, 'containers.json'), 'utf8'));
}
async function register(id: string, timeoutSeconds = 30) {
  const at = new Date().toISOString();
  await writeEvalJson(await evalRunPath(project, id, 'dashboard-run.json'), {
    schema: 'comet.eval.managed-run.v1',
    id,
    origin: 'dashboard',
    createdAt: at,
    updatedAt: at,
    status: 'queued',
    config: {
      target: 'skill',
      targetType: 'skill',
      agent: 'codex',
      model: 'fixture-model',
      timeoutSeconds,
      maxTurns: 2,
    },
    targetId: 'writer',
    contentHash: 'content',
    previewHash: 'preview',
  });
}
async function application(id: string) {
  await fs.mkdir(path.join(project, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(project, 'node_modules/@rpamis/comet'), 'junction');
  const file = await prepareWorkflowApplicationExample({
    projectRoot: project,
    packageRoot: path.join(project, 'application'),
    base: 'standalone',
  });
  const options = {
    file,
    projectRoot: project,
    settings: { agent: 'codex', model: 'fixture-model', timeoutSeconds: 30, maxTurns: 2 },
  };
  const preview = await previewWorkflowApplicationEval(options);
  await registerCliEvalRun(project, {
    id,
    status: 'generating',
    targetId: preview.application.id,
    contentHash: preview.application.contentHash,
    previewHash: preview.confirmationHash,
    config: { target: file, targetType: 'application', ...preview.settings, suite: 'local' },
  });
  return {
    ...options,
    experimentId: id,
    confirmationHash: preview.confirmationHash,
    executeCommand: (
      _command: string,
      _args: readonly string[],
      execution?: Parameters<typeof runExternalCommandAsync>[2],
    ) =>
      track(
        runOwnedCommand(process.execPath, [path.join(packageRoot, 'bin/comet.js')], {
          cwd: project,
          env: execution!.env!,
          timeoutMs: applicationTimeoutMs,
          onRegistered: (child) =>
            updateManagedEvalRun(project, id, (current) => {
              current.child = child;
            }).then(() => {}),
          onTerminated: (child, confirmed) =>
            recordEvalProcessTermination(project, id, child, confirmed),
        }),
      ),
  };
}

beforeEach(async () => {
  pending = new Set();
  managedWorkers = new Set();
  executionRuns = new Set();
  releaseBlockers = new Set();
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-container-cleanup-'));
  packageRoot = path.join(project, 'package');
  await fs.mkdir(path.join(packageRoot, 'bin'), { recursive: true });
  const fakebin = path.join(project, 'fakebin');
  await fs.mkdir(fakebin);
  await fs.writeFile(path.join(fakebin, 'docker.cjs'), fakeDocker);
  await fs.writeFile(
    path.join(fakebin, 'docker'),
    `#!/usr/bin/env bash\nexec "${process.execPath.replaceAll('\\', '/')}" "$(dirname "$0")/docker.cjs" "$@"\n`,
    {
      mode: 0o700,
    },
  );
  await fs.writeFile(
    path.join(fakebin, 'docker.cmd'),
    `@echo off\r\n"${process.execPath}" "%~dp0docker.cjs" %*\r\n`,
  );
  await writeEvalJson(path.join(project, 'containers.json'), [
    { id: '123456abcdef', running: true, label: 'comet.eval.experiment=unrelated' },
  ]);
  const shell = path.join(project, 'run.sh');
  await fs.writeFile(
    shell,
    `source "$1"
resolve_runtime_image(){ printf '%s' fake-image; }
prepare_agent_workspace_owner(){ :; }
prepare_eval_runtime_data(){ COMET_RUNTIME_MOUNT_ARGS=(); }
build_env_args(){ ENV_ARGS=(); }
build_agent_runtime_mount_args(){ RUNTIME_CONFIG_MOUNT_ARGS=(); RUNTIME_CONFIG_TMPFS_ARGS=(); }
build_plugin_args(){ PLUGIN_MOUNT_ARGS=(); PLUGIN_CLI_ARGS=(); }
build_langfuse_plugin_args(){ LANGFUSE_PLUGIN_MOUNT_ARGS=(); LANGFUSE_PLUGIN_CLI_ARGS=(); }
build_trusted_oracle_mount_args(){ TRUSTED_ORACLE_MOUNT_ARGS=(); }
docker_run_agent_loop "$2" 'Test prompt' --agent codex --max-turns 2
`,
  );
  const bashPath = (value: string) => value.replaceAll('\\', '/');
  await fs.writeFile(
    path.join(packageRoot, 'bin/comet.js'),
    `const fs=require('node:fs'), {spawnSync}=require('node:child_process');
const root=process.env.FAKE_DOCKER_ROOT;
fs.mkdirSync(root+'/processes',{recursive:true});
const record=root+'/processes/'+process.pid+'.json';
fs.writeFileSync(record+'.tmp',JSON.stringify({pid:process.pid,role:'fixture-cli'})); fs.renameSync(record+'.tmp',record);
const result=spawnSync('bash',${JSON.stringify([bashPath(shell), bashPath(path.resolve('eval/scaffold/shell/docker.sh')), bashPath(project)])},{stdio:'inherit'}); process.exit(result.status ?? 1);`,
  );
  vi.spyOn(os, 'homedir').mockReturnValue(path.join(project, 'home'));
  vi.stubEnv('PATH', fakebin + path.delimiter + process.env.PATH);
  vi.stubEnv('FAKE_DOCKER_ROOT', project);
  vi.stubEnv('HOME', path.join(project, 'home'));
  vi.stubEnv('USERPROFILE', path.join(project, 'home'));
  for (const name of [
    'COMET_APPLICATION_EVAL_CONTEXT',
    'COMET_EVAL_MANAGED',
    'COMET_EVAL_MANAGED_JUDGE',
    'COMET_EVAL_CASE_SELECTION',
  ])
    vi.stubEnv(name, undefined);
});
async function settleFixtureExecutions(): Promise<void> {
  for (const release of releaseBlockers) release();
  for (const name of ['hold-cleanup', 'fail-query', 'fail-cleanup', 'invalid-id'])
    await fs.rm(path.join(project, name), { force: true });
  for (const id of managedWorkers)
    await writeEvalJson(await evalRunPath(project, id, 'stop-request.json'), { runId: id });
  let observed = -1;
  while (observed !== pending.size) {
    observed = pending.size;
    await Promise.allSettled([...pending]);
  }
}
afterEach(async () => {
  try {
    await settleFixtureExecutions();
    // 故障用例允许保留 stopping；断言后关闭本 fixture 的 daemon 状态，等待客户端退出。
    await writeEvalJson(path.join(project, 'containers.json'), []);
    let cleanupFailure: unknown;
    try {
      await expectFixtureProcessesExited();
    } catch (error) {
      cleanupFailure = error;
      // 失败也回收已核对身份的本测试子进程；仍抛出失败，不能用强杀令测试变绿。
      for (const id of executionRuns) {
        const child = (await readManagedEvalRun(project, id))?.child;
        if (child?.identity) await terminateRegisteredProcessTree(child);
      }
      await expectFixtureProcessesExited();
    }
    await fs.rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    if (cleanupFailure) throw cleanupFailure;
  } finally {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
});

describe('真实宿主进程与持久 Docker 替身', () => {
  it('Docker 替身的并发查询不会读到截断的容器记录', async () => {
    let finished = false;
    const rewriting = runExternalCommandAsync(process.execPath, [
      path.join(project, 'fakebin/docker.cjs'),
      'fixture-rewrite',
    ]).finally(() => {
      finished = true;
    });
    track(rewriting);
    let reads = 0;
    while (!finished) {
      expect(await containers()).toHaveLength(1);
      reads++;
    }
    await rewriting;
    expect(reads).toBeGreaterThan(0);
  });

  it('Docker 替身客户端在容器停止后退出，不占用测试目录', async () => {
    const client = runExternalCommandAsync('docker', [
      'run',
      '--label',
      'comet.eval.experiment=client-exit',
    ]);
    await waitFor(async () => (await containers()).length === 2);
    await runExternalCommandAsync('docker', ['stop', 'abcdef123456']);
    await client;
    await expectFixtureProcessesExited();
  });

  it(
    '测试提前失败也先停止并等待后台 worker，再删除目录',
    async () => {
      await register('early-assertion-failure');
      await expect(
        (async () => {
          runManagedEvalWorker(project, 'early-assertion-failure');
          await waitFor(async () => (await containers()).length === 2);
          throw new Error('模拟测试断言提前失败');
        })(),
      ).rejects.toThrow('模拟测试断言提前失败');
      await settleFixtureExecutions();
      expect((await readEvalRun(project, 'early-assertion-failure')).executionStatus).toBe(
        'stopped',
      );
      await expectFixtureProcessesExited();
      const settled = await Promise.allSettled([...pending]);
      expect(settled.every((result) => result.status === 'fulfilled')).toBe(true);
    },
    lifecycleTimeoutMs,
  );

  it.each([undefined, '{}'])(
    '普通 Skill 与 Application 的所有单轮、多轮入口带清理标识（context=%s）',
    async (context) => {
      vi.stubEnv('COMET_APPLICATION_EVAL_CONTEXT', context);
      vi.stubEnv('COMET_EVAL_EXPERIMENT_ID', 'shell-labels');
      vi.stubEnv('COMET_EVAL_PROJECT_ID', await evalProjectIdentity(project));
      vi.stubEnv('FAKE_DOCKER_EXIT', '1');
      const file = path.join(project, 'run.sh');
      const script = await fs.readFile(file, 'utf8');
      await fs.writeFile(
        file,
        script.replace('docker_run_agent_loop "$2"', 'docker_run_agent "$2"') +
          '\ndocker_run_claude_loop "$2" test --max-turns 2\ndocker_run_agent_loop "$2" test --agent codex --max-turns 2\n',
      );
      await runExternalCommandAsync(process.execPath, [path.join(packageRoot, 'bin/comet.js')], {
        cwd: project,
      });
      const calls = (await fs.readFile(path.join(project, 'docker-calls.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[]);
      const runs = calls.filter((args) => args[0] === 'run');
      expect(runs).toHaveLength(3);
      for (const args of runs) {
        expect(args).toContain('comet.eval.experiment=shell-labels');
        expect(args).toContain('comet.eval.project=' + (await evalProjectIdentity(project)));
      }
    },
  );

  it.each(['stop', 'timeout'])(
    '普通 Skill 的 %s 会清理有实验标识的容器并保留其他实验',
    async (mode) => {
      const id = 'managed-' + mode;
      await register(id, mode === 'timeout' ? (process.platform === 'win32' ? 8 : 1) : 30);
      const worker = runManagedEvalWorker(project, id);
      await waitFor(async () => (await containers()).length === 2);
      expect((await containers())[1].label).toBe('comet.eval.experiment=' + id);
      if (mode === 'stop') await requestStopEvalRun(project, id);
      await worker;
      expect((await readEvalRun(project, id)).executionStatus).toBe(
        mode === 'stop' ? 'stopped' : 'interrupted',
      );
      expect(await containers()).toEqual([
        { id: '123456abcdef', running: true, label: 'comet.eval.experiment=unrelated' },
      ]);
    },
    lifecycleTimeoutMs,
  );

  it(
    'Application 总超时清理后保持 interrupted，不用 incomplete 报告冒充 completed',
    async () => {
      const options = await application('app-timeout');
      const result = await runWorkflowApplicationEval(options);
      await finishCliEvalTracking(project, options.experimentId);
      expect(result.status).toBe('incomplete');
      expect(await fs.readFile(path.join(project, 'docker-calls.jsonl'), 'utf8')).toContain(
        '"comet.eval.experiment=app-timeout"',
      );
      expect((await readEvalRun(project, options.experimentId)).executionStatus).toBe(
        'interrupted',
      );
      expect(await containers()).toHaveLength(1);
      expect(await exists('.comet/eval/runs/app-timeout/execution.lock')).toBe(false);
    },
    lifecycleTimeoutMs,
  );

  it(
    '清理失败保留 stopping 和锁，恢复 Docker 后 Stop 可以重试',
    async () => {
      const options = await application('cleanup-failure');
      await fs.writeFile(path.join(project, 'fail-cleanup'), '1');
      const result = await runWorkflowApplicationEval(options);
      await expect(finishCliEvalTracking(project, options.experimentId)).rejects.toThrow(
        '停止未完成',
      );
      expect(result.status).toBe('incomplete');
      expect(result.failures.join(' ')).toContain('清理未完成');
      expect((await readEvalRun(project, options.experimentId)).executionStatus).toBe('stopping');
      expect(await exists('.comet/eval/runs/cleanup-failure/execution.lock')).toBe(true);
      await expect(runWorkflowApplicationEval(options)).rejects.toThrow('停止未完成');
      await updateManagedEvalRun(project, options.experimentId, (current) => {
        current.status = 'completed';
      });
      expect((await readEvalRun(project, options.experimentId)).executionStatus).toBe('stopping');
      await fs.unlink(path.join(project, 'fail-cleanup'));
      expect((await requestStopEvalRun(project, options.experimentId)).executionStatus).toBe(
        'stopped',
      );
      expect(await containers()).toHaveLength(1);
      expect(await exists('.comet/eval/runs/cleanup-failure/execution.lock')).toBe(false);
    },
    lifecycleTimeoutMs,
  );

  it('用例低分保持 failed 结论，资源收尾成功仍是 completed', async () => {
    const id = 'failed-quality';
    await register(id);
    const runRoot = path.join(project, '.comet/eval/runs', id);
    await fs.writeFile(
      path.join(packageRoot, 'bin/comet.js'),
      `
      const fs = require('node:fs'), root = ${JSON.stringify(runRoot)};
      fs.mkdirSync(root + '/reports');
      fs.writeFileSync(root + '/metadata.json', JSON.stringify({ completed_at: new Date().toISOString(), pytest_exitstatus: 1, expected_case_matrix: { case_count: 1 } }));
      fs.writeFileSync(root + '/reports/task_report.json', JSON.stringify({ name: 'task', passed: false, checks_passed: [], checks_failed: ['quality'], sample_quality: { status: 'included' }, events_summary: { task: 'task', case_manifest: { task_hash: 'task', validator_hash: 'rule' } } }));
      process.exitCode = 1;
    `,
    );
    await runManagedEvalWorker(project, id);
    expect(await readEvalRun(project, id)).toMatchObject({
      executionStatus: 'completed',
      conclusion: 'failed',
    });
  });

  it('Creator 在清理失败记录后崩溃且没有结果时仅恢复清理，不重跑模型', async () => {
    const options = await application('creator-cleanup-recovery');
    await prepareWorkflowApplicationEval(options);
    await fs.unlink(await evalRunPath(project, options.experimentId, 'dashboard-run.json'));
    await writeEvalJson(await evalRunPath(project, options.experimentId, 'execution-state.json'), {
      schema: 'comet.eval.execution.v1',
      runId: options.experimentId,
      status: 'stopping',
    });
    const child = {
      pid: 999999999,
      identity: 'finished-fixture',
      instanceId: 'creator-stopped',
      ownerPid: process.pid,
    };
    await writeEvalJson(
      await evalRunPath(project, options.experimentId, 'execution-process.json'),
      {
        schema: 'comet.eval.execution-process.v1',
        runId: options.experimentId,
        child,
      },
    );
    await recordEvalProcessTermination(project, options.experimentId, child, true);
    await fs.writeFile(await evalRunPath(project, options.experimentId, 'execution.lock'), '');
    const current = await containers();
    current.push({
      id: 'abcdef123456',
      running: true,
      label: 'comet.eval.experiment=' + options.experimentId,
      projectIdentity: await evalProjectIdentity(project),
    });
    await writeEvalJson(path.join(project, 'containers.json'), current);
    const executeCommand = vi.fn(async () => '');
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(runWorkflowApplicationEval({ ...options, executeCommand })).rejects.toThrow(
        '原评估缺少完整的绑定结果',
      );
    }
    expect(executeCommand).not.toHaveBeenCalled();
    expect(await containers()).toHaveLength(1);
    expect(await exists('.comet/eval/runs/creator-cleanup-recovery/execution.lock')).toBe(false);
    expect((await readEvalRun(project, options.experimentId)).executionStatus).toBe('interrupted');
  });

  it('Application 子进程退出成功但没有绑定结果时保持 interrupted', async () => {
    const options = await application('missing-result');
    await expect(
      runWorkflowApplicationEval({ ...options, executeCommand: async () => '' }),
    ).rejects.toThrow('未生成与当前应用绑定的结果');
    await finishCliEvalTracking(project, options.experimentId);
    expect((await readEvalRun(project, options.experimentId)).executionStatus).toBe('interrupted');
    expect(await exists('.comet/eval/runs/missing-result/execution.lock')).toBe(false);
  });

  it(
    'Application 收尾与 Stop 同时释放执行锁时不会误报失败',
    async () => {
      const options = await application('lock-release-race');
      const lockPath = await evalRunPath(project, options.experimentId, 'execution.lock');
      const unlink = fs.unlink.bind(fs);
      let release!: () => void;
      let entered!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      releaseBlockers.add(release);
      let first = true;
      vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
        if (String(file) === lockPath && first) {
          first = false;
          entered();
          await released;
        }
        return unlink(file);
      });
      const pending = runWorkflowApplicationEval(options);
      await enteredPromise;
      try {
        expect((await requestStopEvalRun(project, options.experimentId)).executionStatus).toBe(
          'stopped',
        );
      } finally {
        release();
      }
      expect((await pending).status).toBe('incomplete');
      expect(await exists('.comet/eval/runs/lock-release-race/execution.lock')).toBe(false);
    },
    lifecycleTimeoutMs,
  );

  it(
    '最后一次轮询后到达的 Stop 不会被 completed 覆盖',
    async () => {
      const id = 'late-stop';
      await register(id);
      await fs.writeFile(path.join(project, 'hold-cleanup'), '1');
      await fs.writeFile(
        path.join(packageRoot, 'bin/comet.js'),
        `require('node:fs').writeFileSync(${JSON.stringify(path.join(project, '.comet/eval/runs', id, 'metadata.json'))},JSON.stringify({completed_at:new Date().toISOString()}));`,
      );
      const worker = runManagedEvalWorker(project, id);
      await waitFor(() => exists('cleanup-started'));
      await requestStopEvalRun(project, id);
      await fs.unlink(path.join(project, 'hold-cleanup'));
      await worker;
      expect((await readEvalRun(project, id)).executionStatus).toBe('stopped');
    },
    lifecycleTimeoutMs,
  );

  it.each([true, false])(
    '冷启动 stopping 运行会核对旧容器及启动归属（owned=%s）',
    async (owned) => {
      const id = 'cold-stopping';
      await register(id);
      if (owned) await registerEvalContainerOwnership(project, id);
      const child = {
        pid: 999999999,
        identity: 'finished-fixture',
        instanceId: 'cold-stopped',
        ownerPid: process.pid,
      };
      await updateManagedEvalRun(project, id, (current) => {
        current.status = 'stopping';
        current.child = child;
      });
      await recordEvalProcessTermination(project, id, child, true);
      await writeEvalJson(await evalRunPath(project, id, 'stop-request.json'), { runId: id });
      await writeEvalJson(path.join(project, 'containers.json'), [
        {
          id: 'abcdef123456',
          running: true,
          label: 'comet.eval.experiment=' + id,
          projectIdentity: await evalProjectIdentity(project),
        },
      ]);
      await runManagedEvalWorker(project, id);
      expect((await readEvalRun(project, id)).executionStatus).toBe(owned ? 'stopped' : 'stopping');
      expect(await containers()).toHaveLength(owned ? 0 : 1);
    },
  );

  it('清理复核间延迟出现的本项目容器不能被当作其他项目跳过', async () => {
    await fs.writeFile(
      path.join(project, 'delayed-container'),
      JSON.stringify({
        id: 'abcdef123456',
        running: true,
        label: 'comet.eval.experiment=delayed',
        projectIdentity: await evalProjectIdentity(project),
      }),
    );
    await expect(stopEvalContainers(project, 'delayed')).rejects.toThrow('停止未完成');
    expect((await containers()).some((item) => item.id === 'abcdef123456')).toBe(true);
  });

  it('相同实验ID的其他项目容器不会被停止，路径别名使用相同项目摘要', async () => {
    const other = path.join(project, '另一个项目 with spaces');
    await fs.mkdir(other);
    const alias = path.join(project, 'project-alias');
    await fs.symlink(other, alias, 'junction');
    expect(await evalProjectIdentity(alias)).toBe(await evalProjectIdentity(other));
    const own = {
      id: 'abcdef123456',
      running: true,
      label: 'comet.eval.experiment=same-id',
      projectIdentity: await evalProjectIdentity(project),
    };
    const foreign = {
      id: 'fedcba654321',
      running: true,
      label: own.label,
      projectIdentity: await evalProjectIdentity(other),
    };
    await writeEvalJson(path.join(project, 'containers.json'), [own, foreign]);
    await stopEvalContainers(project, 'same-id');
    expect(await containers()).toEqual([foreign]);
  });

  it('旧容器缺项目标签或旧运行缺启动归属记录时拒绝声称停止', async () => {
    await writeEvalJson(path.join(project, 'containers.json'), [
      { id: 'abcdef123456', running: true, label: 'comet.eval.experiment=legacy' },
    ]);
    await expect(stopEvalContainers(project, 'legacy')).rejects.toThrow('旧实验容器');
    expect((await containers())[0].running).toBe(true);
    await register('legacy');
    await writeEvalJson(await evalRunPath(project, 'legacy', 'execution-state.json'), {
      schema: 'comet.eval.execution.v1',
      runId: 'legacy',
      status: 'stopping',
    });
    await expect(requestStopEvalRun(project, 'legacy')).rejects.toThrow('缺少可核对的项目容器归属');
    expect((await readEvalRun(project, 'legacy')).executionStatus).toBe('stopping');
  });

  it('Docker 查询失败或异常身份不能被当作没有容器', async () => {
    await fs.writeFile(path.join(project, 'fail-query'), '1');
    await expect(stopEvalContainers(project, 'target')).rejects.toThrow();
    await fs.unlink(path.join(project, 'fail-query'));
    await fs.writeFile(path.join(project, 'invalid-id'), '1');
    await expect(stopEvalContainers(project, 'target')).rejects.toThrow('身份无效');
    const calls = await fs.readFile(path.join(project, 'docker-calls.jsonl'), 'utf8');
    expect(calls).not.toContain('["stop"');
    expect(calls).not.toContain('["rm"');
  });
});
