import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { moveNativeRoot } from './native-root-move.js';
import {
  assertNoArguments,
  NativeUsageError,
  requiredPositional,
  success,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeRootCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const subcommand = requiredPositional(args, 'root subcommand');
  if (subcommand === 'show') {
    assertNoArguments(args);
    const config = await readProjectConfig(projectRoot);
    if (!config) throw new Error('.comet/config.yaml was not found');
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
    return success('root show', {
      projectRoot,
      artifactRoot: config.native.artifact_root,
      language: config.native.language,
      nativeRoot: paths.nativeRoot,
      pendingRootMove: config.native.pending_root_move ?? null,
    });
  }
  if (subcommand === 'move') {
    const target = requiredPositional(args, 'artifact root');
    assertNoArguments(args);
    const result = await moveNativeRoot({ projectRoot, toArtifactRoot: target });
    return success('root move', result, `Moved Comet Native to ${result.toNativeRoot}\n`);
  }
  throw new NativeUsageError(`Unknown root command: ${subcommand}`);
}
