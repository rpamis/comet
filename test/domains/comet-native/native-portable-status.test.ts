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
    expect(firstDetails.details?.supervisor?.history).toHaveLength(32);
    expect(firstDetails.details?.supervisor?.nextCursor).toBeTruthy();
    const secondDetails = await inspectNativePortableStatus({
      paths,
      name: 'supervisor-status',
      details: true,
      cursor: firstDetails.details?.supervisor?.nextCursor ?? undefined,
    });
    expect(secondDetails.details?.supervisor?.history[0]?.summary).toBe('event 31');
    expect(JSON.stringify(firstDetails)).not.toContain(root);
    expect(JSON.stringify(firstDetails)).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(JSON.stringify(firstDetails)).not.toContain('internal-run-id');
    expect(JSON.stringify(firstDetails)).not.toContain('run-0');
  });
});
