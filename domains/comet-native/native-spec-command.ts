import { nativePortableContinuation } from './native-portable-continuation.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { migrateNativeLegacyChangeToPortable } from './native-portable-migration-runtime.js';
import {
  isNativePortableChange,
  markNativePortableSpecRemoval,
  syncNativePortableSpecReferences,
} from './native-portable-runtime.js';
import {
  assertNoArguments,
  configuredPaths,
  NativeUsageError,
  requiredPositional,
  success,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeSpecCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const subcommand = requiredPositional(args, 'spec subcommand');
  if (subcommand === 'sync') {
    const inputFile = takeOption(args, '--input');
    const name = requiredPositional(args, 'change name');
    const capability = requiredPositional(args, 'capability');
    assertNoArguments(args);
    if (!inputFile) throw new NativeUsageError('spec sync requires --input <json-file>');
    const file = path.resolve(projectRoot, inputFile);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      throw new NativeUsageError('Spec sync input must be a bounded regular JSON file');
    const input = JSON.parse(await fs.readFile(file, 'utf8'));
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).sort().join(',') !==
        'actor,affectedAcceptanceIds,expectedStateVersion,reason,replacements' ||
      typeof input.actor !== 'string' ||
      typeof input.reason !== 'string' ||
      !Number.isSafeInteger(input.expectedStateVersion) ||
      !Array.isArray(input.affectedAcceptanceIds) ||
      !input.affectedAcceptanceIds.every((id: unknown) => typeof id === 'string') ||
      !Array.isArray(input.replacements) ||
      !input.replacements.every(
        (item: unknown) =>
          item &&
          typeof item === 'object' &&
          Object.keys(item).sort().join(',') === 'from,to' &&
          typeof (item as { from: unknown }).from === 'string' &&
          typeof (item as { to: unknown }).to === 'string',
      )
    )
      throw new NativeUsageError('Spec sync input fields are invalid');
    const { paths } = await configuredPaths(projectRoot);
    const state = await syncNativePortableSpecReferences({ ...input, paths, name, capability });
    return success(
      'spec sync',
      { ...state, continuation: nativePortableContinuation(state) },
      `Synced Native spec references in ${name}\n`,
    );
  }
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
