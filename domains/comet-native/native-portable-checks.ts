import {
  readCurrentLocalExecution,
  preservedLocalChecksForVersion,
} from './native-local-execution-binding.js';
export {
  readCurrentLocalExecution,
  preservedLocalChecksForVersion,
} from './native-local-execution-binding.js';
import {
  nativeShapeArtifactSnapshot,
  nativeShapeArtifactContractHash,
  type NativeShapeSemanticSnapshot,
} from './native-shape-semantics.js';
import { nativeShapeReviewAnchorMatches } from './native-shape-review-evidence.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  nativeLegacyArchiveGitStatus,
  type NativeLegacyArchiveOverlay,
} from './native-archive-legacy-overlay.js';
import { promises as fs } from 'node:fs';
import {
  completeNativeVerifierAction,
  currentNativeVerifierAction,
  nativeVerifierActionExecutionRef,
  startNativeVerifierAction,
} from './native-verifier-action.js';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseGitStatusPaths,
  parseGitStatusUntrackedPaths,
  readGitStatusPorcelain,
  readGitStatusPorcelainAsync,
  readGitStatusObservationAsync,
  runGitCommand,
  runGitCommandAsync,
  readGitBlobs,
} from '../../platform/process/git.js';
import {
  approvedEditHash,
  approvedEditFingerprint,
  inspectEditReviews,
  type EditReviewScope,
  isCheckInputRetained,
  assertEditReviewsComplete,
} from '../workflow-contract/edit-review.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { hashRuntimeValue, type RuntimeValue } from '../engine/runtime.js';
import {
  hashProtectedProjectFile,
  inspectProtectedProjectPath,
  ensureProtectedProjectDirectory,
  readProtectedProjectFile,
  createProtectedProjectReadSession,
} from '../workflow-contract/protected-project-path.js';
import { isNeutralDocumentPath } from '../workflow-contract/neutral-document-path.js';
import { readProjectConfig } from './native-config.js';
import { nativeEditReviewScope } from './native-edit-review.js';
import {
  inspectProcessLiveness,
  readProcessIdentity,
} from '../../platform/process/process-identity.js';
import { canonicalHash } from './native-canonical-hash.js';
import { nativeRunnerInputArtifactPaths } from './native-runner-input-artifacts.js';
import {
  executeNativeCheck,
  inspectNativeCheckProcessTreeLiveness,
  isNativeCheckTerminationUnconfirmedError,
  nativeCheckPlanKey,
  nativeCheckInvocationKey,
  nativePortableArgvDisplay,
  preflightNativeCheckPlans,
  resolveNativeCheckCwd,
  validateNativeCheckPlan,
  type NativeCheckPlan,
} from './native-check-executor.js';
import {
  NATIVE_MAX_REQUEST_CHECK_ROUNDS,
  recordNativeVerifierExecutionError,
  returnNativeCandidateToBuild,
} from './native-loop-runtime.js';
import {
  readNativeLocalExecution,
  readOrRebuildNativeLocalExecution,
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { toNativePortableText } from './native-portable-text.js';
import type {
  NativeLocalCheckState,
  NativeLocalExecutionState,
  NativePortableCheckSummary,
  NativePortableState,
} from './native-portable-types.js';
import type { NativeTrustedVerifierEnvelope } from './native-runner-protocol.js';
import {
  type NativeVerifierCheckRequest,
  type NativeVerifierResponse,
} from './native-verifier-protocol.js';
import {
  isInsidePath,
  nativePreferredChangeRuntimeDir,
  resolveContainedNativePath,
} from './native-paths.js';
import { mapWithConcurrency } from './native-concurrency.js';
import type { NativeProjectPaths } from './native-types.js';
import {
  currentBranch,
  nativeLocalExecutionFile,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import {
  ensureNativePortableAcceptanceCurrentLocked,
  readNativeApprovedShapeSemanticSnapshot,
} from './native-portable-requirements.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { readNativePortableTransaction } from './native-portable-transactions.js';
import { renderNativeVerificationReport } from './native-verification-report-v2.js';

export function localCheckCwdRef(projectRoot: string, cwd: string): string {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(cwd));
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Native local check cwd escaped the project root');
  }
  const cwdRef = relative.length === 0 ? '.' : relative.split(path.sep).join('/');
  resolveNativeCheckCwd(projectRoot, cwdRef);
  return cwdRef;
}

export function hasGitlinksInIndex(indexOutput: string): boolean {
  return indexOutput.split('\0').some((record) => record.startsWith('160000 '));
}

export function nativeLocalCheckPlanKey(check: NativeLocalCheckState, projectRoot: string): string {
  const [executable, ...argv] = check.argv;
  if (!executable) throw new Error(`Native local check ${check.id} has no executable`);
  return nativeCheckPlanKey({
    id: check.id,
    name: check.name,
    executable,
    argv,
    cwdRef: localCheckCwdRef(projectRoot, check.cwd),
    timeoutMs: check.timeoutMs,
    repeatable: check.repeatable,
  });
}

export function nativePortableCheckPlansFromLocal(
  local: NativeLocalExecutionState,
  projectRoot = local.workspace.projectRoot,
): NativeCheckPlan[] {
  return local.checks.map((check) => {
    const [executable, ...argv] = check.argv;
    if (!executable) throw new Error(`Native local check ${check.id} has no executable`);
    return {
      id: check.id,
      name: check.name,
      executable,
      argv,
      cwdRef: localCheckCwdRef(projectRoot, check.cwd),
      timeoutMs: check.timeoutMs,
      repeatable: check.repeatable,
    };
  });
}

export function sameNativeCheckPlan(
  local: NativeLocalExecutionState,
  plans: readonly NativeCheckPlan[],
  projectRoot: string,
  state: NativePortableState,
  inputFingerprint: string,
  branch: string | null,
): boolean {
  if (
    local.candidateId !== state.builder_handoff?.candidate_id ||
    local.inputFingerprint !== inputFingerprint ||
    path.resolve(local.workspace.projectRoot) !== path.resolve(projectRoot) ||
    path.resolve(local.workspace.worktreeRoot) !== path.resolve(projectRoot) ||
    local.workspace.branch !== branch ||
    local.workspace.machineId !== os.hostname()
  ) {
    return false;
  }
  if (local.checks.length !== plans.length) return false;
  return local.checks.every(
    (check, index) =>
      nativeLocalCheckPlanKey(check, projectRoot) === nativeCheckPlanKey(plans[index]),
  );
}

export function sameNativeCheckCommands(
  local: NativeLocalExecutionState,
  plans: readonly NativeCheckPlan[],
  projectRoot: string,
): boolean {
  return (
    local.checks.length === plans.length &&
    local.checks.every(
      (check, index) =>
        nativeLocalCheckPlanKey(check, projectRoot) === nativeCheckPlanKey(plans[index]),
    )
  );
}

export type NativePortableCheckExecutionLiveness =
  'not-running' | 'running' | 'orphaned' | 'unknown';

/**
 * Inspect the owner and active child recorded for a local Runtime check operation.
 * Missing identity metadata remains unknown so a stale overlay can never trigger a
 * second check while the original process might still be alive.
 */
export async function inspectNativePortableCheckExecution(
  local: NativeLocalExecutionState,
): Promise<NativePortableCheckExecutionLiveness> {
  const execution = local.execution;
  if (execution === null || execution.status !== 'running') return 'not-running';
  if (execution.ownerPid === undefined) return 'unknown';
  // 探测失败保持 unknown；Doctor 仅可接管没有未确认检查进程的 owner 登记。
  const ownerLiveness = await inspectProcessLiveness(execution.ownerPid, execution.ownerIdentity);
  if (ownerLiveness === 'alive') return 'running';

  let unknown = ownerLiveness === 'unknown';
  for (const check of local.checks) {
    if (check.status !== 'running') continue;
    const active = check.activeProcess;
    if (!active || active.status === 'starting') {
      unknown = true;
      continue;
    }
    const liveness = await inspectNativeCheckProcessTreeLiveness(active.pid, active.identity);
    if (liveness === 'alive') return 'running';
    if (liveness === 'unknown') unknown = true;
  }
  return unknown ? 'unknown' : 'orphaned';
}

function interruptNativePortableCheckExecution(
  local: NativeLocalExecutionState,
): NativeLocalExecutionState {
  return {
    ...local,
    execution:
      local.execution === null ? null : { ...local.execution, status: 'interrupted' as const },
    checks: local.checks.map((check) =>
      check.status === 'planned' || check.status === 'running'
        ? { ...check, status: 'interrupted' as const, activeProcess: null }
        : check,
    ),
  };
}

function localCheck(
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
  return {
    id: plan.id,
    name: plan.name,
    operationId,
    status: 'planned',
    repeatable: plan.repeatable,
    timeoutMs: plan.timeoutMs,
    executionCount: 0,
    argv: [plan.executable, ...plan.argv],
    cwd: resolveNativeCheckCwd(projectRoot, plan.cwdRef),
    exitCode: null,
    startedAt: null,
    completedAt: null,
    log: `logs/checks/${operationId}-${plan.id}.log`,
    activeProcess: null,
  };
}

function resetInterruptedCheck(
  previous: NativeLocalCheckState,
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
  if (!previous.repeatable) {
    throw new Error(
      `Native check ${previous.id} was interrupted and is not repeatable; user resolution is required`,
    );
  }
  return resetNativeCheckForExecution(previous, plan, operationId, projectRoot);
}

function resetNativeCheckForExecution(
  previous: NativeLocalCheckState,
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
  return {
    ...localCheck(plan, operationId, projectRoot),
    executionCount: previous.executionCount,
    // 原输入收据仅保留来源；新尝试的 planned/interrupted 状态和空 evidenceDigest 禁止把它算作成功。
    ...(previous.rawInput ? { rawInput: previous.rawInput } : {}),
  };
}

function digestNativeCheckInput(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Stream-hash a file with the same digest semantics as hashing the base64 of
 * its full content, without retaining the bytes. The file must stay stable
 * while read, matching the previous read-then-restat contract.
 */
export async function digestNativeInputFileContent(
  file: string,
): Promise<{ digest: string; size: number }> {
  const before = await fs.lstat(file);
  if (!before.isFile()) {
    throw new Error('Native check input must be a regular file');
  }
  const hash = createHash('sha256');
  const handle = await fs.open(file, 'r');
  let total = 0;
  try {
    const buffer = Buffer.allocUnsafe(
      Math.min(NATIVE_INPUT_BASE64_CHUNK_BYTES, Math.max(3, Math.ceil(before.size / 3) * 3)),
    );
    let buffered = 0;
    // 长度来自读取前的 stat；读后仍核对长度、身份和时间，省去每个文件的额外 EOF 读取。
    while (total < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        buffered,
        Math.min(buffer.length - buffered, before.size - total),
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
      buffered += bytesRead;
      // 短读也先补齐三字节对齐的块，只有文件末尾允许 base64 填充。
      if (buffered === buffer.length || total === before.size) {
        hash.update(buffer.subarray(0, buffered).toString('base64'));
        buffered = 0;
      }
    }
  } finally {
    await handle.close();
  }
  const after = await fs.lstat(file);
  if (
    !after.isFile() ||
    after.ino !== before.ino ||
    after.dev !== before.dev ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs ||
    total !== before.size
  ) {
    throw new Error('Native check input changed while reading');
  }
  return { digest: hash.digest('hex'), size: total };
}

/**
 * Chunk size for streamed base64 digests. It must stay divisible by 3 so that
 * concatenating per-chunk base64 output equals base64-encoding the whole file,
 * keeping the legacy sha256(base64(content)) digest semantics.
 */
const NATIVE_INPUT_BASE64_CHUNK_BYTES = 65_535;

const NATIVE_GENERATED_INPUT_DIRECTORIES = [
  'build',
  'dist',
  'gen',
  'generated',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
] as const;

interface NativeIgnoredInputFile {
  path: string;
  digest: string;
  size: number;
}

interface NativeIgnoredInputSnapshot {
  complete: boolean;
  files: NativeIgnoredInputFile[];
  diagnostic?: string;
}

export interface NativeCheckInputSnapshot {
  /** 环境敏感的执行摘要，仅用于决定是否复用检查。 */
  fingerprint: string;
  /** 检查实际读取的候选和文件内容，复核时不绑定提交命令的 shell。 */
  contentFingerprint: string;
  generatedInputFingerprint: string;
  complete: boolean;
  diagnostics: string[];
}

export interface NativeRawInputSnapshot {
  schema: 'comet.native.raw-input.v1';
  projectRoot: string;
  files: Array<{ path: string; hash: string; mode: string; generated?: true }>;
  complete: boolean;
  diagnostics: string[];
  contentHash: string;
  contextHash: string;
  git: { head: string; branch: string; status: string; index: string } | null;
  hashCache?: Array<{ path: string; gitObjectId?: string; statKey: string }>;
  repositories?: Array<{
    path: string;
    head: string;
    branch: string;
    status: string;
    index: string;
  }>;
}

/** 一次观察只读取原始字节。Git 身份另存，不进入实现内容摘要。 */
export async function nativeRawInputSnapshot(options: {
  projectRoot: string;
  managedArtifactRoot?: string;
  excludedPaths?: readonly string[];
  legacyArchiveOverlay?: NativeLegacyArchiveOverlay;
  previous?: NativeRawInputSnapshot;
}): Promise<NativeRawInputSnapshot> {
  const root = await fs.realpath(options.projectRoot);
  const managedArtifactRoot = options.managedArtifactRoot
    ? await fs.realpath(options.managedArtifactRoot).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        const relative = path.relative(
          path.resolve(options.projectRoot),
          path.resolve(options.managedArtifactRoot!),
        );
        return path.resolve(root, relative);
      })
    : undefined;
  const runnerInputs = await nativeRunnerInputArtifactPaths(root);
  const excluded = (ref: string) =>
    runnerInputs.has(ref) ||
    isNativeOwnedInputPath(ref, root, managedArtifactRoot) ||
    (options.excludedPaths ?? []).some((owned) => ref === owned || ref.startsWith(`${owned}/`));
  const diagnostics: string[] = [];
  const files: NativeRawInputSnapshot['files'] = [];
  let git: NativeRawInputSnapshot['git'] = null;
  let selection: string[] = [];
  let index = '';
  let physical = false;
  const observeGit = async () => {
    const results = await Promise.allSettled([
      readGitStatusObservationAsync(root, [], { allowUnborn: true, includeIgnored: true }),
      runGitCommandAsync(root, [
        'ls-files',
        '--stage',
        '--others',
        '--exclude-standard',
        '-v',
        '-z',
      ]),
    ]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    const index: string[] = [],
      untracked: string[] = [],
      flags: string[] = [];
    for (const entry of (results[1] as PromiseFulfilledResult<string>).value
      .split('\0')
      .filter(Boolean)) {
      if (entry.startsWith('? ')) {
        untracked.push(entry.slice(2));
        continue;
      }
      const match = entry.match(/^([A-Za-z]) (\d{6} [a-f0-9]+ [0-3]\t(.+))$/su);
      if (!match) throw new Error('Git 原始输入枚举格式无效');
      index.push(match[2]);
      flags.push(`${match[1]} ${match[3]}`);
    }
    const nul = (entries: string[]) => (entries.length ? `${entries.join('\0')}\0` : '');
    return {
      ...(results[0] as PromiseFulfilledResult<{ head: string; branch: string; status: string }>)
        .value,
      index: nul(index),
      untracked: nul(untracked),
      flags: nul(flags),
    };
  };
  let before: Awaited<ReturnType<typeof observeGit>> | undefined;
  try {
    before = await observeGit();
    index = before.index;
    git = {
      head: before.head,
      branch: before.branch,
      status: before.status,
      index: digestNativeCheckInput(index),
    };
    const tracked = index
      .split('\0')
      .filter(Boolean)
      .map((record) => {
        const match = record.match(/^(100644|100755|120000|160000) [a-f0-9]+ 0\t(.+)$/su);
        if (!match) throw new Error('Git 输入存在未解决的索引冲突');
        return match[2];
      });
    selection = [...new Set([...tracked, ...before.untracked.split('\0').filter(Boolean)])];
  } catch (error) {
    // 只有确实没有仓库时才选物理树；仓库查询失败不能静默缩小输入范围。
    try {
      await runGitCommandAsync(root, ['rev-parse', '--show-toplevel']);
      diagnostics.push(`Git 输入读取失败：${String(error)}`);
    } catch {
      physical = true;
      const snapshot = await nativePhysicalCheckInputSnapshot(
        root,
        [],
        managedArtifactRoot,
        runnerInputs,
        'paths',
      );
      if (!snapshot.complete) diagnostics.push(snapshot.diagnostic ?? '物理输入读取不完整');
      selection = snapshot.files.map((file) => file.path);
    }
  }
  const links = parseGitlinksInIndex(index);
  const objectIds = (value: string) =>
    new Map(
      value.split('\0').flatMap((record) => {
        const match = record.match(/^(?:100644|100755) ([a-f0-9]+) 0\t(.+)$/su);
        return match ? [[match[2], match[1]] as const] : [];
      }),
    );
  const indexed = objectIds(index);
  const trusted = (observation: NonNullable<typeof before>) => {
    const dirty = new Set(parseGitStatusPaths(observation.status));
    return new Set(
      observation.flags
        .split('\0')
        .filter((record) => record.startsWith('H ') && !dirty.has(record.slice(2)))
        .map((record) => record.slice(2)),
    );
  };
  const clean = before ? trusted(before) : new Set<string>();
  const previous =
    !options.legacyArchiveOverlay &&
    options.previous?.complete &&
    options.previous.projectRoot === root
      ? options.previous
      : null;
  const oldFiles = new Map(previous?.files.map((file) => [file.path, file]) ?? []);
  const oldCache = new Map(previous?.hashCache?.map((entry) => [entry.path, entry]) ?? []);
  const hashCache: NonNullable<NativeRawInputSnapshot['hashCache']> = [];
  const reused = new Set<string>();
  const nestedFiles: NativeRawInputSnapshot['files'] = [];
  const nestedRepositories: NonNullable<NativeRawInputSnapshot['repositories']> = [];
  const statKey = (stat: import('node:fs').BigIntStats) =>
    [stat.dev, stat.ino, stat.size, stat.mode, stat.birthtimeNs, stat.mtimeNs, stat.ctimeNs].join(
      ':',
    );
  const generated = new Set<string>();
  const rawSessionOptions: Parameters<typeof createProtectedProjectReadSession>[2] = {
    ignoredDirectoryEntries: (ref) =>
      /(?:^|\/)\.next(?:\/dev)?$/u.test(ref)
        ? (entry) => isNativeNextVolatileInputPath(`${ref}/${entry.name}`)
        : undefined,
  };
  const readSession = await createProtectedProjectReadSession(
    root,
    'Native 原始输入',
    rawSessionOptions,
  );
  if (before) {
    try {
      const ignoredEntries = before.status
        .split('\0')
        .filter((record) => record.startsWith('!! '))
        .map((record) => record.slice(3))
        .join('\0');
      const { cwdRefs } = await nativeGeneratedInputRoots(
        root,
        [],
        `${index}\0${before.untracked}`,
        ignoredEntries,
        (ref) => readSession.observeDirectory(ref),
      );
      const visited = new Set<string>();
      const selected = new Set(selection);
      const visit = async (ref: string): Promise<void> => {
        if (visited.has(ref) || excluded(ref) || isNativeNextVolatileInputPath(ref)) return;
        visited.add(ref);
        const target = path.resolve(root, ...ref.split('/'));
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink()) throw new Error(`原始输入目录包含链接：${ref}`);
        if (!stat.isDirectory()) {
          if (!selected.has(ref)) generated.add(ref);
          return;
        }
        await readSession.observeDirectory(ref);
        for (const entry of await fs.readdir(target, { withFileTypes: true })) {
          if (entry.isDirectory() && NATIVE_DEPENDENCY_INPUT_DIRECTORIES.has(entry.name)) continue;
          await visit(`${ref}/${entry.name}`);
        }
      };
      for (const cwd of cwdRefs)
        for (const name of NATIVE_GENERATED_INPUT_DIRECTORIES) {
          const ref = cwd === '.' ? name : `${cwd}/${name}`;
          try {
            await visit(ref);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      selection = [...new Set([...selection, ...generated])];
    } catch (error) {
      diagnostics.push(`生成输入枚举不完整：${String(error)}`);
    }
  }
  const observed = await mapWithConcurrency(
    selection.filter((ref) => !excluded(ref)).sort(),
    16,
    async (ref) => {
      try {
        if (links.has(ref)) {
          const directory = await inspectProtectedProjectPath(root, ref, {
            label: `Native 子仓输入 ${ref}`,
            expected: 'directory',
          });
          if (!directory.exists) throw new Error('子仓目录缺失');
          const childRoot = await fs.realpath(path.resolve(root, ref));
          if (
            (await fs.realpath(
              (await runGitCommandAsync(childRoot, ['rev-parse', '--show-toplevel'])).trim(),
            )) !== childRoot
          )
            throw new Error('子仓 Git 根与目录不匹配');
          const prefix = `${ref}/`;
          const childPrevious = previous
            ? {
                ...previous,
                projectRoot: childRoot,
                files: previous.files
                  .filter((file) => file.path.startsWith(prefix))
                  .map((file) => ({ ...file, path: file.path.slice(prefix.length) })),
                hashCache: previous.hashCache
                  ?.filter((file) => file.path.startsWith(prefix))
                  .map((file) => ({ ...file, path: file.path.slice(prefix.length) })),
              }
            : undefined;
          const nested = await nativeRawInputSnapshot({
            projectRoot: childRoot,
            previous: childPrevious,
          });
          if (!nested.complete) throw new Error(nested.diagnostics.join('；'));
          nestedFiles.push(
            ...nested.files.map((file) => ({ ...file, path: `${prefix}${file.path}` })),
          );
          hashCache.push(
            ...(nested.hashCache ?? []).map((entry) => ({
              ...entry,
              path: `${prefix}${entry.path}`,
            })),
          );
          nestedRepositories.push(
            ...(nested.repositories ?? []).map((repository) => ({
              ...repository,
              path: repository.path === '.' ? ref : `${prefix}${repository.path}`,
            })),
          );
          return {
            path: ref,
            hash: digestNativeCheckInput('comet.native.raw-gitlink.v1'),
            mode: '160000',
          };
        }
        const cached = oldCache.get(ref),
          old = oldFiles.get(ref);
        const objectId = indexed.get(ref);
        if (old && cached && objectId && clean.has(ref) && cached.gitObjectId === objectId) {
          await readSession.observePath(ref);
          // 暂取旧摘要；最终叶子身份匹配原记录后才算本次观察完成，不给旧摘要绑定新 stat。
          reused.add(ref);
          hashCache.push({ ...cached });
          return old;
        }
        const file = await readSession.hash(ref);
        hashCache.push({
          path: ref,
          ...(objectId && clean.has(ref) ? { gitObjectId: objectId } : {}),
          statKey: statKey(file.stat as import('node:fs').BigIntStats),
        });
        return {
          path: ref,
          hash: file.digest,
          mode:
            process.platform === 'win32'
              ? '100644'
              : Number(file.stat.mode) & 0o111
                ? '100755'
                : '100644',
          ...(generated.has(ref) ? { generated: true as const } : {}),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !physical) return null;
        diagnostics.push(`${ref}：${String(error)}`);
        return null;
      }
    },
  );
  files.push(...observed.filter((file): file is NonNullable<typeof file> => file !== null));
  files.push(...nestedFiles);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (options.legacyArchiveOverlay) {
    const entries = new Map(files.map((file) => [file.path, file]));
    for (const [ref, original] of options.legacyArchiveOverlay) {
      if (excluded(ref)) continue;
      if (original.text === null) entries.delete(ref);
      else
        entries.set(ref, {
          path: ref,
          hash: createHash('sha256')
            .update(original.bytes ?? Buffer.from(original.text))
            .digest('hex'),
          mode:
            process.platform === 'win32' || !original.mode || !(original.mode & 0o111)
              ? '100644'
              : '100755',
        });
    }
    files.splice(
      0,
      files.length,
      ...[...entries.values()].sort((a, b) => a.path.localeCompare(b.path, 'en')),
    );
  }
  const finalSession = await createProtectedProjectReadSession(
    root,
    'Native 原始输入结束复核',
    rawSessionOptions,
  );
  const repairSession = await createProtectedProjectReadSession(
    root,
    'Native 原始输入缓存失效读取',
    rawSessionOptions,
  );
  const positions = new Map(files.map((file, index) => [file.path, index]));
  let repaired = false;
  await mapWithConcurrency(hashCache, 16, async (entry) => {
    try {
      const { stat: current } = await finalSession.stat(entry.path);
      if (statKey(current) !== entry.statKey && reused.has(entry.path)) {
        // 本次尚未实际读取此叶子；缓存失效时首次读取当前字节，再对全部叶子完成新鲜复查。
        const actual = await repairSession.hash(entry.path);
        entry.statKey = statKey(actual.stat as import('node:fs').BigIntStats);
        const position = positions.get(entry.path)!;
        files[position] = {
          ...files[position],
          hash: actual.digest,
          mode:
            process.platform === 'win32' || !(Number(actual.stat.mode) & 0o111)
              ? '100644'
              : '100755',
        };
        reused.delete(entry.path);
        repaired = true;
      } else if (statKey(current) !== entry.statKey)
        diagnostics.push(`原始输入在观察期间变化：${entry.path}`);
    } catch (error) {
      diagnostics.push(`原始输入结束复核失败：${entry.path}（${String(error)}）`);
    }
  });
  try {
    await finalSession.finish();
  } catch (error) {
    diagnostics.push(`原始输入结束目录复核不完整：${String(error)}`);
  }
  try {
    await repairSession.finish();
  } catch (error) {
    diagnostics.push(`原始输入缓存读取目录复核不完整：${String(error)}`);
  }
  if (repaired) {
    const completed = await createProtectedProjectReadSession(
      root,
      'Native 原始输入缓存更新后复核',
      rawSessionOptions,
    );
    await mapWithConcurrency(hashCache, 16, async (entry) => {
      try {
        if (statKey((await completed.stat(entry.path)).stat) !== entry.statKey)
          diagnostics.push(`原始输入在缓存读取期间变化：${entry.path}`);
      } catch (error) {
        diagnostics.push(`原始输入缓存复核失败：${entry.path}（${String(error)}）`);
      }
    });
    try {
      await completed.finish();
    } catch (error) {
      diagnostics.push(`原始输入缓存目录复核不完整：${String(error)}`);
    }
  }
  if (before) {
    try {
      const after = await observeGit();
      const afterClean = trusted(after),
        afterIndex = objectIds(after.index);
      for (const ref of reused) {
        const entry = oldCache.get(ref)!;
        if (!afterClean.has(ref) || afterIndex.get(ref) !== entry.gitObjectId)
          diagnostics.push(`复用的原始输入在采样时变化：${ref}`);
      }
      const selectedPaths = (observation: typeof after) =>
        [
          ...new Set([
            ...observation.index
              .split('\0')
              .filter(Boolean)
              .map((record) => record.slice(record.indexOf('\t') + 1)),
            ...observation.untracked.split('\0').filter(Boolean),
            ...observation.status
              .split('\0')
              .filter((record) => record.startsWith('!! '))
              .map((record) => record.slice(3)),
          ]),
        ]
          .filter((ref) => !excluded(ref))
          .sort();
      // status 可因 Git 刷新子模块状态或用户暂存而变化；输入范围只比较实际路径。
      if (JSON.stringify(selectedPaths(before)) !== JSON.stringify(selectedPaths(after)))
        diagnostics.push('Git 输入范围在读取期间变化');
    } catch (error) {
      diagnostics.push(`Git 输入复查失败：${String(error)}`);
    }
  }
  try {
    await readSession.finish();
  } catch (error) {
    diagnostics.push(`原始输入目录观察不完整：${String(error)}`);
  }
  return {
    schema: 'comet.native.raw-input.v1',
    projectRoot: root,
    files,
    complete: diagnostics.length === 0,
    diagnostics,
    contentHash: canonicalHash('comet.native.raw-content.v1', {
      projectRoot: root,
      files: files.map(({ path, hash, mode }) => ({ path, hash, mode })),
    }),
    contextHash: canonicalHash('comet.native.raw-context.v1', {
      machine: os.hostname(),
      execPath: process.execPath,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      environment: Object.entries(process.env)
        .map(([name, value]) => [name, value ?? null])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    }),
    git,
    hashCache: options.legacyArchiveOverlay
      ? []
      : hashCache.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    repositories: [...(git ? [{ path: '.', ...git }] : []), ...nestedRepositories].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  };
}

export async function saveNativeRawInput(
  root: string,
  directory: string,
  snapshot: NativeRawInputSnapshot,
) {
  const hash = hashRuntimeValue(snapshot as unknown as RuntimeValue);
  const target = await ensureProtectedProjectDirectory(root, directory, {
    label: 'Native 原始输入记录',
  });
  const ref = `${directory}/${hash}.json`;
  try {
    await atomicWriteContainedText(path.join(target, `${hash}.json`), JSON.stringify(snapshot), {
      containedRoot: root,
      exclusive: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await readNativeRawInput(root, directory, ref);
  }
  return ref;
}

export async function readNativeRawInput(
  root: string,
  directory: string,
  ref: string,
): Promise<NativeRawInputSnapshot> {
  const prefix = `${directory}/`;
  if (
    typeof ref !== 'string' ||
    !ref.startsWith(prefix) ||
    !/^[a-f0-9]{64}\.json$/u.test(ref.slice(prefix.length))
  )
    throw new Error('Native 原始输入记录引用无效');
  const content = await readProtectedProjectFile(root, ref, Number.MAX_SAFE_INTEGER, {
    label: 'Native 原始输入记录',
  });
  const snapshot = JSON.parse(content.bytes.toString('utf8')) as NativeRawInputSnapshot;
  if (
    snapshot.schema !== 'comet.native.raw-input.v1' ||
    hashRuntimeValue(snapshot as unknown as RuntimeValue) !== ref.slice(prefix.length, -5)
  )
    throw new Error('Native 原始输入记录已变化');
  return snapshot;
}

export function nativeRawInputChanges(
  before: NativeRawInputSnapshot,
  after: NativeRawInputSnapshot,
) {
  const left = new Map(before.files.map((file) => [file.path, file]));
  const right = new Map(after.files.map((file) => [file.path, file]));
  return [...new Set([...left.keys(), ...right.keys()])].flatMap((ref) => {
    const a = left.get(ref),
      b = right.get(ref);
    return a?.hash === b?.hash && a?.mode === b?.mode
      ? []
      : [
          {
            path: ref,
            beforeHash: a?.hash ?? 'missing',
            afterHash: b?.hash ?? 'missing',
            beforeMode: a?.mode ?? 'missing',
            afterMode: b?.mode ?? 'missing',
          },
        ];
  });
}

export async function nativeRawCandidateHash(
  snapshot: NativeRawInputSnapshot,
  scope: EditReviewScope,
  formalPaths: readonly string[] = [],
): Promise<string | null> {
  if (!snapshot.complete) return null;
  const reviews = await inspectEditReviews(scope);
  const files: NativeRawInputSnapshot['files'] = [];
  for (const file of snapshot.files) {
    // 正式契约由 Shape 的批准绑定单独核对，不作为实现改动再次处理。
    if (formalPaths.includes(file.path)) continue;
    const reviewed = await approvedEditHash(scope, file.path, file.hash, reviews, file.mode);
    if (reviewed && !reviewed.semantic) {
      if (reviewed.beforeHash !== null)
        files.push({ ...file, hash: reviewed.beforeHash, mode: reviewed.beforeMode ?? file.mode });
    } else files.push(file);
  }
  const present = new Set(snapshot.files.map((file) => file.path));
  const deleted = new Map(
    reviews.flatMap((review) =>
      review.edits
        .filter((edit) => edit.afterHash === 'missing')
        .map((edit) => [edit.path, edit] as const),
    ),
  );
  for (const [ref, edit] of deleted) {
    if (present.has(ref) || formalPaths.includes(ref)) continue;
    const reviewed = await approvedEditHash(scope, ref, 'missing', reviews);
    if (reviewed && !reviewed.semantic && reviewed.beforeHash !== null)
      files.push({
        path: ref,
        hash: reviewed.beforeHash,
        mode: edit.beforeMode ?? (edit.executable ? '100755' : '100644'),
      });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return canonicalHash('comet.native.raw-candidate.v1', {
    projectRoot: snapshot.projectRoot,
    files: files.map(({ path, hash, mode }) => ({ path, hash, mode })),
  });
}

export async function nativeRawCandidateInputHash(
  snapshot: NativeRawInputSnapshot,
  paths: NativeProjectPaths,
  state: NativePortableState,
) {
  const approved = await readNativeApprovedShapeSemanticSnapshot({ paths, state });
  const formal = (approved?.snapshot.artifacts ?? []).map((artifact) =>
    path
      .relative(paths.projectRoot, path.join(paths.changesDir, state.name, artifact.source))
      .replaceAll('\\', '/'),
  );
  return nativeRawCandidateHash(snapshot, nativeEditReviewScope(paths, state), formal);
}

function portableRawDirectory(paths: NativeProjectPaths, name: string) {
  return `${path.relative(paths.workspaceRuntimeRoot, nativePreferredChangeRuntimeDir(paths, name)).replaceAll('\\', '/')}/inputs`;
}

export async function captureNativePortableCandidateInputs(
  paths: NativeProjectPaths,
  state: NativePortableState,
  projectRoot = paths.projectRoot,
) {
  const snapshot = await nativeRawInputSnapshot({
    projectRoot,
    managedArtifactRoot: paths.artifactRoot,
  });
  return {
    rawInputRef: await saveNativeRawInput(
      paths.workspaceRuntimeRoot,
      portableRawDirectory(paths, state.name),
      snapshot,
    ),
    candidateInputFingerprintGate: await nativeRawCandidateInputHash(snapshot, paths, state),
    inputFingerprint: hashRuntimeValue({
      content: snapshot.contentHash,
      context: snapshot.contextHash,
    }),
    inputFingerprintGate: hashRuntimeValue({
      content: snapshot.contentHash,
      context: snapshot.contextHash,
    }),
  };
}

export function nativePortableCheckExecutionRef(check: NativeLocalCheckState) {
  return check.rawInput?.executionRef ?? `native-check:${check.operationId}`;
}

async function portableRawSnapshot(
  paths: NativeProjectPaths,
  state: NativePortableState,
  ref: string,
) {
  return readNativeRawInput(
    paths.workspaceRuntimeRoot,
    portableRawDirectory(paths, state.name),
    ref,
  );
}

export async function observeNativePortableRawInputs(
  paths: NativeProjectPaths,
  state: NativePortableState,
  local: NativeLocalExecutionState,
) {
  if (!local.rawInputRef)
    throw new Error(
      '旧执行没有原始输入记录；保留旧证据，沿用原检查建立新记录，不能从当前文件补造旧快照',
    );
  const original = await portableRawSnapshot(paths, state, local.rawInputRef);
  const current = await nativeRawInputSnapshot({
    projectRoot: local.workspace.worktreeRoot,
    managedArtifactRoot: paths.artifactRoot,
    previous: original,
  });
  if (!original.complete || !current.complete)
    throw new Error(
      `原始输入观察不完整：${[...original.diagnostics, ...current.diagnostics].join('；')}`,
    );
  const changes = nativeRawInputChanges(original, current);
  for (const check of local.checks) {
    if (!check.rawInput) continue;
    const after = await portableRawSnapshot(paths, state, check.rawInput.afterRef);
    changes.push(...nativeRawInputChanges(after, current));
  }
  const currentRef = await saveNativeRawInput(
    paths.workspaceRuntimeRoot,
    portableRawDirectory(paths, state.name),
    current,
  );
  return {
    beforeRef: local.rawInputRef,
    currentRef,
    changes: [...new Map(changes.map((change) => [JSON.stringify(change), change])).values()],
    git: { before: original.repositories, current: current.repositories },
    ...(state.phase === 'archive' && !state.archived
      ? {
          refreshInputTemplate: {
            expectedStateVersion: state.state_version,
            observationRef: currentRef,
            sourceExecutions: Object.fromEntries(
              local.checks.map((check) => [check.id, nativePortableCheckExecutionRef(check)]),
            ),
            reportSha256: (
              await hashProtectedProjectFile(
                paths.projectRoot,
                path
                  .relative(
                    paths.projectRoot,
                    path.join(paths.changesDir, state.name, 'verification.md'),
                  )
                  .replaceAll('\\', '/'),
                { label: 'Native 已接受验收报告' },
              )
            ).digest,
            checkIds: [] as string[],
            summary: '<当前 Agent 说明仅补这些检查且保留原验收的依据>',
          },
        }
      : {}),
  };
}

export interface NativePortableCheckRefreshInput {
  expectedStateVersion: number;
  observationRef: string;
  sourceExecutions: Record<string, string>;
  reportSha256: string;
  checkIds: string[];
  summary: string;
}

export async function refreshNativePortableChecks(
  paths: NativeProjectPaths,
  name: string,
  refresh: NativePortableCheckRefreshInput,
) {
  const state = await readNativePortableChange(paths, name);
  const local = await readCurrentLocalExecution({ paths, state });
  if (!local?.rawInputRef)
    throw new Error(
      '原检查缺少原始输入记录；保留已接受结果，先诊断具体缺项，不能从当前文件补造旧执行',
    );
  return executeNativePortableCheckPlan({
    paths,
    name,
    plans: nativePortableCheckPlansFromLocal(local),
    archiveRefresh: refresh,
  });
}

export async function assertNativePortableRawCandidate(
  paths: NativeProjectPaths,
  state: NativePortableState,
  local: NativeLocalExecutionState,
  current?: NativeRawInputSnapshot,
) {
  if (!local.rawInputRef) return;
  const original = await portableRawSnapshot(paths, state, local.rawInputRef);
  const observed =
    current ??
    (await nativeRawInputSnapshot({
      projectRoot: local.workspace.worktreeRoot,
      managedArtifactRoot: paths.artifactRoot,
      previous: original,
    }));
  if (!original.complete || !observed.complete)
    throw new Error(
      `Native 原始候选输入不完整：${[...original.diagnostics, ...observed.diagnostics].join('；')}`,
    );
  const comparable = await nativePortableArchiveInputView(paths, state, observed, original);
  if (
    (await nativeRawCandidateInputHash(original, paths, state)) !==
    (await nativeRawCandidateInputHash(comparable, paths, state))
  )
    throw new Error(
      `Native 原候选内容已变化；保留工作，由当前 Agent 使用 comet edit-review observe native ${state.name} --session <当前会话> --json 判断实际影响`,
    );
}

/** 仅将原事务已经发布且字节仍精确匹配的 Spec 映回原输入，其他路径保持实际观察。 */
async function nativePortableArchiveInputView(
  paths: NativeProjectPaths,
  state: NativePortableState,
  current: NativeRawInputSnapshot,
  baseline: NativeRawInputSnapshot,
): Promise<NativeRawInputSnapshot> {
  if (state.phase !== 'archive') return current;
  const transaction = await readNativePortableTransaction(paths, {
    change: state.name,
    kind: 'archive',
  });
  if (!transaction || transaction.kind !== 'archive') return current;
  const entries = new Map(current.files.map((file) => [file.path, file]));
  const originals = new Map(baseline.files.map((file) => [file.path, file]));
  for (const change of transaction.journal.spec_changes.slice(
    0,
    transaction.journal.next_spec_index,
  )) {
    const ref = path
      .relative(paths.projectRoot, path.join(paths.specsDir, change.capability, 'spec.md'))
      .replaceAll('\\', '/');
    const actual = entries.get(ref);
    if (
      change.operation === 'remove'
        ? Boolean(actual)
        : !actual ||
          actual.hash !==
            createHash('sha256')
              .update(change.content ?? '')
              .digest('hex')
    )
      throw new Error(`Native 已发布 Spec 与原归档事务不匹配：${ref}`);
    const original = originals.get(ref);
    if (original) entries.set(ref, original);
    else entries.delete(ref);
  }
  return {
    ...current,
    files: [...entries.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

async function portableRawCheckApplicable(
  paths: NativeProjectPaths,
  state: NativePortableState,
  check: NativeLocalCheckState,
  current: NativeRawInputSnapshot,
) {
  if (!check.rawInput || !current.complete) return false;
  const [before, after] = await Promise.all([
    portableRawSnapshot(paths, state, check.rawInput.beforeRef),
    portableRawSnapshot(paths, state, check.rawInput.afterRef),
  ]);
  if (
    !before.complete ||
    !after.complete ||
    before.contextHash !== current.contextHash ||
    after.contextHash !== current.contextHash ||
    after.projectRoot !== current.projectRoot
  )
    return false;
  const changes = nativeRawInputChanges(
    after,
    await nativePortableArchiveInputView(paths, state, current, after),
  );
  return (
    !changes.length ||
    isCheckInputRetained(
      nativeEditReviewScope(paths, state),
      nativePortableCheckExecutionRef(check),
      changes,
      [],
      check.id,
    )
  );
}

export async function assertNativePortableRawCheckInputs(
  paths: NativeProjectPaths,
  state: NativePortableState,
  local: NativeLocalExecutionState,
) {
  if (!local.rawInputRef) {
    if (state.builder_handoff?.raw_input_ref)
      throw new Error(
        'Native 原始检查记录缺失；保留原批准和文件，恢复原执行记录或补齐缺失检查，不能复用摘要中的成功',
      );
    return;
  }
  const missing = (state.verification?.checks ?? []).filter(
    (check) => !local.checks.some((actual) => actual.id === check.id),
  );
  if (missing.length)
    throw new Error(
      `Native 原始检查记录缺失：${missing.map((check) => check.id).join(', ')}；保留原批准并只补必要证据`,
    );
  const current = await nativeRawInputSnapshot({
    projectRoot: local.workspace.worktreeRoot,
    managedArtifactRoot: paths.artifactRoot,
    previous: await portableRawSnapshot(paths, state, local.rawInputRef),
  });
  await assertNativePortableRawCandidate(paths, state, local, current);
  for (const check of local.checks) {
    if (
      check.status !== 'passed' ||
      !(await portableRawCheckApplicable(paths, state, check, current)) ||
      !(await hasNativeRuntimeCheckEvidence(
        { ...local, checks: [check] },
        nativePreferredChangeRuntimeDir(paths, state.name),
      ))
    )
      throw new Error(
        `Native 检查 ${check.id} 的实际结果或输入不再适用；保留原阶段，由当前 Agent 选择受影响检查，失败或未执行不能复用旧成功`,
      );
  }
}

const NATIVE_DEPENDENCY_INPUT_DIRECTORIES = new Set([
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  '.pnpm',
  '.pnpm-store',
]);

const NATIVE_PROJECT_INPUT_MANIFESTS = new Set([
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'tsconfig.json',
]);

const NATIVE_WORKTREE_INPUT_DIRECTORIES = new Set(['.worktrees']);

const NATIVE_PHYSICAL_INPUT_EXCLUDED_DIRECTORIES = new Set([
  '.agents',
  '.cache',
  '.claude',
  '.codex',
  '.comet',
  '.git',
  '.idea',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.svelte-kit',
  '.tmp',
  '.turbo',
  '.vscode',
  'coverage',
  'logs',
  'node_modules',
  'temp',
  'tmp',
]);

// These files are Runtime bookkeeping. They change as a check is reserved and
// completed, so treating them as candidate input makes the next invocation
// invalidate its own binding. The project configuration remains an input and is
// intentionally not excluded.
const NATIVE_RUNTIME_INPUT_EXCLUSIONS = [
  ':(exclude).comet/runtime',
  ':(exclude).comet/runtime/**',
  ':(exclude).comet/current-change.json',
] as const;

const NATIVE_RUNTIME_MANAGED_FILES = new Set([
  'comet-state.yaml',
  'children.yaml',
  'verification.md',
]);

function nativeOwnedInputExclusions(projectRoot: string, managedArtifactRoot?: string): string[] {
  const exclusions = [
    ...NATIVE_RUNTIME_INPUT_EXCLUSIONS,
    ...[...NATIVE_WORKTREE_INPUT_DIRECTORIES].flatMap((directory) => [
      `:(exclude,glob)${directory}`,
      `:(exclude,glob)${directory}/**`,
    ]),
  ];
  if (!managedArtifactRoot) return exclusions;
  const artifactRef = path.relative(projectRoot, managedArtifactRoot).replaceAll('\\', '/');
  if (path.isAbsolute(artifactRef) || artifactRef === '..' || artifactRef.startsWith('../')) {
    return exclusions;
  }
  const prefix = artifactRef === '' ? '' : `${artifactRef}/`;
  return [
    ...exclusions,
    ...['changes', 'archive'].flatMap((directory) =>
      [...NATIVE_RUNTIME_MANAGED_FILES].map(
        (file) => `:(exclude)${prefix}comet/${directory}/**/${file}`,
      ),
    ),
  ];
}

function isNativeOwnedInputPath(
  relative: string,
  projectRoot?: string,
  managedArtifactRoot?: string,
): boolean {
  const normalized = relative.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (
    NATIVE_WORKTREE_INPUT_DIRECTORIES.has(normalized.split('/')[0]) ||
    normalized === '.comet/current-change.json' ||
    normalized === '.comet/runtime' ||
    normalized.startsWith('.comet/runtime/')
  ) {
    return true;
  }
  if (
    !projectRoot ||
    !managedArtifactRoot ||
    !NATIVE_RUNTIME_MANAGED_FILES.has(path.basename(normalized))
  ) {
    return false;
  }
  const target = path.resolve(projectRoot, ...normalized.split('/'));
  const relativeToArtifact = path.relative(path.resolve(managedArtifactRoot), target);
  if (
    path.isAbsolute(relativeToArtifact) ||
    relativeToArtifact === '..' ||
    relativeToArtifact.startsWith(`..${path.sep}`)
  ) {
    return false;
  }
  const [, directory] = relativeToArtifact.split(path.sep);
  return (
    relativeToArtifact.startsWith(`comet${path.sep}`) &&
    (directory === 'changes' || directory === 'archive')
  );
}

function incompleteNativeIgnoredInputSnapshot(diagnostic: string): NativeIgnoredInputSnapshot {
  return { complete: false, files: [], diagnostic };
}

function nativeGeneratedInputExclusions(cwdRef: string): string[] {
  const prefix = cwdRef === '.' ? '' : `${cwdRef}/`;
  return ['cache', 'trace', 'trace-build', 'dev'].flatMap((name) => [
    `:(exclude,glob)${prefix}.next/${name}`,
    `:(exclude,glob)${prefix}.next/${name}/**`,
  ]);
}

// Git can return a nested repository directory even when it does not match an
// inclusive pathspec. Only the declared generated-input roots belong here;
// non-regular entries within those roots must still fail the complete snapshot.
function isNativeGeneratedInputPath(relative: string, cwdRefs: readonly string[]): boolean {
  if (isNativeNextVolatileInputPath(relative)) return false;
  return cwdRefs.some((cwdRef) => {
    const prefix = cwdRef === '.' ? '' : `${cwdRef}/`;
    return NATIVE_GENERATED_INPUT_DIRECTORIES.some((directory) =>
      relative.startsWith(`${prefix}${directory}/`),
    );
  });
}

function isNativeNextVolatileInputPath(relative: string): boolean {
  const parts = relative.split('/');
  const next = parts.lastIndexOf('.next');
  if (next < 0) return false;
  const [entry, child] = parts.slice(next + 1);
  return (
    entry === 'cache' ||
    entry === 'trace' ||
    entry === 'trace-build' ||
    (entry === 'dev' && child !== undefined && child !== 'types')
  );
}

async function nativeGeneratedInputRoots(
  projectRoot: string,
  plans: readonly NativeCheckPlan[],
  stagedIndex: string,
  ignoredEntries: string,
  observeDirectory?: (ref: string) => Promise<unknown>,
): Promise<{ cwdRefs: string[]; discovery: Map<string, string> }> {
  const roots = new Set(['.', ...plans.map(({ cwdRef }) => cwdRef)]);
  const discovery = new Map<string, string>();
  const visit = async (relative: string): Promise<void> => {
    const parts = relative.split('/').filter(Boolean);
    if (
      parts.some(
        (part) =>
          NATIVE_DEPENDENCY_INPUT_DIRECTORIES.has(part) ||
          NATIVE_WORKTREE_INPUT_DIRECTORIES.has(part) ||
          (NATIVE_PHYSICAL_INPUT_EXCLUDED_DIRECTORIES.has(part) &&
            !NATIVE_GENERATED_INPUT_DIRECTORIES.includes(
              part as (typeof NATIVE_GENERATED_INPUT_DIRECTORIES)[number],
            )),
      )
    )
      return;
    if (isNativeOwnedInputPath(relative, projectRoot)) return;
    const generated = parts.findIndex((part) =>
      NATIVE_GENERATED_INPUT_DIRECTORIES.includes(
        part as (typeof NATIVE_GENERATED_INPUT_DIRECTORIES)[number],
      ),
    );
    if (generated !== -1) {
      roots.add(parts.slice(0, generated).join('/') || '.');
      return;
    }
    const target = path.resolve(projectRoot, ...parts);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error('Generated input discovery contains a link');
    if (!stat.isDirectory()) return;
    discovery.set(target, `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}`);
    await observeDirectory?.(relative);
    const directory = await fs.opendir(target);
    for await (const entry of directory) {
      if (entry.isDirectory() || entry.isSymbolicLink()) await visit(`${relative}/${entry.name}`);
    }
  };
  // 已跟踪的项目清单覆盖 monorepo 子项目，不扫描 node_modules 寻找项目。
  for (const entry of stagedIndex.split('\0')) {
    const relative = entry.slice(entry.indexOf('\t') + 1);
    if (!NATIVE_PROJECT_INPUT_MANIFESTS.has(path.posix.basename(relative))) continue;
    if (relative.split('/').some((part) => NATIVE_DEPENDENCY_INPUT_DIRECTORIES.has(part))) continue;
    roots.add(path.posix.dirname(relative));
  }
  // --directory collapses ignored dependency trees to one entry. Discover
  // generated roots from those entries without asking Git to descend into
  // node_modules with a recursive **/dist pathspec.
  for (const entry of ignoredEntries.split('\0')) {
    const parts = entry.replaceAll('\\', '/').split('/').filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      if (
        NATIVE_DEPENDENCY_INPUT_DIRECTORIES.has(parts[index]) ||
        NATIVE_WORKTREE_INPUT_DIRECTORIES.has(parts[index])
      )
        break;
      if (
        NATIVE_GENERATED_INPUT_DIRECTORIES.includes(
          parts[index] as (typeof NATIVE_GENERATED_INPUT_DIRECTORIES)[number],
        )
      )
        roots.add(parts.slice(0, index).join('/') || '.');
    }
    if (entry.endsWith('/')) await visit(entry.replace(/\/$/u, ''));
  }
  return { cwdRefs: [...roots].sort(), discovery };
}

/** 一次读取提交和分支；保持既有摘要的字段和值。 */
function nativeGitHead(projectRoot: string): { head: string; branch: string } {
  const [head, ref] = runGitCommand(projectRoot, [
    'rev-parse',
    'HEAD',
    '--symbolic-full-name',
    'HEAD',
  ]).split(/\r?\n/u);
  if (!head || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(head) || !ref)
    throw new Error('Native 检查输入中的 Git HEAD 无效');
  return { head, branch: ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : '' };
}

/** 等待所有探测结束再返回失败，避免残留查询占用工作区。 */
async function nativeGitQueries(projectRoot: string, commands: readonly (readonly string[])[]) {
  return mapWithConcurrency(commands, 4, (args) => runGitCommandAsync(projectRoot, args));
}

async function nativeIgnoredCheckInputSnapshot(
  projectRoot: string,
  plans: readonly NativeCheckPlan[],
  managedArtifactRoot?: string,
  runnerInputs: ReadonlySet<string> = new Set(),
  stagedIndex = '',
  repositories = new Set<string>(),
  options: { enumerateOnly?: boolean; recurseGitlinks?: boolean } = {},
): Promise<NativeIgnoredInputSnapshot> {
  let ignoredPaths: string[];
  let realRoot: string;
  try {
    realRoot = await fs.realpath(projectRoot);
    if (repositories.has(realRoot))
      return incompleteNativeIgnoredInputSnapshot('项目生成输入包含重复的子仓库路径');
    repositories.add(realRoot);
    const ignoredEntries = runGitCommand(projectRoot, [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '-z',
    ]);
    const { cwdRefs, discovery } = await nativeGeneratedInputRoots(
      projectRoot,
      plans,
      stagedIndex,
      ignoredEntries,
    );
    const selections: Array<{ ref: string; exclusions: string[] }> = [];
    const roots = new Map<string, string | null>();
    const rootStamp = (info: import('node:fs').Stats) =>
      `${info.dev}:${info.ino}:${info.birthtimeMs}:${info.mode}`;
    for (const cwdRef of cwdRefs) {
      for (const directory of [
        ...NATIVE_GENERATED_INPUT_DIRECTORIES,
        '.next/types',
        '.next/dev/types',
      ]) {
        const ref = cwdRef === '.' ? directory : `${cwdRef}/${directory}`;
        const target = path.resolve(projectRoot, ...ref.split('/'));
        try {
          const info = await fs.lstat(target);
          roots.set(target, rootStamp(info));
          if (
            info.isSymbolicLink() ||
            (await fs.realpath(target)) !== path.resolve(realRoot, ...ref.split('/'))
          ) {
            return incompleteNativeIgnoredInputSnapshot(
              `项目生成输入目录包含链接或超出工作区：${ref}`,
            );
          }
          if (directory !== '.next/types')
            selections.push({
              ref,
              exclusions:
                directory === '.next/dev/types' ? [] : nativeGeneratedInputExclusions(cwdRef),
            });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          roots.set(target, null);
        }
      }
    }
    const dependencyExclusions = [...NATIVE_DEPENDENCY_INPUT_DIRECTORIES].map(
      (directory) => `:(exclude,glob)**/${directory}/**`,
    );
    // 多个 glob 路径会让 Git 进入无关的 ignored 依赖和本地工作区。
    // 每次只选择一个实际存在的字面目录；并行查询仍受统一上限约束。
    const selected = (
      await nativeGitQueries(
        projectRoot,
        selections.map(({ ref, exclusions }) => [
          'ls-files',
          '--others',
          '--ignored',
          '--exclude-standard',
          '-z',
          '--',
          `:(literal)${ref}/`,
          ...exclusions,
          ...dependencyExclusions,
          ...nativeOwnedInputExclusions(projectRoot, managedArtifactRoot),
          ...[...runnerInputs].map((relative) => `:(exclude,literal)${relative}`),
        ]),
      )
    ).join('\0');
    for (const [directory, before] of discovery) {
      const stat = await fs.lstat(directory);
      if (`${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}` !== before)
        return incompleteNativeIgnoredInputSnapshot('项目生成输入的父目录在采样期间发生变化');
    }
    // 只复查根的存在与身份；Next cache/trace 等已排除内容可改变目录时间。
    for (const [target, before] of roots) {
      const after = await fs
        .lstat(target)
        .then(rootStamp)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
      if (after !== before)
        return incompleteNativeIgnoredInputSnapshot('项目生成输入目录在采样期间发生变化');
    }
    ignoredPaths = [
      ...new Set(
        selected
          .split('\0')
          .filter(Boolean)
          .map((relative) => relative.replaceAll('\\', '/'))
          .filter(
            (relative) =>
              isNativeGeneratedInputPath(relative, cwdRefs) &&
              !runnerInputs.has(relative) &&
              !isNativeOwnedInputPath(relative, projectRoot, managedArtifactRoot),
          ),
      ),
    ].sort();
  } catch {
    return incompleteNativeIgnoredInputSnapshot('无法列出项目生成输入；本次检查不能复用旧证据');
  }
  const files: NativeIgnoredInputFile[] = [];
  for (const relative of ignoredPaths) {
    if (runnerInputs.has(relative)) continue;
    if (isNativeOwnedInputPath(relative, projectRoot, managedArtifactRoot)) continue;
    const target = path.resolve(projectRoot, ...relative.split('/'));
    if (!isInsidePath(projectRoot, target)) {
      return incompleteNativeIgnoredInputSnapshot(`项目生成输入超出工作区：${relative}`);
    }
    try {
      const realTarget = await fs.realpath(target);
      if (
        !isInsidePath(realRoot, realTarget) ||
        realTarget !== path.resolve(realRoot, ...relative.split('/'))
      ) {
        return incompleteNativeIgnoredInputSnapshot(
          `项目生成输入路径包含链接或超出工作区：${relative}`,
        );
      }
      const before = await fs.lstat(target);
      if (!before.isFile()) {
        return incompleteNativeIgnoredInputSnapshot(`项目生成输入不是普通文件：${relative}`);
      }
      const { digest, size } = options.enumerateOnly
        ? { digest: '', size: before.size }
        : await digestNativeInputFileContent(target);
      files.push({ path: relative, digest, size });
    } catch {
      return incompleteNativeIgnoredInputSnapshot(`项目生成输入无法稳定读取：${relative}`);
    }
  }
  // 父仓 ls-files 不进入 gitlink；每个子仓必须按自己的 ignore 规则收集生成输入。
  for (const [relative] of parseGitlinksInIndex(stagedIndex)) {
    if (options.recurseGitlinks === false) continue;
    if (relative.split('/').some((part) => NATIVE_DEPENDENCY_INPUT_DIRECTORIES.has(part))) continue;
    try {
      const child = path.resolve(projectRoot, ...relative.split('/'));
      const info = await fs.lstat(child);
      const realChild = await fs.realpath(child);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        realChild !== path.resolve(realRoot, ...relative.split('/')) ||
        !isInsidePath(realRoot, realChild) ||
        (await fs.realpath(runGitCommand(child, ['rev-parse', '--show-toplevel']))) !== realChild
      )
        return incompleteNativeIgnoredInputSnapshot(`项目生成输入子仓库不可用：${relative}`);
      const childPlans = plans.flatMap((plan) => {
        const cwdRef = path.posix.relative(relative, plan.cwdRef);
        return cwdRef === '..' || cwdRef.startsWith('../') || path.posix.isAbsolute(cwdRef)
          ? []
          : [{ ...plan, cwdRef: cwdRef || '.' }];
      });
      const childInputs = new Set(
        [...runnerInputs]
          .filter((ref) => ref.startsWith(`${relative}/`))
          .map((ref) => ref.slice(relative.length + 1)),
      );
      const snapshot = await nativeIgnoredCheckInputSnapshot(
        child,
        childPlans,
        managedArtifactRoot,
        childInputs,
        runGitCommand(child, ['ls-files', '--stage', '-z']),
        repositories,
        options,
      );
      if (!snapshot.complete)
        return incompleteNativeIgnoredInputSnapshot(`子仓库 ${relative}：${snapshot.diagnostic}`);
      files.push(...snapshot.files.map((file) => ({ ...file, path: `${relative}/${file.path}` })));
    } catch {
      return incompleteNativeIgnoredInputSnapshot(`无法完整读取子仓库生成输入：${relative}`);
    }
  }
  return {
    complete: true,
    files: files.sort((left, right) => left.path.localeCompare(right.path, 'en')),
  };
}

async function nativePhysicalCheckInputSnapshot(
  projectRoot: string,
  plans: readonly NativeCheckPlan[],
  managedArtifactRoot?: string,
  runnerInputs: ReadonlySet<string> = new Set(),
  kind: 'check' | 'candidate' | 'paths' = 'check',
): Promise<NativeIgnoredInputSnapshot> {
  // 根配置和 lockfile 也可影响子目录内的检查。
  const cwdRefs = ['.'];
  void plans;
  const files = new Map<string, NativeIgnoredInputFile>();
  let diagnostic = '';
  const unreadable = (relative: string, reason: string): false => {
    diagnostic = `工作区输入无法完整读取：${relative || '.'}（${reason}）`;
    return false;
  };
  const isGeneratedDirectory = (name: string): boolean =>
    NATIVE_GENERATED_INPUT_DIRECTORIES.includes(
      name as (typeof NATIVE_GENERATED_INPUT_DIRECTORIES)[number],
    );

  const visit = async (
    directory: string,
    relativeDirectory: string,
    insideGeneratedDirectory: boolean,
  ): Promise<boolean> => {
    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return unreadable(relativeDirectory, '无法列出目录');
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (runnerInputs.has(relative)) continue;
      if (isNativeOwnedInputPath(relative, projectRoot, managedArtifactRoot)) continue;
      const target = path.join(directory, entry.name);
      if (kind === 'candidate' && isGeneratedDirectory(entry.name)) continue;
      if (isNativeNextVolatileInputPath(relative)) continue;
      if (
        entry.isDirectory() &&
        (NATIVE_DEPENDENCY_INPUT_DIRECTORIES.has(entry.name) ||
          (!insideGeneratedDirectory &&
            NATIVE_PHYSICAL_INPUT_EXCLUDED_DIRECTORIES.has(entry.name) &&
            !isGeneratedDirectory(entry.name)))
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        if (
          !(await visit(
            target,
            relative,
            insideGeneratedDirectory || isGeneratedDirectory(entry.name),
          ))
        ) {
          return false;
        }
        continue;
      }
      // 候选绑定只保存内容摘要；不能根据文件名否决用户的项目输入。
      if (!entry.isFile()) return unreadable(relative, '不是普通文件或包含链接');
      try {
        const { digest, size } =
          kind === 'paths'
            ? { digest: '', size: (await fs.lstat(target)).size }
            : await digestNativeInputFileContent(target);
        files.set(relative, {
          path: relative,
          digest,
          size,
        });
      } catch {
        return unreadable(relative, '文件无法读取或读取期间发生变化');
      }
    }
    return true;
  };

  for (const cwdRef of cwdRefs) {
    const directory = resolveNativeCheckCwd(projectRoot, cwdRef);
    const relativeDirectory = cwdRef === '.' ? '' : cwdRef;
    if (
      !(await visit(directory, relativeDirectory, isGeneratedDirectory(path.basename(directory))))
    ) {
      return incompleteNativeIgnoredInputSnapshot(diagnostic);
    }
  }
  return {
    complete: true,
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path, 'en')),
  };
}

function nativeLocalCheckEvidenceDigest(
  check: Pick<
    NativeLocalCheckState,
    | 'id'
    | 'name'
    | 'status'
    | 'repeatable'
    | 'timeoutMs'
    | 'argv'
    | 'cwd'
    | 'exitCode'
    | 'startedAt'
    | 'completedAt'
    | 'log'
    | 'rawInput'
  >,
  logContent: string,
): string {
  return canonicalHash(
    check.rawInput
      ? 'comet.native.local-check-evidence.v2'
      : 'comet.native.local-check-evidence.v1',
    {
      id: check.id,
      name: check.name,
      status: check.status,
      repeatable: check.repeatable,
      timeoutMs: check.timeoutMs,
      argv: check.argv,
      cwd: path.resolve(check.cwd),
      exitCode: check.exitCode,
      startedAt: check.startedAt,
      completedAt: check.completedAt,
      log: check.log,
      logDigest: digestNativeCheckInput(logContent),
      ...(check.rawInput ? { rawInput: check.rawInput } : {}),
    },
  );
}

async function nativeCheckWorkingTreeDigest(
  projectRoot: string,
  relative: string,
): Promise<string> {
  const target = path.resolve(projectRoot, ...relative.split('/'));
  try {
    return (await digestNativeInputFileContent(target)).digest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return digestNativeCheckInput('comet.native.check-input.missing');
    }
    throw error;
  }
}

interface NativeCheckInputOptions {
  state: NativePortableState;
  projectRoot: string;
  plans: readonly NativeCheckPlan[];
  managedArtifactRoot?: string;
  /** Archive 材料另有内容绑定，仅从归档期间的生成输入摘要排除。 */
  generatedInputExclusions?: readonly string[];
}

export async function nativeCheckInputFingerprint(
  options: NativeCheckInputOptions,
): Promise<string> {
  return (await nativeCheckInputSnapshot(options)).fingerprint;
}

/** Archive 已分别绑定源码，只读取生成输入，避免每次复核再扫描完整源码树。 */
export async function nativeGeneratedCheckInputSnapshot(options: NativeCheckInputOptions) {
  const runnerInputs = await nativeRunnerInputArtifactPaths(options.projectRoot);
  const exclusions = [
    ...nativeOwnedInputExclusions(options.projectRoot, options.managedArtifactRoot),
    ...[...runnerInputs].map((relative) => `:(exclude,literal)${relative}`),
  ];
  let ignored: NativeIgnoredInputSnapshot = { complete: true, files: [] };
  let physical: NativeIgnoredInputSnapshot = { complete: true, files: [] };
  let gitView = false;
  try {
    const indexArgs = ['ls-files', '--stage', '-z', '--', ...exclusions];
    const listing = await runGitCommandAsync(options.projectRoot, [
      'ls-files',
      '--stage',
      '--others',
      '--exclude-standard',
      '-t',
      '-z',
      '--',
      ...exclusions,
    ]);
    gitView = true;
    const indexed: string[] = [];
    const others: string[] = [];
    for (const entry of listing.split('\0').filter(Boolean)) {
      if (entry.startsWith('? ')) others.push(entry.slice(2));
      else if (/^[A-Z] [0-7]{6} [a-f0-9]{40}(?:[a-f0-9]{24})? [0-3]\t/su.test(entry))
        indexed.push(entry.slice(2));
      else return { complete: false, fingerprint: null };
    }
    const index = indexed.length ? indexed.join('\0') + '\0' : '';
    const untracked = others.length ? others.join('\0') + '\0' : '';
    ignored = await nativeIgnoredCheckInputSnapshot(
      options.projectRoot,
      options.plans,
      options.managedArtifactRoot,
      runnerInputs,
      `${index}\0${untracked}`,
    );
    if (index !== runGitCommand(options.projectRoot, indexArgs))
      return { complete: false, fingerprint: null };
  } catch {
    if (gitView) return { complete: false, fingerprint: null };
    physical = await nativePhysicalCheckInputSnapshot(
      options.projectRoot,
      options.plans,
      options.managedArtifactRoot,
      runnerInputs,
    );
  }
  return {
    complete: ignored.complete && physical.complete,
    fingerprint: generatedInputsFingerprint(ignored, physical, options.generatedInputExclusions),
  };
}

function generatedInputsFingerprint(
  ignored: NativeIgnoredInputSnapshot,
  physical: NativeIgnoredInputSnapshot,
  exclusions: readonly string[] = [],
) {
  const included = (ref: string) =>
    !exclusions.some((excluded) => ref === excluded || ref.startsWith(`${excluded}/`));
  return canonicalHash('comet.native.generated-inputs.v1', {
    ignored: {
      complete: ignored.complete,
      files: ignored.files.filter(({ path: ref }) => included(ref)),
    },
    physical: physical.files.filter(
      ({ path: ref }) =>
        included(ref) &&
        ref
          .split('/')
          .some((part) =>
            NATIVE_GENERATED_INPUT_DIRECTORIES.includes(
              part as (typeof NATIVE_GENERATED_INPUT_DIRECTORIES)[number],
            ),
          ),
    ),
  });
}

export async function nativeCheckInputSnapshot(
  options: NativeCheckInputOptions,
): Promise<NativeCheckInputSnapshot> {
  const runnerInputs = await nativeRunnerInputArtifactPaths(options.projectRoot);
  const exclusions = [
    ...nativeOwnedInputExclusions(options.projectRoot, options.managedArtifactRoot),
    ...[...runnerInputs].map((relative) => `:(exclude,literal)${relative}`),
  ];
  const gitSnapshot = {
    complete: true,
    capture: 'git' as 'git' | 'physical-tree',
    head: null as string | null,
    branch: null as string | null,
    status: null as string | null,
    diff: null as Array<{ path: string; digest: string | null }> | null,
    stagedDiff: null as string | null,
    submodules: null as string | null,
    untracked: [] as Array<{ path: string; digest: string | null; size: number | null }>,
    ignored: { complete: true, files: [] } as NativeIgnoredInputSnapshot,
    physical: { complete: true, files: [] } as NativeIgnoredInputSnapshot,
    // An incomplete snapshot is represented deterministically. The fast gate
    // below remains null in that case, which forces a fresh check execution;
    // adding a random nonce here would make every retry look like a source edit
    // and return a stable workspace to Build forever.
    reuseNonce: null as string | null,
  };
  let stableGitView = false;
  let submodulesQuery: Promise<string | null> | undefined;
  try {
    const head = nativeGitHead(options.projectRoot);
    gitSnapshot.head = head.head;
    stableGitView = true;
    gitSnapshot.branch = head.branch;
    // Staged content binds through index blob ids: `ls-files --stage` names each
    // path with its object id, which Git already defines as the content hash.
    const queries = await Promise.allSettled([
      nativeGitQueries(options.projectRoot, [
        ['ls-files', '--stage', '-z', '--', ...exclusions],
        ['diff', '--name-only', '--ignore-submodules=none', '-z', 'HEAD', '--', ...exclusions],
      ]),
      readGitStatusPorcelainAsync(options.projectRoot, exclusions),
    ]);
    const failure = queries.find((query) => query.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const [stagedIndex, changedOutput] = (queries[0] as PromiseFulfilledResult<string[]>).value;
    const status = (queries[1] as PromiseFulfilledResult<string>).value;
    // 指纹保留历史 trim 行为；路径解析使用同次读取的完整原文。
    gitSnapshot.status = status.trim();
    gitSnapshot.stagedDiff = digestNativeCheckInput(stagedIndex);
    gitSnapshot.submodules = '';
    if (hasGitlinksInIndex(stagedIndex)) {
      submodulesQuery = runGitCommandAsync(options.projectRoot, [
        'submodule',
        'status',
        '--recursive',
      ]).catch(() => {
        // 聚合仓可以只有 gitlink 而没有 .gitmodules；实际子仓仍在下方逐一读取。
        return null;
      });
    }
    const gitlinks = new Map<string, string>();
    const gitlinkBudget = { repositories: new Set<string>(), indexBytes: 0 };
    for (const [relative] of parseGitlinksInIndex(stagedIndex)) {
      try {
        gitlinks.set(
          relative,
          (await readNativeCheckGitlink(options.projectRoot, relative, gitlinkBudget, 0, true))
            .digest,
        );
      } catch {
        gitSnapshot.complete = false;
      }
    }
    // The working-tree binding no longer digests a full `diff --binary` stream
    // (megabytes of patch text on large trees). HEAD is bound separately, so
    // naming the changed paths and hashing each one pins the same information:
    // any working-tree difference changes the path set or one of the digests.
    const changed = changedOutput.split('\0').filter(Boolean).sort();
    gitSnapshot.diff = await mapWithConcurrency(changed, 16, async (relative) => {
      try {
        const digest =
          gitlinks.get(relative) ??
          (await nativeCheckWorkingTreeDigest(options.projectRoot, relative));
        return { path: relative, digest };
      } catch {
        return { path: relative, digest: null };
      }
    });
    if (gitSnapshot.diff.some(({ digest }) => digest === null)) {
      gitSnapshot.complete = false;
    }
    const untracked = parseGitStatusUntrackedPaths(status);
    gitSnapshot.untracked = await mapWithConcurrency(untracked, 16, async (relative) => {
      const target = path.resolve(options.projectRoot, ...relative.split('/'));
      try {
        const { digest, size } = await digestNativeInputFileContent(target);
        return { path: relative, digest, size };
      } catch {
        return { path: relative, digest: null, size: null };
      }
    });
    if (gitSnapshot.untracked.some(({ digest }) => digest === null)) {
      gitSnapshot.complete = false;
    }
    gitSnapshot.ignored = await nativeIgnoredCheckInputSnapshot(
      options.projectRoot,
      options.plans,
      options.managedArtifactRoot,
      runnerInputs,
      `${stagedIndex}\0${untracked.join('\0')}`,
    );
    if (!gitSnapshot.ignored.complete) {
      gitSnapshot.complete = false;
    }
  } catch {
    // Non-Git projects still receive a candidate/tool fingerprint. They do
    // not receive a Git view, so use a bounded physical snapshot instead.
    if (stableGitView) {
      gitSnapshot.complete = false;
    } else {
      gitSnapshot.capture = 'physical-tree';
      gitSnapshot.physical = await nativePhysicalCheckInputSnapshot(
        options.projectRoot,
        options.plans,
        options.managedArtifactRoot,
        runnerInputs,
      );
      gitSnapshot.complete = gitSnapshot.physical.complete;
    }
  }
  if (submodulesQuery) gitSnapshot.submodules = await submodulesQuery;
  const diagnostics = [gitSnapshot.ignored.diagnostic, gitSnapshot.physical.diagnostic].filter(
    (entry): entry is string => Boolean(entry),
  );
  if (!gitSnapshot.complete && diagnostics.length === 0) {
    diagnostics.push('工作区输入无法完整读取或在采样时发生变化；不能复用旧检查证据');
  }
  // 诊断不进入摘要；保留旧版完整收据的比较能力，不把提示文案当成输入。
  delete gitSnapshot.ignored.diagnostic;
  delete gitSnapshot.physical.diagnostic;
  const content = {
    candidateId: options.state.builder_handoff?.candidate_id ?? null,
    shapeConfirmationHash: options.state.shape_confirmation_hash ?? null,
    acceptance: options.state.acceptance.map(({ id, source, text }) => ({ id, source, text })),
    git: gitSnapshot,
    projectRoot: path.resolve(options.projectRoot),
  };
  const fingerprint = canonicalHash('comet.native.check-input.v1', {
    ...content,
    machineId: os.hostname(),
    execPath: process.execPath,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    path: process.env.PATH ?? null,
    pathext: process.env.PATHEXT ?? null,
    // Only execution-relevant variables bind the fingerprint. Binding every
    // environment entry made any incidental variable (shell session ids, editor
    // state, timestamps) break check reuse; this mirrors the Classic manifest
    // default, which binds no environment variable unless a policy declares it.
    boundEnvironment: Object.entries(process.env)
      .filter(([key]) => NATIVE_CHECK_BOUND_ENV.has(key.toUpperCase()))
      .map(([key, value]) => [key, value ?? null] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  });
  return {
    fingerprint,
    contentFingerprint: canonicalHash('comet.native.check-content.v1', content),
    generatedInputFingerprint: generatedInputsFingerprint(
      gitSnapshot.ignored,
      gitSnapshot.physical,
      options.generatedInputExclusions,
    ),
    complete: gitSnapshot.complete,
    diagnostics,
  };
}

const NATIVE_CHECK_BOUND_ENV = new Set([
  'PATH',
  'PATHEXT',
  'NODE_OPTIONS',
  'NODE_ENV',
  'NODE_PATH',
  'LANG',
  'LC_ALL',
  'HOME',
  'USERPROFILE',
  'SYSTEMROOT',
  'COMSPEC',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
]);

function completedCheckDuration(check: NativeLocalCheckState): number {
  if (check.startedAt === null || check.completedAt === null) return 0;
  return Math.max(0, Date.parse(check.completedAt) - Date.parse(check.startedAt));
}

function boundEnvironmentEntries(): Array<[string, string | null]> {
  return Object.entries(process.env)
    .filter(([key]) => NATIVE_CHECK_BOUND_ENV.has(key.toUpperCase()))
    .map(([key, value]) => [key, (value ?? null) as string | null] as [string, string | null])
    .sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Cheap pre-gate over the full fingerprint's decisive inputs. Git observations
 * of HEAD, branch, porcelain status, and staged blob IDs plus dirty, untracked, and
 * ignored generated-input content digests cover every mutable input represented
 * by the full fingerprint. A gate hit therefore proves the full fingerprint
 * would recompute to its recorded value without hashing the clean tracked tree.
 */
interface NativeCheckInputGateOptions {
  projectRoot: string;
  candidateId: string | null;
  plans?: readonly NativeCheckPlan[];
  managedArtifactRoot?: string;
  editReviewScope?: EditReviewScope;
  shapeSemanticSnapshot?: NativeShapeSemanticSnapshot;
  legacyShapeSemanticSnapshot?: boolean;
  legacyExecutionBinding?: boolean;
  /** 仅供 Archive 排除另外绑定的事务写入和迁移材料。 */
  archiveOwnedPaths?: readonly string[];
  /** 仅重建原 Archive 事务写入前的候选；调用方仍须匹配旧摘要。 */
  legacyArchiveOverlay?: NativeLegacyArchiveOverlay;
}

const NATIVE_CHECK_GITLINK_MAX_DEPTH = 32;
const NATIVE_CHECK_GITLINK_MAX_REPOSITORIES = 256;
const NATIVE_CHECK_GITLINK_MAX_INDEX_BYTES = 8 * 1024 * 1024;

function parseGitlinksInIndex(indexOutput: string): Map<string, string> {
  const gitlinks = new Map<string, string>();
  for (const record of indexOutput.split('\0')) {
    if (!record.startsWith('160000 ')) continue;
    const match = record.match(/^160000 ([a-f0-9]{40}(?:[a-f0-9]{24})?) 0\t(.+)$/su);
    if (!match || gitlinks.has(match[2])) {
      throw new Error('Native 检查输入中的子模块索引无效或存在冲突');
    }
    gitlinks.set(match[2], match[1]);
  }
  return gitlinks;
}

async function readNativeCheckGitlink(
  projectRoot: string,
  relative: string,
  budget: { repositories: Set<string>; indexBytes: number },
  depth = 0,
  allowDirty = false,
): Promise<{ head: string; digest: string; observationHash: string }> {
  if (
    depth >= NATIVE_CHECK_GITLINK_MAX_DEPTH ||
    budget.repositories.size >= NATIVE_CHECK_GITLINK_MAX_REPOSITORIES
  ) {
    throw new Error('Native 检查输入中的子模块数量或深度超出读取上限');
  }
  const target = path.resolve(projectRoot, ...relative.split('/'));
  const [physicalRoot, realTarget, before] = await Promise.all([
    fs.realpath(projectRoot),
    fs.realpath(target),
    fs.lstat(target),
  ]);
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    realTarget === physicalRoot ||
    !isInsidePath(physicalRoot, realTarget) ||
    realTarget !== path.resolve(physicalRoot, ...relative.split('/')) ||
    budget.repositories.has(realTarget) ||
    (await fs.realpath(runGitCommand(realTarget, ['rev-parse', '--show-toplevel']))) !== realTarget
  ) {
    throw new Error('Native 检查输入中的子模块目录不可用');
  }
  budget.repositories.add(realTarget);
  const head = runGitCommand(realTarget, ['rev-parse', '--verify', 'HEAD']);
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(head)) {
    throw new Error('Native 检查输入中的子模块 HEAD 无效');
  }
  // 显式包含未跟踪文件和嵌套子模块，不能受 submodule.*.ignore 配置影响。
  const status = readGitStatusPorcelain(realTarget);
  if (status !== '' && !allowDirty)
    throw new Error(`Native 检查输入中的子模块 ${relative} 有未提交内容`);
  const index = runGitCommand(realTarget, ['ls-files', '--stage', '-z']);
  budget.indexBytes += Buffer.byteLength(index);
  if (budget.indexBytes > NATIVE_CHECK_GITLINK_MAX_INDEX_BYTES) {
    throw new Error('Native 检查输入中的子模块索引超出读取上限');
  }
  const nested: Array<{ path: string; digest: string; observationHash: string }> = [];
  let dirty = status !== '';
  for (const [childPath, objectId] of parseGitlinksInIndex(index)) {
    const child = await readNativeCheckGitlink(
      realTarget,
      childPath,
      budget,
      depth + 1,
      allowDirty,
    );
    if (!allowDirty && child.head !== objectId) {
      throw new Error('Native 检查输入中的嵌套子模块 HEAD 与索引不一致');
    }
    dirty ||= child.digest !== digestNativeCheckInput(`gitlink:${objectId}`);
    nested.push({ path: childPath, digest: child.digest, observationHash: child.observationHash });
  }
  const childPaths = new Set(nested.map((child) => child.path));
  const readWorkingTree = async () => {
    const result: Array<{ path: string; digest: string }> = [];
    for (const ref of parseGitStatusPaths(status).sort()) {
      if (childPaths.has(ref)) continue;
      result.push({ path: ref, digest: await nativeCheckWorkingTreeDigest(realTarget, ref) });
    }
    return result;
  };
  const workingTree = allowDirty ? await readWorkingTree() : [];
  const afterStatus = readGitStatusPorcelain(realTarget);
  const afterIndex = runGitCommand(realTarget, ['ls-files', '--stage', '-z']);
  const afterHead = runGitCommand(realTarget, ['rev-parse', '--verify', 'HEAD']);
  const [afterTarget, after] = await Promise.all([fs.realpath(target), fs.lstat(target)]);
  if (
    afterStatus !== status ||
    afterIndex !== index ||
    head !== afterHead ||
    realTarget !== afterTarget ||
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    (allowDirty &&
      canonicalHash('gitlink-files', workingTree) !==
        canonicalHash('gitlink-files', await readWorkingTree()))
  ) {
    throw new Error('Native 检查输入中的子模块有未提交内容或在读取时变化');
  }
  return {
    head,
    digest: dirty
      ? canonicalHash('comet.native.dirty-gitlink.v1', {
          head,
          index,
          status,
          workingTree,
          nested: nested.map(({ path, digest }) => ({ path, digest })),
        })
      : digestNativeCheckInput(`gitlink:${head}`),
    // 仅比较本次前后采样；持久摘要仍由干净的顶层 HEAD 传递绑定嵌套提交。
    observationHash: canonicalHash('comet.native.check-gitlink-observation.v1', {
      head,
      index: digestNativeCheckInput(index),
      realTarget,
      ino: after.ino,
      dev: after.dev,
      nested,
      workingTree,
    }),
  };
}

async function readNativeCheckInputObservation(
  options: NativeCheckInputGateOptions,
  allowDirty = false,
) {
  try {
    const runnerInputs = await nativeRunnerInputArtifactPaths(options.projectRoot);
    const exclusions = [
      ...nativeOwnedInputExclusions(options.projectRoot, options.managedArtifactRoot),
      ...(options.archiveOwnedPaths ?? []).map((ref) => `:(exclude,literal)${ref}`),
      ...[...runnerInputs].map((relative) => `:(exclude,literal)${relative}`),
    ];
    const queries = await Promise.allSettled([
      readGitStatusObservationAsync(options.projectRoot, exclusions),
      runGitCommandAsync(options.projectRoot, ['ls-files', '--stage', '-z', '--', ...exclusions]),
    ]);
    const failure = queries.find((query) => query.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const {
      head,
      branch,
      status: actualStatus,
    } = (queries[0] as PromiseFulfilledResult<{ head: string; branch: string; status: string }>)
      .value;
    const staged = (queries[1] as PromiseFulfilledResult<string>).value;
    const status = options.legacyArchiveOverlay
      ? nativeLegacyArchiveGitStatus(
          options.projectRoot,
          actualStatus,
          options.legacyArchiveOverlay,
        )
      : actualStatus;
    if (head === null || status === null) return null;
    const changedPaths = parseGitStatusPaths(status).filter(
      (changedPath) =>
        !runnerInputs.has(changedPath) &&
        !isNativeOwnedInputPath(changedPath, options.projectRoot, options.managedArtifactRoot),
    );
    const gitlinks = new Map<string, Awaited<ReturnType<typeof readNativeCheckGitlink>>>();
    const beforeGitlinkBudget = { repositories: new Set<string>(), indexBytes: 0 };
    for (const [relative, objectId] of parseGitlinksInIndex(staged)) {
      const observed = await readNativeCheckGitlink(
        options.projectRoot,
        relative,
        beforeGitlinkBudget,
        0,
        allowDirty,
      );
      // 未初始化的子模块可能不出现在 status 中，仍须核对子仓库身份与 HEAD。
      if (!changedPaths.includes(relative) && observed.head !== objectId) return null;
      gitlinks.set(relative, observed);
    }
    const workingTree: Array<{ path: string; digest: string | null }> = [];
    for (const changedPath of changedPaths) {
      let digest: string | null = null;
      try {
        const virtual = options.legacyArchiveOverlay?.get(changedPath);
        if (virtual?.text === null) return null;
        digest = virtual
          ? digestNativeCheckInput((virtual.bytes ?? Buffer.from(virtual.text!)).toString('base64'))
          : (gitlinks.get(changedPath)?.digest ??
            (await nativeCheckWorkingTreeDigest(options.projectRoot, changedPath)));
      } catch {
        // 无法完整读取的工作区输入不能用于快速复用。
        return null;
      }
      workingTree.push({ path: changedPath, digest });
    }
    const afterGitlinkBudget = { repositories: new Set<string>(), indexBytes: 0 };
    for (const [relative, before] of gitlinks) {
      const after = await readNativeCheckGitlink(
        options.projectRoot,
        relative,
        afterGitlinkBudget,
        0,
        allowDirty,
      );
      if (after.observationHash !== before.observationHash) return null;
    }
    workingTree.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    return {
      runnerInputs,
      binding: {
        candidateId: options.candidateId,
        head,
        branch,
        // Porcelain names dirty files but does not bind their working-tree bytes.
        // Hash every dirty path so editing an already-dirty tracked file cannot
        // falsely hit the pre-gate.
        status,
        staged,
        workingTree,
        projectRoot: path.resolve(options.projectRoot),
        machineId: os.hostname(),
        execPath: process.execPath,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        boundEnvironment: boundEnvironmentEntries(),
      },
    };
  } catch {
    return null;
  }
}

async function nativeCheckGateFromObservation(
  options: NativeCheckInputGateOptions,
  observation: Awaited<ReturnType<typeof readNativeCheckInputObservation>>,
): Promise<string | null> {
  if (observation === null) return null;
  try {
    const ignored = await nativeIgnoredCheckInputSnapshot(
      options.projectRoot,
      options.plans ?? [],
      options.managedArtifactRoot,
      observation.runnerInputs,
      `${observation.binding.staged}\0${observation.binding.workingTree.map(({ path }) => path).join('\0')}`,
    );
    return ignored.complete
      ? canonicalHash('comet.native.check-input-gate.v1', { ...observation.binding, ignored })
      : null;
  } catch {
    return null;
  }
}

export async function nativeCheckInputGate(
  options: NativeCheckInputGateOptions,
): Promise<string | null> {
  return nativeCheckGateFromObservation(options, await readNativeCheckInputObservation(options));
}

async function nativeCandidateCommentGate(
  options: NativeCheckInputGateOptions,
  observation: Awaited<ReturnType<typeof readNativeCheckInputObservation>>,
): Promise<string | null> {
  const { nativeSourceCommentFingerprint, supportsNativeSourceComments } =
    await import('./native-source-comments.js');
  if (!observation) {
    try {
      // 非 Git 工作区也比较实际源码；不完整读取不能证明候选未变。
      const runnerInputs = await nativeRunnerInputArtifactPaths(options.projectRoot);
      const physical = await nativePhysicalCheckInputSnapshot(
        options.projectRoot,
        options.plans ?? [],
        options.managedArtifactRoot,
        runnerInputs,
        'candidate',
      );
      if (!physical.complete) return null;
      if (options.legacyArchiveOverlay) {
        const files = new Map(physical.files.map((file) => [file.path, file]));
        for (const [ref, original] of options.legacyArchiveOverlay) {
          if (original.text === null) files.delete(ref);
          else if (
            (options.plans?.length ? options.plans.map(({ cwdRef }) => cwdRef) : ['.']).some(
              (cwd) => cwd === '.' || ref === cwd || ref.startsWith(`${cwd}/`),
            ) &&
            !ref
              .split('/')
              .slice(0, -1)
              .some((part) => NATIVE_PHYSICAL_INPUT_EXCLUDED_DIRECTORIES.has(part)) &&
            !isNativeOwnedInputPath(ref, options.projectRoot, options.managedArtifactRoot)
          )
            files.set(ref, {
              path: ref,
              digest: digestNativeCheckInput(
                (original.bytes ?? Buffer.from(original.text)).toString('base64'),
              ),
              size: original.bytes?.length ?? Buffer.byteLength(original.text),
            });
        }
        physical.files = [...files.values()].sort((left, right) =>
          left.path.localeCompare(right.path, 'en'),
        );
      }
      observation = {
        runnerInputs,
        binding: {
          candidateId: options.candidateId,
          head: '',
          branch: '',
          status: '',
          staged: '',
          workingTree: physical.files
            .filter(
              ({ path: ref }) =>
                !(options.archiveOwnedPaths ?? []).some(
                  (owned) => ref === owned || ref.startsWith(`${owned}/`),
                ),
            )
            .map(({ path, digest }) => ({ path, digest })),
          projectRoot: path.resolve(options.projectRoot),
          machineId: os.hostname(),
          execPath: process.execPath,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          boundEnvironment: boundEnvironmentEntries(),
        },
      };
    } catch {
      return null;
    }
  }
  const unchangedPaths = new Set<string>();
  const workingTree: typeof observation.binding.workingTree = [];
  const index = new Map(
    observation.binding.staged.split('\0').flatMap((record) => {
      const match = record.match(/^(100644|100755|160000) ([a-f0-9]+) 0\t(.+)$/su);
      return match ? [[match[3], { mode: match[1], objectId: match[2] }] as const] : [];
    }),
  );
  const config = await readProjectConfig(options.projectRoot);
  const reviews = options.editReviewScope ? await inspectEditReviews(options.editReviewScope) : [];
  for (let offset = 0; offset < observation.binding.workingTree.length; offset += 64) {
    const batch = observation.binding.workingTree.slice(offset, offset + 64);
    let indexedBlobs: Map<string, string>;
    try {
      indexedBlobs = readGitBlobs(
        options.projectRoot,
        batch.flatMap((entry) => {
          const indexed = index.get(entry.path);
          return indexed && indexed.mode !== '160000' ? [indexed.objectId] : [];
        }),
      );
    } catch {
      return null;
    }
    for (const entry of batch) {
      if (index.get(entry.path)?.mode === '160000') {
        workingTree.push(entry);
        continue;
      }
      if (
        config?.native.document_writes !== 'revert' &&
        isNeutralDocumentPath(entry.path, [
          '.comet',
          ...(options.managedArtifactRoot
            ? [
                path
                  .relative(options.projectRoot, path.join(options.managedArtifactRoot, 'comet'))
                  .replaceAll('\\', '/'),
              ]
            : []),
        ])
      ) {
        unchangedPaths.add(entry.path);
        continue;
      }
      if (!supportsNativeSourceComments(entry.path) && !options.editReviewScope) {
        workingTree.push(entry);
        continue;
      }
      try {
        const virtual = options.legacyArchiveOverlay?.get(entry.path);
        if (virtual?.bytes && !Buffer.from(virtual.text ?? '').equals(virtual.bytes))
          throw new Error('旧 Archive 二进制材料沿用原始字节摘要');
        const source =
          virtual?.text != null
            ? { text: virtual.text }
            : await readNativeBoundedTextFile({
                root: options.projectRoot,
                ref: entry.path,
              });
        if (digestNativeCheckInput(Buffer.from(source.text).toString('base64')) !== entry.digest)
          return null;
        const reviewed = options.editReviewScope
          ? await approvedEditFingerprint(options.editReviewScope, entry.path, source.text, reviews)
          : null;
        const shapeArtifact = options.shapeSemanticSnapshot?.artifacts.find(
          (artifact) =>
            options.managedArtifactRoot &&
            options.editReviewScope &&
            path
              .relative(
                options.projectRoot,
                path.join(
                  options.managedArtifactRoot,
                  'comet',
                  'changes',
                  options.editReviewScope.change,
                  artifact.source,
                ),
              )
              .replaceAll('\\', '/') === entry.path,
        );
        if (shapeArtifact) {
          const current = nativeShapeArtifactSnapshot(shapeArtifact.source, source.text);
          const effective =
            reviewed &&
            options.editReviewScope &&
            (await nativeShapeReviewAnchorMatches(
              options.editReviewScope,
              shapeArtifact,
              reviewed.beforeHash,
            ))
              ? { ...current, commentsHash: shapeArtifact.commentsHash }
              : current;
          if (
            nativeShapeArtifactContractHash(effective) ===
            nativeShapeArtifactContractHash(shapeArtifact)
          ) {
            const indexed = index.get(entry.path);
            const mode =
              virtual?.mode ?? (await fs.lstat(path.resolve(options.projectRoot, entry.path))).mode;
            const executable = process.platform === 'win32' ? false : Boolean(mode & 0o111);
            const indexedSource = indexed && indexedBlobs.get(indexed.objectId);
            if (
              indexed &&
              indexedSource !== undefined &&
              (options.legacyShapeSemanticSnapshot && shapeArtifact.legacyFingerprint !== null
                ? nativeSourceCommentFingerprint(entry.path, indexedSource) ===
                  shapeArtifact.legacyFingerprint
                : digestNativeCheckInput(indexedSource) === shapeArtifact.contentHash) &&
              (process.platform === 'win32' || executable === (indexed.mode === '100755'))
            ) {
              unchangedPaths.add(entry.path);
              continue;
            }
            workingTree.push({
              path: entry.path,
              digest: options.legacyShapeSemanticSnapshot
                ? shapeArtifact.legacyFingerprint
                  ? canonicalHash('comet.native.comment-source.v1', {
                      fingerprint: shapeArtifact.legacyFingerprint,
                      executable,
                    })
                  : shapeArtifact.inputHash
                : canonicalHash('comet.native.shape-candidate-artifact.v1', {
                    contentHash: shapeArtifact.contentHash,
                    executable,
                  }),
            });
            continue;
          }
        }
        const fingerprint =
          reviewed?.fingerprint ?? nativeSourceCommentFingerprint(entry.path, source.text);
        if (!fingerprint) {
          workingTree.push(entry);
          continue;
        }
        const indexed = index.get(entry.path);
        if (indexed) {
          const mode =
            virtual?.mode ?? (await fs.lstat(path.resolve(options.projectRoot, entry.path))).mode;
          // chmod、重命名和删除仍需新候选，不能被注释判定掩盖。
          const modeMatches =
            process.platform === 'win32' || Boolean(mode & 0o111) === (indexed.mode === '100755');
          const indexedSource = indexedBlobs.get(indexed.objectId);
          if (indexedSource === undefined) {
            workingTree.push(entry);
            continue;
          }
          if (
            modeMatches &&
            (reviewed
              ? digestNativeCheckInput(indexedSource) === reviewed.beforeHash
              : nativeSourceCommentFingerprint(entry.path, indexedSource) === fingerprint)
          ) {
            unchangedPaths.add(entry.path);
            continue;
          }
        }
        const mode =
          virtual?.mode ?? (await fs.lstat(path.resolve(options.projectRoot, entry.path))).mode;
        workingTree.push({
          path: entry.path,
          digest:
            reviewed && !reviewed.semantic
              ? fingerprint
              : canonicalHash('comet.native.comment-source.v1', {
                  fingerprint,
                  executable: process.platform === 'win32' ? false : Boolean(mode & 0o111),
                }),
        });
      } catch {
        // 二进制、大文件及不支持的语法沿用真实内容绑定。
        workingTree.push(entry);
      }
    }
  }
  const status = observation.binding.status
    .split('\0')
    .filter((record) => {
      if (config?.native.document_writes !== 'revert') {
        const ref = record.length >= 4 ? record.slice(3) : '';
        if (
          unchangedPaths.has(ref) &&
          isNeutralDocumentPath(ref, ['.comet', ...(options.editReviewScope?.formalPrefixes ?? [])])
        )
          return false;
      }
      const match = record.trimStart().match(/^M (.+)$/u);
      return !match || !unchangedPaths.has(match[1]);
    })
    .join('\0')
    .trim();
  // 执行环境仍绑定检查收据；候选语义只绑定实现，环境变化可重跑检查。
  const { boundEnvironment: _environment, ...candidateBinding } = observation.binding;
  void _environment;
  return canonicalHash(
    options.legacyExecutionBinding
      ? 'comet.native.candidate-comment-gate.v1'
      : 'comet.native.candidate-comment-gate.v2',
    {
      ...(options.legacyExecutionBinding ? observation.binding : candidateBinding),
      status,
      workingTree,
    },
  );
}

/** Share only the reservation's observation; checks and later requests still capture fresh inputs. */
async function nativeCheckInputGates(options: NativeCheckInputGateOptions) {
  const observation = await readNativeCheckInputObservation(options);
  return {
    branch:
      observation === null
        ? currentBranch(options.projectRoot)
        : observation.binding.branch || null,
    gate: await nativeCheckGateFromObservation(options, observation),
    candidateGate: await nativeCandidateCommentGate(
      options,
      observation ?? (await readNativeCheckInputObservation(options, true)),
    ),
  };
}

export async function nativeCandidateInputGate(
  options: NativeCheckInputGateOptions,
): Promise<string | null> {
  return nativeCandidateCommentGate(options, await readNativeCheckInputObservation(options, true));
}

export function authoritativePortableChecks(options: {
  local: NativeLocalExecutionState;
  projectRoot: string;
  supplied: readonly NativePortableCheckSummary[];
  requestedNames?: ReadonlyMap<string, string>;
}): NativePortableCheckSummary[] {
  const suppliedById = new Map<string, NativePortableCheckSummary>();
  for (const check of options.supplied) {
    if (suppliedById.has(check.id)) {
      throw new Error(`Native Runtime check summaries contain duplicate ID ${check.id}`);
    }
    suppliedById.set(check.id, check);
  }
  return options.local.checks.map((check) => {
    if (check.status === 'planned' || check.status === 'running') {
      throw new Error(`Native Runtime check ${check.id} has not completed`);
    }
    if (check.status === 'passed' && (check.evidence !== 'runtime' || !check.evidenceDigest)) {
      throw new Error(`Native Runtime check ${check.id} has no Runtime execution evidence`);
    }
    const name = options.requestedNames?.get(check.id) ?? check.name;
    return {
      id: check.id,
      name: toNativePortableText(name),
      argv_display: nativePortableArgvDisplay(check.argv.slice(1)).map((entry) =>
        toNativePortableText(entry),
      ),
      argv_truncated: false,
      cwd_ref: localCheckCwdRef(options.projectRoot, check.cwd),
      status: check.status,
      exit_code: check.exitCode,
      duration_ms: completedCheckDuration(check),
    };
  });
}

function requestCheckPlan(request: NativeVerifierCheckRequest): NativeCheckPlan {
  return {
    id: request.id,
    name: request.name,
    executable: request.executable,
    argv: [...request.argv],
    cwdRef: request.cwdRef,
    timeoutMs: request.timeoutMs,
    repeatable: request.repeatable,
  };
}

export async function persistVerifierExecutionError(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  summary: string;
}): Promise<NativePortableState> {
  const local = await readCurrentLocalExecution({ paths: options.paths, state: options.state });
  const next = recordNativeVerifierExecutionError({
    state: options.state,
    summary: options.summary,
  });
  const action = currentNativeVerifierAction(options.state, local);
  const executionRef = nativeVerifierActionExecutionRef(action);
  if (executionRef)
    next.verifier_action = completeNativeVerifierAction({
      action,
      executionRef,
      response: { kind: 'execution-error', summary: options.summary },
      status: 'failed',
    }).action;
  const written = await writePortableMutation({
    paths: options.paths,
    previous: options.state,
    next,
  });
  await writeNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, options.state.name),
    preservedLocalChecksForVersion({
      local,
      state: written,
      projectRoot: options.paths.projectRoot,
    }),
    { containedRoot: options.paths.runtimeDir },
  );
  return written;
}

async function hasNativeRuntimeCheckEvidence(
  local: NativeLocalExecutionState,
  runtimeDir: string,
): Promise<boolean> {
  for (const check of local.checks) {
    if (check.status !== 'passed') continue;
    if (check.evidence !== 'runtime') return false;
    try {
      const logFile = await resolveContainedNativePath(
        runtimeDir,
        path.resolve(runtimeDir, ...check.log.split(/[\\/]/u)),
      );
      if (!(await fs.stat(logFile)).isFile()) return false;
      const logContent = await fs.readFile(logFile, 'utf8');
      if (
        !check.evidenceDigest ||
        check.evidenceDigest !== nativeLocalCheckEvidenceDigest(check, logContent)
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Rebind completed evidence only after proving the new candidate has identical inputs. */
export async function rebindNativeCheckEvidence(options: {
  paths: NativeProjectPaths;
  previous: NativePortableState;
  next: NativePortableState;
  local: NativeLocalExecutionState | null;
  plans: readonly NativeCheckPlan[];
  projectRoot?: string;
}): Promise<NativeLocalExecutionState | null> {
  const { local, previous, next, plans, paths } = options;
  if (
    local?.rawInputRef &&
    previous.shape_confirmation_hash === next.shape_confirmation_hash &&
    path.resolve(local.workspace.projectRoot) ===
      path.resolve(options.projectRoot ?? paths.projectRoot)
  )
    return {
      ...preservedLocalChecksForVersion({
        local,
        state: next,
        projectRoot: options.projectRoot ?? paths.projectRoot,
      }),
      candidateId: next.builder_handoff!.candidate_id,
    };
  if (
    !local ||
    !local.checks.length ||
    local.checks.some(({ status }) => status !== 'passed') ||
    local.basedOnStateVersion !== previous.state_version ||
    local.candidateId !== previous.builder_handoff?.candidate_id ||
    local.workspace.machineId !== os.hostname() ||
    local.inputFingerprint == null ||
    local.inputFingerprintGate == null ||
    (local.execution?.stage === 'checking' && local.execution.status === 'running') ||
    previous.shape_confirmation_hash !== next.shape_confirmation_hash ||
    JSON.stringify(previous.acceptance.map(({ id, source, text }) => ({ id, source, text }))) !==
      JSON.stringify(next.acceptance.map(({ id, source, text }) => ({ id, source, text })))
  )
    return null;
  const projectRoot = local.workspace.worktreeRoot;
  if (
    path.resolve(local.workspace.projectRoot) !==
      path.resolve(options.projectRoot ?? paths.projectRoot) ||
    path.resolve(projectRoot) !== path.resolve(options.projectRoot ?? paths.projectRoot)
  )
    return null;
  try {
    if (
      local.workspace.branch !== currentBranch(projectRoot) ||
      !sameNativeCheckCommands(local, plans, projectRoot)
    )
      return null;
    if (
      !(await hasNativeRuntimeCheckEvidence(
        local,
        nativePreferredChangeRuntimeDir(paths, next.name),
      ))
    )
      return null;
    const oldBinding = {
      projectRoot,
      candidateId: local.candidateId ?? null,
      plans,
      managedArtifactRoot: paths.artifactRoot,
    };
    const oldGate = await nativeCheckInputGate(oldBinding);
    if (oldGate === null || oldGate !== local.inputFingerprintGate) return null;
    const fingerprint = await nativeCheckInputFingerprint({
      state: next,
      projectRoot,
      plans,
      managedArtifactRoot: paths.artifactRoot,
    });
    const gates = await nativeCheckInputGates({
      ...oldBinding,
      candidateId: next.builder_handoff!.candidate_id,
      editReviewScope: nativeEditReviewScope(paths, next),
      shapeSemanticSnapshot: (await readNativeApprovedShapeSemanticSnapshot({ paths, state: next }))
        ?.snapshot,
      legacyShapeSemanticSnapshot: next.shape_semantic_snapshot === undefined,
    });
    // The full capture must not adopt a source edit that happened while rebinding.
    if (
      gates.gate === null ||
      gates.candidateGate === null ||
      (await nativeCheckInputGate(oldBinding)) !== oldGate
    )
      return null;
    return {
      ...preservedLocalChecksForVersion({ local, state: next, projectRoot: paths.projectRoot }),
      candidateId: next.builder_handoff!.candidate_id,
      inputFingerprint: fingerprint,
      inputFingerprintGate: gates.gate,
      candidateInputFingerprintGate: gates.candidateGate,
    };
  } catch {
    // Incomplete or unavailable evidence requires execution, never blocks a new candidate.
    return null;
  }
}

async function reserveNativeRawCheckPlanLocked(
  options: Parameters<typeof reserveNativePortableCheckPlan>[0],
  state: NativePortableState,
  inputLocal: NativeLocalExecutionState,
): Promise<Awaited<ReturnType<typeof reserveNativePortableCheckPlan>>> {
  let local = inputLocal;
  if (local.execution?.stage === 'checking' && local.execution.status === 'running') {
    if ((await inspectNativePortableCheckExecution(local)) !== 'orphaned')
      throw new Error('原检查仍运行或结果不明；继续原执行，不能重复副作用');
    local = interruptNativePortableCheckExecution(local);
  }
  const current = await nativeRawInputSnapshot({
    projectRoot: options.projectRoot,
    managedArtifactRoot: options.paths.artifactRoot,
    previous: await portableRawSnapshot(options.paths, state, local.rawInputRef!),
  });
  await assertNativePortableRawCandidate(options.paths, state, local, current);
  const refresh = options.archiveRefresh;
  const operationId = refresh
    ? canonicalHash('comet.native.check-refresh.v1', { name: state.name, ...refresh })
    : randomUUID();
  if (refresh) {
    if (
      state.phase !== 'archive' ||
      state.status !== 'active' ||
      state.archived ||
      state.children_contract_hash ||
      state.verification_result !== 'pass' ||
      refresh.expectedStateVersion !== state.state_version ||
      !Array.isArray(refresh.checkIds) ||
      !refresh.checkIds.length ||
      new Set(refresh.checkIds).size !== refresh.checkIds.length ||
      !refresh.summary?.trim() ||
      !refresh.sourceExecutions ||
      Object.keys(refresh).sort().join(',') !==
        'checkIds,expectedStateVersion,observationRef,reportSha256,sourceExecutions,summary'
    )
      throw new Error('补充检查必须绑定当前已接受候选、原报告及明确检查 ID');
    const transaction = await readNativePortableTransaction(options.paths, {
      change: state.name,
      kind: 'archive',
    });
    if (
      transaction &&
      (transaction.kind !== 'archive' ||
        !['prepared', 'specs-applied'].includes(transaction.journal.status))
    )
      throw new Error('原归档事务已越过可补检查阶段；先核对原事务，不能重放归档副作用');
    const report = await readNativeBoundedTextFile({
      root: options.paths.changesDir,
      ref: `${state.name}/verification.md`,
      maxBytes: null,
    });
    if (
      report.hash !== refresh.reportSha256 ||
      report.text !== renderNativeVerificationReport(state)
    )
      throw new Error('原验收报告已变化，不能沿用原接受结果补检查');
    const observed = await portableRawSnapshot(options.paths, state, refresh.observationRef);
    if (
      !observed.complete ||
      observed.contentHash !== current.contentHash ||
      observed.contextHash !== current.contextHash ||
      hashRuntimeValue(observed.repositories as unknown as RuntimeValue) !==
        hashRuntimeValue(current.repositories as unknown as RuntimeValue)
    )
      throw new Error('补充检查的输入观察已变化，由当前 Agent 只补判断新增变化');
    await assertEditReviewsComplete(nativeEditReviewScope(options.paths, state));
    const selected = refresh.checkIds.map((id) => local.checks.find((check) => check.id === id));
    if (selected.some((check) => !check || !check.repeatable || !check.rawInput))
      throw new Error('只能补原计划中可重复且有真实输入记录的检查');
    if (
      selected.every(
        (check) =>
          nativePortableCheckExecutionRef(check!) === `native-check:${operationId}` &&
          ['passed', 'failed'].includes(check!.status),
      )
    )
      return {
        kind: 'reuse',
        state,
        checks: authoritativePortableChecks({
          local,
          projectRoot: options.projectRoot,
          supplied: [],
        }),
      };
    if (
      selected.some(
        (check) => nativePortableCheckExecutionRef(check!) !== refresh.sourceExecutions[check!.id],
      )
    )
      throw new Error('原检查执行已更新；不重放旧请求，读取当前输入观察');
  }
  const execute: NativeCheckPlan[] = [];
  const checks: NativeLocalCheckState[] = [];
  const irreversiblePlans = nativePortableCheckPlansFromLocal(local).filter(
    (plan) =>
      !plan.repeatable &&
      local.checks.some((check) => check.id === plan.id && check.executionCount > 0),
  );
  const retry = options.retryCheckIds ? new Set(options.retryCheckIds) : null;
  if (
    retry &&
    (!retry.size ||
      [...retry].some(
        (id) => !local.checks.some((check) => check.id === id && check.status === 'interrupted'),
      ))
  )
    throw new Error('重试 ID 必须对应当前中断的原检查');
  for (const plan of options.plans) {
    const key = nativeCheckPlanKey(plan);
    const sameId = local.checks.find((check) => check.id === plan.id);
    if (sameId && nativeLocalCheckPlanKey(sameId, options.projectRoot) !== key)
      throw new Error(`Native 检查 ${plan.id} 与原命令定义冲突；保留原执行记录`);
    const old =
      sameId ??
      local.checks.find((check) => nativeLocalCheckPlanKey(check, options.projectRoot) === key);
    if (old && old.id !== plan.id)
      throw new Error(`Native 检查 ${plan.id} 是原检查 ${old.id} 的别名；继续原检查，不能重复执行`);
    if (
      !old &&
      irreversiblePlans.some(
        (original) => nativeCheckInvocationKey(original) === nativeCheckInvocationKey(plan),
      )
    )
      throw new Error(
        `Native 检查 ${plan.id} 与已执行的不可重复命令相同；不能用新的 ID 或重试标记重放`,
      );
    const applicable =
      old && (await portableRawCheckApplicable(options.paths, state, old, current));
    const valid =
      old &&
      (await hasNativeRuntimeCheckEvidence(
        { ...local, checks: [old] },
        nativePreferredChangeRuntimeDir(options.paths, state.name),
      ));
    if (
      old &&
      !refresh?.checkIds.includes(old.id) &&
      ((old.status === 'passed' && applicable && valid) ||
        (old.status === 'failed' && applicable) ||
        (old.status === 'interrupted' && retry && !retry.has(old.id)))
    ) {
      checks.push(old);
      continue;
    }
    if (old && old.executionCount > 0 && !old.repeatable)
      throw new Error(
        `检查 ${old.id} 不可重复执行，当前输入也没有有效保留判断；保留原结果并确定后续验证方式`,
      );
    if (old?.status === 'interrupted' && old.executionCount >= 3)
      throw new Error(`Native check retry limit (3) reached: ${old.id}`);
    execute.push(plan);
    checks.push(
      old
        ? resetNativeCheckForExecution(old, plan, operationId, options.projectRoot)
        : localCheck(plan, operationId, options.projectRoot),
    );
  }
  for (const previous of local.checks)
    if (!checks.some((check) => check.id === previous.id)) checks.push(previous);
  if (!execute.length)
    return {
      kind: 'reuse',
      state,
      checks: authoritativePortableChecks({
        local: { ...local, checks },
        projectRoot: options.projectRoot,
        supplied: [],
      }),
    };
  if (local.execution?.stage === 'verifying' && local.execution.status === 'running')
    throw new Error(
      '保留当前 Verifier；由其使用 request-checks 只请求受影响检查，不能另起检查轮次',
    );
  const ownerIdentity = await readProcessIdentity(process.pid);
  const operation: NativeLocalExecutionState = {
    ...local,
    basedOnStateVersion: state.state_version,
    candidateId: state.builder_handoff!.candidate_id,
    workspace: {
      ...local.workspace,
      machineId: os.hostname(),
      branch: currentBranch(options.projectRoot),
    },
    execution: {
      operationId,
      stage: 'checking',
      actor: 'runtime',
      executionId: null,
      status: 'running',
      startedAt: new Date().toISOString(),
      requestCheckRounds: 0,
      ownerPid: process.pid,
      ...(ownerIdentity ? { ownerIdentity } : {}),
    },
    checks: checks.map((check) => ({ ...check, operationId })),
  };
  await writeNativeLocalExecution(nativeLocalExecutionFile(options.paths, state.name), operation, {
    containedRoot: options.paths.runtimeDir,
  });
  return { kind: 'execute', state, local: operation, plans: execute, inputDiagnostics: [] };
}

async function reserveNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  plans: NativeCheckPlan[];
  projectRoot: string;
  retryCheckIds?: readonly string[];
  archiveRefresh?: NativePortableCheckRefreshInput;
}): Promise<
  | {
      kind: 'execute';
      state: NativePortableState;
      local: NativeLocalExecutionState;
      plans: NativeCheckPlan[];
      inputDiagnostics: string[];
    }
  | { kind: 'reuse'; state: NativePortableState; checks: NativePortableCheckSummary[] }
> {
  return withNativeMutationLock(
    options.paths,
    `reserve portable checks ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      if (
        (state.phase !== 'verify' || state.loop.stage !== 'verify-ready') &&
        !(state.phase === 'archive' && options.archiveRefresh)
      ) {
        throw new Error('Native checks require Verify ready state');
      }
      const rawLocal = state.builder_handoff?.raw_input_ref
        ? await readCurrentLocalExecution({ paths: options.paths, state })
        : await readNativeLocalExecution(nativeLocalExecutionFile(options.paths, state.name));
      if (rawLocal?.rawInputRef) return reserveNativeRawCheckPlanLocked(options, state, rawLocal);
      const shapeEvidence = await readNativeApprovedShapeSemanticSnapshot({
        paths: options.paths,
        state,
      });
      const {
        gate,
        candidateGate,
        branch: observedBranch,
      } = await nativeCheckInputGates({
        projectRoot: options.projectRoot,
        candidateId: state.builder_handoff?.candidate_id ?? null,
        plans: options.plans,
        managedArtifactRoot: options.paths.artifactRoot,
        editReviewScope: nativeEditReviewScope(options.paths, state),
        shapeSemanticSnapshot: shapeEvidence?.snapshot,
        legacyShapeSemanticSnapshot: !state.shape_semantic_snapshot && Boolean(shapeEvidence),
      });
      let branch = observedBranch;
      const file = nativeLocalExecutionFile(options.paths, state.name);
      let local = (
        await readOrRebuildNativeLocalExecution({
          file,
          portableState: state,
          projectRoot: options.projectRoot,
          branch,
          containedRoot: options.paths.runtimeDir,
        })
      ).state;
      // Older overlays use symbolic-ref's disambiguated short name when a tag
      // shares the branch name. Keep that binding without a second probe on
      // the ordinary path. The gate continues to bind the actual branch name.
      if (branch !== null && local.workspace.branch === `heads/${branch}`) {
        branch = currentBranch(options.projectRoot);
      }
      // 快速摘要不可用时重新捕获完整输入。非 Git 项目仍可用完整的物理快照；
      // 真正不完整的快照不能因为其确定性摘要相同而复用旧结果。
      // Reuse decides before the full fingerprint: a matching gate already
      // binds dirty, untracked and ignored generated inputs, so only the clean
      // tracked-tree work in the full fingerprint remains safely skippable.
      const gateBindingMatches =
        gate !== null &&
        local.inputFingerprint !== null &&
        local.inputFingerprintGate === gate &&
        local.candidateInputFingerprintGate === candidateGate &&
        local.candidateId === state.builder_handoff?.candidate_id &&
        path.resolve(local.workspace.projectRoot) === path.resolve(options.projectRoot) &&
        path.resolve(local.workspace.worktreeRoot) === path.resolve(options.projectRoot) &&
        local.workspace.machineId === os.hostname();
      const inputSnapshot = gateBindingMatches
        ? null
        : await nativeCheckInputSnapshot({
            state,
            projectRoot: options.projectRoot,
            plans: options.plans,
            managedArtifactRoot: options.paths.artifactRoot,
          });
      const inputFingerprint = inputSnapshot?.fingerprint ?? local.inputFingerprint!;
      const inputDiagnostics = inputSnapshot?.diagnostics ?? [];
      const forceReexecuteForIncompleteInput = inputSnapshot?.complete === false;
      const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, state.name);
      const runtimeEvidenceAvailable = await hasNativeRuntimeCheckEvidence(local, runtimeDir);
      const allChecksPassed = local.checks.every((check) => check.status === 'passed');
      const retryIds = options.retryCheckIds === undefined ? null : new Set(options.retryCheckIds);
      const sameBinding =
        !forceReexecuteForIncompleteInput &&
        local.candidateId === state.builder_handoff?.candidate_id &&
        path.resolve(local.workspace.projectRoot) === path.resolve(options.projectRoot) &&
        path.resolve(local.workspace.worktreeRoot) === path.resolve(options.projectRoot) &&
        local.workspace.branch === branch &&
        local.workspace.machineId === os.hostname() &&
        local.inputFingerprint === inputFingerprint;
      const candidateInputsUnchanged =
        candidateGate !== null &&
        local.candidateInputFingerprintGate === candidateGate &&
        local.candidateId === state.builder_handoff?.candidate_id &&
        path.resolve(local.workspace.projectRoot) === path.resolve(options.projectRoot) &&
        path.resolve(local.workspace.worktreeRoot) === path.resolve(options.projectRoot) &&
        local.workspace.branch === branch &&
        local.workspace.machineId === os.hostname();
      const generatedInputsChanged =
        candidateInputsUnchanged &&
        local.inputFingerprint !== null &&
        local.inputFingerprint !== inputFingerprint;
      const planBindingMatches =
        sameNativeCheckPlan(
          local,
          options.plans,
          options.projectRoot,
          state,
          inputFingerprint,
          branch,
        ) ||
        (candidateInputsUnchanged &&
          sameNativeCheckCommands(local, options.plans, options.projectRoot));
      const sameWorkspaceBinding =
        local.candidateId === state.builder_handoff?.candidate_id &&
        path.resolve(local.workspace.projectRoot) === path.resolve(options.projectRoot) &&
        path.resolve(local.workspace.worktreeRoot) === path.resolve(options.projectRoot) &&
        local.workspace.branch === branch &&
        local.workspace.machineId === os.hostname();
      const forceReexecuteForMissingEvidence =
        sameBinding && allChecksPassed && !runtimeEvidenceAvailable;
      if (
        forceReexecuteForIncompleteInput &&
        local.checks.some((check) => !check.repeatable && check.status !== 'planned')
      ) {
        throw new Error(
          `Native 检查输入快照不完整，不能复用或自动重跑不可重复的检查：${inputDiagnostics.join('；') || '工作区输入无法完整读取'}`,
        );
      }
      if (retryIds && retryIds.size === 0) {
        throw new Error('Native check retry list must contain at least one ID');
      }
      if (
        !sameBinding &&
        local.execution?.stage === 'checking' &&
        local.execution.actor === 'runtime' &&
        local.execution.status === 'running'
      ) {
        const liveness = await inspectNativePortableCheckExecution(local);
        if (liveness !== 'orphaned') {
          throw new Error(
            liveness === 'unknown'
              ? 'Native check plan owner or process tree could not be proven to have exited; inspect the Runtime overlay before changing its binding'
              : 'Native check plan is already in progress on another workspace binding',
          );
        }
        local = interruptNativePortableCheckExecution(local);
        await writeNativeLocalExecution(file, local, { containedRoot: options.paths.runtimeDir });
      }
      if (
        !sameBinding &&
        sameWorkspaceBinding &&
        local.inputFingerprint !== null &&
        (local.execution !== null || local.checks.length > 0)
      ) {
        const fingerprintChanged = local.inputFingerprint !== inputFingerprint;
        if (
          (forceReexecuteForIncompleteInput && (!fingerprintChanged || candidateInputsUnchanged)) ||
          generatedInputsChanged
        ) {
          // Fall through to rebuild the local overlay and execute the current
          // plan again. The uncertain snapshot must never make prior checks
          // reusable, but it also must not reject the candidate itself.
        } else {
          // The candidate was reserved against a different project input. Do not
          // rebuild the overlay and reset its execution counters: that turns a
          // source edit or deletion into an unlimited retry loop. The candidate
          // is no longer the one the Builder produced, so return to Build and
          // preserve the durable failure history before accepting a new one.
          const next = returnNativeCandidateToBuild({
            state,
            reason:
              'Native check input changed after the candidate was built; a new Builder candidate is required before checks can run again.',
          });
          const written = await writePortableMutation({
            paths: options.paths,
            previous: state,
            next,
          });
          await writeNativeLocalExecution(
            file,
            rebuildNativeLocalExecution({
              portableState: written,
              projectRoot: options.paths.projectRoot,
              branch,
            }),
            { containedRoot: options.paths.runtimeDir },
          );
          throw new Error(
            'Native check input changed after the candidate was built; the change returned to Build for a new candidate',
          );
        }
      }
      if (!sameBinding && !candidateInputsUnchanged) {
        // A local overlay from another candidate, workspace or host is not
        // evidence for the current candidate. Rebuild the local overlay before
        // reserving a new plan; the portable state remains untouched.
        const rebuilt = rebuildNativeLocalExecution({
          portableState: state,
          projectRoot: options.projectRoot,
          branch,
        });
        await writeNativeLocalExecution(file, rebuilt, { containedRoot: options.paths.runtimeDir });
        local = rebuilt;
      }
      const planMatches = sameNativeCheckCommands(local, options.plans, options.projectRoot);
      if (
        local.execution?.stage === 'checking' &&
        local.execution.actor === 'runtime' &&
        planMatches &&
        planBindingMatches
      ) {
        let execution = local.execution;
        if (execution.status === 'running') {
          const liveness = await inspectNativePortableCheckExecution(local);
          if (liveness !== 'orphaned') {
            throw new Error(
              liveness === 'unknown'
                ? 'Native check plan owner or process tree could not be proven to have exited; inspect the Runtime overlay before retrying'
                : 'Native check plan is already in progress',
            );
          }
          local = interruptNativePortableCheckExecution(local);
          await writeNativeLocalExecution(file, local, { containedRoot: options.paths.runtimeDir });
          execution = local.execution!;
        }
        const interrupted = local.checks.filter((check) => check.status === 'interrupted');
        if (
          interrupted.length === 0 &&
          execution.status === 'completed' &&
          allChecksPassed &&
          !forceReexecuteForMissingEvidence &&
          !generatedInputsChanged &&
          !forceReexecuteForIncompleteInput
        ) {
          const requestedNames = new Map(options.plans.map(({ id, name }) => [id, name] as const));
          return {
            kind: 'reuse',
            state,
            checks: authoritativePortableChecks({
              local,
              projectRoot: options.projectRoot,
              supplied: [],
              requestedNames,
            }),
          };
        }
        if (
          interrupted.length === 0 &&
          execution.status === 'completed' &&
          !allChecksPassed &&
          !forceReexecuteForMissingEvidence &&
          !generatedInputsChanged &&
          !forceReexecuteForIncompleteInput
        ) {
          throw new Error(
            `Native check plan contains a failed check (${local.checks
              .filter(({ status }) => status === 'failed')
              .map(({ id }) => id)
              .join(', ')}); submit a new Builder candidate`,
          );
        }
        if (
          interrupted.length > 0 &&
          interrupted.some((check) => !check.repeatable) &&
          !forceReexecuteForMissingEvidence
        ) {
          const next = returnNativeCandidateToBuild({
            state,
            reason: `A non-repeatable Runtime check was interrupted (${interrupted
              .filter((check) => !check.repeatable)
              .map(({ id }) => id)
              .join(', ')}); a new Builder candidate is required before it can run again.`,
          });
          const written = await writePortableMutation({
            paths: options.paths,
            previous: state,
            next,
          });
          await writeNativeLocalExecution(
            nativeLocalExecutionFile(options.paths, state.name),
            rebuildNativeLocalExecution({
              portableState: written,
              projectRoot: options.paths.projectRoot,
              branch: currentBranch(options.paths.projectRoot),
            }),
            { containedRoot: options.paths.runtimeDir },
          );
          throw new Error(
            `Native check ${interrupted.find((check) => !check.repeatable)!.id} was interrupted and is not repeatable; the change returned to Build for a new candidate`,
          );
        }
        if (
          interrupted.length > 0 &&
          retryIds === null &&
          !forceReexecuteForMissingEvidence &&
          !generatedInputsChanged &&
          !forceReexecuteForIncompleteInput
        ) {
          const requestedNames = new Map(options.plans.map(({ id, name }) => [id, name] as const));
          return {
            kind: 'reuse',
            state,
            checks: authoritativePortableChecks({
              local,
              projectRoot: options.projectRoot,
              supplied: [],
              requestedNames,
            }),
          };
        }
        if (retryIds) {
          const unknown = [...retryIds].filter(
            (id) => !interrupted.some((check) => check.id === id),
          );
          if (unknown.length > 0) {
            throw new Error(
              `Native check retry IDs must refer to interrupted checks: ${unknown.join(', ')}`,
            );
          }
          const exhausted = interrupted.filter(
            (check) => retryIds.has(check.id) && check.executionCount >= 3,
          );
          if (exhausted.length > 0) {
            throw new Error(
              `Native check retry limit (3) reached: ${exhausted.map(({ id }) => id).join(', ')}`,
            );
          }
        }
      }
      if (local.execution !== null && local.checks.length > 0) {
        const sameInterruptedPlan =
          local.execution.stage === 'checking' &&
          local.execution.actor === 'runtime' &&
          local.checks.some((check) => check.status === 'interrupted') &&
          planMatches;
        if (
          !sameInterruptedPlan &&
          !forceReexecuteForMissingEvidence &&
          !generatedInputsChanged &&
          !forceReexecuteForIncompleteInput
        ) {
          throw new Error('Native check plan was already resolved with a different plan');
        }
      } else if (
        (local.execution !== null || local.checks.length > 0) &&
        !forceReexecuteForMissingEvidence &&
        !generatedInputsChanged &&
        !forceReexecuteForIncompleteInput
      ) {
        throw new Error('Native check plan was already resolved with a different plan');
      }
      const operationId = randomUUID();
      const ownerIdentity = await readProcessIdentity(process.pid);
      const operation: NativeLocalExecutionState = {
        ...local,
        candidateId: state.builder_handoff?.candidate_id ?? null,
        inputFingerprint,
        inputFingerprintGate: gate,
        candidateInputFingerprintGate: candidateGate,
        workspace: {
          ...local.workspace,
          projectRoot: path.resolve(options.projectRoot),
          worktreeRoot: path.resolve(options.projectRoot),
          branch: currentBranch(options.projectRoot),
          machineId: os.hostname(),
        },
        execution: {
          operationId,
          stage: 'checking',
          actor: 'runtime',
          executionId: null,
          status: 'running',
          startedAt: new Date().toISOString(),
          requestCheckRounds: 0,
          ownerPid: process.pid,
          ...(ownerIdentity ? { ownerIdentity } : {}),
        },
        checks: options.plans.map((plan) => {
          const previous = local.checks.find((check) => check.id === plan.id);
          if ((generatedInputsChanged || forceReexecuteForIncompleteInput) && previous) {
            return localCheck(plan, operationId, options.projectRoot);
          }
          if (forceReexecuteForMissingEvidence && previous) {
            return resetNativeCheckForExecution(previous, plan, operationId, options.projectRoot);
          }
          if (
            previous?.status === 'interrupted' &&
            (retryIds === null || retryIds.has(previous.id))
          ) {
            return resetInterruptedCheck(previous, plan, operationId, options.projectRoot);
          }
          if (previous) return { ...previous, operationId, activeProcess: null };
          return localCheck(plan, operationId, options.projectRoot);
        }),
      };
      await writeNativeLocalExecution(file, operation, { containedRoot: options.paths.runtimeDir });
      return {
        kind: 'execute',
        inputDiagnostics,
        state,
        local: operation,
        plans: options.plans.filter((plan) => {
          const previous = local.checks.find((check) => check.id === plan.id);
          return (
            forceReexecuteForMissingEvidence ||
            generatedInputsChanged ||
            forceReexecuteForIncompleteInput ||
            previous === undefined ||
            (previous.status === 'interrupted' && (retryIds === null || retryIds.has(previous.id)))
          );
        }),
      };
    },
  );
}

async function updateReservedNativeCheckPlan(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  operationId: string;
  update: (local: NativeLocalExecutionState) => NativeLocalExecutionState;
}): Promise<NativeLocalExecutionState> {
  return withNativeMutationLock(
    options.paths,
    `update portable checks ${options.state.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.state.name);
      if (
        state.state_version !== options.state.state_version ||
        state.phase !== options.state.phase ||
        (state.phase === 'verify'
          ? state.loop.stage !== 'verify-ready'
          : state.phase !== 'archive' || state.archived || state.status !== 'active')
      ) {
        throw new Error('Native check plan state changed during execution');
      }
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const local = await readNativeLocalExecution(file);
      if (
        local === null ||
        local.basedOnStateVersion !== state.state_version ||
        local.execution?.operationId !== options.operationId ||
        local.execution.stage !== 'checking' ||
        local.execution.actor !== 'runtime' ||
        local.execution.status !== 'running'
      ) {
        throw new Error('Native check plan reservation changed during execution');
      }
      const next = options.update(local);
      await writeNativeLocalExecution(file, next, { containedRoot: options.paths.runtimeDir });
      return next;
    },
  );
}

export async function executeNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  plans: NativeCheckPlan[];
  projectRoot?: string;
  retryCheckIds?: readonly string[];
  archiveRefresh?: NativePortableCheckRefreshInput;
}): Promise<{
  state: NativePortableState;
  checks: NativePortableCheckSummary[];
  disposition: 'executed' | 'reused';
  inputDiagnostics?: string[];
}> {
  const projectRoot = options.projectRoot ?? options.paths.projectRoot;
  preflightNativeCheckPlans(projectRoot, options.plans);
  const normalizedPlans: NativeCheckPlan[] = [];
  const seenPlanKeys = new Set<string>();
  for (const plan of options.plans) {
    validateNativeCheckPlan(projectRoot, plan);
    const key = nativeCheckPlanKey(plan);
    if (seenPlanKeys.has(key)) continue;
    seenPlanKeys.add(key);
    normalizedPlans.push(plan);
  }
  const reservation = await reserveNativePortableCheckPlan({
    ...options,
    plans: normalizedPlans,
    projectRoot,
  });
  if (reservation.kind === 'reuse') return { ...reservation, disposition: 'reused' };

  const operationId = reservation.local.execution!.operationId;
  const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, reservation.state.name);
  try {
    for (const plan of reservation.plans) {
      const rawBefore = reservation.local.rawInputRef
        ? await nativeRawInputSnapshot({
            projectRoot,
            managedArtifactRoot: options.paths.artifactRoot,
            previous: await portableRawSnapshot(
              options.paths,
              reservation.state,
              reservation.local.rawInputRef,
            ),
          })
        : null;
      if (rawBefore)
        await assertNativePortableRawCandidate(
          options.paths,
          reservation.state,
          reservation.local,
          rawBefore,
        );
      const rawBeforeRef = rawBefore
        ? await saveNativeRawInput(
            options.paths.workspaceRuntimeRoot,
            portableRawDirectory(options.paths, reservation.state.name),
            rawBefore,
          )
        : null;
      const startedAt = new Date().toISOString();
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) =>
            check.id === plan.id
              ? {
                  ...check,
                  status: 'running',
                  executionCount: check.executionCount + 1,
                  startedAt,
                  activeProcess: { status: 'starting' as const },
                }
              : check,
          ),
        }),
      });
      const result = await executeNativeCheck({
        projectRoot,
        runtimeDir,
        operationId,
        plan,
        onSpawn: async ({ pid }) => {
          const identity = await readProcessIdentity(pid);
          await updateReservedNativeCheckPlan({
            paths: options.paths,
            state: reservation.state,
            operationId,
            update: (local) => ({
              ...local,
              checks: local.checks.map((check) =>
                check.id === plan.id
                  ? {
                      ...check,
                      activeProcess: {
                        status: 'running' as const,
                        pid,
                        ...(identity ? { identity } : {}),
                      },
                    }
                  : check,
              ),
            }),
          });
        },
      });
      const rawAfterRef = rawBefore
        ? await saveNativeRawInput(
            options.paths.workspaceRuntimeRoot,
            portableRawDirectory(options.paths, reservation.state.name),
            await nativeRawInputSnapshot({
              projectRoot,
              managedArtifactRoot: options.paths.artifactRoot,
              previous: rawBefore,
            }),
          )
        : null;
      const logContent = await fs.readFile(
        path.resolve(runtimeDir, ...result.logRef.split('/')),
        'utf8',
      );
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) => {
            if (check.id !== plan.id) return check;
            const completed = {
              ...check,
              status: result.status,
              exitCode: result.exitCode,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              log: result.logRef,
              activeProcess: null,
              evidence: 'runtime' as const,
              ...(rawBeforeRef && rawAfterRef
                ? {
                    rawInput: {
                      beforeRef: rawBeforeRef,
                      afterRef: rawAfterRef,
                      executionRef: `native-check:${operationId}`,
                    },
                  }
                : {}),
            };
            return {
              ...completed,
              evidenceDigest: nativeLocalCheckEvidenceDigest(completed, logContent),
            };
          }),
        }),
      });
    }
    await updateReservedNativeCheckPlan({
      paths: options.paths,
      state: reservation.state,
      operationId,
      update: (local) => ({
        ...local,
        execution: { ...local.execution!, status: 'completed' },
      }),
    });
  } catch (error) {
    if (isNativeCheckTerminationUnconfirmedError(error)) throw error;
    try {
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          execution: { ...local.execution!, status: 'interrupted' },
          checks: local.checks.map((check) =>
            check.status === 'planned' || check.status === 'running'
              ? { ...check, status: 'interrupted' as const, activeProcess: null }
              : check,
          ),
        }),
      });
    } catch {
      // Preserve the original execution failure; recovery will inspect the overlay.
    }
    throw error;
  }
  const finalLocal = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, reservation.state.name),
  );
  if (finalLocal === null)
    throw new Error('Native Runtime check state disappeared after execution');
  return {
    state: reservation.state,
    checks: authoritativePortableChecks({
      local: finalLocal,
      projectRoot,
      supplied: [],
    }),
    disposition: 'executed',
    ...(reservation.inputDiagnostics.length
      ? { inputDiagnostics: reservation.inputDiagnostics }
      : {}),
  };
}

/**
 * Retry only repeatable interrupted checks for the current Builder candidate.
 * The local overlay is read to reconstruct the exact original command, so an
 * Agent cannot silently replace a failed command while claiming a retry.
 */
export async function retryNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  checkIds: readonly string[];
  projectRoot?: string;
}): Promise<{ state: NativePortableState; checks: NativePortableCheckSummary[] }> {
  if (options.checkIds.length === 0) {
    throw new Error('Native check retry list must contain at least one ID');
  }
  const projectRoot = options.projectRoot ?? options.paths.projectRoot;
  const state = await readNativePortableChange(options.paths, options.name);
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.stage !== 'verify-ready' ||
    state.builder_handoff === null
  ) {
    throw new Error('Native check retry requires an active Verify-ready candidate');
  }
  const local = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, options.name),
  );
  if (
    local === null ||
    local.change !== state.name ||
    local.basedOnStateVersion !== state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'checking' ||
    local.execution.actor !== 'runtime'
  ) {
    throw new Error('Native check retry has no current Runtime check execution');
  }
  const requested = new Set(options.checkIds);
  if (requested.size !== options.checkIds.length) {
    throw new Error('Native check retry list contains duplicate IDs');
  }
  const checks = local.checks.filter((check) => requested.has(check.id));
  const missing = options.checkIds.filter((id) => !checks.some((check) => check.id === id));
  if (missing.length > 0) {
    throw new Error(`Native check retry IDs are unknown: ${missing.join(', ')}`);
  }
  for (const check of checks) {
    if (check.status !== 'interrupted') {
      throw new Error(`Native check ${check.id} is not interrupted and cannot be retried`);
    }
    if (!check.repeatable) {
      throw new Error(`Native check ${check.id} is not repeatable and cannot be retried`);
    }
    if (check.executionCount >= 3) {
      throw new Error(`Native check retry limit (3) reached: ${check.id}`);
    }
  }
  const plans = local.checks.map((check) => {
    const [executable, ...argv] = check.argv;
    if (!executable) throw new Error(`Native local check ${check.id} has no executable`);
    return {
      id: check.id,
      name: check.name,
      executable,
      argv,
      cwdRef: localCheckCwdRef(projectRoot, check.cwd),
      timeoutMs: check.timeoutMs,
      repeatable: check.repeatable,
    } satisfies NativeCheckPlan;
  });
  return executeNativePortableCheckPlan({
    paths: options.paths,
    name: options.name,
    plans,
    projectRoot,
    retryCheckIds: options.checkIds,
  });
}

export interface NativePortableRequestChecksOutcome {
  round: number;
  reusedCheckIds: string[];
  executedCheckIds: string[];
}

interface NativeVerifierRequestedCheckReservation {
  state: NativePortableState;
  local: NativeLocalExecutionState;
  verifierExecutionRef: string;
  round: number;
  novelPlans: NativeCheckPlan[];
  requestedNames: ReadonlyMap<string, string>;
  reusedCheckIds: string[];
  suppliedChecks: readonly NativePortableCheckSummary[];
}

export async function reserveVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  projectRoot: string;
  state: NativePortableState;
  local: NativeLocalExecutionState;
  envelope: NativeTrustedVerifierEnvelope<unknown>;
  response: Extract<NativeVerifierResponse, { kind: 'request-checks' }>;
  suppliedChecks: readonly NativePortableCheckSummary[];
}): Promise<NativeVerifierRequestedCheckReservation> {
  const action = currentNativeVerifierAction(options.state, options.local);
  const started = startNativeVerifierAction(action, options.envelope.verifierExecutionRef);
  if (!options.state.verifier_action || action.status === 'pending') {
    const written = await writePortableMutation({
      paths: options.paths,
      previous: options.state,
      next: {
        ...options.state,
        state_version: options.state.state_version + 1,
        verifier_action: started,
      },
    });
    options = {
      ...options,
      state: written,
      local: { ...options.local, basedOnStateVersion: written.state_version },
    };
    await writeNativeLocalExecution(
      nativeLocalExecutionFile(options.paths, written.name),
      options.local,
      { containedRoot: options.paths.runtimeDir },
    );
  }
  const file = nativeLocalExecutionFile(options.paths, options.state.name);
  const local = options.local;
  if (
    local === null ||
    local.change !== options.state.name ||
    local.basedOnStateVersion !== options.state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'verifying' ||
    local.execution.actor !== 'verifier' ||
    local.execution.status !== 'running'
  ) {
    throw new Error('Native Verifier request-checks has no active local execution');
  }
  if (
    local.execution.executionId !== null &&
    local.execution.executionId !== options.envelope.verifierExecutionRef
  ) {
    throw new Error('Native Verifier request-checks changed execution within the same attempt');
  }
  if (local.execution.requestCheckRounds >= NATIVE_MAX_REQUEST_CHECK_ROUNDS) {
    throw new Error(
      `Native Verifier request-checks exceeded ${NATIVE_MAX_REQUEST_CHECK_ROUNDS} rounds for this attempt`,
    );
  }

  const existingByKey = new Map<string, NativeLocalCheckState>();
  const existingByKeyAll = new Map<string, NativeLocalCheckState>();
  const existingKeyById = new Map<string, string>();
  const rawCurrent = local.rawInputRef
    ? await nativeRawInputSnapshot({
        projectRoot: options.projectRoot,
        managedArtifactRoot: options.paths.artifactRoot,
        previous: await portableRawSnapshot(options.paths, options.state, local.rawInputRef),
      })
    : null;
  if (rawCurrent)
    await assertNativePortableRawCandidate(options.paths, options.state, local, rawCurrent);
  for (const check of local.checks) {
    const key = nativeLocalCheckPlanKey(check, options.projectRoot);
    existingByKeyAll.set(key, check);
    if (
      check.status === 'passed' &&
      (!rawCurrent ||
        (await portableRawCheckApplicable(options.paths, options.state, check, rawCurrent)))
    )
      existingByKey.set(key, check);
    existingKeyById.set(check.id, key);
  }

  const requestedByKey = new Map<string, NativeCheckPlan>();
  const requestedKeyById = new Map<string, string>();
  for (const request of options.response.checks) {
    const plan = requestCheckPlan(request);
    validateNativeCheckPlan(options.projectRoot, plan);
    const key = nativeCheckPlanKey(plan);
    if (
      !existingByKeyAll.has(key) &&
      nativePortableCheckPlansFromLocal(local).some(
        (original) =>
          !original.repeatable &&
          nativeCheckInvocationKey(original) === nativeCheckInvocationKey(plan) &&
          local.checks.some((check) => check.id === original.id && check.executionCount > 0),
      )
    )
      throw new Error(
        `Native check ${plan.id} refers to an executed command that is not repeatable`,
      );
    const previousRequestKey = requestedKeyById.get(plan.id);
    if (previousRequestKey !== undefined && previousRequestKey !== key) {
      throw new Error(`Native Verifier check ID ${plan.id} refers to conflicting commands`);
    }
    const existingKey = existingKeyById.get(plan.id);
    if (existingKey !== undefined && existingKey !== key) {
      throw new Error(`Native Verifier check ID ${plan.id} conflicts with a Runtime check`);
    }
    requestedKeyById.set(plan.id, key);
    const existing = existingByKeyAll.get(key);
    if (
      existing &&
      !existingByKey.has(key) &&
      existing.executionCount > 0 &&
      !existing.repeatable
    ) {
      throw new Error(
        `Native check ${existing.id} has no applicable passing evidence and is not repeatable; user resolution is required`,
      );
    }
    if (existing && existing.status !== 'passed' && existing.executionCount >= 3) {
      throw new Error(`Native check retry limit (3) reached: ${existing.id}`);
    }
    if (!requestedByKey.has(key)) requestedByKey.set(key, plan);
  }

  preflightNativeCheckPlans(options.projectRoot, [...requestedByKey.values()]);

  const requested = [...requestedByKey.entries()];
  const novel = requested.filter(([key]) => !existingByKey.has(key));
  if (local.execution.requestCheckRounds > 0 && novel.length === 0) {
    throw new Error('Native Verifier repeatedly requested only equivalent checks');
  }

  const round = local.execution.requestCheckRounds + 1;
  const requestedNames = new Map(requested.map(([, plan]) => [plan.id, plan.name] as const));
  const operation: NativeLocalExecutionState = {
    ...local,
    execution: {
      ...local.execution,
      stage: 'checking',
      actor: 'runtime',
      executionId: options.envelope.verifierExecutionRef,
      requestCheckRounds: round,
    },
    checks: [
      ...local.checks.map((check) => {
        const key = nativeLocalCheckPlanKey(check, options.projectRoot);
        const plan = requestedByKey.get(key);
        return plan && !existingByKey.has(key)
          ? resetNativeCheckForExecution(
              check,
              plan,
              local.execution!.operationId,
              options.projectRoot,
            )
          : check;
      }),
      ...novel
        .filter(([key]) => !existingByKeyAll.has(key))
        .map(([, plan]) => localCheck(plan, local.execution!.operationId, options.projectRoot)),
    ],
  };
  await writeNativeLocalExecution(file, operation, { containedRoot: options.paths.runtimeDir });

  return {
    state: options.state,
    local: operation,
    verifierExecutionRef: options.envelope.verifierExecutionRef,
    round,
    novelPlans: novel.map(([, plan]) => plan),
    requestedNames,
    reusedCheckIds: requested.filter(([key]) => existingByKey.has(key)).map(([, plan]) => plan.id),
    suppliedChecks: options.suppliedChecks,
  };
}

async function updateReservedVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  reservation: NativeVerifierRequestedCheckReservation;
  update: (local: NativeLocalExecutionState) => NativeLocalExecutionState;
}): Promise<NativeLocalExecutionState> {
  return withNativeMutationLock(
    options.paths,
    `update Verifier-requested checks ${options.reservation.state.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.reservation.state.name);
      if (
        state.state_version !== options.reservation.state.state_version ||
        state.phase !== 'verify' ||
        state.loop.next_action !== 'await-verifier-result'
      ) {
        throw new Error('Native Verifier request-checks state changed during execution');
      }
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const local = await readNativeLocalExecution(file);
      const execution = local?.execution;
      if (
        local === null ||
        local.basedOnStateVersion !== state.state_version ||
        execution === null ||
        execution === undefined ||
        execution.operationId !== options.reservation.local.execution?.operationId ||
        execution.stage !== 'checking' ||
        execution.actor !== 'runtime' ||
        execution.status !== 'running' ||
        execution.executionId !== options.reservation.verifierExecutionRef ||
        execution.requestCheckRounds !== options.reservation.round
      ) {
        throw new Error('Native Verifier request-checks reservation changed during execution');
      }
      const next = options.update(local);
      await writeNativeLocalExecution(file, next, { containedRoot: options.paths.runtimeDir });
      return next;
    },
  );
}

export async function executeReservedVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  projectRoot: string;
  reservation: NativeVerifierRequestedCheckReservation;
}): Promise<{
  checks: NativePortableCheckSummary[];
  requestChecks: NativePortableRequestChecksOutcome;
}> {
  let operation: NativeLocalExecutionState;
  try {
    for (const plan of options.reservation.novelPlans) {
      const rawBefore = options.reservation.local.rawInputRef
        ? await nativeRawInputSnapshot({
            projectRoot: options.projectRoot,
            managedArtifactRoot: options.paths.artifactRoot,
            previous: await portableRawSnapshot(
              options.paths,
              options.reservation.state,
              options.reservation.local.rawInputRef,
            ),
          })
        : null;
      if (rawBefore)
        await assertNativePortableRawCandidate(
          options.paths,
          options.reservation.state,
          options.reservation.local,
          rawBefore,
        );
      const rawBeforeRef = rawBefore
        ? await saveNativeRawInput(
            options.paths.workspaceRuntimeRoot,
            portableRawDirectory(options.paths, options.reservation.state.name),
            rawBefore,
          )
        : null;
      const startedAt = new Date().toISOString();
      operation = await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) =>
            check.id === plan.id
              ? {
                  ...check,
                  status: 'running',
                  executionCount: check.executionCount + 1,
                  startedAt,
                  activeProcess: { status: 'starting' as const },
                }
              : check,
          ),
        }),
      });
      const runtimeDir = nativePreferredChangeRuntimeDir(
        options.paths,
        options.reservation.state.name,
      );
      const result = await executeNativeCheck({
        projectRoot: options.projectRoot,
        runtimeDir,
        operationId: options.reservation.local.execution!.operationId,
        plan,
        onSpawn: async ({ pid }) => {
          const identity = await readProcessIdentity(pid);
          await updateReservedVerifierRequestedChecks({
            paths: options.paths,
            reservation: options.reservation,
            update: (local) => ({
              ...local,
              checks: local.checks.map((check) =>
                check.id === plan.id
                  ? {
                      ...check,
                      activeProcess: {
                        status: 'running' as const,
                        pid,
                        ...(identity ? { identity } : {}),
                      },
                    }
                  : check,
              ),
            }),
          });
        },
      });
      const rawAfterRef = rawBefore
        ? await saveNativeRawInput(
            options.paths.workspaceRuntimeRoot,
            portableRawDirectory(options.paths, options.reservation.state.name),
            await nativeRawInputSnapshot({
              projectRoot: options.projectRoot,
              managedArtifactRoot: options.paths.artifactRoot,
              previous: rawBefore,
            }),
          )
        : null;
      const logContent = await fs.readFile(
        await resolveContainedNativePath(
          runtimeDir,
          path.resolve(runtimeDir, ...result.logRef.split(/[\\/]/u)),
        ),
        'utf8',
      );
      operation = await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) => {
            if (check.id !== plan.id) return check;
            const completed = {
              ...check,
              status: result.status,
              exitCode: result.exitCode,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              log: result.logRef,
              activeProcess: null,
              evidence: 'runtime' as const,
              ...(rawBeforeRef && rawAfterRef
                ? {
                    rawInput: {
                      beforeRef: rawBeforeRef,
                      afterRef: rawAfterRef,
                      executionRef: `native-check:${options.reservation.local.execution!.operationId}`,
                    },
                  }
                : {}),
            };
            return {
              ...completed,
              evidenceDigest: nativeLocalCheckEvidenceDigest(completed, logContent),
            };
          }),
        }),
      });
    }

    operation = await updateReservedVerifierRequestedChecks({
      paths: options.paths,
      reservation: options.reservation,
      update: (local) => ({
        ...local,
        execution: {
          ...local.execution!,
          stage: 'verifying',
          actor: 'verifier',
          executionId: options.reservation.verifierExecutionRef,
        },
      }),
    });
  } catch (error) {
    if (isNativeCheckTerminationUnconfirmedError(error)) throw error;
    try {
      await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          execution: { ...local.execution!, status: 'interrupted' },
          checks: local.checks.map((check) =>
            check.status === 'planned' || check.status === 'running'
              ? { ...check, status: 'interrupted' as const, activeProcess: null }
              : check,
          ),
        }),
      });
    } catch {
      // Preserve the original execution failure; recovery will inspect the overlay.
    }
    throw error;
  }
  return {
    checks: authoritativePortableChecks({
      local: operation,
      projectRoot: options.projectRoot,
      supplied: options.reservation.suppliedChecks,
      requestedNames: options.reservation.requestedNames,
    }),
    requestChecks: {
      round: options.reservation.round,
      reusedCheckIds: options.reservation.reusedCheckIds,
      executedCheckIds: options.reservation.novelPlans.map(({ id }) => id),
    },
  };
}
