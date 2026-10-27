import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import type { EditReviewScope } from '../workflow-contract/edit-review.js';
import { atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { canonicalHash } from './native-canonical-hash.js';
import {
  nativeShapeArtifactSnapshot,
  nativeShapeArtifactContractHash,
  type NativeShapeArtifactSnapshot,
} from './native-shape-semantics.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativePortableState } from './native-portable-types.js';
const git = promisify(execFile);

function originalRef(state: NativePortableState, approved: NativeShapeArtifactSnapshot): string {
  const binding = canonicalHash('comet.native.approved-shape-original.v1', {
    change: state.name,
    source: approved.source,
    contentHash: approved.contentHash,
  });
  return `native/approved-shape-original/${binding}.md`;
}

/** 保存与待确认 Shape 精确匹配的原文；使用时仍须核对当前 Run 的批准摘要。 */
export async function captureApprovedShapeOriginals(
  paths: NativeProjectPaths,
  state: NativePortableState,
): Promise<void> {
  for (const approved of state.shape_semantic_snapshot?.artifacts ?? []) {
    const original = await readNativeBoundedTextFile({
      root: path.join(paths.changesDir, state.name),
      ref: approved.source,
      maxBytes: null,
    });
    if (
      nativeShapeArtifactSnapshot(approved.source, original.text).contentHash !==
      approved.contentHash
    )
      throw new Error('Native Shape original changed before confirmation');
    const ref = originalRef(state, approved);
    try {
      await atomicWriteText(path.join(paths.workspaceRuntimeRoot, ref), original.text, {
        containedRoot: paths.workspaceRuntimeRoot,
        exclusive: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readNativeBoundedTextFile({
        root: paths.workspaceRuntimeRoot,
        ref,
        maxBytes: null,
      });
      if (existing.text !== original.text)
        throw new Error('Native approved Shape original changed', { cause: error });
    }
  }
}

export async function readApprovedShapeOriginal(
  paths: NativeProjectPaths,
  state: NativePortableState,
  approved: NativeShapeArtifactSnapshot,
): Promise<{ text: string; path: string }> {
  const ref = originalRef(state, approved);
  let original;
  try {
    original = await readNativeBoundedTextFile({
      root: paths.workspaceRuntimeRoot,
      ref,
      maxBytes: null,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const text = await findApprovedOriginalInGit(paths, state, approved);
    if (text === null) throw error;
    try {
      await atomicWriteText(path.join(paths.workspaceRuntimeRoot, ref), text, {
        containedRoot: paths.workspaceRuntimeRoot,
        exclusive: true,
      });
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError;
    }
    original = await readNativeBoundedTextFile({
      root: paths.workspaceRuntimeRoot,
      ref,
      maxBytes: null,
    });
  }
  const actual = nativeShapeArtifactSnapshot(approved.source, original.text);
  if (
    actual.contentHash !== approved.contentHash ||
    nativeShapeArtifactContractHash(actual) !== nativeShapeArtifactContractHash(approved)
  )
    throw new Error('Native approved Shape original no longer matches its approved snapshot');
  return { text: original.text, path: path.join(paths.workspaceRuntimeRoot, ref) };
}

async function findApprovedOriginalInGit(
  paths: NativeProjectPaths,
  state: NativePortableState,
  approved: NativeShapeArtifactSnapshot,
): Promise<string | null> {
  const options = {
    cwd: paths.projectRoot,
    timeout: 3000,
    maxBuffer: Number.MAX_SAFE_INTEGER,
    windowsHide: true,
  };
  const deadline = Date.now() + 5000;
  const matches = (text: string) => {
    for (const candidate of [text, text.replace(/\r?\n/gu, '\r\n')]) {
      if (
        nativeShapeArtifactSnapshot(approved.source, candidate).contentHash === approved.contentHash
      )
        return candidate;
    }
    return null;
  };
  try {
    const root = (await git('git', ['rev-parse', '--show-toplevel'], options)).stdout.trim();
    const [physicalRoot, absolute] = await Promise.all([
      realpath(root),
      realpath(path.resolve(paths.changesDir, state.name, approved.source)),
    ]);
    const relative = path.relative(physicalRoot, absolute).replaceAll('\\', '/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return null;
    try {
      const staged = (await git('git', ['show', `:${relative}`], options)).stdout;
      const matched = matches(staged);
      if (matched !== null) return matched;
    } catch {
      // 未暂存时继续检查历史。
    }
    const commits = (
      await git('git', ['log', '-n', '30', '--format=%H', '--', relative], options)
    ).stdout
      .split(/\r?\n/u)
      .filter((value) => /^[a-f0-9]{40,64}$/u.test(value));
    for (const commit of commits) {
      if (Date.now() >= deadline) break;
      try {
        const text = (await git('git', ['show', `${commit}:${relative}`], options)).stdout;
        const matched = matches(text);
        if (matched !== null) return matched;
      } catch {
        // 文件可能未暂存或该提交不存在；继续尝试其他版本。
      }
    }
  } catch {
    // Git 不可用或找不到可信原文时仍可通过需求修订继续。
  }
  return null;
}

function anchorRef(
  scope: EditReviewScope,
  approved: NativeShapeArtifactSnapshot,
  hash: string,
): string {
  const binding = canonicalHash('comet.native.shape-comment-review.v1', {
    change: scope.change,
    candidate: scope.candidateKey,
    source: approved.source,
    approvedHash: approved.contentHash,
  });
  return `native/shape-comment-review/${binding}/${hash}.md`;
}

/** 保留复核前已证明等价的原文，让先补行号再改注释也有可复验的起点。 */
export async function captureNativeShapeReviewAnchor(
  scope: EditReviewScope,
  approved: NativeShapeArtifactSnapshot,
  text: string,
  unbounded = false,
): Promise<void> {
  const current = nativeShapeArtifactSnapshot(approved.source, text);
  if (nativeShapeArtifactContractHash(current) !== nativeShapeArtifactContractHash(approved))
    return;
  if (!unbounded && Buffer.byteLength(text) > 1024 * 1024)
    throw new Error('Native formal comment review supports at most 1 MiB per original document');
  const ref = anchorRef(scope, approved, current.contentHash);
  try {
    const existing = await readNativeBoundedTextFile({
      root: scope.runtimeRoot,
      ref,
      includeHash: false,
      ...(unbounded ? { maxBytes: null } : {}),
    });
    if (existing.text !== text) throw new Error('Native formal comment review anchor changed');
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await atomicWriteText(path.join(scope.runtimeRoot, ref), text, {
    containedRoot: scope.runtimeRoot,
    exclusive: true,
  });
}

export async function nativeShapeReviewAnchorMatches(
  scope: EditReviewScope,
  approved: NativeShapeArtifactSnapshot,
  hash: string | null,
): Promise<boolean> {
  if (!hash) return false;
  if (hash === approved.contentHash) return true;
  if (!/^[a-f0-9]{64}$/u.test(hash)) return false;
  try {
    const file = await readNativeBoundedTextFile({
      root: scope.runtimeRoot,
      ref: anchorRef(scope, approved, hash),
      includeHash: false,
    });
    const original = nativeShapeArtifactSnapshot(approved.source, file.text);
    return (
      original.contentHash === hash &&
      nativeShapeArtifactContractHash(original) === nativeShapeArtifactContractHash(approved)
    );
  } catch {
    return false;
  }
}
