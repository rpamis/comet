import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import {
  errorResult,
  projectRootFrom,
  render,
  takeFlag,
  takeOption,
} from '../../domains/comet-native/native-cli-shared.js';
import {
  finishNativeChangeCreation,
  prepareNativeChangeCreation,
} from '../../domains/comet-native/native-new-command.js';
import { nativePortableContinuation } from '../../domains/comet-native/native-portable-continuation.js';
import { createNativePortableChange } from '../../domains/comet-native/native-portable-requirements.js';
import { assertChangeNotSdkOwned } from '../../domains/workflow-contract/change-runtime-owner.js';
import { withNativeCommandRecovery } from '../../domains/comet-native/native-command-recovery.js';

/** Provision an existing legacy-format change for recovery tests without reopening the public creation path. */
export async function createNativeCompatFixture(args: string[], projectRoot: string) {
  if (takeOption(args, '--runtime') !== 'compat') throw new Error('Expected a compat fixture');
  const name = args[0];
  await assertChangeNotSdkOwned(projectRoot, 'native', name);
  const creation = await prepareNativeChangeCreation(args, projectRoot);
  await assertChangeNotSdkOwned(creation.projectRoot, 'native', name);
  const state = await createNativePortableChange({
    paths: creation.paths,
    name,
    language: creation.language,
    workspaceBinding: creation.prepared.binding,
    ...(creation.initialProjectConfig
      ? { initialProjectConfig: creation.initialProjectConfig }
      : {}),
  });
  return finishNativeChangeCreation(creation, state, () => ({
    continuation: nativePortableContinuation(state),
  }));
}

export function requestsNativeCompatFixture(argv: readonly string[]): boolean {
  return argv[0] === 'new' && argv[argv.indexOf('--runtime') + 1] === 'compat';
}

export async function runNativeCliWithCompatFixture(argv: readonly string[]) {
  if (!requestsNativeCompatFixture(argv)) return runNativeCli(argv);
  const args = argv.slice(1);
  const json = takeFlag(args, '--json');
  const verbose = takeFlag(args, '--verbose');
  const projectRoot = await projectRootFrom(takeOption(args, '--project-root'));
  const name = args[0];
  const result = await createNativeCompatFixture(args, projectRoot).catch((error) =>
    errorResult('new', error),
  );
  return render(await withNativeCommandRecovery(result, { projectRoot, name }), json, verbose);
}
