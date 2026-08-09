import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { createNativePortableChange } from '../../../domains/comet-native/native-portable-runtime.js';
import { nativeSelectCommand } from '../../../domains/comet-native/native-select-command.js';
import {
  inspectNativePortableStatus,
  listNativePortableStatus,
} from '../../../domains/comet-native/native-portable-status.js';

describe('Native portable status', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('projects the portable loop even when local execution is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-status-v2-'));
    roots.push(root);
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, config);
    const paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'portable-status', language: 'en' });
    await fs.rm(path.join(paths.changesRuntimeDir, 'portable-status'), {
      recursive: true,
      force: true,
    });

    const status = await inspectNativePortableStatus({
      paths,
      name: 'portable-status',
      details: true,
    });
    expect(status).toMatchObject({
      schema: 'comet.native.status.v2',
      phase: 'shape',
      loop: { stage: 'shape', iteration: 0, attempt: 0 },
      localExecution: { status: 'missing', operation: null },
      continuation: { action: 'confirm-shape' },
    });
    expect((await listNativePortableStatus({ paths })).items).toHaveLength(1);
    await expect(nativeSelectCommand(['portable-status'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        selected: 'portable-status',
        continuation: { schema: 'comet.native.continuation.v2', action: 'confirm-shape' },
      },
    });
  });

  it('does not expose a malformed local overlay as available execution state', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-status-invalid-'));
    roots.push(root);
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, config);
    const paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'invalid-overlay', language: 'en' });
    await fs.writeFile(
      path.join(paths.changesRuntimeDir, 'invalid-overlay', 'state.json'),
      JSON.stringify({ basedOnStateVersion: 1, execution: { status: 'made-up' } }),
    );

    await expect(
      inspectNativePortableStatus({ paths, name: 'invalid-overlay' }),
    ).resolves.toMatchObject({
      localExecution: { status: 'invalid', operation: null },
    });
  });
});
