import path from 'node:path';
import type { EditReviewScope } from '../workflow-contract/edit-review.js';
import { atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { canonicalHash } from './native-canonical-hash.js';
import {
  nativeShapeArtifactSnapshot,
  nativeShapeArtifactContractHash,
  type NativeShapeArtifactSnapshot,
} from './native-shape-semantics.js';

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
): Promise<void> {
  const current = nativeShapeArtifactSnapshot(approved.source, text);
  if (nativeShapeArtifactContractHash(current) !== nativeShapeArtifactContractHash(approved))
    return;
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw new Error('Native formal comment review supports at most 1 MiB per original document');
  const ref = anchorRef(scope, approved, current.contentHash);
  try {
    const existing = await readNativeBoundedTextFile({
      root: scope.runtimeRoot,
      ref,
      includeHash: false,
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
