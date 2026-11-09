import { execFileSync } from 'node:child_process';
import type { WorkflowRun } from '../engine/runtime.js';
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
  const checked = record(original.check.outcome!.output);
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
): Promise<ClassicDeliveryRepair> {
  if (!canRepairClassicDelivery(run))
    throw new Error(
      'Classic delivery repair requires the original archived Run with no unresolved execution',
    );
  const original = originals(run),
    output = record(original.check.outcome!.output);
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
    archiveActionId: original.archive.id,
    checkActionId: original.check.id,
    excludedOutputPaths: deliveryPaths(run).filter((ref) => matches.some((match) => match(ref))),
    command,
  };
  await assertClassicDeliveryRepairCurrent(root, run, repair, 'prepare');
  return repair;
}
