import { isClassicSdkRejectedBuildProposal } from './classic-build-configuration.js';
import path from 'node:path';
import { type WorkflowRun } from '../engine/runtime.js';
/** 只读诊断；恢复请求仍须由 Runtime 校验原 claim、版本和检查证据。 */
export async function inspectClassicSdkActionRecovery(projectRoot: string, run: WorkflowRun) {
  const action = run.actions.find((entry) => ['running', 'unknown'].includes(entry.status));
  if (!action) return null;
  if (isClassicSdkRejectedBuildProposal(action)) {
    return {
      status: 'outcome-rejected',
      blocked: true,
      action: {
        actionId: action.id,
        stepId: action.stepId,
        status: action.status,
        attempt: action.attempt,
        inputHash: action.inputHash,
      },
      claim: action.claim,
      rejection: action.rejectedOutcomes?.at(-1),
      instructions: [
        '配置提案已回传但未通过校验。修正 JSON 后重提，沿用原 claim 并保留拒绝历史。',
        '恢复后须展示新提案并重新取得用户批准；不得使用 --confirmed，或声明原尝试未执行。',
      ],
      commandArgs: [
        'comet',
        'state',
        'propose-build',
        String(
          (
            run.input as {
              change: string;
            }
          ).change,
        ),
        '--file',
        '<configuration-json>',
        '--json',
      ],
      cwd: path.resolve(projectRoot),
      inspectRequest: { operation: 'inspect', runId: run.runId },
    };
  }
  const original = { actionId: action.id, attempt: action.attempt, inputHash: action.inputHash };
  const requestBase = { runId: run.runId, expectedRevision: run.revision };
  const interruptedBuilder =
    action.type === 'invoke_skill' &&
    action.status === 'unknown' &&
    action.stepId ===
      (
        run.state as {
          workflow: string;
        }
      ).workflow +
        '.build.execute' &&
    action.claim;
  return {
    status: 'outcome-unknown',
    blocked: true,
    action: {
      ...original,
      stepId: action.stepId,
      status: action.status,
      ref: action.ref,
      retry: action.retry,
    },
    claim: action.claim ?? null,
    instructions: [
      '通过 Agent 平台核对或等待原任务，沿用原领取提交实际结果；等待超时不能另派任务，也不能把未知结果记成通过。',
      '平台负责执行的超时、取消和进程清理；Comet 仅保留业务任务和批准。',
    ],
    inspectRequest: { operation: 'inspect', runId: run.runId },
    ...(action.status === 'running'
      ? {
          markUnknownRequest: {
            operation: 'mark-unknown',
            ...requestBase,
            actionId: action.id,
            attempt: action.attempt,
            reason: '平台无法取回原任务结果，正在核对实际工作',
          },
        }
      : {}),
    ...(interruptedBuilder
      ? {
          interruptedOutcomeRequestTemplate: {
            operation: 'record-outcome',
            ...requestBase,
            outcome: {
              ...original,
              claimToken: '<原领取令牌>',
              outcomeId: '<本次结果的唯一标识>',
              status: 'failed',
              output: { summary: '<填写平台任务状态、部分产物和外部副作用的实际核对结果>' },
            },
            context: { projectRoot: path.resolve(projectRoot) },
          },
        }
      : {}),
    retryRequestTemplate: {
      operation: 'retry',
      ...requestBase,
      actionId: action.id,
      attempt: action.attempt,
      reconciliation: {
        resolution: 'not-executed',
        evidence: { summary: '<只有证实原任务从未执行时才能填写>' },
      },
    },
  };
}
