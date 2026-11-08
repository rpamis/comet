import path from 'node:path';
import { createHash } from 'node:crypto';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { atomicWriteJson, atomicWriteText } from './native-atomic-file.js';
import { applyNativeDelta, nativeTotalSpecHash, parseNativeDelta } from './native-delta-spec.js';
import { ensureProtectedProjectDirectory } from '../workflow-contract/protected-project-path.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativePortableSpecChange, NativePortableState } from './native-portable-types.js';

interface MaterializationReceipt {
  schema: 'comet.native.shape-materialization.v1';
  targets: Record<string, { baseHash: string; targetHash: string }>;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** 调用者持有 Native 短写锁；收据只证明衍生文件来源，不维护阶段或批准。 */
export async function materializeNativeDeltaTargetsLocked(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  specChanges: readonly NativePortableSpecChange[];
}): Promise<void> {
  const { paths, state } = options;
  if (state.phase !== 'shape' || state.status !== 'active' || state.shape_confirmation_hash) return;
  const specs = options.specChanges.filter((spec) => spec.delta_source && spec.source);
  if (!specs.length) return;
  const changeRoot = path.join(paths.changesDir, state.name);
  const receiptRef = `shape-materialization/${state.name}.json`;
  let receipt: MaterializationReceipt = {
    schema: 'comet.native.shape-materialization.v1',
    targets: {},
  };
  try {
    receipt = JSON.parse(
      (await readNativeBoundedTextFile({ root: paths.runtimeDir, ref: receiptRef, maxBytes: null }))
        .text,
    );
    if (
      receipt.schema !== 'comet.native.shape-materialization.v1' ||
      !receipt.targets ||
      typeof receipt.targets !== 'object' ||
      Array.isArray(receipt.targets) ||
      Object.values(receipt.targets).some(
        (entry) =>
          !entry ||
          !/^[a-f0-9]{64}$/u.test(entry.baseHash) ||
          !/^[a-f0-9]{64}$/u.test(entry.targetHash),
      )
    )
      throw new Error('Native Shape materialization receipt is invalid');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const pending = [];
  for (const spec of specs) {
    const source = spec.source!;
    const baseline = await readNativeBoundedTextFile({
      root: paths.specsDir,
      ref: `${spec.capability}/spec.md`,
      maxBytes: null,
    });
    const deltaText = await readNativeBoundedTextFile({
      root: changeRoot,
      ref: spec.delta_source!,
      maxBytes: null,
    });
    const delta = parseNativeDelta(deltaText.text);
    if (delta.capability !== spec.capability)
      throw new Error('Native Delta capability does not match its target');
    const expected = applyNativeDelta({
      baselineMarkdown: baseline.text,
      delta,
      allowAlreadyApplied: true,
    });
    const target = await readNativeBoundedTextFile({
      root: changeRoot,
      ref: source,
      maxBytes: null,
    });
    const targetHash = hash(target.text);
    const alreadyMatches = nativeTotalSpecHash(target.text) === expected.result_hash;
    const previous = receipt.targets[source];
    if (
      !alreadyMatches &&
      target.text !== baseline.text &&
      !(previous?.baseHash === delta.base_hash && previous.targetHash === targetHash)
    )
      throw new Error(
        `Native target has independent edits: ${source}. Reconcile the target and Delta before preparing Shape.`,
      );
    pending.push({
      source,
      deltaRef: spec.delta_source!,
      baseline,
      deltaText,
      target,
      targetHash,
      text: alreadyMatches ? target.text : expected.markdown,
      baseHash: delta.base_hash,
    });
  }
  let changed = false;
  for (const entry of pending) {
    if (entry.text !== entry.target.text) {
      await atomicWriteText(path.join(changeRoot, ...entry.source.split('/')), entry.text, {
        containedRoot: paths.nativeRoot,
        async beforeCommit() {
          const [baseline, delta, target] = await Promise.all([
            readNativeBoundedTextFile({
              root: paths.specsDir,
              ref: entry.baseline.ref,
              maxBytes: null,
            }),
            readNativeBoundedTextFile({ root: changeRoot, ref: entry.deltaRef, maxBytes: null }),
            readNativeBoundedTextFile({ root: changeRoot, ref: entry.source, maxBytes: null }),
          ]);
          if (
            baseline.text !== entry.baseline.text ||
            delta.text !== entry.deltaText.text ||
            hash(target.text) !== entry.targetHash
          )
            throw new Error(
              'Native Shape materialization inputs changed; preserve edits and prepare again',
            );
        },
      });
    }
    const next = { baseHash: entry.baseHash, targetHash: hash(entry.text) };
    if (JSON.stringify(receipt.targets[entry.source]) !== JSON.stringify(next)) {
      receipt.targets[entry.source] = next;
      changed = true;
    }
  }
  if (changed) {
    await ensureProtectedProjectDirectory(paths.runtimeDir, 'shape-materialization', {
      label: 'Native Shape materialization receipts',
    });
    await atomicWriteJson(path.join(paths.runtimeDir, receiptRef), receipt, {
      containedRoot: paths.workspaceRuntimeRoot,
    });
  }
}
