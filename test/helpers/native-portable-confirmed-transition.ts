import {
  confirmNativePortableShape as confirmRuntimeNativePortableShape,
  prepareNativePortableShapeConfirmation,
} from '../../domains/comet-native/native-portable-runtime.js';

type ConfirmOptions = Parameters<typeof confirmRuntimeNativePortableShape>[0];

/** Advance non-confirmation fixtures through the persisted Shape confirmation boundary. */
export async function confirmNativePortableShape(options: ConfirmOptions) {
  const {
    coordinationMode,
    expectedContinuation: _expectedContinuation,
    ...confirmation
  } = options;
  await prepareNativePortableShapeConfirmation({
    ...confirmation,
    ...(coordinationMode === undefined ? {} : { coordinationMode }),
  });
  return confirmRuntimeNativePortableShape(confirmation);
}
