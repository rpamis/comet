import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import { launchEvalWorker } from '../../platform/process/eval-worker.js';
import {
  inspectProcessLiveness,
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
import type { EvalManagedRun, EvalRunDetail } from './eval-run-types.js';

export async function readManagedEvalRun(
  project: string,
  id: string,
): Promise<EvalManagedRun | null> {
  const data = await readEvalJson(await evalRunPath(project, id, 'dashboard-run.json'));
  return data?.schema === 'comet.eval.managed-run.v1' && data.id === id
    ? (data as unknown as EvalManagedRun)
    : null;
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
      config: preview.config,
      targetId: preview.target.id,
      contentHash: preview.target.contentHash,
      previewHash: preview.confirmationHash,
      requestId: request.requestId,
      baselineRunId: request.baselineRunId ?? null,
    };
    await writeEvalJson(await evalRunPath(project, id, 'dashboard-run.json'), run);
    await registerEvalContainerOwnership(project, id);
    try {
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
        current.status = 'interrupted';
        current.error = redactEvalOutput((error as Error).message);
      });
      throw error;
    }
    resultId = id;
  });
  return readEvalRun(project, resultId!);
}
export async function requestStopEvalRun(project: string, id: string): Promise<EvalRunDetail> {
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
  await writeEvalJson(await evalRunPath(project, id, 'stop-request.json'), {
    runId: id,
    requestedAt: new Date().toISOString(),
  });
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
  if (terminal || record.origin === 'cli' || (execution && execution.status !== 'running')) {
    try {
      let ownerFailure: unknown;
      // 收尾已经开始时不能再终止调用方，它可能仍在保存报告或处理其他任务。
      if (
        (!execution || execution.status === 'running') &&
        record.owner &&
        !['completed', 'interrupted', 'stopped'].includes(record.status)
      ) {
        try {
          const child = record.child;
          // Creator/嵌入式调用不能杀掉当前宿主，只停止其已登记的执行树。
          if (record.owner.pid === process.pid) {
            if (!child || child.pid === process.pid)
              throw new EvalRunError('缺少可停止的执行子进程登记，停止未完成', 409);
            if (await terminateRegisteredProcessTree(child)) {
              if (child.instanceId)
                await recordEvalProcessTermination(
                  project,
                  id,
                  child as OwnedProcessInstance,
                  true,
                );
            }
          } else {
            const boundChild =
              process.platform === 'win32' &&
              child?.instanceId &&
              child.ownerPid === record.owner.pid &&
              (await inspectProcessLiveness(child.pid, child.identity)) === 'alive'
                ? (child as OwnedProcessInstance)
                : undefined;
            const terminated = await terminateRegisteredProcessTree(record.owner);
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
      await cleanupEvalExecution(project, id);
      if (ownerFailure) throw ownerFailure;
      await writeEvalExecutionState(project, id, { status: 'stopped' });
      await releaseEvalExecutionLock(project, id);
      await updateManagedEvalRun(project, id, (current) => {
        current.status = 'stopped';
        delete current.error;
      });
    } catch (error) {
      await updateManagedEvalRun(project, id, (current) => {
        current.status = 'stopping';
        current.error = redactEvalOutput((error as Error).message);
      });
      throw error;
    }
  }
  return readEvalRun(project, id);
}
export async function reconcileEvalRun(project: string, id: string): Promise<EvalRunDetail> {
  if (id.startsWith('archive-')) return readEvalRun(project, id);
  const record = await readManagedEvalRun(project, id);
  if (record?.owner && !['completed', 'stopped', 'interrupted'].includes(record.status)) {
    const liveness = await inspectProcessLiveness(record.owner.pid, record.owner.identity);
    if (liveness === 'dead') {
      try {
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
  const detail = await readEvalRun(project, id);
  if (record?.config.target && record.contentHash) {
    const freshness = await inspectEvalContentFreshness(project, record.config, record.contentHash);
    detail.stale = freshness.stale;
    if (freshness.diagnostic) detail.diagnostics.push(freshness.diagnostic);
  }
  return detail;
}
export async function collectEvalRuns(project: string): Promise<EvalRunDetail[]> {
  const runs = await listEvalRuns(project);
  return Promise.all(
    runs.map((run) =>
      ['completed', 'stopped', 'interrupted', 'unknown'].includes(run.executionStatus)
        ? Promise.resolve(run)
        : reconcileEvalRun(project, run.id),
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
