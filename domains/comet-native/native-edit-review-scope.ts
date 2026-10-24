import path from 'node:path';
import type { EditReviewScope } from '../workflow-contract/edit-review.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativePortableState } from './native-portable-types.js';

export function nativeEditReviewScope(
  paths: NativeProjectPaths,
  state: NativePortableState,
): EditReviewScope {
  if (!state.builder_handoff) throw new Error('Native 编辑复核需要当前 Builder 候选');
  return {
    projectRoot: paths.projectRoot,
    runtimeRoot: paths.workspaceRuntimeRoot,
    workflow: 'native',
    change: state.name,
    candidateKey: state.builder_handoff.candidate_id,
    formalPrefixes: [
      '.comet',
      path.relative(paths.projectRoot, paths.nativeRoot).replaceAll('\\', '/'),
    ],
  };
}
