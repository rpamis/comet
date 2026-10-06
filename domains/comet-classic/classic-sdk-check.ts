import { createHash, randomUUID } from 'node:crypto';
import { classicSdkRunMatchesProfile } from './classic-sdk-profile.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { samePath } from '../../platform/paths/git-worktree.js';
import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeExecutor,
  type RuntimeOutcome,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../engine/runtime.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { terminateProcessTree } from '../../platform/process/terminate-process-tree.js';
import { spawnCommand } from '../../platform/process/spawn-command.js';
import { checkEnvironmentFingerprint, collectCheckSnapshot } from './classic-check-snapshot.js';
import { checkManifestHash, diffCheckManifests } from './classic-check-manifest.js';
import { readCheckPolicy } from './classic-check-policy.js';
import {
  ensureClassicProjectDirectory,
  writeClassicProjectText,
} from './classic-protected-path.js';
import type { ClassicState } from './classic-state.js';

interface ClassicSdkCheckInput {
  runId: string;
  projectRoot: string;
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
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
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawnCommand(argv[0], argv.slice(1), { cwd });
    let output = '';
    let timedOut = false;
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-2 * 1024 * 1024);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (error) => {
      output += `\n${error.message}`;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child).catch(() => child.kill('SIGKILL'));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        output: (timedOut ? 'Check timed out.\n' : '') + output,
      });
    });
  });
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
  const timeoutMs = input.timeoutMs ?? 300_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new Error('Classic check timeout must be 1..3600000 milliseconds');
  }
  const state = run.state as ClassicState | undefined;
  const changeDirRef =
    run.input !== null &&
    typeof run.input === 'object' &&
    !Array.isArray(run.input) &&
    typeof run.input.changeDir === 'string'
      ? run.input.changeDir
      : null;
  const scope = state?.phase === 'build' ? 'build' : state?.phase === 'verify' ? 'verify' : null;
  const profile = state?.workflow;
  if (
    !profile ||
    !classicSdkRunMatchesProfile(run, profile) ||
    run.status !== 'running' ||
    scope === null ||
    !state ||
    (scope === 'verify' && !state.verificationReport) ||
    !changeDirRef ||
    action.runId !== run.runId ||
    action.stepId !== `${profile}.${scope}.check` ||
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
  const scope = (run.state as unknown as ClassicState).phase;
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
    Object.keys(command).some((key) => !['argv', 'cwd', 'timeoutMs'].includes(key)) ||
    !Array.isArray(command.argv) ||
    command.argv.length === 0 ||
    command.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
    !(command.argv[0] as string).trim() ||
    (command.cwd !== undefined && typeof command.cwd !== 'string') ||
    (command.timeoutMs !== undefined && typeof command.timeoutMs !== 'number')
  )
    throw new Error(label);
  return {
    runId: run.runId,
    projectRoot,
    argv: command.argv as string[],
    cwd: command.cwd as string | undefined,
    timeoutMs: command.timeoutMs as number | undefined,
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
    output.timeoutMs !== (input.timeoutMs ?? 300_000)
  )
    throw new Error('Classic check receipt does not match the fixed command');
}

/** 只执行检查工作；SDK Executor 与旧 CLI 的领取/回传包装共用这一实现。 */
export async function runClassicSdkCommandCheck(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  input: ClassicSdkCheckInput,
): Promise<Pick<RuntimeOutcome, 'status' | 'output'>> {
  const { root, cwd, state, scope, timeoutMs, change } = await checkedInput(run, action, input);
  const checksDir = path.join(change.target, '.comet', 'checks');
  await ensureClassicProjectDirectory(root, checksDir, 'Classic SDK check evidence');
  const identity = { argv: [...input.argv], cwd: cwd.relative };
  const snapshotOptions = { verificationReport: state.verificationReport };
  const before = await collectCheckSnapshot(root, change.target, identity, snapshotOptions);
  const environment = await checkEnvironmentFingerprint(
    identity.argv,
    cwd.absolute,
    await readCheckPolicy(root, identity),
  );
  const result = await runCommand(identity.argv, cwd.absolute, timeoutMs);
  const after = await collectCheckSnapshot(root, change.target, identity, snapshotOptions).catch(
    () => null,
  );
  let inputAfter = after?.digest ?? 'unavailable';
  if (
    environment !==
    (await checkEnvironmentFingerprint(
      identity.argv,
      cwd.absolute,
      await readCheckPolicy(root, identity),
    ))
  )
    inputAfter = 'environment-changed';
  const logPath = path.join(checksDir, `${randomUUID()}.log`);
  await writeClassicProjectText(root, logPath, result.output, { label: 'Classic SDK check log' });
  const receiptRef = path.relative(root, logPath).replaceAll('\\', '/');
  const contentHash = createHash('sha256').update(result.output).digest('hex');
  const manifestPath = path.join(checksDir, `${randomUUID()}.manifest`);
  if (after)
    await writeClassicProjectText(root, manifestPath, after.manifest, {
      label: 'Classic SDK check manifest',
    });
  const changedDuringExecution = after
    ? (() => {
        const diff = diffCheckManifests(before.entries, after.entries);
        return [...diff.added, ...diff.removed, ...diff.changed].slice(0, 100);
      })()
    : [];
  return {
    status: result.exitCode === 0 && before.digest === inputAfter ? 'succeeded' : 'failed',
    output: {
      scope,
      argv: identity.argv,
      cwd: identity.cwd,
      timeoutMs,
      exitCode: result.exitCode,
      inputBefore: before.digest,
      inputAfter,
      environment,
      changedDuringExecution,
      receiptRef,
      contentHash,
      manifestRef: after ? path.relative(root, manifestPath).replaceAll('\\', '/') : null,
      manifestHash: after ? checkManifestHash(after.manifest) : null,
      tier: 'full',
      checkEpoch: state.checkEpoch ?? 0,
    },
  };
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
): Promise<WorkflowRun> {
  const root = path.resolve(input.projectRoot);
  const run = await runtime.inspect(input.runId);
  const state = run.state as unknown as ClassicState;
  const action = run.actions
    .slice()
    .reverse()
    .find(
      (candidate) =>
        candidate.stepId === `${state.workflow}.${state.phase}.check` &&
        candidate.status === 'pending',
    );
  if (!action) throw new Error('Current Classic SDK Run has no pending check Action');
  await checkedInput(run, action, input);
  const token = randomUUID();
  const requestId = randomUUID();
  await runtime.claim({
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
    const claimed = await runtime.inspect(run.runId);
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
