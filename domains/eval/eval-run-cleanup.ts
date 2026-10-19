import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { runExternalCommandAsync } from '../../platform/process/external-command.js';
import {
  inspectProcessTreeLiveness,
  terminateRegisteredProcessTree,
} from '../../platform/process/process-identity.js';
import type { OwnedProcessInstance } from '../../platform/process/owned-command.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import { EvalRunError, evalRunPath, readEvalJson, writeEvalJson } from './eval-run-store.js';

export interface EvalExecutionState {
  schema: 'comet.eval.execution.v1';
  runId: string;
  status: 'running' | 'completed' | 'interrupted' | 'stopping' | 'stopped';
  error?: string;
}

export async function readEvalExecutionState(
  project: string,
  id: string,
): Promise<EvalExecutionState | null> {
  const state = await readEvalJson(await evalRunPath(project, id, 'execution-state.json'));
  return state?.schema === 'comet.eval.execution.v1' &&
    state.runId === id &&
    ['running', 'completed', 'interrupted', 'stopping', 'stopped'].includes(String(state.status))
    ? (state as unknown as EvalExecutionState)
    : null;
}

export async function writeEvalExecutionState(
  project: string,
  id: string,
  state: Pick<EvalExecutionState, 'status' | 'error'>,
): Promise<void> {
  await writeEvalJson(await evalRunPath(project, id, 'execution-state.json'), {
    schema: 'comet.eval.execution.v1',
    runId: id,
    ...state,
  });
}

/** 规范项目根绑定容器归属；只传摘要，不把宿主私有路径写入标签。 */
export async function evalProjectIdentity(project: string): Promise<string> {
  const root = await fs.realpath(project);
  return createHash('sha256')
    .update(process.platform === 'win32' ? root.toLowerCase() : root)
    .digest('hex');
}

export async function registerEvalContainerOwnership(project: string, id: string): Promise<void> {
  const projectIdentity = await evalProjectIdentity(project);
  const file = await evalRunPath(project, id, 'container-ownership.json');
  const existing = await readEvalJson(file);
  if (existing) {
    await assertEvalContainerOwnership(project, id);
    return;
  }
  await writeEvalJson(file, {
    schema: 'comet.eval.container-ownership.v1',
    runId: id,
    projectIdentity,
  });
}

export async function assertEvalContainerOwnership(project: string, id: string): Promise<void> {
  const ownership = await readEvalJson(await evalRunPath(project, id, 'container-ownership.json'));
  if (
    ownership?.schema !== 'comet.eval.container-ownership.v1' ||
    ownership.runId !== id ||
    ownership.projectIdentity !== (await evalProjectIdentity(project))
  )
    throw new EvalRunError(
      '原评估缺少可核对的项目容器归属；请人工核对旧运行，不自动停止无归属容器',
      409,
    );
}

async function evalContainerIds(id: string, projectIdentity?: string): Promise<string[]> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id))
    throw new EvalRunError('实验容器身份无效，停止未完成', 409);
  const output = await runExternalCommandAsync(
    'docker',
    [
      'ps',
      '--all',
      '--quiet',
      '--filter',
      `label=comet.eval.experiment=${id}`,
      ...(projectIdentity ? ['--filter', `label=comet.eval.project=${projectIdentity}`] : []),
    ],
    { timeoutMs: 5000 },
  );
  const ids = output.trim().split(/\s+/u).filter(Boolean);
  if (ids.some((value) => !/^[a-f0-9]{12,64}$/u.test(value)))
    throw new EvalRunError('实验容器身份无效，停止未完成', 409);
  return ids;
}

export async function assertEvalContainersStopped(project: string, id: string): Promise<void> {
  const projectIdentity = await evalProjectIdentity(project);
  if ((await evalContainerIds(id, projectIdentity)).length)
    throw new EvalRunError('原实验容器仍未清理，停止未完成', 409);
  const sameExperiment = await evalContainerIds(id);
  if (!sameExperiment.length) return;
  const output = await runExternalCommandAsync(
    'docker',
    ['inspect', '--format', '{{json .Config.Labels}}', ...sameExperiment],
    { timeoutMs: 5000 },
  );
  const labels = output
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line) as Record<string, string> | null);
  if (labels.length !== sameExperiment.length)
    throw new EvalRunError('无法核对原实验容器归属，停止未完成', 409);
  if (labels.some((value) => value?.['comet.eval.project'] === projectIdentity))
    throw new EvalRunError('原实验容器仍未清理，停止未完成', 409);
  if (
    labels.some(
      (value) =>
        value?.['comet.eval.experiment'] !== id ||
        !/^[a-f0-9]{64}$/u.test(value?.['comet.eval.project'] ?? ''),
    )
  )
    throw new EvalRunError(
      '发现没有项目归属标识的旧实验容器；请人工核对后停止，现有结果已保留',
      409,
    );
}

/** 仅处理当前项目及实验的容器；无法复核时不能报告停止成功。 */
export async function stopEvalContainers(project: string, id: string): Promise<void> {
  const ids = await evalContainerIds(id, await evalProjectIdentity(project));
  if (ids.length) {
    // --rm 容器可能在 stop 后自行消失；最终查询决定清理是否完成。
    await runExternalCommandAsync('docker', ['stop', '--time', '5', ...ids], {
      timeoutMs: 15000,
    }).catch(() => {});
    await runExternalCommandAsync('docker', ['rm', '--force', ...ids], {
      timeoutMs: 10000,
    }).catch(() => {});
  }
  await assertEvalContainersStopped(project, id);
}

/** 绑定本次登记的进程实例；PID 消失或命令完成消息都不能替代整树终止收据。 */
export async function recordEvalProcessTermination(
  project: string,
  id: string,
  child: OwnedProcessInstance,
  confirmed: boolean,
): Promise<void> {
  const file = await evalRunPath(project, id, 'process-cleanup.json');
  await withRecoverableFileLock(`${file}.lock`, async () => {
    // Stop 与 owner 的 finally 可以并发；失败不能撤销同一实例已核验的终止。
    if (matchesProcessReceipt(await readEvalJson(file), id, child)) return;
    await writeEvalJson(file, {
      schema: 'comet.eval.process-cleanup.v1',
      runId: id,
      child,
      confirmed,
    });
  });
}

function matchesProcessReceipt(
  receipt: Record<string, unknown> | null,
  id: string,
  child: { pid: number; identity?: string; instanceId?: string; ownerPid?: number },
): boolean {
  const registered = receipt?.child as Partial<OwnedProcessInstance> | undefined;
  return (
    receipt?.schema === 'comet.eval.process-cleanup.v1' &&
    receipt.runId === id &&
    receipt.confirmed === true &&
    typeof child.instanceId === 'string' &&
    child.instanceId.length > 0 &&
    registered?.instanceId === child.instanceId &&
    registered.pid === child.pid &&
    registered.identity === child.identity &&
    registered.ownerPid === child.ownerPid
  );
}

export async function cleanupEvalExecution(project: string, id: string): Promise<void> {
  await assertEvalContainerOwnership(project, id);
  const record = await readEvalJson(await evalRunPath(project, id, 'dashboard-run.json'));
  const execution = await readEvalJson(await evalRunPath(project, id, 'execution-process.json'));
  const child = (record?.child ??
    (execution?.schema === 'comet.eval.execution-process.v1' && execution.runId === id
      ? execution.child
      : undefined)) as
    { pid: number; identity?: string; instanceId?: string; ownerPid?: number } | undefined;
  let stopped = !child;
  if (child) {
    let confirmed = process.platform !== 'win32';
    if (!confirmed) {
      try {
        confirmed = matchesProcessReceipt(
          await readEvalJson(await evalRunPath(project, id, 'process-cleanup.json')),
          id,
          child,
        );
        // 活着且创建身份匹配的监管器允许重试终止；组长已死不能补造旧树的证明。
        if (!confirmed && child.instanceId && (await terminateRegisteredProcessTree(child))) {
          await recordEvalProcessTermination(project, id, child as OwnedProcessInstance, true);
          confirmed = true;
        }
      } catch {
        // 探测或收据落盘失败仍要继续尝试容器止损。
        confirmed = false;
      }
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      if (confirmed && (await inspectProcessTreeLiveness(child.pid, child.identity)) === 'dead') {
        stopped = true;
        break;
      }
      if (!confirmed) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  // 即使宿主状态未知，也尽力停止正在收费的容器；仍保留可重试状态。
  await stopEvalContainers(project, id);
  if (!stopped) throw new EvalRunError('执行子进程尚未确认停止，现有结果已保留', 409);
}

export async function releaseEvalExecutionLock(project: string, id: string): Promise<void> {
  await fs.unlink(await evalRunPath(project, id, 'execution.lock')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
