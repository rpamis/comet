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
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { resolveWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import { annotatedMarkdown, archivedClassicDocumentRef } from './classic-archive-annotation.js';
import { readClassicProjectFile, writeClassicProjectText } from './classic-protected-path.js';
import { readLegacyClassicArchiveInputs } from './classic-sdk-archive-legacy-manifest.js';
import { resolveClassicStateFile } from './classic-state-file.js';
import type { ClassicState } from './classic-state.js';

const manifestName = '.comet/archive-manifest.json';
interface ArchiveSnapshot {
  activeRef: string;
  stateRef: string;
  specsRef: string;
  paths: string[];
  specPaths: string[];
  documents: string[];
  archivePaths?: string[];
}
interface ArchiveManifest {
  schema: 'comet.classic.archive-manifest.v2';
  execution: ReturnType<typeof runtimeExecutionBinding>;
  activeRef: string;
  archiveRef: string;
  stateRef: string;
  paths: string[];
  sourcePaths: string[];
}
interface ArchiveReceipt {
  runId: string;
  revision: number;
  manifest: ArchiveManifest;
}
interface Preparation {
  runId: string;
  revision: number;
  execution: ReturnType<typeof runtimeExecutionBinding>;
  snapshot: ArchiveSnapshot;
}
/** 仅为读取旧响应保留；新归档不按文件变化生成恢复批准。 */
export interface ArchiveRecoveryProposal {
  proposalHash: string;
  specs: Record<string, string>;
  changes: Array<{ path: string; before: string | null; after: string | null }>;
}
export class ClassicArchiveRecoveryApprovalRequired extends Error {
  constructor(readonly proposal: ArchiveRecoveryProposal) {
    super('请使用原 Run 的恢复决定');
  }
}
async function pathsIn(root: string, ref: string): Promise<string[]> {
  const target = await inspectProtectedProjectPath(root, ref, {
    label: 'Classic Archive paths',
    expected: 'any',
  });
  if (!target.exists) return [];
  if (target.kind !== 'directory') return [ref];
  const paths: string[] = [];
  for (const name of (await fs.readdir(target.target)).sort()) {
    if (['.comet-state.lock', '.comet-state-transaction.json'].includes(name)) continue;
    paths.push(...(await pathsIn(root, ref + '/' + name)));
  }
  return paths;
}
function executionKey(run: Readonly<WorkflowRun>, action: Readonly<RuntimeAction>) {
  return hashRuntimeValue(runtimeExecutionBinding(run, action));
}
async function receiptStore(root: string) {
  return createFileRuntimeStore<ArchiveReceipt>({
    singleWriter: true,
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(root), 'archive-receipts/classic'),
  });
}
async function preparationStore(root: string) {
  return createFileRuntimeStore<Preparation>({
    singleWriter: true,
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(root), 'archive-inputs/classic'),
  });
}
function normalizedSnapshot(value: ArchiveSnapshot): ArchiveSnapshot {
  const legacy = value as ArchiveSnapshot & {
    files?: Record<string, string>;
    specs?: Record<string, string>;
    documents: string[] | Record<string, unknown>;
  };
  return {
    ...value,
    paths: value.paths ?? Object.keys(legacy.files ?? {}),
    specPaths: value.specPaths ?? Object.keys(legacy.specs ?? {}),
    documents: Array.isArray(value.documents)
      ? value.documents
      : Object.keys(legacy.documents ?? {}),
  };
}
export async function captureClassicArchiveInputs(
  root: string,
  run: Readonly<WorkflowRun>,
  specsRef: string,
): Promise<ArchiveSnapshot> {
  const activeRef = (run.input as { changeDir: string }).changeDir;
  const state = run.state as unknown as ClassicState;
  const stateRef = path
    .relative(root, await resolveClassicStateFile(path.join(root, activeRef)))
    .replaceAll('\\', '/');
  const archiveRoot = path.posix.dirname(activeRef) + '/archive';
  const archive = await inspectProtectedProjectPath(root, archiveRoot, {
    label: 'Classic Archive directory',
    expected: 'directory',
  });
  const archivePaths = archive.exists ? await fs.readdir(archive.target) : [];
  return {
    activeRef,
    stateRef,
    specsRef,
    paths: (await pathsIn(root, activeRef)).filter((ref) => ref !== stateRef),
    specPaths: await pathsIn(root, specsRef),
    documents: [state.designDoc, state.plan].filter((ref): ref is string => Boolean(ref)),
    archivePaths,
  };
}
export async function prepareClassicArchiveInputs(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  specsRef: string,
): Promise<ArchiveSnapshot> {
  const store = await preparationStore(root),
    runId = executionKey(run, action);
  const existing = await store.read(runId);
  if (existing) return normalizedSnapshot(existing.snapshot);
  const snapshot = await captureClassicArchiveInputs(root, run, specsRef);
  const prepared: Preparation = {
    runId,
    revision: 1,
    execution: runtimeExecutionBinding(run, action),
    snapshot,
  };
  if (!(await store.compareAndSwap(runId, null, prepared)))
    throw new Error('原 Archive 已有执行准备记录，请恢复同一 Action');
  return snapshot;
}
/** Agent 显式修复已退出失败的命令；运行中和结果未知的执行不得重放。 */
export async function assertClassicArchiveRetryable(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): Promise<void> {
  if (action.status !== 'failed' || action.outcome?.status !== 'failed')
    throw new Error('原 Archive 尚未确认失败退出；先恢复原 Action 并核对实际归档进度');
  const activeRef = (run.input as { changeDir: string }).changeDir;
  const active = await inspectProtectedProjectPath(root, activeRef, {
    label: 'Classic active change',
    expected: 'directory',
  });
  if (!active.exists) throw new Error('原 change 目录已搬迁；恢复原 Archive 进度，不能重开执行');
  const preparation = await (await preparationStore(root)).read(executionKey(run, action));
  if (preparation?.snapshot.archivePaths) {
    const archive = await inspectProtectedProjectPath(
      root,
      path.posix.dirname(activeRef) + '/archive',
      { label: 'Classic Archive directory', expected: 'directory' },
    );
    const change = path.posix.basename(activeRef);
    if (
      archive.exists &&
      (await fs.readdir(archive.target)).some(
        (name) =>
          /^\d{4}-\d{2}-\d{2}-/u.test(name) &&
          name.slice(11) === change &&
          !preparation.snapshot.archivePaths!.includes(name),
      )
    )
      throw new Error('原 Archive 已创建归档目录；先恢复该事务，不能重开执行');
  }
}
export async function recordClassicArchiveManifest(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
  before: ArchiveSnapshot,
  _recoveryApproval?: ArchiveRecoveryProposal,
): Promise<RuntimeArtifactRef[]> {
  const stateRef = archivedClassicDocumentRef(before.stateRef, before.activeRef, archiveRef)!;
  const paths = new Set(
    before.paths.map((ref) => archivedClassicDocumentRef(ref, before.activeRef, archiveRef)!),
  );
  paths.delete(stateRef);
  for (const ref of before.documents)
    paths.add(archivedClassicDocumentRef(ref, before.activeRef, archiveRef)!);
  for (const ref of before.paths.filter(
    (ref) => ref.startsWith(before.activeRef + '/specs/') && ref.endsWith('/spec.md'),
  ))
    paths.add(before.specsRef + '/' + ref.slice((before.activeRef + '/specs/').length));
  const manifest: ArchiveManifest = {
    schema: 'comet.classic.archive-manifest.v2',
    execution: runtimeExecutionBinding(run, action),
    activeRef: before.activeRef,
    archiveRef,
    stateRef,
    paths: [...paths].sort(),
    sourcePaths: before.paths,
  };
  const store = await receiptStore(root),
    runId = executionKey(run, action);
  const old = await store.read(runId);
  if (old && old.manifest.archiveRef !== archiveRef)
    throw new Error('原 Archive 已记录不同交付目录，不能覆盖');
  if (!old && !(await store.compareAndSwap(runId, null, { runId, revision: 1, manifest })))
    throw new Error('原 Archive 交付记录已存在');
  await writeClassicProjectText(
    root,
    archiveRef + '/' + manifestName,
    JSON.stringify(old?.manifest ?? manifest, null, 2) + '\n',
    { label: 'Classic Archive progress' },
  );
  return [];
}
async function originalReceipt(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
) {
  const entry = await (await receiptStore(root)).read(executionKey(run, action));
  if (
    !entry ||
    entry.manifest.archiveRef !== archiveRef ||
    entry.manifest.execution.actionId !== action.id
  )
    throw new Error(
      '原 Archive 执行收据缺失；核对原命令结果并恢复原记录，不能重复执行或用当前文件补造成功',
    );
  return entry;
}
export async function assertClassicArchiveExecutionReceipt(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
  _artifacts?: RuntimeArtifactRef[],
) {
  await originalReceipt(root, run, action, archiveRef);
  return readClassicArchiveManifest(root, run, action, archiveRef);
}
export async function recoverClassicArchiveManifest(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
  _confirmedProposalHash?: string,
): Promise<RuntimeArtifactRef[]> {
  let entry = await (await receiptStore(root)).read(executionKey(run, action));
  if (!entry) {
    const prepared = await (await preparationStore(root)).read(executionKey(run, action));
    if (
      !prepared ||
      prepared.execution.actionId !== action.id ||
      prepared.execution.attempt !== action.attempt
    )
      throw new Error('原 Archive 准备记录缺失；不能重复执行或补造成功');
    const snapshot = normalizedSnapshot(prepared.snapshot);
    const active = await inspectProtectedProjectPath(root, snapshot.activeRef, {
        label: 'Classic active change',
        expected: 'directory',
      }),
      archived = await inspectProtectedProjectPath(root, archiveRef, {
        label: 'Classic archived change',
        expected: 'directory',
      });
    if (active.exists || !archived.exists)
      throw new Error('原 Archive 搬迁尚未完成或目录归属不明确');
    for (const ref of snapshot.documents) {
      const mapped = archivedClassicDocumentRef(ref, snapshot.activeRef, archiveRef)!;
      const content = await readClassicProjectFile(root, mapped, {
        label: 'Classic archived document',
      });
      await writeClassicProjectText(
        root,
        mapped,
        annotatedMarkdown(
          content,
          path.posix.basename(archiveRef),
          ref === (run.state as unknown as ClassicState).designDoc ? 'status: final' : '',
        ),
        { label: 'Classic archived document' },
      );
    }
    await recordClassicArchiveManifest(root, run, action, archiveRef, snapshot);
    entry = await originalReceipt(root, run, action, archiveRef);
  }
  if (entry.manifest.archiveRef !== archiveRef) throw new Error('原 Archive 目录不匹配');
  const ref = archiveRef + '/' + manifestName;
  const file = await inspectProtectedProjectPath(root, ref, {
    label: 'Classic Archive progress',
    expected: 'file',
  });
  if (!file.exists)
    await writeClassicProjectText(root, ref, JSON.stringify(entry.manifest, null, 2) + '\n', {
      label: 'Classic Archive progress',
    });
  return [];
}
/** 历史清单只读取路径；其旧摘要不再参与交付或验收判断。 */
export async function readClassicArchiveManifest(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
  _artifacts = action.outcome?.artifacts,
): Promise<{
  paths: string[];
  sourcePaths: string[];
  stateFiles: string[];
  optionalPaths: string[];
}> {
  await inspectProtectedProjectPath(root, archiveRef + '/' + manifestName, {
    label: 'Classic Archive manifest',
    expected: 'file',
  });
  const recorded = await (await receiptStore(root)).read(executionKey(run, action));
  const portable = (action.outcome?.output as { archiveManifest?: unknown } | undefined)
    ?.archiveManifest;
  const source = (recorded?.manifest ?? portable) as
    | (Omit<ArchiveManifest, 'schema' | 'paths' | 'sourcePaths'> & {
        schema: string;
        paths?: string[];
        sourcePaths?: string[];
        optionalPaths?: string[];
        files?: Record<string, string>;
        sources?: Record<string, string>;
        optionalFiles?: Record<string, string>;
      })
    | undefined;
  if (!source) return readLegacyClassicArchiveInputs(root, run, action, archiveRef);
  if (
    !['comet.classic.archive-manifest.v1', 'comet.classic.archive-manifest.v2'].includes(
      source.schema,
    ) ||
    source.activeRef !== (run.input as { changeDir: string }).changeDir ||
    source.archiveRef !== archiveRef ||
    source.execution?.actionId !== action.id ||
    source.execution?.runId !== run.runId
  )
    throw new Error('归档交付记录不属于原 Run 和 Action');
  const paths: string[] = source.paths ?? Object.keys(source.files ?? {}),
    sourcePaths: string[] = source.sourcePaths ?? Object.keys(source.sources ?? {}),
    optionalPaths: string[] = source.optionalPaths ?? Object.keys(source.optionalFiles ?? {});
  for (const ref of [...paths, ...sourcePaths, ...optionalPaths])
    normalizeWorkflowRelativePath(ref, 'Classic Archive path');
  const stateRef = path
    .relative(root, await resolveClassicStateFile(path.join(root, archiveRef)))
    .replaceAll('\\', '/');
  return {
    paths: [
      ...new Set([
        ...paths,
        archiveRef + '/' + manifestName,
        ...sourcePaths.filter((ref) => ref.startsWith(source.activeRef + '/')),
      ]),
    ],
    sourcePaths,
    stateFiles: [stateRef, source.activeRef + '/' + path.posix.basename(stateRef)],
    optionalPaths: [
      ...new Set([
        ...optionalPaths,
        ...['.comet-state.lock', '.comet-state-transaction.json'].map(
          (name) => archiveRef + '/' + name + '/.comet-runtime-migration.json',
        ),
      ]),
    ],
  };
}

export async function classicArchiveManifestOutput(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
) {
  const entry = await (await receiptStore(root)).read(executionKey(run, action));
  if (!entry) throw new Error('原 Archive 交付路径记录缺失');
  return entry.manifest as unknown as import('../engine/runtime.js').RuntimeValue;
}
