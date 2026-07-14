import { promises as fs } from 'fs';
import path from 'path';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../domains/comet-native/native-paths.js';

export async function seedNativeRoot(projectRoot: string, artifactRoot: string): Promise<string> {
  await writeProjectConfig(projectRoot, defaultProjectConfig(artifactRoot));
  const paths = await nativeProjectPaths(projectRoot, artifactRoot);
  await fs.mkdir(path.join(paths.nativeRoot, 'specs', 'word-count'), { recursive: true });
  await fs.mkdir(path.join(paths.nativeRoot, 'changes', 'active-change'), { recursive: true });
  await fs.writeFile(
    path.join(paths.nativeRoot, 'specs', 'word-count', 'spec.md'),
    'count words\n',
  );
  await fs.writeFile(
    path.join(paths.nativeRoot, 'changes', 'active-change', 'payload.bin'),
    Buffer.from([0, 1, 2, 250, 255]),
  );
  return paths.nativeRoot;
}
