import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';
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
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';

describe('Native status discovery pagination', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-status-discovery-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
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
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('does not read per-change Runtime for names outside the requested page', async () => {
    const read = vi.spyOn(fs, 'readFile');
    const page = await listDiscoveredNativeStatusPage({ projectRoot });
    expect(page.items).toHaveLength(24);
    const files = read.mock.calls.map(([file]) => String(file).replaceAll('\\', '/'));
    expect(
      files.filter((file) => file.includes('/change-24/') && file.includes('/runtime/')),
    ).toEqual([]);
  });

  it('does not inspect an SDK Run until its status page is requested', async () => {
    const request = path.join(projectRoot, 'sdk-start.json');
    await fs.writeFile(
      request,
      JSON.stringify({
        operation: 'start',
        runId: 'sdk-change',
        workflow: { id: 'comet-native', version: '1' },
        input: { name: 'sdk-change', artifactRootRef: '.' },
        initialState: createNativePortableState({
          name: 'sdk-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      }),
    );
    const started = await runtimeDispatchCommand(
      { request, application: 'native', projectRoot },
      { invocationCwd: projectRoot },
    );
    expect(started.response.status).toBe('succeeded');
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'native'),
    });
    const run = await store.read('sdk-change');
    if (!run) throw new Error('SDK Run was not persisted');
    expect(
      await store.compareAndSwap('sdk-change', run.revision, {
        ...run,
        revision: run.revision + 1,
        workflow: { ...run.workflow, id: 'unavailable-workflow' },
      }),
    ).toBe(true);

    const first = await listDiscoveredNativeStatusPage({ projectRoot });
    expect(first.total).toBe(26);
    expect(first.items).toHaveLength(24);
    expect(first.nextCursor).not.toBeNull();
    await expect(
      listDiscoveredNativeStatusPage({ projectRoot, cursor: first.nextCursor }),
    ).rejects.toThrow();
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
