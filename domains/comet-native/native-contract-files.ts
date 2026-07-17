import {
  DEFAULT_NATIVE_ARTIFACT_MAX_BYTES,
  readNativeBoundedTextFile,
} from './native-bounded-file.js';
import {
  buildNativeContractSnapshot,
  type NativeContractSnapshot,
  type NativeContractSpecInput,
} from './native-contract.js';
import type { NativeSpecChange } from './native-types.js';

export const NATIVE_CONTRACT_FILE_LIMITS = {
  maxSpecs: 64,
  maxFileBytes: DEFAULT_NATIVE_ARTIFACT_MAX_BYTES,
  maxTotalBytes: 4 * 1024 * 1024,
} as const;

export interface NativeCollectedContract {
  contract: NativeContractSnapshot;
  sourceCount: number;
  totalBytes: number;
}

/**
 * Read the bounded change artifacts that form the user-visible contract.
 *
 * The collector returns hashes and derived acceptance only; source contents do not escape this
 * seam. Canonical specs are represented by the frozen base hashes already in each spec change.
 */
export async function collectNativeContractFiles(options: {
  changeDir: string;
  briefRef: string;
  specChanges: readonly NativeSpecChange[];
}): Promise<NativeCollectedContract> {
  if (options.specChanges.length > NATIVE_CONTRACT_FILE_LIMITS.maxSpecs) {
    throw new Error('Native contract exceeds its spec-count budget');
  }
  const brief = await readNativeBoundedTextFile({
    root: options.changeDir,
    ref: options.briefRef,
    maxBytes: NATIVE_CONTRACT_FILE_LIMITS.maxFileBytes,
  });
  let totalBytes = brief.size;
  const specs: NativeContractSpecInput[] = [];
  for (const change of options.specChanges) {
    if (change.operation === 'remove') {
      specs.push({
        capability: change.capability,
        operation: 'remove',
        source: null,
        baseHash: change.base_hash,
        markdown: null,
      });
      continue;
    }
    if (!change.source) {
      throw new Error(`Native contract ${change.capability} has no proposed spec source`);
    }
    const source = await readNativeBoundedTextFile({
      root: options.changeDir,
      ref: change.source,
      maxBytes: NATIVE_CONTRACT_FILE_LIMITS.maxFileBytes,
    });
    totalBytes += source.size;
    if (totalBytes > NATIVE_CONTRACT_FILE_LIMITS.maxTotalBytes) {
      throw new Error('Native contract exceeds its total byte budget');
    }
    specs.push({
      capability: change.capability,
      operation: change.operation,
      source: source.ref,
      baseHash: change.base_hash,
      markdown: source.text,
    });
  }
  return {
    contract: buildNativeContractSnapshot({
      briefSource: brief.ref,
      briefMarkdown: brief.text,
      specs,
    }),
    sourceCount: specs.filter((spec) => spec.source !== null).length + 1,
    totalBytes,
  };
}
