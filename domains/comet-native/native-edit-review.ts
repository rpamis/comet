import { nativeEditReviewScope, nativeFormalEditReviewScope } from './native-edit-review-scope.js';
export { nativeEditReviewScope, nativeFormalEditReviewScope } from './native-edit-review-scope.js';
import {
  captureNativeShapeReviewAnchor,
  nativeShapeReviewAnchorMatches,
  readApprovedShapeOriginal,
} from './native-shape-review-evidence.js';
import { readNativeApprovedShapeSemanticSnapshot } from './native-portable-requirements.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  proposedCometHookFileContent,
  type CometHookRequest,
} from '../../platform/process/hook-adapter.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import {
  nativeShapeArtifactSnapshot,
  nativeShapeArtifactContractHash,
} from './native-shape-semantics.js';

import {
  assertEditReviewsComplete,
  inspectEditReviews,
  editReviewContinuation,
  type EditReviewObservation,
  approvedEditFingerprint,
  prepareEditReview,
  type EditReviewScope,
} from '../workflow-contract/edit-review.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativePortableState } from './native-portable-types.js';

export async function inspectNativeEditReviews(
  paths: NativeProjectPaths,
  state: NativePortableState,
) {
  const scopes = [
    ...(state.shape_confirmation_hash ? [nativeFormalEditReviewScope(paths, state)] : []),
    ...(state.builder_handoff || state.phase === 'build'
      ? [nativeEditReviewScope(paths, state)]
      : []),
  ];
  return (await Promise.all(scopes.map((scope) => inspectEditReviews(scope)))).flat();
}

export async function nativeEditReviewContinuation(
  paths: NativeProjectPaths,
  state: NativePortableState,
  reviews: readonly EditReviewObservation[],
  sdk = true,
) {
  const scopes = [
    ...(state.shape_confirmation_hash ? [nativeFormalEditReviewScope(paths, state)] : []),
    ...(state.builder_handoff || state.phase === 'build'
      ? [nativeEditReviewScope(paths, state)]
      : []),
  ];
  for (const scope of scopes) {
    const edit = await editReviewContinuation(
      scope,
      reviews.filter((review) => review.binding.candidateKey === scope.candidateKey),
      sdk,
    );
    if (edit) return edit;
  }
  return null;
}

export async function assertNativeEditReviewsComplete(
  paths: NativeProjectPaths,
  state: NativePortableState,
): Promise<void> {
  if (state.builder_handoff) await assertEditReviewsComplete(nativeEditReviewScope(paths, state));
  if (state.shape_confirmation_hash)
    await assertEditReviewsComplete(nativeFormalEditReviewScope(paths, state));
}

/** 只复核已应用的正式材料注释；原文必须来自当前 Shape 的可信快照。 */
export async function prepareNativeAppliedFormalReview(
  paths: NativeProjectPaths,
  state: NativePortableState,
  request: CometHookRequest,
  judgment?: 'agent',
) {
  const scope =
    judgment === 'agent'
      ? nativeFormalEditReviewScope(paths, state)
      : nativeEditReviewScope(paths, state);
  const snapshot = (await readNativeApprovedShapeSemanticSnapshot({ paths, state }))?.snapshot;
  if (!snapshot || !request.targets.length)
    throw new Error('缺少已批准的 Shape 原文，须恢复原文或修订需求');
  const originals = new Map<string, string>();
  const originalPaths: string[] = [];
  for (const target of request.targets) {
    const absolute = path.resolve(request.cwd ?? paths.projectRoot, target);
    const source = path
      .relative(path.join(paths.changesDir, state.name), absolute)
      .replaceAll('\\', '/');
    const relative = path.relative(paths.projectRoot, absolute).replaceAll('\\', '/');
    const approved = snapshot.artifacts.find((entry) => entry.source === source);
    if (!approved) throw new Error('已应用编辑不是当前已批准的正式材料');
    let original;
    try {
      original = await readApprovedShapeOriginal(paths, state, approved);
    } catch {
      throw new Error('已批准的原文缺失或不匹配；保留当前文件，恢复可信原文或修订 Shape');
    }
    const current = await readNativeBoundedTextFile({
      root: paths.projectRoot,
      ref: relative,
      maxBytes: null,
    });
    const actual = judgment === 'agent' ? null : nativeShapeArtifactSnapshot(source, current.text);
    if (
      actual &&
      nativeShapeArtifactContractHash({ ...actual, commentsHash: approved.commentsHash }) !==
        nativeShapeArtifactContractHash(approved)
    )
      throw new Error('正式需求或验收内容改变，必须通过 Shape 修订');
    await captureNativeShapeReviewAnchor(scope, approved, original.text, true);
    originals.set(relative, original.text);
    originalPaths.push(original.path);
  }
  const proposal = await prepareEditReview(
    { ...scope, formalPrefixes: ['.comet'] },
    request,
    originals,
  );
  return { proposal, originalPaths };
}

/** 选择一份已修改的正式材料，由 Runtime 构造复核请求，避免要求用户手工准备 JSON。 */
export async function nativeAppliedFormalReviewRequest(
  paths: NativeProjectPaths,
  state: NativePortableState,
  judgment?: 'agent',
) {
  const snapshot = (await readNativeApprovedShapeSemanticSnapshot({ paths, state }))?.snapshot;
  if (!snapshot) throw new Error('缺少已批准的 Shape 快照；保留当前修改并修订需求');
  const scope =
    judgment === 'agent'
      ? nativeFormalEditReviewScope(paths, state)
      : nativeEditReviewScope(paths, state);
  for (const approved of snapshot.artifacts) {
    const absolute = path.join(paths.changesDir, state.name, approved.source);
    const relative = path.relative(paths.projectRoot, absolute).replaceAll('\\', '/');
    const current = await readNativeBoundedTextFile({
      root: paths.projectRoot,
      ref: relative,
      maxBytes: null,
    });
    const changed =
      judgment === 'agent'
        ? createHash('sha256').update(current.text).digest('hex') !== approved.contentHash
        : nativeShapeArtifactSnapshot(approved.source, current.text).commentsHash !==
          approved.commentsHash;
    if (changed) {
      const reviewed = await approvedEditFingerprint(scope, relative, current.text);
      if (reviewed && (await nativeShapeReviewAnchorMatches(scope, approved, reviewed.beforeHash)))
        continue;
      const request = {
        cometApplied: true,
        tool_name: 'Write',
        tool_input: { file_path: absolute, content: current.text },
      };
      return JSON.stringify(request);
    }
  }
  return null;
}

/** 正式材料仅开放已批准契约不变的注释差异，不开放任意文档给通用复核。 */
export async function nativeEditReviewPreparationScope(
  paths: NativeProjectPaths,
  state: NativePortableState,
  request: CometHookRequest,
  judgment?: 'agent',
): Promise<EditReviewScope> {
  let scope: EditReviewScope = { ...nativeEditReviewScope(paths, state), judgment };
  const semantic = (await readNativeApprovedShapeSemanticSnapshot({ paths, state }))?.snapshot;
  let formal = false;
  for (const target of request.targets) {
    const absolute = path.resolve(request.cwd ?? paths.projectRoot, target);
    const relative = path.relative(paths.projectRoot, absolute).replaceAll('\\', '/');
    if (
      !scope.formalPrefixes.some(
        (prefix) => relative === prefix || relative.startsWith(prefix + '/'),
      )
    )
      continue;
    formal = true;
    if (judgment === 'agent') scope = nativeFormalEditReviewScope(paths, state);
    const source = path
      .relative(path.join(paths.changesDir, state.name), absolute)
      .replaceAll('\\', '/');
    const approved = semantic?.artifacts.find((entry) => entry.source === source);
    const writes =
      request.writes?.filter(
        (entry) => path.resolve(request.cwd ?? paths.projectRoot, entry.path) === absolute,
      ) ?? [];
    if (!approved || writes.length !== 1)
      throw new Error('正式材料缺少已批准语义快照或完整差异，必须通过 Shape 修订');
    const before = await readNativeBoundedTextFile({
      root: paths.projectRoot,
      ref: relative,
      ...(judgment === 'agent' ? { maxBytes: null } : {}),
    });
    const after = proposedCometHookFileContent(writes[0], before.text);
    if (after === null) throw new Error('无法完整重建正式材料差异');
    if (judgment === 'agent') {
      const original = await readApprovedShapeOriginal(paths, state, approved);
      if (before.text !== original.text) {
        const review = await approvedEditFingerprint(scope, relative, before.text);
        if (!review || !(await nativeShapeReviewAnchorMatches(scope, approved, review.beforeHash)))
          throw new Error('正式材料的判断起点未获确认；先处理当前差异');
      }
      await captureNativeShapeReviewAnchor(scope, approved, original.text, true);
      continue;
    }
    const previous = nativeShapeArtifactSnapshot(source, before.text);
    if (previous.commentsHash !== approved.commentsHash) {
      const review = await approvedEditFingerprint(scope, relative, before.text);
      if (!review || !(await nativeShapeReviewAnchorMatches(scope, approved, review.beforeHash)))
        throw new Error('正式注释的复核起点尚未获批；先恢复原批准注释，再准备完整差异');
    }
    await captureNativeShapeReviewAnchor(scope, approved, before.text);
    for (const text of [before.text, after]) {
      const current = nativeShapeArtifactSnapshot(source, text);
      if (
        nativeShapeArtifactContractHash({ ...current, commentsHash: approved.commentsHash }) !==
        nativeShapeArtifactContractHash(approved)
      )
        throw new Error('正式需求或验收内容改变，必须通过 Shape 修订，不能以注释复核代替确认');
    }
  }
  return formal ? { ...scope, formalPrefixes: ['.comet'] } : scope;
}
