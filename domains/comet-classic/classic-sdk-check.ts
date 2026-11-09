import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { samePath } from '../../platform/paths/git-worktree.js';
import { spawnOwnedCommand } from '../../platform/process/owned-command.js';
import { reportCometRuntimeProgress } from '../../platform/process/runtime-metrics.js';
import { observeRuntimeOperation } from '../../platform/process/runtime-performance.js';
import { terminateProcessTreeConfirmed } from '../../platform/process/terminate-process-tree.js';
import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeExecutor,
  type RuntimeOutcome,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../engine/runtime.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { resolveClassicCheckTimeout } from './classic-project-config.js';
import {
  ensureClassicProjectDirectory,
  writeClassicProjectText,
} from './classic-protected-path.js';
import { classicSdkCheckPreparationInput } from './classic-sdk-check-preparation.js';
import {
  assertClassicSdkCheckReceipt,
  classicSdkCheckDirectoryRef,
  classicSdkCheckRecordRef,
  recordClassicSdkCheckReceipt,
} from './classic-sdk-check-record.js';
import { collectClassicSdkDeliveryInputs } from './classic-sdk-delivery-inputs.js';
import {
  classicDeliveryRepairForAction,
  classicDeliveryRepairInputs,
  isClassicDeliveryRepairCheck,
} from './classic-sdk-delivery-repair-model.js';
import { classicSdkRunMatchesProfile } from './classic-sdk-profile.js';
import type { ClassicState } from './classic-state.js';

interface ClassicSdkCheckInput {
  runId: string;
  projectRoot: string;
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
  reusable?: boolean;
}

export function classicSdkCheckRefreshInput(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
) {
  const activation = (action.input as { activation?: RuntimeValue }).activation;
  return activation &&
    run.commands?.some(
      (command) =>
        command.name === 'refresh-checks' &&
        command.actionId === action.id &&
        command.inputHash === hashRuntimeValue(activation),
    )
    ? (activation as unknown as {
        sourceActionId: string;
        approvalWaitId: string;
        proposalHash: string;
        reportSha256: string;
        observationHash: string;
        summary: string;
      })
    : null;
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

async function checkedCwd(
  root: string,
  requested: string,
): Promise<{ relative: string; absolute: string }> {
  if (!requested.trim() || requested.includes('\0'))
    throw new Error('Classic check cwd is invalid');
  const absolute = path.resolve(root, requested);
  if (!within(root, absolute)) throw new Error('Classic check cwd is outside the project');
  const [realRoot, realCwd] = await Promise.all([fs.realpath(root), fs.realpath(absolute)]);
  if (!within(realRoot, realCwd)) throw new Error('Classic check cwd resolves outside the project');
  return { relative: path.relative(root, absolute).replaceAll('\\', '/') || '.', absolute };
}

async function runCommand(
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; output: string; stopConfirmed: boolean }> {
  const owned = spawnOwnedCommand(argv[0], argv.slice(1), {
    cwd,
    timeoutMs,
    confirmTermination: true,
  });
  const child = owned.child;
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  let output = '';
  let timedOut = false;
  const capture = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-2 * 1024 * 1024);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  let timer: NodeJS.Timeout | undefined;
  const exitCode = await new Promise<number>((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    child.once('error', (error) => {
      output += `\n${error.message}`;
      finish(1);
    });
    child.once('close', () => finish(1));
    child.on('message', (message) => {
      const value = message as {
        type?: string;
        exitCode?: number | null;
        reason?: string;
        message?: string;
      };
      if (value.type === 'completed') finish(value.exitCode ?? 1);
      else if (value.type === 'interrupted' || value.type === 'spawn-error') {
        timedOut = value.reason === 'timeout';
        if (value.message) output += `\n${value.message}`;
        finish(timedOut ? 124 : 1);
      }
    });
    void (async () => {
      try {
        // Windows 先等监管器完成启动，避免 taskkill 与进程初始化及自行清理竞争。
        await owned.ready;
        if (settled) return;
        timer = setTimeout(() => {
          timedOut = true;
          finish(124);
        }, timeoutMs);
        owned.start();
      } catch (error) {
        output += `\n${error instanceof Error ? error.message : String(error)}`;
        finish(1);
      }
    })();
  });
  // completed 只代表命令退出。监管器仍持有后代的执行边界；正常退出也必须清理，
  // 不能用组长 close 事件证明检查已静止，更不能提前采集成功快照。
  let stopConfirmed = await terminateProcessTreeConfirmed(child).catch(() => false);
  if (stopConfirmed) {
    let closeTimer: NodeJS.Timeout | undefined;
    stopConfirmed = await Promise.race([
      closed.then(() => true),
      new Promise<boolean>((resolve) => {
        closeTimer = setTimeout(() => resolve(false), 2000);
      }),
    ]);
    clearTimeout(closeTimer);
  }
  if (!stopConfirmed) {
    child.stdout.destroy();
    child.stderr.destroy();
    if (child.connected) child.disconnect();
    child.unref();
  }
  return {
    exitCode,
    output: (timedOut ? 'Check timed out.\n' : '') + output,
    stopConfirmed,
  };
}

async function checkedInput(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  input: ClassicSdkCheckInput,
) {
  const root = path.resolve(input.projectRoot);
  const cwd = await checkedCwd(root, input.cwd ?? '.');
  if (
    !input.argv.length ||
    input.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0'))
  ) {
    throw new Error('Classic check requires literal program arguments');
  }
  const timeoutMs = await resolveClassicCheckTimeout(root, input.timeoutMs);
  const state = run.state as ClassicState | undefined;
  let changeDirRef =
    run.input !== null &&
    typeof run.input === 'object' &&
    !Array.isArray(run.input) &&
    typeof run.input.changeDir === 'string'
      ? run.input.changeDir
      : null;
  const repairing = state && isClassicDeliveryRepairCheck(run, action);
  const refreshing = state && state.phase === 'archive' && classicSdkCheckRefreshInput(run, action);
  if (refreshing) {
    const original = run.actions.find((entry) => entry.id === refreshing.sourceActionId);
    if (
      !original?.outcome ||
      original.ref !== 'classic-check' ||
      original.claim?.executorId !== 'comet-classic-check'
    )
      throw new Error('补充检查缺少原执行记录');
    await assertClassicSdkCheckReceipt(root, run, original, {
      status: original.outcome.status,
      output: original.outcome.output,
    });
  }

  const scope =
    state?.phase === 'build'
      ? 'build'
      : state?.phase === 'verify' || repairing || refreshing
        ? 'verify'
        : null;
  const profile = state?.workflow;
  if (repairing) {
    const original = run.actions.find(
      (a) => a.id === classicDeliveryRepairForAction(action).archiveActionId,
    );
    changeDirRef =
      (original?.outcome?.output as { archiveDirectory?: string } | undefined)?.archiveDirectory ??
      null;
  }
  if (
    !profile ||
    !classicSdkRunMatchesProfile(run, profile) ||
    run.status !== 'running' ||
    scope === null ||
    !state ||
    (scope === 'verify' &&
      !state.verificationReport &&
      !classicSdkCheckPreparationInput(run, action)) ||
    !changeDirRef ||
    action.runId !== run.runId ||
    (!repairing && action.stepId !== `${profile}.${scope}.check`) ||
    action.type !== 'call_tool' ||
    action.ref !== 'classic-check'
  ) {
    throw new Error('Current Classic SDK Run has no pending check Action');
  }
  const change = await inspectProtectedProjectPath(root, changeDirRef, {
    label: 'Classic change',
    expected: 'directory',
  });
  if (!change.exists) throw new Error('Classic change directory does not exist');
  return { root, cwd, state, scope, timeoutMs, change };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label);
  return value as Record<string, unknown>;
}

/** 检查计划来自当前 Action 的固定 Run input，不从环境或项目脚本推断。 */
export function classicSdkCheckCommand(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
): ClassicSdkCheckInput {
  const prepared = classicSdkCheckPreparationInput(run, action);
  if (prepared) return { runId: run.runId, projectRoot, ...prepared.command };
  if (isClassicDeliveryRepairCheck(run, action)) {
    const command = classicDeliveryRepairForAction(action).command;
    if (!command) throw new Error('Classic platform reports do not contain a managed command');
    return { runId: run.runId, projectRoot, ...command };
  }
  const refresh = classicSdkCheckRefreshInput(run, action);
  if (refresh) {
    const original = run.actions.find((entry) => entry.id === refresh.sourceActionId);
    const command = original?.outcome?.output as
      { argv?: string[]; cwd?: string; timeoutMs?: number; reusable?: boolean } | undefined;
    if (
      !command ||
      !Array.isArray(command.argv) ||
      !command.argv.length ||
      command.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
      typeof command.cwd !== 'string' ||
      typeof command.timeoutMs !== 'number'
    )
      throw new Error('补充检查只能使用原执行的固定命令');
    return {
      runId: run.runId,
      projectRoot,
      argv: command.argv,
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      reusable: command.reusable === true,
    };
  }
  const profile = (run.state as unknown as ClassicState).workflow;
  // 归档仍核对原 Verify Action 的命令，不把当前 Archive 阶段当作检查种类。
  const scope =
    action.stepId === `${profile}.build.check`
      ? 'build'
      : action.stepId === `${profile}.verify.check`
        ? 'verify'
        : null;
  if (scope !== 'build' && scope !== 'verify') throw new Error('Classic check scope is invalid');
  const label = `Classic input.checkCommands.${scope} must declare literal argv`;
  const runInput = object(run.input, label);
  const actionInput = object(object(action.input, label).input, label);
  const plans = object(actionInput.checkCommands, label);
  if (
    hashRuntimeValue(action.input) !== action.inputHash ||
    hashRuntimeValue(runInput.checkCommands) !== hashRuntimeValue(plans)
  )
    throw new Error('Classic check command does not match the fixed Action input');
  const command = object(plans[scope], label);
  if (
    Object.keys(command).some((key) => !['argv', 'cwd', 'timeoutMs', 'reusable'].includes(key)) ||
    !Array.isArray(command.argv) ||
    command.argv.length === 0 ||
    command.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
    !(command.argv[0] as string).trim() ||
    (command.cwd !== undefined && typeof command.cwd !== 'string') ||
    (command.timeoutMs !== undefined && typeof command.timeoutMs !== 'number') ||
    (command.reusable !== undefined && typeof command.reusable !== 'boolean')
  )
    throw new Error(label);
  return {
    runId: run.runId,
    projectRoot,
    argv: command.argv as string[],
    cwd: command.cwd as string | undefined,
    timeoutMs: command.timeoutMs as number | undefined,
    reusable: command.reusable === true,
  };
}

export async function assertClassicSdkCheckCommandBinding(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
  output: Record<string, unknown>,
): Promise<void> {
  const input = classicSdkCheckCommand(run, action, projectRoot);
  const cwd = await checkedCwd(path.resolve(projectRoot), input.cwd ?? '.');
  if (
    hashRuntimeValue(output.argv) !== hashRuntimeValue(input.argv) ||
    output.cwd !== cwd.relative ||
    output.timeoutMs !== (await resolveClassicCheckTimeout(projectRoot, input.timeoutMs)) ||
    (output.reusable === true) !== (input.reusable === true)
  )
    throw new Error('Classic check receipt does not match the fixed command');
}

/** 只执行检查工作；SDK Executor 与旧 CLI 的领取/回传包装共用这一实现。 */
export async function runClassicSdkCommandCheck(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  input: ClassicSdkCheckInput,
): Promise<Pick<RuntimeOutcome, 'status' | 'output'>> {
  const { root, cwd, state, scope, timeoutMs } = await checkedInput(run, action, input);
  const checksDir = path.join(root, classicSdkCheckDirectoryRef(run));
  await ensureClassicProjectDirectory(root, checksDir, 'Classic SDK check logs');
  const identity = { argv: [...input.argv], cwd: cwd.relative };
  const currentIndex = run.actions.findIndex((entry) => entry.id === action.id);
  const previous =
    input.reusable && !classicSdkCheckRefreshInput(run, action)
      ? run.actions
          .slice(0, currentIndex)
          .reverse()
          .find((entry) => {
            const value = entry.outcome?.output as Record<string, unknown> | undefined;
            return (
              entry.ref === 'classic-check' &&
              value &&
              JSON.stringify(value.argv) === JSON.stringify(identity.argv) &&
              value.cwd === identity.cwd
            );
          })
      : undefined;
  const prior = previous?.outcome?.output as Record<string, RuntimeValue> | undefined;
  const recordRef = classicSdkCheckRecordRef(run, action);
  const executionRecord = {
    schema: 'comet.classic-sdk-check.v1',
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claim: action.claim,
    command: { ...identity, timeoutMs },
  };
  if (
    previous?.status === 'succeeded' &&
    prior?.exitCode === 0 &&
    typeof prior.receiptRef === 'string'
  ) {
    await assertClassicSdkCheckReceipt(root, run, previous, {
      status: previous.outcome!.status,
      output: previous.outcome!.output,
    });
    const original = { ...prior };
    delete original.contentHash;
    delete original.inputBefore;
    delete original.inputAfter;
    delete original.environment;
    delete original.manifestRef;
    delete original.manifestHash;
    delete original.changedDuringExecution;
    const reused = {
      status: 'succeeded' as const,
      output: {
        ...original,
        contentHash: action.inputHash,
        scope,
        checkEpoch: state.checkEpoch ?? 0,
        timeoutMs,
        deliveryPaths: await collectClassicSdkDeliveryInputs(root, '', identity, run),
        reusable: true,
        reused: true,
        reusedFrom: previous.id,
      },
    };
    await recordClassicSdkCheckReceipt(root, run, action, reused);
    await writeClassicProjectText(
      root,
      recordRef,
      JSON.stringify({
        ...executionRecord,
        receiptRef: prior.receiptRef,
        status: 'completed',
        result: reused,
      }),
      { label: 'Classic reused check record' },
    );
    return reused;
  }
  const logPath = path.join(checksDir, randomUUID() + '.log');
  const receiptRef = path.relative(root, logPath).replaceAll('\\', '/');
  await writeClassicProjectText(
    root,
    recordRef,
    JSON.stringify({ ...executionRecord, receiptRef, status: 'started' }),
    { label: 'Classic check execution record' },
  );
  reportCometRuntimeProgress('执行 ' + scope + ' 检查：' + identity.argv[0]);
  const result = await observeRuntimeOperation(
    { projectRoot: () => root, workflow: 'classic', kind: 'check', command: 'check' },
    () => runCommand(identity.argv, cwd.absolute, timeoutMs),
  );
  await writeClassicProjectText(root, logPath, result.output, { label: 'Classic SDK check log' });
  if (!result.stopConfirmed) {
    await writeClassicProjectText(
      root,
      recordRef,
      JSON.stringify({
        ...executionRecord,
        receiptRef,
        status: 'stop-unconfirmed',
        stopConfirmed: false,
      }),
      { label: 'Classic check execution record' },
    );
    throw new Error('Classic 检查进程树尚未确认停止；保留原执行记录，不能验收或重跑');
  }
  const outcome: Pick<RuntimeOutcome, 'status' | 'output'> = {
    status: result.exitCode === 0 ? 'succeeded' : 'failed',
    output: {
      scope,
      ...identity,
      timeoutMs,
      exitCode: result.exitCode,
      receiptRef,
      contentHash: action.inputHash,
      deliveryPaths: await collectClassicSdkDeliveryInputs(root, '', identity, run),
      tier: 'full',
      checkEpoch: state.checkEpoch ?? 0,
      reusable: input.reusable === true,
      reused: false,
      ...(isClassicDeliveryRepairCheck(run, action)
        ? {
            deliveryRepair: classicDeliveryRepairForAction(action) as unknown as RuntimeValue,
            deliveryPaths: classicDeliveryRepairInputs(run, classicDeliveryRepairForAction(action)),
          }
        : {}),
    },
  };
  await recordClassicSdkCheckReceipt(root, run, action, outcome);
  await writeClassicProjectText(
    root,
    recordRef,
    JSON.stringify({ ...executionRecord, receiptRef, status: 'completed', result: outcome }),
    { label: 'Classic check execution record' },
  );
  return outcome;
}

export function createClassicSdkCheckExecutor(projectRoot: string): RuntimeExecutor {
  return {
    id: 'comet-classic-check',
    capabilities: [],
    supports: (action) => action.type === 'call_tool' && action.ref === 'classic-check',
    async preflight(action, context, run) {
      if (!run || !context?.projectRoot || !samePath(context.projectRoot, projectRoot))
        throw new Error('Classic check requires its bound project');
      await checkedInput(run, action, classicSdkCheckCommand(run, action, projectRoot));
    },
    async execute(action, context, run) {
      if (!run || !context?.projectRoot || !samePath(context.projectRoot, projectRoot))
        throw new Error('Classic check requires its bound project');
      return runClassicSdkCommandCheck(
        run,
        action,
        classicSdkCheckCommand(run, action, projectRoot),
      );
    },
  };
}

/** Execute one claimed SDK check Action without reading or advancing legacy Classic state. */
export async function executeClassicSdkCommandCheck(
  runtime: Pick<WorkflowRuntime, 'inspect' | 'claim' | 'recordOutcome' | 'markUnknown'>,
  input: ClassicSdkCheckInput,
  inspectedRun?: WorkflowRun,
): Promise<WorkflowRun> {
  const root = path.resolve(input.projectRoot);
  const run = inspectedRun ?? (await runtime.inspect(input.runId));
  if (run.runId !== input.runId) throw new Error('Classic check belongs to a different Run');
  const state = run.state as unknown as ClassicState;
  const action = run.actions
    .slice()
    .reverse()
    .find(
      (candidate) =>
        candidate.stepId ===
          `${state.workflow}.${classicSdkCheckRefreshInput(run, candidate) ? 'verify' : state.phase}.check` &&
        candidate.status === 'pending',
    );
  if (!action) throw new Error('Current Classic SDK Run has no pending check Action');
  await checkedInput(run, action, input);
  const token = randomUUID();
  const requestId = randomUUID();
  const claimed = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-check',
    claimToken: token,
    expectedRevision: run.revision,
    context: { requestId, projectRoot: root },
  });
  try {
    // claim 已按 revision 原子核对并返回提交后的 Run，不立即重新读取同一记录。
    const claimedAction = claimed.actions.find((entry) => entry.id === action.id)!;
    const result = await runClassicSdkCommandCheck(claimed, claimedAction, input);
    return await runtime.recordOutcome({
      runId: run.runId,
      context: { requestId, projectRoot: root },
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: token,
        outcomeId: randomUUID(),
        ...result,
      },
    });
  } catch (error) {
    const current = await runtime.inspect(run.runId);
    const latest = current.actions.find((candidate) => candidate.id === action.id);
    if (latest?.status === 'running' && latest.attempt === action.attempt) {
      await runtime.markUnknown({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
