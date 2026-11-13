import { upgradeClassicRun } from './classic-sdk-run-upgrade.js';
export { inspectClassicSdkRunDiagnostics } from './classic-sdk-diagnostics.js';
import { isClassicSdkApprovedUpgrade } from './classic-sdk-profile.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createRuntime, type WorkflowRun, type WorkflowRuntime } from '../engine/runtime.js';
import {
  readChangeRuntimeOwner,
  readSdkChangeOwner,
  type SdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { resolveClassicChangeRuntimeOwner } from './classic-runtime-ownership.js';
import { classicSdkApplicationForRun } from './classic-sdk-revision-application.js';
import { createClassicSdkStateStore } from './classic-sdk-state-store.js';
import {
  inspectClassicStateFileCandidates,
  resolveClassicChangeDirectory,
} from './classic-paths.js';
import { resolveClassicStateFile } from './classic-state-file.js';
import type { ClassicProfile, ClassicState } from './classic-state.js';

export const classicSdkCheckInstruction =
  '执行当前检查 Action；Runtime 会绑定原命令、输入快照和收据，并校验后续证据。默认单次真实执行；--local 不是执行位置开关，而是允许确定性检查复用。任务要求每阶段真实执行、命令有副作用或读取外部状态时，禁止添加 --local；只有任务允许且完整输入和执行条件确定时才显式选择复用。使用 --json 时解析完整 stdout，stderr 单独保留，不合并后截断解析。';

export const classicSdkDeliveryCheckInstruction =
  '交付修复检查已固定原 Verify 命令。按 data.continuation.commandArgs 执行 state next --continue，使用当前 Run 的原 Action、命令和收据继续检查；不使用 check run 或 check rerun 重新登记检查，不重放 Archive。检查成功后展示新交付范围，结束当前回复并等待用户针对本范围的实际回答。使用 --json 时解析完整 stdout，stderr 单独保留。';

export const classicSdkAgentDeliveryCheckInstruction =
  '提交本次交付修复的 Agent 平台检查报告，保留原 Run、归档和批准的路径，不运行受管命令或重放 Archive。随后展示交付范围并取得当前提案的明确批准。';

/** 仅投影本次读取或提交的 Run；后续操作仍须重新校验版本与证据。 */
export function classicSdkNextAction(run: WorkflowRun) {
  if (run.status === 'completed') return { kind: 'done' } as const;
  const unresolved = run.actions.find(
    (action) => action.status === 'running' || action.status === 'unknown',
  );
  const pending = run.actions.find((action) => action.status === 'pending');
  const action = unresolved ?? pending;
  if (action) {
    const profile = (run.state as ClassicState | undefined)?.workflow;
    // 只调整宿主收到的 Skill 路由；保留旧 Run 固定的定义、Action 和输入哈希。
    const ref =
      (profile === 'hotfix' || profile === 'tweak') &&
      run.workflow.id === `comet-classic-${profile}` &&
      action.type === 'invoke_skill' &&
      action.stepId === `${profile}.build.execute` &&
      action.ref === 'comet-build'
        ? `comet-${profile}`
        : action.ref;
    return {
      kind: unresolved ? 'reconcile' : 'action',
      stepId: action.stepId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      ...(ref ? { ref } : {}),
      ...(ref === 'classic-check'
        ? {
            instruction: action.stepId.endsWith('.delivery.check')
              ? run.workflow.version === '2'
                ? classicSdkAgentDeliveryCheckInstruction
                : classicSdkDeliveryCheckInstruction
              : classicSdkCheckInstruction,
          }
        : {}),
    };
  }
  const evidence = run.evidenceWaits?.find((wait) => wait.status === 'pending');
  if (evidence) {
    return {
      kind: 'evidence',
      stepId: evidence.stepId,
      evidenceId: evidence.id,
      evidenceKind: evidence.kind,
    };
  }
  const decision = run.waits.find((wait) => wait.status === 'pending');
  return decision
    ? {
        kind: 'decision',
        stepId: decision.stepId,
        waitId: decision.id,
        proposalHash: decision.proposalHash,
        choices: decision.choices,
        instruction:
          decision.stepId.endsWith('.design.confirm') ||
          decision.stepId.endsWith('.delivery.confirm')
            ? '核对当前提案与已有批准、委托授权的对象、范围和条件。授权仍覆盖时记录依据并继续；超出授权、发生实质变化或用户明确要求逐阶段确认时，展示待决定内容并等待答复。不得把 Agent 自行判断写成用户确认。' +
              (decision.stepId.endsWith('.delivery.confirm')
                ? '本次重检完成后核对当前交付范围与原授权；用户明确要求审阅本次范围后确认时，先展示并结束当前回复，等待实际答复。'
                : '')
            : '核对当前提案是否已有有效批准或委托授权；授权覆盖时记录依据，否则展示选项并等待用户决定。',
      }
    : null;
}

export async function inspectClassicSdkRun(
  projectRoot: string,
  name: string,
  options: { readOnly?: boolean; allowBranchRebind?: boolean; owner?: SdkChangeOwner } = {},
): Promise<{
  run: WorkflowRun;
  state: ClassicState;
  runtime: WorkflowRuntime;
  profile: ClassicProfile;
  owner: SdkChangeOwner;
}> {
  await inspectClassicStateFileCandidates(projectRoot, name);
  const directory = (await resolveClassicChangeDirectory(name, projectRoot)).directory;
  const owner =
    options.owner ??
    (await readSdkChangeOwner(projectRoot, 'classic', name, {
      readOnly: options.readOnly,
    }));
  if (!owner) throw new Error(`Classic change ${name} is not owned by an SDK Run`);
  if (!['classic-full', 'classic-hotfix', 'classic-tweak'].includes(owner.application))
    throw new Error(
      `Classic change ${name} belongs to application ${owner.application}; use comet runtime dispatch --application ${owner.application} to continue its Run. Built-in commands cannot bypass composition checks.`,
    );
  const profile = owner.application.slice('classic-'.length) as ClassicProfile;
  const store = createClassicSdkStateStore(projectRoot, options);
  let saved = await store.read(owner.runId);
  const application = classicSdkApplicationForRun(profile, saved);
  if (saved) {
    const upgraded = upgradeClassicRun(saved, application.workflow);
    if (upgraded !== saved) {
      await createRuntime({
        ...application,
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        store: { read: async () => upgraded, compareAndSwap: async () => false },
      }).inspect(owner.runId);
      saved = upgraded;
    }
  }
  let initialRead = true;
  const runtime = createRuntime({
    store: {
      ...store,
      async read(runId) {
        if (initialRead && runId === owner.runId) {
          initialRead = false;
          return saved;
        }
        const current = await store.read(runId);
        return current ? upgradeClassicRun(current, application.workflow) : current;
      },
    },
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    evidenceValidators: application.evidenceValidators,
    validators: application.validators,
    executors: application.executors,
    commandValidators: application.commandValidators,
  });
  const run = await runtime.inspect(owner.runId);
  const state = run.state as ClassicState | undefined;
  const expectedActive =
    run.input &&
    typeof run.input === 'object' &&
    !Array.isArray(run.input) &&
    typeof run.input.changeDir === 'string'
      ? path.resolve(projectRoot, run.input.changeDir)
      : null;
  const archiveDir = expectedActive ? path.join(path.dirname(expectedActive), 'archive') : null;
  const upgradedFromPreset = isClassicSdkApprovedUpgrade(run, profile);
  const effectiveProfile = upgradedFromPreset ? 'full' : profile;
  const archiveMoveUnresolved = run.actions.some(
    (action) =>
      action.stepId === `${effectiveProfile}.archive.execute` &&
      (action.status === 'running' || action.status === 'unknown'),
  );
  const directoryMatches =
    expectedActive !== null &&
    (directory === expectedActive ||
      ((state?.archived === true || archiveMoveUnresolved) &&
        path.dirname(directory) === archiveDir &&
        /^\d{4}-\d{2}-\d{2}-/u.test(path.basename(directory)) &&
        path.basename(directory).slice(11) === name));
  if (
    run.workflow.id !== application.workflow.id ||
    run.workflow.version !== application.workflow.version ||
    !run.input ||
    typeof run.input !== 'object' ||
    Array.isArray(run.input) ||
    run.input.change !== name ||
    !directoryMatches ||
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    (state.workflow !== profile && !upgradedFromPreset)
  ) {
    throw new Error(`Classic SDK Run ${name} does not match its change ownership`);
  }
  return { run, state, runtime, profile: effectiveProfile, owner };
}

type ClassicSdkWorkspace = Awaited<ReturnType<typeof inspectClassicSdkRun>> & {
  projectRoot: string;
};

export async function findClassicSdkWorkspace(
  projectRoot: string,
  name: string,
  options: { readOnly?: boolean; owner?: SdkChangeOwner } = {},
): Promise<ClassicSdkWorkspace | null> {
  const requestedRoot = path.resolve(projectRoot);
  const owner =
    options.owner ?? (await readSdkChangeOwner(requestedRoot, 'classic', name, { readOnly: true }));
  if (owner) {
    return {
      projectRoot: requestedRoot,
      ...(await inspectClassicSdkRun(requestedRoot, name, { ...options, owner })),
    };
  }
  return null;
}

export async function resolveClassicSdkCommandRoot(
  projectRoot: string,
  name: string,
): Promise<string> {
  const requestedRoot = path.resolve(projectRoot);
  let localOwner = await readChangeRuntimeOwner(requestedRoot, 'classic', name, { readOnly: true });
  if (!localOwner) {
    const configAvailable = await fs.access(path.join(requestedRoot, '.comet', 'config.yaml')).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (configAvailable) {
      const directory = (await resolveClassicChangeDirectory(name, requestedRoot)).directory;
      const state = await inspectProtectedProjectPath(
        requestedRoot,
        path.relative(requestedRoot, await resolveClassicStateFile(directory)),
        { label: 'Classic local change state', expected: 'file' },
      );
      // 空主工作区只负责定位，不在发现目标 worktree 之前建立 Runtime。
      if (state.exists) localOwner = await resolveClassicChangeRuntimeOwner(requestedRoot, name);
    }
  }
  if (localOwner) return requestedRoot;
  return (await findClassicSdkWorkspace(requestedRoot, name))?.projectRoot ?? requestedRoot;
}
