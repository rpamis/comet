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
  specSources: Record<string, string>;
  optionalFiles: Files;
  documents: Record<string, { original: string; extraFields: string }>;
  archiveEntries?: string[];
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
  recoveryApproval?: ArchiveRecoveryProposal;
}
export interface ArchiveRecoveryProposal {
  proposalHash: string;
  specs: Files;
  changes: Array<{ path: string; before: string | null; after: string | null }>;
}
export class ClassicArchiveRecoveryApprovalRequired extends Error {
  constructor(readonly proposal: ArchiveRecoveryProposal) {
    super(
      'Classic Archive 已搬迁，但规格同步结果缺少原执行收据；请核对完整规格变化，并由用户确认当前 proposalHash 后恢复同一 Run',
    );
  }
}
interface ArchiveReceipt {
  runId: string;
  revision: number;
  manifest: ArchiveManifest;
  artifact: RuntimeArtifactRef;
}
interface ArchivePreparation {
  runId: string;
  revision: number;
  execution: ReturnType<typeof runtimeExecutionBinding>;
  verified: string;
  snapshot: ArchiveSnapshot;
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
  const specs = await tree(root, specsRef);
  const archive = await inspectProtectedProjectPath(
    root,
    `${path.posix.dirname(activeRef)}/archive`,
    { label: 'Classic archive directory', expected: 'directory' },
  );
  const archiveEntries = archive.exists ? (await fs.readdir(archive.target)).sort() : [];
  const specSources: Record<string, string> = {};
  for (const [ref, expected] of Object.entries(specs)) {
    const source = await readClassicProjectFile(root, ref, {
      label: 'Classic Archive original specification',
      maxBytes: Number.MAX_SAFE_INTEGER,
    });
    if (digest(source) !== expected) throw new Error(`Classic Archive 规格在准备期间变化：${ref}`);
    specSources[ref] = source;
  }
  return {
    activeRef,
    stateRef,
    specsRef,
    files,
    specs,
    specSources,
    optionalFiles: await migrationFiles(root, activeRef),
    documents,
    archiveEntries,
  };
}

async function receiptStore(root: string) {
  return createFileRuntimeStore<ArchiveReceipt>({
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(root), 'archive-receipts', 'classic'),
  });
}

function preparationStore(root: string) {
  return resolveWorkspaceRuntimeRoot(root).then((runtimeRoot) =>
    createFileRuntimeStore<ArchivePreparation>({
      rootDir: path.join(runtimeRoot, 'archive-inputs', 'classic'),
    }),
  );
}

/** 仅在原输入和规格均未改变、也没有归档目录时证明执行未产生可见效果。 */
export async function assertClassicArchiveUnchanged(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): Promise<void> {
  const activeRef = (run.input as { changeDir: string }).changeDir;
  const active = await inspectProtectedProjectPath(root, activeRef, {
    label: 'Classic active change',
    expected: 'directory',
  });
  if (!active.exists)
    throw new Error('Classic Archive 已搬迁或缺少活动目录；核对原执行，不能重开输入');
  const archiveRef = `${path.posix.dirname(activeRef)}/archive`;
  const archive = await inspectProtectedProjectPath(root, archiveRef, {
    label: 'Classic archive directory',
    expected: 'directory',
  });
  if (
    archive.exists &&
    (await fs.readdir(archive.target)).some(
      (name) => /^\d{4}-\d{2}-\d{2}-/u.test(name) && name.slice(11) === run.runId,
    )
  )
    throw new Error('Classic Archive 已有归档目录；核对原执行，禁止重复归档');
  const execution = runtimeExecutionBinding(run, action);
  const prepared = await (await preparationStore(root)).read(hashRuntimeValue(execution));
  if (!prepared) {
    if (
      action.status === 'failed' &&
      (action.outcome?.output as { archiveStarted?: unknown } | null)?.archiveStarted === false
    )
      return;
    throw new Error('Classic Archive 缺少原执行前输入；不能证明没有副作用');
  }
  if (
    prepared.runId !== hashRuntimeValue(execution) ||
    prepared.revision !== 1 ||
    hashRuntimeValue(prepared.execution) !== hashRuntimeValue(execution) ||
    prepared.verified !== verificationBinding(run) ||
    prepared.snapshot.activeRef !== activeRef
  )
    throw new Error('Classic Archive 原执行前输入不匹配');
  const current = await captureClassicArchiveInputs(root, run, prepared.snapshot.specsRef);
  // 旧收据没有目录列表，只按原来固定命名核对；新执行同时拒绝非标准的部分归档目录。
  if (prepared.snapshot.archiveEntries === undefined) delete current.archiveEntries;
  if (hashRuntimeValue(current) !== hashRuntimeValue(prepared.snapshot))
    throw new Error('Classic Archive 输入或规格已变化；核对原执行，不能证明没有副作用');
}

/** 在任何外部副作用之前持久保存原 Action 的输入，供搬迁中断后核对。 */
export async function prepareClassicArchiveInputs(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  specsRef: string,
): Promise<ArchiveSnapshot> {
  const snapshot = await captureClassicArchiveInputs(root, run, specsRef);
  const execution = runtimeExecutionBinding(run, action);
  const runId = hashRuntimeValue(execution);
  const prepared: ArchivePreparation = {
    runId,
    revision: 1,
    execution,
    verified: verificationBinding(run),
    snapshot,
  };
  const store = await preparationStore(root);
  if (
    !(await store.compareAndSwap(runId, null, prepared)) &&
    hashRuntimeValue(await store.read(runId)) !== hashRuntimeValue(prepared)
  )
    throw new Error('Classic Archive 已有不同的执行前输入，不能覆盖');
  return snapshot;
}

/** 原始执行收据只写一次；副本随归档提交，摘要随 Runtime outcome 便携保存。 */
export async function recordClassicArchiveManifest(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
  before: ArchiveSnapshot,
  recoveryApproval?: ArchiveRecoveryProposal,
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
  if (recoveryApproval && hashRuntimeValue(afterSpecs) !== hashRuntimeValue(recoveryApproval.specs))
    throw new Error('Classic Archive 规格在用户确认后变化；请重新核对当前恢复提案');
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
    ...(recoveryApproval ? { recoveryApproval } : {}),
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
  confirmedProposalHash?: string,
): Promise<RuntimeArtifactRef[]> {
  const execution = runtimeExecutionBinding(run, action);
  const record = await (await receiptStore(root)).read(hashRuntimeValue(execution));
  if (!record) {
    const prepared = await (await preparationStore(root)).read(hashRuntimeValue(execution));
    if (
      !prepared ||
      prepared.revision !== 1 ||
      hashRuntimeValue(prepared.execution) !== hashRuntimeValue(execution) ||
      prepared.verified !== verificationBinding(run) ||
      prepared.snapshot.activeRef !== (run.input as { changeDir: string }).changeDir
    )
      throw new Error(recoveryMessage(run, action));
    const before = prepared.snapshot;
    const afterSpecs = await tree(root, before.specsRef);
    const annotations: Array<{ ref: string; text: string }> = [];
    for (const [ref, document] of Object.entries(before.documents)) {
      const mapped = archivedClassicDocumentRef(ref, before.activeRef, archiveRef)!;
      const current = await readClassicProjectFile(root, mapped, {
        label: 'Classic interrupted Archive document',
      });
      const annotated = annotatedMarkdown(
        document.original,
        path.posix.basename(archiveRef),
        document.extraFields,
      );
      if (current !== document.original && current !== annotated)
        throw new Error(`Classic Archive 中断后的文档内容已变化：${mapped}`);
      if (current !== annotated) annotations.push({ ref: mapped, text: annotated });
    }
    // 先核对完整搬迁内容，再补上确定性的文档注记；不重放 OpenSpec。
    const stateRef = archivedClassicDocumentRef(before.stateRef, before.activeRef, archiveRef)!;
    const current = await tree(root, archiveRef, archiveTransientPaths(archiveRef, stateRef));
    const expected = Object.fromEntries(
      Object.entries(before.files)
        .filter(([ref]) => ref.startsWith(`${before.activeRef}/`))
        .map(([ref, hash]) => [
          archivedClassicDocumentRef(ref, before.activeRef, archiveRef)!,
          hash,
        ]),
    );
    for (const [ref, document] of Object.entries(before.documents)) {
      const mapped = archivedClassicDocumentRef(ref, before.activeRef, archiveRef)!;
      if (mapped.startsWith(`${archiveRef}/`)) {
        const hash = current[mapped];
        const annotated = digest(
          annotatedMarkdown(
            document.original,
            path.posix.basename(archiveRef),
            document.extraFields,
          ),
        );
        if (hash === annotated) expected[mapped] = annotated;
      }
    }
    if (hashRuntimeValue(current) !== hashRuntimeValue(expected))
      throw new Error('Classic Archive 中断后的搬迁内容与执行前输入不符；不能恢复为成功');
    let approval: ArchiveRecoveryProposal | undefined;
    const specChanges = [...new Set([...Object.keys(before.specs), ...Object.keys(afterSpecs)])]
      .filter((ref) => before.specs[ref] !== afterSpecs[ref])
      .sort();
    for (const ref of specChanges) {
      const delta = `${before.activeRef}/specs/${ref.slice(before.specsRef.length + 1)}`;
      if (!before.files[delta] || !ref.endsWith('/spec.md'))
        throw new Error(`Classic Archive 中断后出现没有本次 delta 的规格变化：${ref}`);
    }
    if (
      specChanges.length ||
      Object.keys(before.files).some((ref) => ref.startsWith(`${before.activeRef}/specs/`))
    ) {
      const changes: ArchiveRecoveryProposal['changes'] = [];
      for (const ref of specChanges) {
        const original = before.specSources?.[ref] ?? null;
        const recovered = afterSpecs[ref]
          ? await readClassicProjectFile(root, ref, {
              label: 'Classic Archive recovered specification',
              maxBytes: Number.MAX_SAFE_INTEGER,
            })
          : null;
        if (
          (original !== null && digest(original) !== before.specs[ref]) ||
          (recovered !== null && digest(recovered) !== afterSpecs[ref])
        )
          throw new Error('Classic Archive 规格内容在恢复检查中变化；请重新读取原 Run');
        changes.push({ path: ref, before: original, after: recovered });
      }
      approval = {
        proposalHash: hashRuntimeValue({
          execution,
          verified: prepared.verified,
          archiveRef,
          sources: before.files,
          specsBefore: before.specs,
          specsAfter: afterSpecs,
        }),
        changes,
        specs: afterSpecs,
      };
      if (confirmedProposalHash !== approval.proposalHash)
        throw new ClassicArchiveRecoveryApprovalRequired(approval);
    } else if (confirmedProposalHash)
      throw new Error('Classic Archive 当前不需要规格恢复确认；请重新读取原 Run');
    for (const annotation of annotations)
      await writeClassicProjectText(root, annotation.ref, annotation.text, {
        label: 'Classic interrupted Archive annotation',
      });
    return recordClassicArchiveManifest(root, run, action, archiveRef, before, approval);
  }
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
