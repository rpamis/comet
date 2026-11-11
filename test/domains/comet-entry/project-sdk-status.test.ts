import { createHash } from 'node:crypto';
import * as historyClosure from '../../../domains/comet-native/native-sdk-history.js';
import { withCometRuntimeMetrics } from '../../../platform/process/runtime-metrics.js';
import { execFileSync } from 'node:child_process';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireFileSymlink } from '../../helpers/file-symlink.js';
import { inspectCometProjectStatus } from '../../../domains/comet-entry/project-status.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import * as nativeStore from '../../../domains/comet-native/native-sdk-state-store.js';
import { resolveHookWorkflowOwner } from '../../../domains/comet-entry/hook-router.js';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { createDiskApplication } from '../../helpers/workflow-application.js';

import * as protectedOwnerFiles from '../../../domains/workflow-contract/protected-project-path.js';
import { registerSdkChangeOwner } from '../../../domains/workflow-contract/change-runtime-owner.js';
import { createNativeSdkTestChange } from '../../helpers/native-sdk-change.js';

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const ref = path.relative(root, file);
      if (entry.isDirectory()) {
        files[ref] = 'directory';
        await visit(file);
      } else files[ref] = (await fs.readFile(file)).toString('base64');
    }
  }
  await visit(root);
  return files;
}

describe('SDK ownership in shared project status', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-shared-sdk-status-'));
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
    await fs.mkdir(path.join(root, 'openspec'));
    await writeProjectConfig(root, {
      ...defaultProjectConfig('.'),
      workflows: ['native', 'classic'],
      classic: { artifact_layout: 'legacy', language: 'en' },
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function cancelled(name: string) {
    expect((await runNativeCli(['new', name, '--project-root', root, '--json'])).exitCode).toBe(0);
    expect((await runNativeCli(['cancel', name, '--project-root', root, '--json'])).exitCode).toBe(
      0,
    );
  }

  it('excludes only closed discovered history, preserves domain defaults, and defers body corruption', async () => {
    await cancelled('closed-change');
    expect(
      (await runNativeCli(['new', 'active-change', '--project-root', root, '--json'])).exitCode,
    ).toBe(0);
    const runtime = resolveWorkspaceRuntimeRootSync(root);
    await fs.writeFile(path.join(runtime, 'change-owner-history/native/unrequested.json'), '{}');
    const key = createHash('sha256').update(JSON.stringify('closed-change')).digest('hex');
    const checkpoint = path.join(
      runtime,
      'sdk-runs/native/.runtime-store-history',
      key,
      'checkpoint.json',
    );
    const files = vi.spyOn(protectedOwnerFiles, 'readProtectedProjectFile');
    const active = await inspectCometProjectStatus(root, { includeHistory: false });
    expect(active.workflows.native.changes.map((c) => c.name)).toEqual(['active-change']);
    expect(files.mock.calls.some((args) => args[1].includes('.runtime-store-history'))).toBe(false);
    expect(files.mock.calls.some((args) => args[1].includes('unrequested'))).toBe(false);
    for (const options of [undefined, { includeHistory: true }]) {
      const full = await inspectCometProjectStatus(root, options);
      expect(full.workflows.native.changes.map((c) => c.name)).toEqual([
        'active-change',
        'closed-change',
      ]);
      expect(full.workflows.native.changes.every((c) => !('error' in c))).toBe(true);
    }
    await fs.writeFile(checkpoint, '{broken');
    expect(
      (
        await inspectCometProjectStatus(root, { includeHistory: false })
      ).workflows.native.changes.map((c) => c.name),
    ).toEqual(['active-change']);
    expect(
      (await inspectCometProjectStatus(root, { includeHistory: true })).workflows.native.changes[1],
    ).toMatchObject({ name: 'closed-change', error: expect.any(String) });
  });

  it.for([
    'dual-owner',
    'bad-owner',
    'active-checkpoint',
    'bad-marker',
    'pending-marker',
    'missing-checkpoint',
    'symlink-checkpoint',
  ])('retains a per-change error for %s without hiding other changes', async (failure, context) => {
    if (failure === 'symlink-checkpoint') await requireFileSymlink(context);
    await cancelled('closed-change');
    expect(
      (await runNativeCli(['new', 'active-change', '--project-root', root, '--json'])).exitCode,
    ).toBe(0);
    const runtime = resolveWorkspaceRuntimeRootSync(root);
    const key = createHash('sha256').update(JSON.stringify('closed-change')).digest('hex');
    const store = path.join(runtime, 'sdk-runs/native');
    const checkpoint = path.join(store, '.runtime-store-history', key, 'checkpoint.json');
    const owner = path.join(runtime, 'change-owner-history/native/closed-change.json');
    if (failure === 'dual-owner')
      await fs.copyFile(owner, path.join(runtime, 'change-owners/native/closed-change.json'));
    if (failure === 'bad-owner') await fs.writeFile(owner, '{}');
    if (failure === 'active-checkpoint') {
      const active = path.join(store, '.runtime-store-v2', key, 'checkpoint.json');
      await fs.mkdir(path.dirname(active), { recursive: true });
      await fs.copyFile(checkpoint, active);
    }
    const marker = path.join(store, key);
    if (failure === 'bad-marker') await fs.writeFile(marker, '{}');
    if (failure === 'pending-marker') {
      const value = JSON.parse(await fs.readFile(marker, 'utf8'));
      await fs.writeFile(marker, JSON.stringify({ ...value, state: 'reopening' }));
    }
    if (failure === 'missing-checkpoint') await fs.unlink(checkpoint);
    if (failure === 'symlink-checkpoint') {
      const moved = path.join(root, 'moved-checkpoint');
      await fs.rename(checkpoint, moved);
      await fs.symlink(moved, checkpoint);
    }
    const result = await inspectCometProjectStatus(root, { includeHistory: false });
    expect(result.workflows.native.changes.map((c) => c.name)).toEqual([
      'active-change',
      'closed-change',
    ]);
    expect(result.workflows.native.changes[1]).toMatchObject({ error: expect.any(String) });
    expect('error' in result.workflows.native.changes[0]).toBe(false);
  });

  it('ignores retired partition tokens while preserving Native active and closed history selection', async () => {
    await cancelled('closed-change');
    const created = await runNativeCli(['new', 'active-change', '--project-root', root, '--json']);
    expect(created.exitCode, created.stderr).toBe(0);
    const runtime = resolveWorkspaceRuntimeRootSync(root);
    const token = path.join(runtime, '.change-owner-partitions.json');
    await fs.writeFile(token, '{bad');
    const before = { project: await snapshot(root), runtime: await snapshot(runtime) };
    const files = vi.spyOn(protectedOwnerFiles, 'readProtectedProjectFile');
    for (const options of [undefined, { includeHistory: true }, { includeHistory: false }]) {
      const status = await inspectCometProjectStatus(root, options);
      expect(status.workflows.native.changes.map((change) => change.name)).toEqual(
        options?.includeHistory === false ? ['active-change'] : ['active-change', 'closed-change'],
      );
      expect(status.workflows.native.changes.every((change) => !('error' in change))).toBe(true);
    }
    expect(
      files.mock.calls.some(
        (args) =>
          args[1] === '.change-owner-partitions.json' ||
          args[1].startsWith('change-owner-records/classic/'),
      ),
    ).toBe(false);
    expect(await fs.readFile(token, 'utf8')).toBe('{bad');
    expect({ project: await snapshot(root), runtime: await snapshot(runtime) }).toEqual(before);
  });

  it.each(['active-owner', 'custom-owner', 'pending-active-owner'])(
    'never filters a closed checkpoint with %s',
    async (kind) => {
      await cancelled('retained-change');
      const runtime = resolveWorkspaceRuntimeRootSync(root);
      const history = path.join(runtime, 'change-owner-history/native/retained-change.json');
      if (kind === 'custom-owner') {
        const owner = JSON.parse(await fs.readFile(history, 'utf8'));
        await fs.writeFile(history, JSON.stringify({ ...owner, application: 'custom-native' }));
      } else {
        await fs.rename(history, path.join(runtime, 'change-owners/native/retained-change.json'));
        if (kind === 'pending-active-owner') {
          const key = createHash('sha256').update(JSON.stringify('retained-change')).digest('hex');
          const file = path.join(runtime, 'sdk-runs/native', key);
          const marker = JSON.parse(await fs.readFile(file, 'utf8'));
          await fs.writeFile(file, JSON.stringify({ ...marker, state: 'reopening' }));
        }
      }
      const result = await inspectCometProjectStatus(root, { includeHistory: false });
      expect(result.workflows.native.changes.map((c) => c.name)).toEqual(['retained-change']);
    },
  );

  it('keeps unmigrated cancelled runs visible without migrating on status', async () => {
    const close = vi.spyOn(historyClosure, 'closeNativeSdkHistory').mockResolvedValue(false);
    await cancelled('legacy-history');
    close.mockRestore();
    const result = await inspectCometProjectStatus(root, { includeHistory: false });
    expect(result.workflows.native.changes).toHaveLength(1);
    expect(result.workflows.native.changes[0]).toMatchObject({
      name: 'legacy-history',
      status: 'cancelled',
    });
    expect(
      await fs.readFile(
        path.join(
          resolveWorkspaceRuntimeRootSync(root),
          'change-owners/native/legacy-history.json',
        ),
        'utf8',
      ),
    ).toContain('legacy-history');
  });

  it('reads closed-history metadata afresh after serial owner changes without importing unrelated owners', async () => {
    await cancelled('closed-race');
    const runtime = resolveWorkspaceRuntimeRootSync(root);
    const original = protectedOwnerFiles.readProtectedProjectFile;
    const refs: string[] = [];
    vi.spyOn(protectedOwnerFiles, 'readProtectedProjectFile').mockImplementation(
      async (...args) => {
        refs.push(args[1]);
        return original(...args);
      },
    );
    expect(
      (await inspectCometProjectStatus(root, { includeHistory: false })).workflows.native.changes,
    ).toEqual([]);
    expect(
      refs.filter((ref) => ref === 'change-owner-history/native/closed-race.json'),
    ).toHaveLength(1);
    await registerSdkChangeOwner(root, {
      schema: 'comet.change-owner.v1',
      workflow: 'native',
      change: 'unrequested',
      runId: 'unrequested',
      application: 'native',
      format: 'sdk',
    });
    await fs.writeFile(path.join(runtime, 'change-owner-history/native/closed-race.json'), '{}');
    refs.length = 0;
    const before = { project: await snapshot(root), runtime: await snapshot(runtime) };
    const status = await inspectCometProjectStatus(root, { includeHistory: false });
    expect(status.workflows.native.changes).toHaveLength(1);
    expect(status.workflows.native.changes[0]).toMatchObject({
      name: 'closed-race',
      error: expect.stringContaining('Invalid change runtime owner'),
    });
    expect(
      refs.filter((ref) => ref === 'change-owner-history/native/closed-race.json'),
    ).toHaveLength(1);
    expect(
      refs.some(
        (ref) =>
          ref.includes('unrequested') ||
          ref === '.change-owner-partitions.json' ||
          ref.startsWith('change-owner-records/classic/'),
      ),
    ).toBe(false);
    expect({ project: await snapshot(root), runtime: await snapshot(runtime) }).toEqual(before);
  });

  it('batches only actual global Native change names and isolates a corrupt owner', async () => {
    for (const name of ['batch-first', 'batch-second']) {
      const created = await runNativeCli(['new', name, '--project-root', root, '--json']);
      expect(created.exitCode, created.stderr).toBe(0);
      const cancelled = await runNativeCli(['cancel', name, '--project-root', root, '--json']);
      expect(cancelled.exitCode, cancelled.stderr).toBe(0);
    }
    const runtimeRoot = resolveWorkspaceRuntimeRootSync(root);
    const history = path.join(runtimeRoot, 'change-owner-history/native');
    await fs.writeFile(path.join(history, 'unrequested-history.json'), '{}');
    const original = protectedOwnerFiles.readProtectedProjectFile;
    const bodies: string[] = [];
    let tokens = 0;
    vi.spyOn(protectedOwnerFiles, 'readProtectedProjectFile').mockImplementation(
      async (...args) => {
        const result = await original(...args);
        if (args[1] === '.change-owner-partitions.json') tokens += 1;
        if (args[1].startsWith('change-owner-records/')) bodies.push(args[1]);
        return result;
      },
    );
    const status = await inspectCometProjectStatus(root);
    expect(status.workflows.native.changes.map((change) => change.name)).toEqual([
      'batch-first',
      'batch-second',
    ]);
    expect(status.workflows.native.changes.every((change) => !('error' in change))).toBe(true);
    expect(tokens).toBe(0);
    expect(bodies.sort()).toEqual([
      'change-owner-records/native/batch-first.json',
      'change-owner-records/native/batch-second.json',
    ]);
    expect(bodies.some((ref) => ref.includes('unrequested-history'))).toBe(false);
    await fs.writeFile(path.join(history, 'batch-first.json'), '{}');
    tokens = 0;
    bodies.length = 0;
    const corrupt = await inspectCometProjectStatus(root);
    expect(corrupt.workflows.native.changes[0]).toMatchObject({
      name: 'batch-first',
      error: expect.stringContaining('Invalid change runtime owner'),
    });
    expect(corrupt.workflows.native.changes[1]).toMatchObject({
      name: 'batch-second',
      schema: 'comet.native.sdk-status.v1',
    });
    expect(tokens).toBe(0);
    expect(bodies.sort()).toEqual([
      'change-owner-records/native/batch-first.json',
      'change-owner-records/native/batch-second.json',
    ]);
    await fs.writeFile(path.join(runtimeRoot, '.change-owner-partitions.json'), '{bad');
    bodies.length = 0;
    tokens = 0;
    const before = { project: await snapshot(root), runtime: await snapshot(runtimeRoot) };
    const fenced = await inspectCometProjectStatus(root);
    expect(fenced.workflows.native.changes.map((change) => change.name)).toEqual([
      'batch-first',
      'batch-second',
    ]);
    expect(fenced.workflows.native.changes[0]).toMatchObject({
      name: 'batch-first',
      error: expect.stringContaining('Invalid change runtime owner'),
    });
    expect(fenced.workflows.native.changes[1]).toMatchObject({
      name: 'batch-second',
      schema: 'comet.native.sdk-status.v1',
    });
    expect(tokens).toBe(0);
    expect(bodies.sort()).toEqual([
      'change-owner-records/native/batch-first.json',
      'change-owner-records/native/batch-second.json',
    ]);
    expect({ project: await snapshot(root), runtime: await snapshot(runtimeRoot) }).toEqual(before);
  });

  it('refreshes the real global owner batch after serial changes without importing unrelated owners', async () => {
    const created = await runNativeCli(['new', 'batch-race', '--project-root', root, '--json']);
    expect(created.exitCode, created.stderr).toBe(0);
    const original = protectedOwnerFiles.readProtectedProjectFile;
    const refs: string[] = [];
    vi.spyOn(protectedOwnerFiles, 'readProtectedProjectFile').mockImplementation(
      async (...args) => {
        refs.push(args[1]);
        return original(...args);
      },
    );
    const first = await inspectCometProjectStatus(root);
    expect(first.workflows.native.changes).toHaveLength(1);
    expect(first.workflows.native.changes[0]).toMatchObject({
      name: 'batch-race',
      schema: 'comet.native.sdk-status.v1',
    });
    expect(refs.filter((ref) => ref.startsWith('change-owner-records/'))).toEqual([
      'change-owner-records/native/batch-race.json',
    ]);

    const closed = await runNativeCli(['cancel', 'batch-race', '--project-root', root, '--json']);
    expect(closed.exitCode, closed.stderr).toBe(0);
    const added = await runNativeCli(['new', 'batch-added', '--project-root', root, '--json']);
    expect(added.exitCode, added.stderr || added.stdout).toBe(0);
    await registerSdkChangeOwner(root, {
      schema: 'comet.change-owner.v1',
      workflow: 'native',
      change: 'outside-added',
      runId: 'outside-added',
      application: 'native',
      format: 'sdk',
    });
    refs.length = 0;
    const runtime = resolveWorkspaceRuntimeRootSync(root);
    const before = { project: await snapshot(root), runtime: await snapshot(runtime) };
    const second = await inspectCometProjectStatus(root);
    expect(second.workflows.native.changes.map((change) => change.name)).toEqual([
      'batch-added',
      'batch-race',
    ]);
    expect(
      second.workflows.native.changes.every(
        (change) =>
          'schema' in change &&
          change.schema === 'comet.native.sdk-status.v1' &&
          !('error' in change),
      ),
    ).toBe(true);
    expect(second.workflows.native.changes[1]).toMatchObject({
      name: 'batch-race',
      status: 'cancelled',
    });
    expect(refs.filter((ref) => ref.startsWith('change-owner-records/')).sort()).toEqual([
      'change-owner-records/native/batch-added.json',
      'change-owner-records/native/batch-race.json',
    ]);
    expect(
      refs.some((ref) => ref.includes('outside-added') || ref === '.change-owner-partitions.json'),
    ).toBe(false);
    expect({ project: await snapshot(root), runtime: await snapshot(runtime) }).toEqual(before);
  });

  it.each([true, false])(
    'batches current Classic names and isolates corrupt owners (includeHistory=%s)',
    async (includeHistory) => {
      for (const name of ['classic-first', 'classic-second']) {
        const created = await runClassicCli(
          ['state', 'init', name, 'full', '--isolation', 'current'],
          undefined,
          { projectRoot: root, invocationCwd: root },
        );
        expect(created.exitCode, created.stderr).toBe(0);
      }
      const runtimeRoot = resolveWorkspaceRuntimeRootSync(root);
      const owners = path.join(runtimeRoot, 'change-owners/classic');
      await fs.writeFile(path.join(owners, 'unrequested-history.json'), '{}');
      const original = protectedOwnerFiles.readProtectedProjectFile;
      const bodies: string[] = [];
      let tokens = 0;
      vi.spyOn(protectedOwnerFiles, 'readProtectedProjectFile').mockImplementation(
        async (...args) => {
          const result = await original(...args);
          if (args[1] === '.change-owner-partitions.json') tokens += 1;
          if (args[1].startsWith('change-owner-records/')) bodies.push(args[1]);
          return result;
        },
      );
      const status = await inspectCometProjectStatus(root, { includeHistory });
      expect(status.workflows.classic.changes.map((change) => change.name)).toEqual([
        'classic-first',
        'classic-second',
      ]);
      expect(status.workflows.classic.changes.every((change) => change.runtimeMode === 'sdk')).toBe(
        true,
      );
      expect(tokens).toBe(0);
      expect(bodies.sort()).toEqual([
        'change-owner-records/classic/classic-first.json',
        'change-owner-records/classic/classic-second.json',
      ]);
      expect(bodies.some((ref) => ref.includes('unrequested-history'))).toBe(false);
      await fs.writeFile(path.join(owners, 'classic-first.json'), '{}');
      tokens = 0;
      bodies.length = 0;
      const before = { project: await snapshot(root), runtime: await snapshot(runtimeRoot) };
      const corrupt = await inspectCometProjectStatus(root, { includeHistory });
      expect(corrupt.workflows.classic.changes[0]).toMatchObject({
        name: 'classic-first',
        error: expect.stringContaining('Invalid change runtime owner'),
      });
      expect(corrupt.workflows.classic.changes[1]).toMatchObject({
        name: 'classic-second',
        runtimeMode: 'sdk',
      });
      expect(tokens).toBe(0);
      expect(bodies.sort()).toEqual([
        'change-owner-records/classic/classic-first.json',
        'change-owner-records/classic/classic-second.json',
      ]);
      expect({ project: await snapshot(root), runtime: await snapshot(runtimeRoot) }).toEqual(
        before,
      );
    },
  );

  it('shares Git worktree reads within each global status request, never across requests', async () => {
    for (const name of ['first-run', 'second-run', 'third-run']) {
      const created = await runNativeCli(['new', name, '--project-root', root, '--json']);
      expect(created.exitCode, created.stderr).toBe(0);
      const cancelled = await runNativeCli(['cancel', name, '--project-root', root, '--json']);
      expect(cancelled.exitCode, cancelled.stderr).toBe(0);
    }
    const first = await withCometRuntimeMetrics(() => inspectCometProjectStatus(root));
    const second = await withCometRuntimeMetrics(() => inspectCometProjectStatus(root));
    expect(first.result.workflows.native.changes).toHaveLength(3);
    expect(first.metrics.gitCommands).toBe(1);
    expect(second.metrics.gitCommands).toBe(1);
    expect(second.result).toEqual(first.result);
  });

  it('uses the same SDK validation as named Native status and preserves other changes', async () => {
    await createNativeSdkTestChange(root, 'native-demo');
    const before = await inspectCometProjectStatus(root);
    expect(before.workflows.native.changes[0]).toMatchObject({
      schema: 'comet.native.sdk-status.v1',
      run: { id: 'native-demo', revision: 1 },
    });
    // SIMULATED authority corruption replaces the retired duplicate marker check.
    const activeStore = path.join(
      resolveWorkspaceRuntimeRootSync(root),
      'sdk-runs/native/.runtime-store-v2',
    );
    const keys = await fs.readdir(activeStore);
    expect(keys).toHaveLength(1);
    await fs.writeFile(
      path.join(activeStore, keys[0]!, 'checkpoint.json'),
      '{ SIMULATED malformed authoritative Run',
    );
    const classic = await runClassicCli(
      ['state', 'init', 'classic-demo', 'full', '--isolation', 'current'],
      undefined,
      { projectRoot: root, invocationCwd: root },
    );
    expect(classic.exitCode, classic.stderr).toBe(0);
    const named = await runNativeCli(['status', 'native-demo', '--project-root', root, '--json']);
    expect(named.exitCode).not.toBe(0);
    const status = await inspectCometProjectStatus(root);
    expect(status.workflows.native.changes[0]).toMatchObject({
      name: 'native-demo',
      error: expect.stringMatching(/checkpoint|JSON|record|invalid/i),
    });
    expect(status.workflows.native.changes[0]).not.toHaveProperty('continuation');
    expect(
      status.workflows.classic.changes[0],
      JSON.stringify(status.workflows.classic),
    ).toMatchObject({
      name: 'classic-demo',
      runtimeMode: 'sdk',
      currentStep: 'full.open',
      run: { id: 'classic-demo' },
    });
  });

  it('keeps shared diagnostics and Hook owner inspection read-only without repeating SDK reads', async () => {
    expect(
      (await runNativeCli(['new', 'readonly-demo', '--project-root', root, '--json'])).exitCode,
    ).toBe(0);
    const create = nativeStore.createNativeSdkStateStore;
    const reads = vi.fn();
    vi.spyOn(nativeStore, 'createNativeSdkStateStore').mockImplementation((...args) => {
      const store = create(...args);
      return {
        ...store,
        read: async (id) => {
          reads(id);
          return store.read(id);
        },
      };
    });
    const before = await snapshot(root);
    await inspectCometProjectStatus(root);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(await snapshot(root)).toEqual(before);
    await inspectCometProjectStatus(root);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(await resolveHookWorkflowOwner(root)).toMatchObject({
      status: 'owned',
      owner: { workflow: 'native', name: 'readonly-demo' },
    });
    expect(await snapshot(root)).toEqual(before);

    await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'), {
      recursive: true,
    });
    const missing = await snapshot(root);
    const status = await inspectCometProjectStatus(root);
    expect(status.workflows.native.changes[0]).toMatchObject({
      name: 'readonly-demo',
      error: expect.stringContaining('checkpoint recovery'),
    });
    expect(await resolveHookWorkflowOwner(root)).toMatchObject({
      status: 'stale',
      code: 'change-state-unreadable',
    });
    expect(await snapshot(root)).toEqual(missing);
  });

  it.each([true, false])(
    'discovers standalone Run and pinned package drift (includeHistory=%s)',
    async (includeHistory) => {
      const application = await createDiskApplication(root);
      const request = path.join(root, 'request.json');
      await fs.writeFile(
        request,
        JSON.stringify({
          operation: 'start',
          runId: 'report',
          workflow: { id: 'editorial', version: '1' },
          input: { topic: 'Local report' },
        }),
      );
      const started = await runtimeDispatchCommand({
        projectRoot: root,
        applicationFile: application.file,
        request,
      });
      expect(started.exitCode, JSON.stringify(started.response)).toBe(0);
      const before = await inspectCometProjectStatus(root, { includeHistory });
      expect(before).toMatchObject({
        applications: {
          changes: [
            {
              applicationId: 'editorial',
              name: 'report',
              healthy: true,
              run: { runId: 'report', revision: 1, status: 'running' },
            },
          ],
        },
      });
      await fs.appendFile(
        path.join(application.packageRoot, 'SKILL.md'),
        '\nChanged fixed package.\n',
      );
      const changed = await inspectCometProjectStatus(root, { includeHistory });
      expect(changed).toMatchObject({
        applications: {
          changes: [
            {
              applicationId: 'editorial',
              name: 'report',
              healthy: false,
              error: { code: 'WORKFLOW_CHANGED' },
            },
          ],
        },
      });
    },
  );
  it.each(['current-index', 'legacy-no-index'] as const)(
    'discovers real closed SDK history %s read-only when its derived active document directory is absent',
    async (kind) => {
      await cancelled('owner-only-history');
      // SIMULATED loss of a derived document directory; the real public CLI-created closed Run and owner remain untouched.
      await fs.rm(path.join(root, 'comet/changes/owner-only-history'), {
        recursive: true,
        force: true,
      });
      const runtimeRoot = resolveWorkspaceRuntimeRootSync(root);
      const owner = path.join(runtimeRoot, 'change-owner-history/native/owner-only-history.json');
      await expect(fs.access(owner)).resolves.toBeUndefined();
      if (kind === 'legacy-no-index')
        await fs.rm(path.join(runtimeRoot, 'change-owner-records/native/owner-only-history.json'));
      const named = await runNativeCli([
        'status',
        'owner-only-history',
        '--project-root',
        root,
        '--json',
      ]);
      expect(named.exitCode, named.stderr).toBe(0);
      const before = await snapshot(runtimeRoot);
      for (const options of [undefined, { includeHistory: true }]) {
        const global = await inspectCometProjectStatus(root, options);
        expect(global.workflows.native.changes).toEqual([
          expect.objectContaining({ name: 'owner-only-history', status: 'cancelled' }),
        ]);
      }
      expect(
        (await inspectCometProjectStatus(root, { includeHistory: false })).workflows.native.changes,
      ).toEqual([]);
      expect(await snapshot(runtimeRoot)).toEqual(before);
      await expect(
        fs.access(path.join(root, 'comet/changes/owner-only-history')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
