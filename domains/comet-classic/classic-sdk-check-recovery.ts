import { isClassicSdkRejectedBuildProposal } from './classic-build-configuration.js';
import path from 'node:path';
import {
  hashRuntimeValue,
  portableClaimToken,
  type RuntimeValue,
  type WorkflowRun,
} from '../engine/runtime.js';
import { classicProjectTargetExists } from './classic-protected-path.js';
import { classicSdkCheckCommand } from './classic-sdk-check.js';
import {
  classicSdkCheckRecordRef,
  classicSdkCheckDirectoryRef,
  assertClassicSdkCheckReceipt,
  readClassicSdkCheckRecoveryRecord,
} from './classic-sdk-check-record.js';

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
        String((run.input as { change: string }).change),
        '--file',
        '<configuration-json>',
        '--json',
      ],
      cwd: path.resolve(projectRoot),
      inspectRequest: { operation: 'inspect', runId: run.runId },
    };
  }
  const isCheck = action.type === 'call_tool' && action.ref === 'classic-check';
  const input = run.input as { changeDir?: string } | null;
  const evidenceDirectory = input?.changeDir ? classicSdkCheckDirectoryRef(run) : null;
  let recordRef = isCheck && action.claim ? classicSdkCheckRecordRef(run, action) : null;
  let record: Record<string, unknown> | null = null;
  let recordProblem: string | null = null;
  if (recordRef) {
    try {
      const recovered = await readClassicSdkCheckRecoveryRecord(projectRoot, run, action);
      if (recovered) {
        recordRef = recovered.ref;
        const value = recovered.value as Record<string, unknown> & {
          status: string;
          claim: { token: string };
          command: { argv: unknown; cwd: string; timeoutMs: number };
          result: { status: 'succeeded' | 'failed'; output: Record<string, RuntimeValue> };
        };
        if (
          value?.schema !== 'comet.classic-sdk-check.v1' ||
          value.runId !== run.runId ||
          value.actionId !== action.id ||
          value.attempt !== action.attempt ||
          value.inputHash !== action.inputHash ||
          hashRuntimeValue({
            ...value.claim,
            token: portableClaimToken(value.claim?.token ?? ''),
          }) !==
            hashRuntimeValue({
              ...action.claim,
              token: portableClaimToken(action.claim?.token ?? ''),
            }) ||
          !['started', 'completed'].includes(value.status) ||
          !Array.isArray(value.command?.argv) ||
          value.command.argv.length === 0 ||
          value.command.argv.some((argument: unknown) => typeof argument !== 'string') ||
          typeof value.command.cwd !== 'string' ||
          !Number.isInteger(value.command.timeoutMs) ||
          (value.status === 'completed' &&
            (!['succeeded', 'failed'].includes(value.result?.status) ||
              !value.result.output ||
              typeof value.result.output !== 'object' ||
              Array.isArray(value.result.output) ||
              hashRuntimeValue(value.result.output.argv) !== hashRuntimeValue(value.command.argv) ||
              value.result.output.cwd !== value.command.cwd ||
              value.result.output.timeoutMs !== value.command.timeoutMs ||
              value.result.output.receiptRef !== value.receiptRef))
        )
          throw new Error('Classic check recovery record does not match the original claim');
        if (value.status === 'completed')
          await assertClassicSdkCheckReceipt(projectRoot, run, action, value.result);
        record = value;
      }
    } catch (error) {
      recordProblem = error instanceof Error ? error.message : String(error);
    }
  }
  let command: unknown = record?.command ?? null;
  if (isCheck && !command) {
    try {
      const fixed = classicSdkCheckCommand(run, action, projectRoot);
      command = { argv: fixed.argv, cwd: fixed.cwd ?? '.', timeoutMs: fixed.timeoutMs ?? 300_000 };
    } catch {
      // 旧 CLI 在执行前未保存 argv；如实报告缺失，不能从上轮检查猜测。
    }
  }
  const locations = await Promise.all(
    ['receiptRef', 'manifestRef'].map(async (key) => {
      const ref = record?.[key];
      if (typeof ref !== 'string') return [key, null] as const;
      try {
        return [
          key,
          {
            ref,
            exists: await classicProjectTargetExists(projectRoot, ref, {
              label: 'Classic check evidence',
              expected: 'file',
            }),
          },
        ] as const;
      } catch (error) {
        return [
          key,
          { ref, exists: false, problem: error instanceof Error ? error.message : String(error) },
        ] as const;
      }
    }),
  );
  const original = { actionId: action.id, attempt: action.attempt, inputHash: action.inputHash };
  const application = run.workflow.id.replace('comet-classic-', 'classic-');
  const requestBase = { runId: run.runId, expectedRevision: run.revision };
  const completed =
    record?.status === 'completed' && record.result && action.claim
      ? (record.result as { status: 'succeeded' | 'failed'; output: unknown })
      : null;
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
    command,
    record: {
      ref: recordRef,
      status: record?.status ?? (recordProblem ? 'invalid' : 'missing'),
      problem: recordProblem,
    },
    evidence: { directory: evidenceDirectory, ...Object.fromEntries(locations) },
    instructions: [
      '检查原执行器是否仍在运行，并核对本次 claim 对应的命令和记录；结果明确前不能继续或重新运行检查。',
      completed
        ? '已找到本次执行结果记录。核对命令、日志、输入快照与退出码后，使用 recordOutcomeRequest 回填原结果；之后仍需通过正常检查证据校验。'
        : '未找到本次完整结果。日志、外部 marker 或进程结束本身不能证明检查通过；联系原执行器取回完整结果，不得编造成功收据。',
      '只有已核实原尝试完全未执行时，才可先 mark-unknown，再重新读取当前 revision 并填写 retryRequestTemplate 的真实核对证据；已经执行或仍不明时不得声明 not-executed。',
    ],
    dispatch: {
      application,
      projectRoot: path.resolve(projectRoot),
      commandArgs: [
        'comet',
        'runtime',
        'dispatch',
        '--application',
        application,
        '--project-root',
        path.resolve(projectRoot),
        '--request',
        '<request.json>',
        '--json',
      ],
    },
    inspectRequest: { operation: 'inspect', runId: run.runId },
    ...(action.status === 'running'
      ? {
          markUnknownRequest: {
            operation: 'mark-unknown',
            ...requestBase,
            actionId: action.id,
            attempt: action.attempt,
            reason: '原执行器中断，正在核对本次执行结果',
          },
        }
      : {}),
    ...(completed
      ? {
          recordOutcomeRequest: {
            operation: 'record-outcome',
            ...requestBase,
            outcome: {
              ...original,
              claimToken: action.claim!.token,
              outcomeId: hashRuntimeValue({ recordRef, result: completed }),
              status: completed.status,
              output: completed.output,
            },
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
        evidence: { summary: '<填写证明原尝试完全未执行的核对结果和来源>' },
      },
    },
  };
}
