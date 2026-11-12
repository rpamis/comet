import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import {
  assertNoArguments,
  configuredPaths,
  NativeUsageError,
  requiredPositional,
  success,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import {
  disassociateNativePortableCapability,
  isNativePortableChange,
  markNativePortableSpecRemoval,
  syncNativePortableSpecReferences,
} from './native-portable-runtime.js';
import { resolveNativeSdkCommandRoot } from './native-runtime-ownership.js';
import { disassociateNativeSdkCapability } from './native-sdk-disassociate-command.js';
import { removeNativeSdkCapability } from './native-sdk-remove-command.js';

export async function nativeSpecCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const subcommand = requiredPositional(args, 'spec subcommand');
  if (subcommand === 'snapshot') {
    throw new NativeUsageError('内容证明快照已移除；请直接读取正式材料，由 Agent 判断修改影响。');
  }
  if (subcommand === 'sync') {
    const inputFile = takeOption(args, '--input');
    const name = requiredPositional(args, 'change name');
    const capability = requiredPositional(args, 'capability');
    assertNoArguments(args);
    if (!inputFile) throw new NativeUsageError('spec sync requires --input <json-file>');
    const commandRoot = await resolveNativeSdkCommandRoot(projectRoot, name);
    if (await readSdkChangeOwner(commandRoot, 'native', name)) {
      throw new NativeUsageError(
        `Native SDK spec sync does not bypass Run acceptance. Edit the proposal in Shape, or use comet native next ${name} --revise-requirements from Verify or Archive before changing requirements.`,
      );
    }
    const file = path.resolve(projectRoot, inputFile);
    const stat = await fs.lstat(file).catch(() => {
      throw new NativeUsageError(`Spec sync input file is unreadable: ${inputFile}`);
    });
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new NativeUsageError('Spec sync input must be a regular JSON file');
    let input;
    try {
      input = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      throw new NativeUsageError('Spec sync input must contain readable valid JSON');
    }
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
  if (subcommand === 'disassociate') {
    const name = requiredPositional(args, 'change name');
    const expectedStateVersion = takeOption(args, '--expected-state-version');
    const expectedAction = takeOption(args, '--expected-action');
    if (expectedStateVersion === undefined || expectedAction === undefined) {
      throw new NativeUsageError(
        '--expected-state-version and --expected-action are required for spec disassociate',
      );
    }
    if (
      !/^[1-9]\d*$/u.test(expectedStateVersion) ||
      !Number.isSafeInteger(Number(expectedStateVersion))
    ) {
      throw new NativeUsageError('--expected-state-version must be a positive integer');
    }
    if (expectedAction !== 'disassociate-capability') {
      throw new NativeUsageError(
        '--expected-action for spec disassociate must be disassociate-capability',
      );
    }
    assertNoArguments(args);
    const commandRoot = await resolveNativeSdkCommandRoot(projectRoot, name);
    if (await readSdkChangeOwner(commandRoot, 'native', name)) {
      return disassociateNativeSdkCapability({
        projectRoot: commandRoot,
        name,
        expectedStateVersion: Number(expectedStateVersion),
      });
    }
    const { paths } = await configuredPaths(projectRoot);
    if (!(await isNativePortableChange(paths, name))) {
      throw new NativeUsageError('spec disassociate requires a current portable Native change');
    }
    const state = await disassociateNativePortableCapability({
      paths,
      name,
      expectedContinuation: {
        stateVersion: Number(expectedStateVersion),
        action: 'disassociate-capability',
      },
    });
    return success(
      'spec disassociate',
      { ...state, continuation: nativePortableContinuation(state) },
      `Revoked Native capability association in ${name}\n`,
    );
  }
  if (subcommand !== 'remove') {
    throw new NativeUsageError(`Unknown spec command: ${subcommand}`);
  }
  const name = requiredPositional(args, 'change name');
  const capability = requiredPositional(args, 'capability');
  assertNoArguments(args);

  const commandRoot = await resolveNativeSdkCommandRoot(projectRoot, name);
  if (await readSdkChangeOwner(commandRoot, 'native', name)) {
    return removeNativeSdkCapability({ projectRoot: commandRoot, name, capability });
  }

  const { paths } = await configuredPaths(projectRoot);
  if (!(await isNativePortableChange(paths, name))) {
    return {
      command: 'spec remove',
      exitCode: 65,
      data: {
        change: name,
        migrationRequired: true,
        repairCommand: `comet native doctor ${name} --repair`,
      },
      error: {
        code: 'invalid-data',
        message: `Native change ${name} requires explicit business import; run comet native doctor ${name} --repair`,
      },
    };
  }
  const state = await markNativePortableSpecRemoval({ paths, name, capability });
  return success(
    'spec remove',
    { ...state, continuation: nativePortableContinuation(state) },
    `Marked Native capability ${capability} for removal in ${name}\n`,
  );
}
