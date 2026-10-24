import { readLegacyClassicArchiveInputs } from './classic-sdk-archive-legacy-manifest.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createFileRuntimeStore,
  hashRuntimeValue,
  runtimeExecutionBinding,
  type RuntimeAction,
  type RuntimeArtifactRef,
  type WorkflowRun,
} from '../engine/runtime.js';
import {
  resolveWorkspaceRuntimeRoot,
  isWorkspaceRuntimeMigrationFence,
} from '../workflow-contract/workspace-runtime.js';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { annotatedMarkdown, archivedClassicDocumentRef } from './classic-archive-annotation.js';
import {
  hashClassicProjectFile,
  readClassicProjectFile,
  writeClassicProjectText,
} from './classic-protected-path.js';
import { resolveClassicStateFile } from './classic-state-file.js';
import type { ClassicState } from './classic-state.js';

const manifestName = '.comet/archive-manifest.json';
const digest = (source: string) => createHash('sha256').update(source).digest('hex');
type Files = Record<string, string>;
interface ArchiveSnapshot {
  activeRef: string;
  stateRef: string;
  specsRef: string;
  files: Files;
  specs: Files;
  optionalFiles: Files;
  documents: Record<string, { original: string; extraFields: string }>;
}
interface ArchiveManifest {
  schema: 'comet.classic.archive-manifest.v1';
  execution: ReturnType<typeof runtimeExecutionBinding>;
  verified: string;
  activeRef: string;
  archiveRef: string;
  stateRef: string;
  sources: Files;
  files: Files;
  optionalFiles: Files;
}
interface ArchiveReceipt {
  runId: string;
  revision: number;
  manifest: ArchiveManifest;
  artifact: RuntimeArtifactRef;
}

function verificationBinding(run: Readonly<WorkflowRun>) {
  const profile = (run.state as unknown as ClassicState).workflow;
  const action = run.actions
    .slice()
    .reverse()
    .find((entry) => entry.stepId === `${profile}.verify.check` && entry.status === 'succeeded');
  if (!action?.outcome) throw new Error('Classic Archive 缺少已验收的检查结果');
  return hashRuntimeValue({
    actionId: action.id,
    inputHash: action.inputHash,
    output: action.outcome.output,
  });
}

function archiveTransientPaths(ref: string, stateRef: string) {
  return new Set([stateRef, `${ref}/.comet-state.lock`, `${ref}/.comet-state-transaction.json`]);
}

async function migrationFiles(root: string, ref: string): Promise<Files> {
  const files: Files = {};
  for (const name of ['.comet-state.lock', '.comet-state-transaction.json']) {
    const directory = path.join(root, ref, name);
    if (await isWorkspaceRuntimeMigrationFence(directory)) {
      const file = `${ref}/${name}/.comet-runtime-migration.json`;
      files[file] = (
        await hashClassicProjectFile(root, file, { label: 'Classic Archive migration fence' })
      ).digest;
    }
  }
  return files;
}

async function tree(root: string, ref: string, omit: Set<string> = new Set()): Promise<Files> {
  const result: Files = {};
  async function walk(current: string) {
    const entry = await inspectProtectedProjectPath(root, current, {
      label: 'Classic Archive manifest',
      expected: 'any',
    });
    if (!entry.exists || omit.has(current)) return;
    if (entry.kind === 'directory') {
      for (const name of (await fs.readdir(entry.target)).sort()) await walk(`${current}/${name}`);
    } else
      result[current] = (
        await hashClassicProjectFile(root, current, { label: 'Classic Archive manifest' })
      ).digest;
  }
  await walk(ref);
  return result;
}

/** 在 OpenSpec 执行前固定已经复查的输入，而不是在交付时猜测归档应包含什么。 */
export async function captureClassicArchiveInputs(
  root: string,
  run: Readonly<WorkflowRun>,
  specsRef: string,
): Promise<ArchiveSnapshot> {
  const activeRef = (run.input as { changeDir: string }).changeDir;
  const stateRef = path
    .relative(root, await resolveClassicStateFile(path.join(root, activeRef)))
    .replaceAll('\\', '/');
  const existing = await inspectProtectedProjectPath(root, `${activeRef}/${manifestName}`, {
    label: 'Classic Archive manifest',
    expected: 'file',
  });
  if (existing.exists)
    throw new Error(
      'Classic Archive 输入已有执行清单；保留原记录并恢复同一 Run，不能重新执行 Archive',
    );
  const files = await tree(root, activeRef, archiveTransientPaths(activeRef, stateRef));
  const documents: ArchiveSnapshot['documents'] = {};
  const state = run.state as unknown as ClassicState;
  for (const [ref, extraFields] of [
    [state.designDoc, 'status: final'],
    [state.plan, ''],
  ] as const) {
    if (!ref) continue;
    const original = await readClassicProjectFile(root, ref, { label: 'Classic Archive document' });
    documents[ref] = { original, extraFields };
    files[ref] = digest(original);
  }
  return {
    activeRef,
    stateRef,
    specsRef,
    files,
    specs: await tree(root, specsRef),
    optionalFiles: await migrationFiles(root, activeRef),
    documents,
  };
}

async function receiptStore(root: string) {
  return createFileRuntimeStore<ArchiveReceipt>({
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(root), 'archive-receipts', 'classic'),
  });
}

/** 原始执行收据只写一次；副本随归档提交，摘要随 Runtime outcome 便携保存。 */
export async function recordClassicArchiveManifest(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
  before: ArchiveSnapshot,
): Promise<RuntimeArtifactRef[]> {
  const stateRef = archivedClassicDocumentRef(before.stateRef, before.activeRef, archiveRef)!;
  const files = await tree(root, archiveRef, archiveTransientPaths(archiveRef, stateRef));
  const expected: Files = {};
  for (const [ref, hash] of Object.entries(before.files)) {
    const mapped = archivedClassicDocumentRef(ref, before.activeRef, archiveRef)!;
    const document = before.documents[ref];
    expected[mapped] = document
      ? digest(
          annotatedMarkdown(
            document.original,
            path.posix.basename(archiveRef),
            document.extraFields,
          ),
        )
      : hash;
    if (!mapped.startsWith(`${archiveRef}/`))
      files[mapped] = (
        await hashClassicProjectFile(root, mapped, { label: 'Classic archived document' })
      ).digest;
  }
  if (hashRuntimeValue(files) !== hashRuntimeValue(expected))
    throw new Error(
      'Classic Archive 工件与已验证输入的搬迁及文档注记不符；保留同一 Run，不要重放 Archive',
    );
  const afterSpecs = await tree(root, before.specsRef);
  for (const ref of new Set([...Object.keys(before.specs), ...Object.keys(afterSpecs)])) {
    if (before.specs[ref] === afterSpecs[ref]) continue;
    const delta = `${before.activeRef}/specs/${ref.slice(before.specsRef.length + 1)}`;
    if (!before.files[delta] || !ref.endsWith('/spec.md'))
      throw new Error(
        `Classic Archive 修改了没有本次 delta 的规格：${ref}；保留同一 Run，不要重放 Archive`,
      );
    files[ref] = afterSpecs[ref] ?? 'missing';
  }
  const manifest: ArchiveManifest = {
    schema: 'comet.classic.archive-manifest.v1',
    execution: runtimeExecutionBinding(run, action),
    verified: verificationBinding(run),
    activeRef: before.activeRef,
    archiveRef,
    stateRef,
    sources: before.files,
    files,
    optionalFiles: Object.fromEntries(
      Object.entries(before.optionalFiles).map(([ref, hash]) => [
        archivedClassicDocumentRef(ref, before.activeRef, archiveRef)!,
        hash,
      ]),
    ),
  };
  const source = JSON.stringify(manifest) + '\n';
  const artifact = { uri: `${archiveRef}/${manifestName}`, sha256: digest(source) };
  const store = await receiptStore(root);
  const runId = hashRuntimeValue(manifest.execution);
  const receipt: ArchiveReceipt = { runId, revision: 1, manifest, artifact };
  if (
    !(await store.compareAndSwap(runId, null, receipt)) &&
    hashRuntimeValue(await store.read(runId)) !== hashRuntimeValue(receipt)
  )
    throw new Error('Classic Archive 已有不同的原始执行收据，不能覆盖');
  await writeClassicProjectText(root, artifact.uri, source, { label: 'Classic Archive manifest' });
  return [artifact];
}

function recoveryMessage(run: Readonly<WorkflowRun>, action: Readonly<RuntimeAction>) {
  return `Classic Archive 缺少原始执行清单（Run ${run.runId}，Action ${action.id}）。保留当前 Run 和原审批，不要重放 Archive。请从原执行设备或备份恢复本次 archive-manifest.json 及其已绑定的 outcome/artifact 或原始 archive-receipts，再在同一 Run 执行 comet archive ${run.runId} --recover（执行结果未知时）或 comet state complete-delivery ${run.runId} --commit <sha>（已归档时）。不能用当前文件补造旧清单或批准未知的规格变更。`;
}

/** 接受新 outcome 前必须核对执行器已保存的原始收据；可编辑文件不能独立证明执行成功。 */
export async function assertClassicArchiveExecutionReceipt(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
  artifacts?: RuntimeArtifactRef[],
) {
  const execution = runtimeExecutionBinding(run, action);
  const record = await (await receiptStore(root)).read(hashRuntimeValue(execution));
  if (
    !record ||
    record.revision !== 1 ||
    record.manifest.archiveRef !== archiveRef ||
    hashRuntimeValue(record.manifest.execution) !== hashRuntimeValue(execution) ||
    hashRuntimeValue(artifacts ?? null) !== hashRuntimeValue([record.artifact])
  )
    throw new Error(recoveryMessage(run, action));
  if (digest(JSON.stringify(record.manifest) + '\n') !== record.artifact.sha256)
    throw new Error('Classic Archive 原始执行清单摘要不符');
  return readClassicArchiveManifest(root, run, action, archiveRef, artifacts);
}

/** 中断后只读取原执行边界收据，绝不再次调用 OpenSpec 或重新拍摄当前文件。 */
export async function recoverClassicArchiveManifest(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
): Promise<RuntimeArtifactRef[]> {
  const execution = runtimeExecutionBinding(run, action);
  const record = await (await receiptStore(root)).read(hashRuntimeValue(execution));
  if (
    !record ||
    record.revision !== 1 ||
    record.manifest.archiveRef !== archiveRef ||
    hashRuntimeValue(record.manifest.execution) !== hashRuntimeValue(execution) ||
    record.artifact.uri !== `${archiveRef}/${manifestName}`
  )
    throw new Error(recoveryMessage(run, action));
  const source = JSON.stringify(record.manifest) + '\n';
  if (digest(source) !== record.artifact.sha256)
    throw new Error('Classic Archive 原始执行清单摘要不符');
  const file = await inspectProtectedProjectPath(root, record.artifact.uri, {
    label: 'Classic Archive manifest',
    expected: 'file',
  });
  if (!file.exists)
    await writeClassicProjectText(root, record.artifact.uri, source, {
      label: 'Classic Archive manifest',
    });
  await readClassicArchiveManifest(root, run, action, archiveRef, [record.artifact]);
  return [record.artifact];
}

export async function readClassicArchiveManifest(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
  artifacts = action.outcome?.artifacts,
): Promise<{ inputs: Files; sources: Files; stateFiles: string[]; optionalFiles?: Files }> {
  if (!artifacts?.length && action.status === 'succeeded')
    return readLegacyClassicArchiveInputs(root, run, action, archiveRef);
  const uri = `${archiveRef}/${manifestName}`;
  const artifact = artifacts?.find((entry) => entry.uri === uri);
  if (!artifact || artifacts?.filter((entry) => entry.uri === uri).length !== 1)
    throw new Error(recoveryMessage(run, action));
  const source = await readClassicProjectFile(root, uri, {
    label: 'Classic Archive manifest',
    maxBytes: Number.MAX_SAFE_INTEGER,
  });
  if (digest(source) !== artifact.sha256) throw new Error(`Classic Archive 执行清单已改变：${uri}`);
  const manifest = JSON.parse(source) as ArchiveManifest;
  const activeRef = (run.input as { changeDir: string }).changeDir;
  if (
    manifest.schema !== 'comet.classic.archive-manifest.v1' ||
    manifest.archiveRef !== archiveRef ||
    manifest.activeRef !== activeRef ||
    hashRuntimeValue(manifest.execution) !==
      hashRuntimeValue(runtimeExecutionBinding(run, action)) ||
    manifest.verified !== verificationBinding(run)
  )
    throw new Error('Classic Archive 执行清单与原 Action 或 Verify 绑定不符');
  const stateRef = path
    .relative(root, await resolveClassicStateFile(path.join(root, archiveRef)))
    .replaceAll('\\', '/');
  if (manifest.stateRef !== stateRef) throw new Error('Classic Archive 状态路径与执行清单不符');
  for (const files of [manifest.files, manifest.sources, manifest.optionalFiles]) {
    if (!files || typeof files !== 'object' || Array.isArray(files))
      throw new Error('Classic Archive 执行清单无效');
    for (const [ref, hash] of Object.entries(files))
      if (
        normalizeWorkflowRelativePath(ref, 'Classic Archive manifest path') !== ref ||
        !/^(?:missing|[a-f0-9]{64})$/u.test(hash)
      )
        throw new Error('Classic Archive 执行清单路径或摘要无效');
  }
  for (const [ref, expected] of Object.entries(manifest.files)) {
    const file = await inspectProtectedProjectPath(root, ref, {
      label: 'Classic archived output',
      expected: 'file',
    });
    const actual = file.exists
      ? (await hashClassicProjectFile(root, ref, { label: 'Classic archived output' })).digest
      : 'missing';
    if (actual !== expected) throw new Error(`Classic Archive 产物内容已改变：${ref}`);
  }
  const inputs = { ...manifest.files, [uri]: artifact.sha256 };
  for (const ref of Object.keys(manifest.sources))
    if (ref.startsWith(`${activeRef}/`)) inputs[ref] = 'missing';
  inputs[`${activeRef}/${path.posix.basename(stateRef)}`] = 'missing';
  return {
    inputs,
    sources: manifest.sources,
    stateFiles: [stateRef, `${activeRef}/${path.posix.basename(stateRef)}`],
    optionalFiles: manifest.optionalFiles,
  };
}
