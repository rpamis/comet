import path from 'node:path';
import {
  readProtectedProjectFile,
  ensureProtectedProjectDirectory,
} from '../workflow-contract/protected-project-path.js';
import { hashRuntimeValue, type WorkflowRun } from '../engine/runtime.js';
import { atomicWriteJson } from './native-atomic-file.js';
import {
  createNativeLegacyArchiveOverlay,
  withNativeLegacyArchiveMaterials,
} from './native-archive-legacy-overlay.js';
import { assertNativeSdkCandidateUnchanged } from './native-sdk-checks.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import {
  readNativePortableTransaction,
  type NativePortableArchiveTransaction,
} from './native-portable-transactions.js';
import type { NativeProjectPaths } from './native-types.js';

const MAX_BYTES = 8 * 1024 * 1024;
const SCHEMA = 'comet.native.archive-originals.v1';
function evidenceRef(runId: string, transactionId: string) {
  return `archive-originals/${hashRuntimeValue({ runId, transactionId })}.json`;
}
function parseOriginals(
  value: unknown,
  runId: string,
  transaction: NativePortableArchiveTransaction,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Archive 原文备份必须是 JSON 对象');
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some((key) => !['schema', 'runId', 'transactionId', 'files'].includes(key)) ||
    data.schema !== SCHEMA ||
    data.runId !== runId ||
    data.transactionId !== transaction.id ||
    !Array.isArray(data.files)
  )
    throw new Error('Archive 原文备份的 schema、runId 或 transactionId 不匹配，或包含未知字段');
  const originals = new Map<string, string>();
  for (const file of data.files) {
    if (
      !file ||
      typeof file !== 'object' ||
      Array.isArray(file) ||
      Object.keys(file).some((key) => !['ref', 'content'].includes(key)) ||
      typeof file.ref !== 'string' ||
      typeof file.content !== 'string' ||
      originals.has(file.ref)
    )
      throw new Error('Archive 原文备份 files 必须包含唯一 ref 和完整 UTF-8 content');
    originals.set(file.ref, file.content);
  }
  return originals;
}

export async function readNativeSdkArchiveOriginals(
  paths: NativeProjectPaths,
  runId: string,
  transaction: NativePortableArchiveTransaction,
) {
  try {
    const file = await readProtectedProjectFile(
      paths.runtimeDir,
      evidenceRef(runId, transaction.id),
      MAX_BYTES,
      { label: 'Native Archive original Spec evidence' },
    );
    return parseOriginals(JSON.parse(file.bytes.toString('utf8')), runId, transaction);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** 备份只重建原验收输入；写入前必须精确匹配原候选摘要。 */
export async function importNativeSdkArchiveOriginals(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
  ref: string;
}) {
  const { run, projectRoot } = options;
  if ((run.outputs['archive.prepare']?.value as { candidateBinding?: unknown })?.candidateBinding)
    throw new Error('--legacy-spec-backup 仅用于缺少归档候选摘要的旧事务');
  const state = parseNativePortableState(run.state);
  const paths = await nativeProjectPaths(
    projectRoot,
    (run.input as { artifactRootRef: string }).artifactRootRef,
    { readOnly: true },
  );
  const saved = await readNativePortableTransaction(paths, { kind: 'archive', change: state.name });
  if (saved?.kind !== 'archive') throw new Error('--legacy-spec-backup 需要原有 Archive 事务');
  if (
    state.phase !== 'archive' ||
    saved.journal.start_state_version !== state.state_version - (state.archived ? 1 : 0)
  )
    throw new Error('Archive 原文备份与当前事务状态不匹配');
  const absolute = path.isAbsolute(options.ref);
  const file = await readProtectedProjectFile(
    absolute ? path.dirname(options.ref) : projectRoot,
    absolute ? path.basename(options.ref) : options.ref,
    MAX_BYTES,
    {
      label: 'Native Archive original Spec backup',
    },
  );
  const value = JSON.parse(file.bytes.toString('utf8'));
  const originals = parseOriginals(value, run.runId, saved.journal);
  const legacyArchiveOverlay = await withNativeLegacyArchiveMaterials({
    paths,
    transaction: saved.journal,
    overlay: createNativeLegacyArchiveOverlay({ paths, transaction: saved.journal, originals }),
  });
  await assertNativeSdkCandidateUnchanged({
    run,
    projectRoot,
    requireEvidence: true,
    legacyArchiveOverlay,
  });
  const targetRef = evidenceRef(run.runId, saved.journal.id);
  const existing = await readNativeSdkArchiveOriginals(paths, run.runId, saved.journal);
  if (existing) {
    const ordered = (value: ReadonlyMap<string, string>) =>
      [...value].sort(([left], [right]) => left.localeCompare(right, 'en'));
    if (hashRuntimeValue(ordered(existing)) !== hashRuntimeValue(ordered(originals)))
      throw new Error('原 Archive 事务已有不同原文备份，不能覆盖');
    return;
  }
  await ensureProtectedProjectDirectory(paths.runtimeDir, 'archive-originals', {
    label: 'Native Archive original Spec evidence',
  });
  await atomicWriteJson(path.join(paths.runtimeDir, targetRef), value, {
    containedRoot: paths.runtimeDir,
    exclusive: true,
  });
}
