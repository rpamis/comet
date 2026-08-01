import { doctorNativeProject } from './native-doctor.js';
import {
  assertNoArguments,
  doctorPaths,
  NativeUsageError,
  success,
  takeFlag,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeDoctorCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const repair = takeFlag(args, '--repair');
  const recoveryStrategy = takeOption(args, '--strategy');
  if (
    recoveryStrategy !== undefined &&
    recoveryStrategy !== 'continue' &&
    recoveryStrategy !== 'rollback'
  ) {
    throw new NativeUsageError('--strategy must be continue or rollback');
  }
  const name = args[0]?.startsWith('--') ? undefined : args.shift();
  assertNoArguments(args);
  const paths = await doctorPaths(projectRoot);
  const result = await doctorNativeProject({
    paths,
    ...(name ? { name } : {}),
    repair,
    ...(recoveryStrategy ? { recoveryStrategy } : {}),
  });
  return result.healthy
    ? success('doctor', result)
    : {
        command: 'doctor',
        exitCode: 65,
        data: result,
        error: { code: 'invalid-data', message: 'Native project needs attention' },
      };
}
