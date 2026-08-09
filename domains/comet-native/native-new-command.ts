import { defaultProjectConfig, readProjectConfig } from './native-config.js';
import { ensureNativeDirectories, nativeProjectPaths } from './native-paths.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { createNativePortableChange } from './native-portable-runtime.js';
import { selectNativeChange } from './native-selection.js';
import { prepareNativeWorkspace } from './native-workspace-preparation.js';
import { type NativeWorkspaceIsolation } from './native-workspace.js';
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
  const worktreePath = takeOption(args, '--worktree-path');
  assertNoArguments(args);
  const sourceConfig = config;
  if (config?.native.pending_root_move) {
    throw new Error(`Native root move ${config.native.pending_root_move.id} is incomplete`);
  }
  const prepared = await prepareNativeWorkspace({
    projectRoot,
    name,
    isolation,
    ...(changeBranch ? { changeBranch } : {}),
    ...(targetBranch ? { targetBranch } : {}),
    ...(worktreePath ? { worktreePath } : {}),
    sourceConfig,
  });
  projectRoot = prepared.projectRoot;
  config = await readProjectConfig(projectRoot);
  const initialProjectConfig = config === null ? defaultProjectConfig('docs', language) : undefined;
  if (!config) config = initialProjectConfig!;
  if (config.native.pending_root_move) {
    throw new Error(`Native root move ${config.native.pending_root_move.id} is incomplete`);
  }
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  await ensureNativeDirectories(paths);
  const state = await createNativePortableChange({
    paths,
    name,
    language,
    workspaceBinding: prepared.binding,
    ...(initialProjectConfig ? { initialProjectConfig } : {}),
  });
  await selectNativeChange(paths, state.name);
  return success(
    'new',
    {
      ...state,
      preparation: prepared.preparation,
      continuation: nativePortableContinuation(state),
    },
    `Created Native change ${state.name}\n`,
  );
}
