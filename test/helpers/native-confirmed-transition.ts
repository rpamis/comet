import { readNativeChange } from '../../domains/comet-native/native-change.js';
import { advanceNativeChange as advanceRuntimeNativeChange } from '../../domains/comet-native/native-transitions.js';
import type { NativeClarificationMode } from '../../domains/comet-native/native-types.js';
import { nativeVerificationFixtureReceipt } from './native-verification.js';

type AdvanceOptions = Omit<
  Parameters<typeof advanceRuntimeNativeChange>[0],
  'clarificationMode'
> & {
  clarificationMode?: NativeClarificationMode;
};

/**
 * Advance fixtures that are not testing clarification itself through the
 * mandatory shared-understanding confirmation at Shape.
 */
export async function advanceNativeChange(options: AdvanceOptions) {
  let state;
  try {
    state = await readNativeChange(options.paths, options.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return advanceRuntimeNativeChange({
      ...options,
      clarificationMode: options.clarificationMode ?? 'sequential',
    });
  }
  const evidence =
    state.phase === 'verify' &&
    options.evidence.verificationResult === 'pass' &&
    !options.evidence.verificationReceipt
      ? {
          ...options.evidence,
          verificationReceipt: await nativeVerificationFixtureReceipt({
            paths: options.paths,
            name: options.name,
          }),
        }
      : state.phase === 'shape' && options.evidence.confirmed === undefined
        ? { ...options.evidence, confirmed: true }
        : options.evidence;
  return advanceRuntimeNativeChange({
    ...options,
    clarificationMode: options.clarificationMode ?? 'sequential',
    evidence,
  });
}
