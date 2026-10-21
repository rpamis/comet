import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import { launchEvalWorker } from '../../platform/process/eval-worker.js';
import {
  inspectProcessLiveness,
  inspectProcessTreeLiveness,
  readProcessIdentity,
  terminateRegisteredProcessTree,
} from '../../platform/process/process-identity.js';
import {
  cleanupEvalExecution,
  assertEvalContainerOwnership,
  registerEvalContainerOwnership,
  readEvalExecutionState,
  releaseEvalExecutionLock,
  writeEvalExecutionState,
  recordEvalProcessTermination,
} from './eval-run-cleanup.js';
import type { OwnedProcessInstance } from '../../platform/process/owned-command.js';
export { stopEvalContainers } from './eval-run-cleanup.js';
import { hashEvalSkill, previewEvalRun } from './eval-run-preview.js';
import type { ResolvedEvalContext } from './standalone-context.js';
import { inspectEvalContentFreshness } from './eval-run-freshness.js';
import {
  EvalRunError,
  evalRunPath,
  evalStoragePath,
  listEvalRuns,
  readEvalJson,
  readEvalRun,
  redactEvalOutput,
  writeEvalJson,
} from './eval-run-store.js';
import type { EvalReadOptions } from './eval-run-store.js';
import type { EvalManagedRun, EvalRunDetail } from './eval-run-types.js';

const STOP_GRACE_MS = 5_000;
const watchdogs = new Map<string, NodeJS.Timeout>();
const stopOperations = new Map<string, Promise<EvalRunDetail>>();
const watchdogFailures = new Map<string, number>();
const watchdogRetryAt = new Map<string, number>();
const watchdogKey = (project: string, id: string) => `${path.resolve(project)}\0${id}`;
const terminalStatuses = new Set(['completed', 'stopped', 'interrupted', 'unknown']);

function clearEvalWatchdog(project: string, id: string): void {
  const key = watchdogKey(project, id);
  const timer = watchdogs.get(key);
  if (timer) clearTimeout(timer);
  watchdogs.delete(key);
  watchdogFailures.delete(key);
  watchdogRetryAt.delete(key);
}

function executionDeadline(run: EvalManagedRun): number {
  const timeout = run.config.timeoutSeconds ?? 600;
  // 新记录以 worker 接管时间计时；旧 queued 记录不能按排队时间强杀。
  const started = Date.parse(run.startedAt ?? (run.status === 'queued' ? '' : run.createdAt));
  return Number.isFinite(started) && Number.isFinite(timeout) && timeout > 0
    ? started + timeout * 1000
    : Number.POSITIVE_INFINITY;
}

async function readStopRequest(project: string, id: string) {
  const request = await readEvalJson(await evalRunPath(project, id, 'stop-request.json'));
  return request?.runId === id &&
    typeof request.requestedAt === 'string' &&
    Number.isFinite(Date.parse(request.requestedAt))
    ? request
    : null;
}

/** 首次停止时间是恢复边界；重复请求或控制端重启不能重新开始宽限期。 */
async function persistStopRequest(
  project: string,
  id: string,
  reason: 'user' | 'timeout' = 'user',
): Promise<void> {
  const file = await evalRunPath(project, id, 'stop-request.json');
  await withRecoverableFileLock(`${file}.lock`, async () => {
    if (await readStopRequest(project, id)) return;
    await writeEvalJson(file, { runId: id, requestedAt: new Date().toISOString(), reason });
  });
}

/** 管理端监督与 worker 的事件循环分离；重启后读取持久化截止时间继续监督。 */
async function scheduleEvalWatchdog(project: string, run: EvalManagedRun): Promise<void> {
  const key = watchdogKey(project, run.id);
  if (terminalStatuses.has(run.status)) {
    clearEvalWatchdog(project, run.id);
    return;
  }
  const request = await readStopRequest(project, run.id);
  const deadline = request
    ? Date.parse(String(request.requestedAt)) + STOP_GRACE_MS
    : executionDeadline(run);
  const retryDelay = Math.min(60_000, STOP_GRACE_MS * 2 ** (watchdogFailures.get(key) ?? 0));
  const nextAttempt = Math.max(deadline, watchdogRetryAt.get(key) ?? 0);
  const delay =
    Number.isFinite(nextAttempt) && nextAttempt > Date.now()
      ? Math.min(2_147_483_647, nextAttempt - Date.now())
      : retryDelay;
  // 异步读取后再替换，避免并发刷新各自留下一个 timer。
  const previous = watchdogs.get(key);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    watchdogs.delete(key);
    // 故障诊断由 reconcile 持久化；定时器不能产生未处理拒绝。
    void reconcileEvalRun(project, run.id, { includeCaseContent: false }).catch(() => {});
  }, delay);
  timer.unref();
  watchdogs.set(key, timer);
}

export async function readManagedEvalRun(
  project: string,
  id: string,
): Promise<EvalManagedRun | null> {
  const file = await evalRunPath(project, id, 'dashboard-run.json');
  try {
    const data = await readEvalJson(file);
    if (data === null) return null;
    if (
      data.schema !== 'comet.eval.managed-run.v1' ||
      data.id !== id ||
      !data.config ||
      typeof data.config !== 'object' ||
      Array.isArray(data.config) ||
      ![
        'queued',
        'preparing',
        'generating',
        'running',
        'judging',
        'finalizing',
        'stopping',
        'completed',
        'stopped',
        'interrupted',
        'unknown',
      ].includes(String(data.status))
    )
      throw new Error('管理记录身份、配置或状态无效');
    return data as unknown as EvalManagedRun;
  } catch (error) {
    const hash = await fs
      .readFile(file)
      .then((bytes) => createHash('sha256').update(bytes).digest('hex'))
      .catch(() => 'unavailable');
    throw new EvalRunError(
      `Eval 管理记录损坏：${file}（sha256:${hash}）：${(error as Error).message}。原始证据未改动；请恢复已知良好备份，或核对旧执行已停止后调用 POST /runs/${encodeURIComponent(id)}/repair-managed-record（expectedHash、confirmedStopped=true）保留证据隔离；SDK 入口 repairManagedEvalRun(project, id, expectedHash, true)。`,
      409,
    );
  }
}
/** 必须由操作者核对停止状态；损坏记录无法自动证明原执行器已退出。 */
export async function repairManagedEvalRun(
  project: string,
  id: string,
  expectedHash: string,
  confirmedStopped: boolean,
) {
  if (confirmedStopped !== true || !/^[a-f0-9]{64}$/u.test(expectedHash))
    throw new EvalRunError(
      '请先核对旧执行器及容器均已停止，并提供当前管理记录的 expectedHash',
      409,
    );
  const lock = await evalStoragePath(project, 'locks', 'dashboard-launch.lock');
  await fs.mkdir(path.dirname(lock), { recursive: true });
  return withRecoverableFileLock(lock, async () => {
    const file = await evalRunPath(project, id, 'dashboard-run.json');
    return withRecoverableFileLock(`${file}.lock`, async () => {
      const bytes = await fs.readFile(file).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        const recovery = await readEvalJson(
          await evalRunPath(project, id, 'managed-record-recovery.json'),
        );
        if (
          recovery?.schema !== 'comet.eval.managed-record-recovery.v1' ||
          recovery.runId !== id ||
          recovery.sha256 !== expectedHash ||
          recovery.confirmedStopped !== true
        )
          throw new EvalRunError('管理记录或匹配的恢复收据不存在', 409);
        const retained = `dashboard-run.corrupt-${expectedHash}.json`;
        const backup = await fs.readFile(await evalRunPath(project, id, retained));
        if (createHash('sha256').update(backup).digest('hex') !== expectedHash)
          throw new EvalRunError('恢复证据摘要不匹配', 409);
        return null;
      });
      if (bytes === null)
        return {
          runId: id,
          retained: `dashboard-run.corrupt-${expectedHash}.json`,
          sha256: expectedHash,
          recovered: true,
        };
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expectedHash) throw new EvalRunError('管理记录已变化，请重新核对后恢复', 409);
      let corrupt = false;
      let ownerless = false;
      try {
        const record = await readManagedEvalRun(project, id);
        ownerless = Boolean(
          record &&
          !record.owner &&
          !record.child &&
          !['completed', 'stopped', 'interrupted', 'unknown'].includes(record.status),
        );
      } catch {
        corrupt = true;
      }
      if (!corrupt && !ownerless) throw new EvalRunError('管理记录有效，不需要隔离', 409);
      const retained = `dashboard-run.corrupt-${actual}.json`;
      // 先创建不可覆盖的原字节副本，再记录人工核对证据，最后移除启动扫描入口。
      const backup = await evalRunPath(project, id, retained);
      await fs
        .writeFile(backup, bytes, { flag: 'wx', mode: 0o600 })
        .catch(async (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST' || !(await fs.readFile(backup)).equals(bytes)) throw error;
        });
      await writeEvalJson(await evalRunPath(project, id, 'managed-record-recovery.json'), {
        schema: 'comet.eval.managed-record-recovery.v1',
        runId: id,
        sha256: actual,
        retained,
        confirmedStopped: true,
        ownerless,
        recoveredAt: new Date().toISOString(),
      });
      if (!(await fs.readFile(file)).equals(bytes))
        throw new EvalRunError('管理记录已变化，原文件保留，请重新核对', 409);
      if (ownerless) {
        await writeEvalExecutionState(project, id, { status: 'stopped' });
        await releaseEvalExecutionLock(project, id);
      }
      await fs.unlink(file);
      return { runId: id, retained, sha256: actual, recovered: true };
    });
  });
}
export async function updateManagedEvalRun(
  project: string,
  id: string,
  update: (run: EvalManagedRun) => void,
): Promise<EvalManagedRun> {
  const file = await evalRunPath(project, id, 'dashboard-run.json');
  let updated: EvalManagedRun;
  await withRecoverableFileLock(`${file}.lock`, async () => {
    const run = await readManagedEvalRun(project, id);
    if (!run) throw new EvalRunError('受管 Eval 运行不存在', 404);
    update(run);
    run.updatedAt = new Date().toISOString();
    await writeEvalJson(file, run);
    updated = run;
  });
  if (terminalStatuses.has(updated!.status)) {
    clearEvalWatchdog(project, id);
  }
  return updated!;
}
export interface StartEvalRunRequest {
  config: unknown;
  confirmationHash: string;
  requestId: string;
  baselineRunId?: string | null;
}
export async function startEvalRun(
  project: string,
  request: StartEvalRunRequest,
): Promise<EvalRunDetail> {
  if (
    !request ||
    typeof request.requestId !== 'string' ||
    !/^[\w-]{1,128}$/u.test(request.requestId)
  )
    throw new EvalRunError('需要有效的启动请求身份');
  const preview = await previewEvalRun(project, request.config);
  if (preview.confirmationHash !== request.confirmationHash)
    throw new EvalRunError('目标内容或配置已变化，请重新预检并确认', 409);
  if (preview.blockedReasons.length) throw new EvalRunError(preview.blockedReasons.join('\n'), 409);
  const lock = await evalStoragePath(project, 'locks', 'dashboard-launch.lock');
  await fs.mkdir(path.dirname(lock), { recursive: true });
  let resultId: string;
  await withRecoverableFileLock(lock, async () => {
    const root = await evalStoragePath(project, 'runs');
    const entries = await fs.readdir(root).catch(() => [] as string[]);
    for (const id of entries) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id)) continue;
      const old = await readManagedEvalRun(project, id);
      if (old?.requestId === request.requestId) {
        if (old.previewHash !== request.confirmationHash)
          throw new EvalRunError('启动请求已绑定其他配置，请重新确认', 409);
        resultId = old.id;
        return;
      }
    }
    if (request.baselineRunId) {
      const baseline = await readEvalRun(project, request.baselineRunId);
      if (!baseline.baselineEligible || baseline.target.id !== preview.target.id)
        throw new EvalRunError('所选基线无效或属于其他目标', 409);
    }
    const id = `comet-eval-${randomUUID()}`;
    const at = new Date().toISOString();
    const run: EvalManagedRun = {
      schema: 'comet.eval.managed-run.v1',
      id,
      origin: 'dashboard',
      createdAt: at,
      updatedAt: at,
      status: 'queued',
      launchPhase: 'pending',
      config: preview.config,
      targetId: preview.target.id,
      contentHash: preview.target.contentHash,
      previewHash: preview.confirmationHash,
      requestId: request.requestId,
      baselineRunId: request.baselineRunId ?? null,
    };
    await writeEvalJson(await evalRunPath(project, id, 'dashboard-run.json'), run);
    let dispatched = false;
    try {
      await registerEvalContainerOwnership(project, id);
      await updateManagedEvalRun(project, id, (current) => {
        current.launchPhase = 'dispatched';
      });
      dispatched = true;
      const owner = await launchEvalWorker(
        fileURLToPath(new URL('./eval-run-entry.js', import.meta.url)),
        project,
        id,
      );
      await updateManagedEvalRun(project, id, (current) => {
        if (!current.owner) current.owner = owner;
      });
    } catch (error) {
      await updateManagedEvalRun(project, id, (current) => {
        // 发出启动请求后可能已有未登记的进程，不能仅因登记失败宣称执行结束。
        if (!dispatched) current.status = 'interrupted';
        current.error = redactEvalOutput((error as Error).message);
      });
      throw error;
    }
    resultId = id;
  });
  const started = await readManagedEvalRun(project, resultId!);
  if (started) await scheduleEvalWatchdog(project, started);
  return readEvalRun(project, resultId!);
}
export async function requestStopEvalRun(project: string, id: string): Promise<EvalRunDetail> {
  const key = watchdogKey(project, id);
  const active = stopOperations.get(key);
  if (active) return active;
  const operation = stopManagedEvalRun(project, id).finally(() => stopOperations.delete(key));
  stopOperations.set(key, operation);
  return operation;
}

async function stopManagedEvalRun(project: string, id: string): Promise<EvalRunDetail> {
  const record = await readManagedEvalRun(project, id);
  if (!record) throw new EvalRunError('此历史运行没有可核对的执行身份', 409);
  const execution = await readEvalExecutionState(project, id);
  const terminal = ['completed', 'stopped'].includes(record.status);
  if (
    terminal &&
    ['completed', 'stopped'].includes(String(execution?.status)) &&
    (process.platform !== 'win32' || !record.child) &&
    (await assertEvalContainerOwnership(project, id).then(
      () => true,
      () => false,
    ))
  )
    return readEvalRun(project, id);
  await persistStopRequest(project, id);
  const request = await readStopRequest(project, id);
  const graceExpired = Boolean(
    request && Date.now() - Date.parse(String(request.requestedAt)) >= STOP_GRACE_MS,
  );
  const stopping = await updateManagedEvalRun(project, id, (current) => {
    // 工作进程可能刚完成清理；不要在其退出后留下新的 stopping 状态。
    if (
      !['completed', 'stopped'].includes(current.status) ||
      execution?.status === 'stopping' ||
      terminal
    )
      current.status = 'stopping';
  });
  if (['completed', 'stopped'].includes(stopping.status)) return readEvalRun(project, id);
  if (
    graceExpired ||
    terminal ||
    record.origin === 'cli' ||
    (execution && execution.status !== 'running')
  ) {
    try {
      let ownerFailure: unknown;
      // 宽限期内允许收尾；超时后只处理登记实例，当前嵌入式宿主始终保留。
      if (
        (graceExpired || !execution || execution.status === 'running') &&
        record.owner &&
        !['completed', 'interrupted', 'stopped'].includes(record.status)
      ) {
        try {
          const child = record.child;
          // 执行监管器有独立进程组，停止 owner 不会覆盖它。先停止已登记子树。
          if (child && child.pid !== process.pid) {
            const terminated = await terminateRegisteredProcessTree(child);
            if (terminated && child.instanceId)
              await recordEvalProcessTermination(project, id, child as OwnedProcessInstance, true);
          }
          // Creator/嵌入式调用不能杀掉当前宿主，只停止其已登记的执行树。
          if (record.owner.pid === process.pid) {
            if (!child || child.pid === process.pid)
              throw new EvalRunError('缺少可停止的执行子进程登记，停止未完成', 409);
          } else {
            const boundChild =
              process.platform === 'win32' &&
              child?.instanceId &&
              child.ownerPid === record.owner.pid &&
              (await inspectProcessLiveness(child.pid, child.identity)) === 'alive'
                ? (child as OwnedProcessInstance)
                : undefined;
            const terminated = await terminateRegisteredProcessTree(record.owner);
            if (terminated)
              await writeEvalJson(await evalRunPath(project, id, 'owner-cleanup.json'), {
                schema: 'comet.eval.owner-cleanup.v1',
                runId: id,
                owner: record.owner,
                confirmed: true,
              });
            if (terminated && boundChild)
              await recordEvalProcessTermination(project, id, boundChild, true);
            if (
              !terminated &&
              (await inspectProcessLiveness(record.owner.pid, record.owner.identity)) !== 'dead'
            )
              throw new EvalRunError('无法核对原执行进程身份，停止未完成', 409);
          }
        } catch (error) {
          ownerFailure = error;
        }
      }
      if (graceExpired && !record.owner && !record.child)
        ownerFailure ??= new EvalRunError('执行身份未登记，不能确认原执行已经停止', 409);
      await cleanupEvalExecution(project, id);
      if (
        record.owner &&
        record.owner.pid !== process.pid &&
        (await inspectProcessTreeLiveness(record.owner.pid, record.owner.identity)) !== 'dead'
      )
        ownerFailure ??= new EvalRunError('原执行进程树尚未确认停止', 409);
      if (ownerFailure) throw ownerFailure;
      const status = request?.reason === 'timeout' ? 'interrupted' : 'stopped';
      await writeEvalExecutionState(project, id, { status });
      await releaseEvalExecutionLock(project, id);
      await updateManagedEvalRun(project, id, (current) => {
        current.status = status;
        if (status === 'interrupted') current.error = '评估时限已到，管理端已确认停止执行';
        else delete current.error;
      });
    } catch (error) {
      await updateManagedEvalRun(project, id, (current) => {
        current.status = 'stopping';
        current.error = redactEvalOutput((error as Error).message);
      });
      const key = watchdogKey(project, id);
      const failures = Math.min(4, (watchdogFailures.get(key) ?? 0) + 1);
      watchdogFailures.set(key, failures);
      watchdogRetryAt.set(key, Date.now() + Math.min(60_000, STOP_GRACE_MS * 2 ** failures));
      const failed = await readManagedEvalRun(project, id);
      if (failed) await scheduleEvalWatchdog(project, failed);
      throw error;
    }
  }
  const latest = await readManagedEvalRun(project, id);
  if (latest) await scheduleEvalWatchdog(project, latest);
  return readEvalRun(project, id);
}
export async function reconcileEvalRun(
  project: string,
  id: string,
  options: EvalReadOptions = {},
): Promise<EvalRunDetail> {
  if (id.startsWith('archive-')) return readEvalRun(project, id, options);
  let record: EvalManagedRun | null;
  try {
    record = await readManagedEvalRun(project, id);
    if (!record || terminalStatuses.has(record.status)) clearEvalWatchdog(project, id);
  } catch (error) {
    clearEvalWatchdog(project, id);
    const detail = await readEvalRun(project, id, options);
    detail.diagnostics.push((error as Error).message);
    detail.availableActions.stop = false;
    return detail;
  }
  if (
    record &&
    !record.owner &&
    !record.child &&
    record.launchPhase === 'pending' &&
    ['queued', 'stopping'].includes(record.status)
  ) {
    const lock = await evalStoragePath(project, 'locks', 'dashboard-launch.lock');
    await fs.mkdir(path.dirname(lock), { recursive: true });
    // 与启动共用锁；pending 持久化期间尚未允许创建工作进程。
    await withRecoverableFileLock(lock, async () => {
      await updateManagedEvalRun(project, id, (current) => {
        if (
          !current.owner &&
          !current.child &&
          current.launchPhase === 'pending' &&
          ['queued', 'stopping'].includes(current.status)
        ) {
          current.status = current.status === 'stopping' ? 'stopped' : 'interrupted';
          current.error = '启动在创建工作进程前中断，现有记录已保留';
        }
      });
    });
    record = await readManagedEvalRun(project, id);
  }
  if (record && !terminalStatuses.has(record.status)) {
    const request = await readStopRequest(project, id);
    const graceExpired = Boolean(
      request && Date.now() - Date.parse(String(request.requestedAt)) >= STOP_GRACE_MS,
    );
    const budgetExpired = !request && Date.now() >= executionDeadline(record);
    if (
      (graceExpired || budgetExpired) &&
      Date.now() >= (watchdogRetryAt.get(watchdogKey(project, id)) ?? 0)
    ) {
      try {
        if (budgetExpired) await persistStopRequest(project, id, 'timeout');
        await requestStopEvalRun(project, id);
      } catch (error) {
        // 保留 stopping 和具体清理错误；重试不能制造停止证明。
        await updateManagedEvalRun(project, id, (current) => {
          current.error = redactEvalOutput(`执行状态核对未完成：${(error as Error).message}`);
        });
      }
      record = await readManagedEvalRun(project, id);
    }
    if (record) await scheduleEvalWatchdog(project, record);
  }
  if (
    record?.owner &&
    !['completed', 'stopped', 'interrupted'].includes(record.status) &&
    Date.now() >= (watchdogRetryAt.get(watchdogKey(project, id)) ?? 0)
  ) {
    const liveness = await inspectProcessLiveness(record.owner.pid, record.owner.identity);
    if (liveness === 'dead') {
      try {
        if ((await inspectProcessTreeLiveness(record.owner.pid, record.owner.identity)) !== 'dead')
          throw new Error('原执行进程树尚未确认停止');
        if (
          record.child &&
          (await inspectProcessLiveness(record.child.pid, record.child.identity)) !== 'dead'
        )
          throw new Error('执行子进程尚未确认停止');
        await cleanupEvalExecution(project, id);
        await writeEvalExecutionState(project, id, {
          status: record.status === 'stopping' ? 'stopped' : 'interrupted',
        });
        await releaseEvalExecutionLock(project, id);
        await updateManagedEvalRun(project, id, (current) => {
          current.status = record.status === 'stopping' ? 'stopped' : 'interrupted';
          current.error ??= '执行进程已退出，现有结果已保留';
        });
      } catch (error) {
        await updateManagedEvalRun(project, id, (current) => {
          current.error = redactEvalOutput(`执行状态核对未完成：${(error as Error).message}`);
        });
      }
    }
  }
  const detail = await readEvalRun(project, id, options);
  if (
    record &&
    !record.owner &&
    !record.child &&
    !['completed', 'stopped', 'interrupted', 'unknown'].includes(record.status)
  ) {
    const bytes = await fs.readFile(await evalRunPath(project, id, 'dashboard-run.json'));
    const hash = createHash('sha256').update(bytes).digest('hex');
    detail.diagnostics.push(
      `执行身份未登记，不能推断执行已停止；请核对旧执行器及容器均已停止后调用 repair-managed-record（expectedHash=${hash}、confirmedStopped=true）。`,
    );
  }
  if (record?.config.target && record.contentHash) {
    const freshness = await inspectEvalContentFreshness(project, record.config, record.contentHash);
    detail.stale = freshness.stale;
    if (freshness.diagnostic) detail.diagnostics.push(freshness.diagnostic);
  }
  return detail;
}
export async function collectEvalRuns(
  project: string,
  options: EvalReadOptions = {},
): Promise<EvalRunDetail[]> {
  const runs = await listEvalRuns(project, options);
  return Promise.all(
    runs.map((run) =>
      ['completed', 'stopped', 'interrupted', 'unknown'].includes(run.executionStatus)
        ? Promise.resolve(run)
        : reconcileEvalRun(project, run.id, options),
    ),
  );
}
export async function registerCliEvalRun(
  project: string,
  run: Omit<EvalManagedRun, 'schema' | 'origin' | 'createdAt' | 'updatedAt' | 'owner'>,
): Promise<void> {
  await registerEvalContainerOwnership(project, run.id);
  const identity = await readProcessIdentity(process.pid);
  const at = new Date().toISOString();
  await writeEvalJson(await evalRunPath(project, run.id, 'dashboard-run.json'), {
    ...run,
    schema: 'comet.eval.managed-run.v1',
    origin: 'cli',
    createdAt: at,
    updatedAt: at,
    owner: { pid: process.pid, ...(identity ? { identity } : {}) },
  });
}
export async function beginCliEvalTracking(
  context: ResolvedEvalContext,
  id: string,
  config: EvalManagedRun['config'],
): Promise<void> {
  const contentHash = await hashEvalSkill(context.skillRoot, context.manifestPath);
  await registerCliEvalRun(context.artifactOwnerRoot, {
    id,
    status: 'running',
    config,
    targetId: context.skillRoot,
    contentHash,
    previewHash: contentHash,
  });
}
export async function finishCliEvalTracking(
  project: string,
  id: string,
  error?: unknown,
): Promise<void> {
  const metadata = await readEvalJson(await evalRunPath(project, id, 'metadata.json'));
  const execution = await readEvalExecutionState(project, id);
  let status: EvalManagedRun['status'] = 'interrupted';
  let failure = error;
  let cleanupFailure: unknown;
  try {
    const registered = process.platform === 'win32' ? await readManagedEvalRun(project, id) : null;
    if (
      registered?.child ||
      !['completed', 'interrupted', 'stopped'].includes(String(execution?.status))
    )
      await cleanupEvalExecution(project, id);
    const stopped = await readEvalJson(await evalRunPath(project, id, 'stop-request.json'));
    status =
      stopped?.runId === id
        ? 'stopped'
        : execution?.status === 'completed' || (!execution && metadata?.completed_at)
          ? 'completed'
          : 'interrupted';
    await writeEvalExecutionState(project, id, { status });
    await releaseEvalExecutionLock(project, id);
  } catch (cleanupError) {
    status = 'stopping';
    const message = `Eval 清理尚未确认完成，请重试停止：${redactEvalOutput(
      cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    )}`;
    cleanupFailure = new EvalRunError(message, 409);
    failure = cleanupFailure;
    await writeEvalExecutionState(project, id, {
      status,
      error: message,
    });
  }
  await updateManagedEvalRun(project, id, (current) => {
    current.status = status;
    if (failure && status !== 'completed')
      current.error = redactEvalOutput(
        failure instanceof Error ? failure.message : String(failure),
      );
  });
  if (status === 'stopping') throw cleanupFailure;
}
