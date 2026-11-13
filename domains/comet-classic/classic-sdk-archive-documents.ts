import type { RuntimeAction, WorkflowRun } from '../engine/runtime.js';
import { classicDeliveryActionContext } from './classic-sdk-delivery-repair-model.js';

interface ArchiveDocumentOutputs {
  outputs: Record<string, unknown>;
  recovered: boolean;
}

/** 重开验收沿用原已接受 Build 的 Design/Plan，不借用已删除的检查执行证据。 */
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
  const sequence = run.actionContexts[action.id]?.sequence;
  if (sequence === undefined) return { outputs, recovered: false };
  const command = [...(run.commands ?? [])]
    .reverse()
    .find(
      (entry) =>
        entry.actionId === action.id ||
        (run.actionContexts[entry.actionId]?.sequence ?? Infinity) < sequence,
    );
  if (!command || !['reopen-verification', 'continue-build'].includes(command.name))
    return { outputs, recovered: false };
  const reopenedAt = run.actionContexts[command.actionId].sequence;
  const builders = [...run.actions]
    .reverse()
    .filter(
      (entry) =>
        entry.stepId === 'full.build.execute' &&
        (run.actionContexts[entry.id]?.sequence ?? Infinity) < reopenedAt,
    );
  const accepted = builders[0];
  if (
    accepted?.status !== 'succeeded' ||
    accepted.outcome?.status !== 'succeeded' ||
    (accepted.outcome.output as { event?: unknown }).event !== 'build-complete'
  )
    return { outputs, recovered: false };
  for (const builder of builders) {
    const builtAt = run.actionContexts[builder.id].sequence;
    if (
      run.commands?.some(
        (entry) =>
          ['revise-design', 'revise-plan'].includes(entry.name) &&
          run.actionContexts[entry.actionId]?.sequence > builtAt &&
          run.actionContexts[entry.actionId].sequence < reopenedAt,
      )
    )
      break;
    const source = (builder.input as { outputs?: Record<string, unknown> }).outputs;
    if (source?.['full.build.plan'] === undefined || source['full.design.document'] === undefined)
      continue;
    return {
      recovered: true,
      outputs: {
        'full.design.document': source['full.design.document'],
        'full.build.plan': source['full.build.plan'],
      },
    };
  }
  return { outputs, recovered: false };
}
