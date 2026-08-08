import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNativeChange } from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { listDiscoveredNativeStatusPage } from '../../../domains/comet-native/native-status-discovery.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';

describe('Native status discovery pagination', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-status-discovery-'));
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    await ensureNativeDirectories(paths);
    for (let index = 0; index < 25; index += 1) {
      await createNativeChange({
        paths,
        name: `change-${String(index).padStart(2, '0')}`,
        language: 'en',
      });
    }
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('keeps JSON mode in the public continuation command', async () => {
    const page = await listDiscoveredNativeStatusPage({ projectRoot });

    expect(page.nextCursor).not.toBeNull();
    expect(page.nextPageArgs).toEqual([
      'comet',
      'native',
      'status',
      '--cursor',
      page.nextCursor,
      '--project-root',
      path.resolve(projectRoot),
      '--json',
    ]);
  });
});
