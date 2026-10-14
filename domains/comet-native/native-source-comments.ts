import {
  classifyEditImpact,
  editSemanticFingerprint,
  supportsEditFingerprint,
} from '../workflow-contract/edit-impact.js';

// 保留原内部入口，Native 和 Classic 的编辑判定统一由共享契约提供。
export const nativeSourceCommentFingerprint = editSemanticFingerprint;
export const supportsNativeSourceComments = supportsEditFingerprint;
export function isNativeOrdinaryCommentEdit(file: string, before: string, after: string): boolean {
  return ['unchanged', 'non-behavioral'].includes(classifyEditImpact(file, before, after).kind);
}
