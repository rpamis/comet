import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  confirmNativePortableShape,
  createNativePortableChange,
  nativePortableChangeDir,
} from '../../../domains/comet-native/native-portable-runtime.js';
import {
  createNativeSupervisorState,
  createNativeSupervisorTask,
  writeNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor.js';
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

  it('keeps the default projection compact and pages typed details by state version', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-status-details-'));
    roots.push(root);
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, config);
    const paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'paged-details', language: 'en' });
    await fs.writeFile(
      path.join(nativePortableChangeDir(paths, 'paged-details'), 'brief.md'),
      `# Acceptance examples\n${Array.from(
        { length: 40 },
        (_, index) => `- Observable outcome ${index + 1}.`,
      ).join('\n')}\n`,
    );
    await confirmNativePortableShape({ paths, name: 'paged-details' });

    const compact = await inspectNativePortableStatus({ paths, name: 'paged-details' });
    expect(compact).toMatchObject({
      acceptance: { total: 40, pending: 40 },
      unresolvedAcceptanceIds: [],
    });
    expect(compact).not.toHaveProperty('builderHandoff');
    expect(compact).not.toHaveProperty('verification');
    expect(compact).not.toHaveProperty('history');
    expect(JSON.stringify(compact)).not.toContain('Observable outcome 1.');

    const first = await inspectNativePortableStatus({
      paths,
      name: 'paged-details',
      details: true,
    });
    expect(first.details?.items).toHaveLength(32);
    expect(first.details?.items[0]).toMatchObject({
      kind: 'acceptance',
      value: { id: 'A1', text: 'Observable outcome 1.' },
    });
    expect(first.details?.nextCursor).toBeTruthy();
    expect(first.details?.nextPageArgs).toEqual([
      'comet',
      'native',
      'status',
      'paged-details',
      '--details',
      '--cursor',
      first.details?.nextCursor,
      '--json',
      '--project-root',
      root,
    ]);

    const second = await inspectNativePortableStatus({
      paths,
      name: 'paged-details',
      details: true,
      cursor: first.details?.nextCursor ?? undefined,
    });
    expect(second.details?.items[0]).toMatchObject({
      kind: 'acceptance',
      value: { id: 'A33' },
    });
    const nextPage = await runNativeCli(first.details!.nextPageArgs!.slice(2));
    expect(nextPage.exitCode).toBe(0);
    expect(JSON.parse(nextPage.stdout!).data.details.items[0]).toMatchObject({
      kind: 'acceptance',
      value: { id: 'A33' },
    });
  });

  it('keeps Supervisor default status compact and paginates diagnostic history', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-supervisor-status-'));
    roots.push(root);
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, config);
    const paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'supervisor-status', language: 'en' });
    const initial = createNativeSupervisorState({
      parent: 'supervisor-status',
      targetBranch: 'main',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/supervisor-status/integration',
      integrationWorktree: path.join(root, '.worktrees', 'supervisor-status-integration'),
      contract: {
        schema: 'comet.native.children.v2',
        children: [{ name: 'core', summary: 'Core implementation', depends_on: [], covers: [] }],
      },
    });
    const dispatched = createNativeSupervisorTask(initial, {
      role: 'builder',
      child: 'core',
      projectRoot: path.join(root, '.worktrees', 'supervisor-status-core'),
      runId: 'internal-run-id',
    });
    let state = dispatched.state;
    for (let index = 0; index < 40; index += 1) {
      state = {
        ...state,
        history: [
          ...state.history,
          {
            kind: 'task-dispatched',
            child: 'core',
            runId: `run-${index}`,
            summary: `event ${index}`,
            at: new Date(0).toISOString(),
          },
        ],
      };
    }
    await writeNativeSupervisorState(paths, state);

    const status = await inspectNativePortableStatus({ paths, name: 'supervisor-status' });
    expect(status.supervisor?.summary).toMatchObject({
      targetSpecs: 0,
      implementationChildren: 1,
      working: 1,
      agents: { working: 1 },
    });
    expect(JSON.stringify(status)).not.toContain('internal-run-id');
    expect(JSON.stringify(status)).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(JSON.stringify(status)).not.toContain(root);
    expect(status.history).toBeUndefined();

    const firstDetails = await inspectNativePortableStatus({
      paths,
      name: 'supervisor-status',
      details: true,
    });
    expect(firstDetails.details?.items).toHaveLength(32);
    expect(firstDetails.details).not.toHaveProperty('supervisor');
    expect(firstDetails.details?.nextCursor).toBeTruthy();
    const secondDetails = await inspectNativePortableStatus({
      paths,
      name: 'supervisor-status',
      details: true,
      cursor: firstDetails.details?.nextCursor ?? undefined,
    });
    const detailItems = [
      ...(firstDetails.details?.items ?? []),
      ...(secondDetails.details?.items ?? []),
    ];
    expect(detailItems.filter(({ kind }) => kind === 'supervisor-child')).toHaveLength(
      state.children.length,
    );
    expect(detailItems.filter(({ kind }) => kind === 'supervisor-history')).toHaveLength(
      state.history.length,
    );
    expect(JSON.stringify(detailItems)).not.toContain(root);
    expect(JSON.stringify(firstDetails)).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(JSON.stringify(firstDetails)).not.toContain('internal-run-id');
    expect(JSON.stringify(firstDetails)).not.toContain('run-0');

    await writeNativeSupervisorState(paths, {
      ...state,
      stateVersion: state.stateVersion + 1,
    });
    await expect(
      inspectNativePortableStatus({
        paths,
        name: 'supervisor-status',
        details: true,
        cursor: firstDetails.details?.nextCursor ?? undefined,
      }),
    ).rejects.toThrow('cursor is stale or invalid');
  });
});
