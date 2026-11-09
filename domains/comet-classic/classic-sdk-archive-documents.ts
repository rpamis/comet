import { hashRuntimeValue, type RuntimeAction, type WorkflowRun } from '../engine/runtime.js';
import { classicDeliveryActionContext } from './classic-sdk-delivery-repair-model.js';

interface ArchiveDocumentOutputs {
  outputs: Record<string, unknown>;
  recovered: boolean;
}

/** 显式续行不继承旧执行结果；仍有效的 Design 与 Plan 使用原接受来源。 */
export function classicArchiveDocumentOutputs(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): ArchiveDocumentOutputs {
  const delivery = classicDeliveryActionContext(run, action);
  if (delivery) {
    const archive = run.actions.find((entry) => entry.id === delivery.archiveActionId);
    if (!archive) throw new Error('Classic delivery recovery is missing its original Archive');
    return classicArchiveDocumentOutputs(run, archive);
  }
  const outputs = (action.input as { outputs?: Record<string, unknown> }).outputs ?? {};
  if (outputs['full.build.plan'] !== undefined) return { outputs, recovered: false };
  const actionSequence = run.actionContexts[action.id]?.sequence;
  if (actionSequence === undefined) return { outputs, recovered: false };
  const command =
    run.commands?.find(
      (entry) => entry.name === 'refresh-checks' && entry.actionId === action.id,
    ) ??
    run.commands
      ?.slice()
      .reverse()
      .find((entry) => (run.actionContexts[entry.actionId]?.sequence ?? Infinity) < actionSequence);
  if (command?.name === 'refresh-checks') {
    const refresh = run.actions.find((entry) => entry.id === command.actionId);
    const sourceActionId = (
      refresh?.input as { activation?: { sourceActionId?: unknown } } | undefined
    )?.activation?.sourceActionId;
    const source = run.actions.find((entry) => entry.id === sourceActionId);
    if (
      refresh?.ref !== 'classic-check' ||
      !source ||
      source.ref !== 'classic-check' ||
      !(
        source.status === 'succeeded' ||
        (source.status === 'failed' &&
          run.commands?.some(
            (entry) => entry.name === 'refresh-checks' && entry.actionId === source.id,
          ))
      ) ||
      !source.outcome ||
      (run.actionContexts[source.id]?.sequence ?? Infinity) >=
        (run.actionContexts[refresh.id]?.sequence ?? -Infinity)
    )
      return { outputs, recovered: false };
    return classicArchiveDocumentOutputs(run, source);
  }
  if (!command || !['reopen-verification', 'continue-build'].includes(command.name))
    return { outputs, recovered: false };
  const reopenedAt = run.actionContexts[command.actionId].sequence;
  // 先找最近一轮，再检查结果；失效或未验收的新轮次不能回退到更老的成功。
  const accepted = run.evidenceWaits
    ?.slice()
    .reverse()
    .find((wait) => wait.stepId === 'full.build.check.evidence' && wait.sequence < reopenedAt);
  const result = accepted?.results['full.build.check'];
  const checked = run.actions.find(
    (entry) =>
      entry.stepId === 'full.build.check' &&
      run.actionContexts[entry.id]?.sequence === result?.sequence,
  );
  const receipt = checked?.outcome?.output as
    { receiptRef?: string; contentHash?: string } | undefined;
  if (
    accepted?.status !== 'resolved' ||
    !accepted.receipt ||
    !result ||
    checked?.status !== 'succeeded' ||
    checked.outcome?.status !== 'succeeded' ||
    hashRuntimeValue(checked.outcome.output) !== hashRuntimeValue(result.value) ||
    accepted.receipt.ref !== receipt?.receiptRef ||
    (accepted.receipt.contentHash !== checked.inputHash &&
      accepted.receipt.contentHash !== receipt?.contentHash) ||
    run.commands?.some((entry) => {
      const sequence = run.actionContexts[entry.actionId]?.sequence;
      return (
        ['revise-design', 'revise-plan'].includes(entry.name) &&
        sequence !== undefined &&
        sequence > accepted.sequence &&
        sequence < reopenedAt
      );
    })
  )
    return { outputs, recovered: false };
  const inherited: ArchiveDocumentOutputs = accepted.results['full.build.plan']
    ? {
        recovered: false,
        outputs: Object.fromEntries(
          Object.entries(accepted.results).map(([step, value]) => [step, value.value]),
        ),
      }
    : classicArchiveDocumentOutputs(run, checked);
  return recoveredArchiveDocuments(inherited);
}

function recoveredArchiveDocuments(inherited: ArchiveDocumentOutputs): ArchiveDocumentOutputs {
  const source = inherited.outputs;
  return {
    outputs: Object.fromEntries(
      Object.entries(source).filter(([step]) =>
        ['full.design.document', 'full.build.plan'].includes(step),
      ),
    ),
    recovered: true,
  };
}
