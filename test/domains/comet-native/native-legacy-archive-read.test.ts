import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';
import { collectNativeDashboardProjection } from '../../../domains/dashboard/native-collector.js';

const fixture = path.resolve('docs/comet/archive/2026-07-21-classic-config-block');

describe('Native legacy v1 archive handling', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-v1-archive-'));
    paths = await nativeProjectPaths(root, '.');
    await writeProjectConfig(root, defaultProjectConfig('.'));
    await fs.mkdir(paths.archiveDir, { recursive: true });
    await fs.cp(fixture, path.join(paths.archiveDir, '2026-07-21-classic-config-block'), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('keeps the historical archive visible through the production archived-change reader', async () => {
    await expect(collectNativeDashboardProjection(root)).resolves.toMatchObject({
      changes: [
        expect.objectContaining({
          name: 'classic-config-block',
          status: 'archived',
          archivedAt: '2026-07-21',
        }),
      ],
    });
  });
});
