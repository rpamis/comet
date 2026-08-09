import {
  defaultProjectConfig,
  mergeNativeSnapshotExcludes,
  readProjectConfig,
  writeProjectConfig,
} from './native-config.js';
import { ensureCometProjectGitignore } from '../workflow-contract/project-gitignore.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
  normalizeArtifactRootRef,
} from './native-paths.js';
import {
  assertNoArguments,
  languageOption,
  success,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeInitCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const requestedRoot = takeOption(args, '--root');
  const existing = await readProjectConfig(projectRoot);
  const language = languageOption(args, existing?.native.language ?? 'en');
  assertNoArguments(args);
  if (existing?.native.pending_root_move) {
    throw new Error(`Native root move ${existing.native.pending_root_move.id} is incomplete`);
  }
  const artifactRoot = normalizeArtifactRootRef(
    requestedRoot ?? existing?.native.artifact_root ?? 'docs',
  );
  if (existing && requestedRoot && existing.native.artifact_root !== artifactRoot) {
    throw new Error(
      `Configured Native artifact root is ${existing.native.artifact_root}; refusing conflicting root ${artifactRoot}`,
    );
  }
  const config = existing
    ? {
        ...existing,
        native: {
          ...existing.native,
          language,
          snapshot: {
            ...existing.native.snapshot,
            exclude: mergeNativeSnapshotExcludes(existing.native.snapshot.exclude),
          },
        },
      }
    : defaultProjectConfig(artifactRoot, language);
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  await ensureNativeDirectories(paths);
  await ensureCometProjectGitignore(projectRoot);
  await writeProjectConfig(projectRoot, config);
  return success(
    'init',
    {
      projectRoot,
      artifactRoot: config.native.artifact_root,
      nativeRoot: paths.nativeRoot,
      language,
    },
    `Initialized Comet Native at ${paths.nativeRoot}\n`,
  );
}
