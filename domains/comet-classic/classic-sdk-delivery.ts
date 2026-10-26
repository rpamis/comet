import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';

import { validateClassicSdkDeliveryCandidate } from './classic-sdk-application.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';
import { classicDeliveryActionContext } from './classic-sdk-delivery-repair-model.js';

/** Submit an already performed Git delivery only after its approved evidence validates. */
export async function completeClassicSdkDelivery(options: {
  projectRoot: string;
  change: string;
  commit: string;
  prUrl?: string;
}) {
  const { projectRoot, change } = options;
  const { run, state, runtime, profile } = await inspectClassicSdkRun(projectRoot, change);
  if (state.phase !== 'archive' || !state.archived || run.status !== 'running') {
    throw new Error('Classic SDK delivery requires an archived, running change');
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const action = run.actions.find(
    (candidate) =>
      candidate.stepId === `${profile}.archive.deliver` && candidate.status === 'pending',
  );
  if (!action) throw new Error('Classic SDK Run has no pending delivery Action');
  const approved = run.outputs[`${profile}.archive.preflight`]?.value as
    { deliveryAction?: unknown; targetBranch?: unknown; remote?: unknown } | undefined;
  if (
    !approved ||
    !['local', 'push', 'pr'].includes(String(approved.deliveryAction)) ||
    typeof approved.targetBranch !== 'string' ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(options.commit) ||
    (approved.deliveryAction !== 'local' && typeof approved.remote !== 'string') ||
    (approved.deliveryAction === 'pr' && !options.prUrl) ||
    (approved.deliveryAction !== 'pr' && options.prUrl !== undefined)
  ) {
    throw new Error('Classic SDK delivery input does not match the approved target');
  }
  const output = {
    action: approved.deliveryAction as 'local' | 'push' | 'pr',
    targetBranch: approved.targetBranch,
    commit: options.commit,
    ...(typeof approved.remote === 'string' && approved.deliveryAction !== 'local'
      ? { remote: approved.remote }
      : {}),
    ...(options.prUrl ? { prUrl: options.prUrl } : {}),
  };
  const validation = await validateClassicSdkDeliveryCandidate(run, action, output, projectRoot);
  if (!validation.accepted) {
    throw new Error(validation.reason ?? 'Classic SDK delivery evidence was rejected');
  }
  const claimToken = randomUUID();
  const requestId = randomUUID();
  await runtime.claim({
    runId: run.runId,
    expectedRevision: run.revision,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-delivery',
    claimToken,
    context: { requestId, projectRoot },
  });
  try {
    return await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output,
      },
      context: { requestId, projectRoot },
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

/** 兼容 delivery --verify，但仍由 SDK 的审批和交付 Action 核验结果。 */
export async function verifyClassicSdkDelivery(projectRoot: string, change: string) {
  const { run, profile } = await inspectClassicSdkRun(projectRoot, change);
  if (run.status === 'completed') {
    const action = run.actions
      .slice()
      .reverse()
      .find(
        (candidate) =>
          candidate.stepId === `${profile}.archive.deliver` && candidate.status === 'succeeded',
      );
    const output = action?.outcome?.output as
      | {
          action?: unknown;
          targetBranch?: unknown;
          remote?: unknown;
          commit?: unknown;
          prUrl?: unknown;
        }
      | undefined;
    const outputs = action
      ? (classicDeliveryActionContext(run, action)?.outputs ??
        (action.input as { outputs?: Record<string, unknown> }).outputs)
      : undefined;
    const approved = outputs?.[`${profile}.archive.preflight`] as
      | {
          deliveryAction?: unknown;
          targetBranch?: unknown;
          remote?: unknown;
        }
      | undefined;
    const archive = outputs?.[`${profile}.archive.execute`] as
      { archiveDirectory?: unknown } | undefined;
    if (
      !action ||
      action.outcome?.status !== 'succeeded' ||
      !output ||
      !approved ||
      !['local', 'push', 'pr'].includes(String(approved.deliveryAction)) ||
      typeof approved.targetBranch !== 'string' ||
      !approved.targetBranch ||
      (approved.deliveryAction !== 'local' &&
        (typeof approved.remote !== 'string' || !approved.remote)) ||
      output.action !== approved.deliveryAction ||
      output.targetBranch !== approved.targetBranch ||
      output.remote !== (approved.deliveryAction === 'local' ? undefined : approved.remote) ||
      typeof output.commit !== 'string' ||
      !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(output.commit) ||
      (approved.deliveryAction === 'pr' && (typeof output.prUrl !== 'string' || !output.prUrl)) ||
      (approved.deliveryAction !== 'pr' && output.prUrl !== undefined) ||
      typeof archive?.archiveDirectory !== 'string' ||
      normalizeWorkflowRelativePath(archive.archiveDirectory, 'Classic archived delivery') !==
        archive.archiveDirectory
    )
      throw new Error('Classic SDK 已完成交付的回执与原审批或归档路径不一致');
    // 已完成的交付是历史事实；后续 HEAD、源码和远端分支变化不撤销原成功收据。
    let type: string;
    try {
      type = execFileSync('git', ['cat-file', '-t', output.commit], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      throw new Error(
        `Classic 无法重新核验已完成交付：缺少原始 Git 提交对象 ${output.commit}；已完成 Run 保持不变`,
      );
    }
    if (type !== 'commit')
      throw new Error(`Classic 已完成交付回执指向的对象不是 commit：${output.commit}`);
    const files = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', output.commit, '--', archive.archiveDirectory],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
    if (!files)
      throw new Error(
        `Classic 原交付提交 ${output.commit} 缺少归档目录：${archive.archiveDirectory}`,
      );
    return run;
  }
  const approved = run.outputs[`${profile}.archive.preflight`]?.value as
    { deliveryAction?: string } | undefined;
  if (approved?.deliveryAction === 'pr') {
    throw new Error(
      `Classic SDK PR 交付需要实际 PR URL；请使用 comet state complete-delivery ${change} --commit <sha> --pr-url <url>，或 delivery ${change} --file <json>`,
    );
  }
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim();
  return completeClassicSdkDelivery({ projectRoot, change, commit });
}

/** 旧记录格式只提供观察结果，不能覆盖 SDK 已批准的目标或创建第二份授权。 */
export async function completeClassicSdkDeliveryFromRecord(
  projectRoot: string,
  change: string,
  input: unknown,
) {
  const { run, profile } = await inspectClassicSdkRun(projectRoot, change);
  const approved = run.outputs[`${profile}.archive.preflight`]?.value as
    { deliveryAction?: unknown; targetBranch?: unknown; remote?: unknown } | undefined;
  if (!approved)
    throw new Error(
      `Classic SDK 交付须先完成 propose-archive、decide-archive 和归档；delivery --file 不能代替审批`,
    );
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Classic SDK 交付记录必须是 JSON 对象');
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !['action', 'targetBranch', 'remote', 'commit', 'prUrl'].includes(key),
    ) ||
    record.action !== approved.deliveryAction ||
    record.targetBranch !== approved.targetBranch ||
    record.remote !== (approved.deliveryAction === 'local' ? undefined : approved.remote) ||
    typeof record.commit !== 'string' ||
    (record.prUrl !== undefined && typeof record.prUrl !== 'string')
  ) {
    throw new Error(
      'Classic SDK 交付记录须包含实际 commit，并与已批准的 action、targetBranch、remote 完全一致；不能通过 delivery --file 改写审批',
    );
  }
  return completeClassicSdkDelivery({
    projectRoot,
    change,
    commit: record.commit,
    ...(typeof record.prUrl === 'string' ? { prUrl: record.prUrl } : {}),
  });
}
