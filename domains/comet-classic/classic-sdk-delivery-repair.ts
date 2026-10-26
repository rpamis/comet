import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseDocument } from 'yaml';
import {
  hashRuntimeValue,
  portableRunCheckpointProjectionMatches,
  type WorkflowRun,
} from '../engine/runtime.js';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { compileCheckPolicyPattern, parseCheckManifest } from './classic-check-manifest.js';
import { readCheckPolicy } from './classic-check-policy.js';
import { collectCheckSnapshot, hashGitPaths } from './classic-check-snapshot.js';
import { hashClassicProjectFile, readClassicProjectFile } from './classic-protected-path.js';
import { readClassicArchiveManifest } from './classic-sdk-archive-manifest.js';
import { resolveClassicStateFile } from './classic-state-file.js';
import type { ClassicState } from './classic-state.js';
import { hasClassicManagedRunMarker, parseClassicStateDocument } from './classic-state.js';
import { readClassicSdkDeliveryCheckpoint } from './classic-sdk-delivery-checkpoint.js';
import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import { collectClassicSdkImplementationInputs } from './classic-sdk-implementation-inputs.js';

import {
  type ClassicDeliveryRepair,
  classicDeliveryRepairRecord as record,
  classicDeliveryRepairOriginals as originals,
  canRepairClassicDelivery,
} from './classic-sdk-delivery-repair-model.js';

async function currentHash(root: string, ref: string, expected: string) {
  if (normalizeWorkflowRelativePath(ref, 'Classic delivery recovery input') !== ref)
    throw new Error('Classic delivery recovery input path is invalid');
  const file = await inspectProtectedProjectPath(root, ref, {
    label: 'Classic delivery recovery input',
    expected: 'file',
  });
  if (!file.exists) return 'missing';
  return expected.startsWith('git:')
    ? `git:${hashGitPaths(root, [ref]).get(ref)}`
    : (await hashClassicProjectFile(root, ref, { label: 'Classic delivery recovery input' }))
        .digest;
}

async function originalImplementation(
  root: string,
  run: Readonly<WorkflowRun>,
  proof?: ClassicDeliveryRepair,
) {
  const original = originals(run, proof);
  const state = run.state as unknown as ClassicState;
  const branch = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch: liveGitBranch(root),
    gitWorkTree: isGitWorkTree(root),
  });
  if (!['ok', 'not-applicable'].includes(branch.status))
    throw new Error(
      `Classic delivery repair branch binding is ${branch.status}; return to the approved branch`,
    );
  const output = record(original.check.outcome!.output);
  if (typeof output.manifestRef !== 'string' || typeof output.manifestHash !== 'string')
    throw new Error('Classic delivery recovery is missing the original Verify input manifest');
  const manifest = await readClassicProjectFile(root, output.manifestRef, {
    label: 'Classic original Verify input manifest',
    maxBytes: Number.MAX_SAFE_INTEGER,
  });
  if (createHash('sha256').update(manifest).digest('hex') !== output.manifestHash)
    throw new Error('Classic original Verify input manifest changed');
  const config = parseCheckManifest(manifest).find((entry) => entry.p === '.comet/config.yaml');
  if (config && (await currentHash(root, config.p, config.h)) !== config.h)
    throw new Error(
      'Classic verified project configuration changed; cannot reinterpret input ownership',
    );
  return collectClassicSdkImplementationInputs(root, manifest);
}

/** 输出声明只能移除原基线未追踪的生成物，原实现与已归档文档仍须匹配。 */
export async function assertClassicDeliveryRepairCurrent(
  root: string,
  run: Readonly<WorkflowRun>,
  proof: ClassicDeliveryRepair,
  stage: 'prepare' | 'checked' | 'delivery' = 'delivery',
  currentManifest?: string,
) {
  const original = originals(run, proof);
  await readClassicArchiveManifest(root, run, original.archive, original.archiveRef);
  const inputs = await originalImplementation(root, run, proof);
  const policy = await readCheckPolicy(root, { argv: proof.command.argv, cwd: proof.command.cwd });
  if (
    policy.files !== undefined ||
    !policy.outputs?.length ||
    (policy.entryDigest ?? policy.digest) !== proof.policyHash
  )
    throw new Error(
      'Classic delivery recovery requires the same full input scope and explicit output declaration',
    );
  const matches = policy.outputs.map(compileCheckPolicyPattern);
  const excluded = Object.fromEntries(
    Object.entries(inputs).filter(
      ([ref, hash]) => hash !== 'missing' && matches.some((match) => match(ref)),
    ),
  );
  const regeneratedOutputs: Record<string, string> = {};
  const snapshot =
    currentManifest ??
    (
      await collectCheckSnapshot(
        root,
        path.join(root, original.archiveRef),
        { argv: proof.command.argv, cwd: proof.command.cwd },
        { verificationReport: (run.state as unknown as ClassicState).verificationReport },
      )
    ).manifest;
  const observed = new Map(parseCheckManifest(snapshot).map((entry) => [entry.p, entry.h]));
  if (
    !Object.keys(excluded).length ||
    hashRuntimeValue(excluded) !== hashRuntimeValue(proof.excludedOutputs)
  )
    throw new Error('Classic delivery recovery output scope changed');
  for (const [ref, expected] of Object.entries(inputs)) {
    if (!/^(?:missing|git:[a-f0-9]{40}(?:[a-f0-9]{24})?|[a-f0-9]{64})$/u.test(expected))
      throw new Error('Classic delivery recovery input identity is invalid');
    if (Object.hasOwn(excluded, ref)) {
      try {
        execFileSync('git', ['cat-file', '-e', `${original.approved.baseCommit}:${ref}`], {
          cwd: root,
          stdio: 'ignore',
        });
      } catch {
        if (stage === 'delivery') continue;
        const actual = await currentHash(root, ref, expected);
        if (stage === 'prepare' && actual === 'missing') continue;
        if (stage === 'checked' && actual !== 'missing') {
          regeneratedOutputs[ref] = actual;
          continue;
        }
        throw new Error(
          stage === 'prepare'
            ? `Remove only the declared generated output before rechecking: ${ref}; existing inputs cannot be reclassified as outputs`
            : `Classic delivery output was not regenerated by the original command: ${ref}`,
        );
      }
      throw new Error(
        `Classic delivery recovery cannot omit a file tracked by the approved baseline: ${ref}`,
      );
    }
    if (observed.get(ref) !== expected && (await currentHash(root, ref, expected)) !== expected)
      throw new Error(
        `Classic verified implementation changed: ${ref}; restore it before repairing output declarations`,
      );
  }
  return { ...original, regeneratedOutputs };
}

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
  const state = parseClassicStateDocument(data).classic;
  if (
    hashRuntimeValue(state) !== hashRuntimeValue(run.state) ||
    (!portableRunCheckpointProjectionMatches(checkpoint, run as WorkflowRun) &&
      readClassicSdkDeliveryCheckpoint(checkpoint, run as WorkflowRun, { projection: true }) ===
        null)
  )
    throw new Error('Classic archived checkpoint changed after the authoritative Run was read');
  return hashRuntimeValue(checkpoint);
}

export async function captureClassicDeliveryRepair(
  root: string,
  run: Readonly<WorkflowRun>,
): Promise<ClassicDeliveryRepair> {
  if (!canRepairClassicDelivery(run))
    throw new Error(
      'Classic delivery repair requires unclaimed delivery work, its pending approval, or a settled failed repair check on the original archived Run',
    );
  const original = originals(run);
  const output = record(original.check.outcome!.output);
  if (
    !Array.isArray(output.argv) ||
    output.argv.some((v: unknown) => typeof v !== 'string') ||
    typeof output.cwd !== 'string' ||
    typeof output.timeoutMs !== 'number'
  )
    throw new Error('Classic original Verify command is incomplete');
  const command = {
    argv: output.argv as string[],
    cwd: output.cwd,
    timeoutMs: output.timeoutMs,
    reusable: false as const,
  };
  const policy = await readCheckPolicy(root, command);
  const matches = (policy.outputs ?? []).map(compileCheckPolicyPattern);
  const implementation = await originalImplementation(root, run);
  const checkpointHash = await classicDeliveryRepairCheckpointHash(root, run);
  const proof: ClassicDeliveryRepair = {
    checkpointHash,
    archiveActionId: original.archive.id,
    checkActionId: original.check.id,
    policyHash: policy.entryDigest ?? policy.digest,
    excludedOutputs: Object.fromEntries(
      Object.entries(implementation).filter(
        ([ref, hash]) => hash !== 'missing' && matches.some((match) => match(ref)),
      ),
    ),
    command,
  };
  await assertClassicDeliveryRepairCurrent(root, run, proof, 'prepare');
  return proof;
}
