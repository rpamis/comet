import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  defaultProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../domains/comet-native/native-portable-state.js';
import { registerNativeSdkStartOwner } from '../../domains/comet-native/native-sdk-application.js';
import { createNativeSdkRuntime } from '../../domains/comet-native/native-runtime-ownership.js';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';

/** Start a supported legacy protocol through its real factory, including its portable projection. */
export async function createLegacyNativeSdkChange(
  projectRoot: string,
  name: string,
  version: '1' | '2' | '3' = '1',
) {
  const config = (await readProjectConfig(projectRoot)) ?? defaultProjectConfig('docs', 'en');
  await writeProjectConfig(projectRoot, config);
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  await ensureNativeDirectories(paths);
  const changeDir = path.join(paths.changesDir, name);
  await fs.mkdir(changeDir, { recursive: true });
  const request = {
    operation: 'start',
    runId: name,
    workflow: { id: 'comet-native', version },
    input: { name, artifactRootRef: paths.artifactRootRef },
    initialState: createNativePortableState({
      name,
      language: config.native.language,
      nextAction: 'prepare-shape-confirmation',
    }),
  };
  if (version !== '1') {
    await registerNativeSdkStartOwner({
      projectRoot,
      name,
      artifactRootRef: paths.artifactRootRef,
    });
    const run = await createNativeSdkRuntime(projectRoot).start({
      runId: name,
      workflow: request.workflow,
      input: request.input,
      initialState: request.initialState,
    });
    return { run, paths, changeDir };
  }
  const file = path.join(paths.workspaceRuntimeRoot, `legacy-start-${name}.json`);
  await fs.writeFile(file, JSON.stringify(request));
  try {
    const result = await runtimeDispatchCommand({
      projectRoot,
      application: 'native',
      request: file,
    });
    if (result.exitCode !== 0) throw new Error(JSON.stringify(result));
  } finally {
    await fs.rm(file, { force: true });
  }
  const run = await createNativeSdkRuntime(projectRoot).inspect(name);
  return { run, paths, changeDir };
}
