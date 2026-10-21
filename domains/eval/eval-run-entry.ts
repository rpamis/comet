import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { spawnOwnedCommand } from '../../platform/process/owned-command.js';
import {
  inspectProcessTreeLiveness,
  readProcessIdentity,
} from '../../platform/process/process-identity.js';
import { terminateProcessTreeConfirmed } from '../../platform/process/terminate-process-tree.js';
import type { ExternalCommandOptions } from '../../platform/process/external-command.js';
import { loadUserEvalEnvironment } from './user-environment.js';
import { runWorkflowApplicationEval } from './application-eval.js';
import { applicationEvalSettings, evalPackageRoot, previewEvalRun } from './eval-run-preview.js';
import { readManagedEvalRun, updateManagedEvalRun } from './eval-run-manager.js';
import { evalRunPath, readEvalJson, redactEvalOutput, writeEvalJson } from './eval-run-store.js';
import {
  readEvalExecutionState,
  cleanupEvalExecution,
  registerEvalContainerOwnership,
  evalProjectIdentity,
  writeEvalExecutionState,
  recordEvalProcessTermination,
} from './eval-run-cleanup.js';
import type { EvalManagedRun } from './eval-run-types.js';

export async function runManagedEvalWorker(project: string, id: string): Promise<void> {
  loadUserEvalEnvironment(process.env, undefined, { create: false });
  const original = await readManagedEvalRun(project, id);
  if (!original || !['queued', 'stopping'].includes(original.status))
    throw new Error('Eval 启动记录不存在或已经执行');
  if (original.launchPhase === 'pending') throw new Error('Eval 启动请求尚未持久化');
  if (original.status === 'queued') await registerEvalContainerOwnership(project, id);
  process.env.COMET_EVAL_MANAGED = '1';
  if (original.config.judgeEnabled !== undefined)
    process.env.COMET_EVAL_MANAGED_JUDGE = original.config.judgeEnabled ? '1' : '0';
  const ownIdentity = await readProcessIdentity(process.pid);
  await updateManagedEvalRun(project, id, (current) => {
    if (!['queued', 'stopping'].includes(current.status) || current.launchPhase === 'pending')
      throw new Error('Eval 启动记录已恢复或已经执行');
    current.owner = { pid: process.pid, ...(ownIdentity ? { identity: ownIdentity } : {}) };
    current.startedAt ??= new Date().toISOString();
    if (current.status !== 'stopping') current.status = 'preparing';
  });
  const controller = new AbortController();
  let stopping = false;
  let deadlineExceeded = false;
  let executionStarted = false;
  let processesStopped = true;
  let polling = false;
  let exitCode: number | null = null;
  let lastError: unknown;
  let logBytes = 0;
  let outputPending = Promise.resolve();
  const loggedActivities = new Set<string>();
  const log = async (content: string): Promise<void> => {
    const safe = redactEvalOutput(content);
    if (logBytes >= 4 * 1024 * 1024) return;
    const bytes = Buffer.from(safe).subarray(0, 4 * 1024 * 1024 - logBytes);
    logBytes += bytes.length;
    await fs.appendFile(await evalRunPath(project, id, 'execution.log'), bytes, { mode: 0o600 });
  };
  const queueLog = (content: string) => {
    outputPending = outputPending.then(() => log(content));
  };
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const request = await readEvalJson(await evalRunPath(project, id, 'stop-request.json'));
      if (request?.runId === id) {
        if (!stopping && !deadlineExceeded) queueLog('停止请求已接收，正在结束执行进程。\n');
        deadlineExceeded = request.reason === 'timeout';
        stopping = !deadlineExceeded;
        controller.abort();
      }
      const current = await readManagedEvalRun(project, id);
      const progress = await readEvalJson(await evalRunPath(project, id, 'progress.json'));
      if (
        progress?.schema === 'comet.eval.progress.v1' &&
        progress.runId === id &&
        Array.isArray(progress.activities)
      ) {
        for (const item of progress.activities.slice(-3)) {
          if (!item || typeof item !== 'object') continue;
          const activity = item as Record<string, unknown>;
          if (
            typeof activity.id !== 'string' ||
            activity.id.length > 180 ||
            typeof activity.message !== 'string' ||
            typeof activity.at !== 'string' ||
            activity.at.length > 80 ||
            !['phase', 'model', 'tool'].includes(String(activity.kind))
          )
            continue;
          if (loggedActivities.has(activity.id)) continue;
          if (!Number.isFinite(Date.parse(activity.at))) continue;
          loggedActivities.add(activity.id);
          if (loggedActivities.size > 1000)
            loggedActivities.delete(loggedActivities.values().next().value!);
          queueLog(
            `[进度 ${activity.at}] ${redactEvalOutput(activity.message).replace(/\s+/gu, ' ').slice(0, 180)}\n`,
          );
        }
      }
      if (
        current &&
        !['completed', 'stopping', 'stopped', 'interrupted'].includes(current.status)
      ) {
        const reportedPhase =
          progress?.schema === 'comet.eval.progress.v1' && progress.runId === id
            ? (['preparing', 'generating', 'running', 'judging', 'finalizing'] as const).find(
                (value) => value === progress.phase,
              )
            : undefined;
        const phase =
          reportedPhase ??
          ((await readEvalJson(await evalRunPath(project, id, 'expected-case-matrix.json')))
            ? 'running'
            : null);
        if (phase && phase !== current.status)
          await updateManagedEvalRun(project, id, (record) => {
            if (!['completed', 'stopping', 'stopped', 'interrupted'].includes(record.status))
              record.status = phase;
          });
      }
    } catch (error) {
      queueLog(`状态核对：${(error as Error).message}\n`);
    } finally {
      polling = false;
    }
  };
  const timer = setInterval(() => void poll(), 1000);
  const deadline = setTimeout(
    () => controller.abort(),
    (original.config.timeoutSeconds ?? 600) * 1000,
  );
  const execute = async (
    command: string,
    args: readonly string[],
    options: ExternalCommandOptions = {},
  ): Promise<string> => {
    if (controller.signal.aborted) throw new Error(stopping ? '用户已停止评估' : '评估时限已到');
    const owned = spawnOwnedCommand(command, args, {
      cwd: options.cwd ?? project,
      env: options.env ?? process.env,
      timeoutMs: options.timeoutMs ?? (original.config.timeoutSeconds ?? 600) * 1000,
      confirmTermination: true,
    });
    executionStarted = true;
    let childClosed = false;
    const closed = new Promise<void>((resolve) =>
      owned.child.once('close', () => {
        childClosed = true;
        resolve();
      }),
    );
    const identity = await readProcessIdentity(owned.child.pid!);
    const instance = {
      pid: owned.child.pid!,
      instanceId: owned.instanceId,
      ownerPid: process.pid,
      ...(identity ? { identity } : {}),
    };
    await updateManagedEvalRun(project, id, (current) => {
      current.child = instance;
    });
    let stdout = '';
    let stdoutLine = '';
    let stderrLine = '';
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    const consume = (chunk: Buffer, error: boolean) => {
      const decoded = (error ? stderrDecoder : stdoutDecoder).write(chunk);
      if (!error && stdout.length < 8 * 1024 * 1024) stdout += decoded;
      let pending = (error ? stderrLine : stdoutLine) + decoded;
      const boundary = pending.lastIndexOf('\n');
      if (boundary >= 0) {
        queueLog(pending.slice(0, boundary + 1));
        pending = pending.slice(boundary + 1);
      }
      if (pending.length > 65536) {
        queueLog('[过长输出行已省略]\n');
        pending = '';
      }
      if (error) stderrLine = pending;
      else stdoutLine = pending;
    };
    owned.child.stdout.on('data', (chunk: Buffer) => consume(chunk, false));
    owned.child.stderr.on('data', (chunk: Buffer) => consume(chunk, true));
    let rejectExecution: ((error: Error) => void) | undefined;
    let termination: Promise<boolean> | null = null;
    const terminate = () =>
      (termination ??= terminateProcessTreeConfirmed(owned.child)
        .catch((error) => {
          queueLog(`停止进程：${error.message}\n`);
          return false;
        })
        .then(async (confirmed) => {
          await recordEvalProcessTermination(project, id, instance, confirmed);
          return confirmed;
        }));
    const abort = () => {
      if (childClosed) return;
      void terminate()
        .catch((error) => queueLog(`停止进程登记：${error.message}\n`))
        .finally(() => {
          owned.child.stdout.destroy();
          owned.child.stderr.destroy();
          owned.child.unref();
          rejectExecution?.(new Error(stopping ? '用户已停止评估' : '评估时限已到'));
        });
    };
    controller.signal.addEventListener('abort', abort, { once: true });
    try {
      const result = new Promise<void>((resolve, reject) => {
        rejectExecution = reject;
        owned.child.once('error', reject);
        owned.child.on('message', (message) => {
          const value = message as {
            type?: string;
            exitCode?: number;
            message?: string;
            reason?: string;
          };
          if (value.type === 'completed') {
            exitCode = value.exitCode ?? null;
            if (exitCode === 0) resolve();
            else reject(new Error(`Eval 执行退出码 ${exitCode}`));
          }
          if (value.type === 'spawn-error' || value.type === 'interrupted')
            reject(new Error(value.message ?? value.reason ?? 'Eval 执行中断'));
        });
        owned.child.once('close', () => {
          if (exitCode === null) reject(new Error('Eval 执行进程中断'));
        });
      });
      owned.start();
      if (controller.signal.aborted) abort();
      await result;
    } finally {
      controller.signal.removeEventListener('abort', abort);
      const confirmed = await terminate();
      let dead = false;
      if (confirmed) {
        await closed;
        for (let attempt = 0; attempt < 20; attempt++) {
          if (
            (await inspectProcessTreeLiveness(owned.child.pid!, identity ?? undefined)) === 'dead'
          ) {
            dead = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } else {
        owned.child.stdout.destroy();
        owned.child.stderr.destroy();
        if (owned.child.connected) owned.child.disconnect();
        owned.child.unref();
      }
      processesStopped = confirmed && dead;
      if (!processesStopped) queueLog('执行进程树尚未确认停止，请重新核对。\n');
      queueLog(stdoutLine + stdoutDecoder.end() + stderrLine + stderrDecoder.end());
      await outputPending;
    }
    return stdout;
  };
  try {
    await poll();
    if (controller.signal.aborted) throw new Error('评估已取消');
    const preview = await previewEvalRun(project, original.config);
    if (preview.confirmationHash !== original.previewHash || preview.blockedReasons.length)
      throw new Error('启动前目标或环境已变化，请重新预检');
    await updateManagedEvalRun(project, id, (current) => {
      if (current.status !== 'stopping') current.status = 'preparing';
    });
    await log(`目标：${preview.target.name}\n用例来源：${preview.taskSource}\n`);
    if (preview.retry) {
      const selectionFile = await evalRunPath(project, id, 'case-selection.json');
      await writeEvalJson(selectionFile, preview.retry);
      process.env.COMET_EVAL_CASE_SELECTION = `@${selectionFile}`;
    } else delete process.env.COMET_EVAL_CASE_SELECTION;
    if (original.config.targetType === 'application') {
      await runWorkflowApplicationEval({
        file: original.config.target,
        projectRoot: project,
        goal: original.config.goal,
        settings: applicationEvalSettings(original.config),
        previousExperimentId: original.config.previousExperimentId,
        confirmationHash: preview.application!.confirmationHash,
        experimentId: id,
        executeCommand: execute,
      });
    } else {
      const config = original.config;
      const args = [
        path.join(evalPackageRoot, 'bin/comet.js'),
        'eval',
        ...(preview.retry?.manifestPath
          ? ['--manifest', preview.retry.manifestPath]
          : [config.target]),
        '--project',
        project,
        '--html',
      ];
      for (const [key, flag] of [
        ['agent', '--agent'],
        ['model', '--model'],
        ['judgeAgent', '--judge-agent'],
        ['judgeModel', '--judge-model'],
        ['baseUrl', '--base-url'],
        ['judgeBaseUrl', '--judge-base-url'],
        ['suite', '--suite'],
        ['task', '--task'],
        ['profile', '--profile'],
      ] as const)
        if (config[key]) args.push(flag, config[key]!);
      if (config.quick) args.push('--quick');
      await execute(process.execPath, args, {
        cwd: project,
        env: {
          ...process.env,
          COMET_EVAL_EXPERIMENT_ID: id,
          COMET_EVAL_PROJECT_ID: await evalProjectIdentity(project),
          COMET_EVAL_MANAGED: '1',
          COMET_EVAL_MANAGED_TIMEOUT: String(config.timeoutSeconds ?? 600),
          COMET_EVAL_MANAGED_MAX_TURNS: String(config.maxTurns ?? 40),
        },
      });
    }
  } catch (error) {
    lastError = error;
    await log(`执行结果：${(error as Error).message}\n`);
  } finally {
    clearInterval(timer);
    clearTimeout(deadline);
    while (polling) await new Promise((resolve) => setTimeout(resolve, 10));
    await poll();
    await outputPending;
    const metadata = await readEvalJson(await evalRunPath(project, id, 'metadata.json'));
    const execution = await readEvalExecutionState(project, id);
    let status: EvalManagedRun['status'] = 'interrupted';
    let cleanupComplete = false;
    try {
      if (executionStarted || original.status === 'stopping')
        await cleanupEvalExecution(project, id);
      if (!processesStopped) {
        lastError = new Error('执行进程尚未确认停止');
        status = 'stopping';
      } else {
        cleanupComplete = true;
        if (stopping || controller.signal.aborted) status = stopping ? 'stopped' : 'interrupted';
        else if (execution?.status === 'completed' || (!execution && metadata?.completed_at))
          status = 'completed';
      }
    } catch (error) {
      lastError = error;
      status = 'stopping';
    }
    await updateManagedEvalRun(project, id, (current) => {
      // Stop 可以在最后一次轮询后到达；资源已经核对清理才允许确认停止。
      if (current.status === 'stopping' && cleanupComplete)
        status = deadlineExceeded ? 'interrupted' : 'stopped';
      current.status = status;
      current.exitCode = exitCode;
      if (lastError && status !== 'completed')
        current.error = redactEvalOutput((lastError as Error).message);
    });
    await writeEvalExecutionState(project, id, {
      status,
      ...(lastError && status !== 'completed'
        ? { error: redactEvalOutput((lastError as Error).message) }
        : {}),
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const project = process.argv[process.argv.indexOf('--project') + 1];
  const id = process.argv[process.argv.indexOf('--run') + 1];
  if (!project || !id || !process.argv.includes('--project') || !process.argv.includes('--run'))
    process.exitCode = 1;
  else
    void runManagedEvalWorker(project, id).catch(async (error) => {
      await updateManagedEvalRun(project, id, (current) => {
        current.status = 'stopping';
        current.error = redactEvalOutput(error.message);
      }).catch(() => {});
      process.exitCode = 1;
    });
}
