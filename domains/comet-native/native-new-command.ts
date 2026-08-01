import { createNativeChange } from './native-change.js';
import { defaultProjectConfig, readProjectConfig, writeProjectConfig } from './native-config.js';
import { inspectNativeStatus } from './native-diagnostics.js';
import { ensureNativeDirectories, nativeProjectPaths } from './native-paths.js';
import { selectNativeChange } from './native-selection.js';
import {
  assertNoArguments,
  languageOption,
  requiredPositional,
  success,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeNewCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  let config = await readProjectConfig(projectRoot);
  const language = languageOption(args, config?.native.language ?? 'en');
  assertNoArguments(args);
  const shouldWriteConfig = config === null;
  if (!config) {
    config = defaultProjectConfig('docs', language);
  }
  if (config.native.pending_root_move) {
    throw new Error(`Native root move ${config.native.pending_root_move.id} is incomplete`);
  }
  if (shouldWriteConfig) await writeProjectConfig(projectRoot, config);
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  await ensureNativeDirectories(paths);
  const state = await createNativeChange({
    paths,
    name,
    language,
  });
  await selectNativeChange(paths, state.name);
  const status = await inspectNativeStatus(paths, state.name, {
    clarificationMode: config.native.clarification_mode,
    maxVerifyFailures: config.native.max_verify_failures,
  });
  return success(
    'new',
    { ...state, continuation: status.continuation },
    `Created Native change ${state.name}\n`,
  );
}
