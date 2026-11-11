import path from 'node:path';
import { atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import {
  nativeChildrenAcceptanceValidation,
  readNativeChildrenContract,
} from './native-children.js';
import {
  mergeNativeDeltaAgainstCurrent,
  parseNativeDelta,
  renderNativeDelta,
} from './native-delta-spec.js';
import { withNativeMutation } from './native-mutation.js';
import { sameNativePortableAcceptance } from './native-portable-acceptance.js';
import {
  discoverNativePortableSpecChanges,
  readNativePortableAcceptance,
} from './native-portable-requirements.js';
import {
  nativePortableChangeDir,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import { returnNativePortableStateToFinalVerificationLocked } from './native-portable-transitions.js';
import type { NativePortableSpecChange, NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

/** 重合并已确认 Delta 并绑定新输入；调用者须持有 Native mutation lock。 */
export async function rebaseNativePortableDeltasLocked(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<{ state: NativePortableState; rebased: boolean; capabilities: string[] }> {
  const changeRoot = nativePortableChangeDir(options.paths, options.state.name);
  const specChanges = await discoverNativePortableSpecChanges(options);
  const nextSpecChanges = [...specChanges];
  const capabilities: string[] = [];
  const pending: Array<{
    readonly index: number;
    readonly spec: NativePortableSpecChange;
    readonly originalDeltaText: string;
    readonly originalSourceText: string;
    readonly deltaText: string;
    readonly sourceText: string;
  }> = [];

  for (const [index, spec] of specChanges.entries()) {
    if (!spec.delta_source || !spec.source) continue;
    const deltaText = await readNativeBoundedTextFile({
      root: changeRoot,
      ref: spec.delta_source,
      maxBytes: null,
      includeHash: false,
    });
    const delta = parseNativeDelta(deltaText.text);
    let canonicalText = '';
    try {
      canonicalText = (
        await readNativeBoundedTextFile({
          root: options.paths.specsDir,
          ref: `${spec.capability}/spec.md`,
          maxBytes: null,
          includeHash: false,
        })
      ).text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const merged = mergeNativeDeltaAgainstCurrent({
      currentMarkdown: canonicalText,
      delta,
    });
    const source = await readNativeBoundedTextFile({
      root: changeRoot,
      ref: spec.source,
      maxBytes: null,
      includeHash: false,
    });
    if (source.text === merged.markdown) continue;
    pending.push({
      index,
      spec,
      originalDeltaText: deltaText.text,
      originalSourceText: source.text,
      deltaText: renderNativeDelta({ ...delta, base_version: delta.base_version + 1 }),
      sourceText: merged.markdown,
    });
    nextSpecChanges[index] = {
      ...spec,
    };
    capabilities.push(spec.capability);
  }

  if (capabilities.length === 0) {
    return { state: options.state, rebased: false, capabilities };
  }
  let stateWritten = false;
  try {
    for (const entry of pending) {
      await atomicWriteText(
        path.join(changeRoot, ...entry.spec.delta_source!.split('/')),
        entry.deltaText,
        { containedRoot: options.paths.nativeRoot },
      );
      await atomicWriteText(
        path.join(changeRoot, ...entry.spec.source!.split('/')),
        entry.sourceText,
        {
          containedRoot: options.paths.nativeRoot,
        },
      );
    }
    const rebasedStateForShape = { ...options.state, spec_changes: nextSpecChanges };
    const shape = await readNativePortableAcceptance({
      paths: options.paths,
      state: rebasedStateForShape,
      specChanges: nextSpecChanges,
    });
    if (!sameNativePortableAcceptance(options.state.acceptance, shape.acceptance)) {
      throw new Error(
        'Native delta rebase changed the confirmed acceptance scope; explicit Shape confirmation is required',
      );
    }
    await readNativeChildrenContract({
      changeDir: changeRoot,
      acceptanceIds: shape.acceptance.map(({ id }) => id),
      validation: nativeChildrenAcceptanceValidation({
        ...rebasedStateForShape,
        acceptance: shape.acceptance,
      }),
    });
    const state = await writePortableMutation({
      paths: options.paths,
      previous: options.state,
      next: {
        ...options.state,
        state_version: options.state.state_version + 1,
        spec_changes: nextSpecChanges,
      },
    });
    stateWritten = true;
    return { state, rebased: true, capabilities };
  } catch (error) {
    if (!stateWritten) {
      for (const entry of pending) {
        await atomicWriteText(
          path.join(changeRoot, ...entry.spec.delta_source!.split('/')),
          entry.originalDeltaText,
          { containedRoot: options.paths.nativeRoot },
        );
        await atomicWriteText(
          path.join(changeRoot, ...entry.spec.source!.split('/')),
          entry.originalSourceText,
          { containedRoot: options.paths.nativeRoot },
        );
      }
    }
    throw error;
  }
}

/** Rebase and return a passed Native change to the final Verify boundary. */
export async function rebaseNativePortableDeltas(options: {
  paths: NativeProjectPaths;
  name: string;
  reason?: string;
}): Promise<NativePortableState> {
  return withNativeMutation(options.paths, async () => {
    const state = await readNativePortableChange(options.paths, options.name);
    const result = await rebaseNativePortableDeltasLocked({ paths: options.paths, state });
    if (!result.rebased) return state;
    return returnNativePortableStateToFinalVerificationLocked({
      paths: options.paths,
      state: result.state,
      reason:
        options.reason ??
        'Native canonical Spec changed independently; the delta was re-based before fresh verification.',
    });
  });
}
