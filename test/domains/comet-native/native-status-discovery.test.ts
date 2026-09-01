import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNativeChange } from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  inspectDiscoveredNativeStatus,
  listDiscoveredNativeStatusPage,
} from '../../../domains/comet-native/native-status-discovery.js';
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

  it('follows a signed cursor and ends pagination at the final page', async () => {
    const first = await listDiscoveredNativeStatusPage({ projectRoot });
    const second = await listDiscoveredNativeStatusPage({
      projectRoot,
      cursor: first.nextCursor,
    });

    expect(second.offset).toBe(first.items.length);
    expect(second.items.length).toBeGreaterThan(0);
    expect(second.nextCursor).toBeNull();
    expect(second.nextPageCommand).toBeNull();
    expect(second.nextPageArgs).toBeNull();
  });

  it('rejects missing, stale, malformed, and invalid-offset cursors', async () => {
    const first = await listDiscoveredNativeStatusPage({ projectRoot });
    const cursor = first.nextCursor!;

    await expect(
      listDiscoveredNativeStatusPage({
        projectRoot,
        cursor: cursor.replace('native-workspaces-v1.', 'bad.'),
      }),
    ).rejects.toThrow('invalid or stale');
    await expect(
      listDiscoveredNativeStatusPage({ projectRoot, cursor: `${cursor}extra` }),
    ).rejects.toThrow('invalid or stale');

    const parts = cursor.split('.');
    await expect(
      listDiscoveredNativeStatusPage({
        projectRoot,
        cursor: `${parts[0]}.${parts[1]}.0.${parts[3]}`,
      }),
    ).rejects.toThrow('offset is invalid');
    await expect(
      listDiscoveredNativeStatusPage({
        projectRoot,
        cursor: `${parts[0]}.${parts[1]}.zz.${parts[3]}`,
      }),
    ).rejects.toThrow('offset is invalid');
    await expect(
      listDiscoveredNativeStatusPage({
        projectRoot,
        cursor: `${parts[0]}.${parts[1]}.1.${'0'.repeat(64)}`,
      }),
    ).rejects.toThrow('integrity failed');
  });

  it('returns a status projection for an existing and an unknown change', async () => {
    const existing = await inspectDiscoveredNativeStatus({
      projectRoot,
      name: 'change-00',
      details: true,
    });
    expect(existing).toMatchObject({ name: 'change-00' });

    const missing = await inspectDiscoveredNativeStatus({
      projectRoot,
      name: 'not-created',
      acceptanceCursor: 'acceptance-cursor',
    });
    expect(missing).toMatchObject({ name: 'not-created' });
  });

  it('reports an unreadable portable copy as a blocked entry instead of failing the page', async () => {
    const paths = await nativeProjectPaths(projectRoot, '.');
    const staleDir = path.join(paths.changesDir, 'change-23');
    await fs.writeFile(
      path.join(staleDir, 'comet-state.yaml'),
      'schema: comet.native.v4\nphase: [\n',
    );

    const page = await listDiscoveredNativeStatusPage({ projectRoot });
    expect(page.items).toHaveLength(page.limits.maxItems);
    const stale = page.items.find(({ name }) => name === 'change-23');
    expect(stale).toMatchObject({
      name: 'change-23',
      phase: 'invalid',
      status: 'blocked',
      inspectionError: expect.any(String),
    });
    expect(
      page.items.filter(({ name }) => name !== 'change-23' && name.startsWith('change-')),
    ).not.toContainEqual(expect.objectContaining({ phase: 'invalid' }));
  });
});
