import path from 'node:path';
import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import { nativeProjectPaths } from '../../domains/comet-native/native-paths.js';
import { inspectNativeSdkRun } from '../../domains/comet-native/native-runtime-ownership.js';

/** 通过当前公开入口创建业务测试 Run；旧版兼容测试加载冻结的真实发布数据。 */
export async function createNativeSdkTestChange(projectRoot: string, name: string) {
  const result = await runNativeCli(['new', name, '--project-root', projectRoot, '--json']);
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  const { run, artifactRootRef } = await inspectNativeSdkRun(projectRoot, name);
  const paths = await nativeProjectPaths(projectRoot, artifactRootRef);
  return { run, paths, changeDir: path.join(paths.changesDir, name) };
}
