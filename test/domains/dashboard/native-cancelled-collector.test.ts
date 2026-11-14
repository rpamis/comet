import '../../helpers/isolated-agent-home.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { nativeSdkChangeRunPaths } from '../../../domains/comet-native/native-sdk-cancellation.js';
import { workflowApplicationRunPaths } from '../../../domains/workflow-application/application.js';
import { prepareNativeApplication } from '../../helpers/native-application.js';
import { DashboardIndexReconciler } from '../../../domains/dashboard/index-reconciler.js';
import { DashboardIndexStore } from '../../../domains/dashboard/index-store.js';
import {
  collectNativeDashboardChangePage,
  collectNativeDashboardOverview,
  collectNativeDashboardProjection,
} from '../../../domains/dashboard/native-collector.js';

// Issue #557: `comet native cancel` only moves the SDK Run to `cancelled`; the
// portable comet-state.yaml keeps `status: active`. The Dashboard must follow the
// Run, like `comet native status`, and drop the change from the active list.
describe('Native Dashboard after a completed cancellation', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-dashboard-cancel-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function cli(args: string[]) {
    const result = await runNativeCli([...args, '--project-root', projectRoot, '--json']);
    return JSON.parse(result.stdout!) as { exitCode: number; error?: { message?: string } };
  }

  async function activeNames(): Promise<string[]> {
    const page = await collectNativeDashboardChangePage(projectRoot, {
      status: 'active',
      limit: 5,
    });
    return page.items.map(({ name }) => name);
  }

  it('leaves a cancelled Shape change out of the active list and counts', async () => {
    expect((await cli(['new', 'cancel-demo'])).exitCode).toBe(0);
    const cancelled = await cli(['cancel', 'cancel-demo']);
    expect(cancelled.exitCode, cancelled.error?.message).toBe(0);
    // The cancelled change no longer blocks a new one in the same workspace.
    const keep = await cli(['new', 'keep-demo']);
    expect(keep.exitCode, keep.error?.message).toBe(0);

    await expect(activeNames()).resolves.toEqual(['keep-demo']);
    await expect(collectNativeDashboardOverview(projectRoot)).resolves.toMatchObject({
      activeChangeCount: 1,
      totalChangeCount: 1,
    });
    const projection = await collectNativeDashboardProjection(projectRoot);
    expect(projection?.changes.map(({ name }) => name)).toEqual(['keep-demo']);
  });

  it('drops a change cancelled after the Dashboard index was cached', async () => {
    expect((await cli(['new', 'cancel-demo'])).exitCode).toBe(0);
    await expect(activeNames()).resolves.toEqual(['cancel-demo']);

    const pending: Promise<unknown>[] = [];
    vi.spyOn(DashboardIndexReconciler.prototype, 'schedule').mockImplementation((_key, task) => {
      pending.push(Promise.resolve().then(task));
    });
    const cancelled = await cli(['cancel', 'cancel-demo']);
    expect(cancelled.exitCode, cancelled.error?.message).toBe(0);

    await activeNames();
    await Promise.all(pending);
    await expect(activeNames()).resolves.toEqual([]);
    await expect(collectNativeDashboardOverview(projectRoot)).resolves.toMatchObject({
      activeChangeCount: 0,
    });
  });
  it("tracks each active change's SDK Run store, so a cancellation that completes through Run records refreshes the index", async () => {
    expect((await cli(['new', 'cancel-demo'])).exitCode).toBe(0);
    await expect(activeNames()).resolves.toEqual(['cancel-demo']);

    const store = new DashboardIndexStore({ projectRoot });
    await store.open();
    const index = await store.readNativeIndex<{
      refreshPaths: string[];
      fingerprint: string | null;
      active: { source: { workspace: { projectRoot: string } } }[];
    }>();
    await store.close();
    const workspaceRoot = index!.active[0].source.workspace.projectRoot;
    expect(index!.fingerprint).not.toBeNull();
    expect(index!.refreshPaths).toEqual(
      expect.arrayContaining(nativeSdkChangeRunPaths(workspaceRoot, 'cancel-demo')),
    );
  });
  it('drops a cancelled application-owned change from a cached index that tracks its application Run store', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-dashboard-app-cancel-'));
    try {
      // A fixed custom Native application owns this change; its Run lives in the
      // application store, not in sdk-runs/native.
      const f = await prepareNativeApplication(root);
      const names = async () =>
        (
          await collectNativeDashboardChangePage(f.projectRoot, { status: 'active', limit: 5 })
        ).items.map(({ name }) => name);
      await expect(names()).resolves.toEqual([f.name]);

      const store = new DashboardIndexStore({ projectRoot: f.projectRoot });
      await store.open();
      const index = await store.readNativeIndex<{
        refreshPaths: string[];
        active: { source: { workspace: { projectRoot: string } } }[];
      }>();
      await store.close();
      const workspaceRoot = index!.active[0].source.workspace.projectRoot;
      expect(index!.refreshPaths).toEqual(
        expect.arrayContaining(
          workflowApplicationRunPaths(workspaceRoot, 'native-candidate-review', f.name),
        ),
      );

      const pending: Promise<unknown>[] = [];
      vi.spyOn(DashboardIndexReconciler.prototype, 'schedule').mockImplementation((_key, task) => {
        pending.push(Promise.resolve().then(task));
      });
      await f.dispatch({ operation: 'cancel', runId: f.name, reason: 'Stop this custom task' });

      await names();
      await Promise.all(pending);
      await expect(names()).resolves.toEqual([]);
      await expect(collectNativeDashboardOverview(f.projectRoot)).resolves.toMatchObject({
        activeChangeCount: 0,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
