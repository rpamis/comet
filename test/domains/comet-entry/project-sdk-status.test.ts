import { withCometRuntimeMetrics } from '../../../platform/process/runtime-metrics.js';
import { execFileSync } from 'node:child_process';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        if (/^change-(?:owners|owner-history)\/native\//u.test(args[1])) bodies.push(args[1]);
        return result;
      },
    );
    const status = await inspectCometProjectStatus(root);
    expect(status.workflows.native.changes.map((change) => change.name)).toEqual([
      'batch-first',
      'batch-second',
    ]);
    expect(status.workflows.native.changes.every((change) => !('error' in change))).toBe(true);
    expect(tokens).toBe(2);
    expect(bodies).toHaveLength(2);
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
    expect(tokens).toBe(2);
    expect(bodies).toHaveLength(2);
    await fs.writeFile(path.join(runtimeRoot, '.change-owner-partitions.json'), '{bad');
    const fenced = await inspectCometProjectStatus(root);
    expect(fenced.workflows.native.changes.map((change) => change.name)).toEqual([
      'batch-first',
      'batch-second',
    ]);
    for (const change of fenced.workflows.native.changes) {
      expect(change).toMatchObject({
        error: expect.stringContaining('Invalid change owner partition token'),
      });
    }
  });

  it('retries the real global owner batch when a writer completes during prefetch', async () => {
    const created = await runNativeCli(['new', 'batch-race', '--project-root', root, '--json']);
    expect(created.exitCode, created.stderr).toBe(0);
    const original = protectedOwnerFiles.readProtectedProjectFile;
    let reads = 0;
    vi.spyOn(protectedOwnerFiles, 'readProtectedProjectFile').mockImplementation(
      async (...args) => {
        const result = await original(...args);
        if (args[1] === 'change-owners/native/batch-race.json') {
          reads += 1;
          if (reads === 1)
            await registerSdkChangeOwner(root, {
              schema: 'comet.change-owner.v1',
              workflow: 'native',
              change: 'outside-added',
              runId: 'outside-added',
              application: 'native',
              format: 'sdk',
            });
        }
        return result;
      },
    );
    const status = await inspectCometProjectStatus(root);
    expect(status.workflows.native.changes).toHaveLength(1);
    expect(status.workflows.native.changes[0]).toMatchObject({
      name: 'batch-race',
      schema: 'comet.native.sdk-status.v1',
    });
    expect(reads).toBe(2);
  });

  it('batches current Classic names in real global status and isolates corrupt owners', async () => {
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
        if (args[1].startsWith('change-owners/classic/')) bodies.push(args[1]);
        return result;
      },
    );
    const status = await inspectCometProjectStatus(root);
    expect(status.workflows.classic.changes.map((change) => change.name)).toEqual([
      'classic-first',
      'classic-second',
    ]);
    expect(status.workflows.classic.changes.every((change) => change.runtimeMode === 'sdk')).toBe(
      true,
    );
    expect(tokens).toBe(2);
    expect(bodies).toHaveLength(2);
    expect(bodies.some((ref) => ref.includes('unrequested-history'))).toBe(false);
    await fs.writeFile(path.join(owners, 'classic-first.json'), '{}');
    tokens = 0;
    bodies.length = 0;
    const corrupt = await inspectCometProjectStatus(root);
    expect(corrupt.workflows.classic.changes[0]).toMatchObject({
      name: 'classic-first',
      error: expect.stringContaining('Invalid change runtime owner'),
    });
    expect(corrupt.workflows.classic.changes[1]).toMatchObject({
      name: 'classic-second',
      runtimeMode: 'sdk',
    });
    expect(tokens).toBe(2);
    expect(bodies).toHaveLength(2);
  });

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
    expect(first.metrics.gitCommands).toBe(2);
    expect(second.metrics.gitCommands).toBe(2);
    expect(second.result).toEqual(first.result);
  });

  it('uses the same SDK validation as named Native status and preserves other changes', async () => {
    const created = await runNativeCli(['new', 'native-demo', '--project-root', root, '--json']);
    expect(created.exitCode, created.stderr).toBe(0);
    const before = await inspectCometProjectStatus(root);
    expect(before.workflows.native.changes[0]).toMatchObject({
      schema: 'comet.native.sdk-status.v1',
      run: { id: 'native-demo', revision: 1 },
    });
    const markerFile = path.join(
      resolveWorkspaceRuntimeRootSync(root),
      'state-projections/native/native-demo.json',
    );
    const marker = JSON.parse(await fs.readFile(markerFile, 'utf8'));
    marker.revision = 9999;
    await fs.writeFile(markerFile, JSON.stringify(marker));
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
      error: expect.stringMatching(/marker|checkpoint/),
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

  it('discovers the selected standalone Run and surfaces pinned package drift', async () => {
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
    const before = await inspectCometProjectStatus(root);
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
    const changed = await inspectCometProjectStatus(root);
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
  });
});
