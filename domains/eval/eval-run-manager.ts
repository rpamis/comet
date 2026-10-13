import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import { launchEvalWorker } from '../../platform/process/eval-worker.js';
import {
  inspectProcessLiveness,
  inspectProcessTreeLiveness,
  readProcessIdentity,
  terminateRegisteredProcessTree,
} from '../../platform/process/process-identity.js';
import { runExternalCommandAsync } from '../../platform/process/external-command.js';
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
export async function stopEvalContainers(id: string): Promise<void> {
  const ids = (
    await runExternalCommandAsync(
      'docker',
      ['ps', '--quiet', '--filter', `label=comet.eval.experiment=${id}`],
      { timeoutMs: 5000 },
    )
  )
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (ids.some((id) => !/^[a-f0-9]{12,64}$/u.test(id)))
    throw new EvalRunError('实验容器身份无效，停止未完成', 409);
  if (ids.length)
    await runExternalCommandAsync('docker', ['stop', '--time', '5', ...ids], { timeoutMs: 15000 });
  const remaining = (
    await runExternalCommandAsync(
      'docker',
      ['ps', '--quiet', '--filter', `label=comet.eval.experiment=${id}`],
      { timeoutMs: 5000 },
    )
  ).trim();
  if (remaining) throw new EvalRunError('原实验容器仍在运行', 409);
}
export async function requestStopEvalRun(project: string, id: string): Promise<EvalRunDetail> {
  const record = await readManagedEvalRun(project, id);
  if (!record) throw new EvalRunError('此历史运行没有可核对的执行身份', 409);
  if (['completed', 'stopped'].includes(record.status)) return readEvalRun(project, id);
  await writeEvalJson(await evalRunPath(project, id, 'stop-request.json'), {
    runId: id,
    requestedAt: new Date().toISOString(),
  });
  await updateManagedEvalRun(project, id, (current) => {
    current.status = 'stopping';
  });
  if (record.origin === 'cli' && record.owner) {
    if (
      !(await terminateRegisteredProcessTree(record.owner)) &&
      (await inspectProcessLiveness(record.owner.pid, record.owner.identity)) !== 'dead'
    )
      throw new EvalRunError('无法核对原执行进程身份，停止未完成', 409);
    if (record.child) {
      let childStopped = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        if (
          (await inspectProcessTreeLiveness(record.child.pid, record.child.identity)) === 'dead'
        ) {
          childStopped = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!childStopped) throw new EvalRunError('执行子进程尚未确认停止，现有结果已保留', 409);
    }
    await stopEvalContainers(id);
    await updateManagedEvalRun(project, id, (current) => {
      current.status = 'stopped';
    });
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
        await stopEvalContainers(id);
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
  const application = await readEvalJson(await evalRunPath(project, id, 'application-result.json'));
  await updateManagedEvalRun(project, id, (current) => {
    current.status = metadata?.completed_at || application?.status ? 'completed' : 'interrupted';
    if (error && current.status !== 'completed')
      current.error = redactEvalOutput(error instanceof Error ? error.message : String(error));
  });
}
