import {
  assertNoArguments,
  NativeUsageError,
  requiredPositional,
  success,
  takeFlag,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';
import {
  exportNativeSupervisorTransfer,
  importNativeSupervisorTransfer,
} from './native-sdk-supervisor-transfer.js';

export async function nativeTransferCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const action = requiredPositional(args, 'transfer action');
  if (action === 'export') {
    const name = requiredPositional(args, 'change name');
    const outputDir = takeOption(args, '--output');
    const confirmedStopped = takeFlag(args, '--confirmed-stopped');
    assertNoArguments(args);
    if (!outputDir) throw new NativeUsageError('transfer export requires --output <directory>');
    const result = await exportNativeSupervisorTransfer({
      projectRoot,
      name,
      outputDir,
      confirmedStopped,
    });
    return success(
      'transfer export',
      result,
      `Exported Supervisor work to ${result.packageDir}. Keep this package private; it contains source files.\n`,
    );
  }
  if (action === 'import') {
    const inputDir = takeOption(args, '--input');
    assertNoArguments(args);
    if (!inputDir) throw new NativeUsageError('transfer import requires --input <directory>');
    const result = await importNativeSupervisorTransfer({ projectRoot, inputDir });
    return success(
      'transfer import',
      result,
      `Imported Supervisor ${result.change}. Reconcile any Action whose outcome is unknown before continuing.\n`,
    );
  }
  throw new NativeUsageError(`Unknown transfer action: ${action}`);
}
