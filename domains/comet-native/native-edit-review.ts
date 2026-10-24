import { nativeEditReviewScope } from './native-edit-review-scope.js';
export { nativeEditReviewScope } from './native-edit-review-scope.js';
import {
  captureNativeShapeReviewAnchor,
  nativeShapeReviewAnchorMatches,
} from './native-shape-review-evidence.js';
import { readNativeApprovedShapeSemanticSnapshot } from './native-portable-requirements.js';
import path from 'node:path';
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
  approvedEditFingerprint,
  type EditReviewScope,
} from '../workflow-contract/edit-review.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativePortableState } from './native-portable-types.js';

export async function assertNativeEditReviewsComplete(
  paths: NativeProjectPaths,
  state: NativePortableState,
): Promise<void> {
  if (state.builder_handoff) await assertEditReviewsComplete(nativeEditReviewScope(paths, state));
}

/** 正式材料仅开放已批准契约不变的注释差异，不开放任意文档给通用复核。 */
export async function nativeEditReviewPreparationScope(
  paths: NativeProjectPaths,
  state: NativePortableState,
  request: CometHookRequest,
): Promise<EditReviewScope> {
  const scope = nativeEditReviewScope(paths, state);
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
    const before = await readNativeBoundedTextFile({ root: paths.projectRoot, ref: relative });
    const after = proposedCometHookFileContent(writes[0], before.text);
    if (after === null) throw new Error('无法完整重建正式材料差异');
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
  return formal ? { ...scope, formalPrefixes: [] } : scope;
}
