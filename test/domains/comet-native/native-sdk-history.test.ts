import { runWithHookReadCache } from '../../../platform/process/hook-read-cache.js';
import {
  listNativeSdkHistoryPartitions,
  inspectNativeSdkClosedHistory,
} from '../../../domains/comet-native/native-sdk-history-discovery.js';
import * as workspaceRuntime from '../../../domains/workflow-contract/workspace-runtime.js';
import * as ownerStorage from '../../../domains/workflow-contract/change-runtime-owner.js';
import { createHash } from 'node:crypto';
import { listActiveNativeHookChanges } from '../../../domains/comet-native/native-hook-guard.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { createNativeSdkRuntime } from '../../../domains/comet-native/native-runtime-ownership.js';
import * as history from '../../../domains/comet-native/native-sdk-history.js';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import {
  listSdkChangeNames,
  recoverSdkChangeOwnerToActive,
} from '../../../domains/workflow-contract/change-runtime-owner.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-history-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const name = 'history-change';
  const cli = async (args: string[]) =>
    JSON.parse((await runNativeCli([...args, '--project-root', root, '--json'])).stdout!);
  expect((await cli(['new', name])).exitCode).toBe(0);
  const runtime = createNativeSdkRuntime(root);
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs', 'native'),
  });
  return { root, name, cli, runtime, store };
}

describe('Native terminal history lifecycle', () => {
  it('shares one Store root per project history inspection and rechecks each scan after metadata changes', async () => {
    const f = await fixture();
    await f.runtime.cancel({ runId: f.name, reason: 'Stop this task' });
    const other = 'second-history';
    expect((await f.cli(['new', other])).exitCode).toBe(0);
    await f.runtime.cancel({ runId: other, reason: 'Stop the second task' });
    const rootSpy = vi.spyOn(workspaceRuntime, 'resolveWorkspaceRuntimeRootSync');
    const inspected = await inspectNativeSdkClosedHistory(f.root, [f.name, other]);
    expect([...inspected.values()]).toEqual([
      { status: 'fulfilled', value: true },
      { status: 'fulfilled', value: true },
    ]);
    // 一次发现 Runtime 根，另一次为整批构造 Store；不能按 history 数量增长。
    expect(rootSpy.mock.calls.length).toBeLessThanOrEqual(2);
    rootSpy.mockRestore();
    const key = createHash('sha256').update(JSON.stringify(f.name)).digest('hex');
    const markerFile = path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs/native', key);
    const marker = await fs.readFile(markerFile, 'utf8');
    await runWithHookReadCache(async () => {
      expect((await listNativeSdkHistoryPartitions(f.root)).history).toEqual([f.name, other]);
      await fs.writeFile(markerFile, '{broken marker');
      await expect(listNativeSdkHistoryPartitions(f.root)).rejects.toThrow();
      await fs.writeFile(markerFile, marker);
      expect((await listNativeSdkHistoryPartitions(f.root)).history).toHaveLength(2);
      await recoverSdkChangeOwnerToActive(f.root, 'native', f.name);
      await fs.writeFile(markerFile, JSON.stringify({ ...JSON.parse(marker), state: 'reopening' }));
      await expect(listNativeSdkHistoryPartitions(f.root)).rejects.toThrow(/unfinished reopening/);
    });
  });

  it('closes a fully cancelled Run while retaining readable history and portable documents', async () => {
    const f = await fixture();
    await f.runtime.cancel({ runId: f.name, reason: 'User stopped this task' });
    expect(await f.store.readDisposition(f.name)).toBe('closed');
    const saved = (await f.store.read(f.name))!;
    await expect(
      f.store.compareAndSwap(f.name, saved.revision, { ...saved, revision: saved.revision + 1 }),
    ).rejects.toThrow();
    expect(
      await listSdkChangeNames(f.root, 'native', { readOnly: true, partition: 'history' }),
    ).toEqual([f.name]);
    expect(
      await listSdkChangeNames(f.root, 'native', { readOnly: true, partition: 'active' }),
    ).toEqual([]);
    expect((await f.cli(['status', f.name])).exitCode).toBe(0);
    expect((await f.cli(['doctor', f.name])).exitCode).toBe(0);
    expect(
      await fs.readFile(path.join(f.root, 'docs/comet/changes', f.name, 'brief.md'), 'utf8'),
    ).toBeTruthy();
  });

  it('keeps an unfinished Run active during explicit migration', async () => {
    const f = await fixture();
    const result = await f.cli(['doctor', '--migrate-history']);
    expect(result.exitCode).toBe(0);
    expect(result.data.active).toEqual([f.name]);
    expect(await f.store.readDisposition(f.name)).toBe('active');
  });

  it('never migrates on ordinary inspection and resumes explicit interrupted closure', async () => {
    const f = await fixture();
    const stopBeforeClose = vi.spyOn(history, 'closeNativeSdkHistory').mockResolvedValue(false);
    await f.runtime.cancel({ runId: f.name, reason: 'Retained legacy terminal Run' });
    stopBeforeClose.mockRestore();
    expect(await f.store.readDisposition(f.name)).toBe('active');
    expect((await f.cli(['doctor', f.name])).exitCode).toBe(0);
    expect(await f.store.readDisposition(f.name)).toBe('active');
    const result = await f.cli(['doctor', '--migrate-history']);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    expect(result.data.migrated).toEqual([f.name]);
    expect(await f.store.readDisposition(f.name)).toBe('closed');
    expect((await f.cli(['doctor', '--migrate-history'])).exitCode).toBe(0);
  });

  it('defers closed history body corruption to explicit inspection while Hook reads only partition metadata', async () => {
    const f = await fixture();
    await f.runtime.cancel({ runId: f.name, reason: 'Stop this task' });
    const key = createHash('sha256').update(JSON.stringify(f.name)).digest('hex');
    const file = path.join(
      resolveWorkspaceRuntimeRootSync(f.root),
      'sdk-runs/native/.runtime-store-history',
      key,
      'checkpoint.json',
    );
    await fs.writeFile(file, '{broken history');
    expect(await listActiveNativeHookChanges(f.root)).toEqual([]);
    expect((await f.cli(['status', f.name])).exitCode).not.toBe(0);
    expect((await f.cli(['doctor'])).exitCode).not.toBe(0);
  });

  it('does not let a history owner hide an active checkpoint conflict', async () => {
    const f = await fixture();
    await f.runtime.cancel({ runId: f.name, reason: 'Stop this task' });
    const key = createHash('sha256').update(JSON.stringify(f.name)).digest('hex');
    const storeRoot = path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs/native');
    const active = path.join(storeRoot, '.runtime-store-v2', key, 'checkpoint.json');
    await fs.mkdir(path.dirname(active), { recursive: true });
    await fs.copyFile(
      path.join(storeRoot, '.runtime-store-history', key, 'checkpoint.json'),
      active,
    );
    await expect(listActiveNativeHookChanges(f.root)).rejects.toThrow();
  });

  it('recovers an interrupted owner publication through a new explicit doctor invocation', async () => {
    const f = await fixture();
    await f.runtime.cancel({ runId: f.name, reason: 'Stop this task' });
    const root = resolveWorkspaceRuntimeRootSync(f.root);
    const active = path.join(root, 'change-owners/native', `${f.name}.json`);
    await fs.copyFile(path.join(root, 'change-owner-history/native', `${f.name}.json`), active);
    expect((await f.cli(['doctor', f.name])).exitCode).not.toBe(0);
    const result = await f.cli(['doctor', '--migrate-history']);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    expect(result.data.migrated).toEqual([f.name]);
    expect((await f.cli(['doctor', f.name])).exitCode).toBe(0);
    expect(await f.store.readDisposition(f.name)).toBe('closed');
  });

  it.each(['closing', 'reopening'] as const)(
    'keeps an interrupted %s transaction visible and recovers it through explicit migration',
    async (pending) => {
      const f = await fixture();
      await f.runtime.cancel({ runId: f.name, reason: 'Stop this task' });
      const key = createHash('sha256').update(JSON.stringify(f.name)).digest('hex');
      const markerFile = path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs/native', key);
      const marker = JSON.parse(await fs.readFile(markerFile, 'utf8'));
      await recoverSdkChangeOwnerToActive(f.root, 'native', f.name);
      await fs.writeFile(markerFile, JSON.stringify({ ...marker, state: pending }));
      await expect(listActiveNativeHookChanges(f.root)).rejects.toThrow(/unfinished|transaction/);
      const result = await f.cli(['doctor', '--migrate-history']);
      expect(result.exitCode, JSON.stringify(result)).toBe(0);
      expect(result.data.migrated).toEqual([f.name]);
      expect(await f.store.readDisposition(f.name)).toBe('closed');
    },
  );

  it('rejects same-revision content drift and unknown workflow definitions before closing', async () => {
    const f = await fixture();
    const stopBeforeClose = vi.spyOn(history, 'closeNativeSdkHistory').mockResolvedValue(false);
    await f.runtime.cancel({ runId: f.name, reason: 'Retained terminal Run' });
    stopBeforeClose.mockRestore();
    const record = (await f.store.read(f.name))!;
    await expect(
      history.closeNativeSdkHistory({
        projectRoot: f.root,
        run: { ...record, reason: 'Different same-revision content' },
      }),
    ).rejects.toThrow(/same revision/);
    const unknown = structuredClone(record);
    unknown.workflow.hash = 'f'.repeat(64);
    unknown.definitionHashes[JSON.stringify([unknown.workflow.id, unknown.workflow.version])] =
      unknown.workflow.hash;
    unknown.revision++;
    expect(await f.store.compareAndSwap(f.name, record.revision, unknown)).toBe(true);
    await expect(
      history.closeNativeSdkHistory({ projectRoot: f.root, run: unknown }),
    ).rejects.toThrow(/known built-in/);
    expect(await f.store.readDisposition(f.name)).toBe('active');
  });

  it.each(['active', 'cancelled'] as const)(
    'restores a portable %s Run on another device without the original runtime or history partition',
    async (status) => {
      const f = await fixture();
      if (status === 'cancelled')
        await f.runtime.cancel({ runId: f.name, reason: 'User stopped this task' });
      const original = (await f.store.read(f.name))!;
      expect(await f.store.readDisposition(f.name)).toBe(
        status === 'cancelled' ? 'closed' : 'active',
      );
      const target = await fs.mkdtemp(path.join(os.tmpdir(), 'native-history-other-device-'));
      const data = await fs.mkdtemp(path.join(os.tmpdir(), 'native-history-other-home-'));
      roots.push(target, data);
      execFileSync('git', ['init', '-b', 'main'], { cwd: target, stdio: 'ignore' });
      await fs.cp(path.join(f.root, 'docs'), path.join(target, 'docs'), { recursive: true });
      await fs.mkdir(path.join(target, '.comet'));
      await fs.copyFile(
        path.join(f.root, '.comet/config.yaml'),
        path.join(target, '.comet/config.yaml'),
      );
      vi.stubEnv('COMET_DATA_DIR', data);
      const cli = async (args: string[]) =>
        JSON.parse((await runNativeCli([...args, '--project-root', target, '--json'])).stdout!);
      const targetStore = createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(target), 'sdk-runs/native'),
      });
      expect(await targetStore.read(f.name)).toBeNull();
      expect((await cli(['status', f.name])).exitCode).not.toBe(0);
      expect(await targetStore.read(f.name)).toBeNull();
      const recovered = await cli(['doctor', f.name, '--repair', '--confirmed']);
      expect(recovered.exitCode, JSON.stringify(recovered)).toBe(0);
      const restored = (await targetStore.read(f.name))!;
      expect(restored.status).toBe(original.status);
      expect(restored.revision).toBe(original.revision);
      expect(restored.actions).toEqual(original.actions);
      expect(await targetStore.readDisposition(f.name)).toBe('active');
      if (status === 'cancelled') {
        expect((await cli(['next', f.name])).exitCode).toBe(0);
        expect(await targetStore.readDisposition(f.name)).toBe('closed');
        expect((await targetStore.read(f.name))!.actions).toEqual(original.actions);
      }
      expect((await f.store.read(f.name))!.revision).toBe(original.revision);
    },
  );

  it('reports explicit migration progress on stderr without polluting JSON or ordinary doctor', async () => {
    const f = await fixture();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const readOnly = await runNativeCli(['doctor', f.name, '--project-root', f.root, '--json']);
    expect(JSON.parse(readOnly.stdout!).exitCode).toBe(0);
    expect(stderr.mock.calls.flat().join('')).not.toContain('Native 历史迁移');
    stderr.mockClear();
    const migrated = await runNativeCli([
      'doctor',
      '--migrate-history',
      '--project-root',
      f.root,
      '--json',
    ]);
    const result = JSON.parse(migrated.stdout!);
    expect(result.exitCode).toBe(0);
    expect(result.data.active).toEqual([f.name]);
    const progress = stderr.mock.calls
      .map(([text]) => String(text))
      .filter((text) => text.includes('Native 历史迁移'));
    expect(progress).toHaveLength(2);
    expect(progress[0]).toContain('进度：0/1');
    expect(progress[1]).toContain('结束：1/1 项，已封存 0，保留活动 1，失败 0');
    expect(migrated.stdout).not.toContain('[Comet]');
  });

  it('throttles intermediate progress to five seconds while always reporting completion', async () => {
    const f = await fixture();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(ownerStorage, 'listSdkChangeOwnerRecoveryNames').mockResolvedValue(
      Array.from({ length: 7 }, () => f.name),
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(history, 'closeNativeSdkHistory').mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 1_000);
      return false;
    });
    expect((await f.cli(['doctor', '--migrate-history'])).exitCode).toBe(0);
    const progress = stderr.mock.calls
      .map(([text]) => String(text))
      .filter((text) => text.includes('Native 历史迁移'));
    expect(progress).toHaveLength(3);
    expect(progress[0]).toContain('进度：0/7');
    expect(progress[1]).toContain('进度：5/7');
    expect(progress[2]).toContain('结束：7/7');
  });

  it('keeps migration failures visible in the result and final progress count', async () => {
    const f = await fixture();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await f.cli(['doctor', 'missing-history', '--migrate-history']);
    expect(result.exitCode).not.toBe(0);
    expect(result.data.findings).toHaveLength(1);
    expect(stderr.mock.calls.flat().join('')).toContain(
      '结束：1/1 项，已封存 0，保留活动 0，失败 1',
    );
  });

  it('rejects combining migration with unrelated mutation flags', async () => {
    const f = await fixture();
    expect((await f.cli(['doctor', '--migrate-history', '--repair'])).exitCode).not.toBe(0);
    expect(await f.store.readDisposition(f.name)).toBe('active');
  });
});
