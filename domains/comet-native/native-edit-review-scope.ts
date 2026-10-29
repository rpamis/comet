import path from 'node:path';
import type { EditReviewScope } from '../workflow-contract/edit-review.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativePortableState } from './native-portable-types.js';

export function nativeEditReviewScope(
  paths: NativeProjectPaths,
  state: NativePortableState,
): EditReviewScope {
  const candidateKey =
    state.builder_handoff?.candidate_id ??
    (state.phase === 'build' && state.shape_confirmation_hash
      ? `shape:${state.shape_confirmation_hash}:${state.loop.iteration}`
      : null);
  if (!candidateKey) throw new Error('Native 内容判断需要已批准 Shape 或当前候选');
  return editReviewScope(paths, state, candidateKey);
}

function editReviewScope(
  paths: NativeProjectPaths,
  state: NativePortableState,
  candidateKey: string,
): EditReviewScope {
  return {
    projectRoot: paths.projectRoot,
    runtimeRoot: paths.workspaceRuntimeRoot,
    workflow: 'native',
    change: state.name,
    candidateKey,
    formalPrefixes: [
      '.comet',
      path.relative(paths.projectRoot, paths.nativeRoot).replaceAll('\\', '/'),
    ],
  };
}

/** 正式材料跟随同一次 Shape 批准，独立于实现候选和执行轮次。 */
export function nativeFormalEditReviewScope(
  paths: NativeProjectPaths,
  state: NativePortableState,
): EditReviewScope {
  if (!state.shape_confirmation_hash) throw new Error('正式材料判断需要已批准 Shape');
  return {
    ...editReviewScope(paths, state, `formal:${state.shape_confirmation_hash}`),
    judgment: 'agent',
  };
}
