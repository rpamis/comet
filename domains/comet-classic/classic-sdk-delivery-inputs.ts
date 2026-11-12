import { execFileSync } from 'node:child_process';
import { acceptedClassicLegacyVerifyCheck } from './classic-sdk-run-upgrade.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createFileRuntimeStore, type RuntimeValue, type WorkflowRun } from '../engine/runtime.js';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import { resolveWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import { archivedClassicDocumentRef } from './classic-archive-annotation.js';
import { isGitWorkTree } from './classic-branch-binding.js';
import { resolveClassicLayout } from './classic-layout.js';
import { classicDeliveryActionContext } from './classic-sdk-delivery-repair-model.js';
import {
  classicForeignChangeRoots,
  isClassicInputUnderRoot,
} from './classic-sdk-implementation-inputs.js';
function git(root: string, args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: Number.MAX_SAFE_INTEGER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function changedPaths(root: string) {
  let tracked: string;
  try {
    tracked = git(root, ['diff', 'HEAD', '--name-only', '--no-renames', '-z']);
  } catch {
    tracked = git(root, ['ls-files', '--cached', '-z']);
  }
  return [
    ...new Set(
      [
        ...tracked.split('\0'),
        ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
      ].filter(Boolean),
    ),
  ];
}
async function excludedImplementationRoots(root: string): Promise<string[]> {
  const layout = await resolveClassicLayout(root);
  return [
    '.comet',
    layout.openSpecRoot,
    layout.superpowersRoot,
    ...(await classicForeignChangeRoots(root)),
  ].map((ref) => (path.isAbsolute(ref) ? path.relative(root, ref).replaceAll('\\', '/') : ref));
}
interface WorkspaceBaseline {
  runId: string;
  revision: number;
  paths: string[];
  files?: Record<string, string>;
}
async function baselineStore(root: string) {
  return createFileRuntimeStore<WorkspaceBaseline>({
    singleWriter: true,
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(root), 'classic-delivery-baselines'),
  });
}
/** 只记录已有未提交路径；Agent 可通过既有检查范围明确选择其中的本次修改。 */
export async function captureClassicSdkWorkspaceBaseline(root: string) {
  return isGitWorkTree(root)
    ? { schema: 'comet.classic.workspace-baseline.v2', paths: changedPaths(root) }
    : undefined;
}
export async function bindClassicSdkWorkspaceBaseline(
  root: string,
  input: Record<string, RuntimeValue>,
) {
  const baseline = await captureClassicSdkWorkspaceBaseline(root);
  if (!baseline) return input;
  const ref = randomUUID();
  await (
    await baselineStore(root)
  ).compareAndSwap(ref, null, { runId: ref, revision: 1, paths: baseline.paths });
  return { ...input, workspaceBaseline: { ref } };
}
async function initialPaths(root: string, run?: Readonly<WorkflowRun>) {
  const ref = (
    run?.input as
      | {
          workspaceBaseline?: {
            ref?: string;
          };
        }
      | undefined
  )?.workspaceBaseline?.ref;
  if (!ref) return new Set<string>();
  const baseline = await (await baselineStore(root)).read(ref);
  return new Set(baseline?.paths ?? Object.keys(baseline?.files ?? {}));
}
/** 保存 Agent 本轮检查选择的交付路径，不为文件字节创建证明。 */
export async function collectClassicSdkDeliveryInputs(
  root: string,
  run?: Readonly<WorkflowRun>,
  deliveryPaths?: readonly string[],
): Promise<string[]> {
  if (!isGitWorkTree(root)) return [];
  const excluded = await excludedImplementationRoots(root);
  const baseline = await initialPaths(root, run);
  if (deliveryPaths) {
    for (const ref of deliveryPaths) {
      normalizeWorkflowRelativePath(ref, 'Classic delivery path');
      if (isClassicInputUnderRoot(ref, excluded) || ref.split('/').includes('node_modules'))
        throw new Error(
          'Classic delivery path belongs to workflow metadata or another change: ' + ref,
        );
    }
    return [...new Set(deliveryPaths)].sort();
  }
  return changedPaths(root)
    .filter(
      (ref) =>
        !ref.split('/').includes('node_modules') &&
        !isClassicInputUnderRoot(ref, excluded) &&
        !baseline.has(ref),
    )
    .sort();
}
/** 交付核对路径、Git 提交与真实结果；实际内容由 Agent 审阅。 */
export async function assertClassicSdkDeliveryInputs(
  root: string,
  run: Readonly<WorkflowRun>,
): Promise<Set<string>> {
  const state = run.state as {
    workflow: string;
    verificationReport?: string | null;
  };
  const deliveryAction = [...run.actions]
    .reverse()
    .find((action) => action.stepId === state.workflow + '.archive.deliver');
  const repairCheckId = deliveryAction
    ? classicDeliveryActionContext(run, deliveryAction)?.repairCheckId
    : undefined;
  const legacy = acceptedClassicLegacyVerifyCheck(run);
  const check = repairCheckId
    ? run.actions.find((action) => action.id === repairCheckId)
    : [...run.actions]
        .reverse()
        .find((action) => action.stepId === state.workflow + '.archive.preflight');
  if (check?.status !== 'succeeded' || check.outcome?.status !== 'succeeded')
    throw new Error('Classic 交付需要当前成功的 Verify 检查');
  const output = check.outcome.output as {
    deliveryPaths?: string[];
    deliveryInputs?: Record<string, string>;
  };
  const legacyInputs = legacy?.output.deliveryInputs;
  const excluded = output.deliveryPaths ? [] : await excludedImplementationRoots(root);
  const paths = (
    output.deliveryPaths ?? Object.keys(output.deliveryInputs ?? legacyInputs ?? {})
  ).filter((ref) => !isClassicInputUnderRoot(ref, excluded));
  const report = run.evidenceWaits
    ?.slice()
    .reverse()
    .find(
      (wait) =>
        wait.stepId === state.workflow + '.verify.report.evidence' && wait.status === 'resolved',
    )?.receipt;
  const active = (
      run.input as {
        changeDir: string;
      }
    ).changeDir,
    archive = (
      run.outputs[state.workflow + '.archive.execute']?.value as {
        archiveDirectory?: string;
      }
    )?.archiveDirectory;
  if (state.verificationReport && !report) throw new Error('Classic 交付缺少已接受的验证报告');
  if (report)
    paths.push(archive ? archivedClassicDocumentRef(report.ref, active, archive)! : report.ref);
  return assertClassicSdkDeliveryFileInputs(root, paths);
}
export async function assertClassicSdkDeliveryFileInputs(
  root: string,
  inputs: readonly string[] | Record<string, string>,
  _boundReportRef?: string,
): Promise<Set<string>> {
  const refs = Array.isArray(inputs) ? inputs : Object.keys(inputs);
  for (const ref of refs) {
    normalizeWorkflowRelativePath(ref, 'Classic delivery path');
  }
  const dirty = refs.length
    ? git(root, ['status', '--porcelain', '--untracked-files=all', '--', ...refs]).trim()
    : '';
  if (dirty) throw new Error('Classic 交付路径尚有未提交修改：' + dirty);
  return new Set(refs);
}
