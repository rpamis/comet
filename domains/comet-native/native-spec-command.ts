import { nativePortableContinuation } from './native-portable-continuation.js';
import { migrateNativeLegacyChangeToPortable } from './native-portable-migration-runtime.js';
import {
  isNativePortableChange,
  markNativePortableSpecRemoval,
} from './native-portable-runtime.js';
import {
  assertNoArguments,
  configuredPaths,
  NativeUsageError,
  requiredPositional,
  success,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeSpecCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const subcommand = requiredPositional(args, 'spec subcommand');
  if (subcommand !== 'remove') {
    throw new NativeUsageError(`Unknown spec command: ${subcommand}`);
  }
  const name = requiredPositional(args, 'change name');
  const capability = requiredPositional(args, 'capability');
  assertNoArguments(args);

  const { paths } = await configuredPaths(projectRoot);
  if (!(await isNativePortableChange(paths, name))) {
    await migrateNativeLegacyChangeToPortable({ paths, name });
  }
  const state = await markNativePortableSpecRemoval({ paths, name, capability });
  return success(
    'spec remove',
    { ...state, continuation: nativePortableContinuation(state) },
    `Marked Native capability ${capability} for removal in ${name}\n`,
  );
}
