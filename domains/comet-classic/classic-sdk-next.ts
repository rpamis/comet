import { randomUUID } from 'node:crypto';
import type { WorkflowRun } from '../engine/runtime.js';
import { executeClassicSdkCheckCommand } from './classic-check-command.js';
import { executeClassicSdkArchivePreflight } from './classic-sdk-archive-preflight.js';
import { executeClassicSdkArchive } from './classic-sdk-archive.js';
import { classicSdkCheckCommand, classicSdkCheckRefreshInput } from './classic-sdk-check.js';
import { classicSdkCheckPreparationInput } from './classic-sdk-check-preparation.js';
import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';
import type { ClassicState } from './classic-state.js';

type Inspection = Awaited<ReturnType<typeof inspectClassicSdkRun>>;

/** 只提交原 Action 已产生的材料引用；验收与权限仍由原 SDK validator 核对。 */
async function continueEvidence(projectRoot: string, inspected: Inspection) {
  const { run, runtime, state, profile } = inspected;
  const evidence = run.evidenceWaits?.find((wait) => wait.status === 'pending');
  if (!evidence) return null;
  const sources: Record<string, { step: string; ref: unknown }> = {
    'classic-open-artifacts': {
      step: `${profile}.open`,
      ref: (run.input as { changeDir: string }).changeDir,
    },
    'classic-design-document': { step: 'full.design.document', ref: state.designDoc },
    'classic-build-plan': { step: 'full.build.plan', ref: state.plan },
    'classic-verification-report': { step: `${profile}.verify.run`, ref: state.verificationReport },
    'classic-build-check': { step: `${profile}.build.check`, ref: null },
    'classic-verify-check': { step: `${profile}.verify.check`, ref: null },
  };
  const source = sources[evidence.kind];
  if (!source) return null;
  const action = [...run.actions].reverse().find((action) => action.stepId === source.step);
  if (!action || action.status !== 'succeeded') return null;
  const ref = source.ref ?? (action.outcome?.output as { receiptRef?: string })?.receiptRef;
  if (typeof ref !== 'string' || !ref) return null;
  return runtime.recordEvidence({
    runId: run.runId,
    expectedRevision: run.revision,
    evidenceId: evidence.id,
    kind: evidence.kind,
    ref,
    contentHash: action.inputHash,
    submissionId: randomUUID(),
    context: { requestId: randomUUID(), projectRoot },
  });
}

/** 合并明确续行中的内部操作；不猜命令、不领取 Agent 工作、不代替用户决定。 */
export async function advanceClassicSdkChange(
  projectRoot: string,
  change: string,
  inspected: Inspection,
): Promise<{ run: WorkflowRun; failure?: string }> {
  let { run } = inspected;
  if (['completed', 'cancelled', 'failed'].includes(run.status)) return { run };
  const binding = evaluateBranchBinding({
    isolation: inspected.state.isolation,
    boundBranch: inspected.state.boundBranch,
    currentBranch: liveGitBranch(projectRoot),
    gitWorkTree: isGitWorkTree(projectRoot),
  });
  if (!['ok', 'not-applicable'].includes(binding.status))
    return {
      run,
      failure: `Classic continuation requires its original workspace branch (${binding.status}).`,
    };
  try {
    while (!['completed', 'cancelled', 'failed'].includes(run.status)) {
      const state = run.state as unknown as ClassicState;
      inspected = { ...inspected, run, state };
      if (
        run.actions.some((action) => ['running', 'unknown'].includes(action.status)) ||
        run.waits.some((wait) => wait.status === 'pending')
      )
        break;
      if (run.ready.length) {
        run = await inspected.runtime.next({ runId: run.runId });
        continue;
      }
      if (run.evidenceWaits?.some((wait) => wait.status === 'pending')) {
        const recorded = await continueEvidence(projectRoot, inspected);
        if (!recorded) break;
        run = recorded;
        continue;
      }
      const action = run.actions.find((action) => action.status === 'pending');
      if (!action || action.type !== 'call_tool') break;
      if (action.ref === 'classic-open-revalidate') {
        run = await inspected.runtime.execute({
          runId: run.runId,
          actionId: action.id,
          executorId: 'comet-classic-open-revalidate',
          context: { requestId: randomUUID(), projectRoot },
        });
      } else if (action.ref === 'classic-check') {
        if (action.stepId.endsWith('.delivery.check')) {
          run = await inspected.runtime.execute({
            runId: run.runId,
            actionId: action.id,
            executorId: 'comet-classic-check',
            context: { requestId: randomUUID(), projectRoot },
          });
        } else {
          // 仅原 Run input 或明确 prepare/refresh command 中的计划可执行。
          const scope = action.stepId.includes('.build.') ? 'build' : 'verify';
          const plans = (
            run.input as { checkCommands?: Partial<Record<'build' | 'verify', unknown>> }
          ).checkCommands;
          if (
            !plans?.[scope] &&
            !classicSdkCheckPreparationInput(run, action) &&
            !classicSdkCheckRefreshInput(run, action)
          )
            break;
          const command = classicSdkCheckCommand(run, action, projectRoot);
          const checked = await executeClassicSdkCheckCommand(inspected, change, scope, command);
          run = checked.run;
          if (checked.result.exitCode !== 0)
            return {
              run,
              failure:
                checked.result.stderr?.trim() ||
                'Classic check failed; retain the original execution and repair its reported failure.',
            };
        }
      } else if (action.ref === 'classic-archive-preflight') {
        run = await executeClassicSdkArchivePreflight(inspected.runtime, {
          runId: run.runId,
          projectRoot,
        });
      } else if (action.ref === 'classic-archive') {
        run = await executeClassicSdkArchive(inspected.runtime, { runId: run.runId, projectRoot });
      } else break;
      const settled = run.actions.find((entry) => entry.id === action.id);
      if (settled?.status !== 'succeeded')
        return {
          run,
          failure: `Classic ${action.stepId} did not succeed; continue from its recorded result.`,
        };
    }
    return { run };
  } catch (error) {
    return {
      run: await inspected.runtime.inspect(run.runId),
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}
