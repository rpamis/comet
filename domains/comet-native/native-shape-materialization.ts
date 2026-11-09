import path from 'node:path';
import { atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { applyNativeDelta, parseNativeDelta } from './native-delta-spec.js';
import type { NativePortableSpecChange, NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

/** Shape 中生成目标正文；已有独立编辑由 Agent 合并，不保存来源指纹。 */
export async function materializeNativeDeltaTargetsLocked(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  specChanges: readonly NativePortableSpecChange[];
}): Promise<void> {
  const { paths, state } = options;
  if (state.phase !== 'shape' || state.status !== 'active') return;
  const changeRoot = path.join(paths.changesDir, state.name);
  for (const spec of options.specChanges) {
    if (spec.operation !== 'modify' || !spec.delta_source || !spec.source) continue;
    const baseline = await readNativeBoundedTextFile({
      root: paths.specsDir,
      ref: spec.capability + '/spec.md',
      maxBytes: null,
      includeHash: false,
    });
    const deltaSource = await readNativeBoundedTextFile({
      root: changeRoot,
      ref: spec.delta_source,
      maxBytes: null,
      includeHash: false,
    });
    const delta = parseNativeDelta(deltaSource.text);
    if (delta.capability !== spec.capability)
      throw new Error('Native Delta capability does not match its target');
    const expected = applyNativeDelta({
      baselineMarkdown: baseline.text,
      delta,
      allowAlreadyApplied: true,
    });
    const target = await readNativeBoundedTextFile({
      root: changeRoot,
      ref: spec.source,
      maxBytes: null,
      includeHash: false,
    });
    if (target.text === expected.markdown) continue;
    if (target.text !== baseline.text)
      throw new Error(
        'Native target has independent edits: ' +
          spec.source +
          '. Reconcile the target and Delta before preparing Shape.',
      );
    await atomicWriteText(path.join(changeRoot, ...spec.source.split('/')), expected.markdown, {
      containedRoot: paths.nativeRoot,
    });
  }
}
