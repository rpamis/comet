import { execFileSync } from 'node:child_process';
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
import { compileCheckPolicyPattern } from './classic-check-manifest.js';
import { readCheckPolicy } from './classic-check-policy.js';
import { readClassicArchiveManifest } from './classic-sdk-archive-manifest.js';
import {
  canRepairClassicDelivery,
  type ClassicDeliveryRepair,
  classicDeliveryRepairOriginals as originals,
  classicDeliveryRepairRecord as record,
} from './classic-sdk-delivery-repair-model.js';
import type { ClassicState } from './classic-state.js';
function deliveryPaths(run: Readonly<WorkflowRun>) {
  const output = record(originals(run).check.outcome!.output);
  return Array.isArray(output.deliveryPaths)
    ? (output.deliveryPaths as string[])
    : Object.keys((output.deliveryInputs as Record<string, string>) ?? {});
}
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
  if (run.workflow.version === '2') {
    if (!repair.reports || repair.command || repair.excludedOutputPaths?.length)
      throw new Error(
        'Classic v2 delivery repair requires platform reports and the approved paths',
      );
    return { ...original };
  }
  const checked = record(original.check.outcome!.output);
  if (!repair.command) throw new Error('Original Verify command is incomplete');
  if (
    JSON.stringify(checked.argv) !== JSON.stringify(repair.command.argv) ||
    checked.cwd !== repair.command.cwd ||
    checked.timeoutMs !== repair.command.timeoutMs
  )
    throw new Error('Classic delivery repair command differs from its original Verify');
  const policy = await readCheckPolicy(root, repair.command);
  const matches = (policy.outputs ?? []).map(compileCheckPolicyPattern);
  const excluded = repair.excludedOutputPaths ?? Object.keys(repair.excludedOutputs ?? {});
  for (const ref of excluded) {
    if (!matches.some((match) => match(ref)))
      throw new Error('Classic delivery repair output is outside the declared paths: ' + ref);
    try {
      execFileSync('git', ['cat-file', '-e', original.approved.baseCommit + ':' + ref], {
        cwd: root,
        stdio: 'ignore',
      });
    } catch {
      continue;
    }
    throw new Error('Classic delivery repair cannot omit an existing tracked input: ' + ref);
  }
  return { ...original };
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
  const original = originals(run),
    output = record(original.check.outcome!.output);
  if (run.workflow.version === '2') {
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
  if (reports) throw new Error('Classic v1 delivery repair uses its original managed check');
  if (
    !Array.isArray(output.argv) ||
    typeof output.cwd !== 'string' ||
    typeof output.timeoutMs !== 'number'
  )
    throw new Error('Original Verify command is incomplete');
  const command = {
    argv: output.argv as string[],
    cwd: output.cwd,
    timeoutMs: output.timeoutMs,
    reusable: false as const,
  };
  const policy = await readCheckPolicy(root, command),
    matches = (policy.outputs ?? []).map(compileCheckPolicyPattern);
  const repair: ClassicDeliveryRepair = {
    checkpointHash: await classicDeliveryRepairCheckpointHash(root, run),
    archiveActionId: original.archive.id,
    checkActionId: original.check.id,
    excludedOutputPaths: deliveryPaths(run).filter((ref) => matches.some((match) => match(ref))),
    command,
  };
  await assertClassicDeliveryRepairCurrent(root, run, repair, 'prepare');
  return repair;
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
