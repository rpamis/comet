import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  hashRuntimeValue,
  portableClaimToken,
  type RuntimeAction,
  type WorkflowRun,
} from '../engine/runtime.js';
import { annotatedMarkdown, archivedClassicDocumentRef } from './classic-archive-annotation.js';
import { readClassicProjectFile } from './classic-protected-path.js';
import { classicTaskRevision } from './classic-tasks.js';
import { classicDeliveryActionContext } from './classic-sdk-delivery-repair-model.js';

interface DocumentReceipt {
  ref: string;
  contentHash: string;
}
interface ArchiveDocumentOutputs {
  outputs: Record<string, unknown>;
  recovered: boolean;
  evidence?: { design: DocumentReceipt; plan: DocumentReceipt };
}

/** 显式重开 Verify 不继承旧执行链，但已通过 Build 的文档验收仍然有效。 */
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
  const command = run.commands
    ?.slice()
    .reverse()
    .find((entry) => (run.actionContexts[entry.actionId]?.sequence ?? Infinity) < actionSequence);
  // 内置修订命令只有这三种；Design/Plan 修订只允许在 Design/Build，
  // 因而成功重开 Verify 后可接受的后续修订仍只能是再次重开 Verify。
  if (command?.name !== 'reopen-verification') return { outputs, recovered: false };
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
    accepted.receipt.contentHash !== receipt?.contentHash ||
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
  return {
    outputs: Object.fromEntries(
      Object.entries(accepted.results)
        .filter(([step]) => ['full.design.document', 'full.build.plan'].includes(step))
        .map(([step, value]) => [step, value.value]),
    ),
    recovered: true,
    evidence: {
      design: (accepted.results['full.design.evidence']?.value ??
        (accepted.results['full.build.plan']?.value as { designEvidence?: unknown })
          ?.designEvidence) as DocumentReceipt,
      plan: accepted.results['full.build.plan.evidence']?.value as unknown as DocumentReceipt,
    },
  };
}

/** 旧版已归档 Run 也必须携带原验收正文，只允许确定性的归档注记。 */
export async function assertClassicRecoveredArchiveDocuments(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
  archiveRef: string;
  activeRef: string;
  designRef: string;
  planRef: string;
  committedDesign: string;
  committedPlan: string;
  evidence: ArchiveDocumentOutputs['evidence'];
}): Promise<void> {
  const { projectRoot, run, archiveRef, activeRef, designRef, planRef, evidence } = options;
  const archiveAction = run.actions
    .slice()
    .reverse()
    .find(
      (action) =>
        action.stepId === 'full.archive.execute' &&
        action.status === 'succeeded' &&
        (action.outcome?.output as { archiveDirectory?: string } | undefined)?.archiveDirectory ===
          archiveRef,
    );
  const receipt = JSON.parse(
    await readClassicProjectFile(projectRoot, `${archiveRef}/.comet/archive-documents.json`, {
      label: 'Classic Archive document receipt',
    }),
  );
  if (
    !archiveAction?.claim ||
    receipt.runId !== run.runId ||
    receipt.actionId !== archiveAction.id ||
    receipt.attempt !== archiveAction.attempt ||
    receipt.inputHash !== archiveAction.inputHash ||
    receipt.claimToken !== portableClaimToken(archiveAction.claim.token) ||
    evidence?.design?.ref !== designRef ||
    evidence.plan?.ref !== planRef
  )
    throw new Error('Classic recovered Archive document evidence is missing or changed');
  const design = receipt.documents?.[designRef];
  const plan = receipt.documents?.[planRef];
  if (
    typeof design?.original !== 'string' ||
    design.extraFields !== 'status: final' ||
    typeof plan?.original !== 'string' ||
    plan.extraFields !== ''
  )
    throw new Error('Classic recovered Archive document receipt is invalid');
  const digest = (source: string) => createHash('sha256').update(source).digest('hex');
  const tasks = await readClassicProjectFile(projectRoot, `${archiveRef}/tasks.md`, {
    label: 'Classic archived task requirements',
  });
  // Plan evidence binds both the original plan bytes and the canonical task scope.
  const planHash = digest(
    JSON.stringify([
      [planRef, digest(plan.original)],
      [`${activeRef}/tasks.md`, classicTaskRevision(tasks)],
    ]),
  );
  if (
    digest(design.original) !== evidence.design.contentHash ||
    planHash !== evidence.plan.contentHash
  )
    throw new Error('Classic recovered Archive document receipt does not match accepted evidence');
  const name = path.posix.basename(archiveRef);
  for (const [ref, original, extraFields, committed] of [
    [designRef, design.original, 'status: final', options.committedDesign],
    [planRef, plan.original, '', options.committedPlan],
  ]) {
    const expected = annotatedMarkdown(original, name, extraFields);
    const current = await readClassicProjectFile(
      projectRoot,
      archivedClassicDocumentRef(ref, activeRef, archiveRef)!,
      {
        label: 'Classic recovered Archive document',
      },
    );
    if (current !== expected || committed !== expected)
      throw new Error(`Classic recovered Archive document changed after accepted evidence: ${ref}`);
  }
}
