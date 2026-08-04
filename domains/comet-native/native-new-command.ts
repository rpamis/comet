import { createNativeChange } from './native-change.js';
import { defaultProjectConfig, readProjectConfig } from './native-config.js';
import { inspectNativeStatus } from './native-diagnostics.js';
import { ensureNativeDirectories, nativeProjectPaths } from './native-paths.js';
import { selectNativeChange } from './native-selection.js';
import {
  readNativeWorkspaceIdentity,
  resolveNativeWorkspaceBinding,
  type NativeWorkspaceIsolation,
} from './native-workspace.js';
import {
  assertNoArguments,
  languageOption,
  NativeUsageError,
  requiredPositional,
  success,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeNewCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  let config = await readProjectConfig(projectRoot);
  const language = languageOption(args, config?.native.language ?? 'en');
  const isolation = (takeOption(args, '--isolation') ?? 'current') as NativeWorkspaceIsolation;
  if (isolation !== 'current' && isolation !== 'branch' && isolation !== 'worktree') {
    throw new NativeUsageError('--isolation must be current, branch, or worktree');
  }
  const changeBranch = takeOption(args, '--change-branch');
  const targetBranch = takeOption(args, '--target-branch');
  assertNoArguments(args);
  const initialProjectConfig = config === null ? defaultProjectConfig('docs', language) : undefined;
  if (!config) {
    config = initialProjectConfig!;
  }
  if (config.native.pending_root_move) {
    throw new Error(`Native root move ${config.native.pending_root_move.id} is incomplete`);
  }
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  await ensureNativeDirectories(paths);
  const workspaceBinding = resolveNativeWorkspaceBinding({
    projectRoot,
    isolation,
    ...(changeBranch ? { changeBranch } : {}),
    ...(targetBranch ? { targetBranch } : {}),
  });
  const state = await createNativeChange({
    paths,
    name,
    language,
    workspaceBinding,
    ...(initialProjectConfig ? { initialProjectConfig } : {}),
  });
  config = (await readProjectConfig(projectRoot)) ?? config;
  await selectNativeChange(paths, state.name);
  const workspace = await readNativeWorkspaceIdentity(paths, state.name);
  const status = await inspectNativeStatus(paths, state.name, {
    clarificationMode: config.native.clarification_mode,
    maxVerifyFailures: config.native.max_verify_failures,
  });
  return success(
    'new',
    { ...state, workspace, continuation: status.continuation },
    `Created Native change ${state.name}\n`,
  );
}
