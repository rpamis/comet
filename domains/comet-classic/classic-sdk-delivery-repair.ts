import path from 'node:path';
import { parseDocument } from 'yaml';
import {
  hashRuntimeValue,
  portableRunCheckpointProjectionMatches,
  type WorkflowRun,
} from '../engine/runtime.js';
import { readClassicProjectFile } from './classic-protected-path.js';
import { resolveClassicStateFile } from './classic-state-file.js';
import { hasClassicManagedRunMarker, parseClassicStateDocument } from './classic-state.js';
import { readClassicSdkDeliveryCheckpoint } from './classic-sdk-delivery-checkpoint.js';
import { assertClassicAgentCheckReports } from './classic-sdk-application.js';
import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import { readClassicArchiveManifest } from './classic-sdk-archive-manifest.js';
import {
  canRepairClassicDelivery,
  type ClassicDeliveryRepair,
  classicDeliveryRepairOriginals as originals,
  classicDeliveryRepairRecord as record,
} from './classic-sdk-delivery-repair-model.js';
import type { ClassicState } from './classic-state.js';
/** 归档后只沿原 Run、分支、命令和明确输出路径继续；内容影响由 Agent 判断。 */
export async function assertClassicDeliveryRepairCurrent(
  root: string,
  run: Readonly<WorkflowRun>,
  repair: ClassicDeliveryRepair,
  _stage: 'prepare' | 'checked' | 'delivery' = 'delivery',
  _currentManifest?: string,
) {
  const original = originals(run, repair);
  const state = run.state as unknown as ClassicState;
  const branch = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch: liveGitBranch(root),
    gitWorkTree: isGitWorkTree(root),
  });
  if (!['ok', 'not-applicable'].includes(branch.status))
    throw new Error('Classic delivery repair requires its approved branch');
  await readClassicArchiveManifest(root, run, original.archive, original.archiveRef);
  {
    if (!repair.reports || repair.command || repair.excludedOutputPaths?.length)
      throw new Error(
        'Classic v2 delivery repair requires platform reports and the approved paths',
      );
    return { ...original };
  }
}
export async function captureClassicDeliveryRepair(
  root: string,
  run: Readonly<WorkflowRun>,
  reports?: ClassicDeliveryRepair['reports'],
): Promise<ClassicDeliveryRepair> {
  if (!canRepairClassicDelivery(run))
    throw new Error(
      'Classic delivery repair requires the original archived Run with no unresolved execution',
    );
  const original = originals(run);
  {
    if (!reports)
      throw new Error('Classic v2 delivery repair requires --checks <checks-json-file>');
    assertClassicAgentCheckReports(reports);
    const repair: ClassicDeliveryRepair = {
      checkpointHash: await classicDeliveryRepairCheckpointHash(root, run),
      archiveActionId: original.archive.id,
      checkActionId: original.check.id,
      reports,
    };
    await assertClassicDeliveryRepairCurrent(root, run, repair, 'prepare');
    return repair;
  }
}
/** Bind the original Run checkpoint, which remains immutable after Git delivery. */
export async function classicDeliveryRepairCheckpointHash(
  root: string,
  run: Readonly<WorkflowRun>,
) {
  const original = originals(run);
  const source = await readClassicProjectFile(
    root,
    await resolveClassicStateFile(path.join(root, original.archiveRef)),
    { label: 'Classic archived delivery checkpoint', maxBytes: Number.MAX_SAFE_INTEGER },
  );
  const document = parseDocument(source, { uniqueKeys: true });
  if (!hasClassicManagedRunMarker(source) || document.errors.length)
    throw new Error('Classic archived checkpoint is invalid');
  const data = record(document.toJS());
  const checkpoint = data.run_checkpoint;
  if (
    hashRuntimeValue(parseClassicStateDocument(data).classic) !== hashRuntimeValue(run.state) ||
    (!portableRunCheckpointProjectionMatches(checkpoint, run as WorkflowRun) &&
      readClassicSdkDeliveryCheckpoint(checkpoint, run as WorkflowRun, { projection: true }) ===
        null)
  )
    throw new Error('Classic archived checkpoint changed after the authoritative Run was read');
  return hashRuntimeValue(checkpoint);
}
