import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  createNativePortableChange,
  nativePortableChangeDir,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
import {
  createNativeSupervisorState,
  createNativeSupervisorTask,
  writeNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor.js';
import { nativeSelectCommand } from '../../../domains/comet-native/native-select-command.js';
import {
  inspectNativePortableStatus,
  listNativePortableStatus,
  projectNativeArchivedStatus,
} from '../../../domains/comet-native/native-portable-status.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';

describe('Native portable status', () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it.each([false, true])(
    'keeps the archived status next-step mode consistent with pending workspace finish (%s)',
    async (pending) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-finish-mode-'));
      roots.push(root);
      const paths = await nativeProjectPaths(root, 'docs');
      // 只检验已归档读取快照的投影，不伪造或写入一次领域推进。
      const initial = createNativePortableState({
        name: 'finish-mode',
        language: 'en',
        createdAt: '2026-10-07T00:00:00Z',
        nextAction: 'prepare-shape-confirmation',
      });
      const state = {
        ...initial,
        phase: 'archive' as const,
        status: 'done' as const,
        archived: true,
        loop: { ...initial.loop, stage: 'done' as const, next_action: null },
      };
      const projection = projectNativeArchivedStatus({
        paths,
        state,
        file: path.join(paths.archiveDir, 'finish-mode/comet-state.yaml'),
        finishJournal: pending
          ? {
              schema: 'comet.native.workspace-finish.v1',
              name: state.name,
              transactionId: 'original-archive',
              archiveDir: paths.archiveDir,
              status: 'pending',
              result: null,
              updatedAt: '2026-10-07T00:00:00Z',
            }
          : null,
      });
      expect(projection.continuation).toMatchObject({
        mode: pending ? 'reconcile' : 'done',
        disposition: pending ? 'blocked' : 'done',
      });
      expect(projection.continuation.commandArgs).toEqual(
        pending ? ['comet', 'native', 'archive', state.name, '--confirmed'] : null,
      );
    },
  );

  it('projects the portable loop even when local execution is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-status-v2-'));
    roots.push(root);
    // The select command runs the full workspace discovery, which needs a Git repository.
    execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' });
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
      continuation: { action: 'prepare-shape-confirmation' },
    });
    expect((await listNativePortableStatus({ paths })).items).toHaveLength(1);
    await expect(nativeSelectCommand(['portable-status'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        selected: 'portable-status',
        continuation: {
          schema: 'comet.native.continuation.v2',
          action: 'prepare-shape-confirmation',
        },
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

  it('bounds 32-child named Supervisor status without reading unrelated change state', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-supervisor-scale-'));
    roots.push(root);
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'scale-parent', language: 'en' });
    const childNames = Array.from({ length: 32 }, (_, index) => `child-${index + 1}`);
    const supervisor = (names: string[]) =>
      createNativeSupervisorState({
        parent: 'scale-parent',
        targetBranch: 'main',
        targetCommit: 'a'.repeat(40),
        integrationBranch: 'comet/supervisor/scale-parent/integration',
        integrationWorktree: path.join(root, '.worktrees', 'scale-parent-integration'),
        contract: {
          schema: 'comet.native.children.v2',
          children: names.map((name) => ({
            name,
            summary: `Implement ${name}`,
            depends_on: [],
            covers: [],
          })),
        },
      });
    await writeNativeSupervisorState(paths, supervisor(childNames.slice(0, 1)));
    const read = vi.spyOn(fs, 'readFile');
    const open = vi.spyOn(fs, 'open');
    const namedStatus = () =>
      runNativeCli(['status', 'scale-parent', '--project-root', root, '--json']);
    const single = await namedStatus();
    expect(single.exitCode, single.stderr).toBe(0);
    const singleReadCount = read.mock.calls.length + open.mock.calls.length;
    read.mockClear();
    open.mockClear();
    await writeNativeSupervisorState(paths, supervisor(childNames));
    for (const name of childNames) {
      const unrelated = path.join(paths.changesDir, `unrelated-${name}`);
      await fs.mkdir(unrelated, { recursive: true });
      await fs.writeFile(path.join(unrelated, 'comet-state.yaml'), 'corrupt: [');
    }
    read.mockClear();
    open.mockClear();
    const response = await namedStatus();
    expect(response.exitCode, response.stderr).toBe(0);
    const readCount = read.mock.calls.length + open.mock.calls.length;
    expect(readCount).toBeLessThanOrEqual(singleReadCount + 2);
    const files = [...read.mock.calls, ...open.mock.calls].map(([file]) =>
      String(file).replaceAll('\\', '/'),
    );
    expect(files.filter((file) => file.includes('/changes/unrelated-'))).toEqual([]);
    const status = JSON.parse(response.stdout!).data;
    expect(status.supervisor.summary).toMatchObject({ implementationChildren: 32 });
    expect(Buffer.byteLength(response.stdout!)).toBeLessThan(16 * 1024);
    expect(response.stdout).not.toContain('Implement child-');
    expect(response.stdout).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(status).not.toHaveProperty('history');
    const first = await inspectNativePortableStatus({ paths, name: 'scale-parent', details: true });
    expect(first.details?.items).toHaveLength(32);
    expect(first.details?.nextCursor).toBeTruthy();
    const second = await inspectNativePortableStatus({
      paths,
      name: 'scale-parent',
      details: true,
      cursor: first.details!.nextCursor!,
    });
    const children = [...first.details!.items, ...second.details!.items].filter(
      ({ kind }) => kind === 'supervisor-child',
    );
    expect(children).toHaveLength(32);
    expect(new Set(children.map(({ value }) => (value as { name: string }).name))).toEqual(
      new Set(childNames),
    );
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
    expect(status.artifacts?.artifactRoot).toBe(path.join(root, 'docs'));
    expect(JSON.stringify(status)).not.toContain('internal-run-id');
    expect(JSON.stringify(status)).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
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
