import * as gitWorktrees from '../../../platform/paths/git-worktree.js';
import * as atomicFiles from '../../../domains/workflow-contract/contained-atomic-write.js';
import { stringify } from 'yaml';
import {
  parseNativeStateDocument,
  NATIVE_MANAGED_RUN_MARKER,
} from '../../../domains/comet-native/native-state-document.js';
import { runWithHookReadCache } from '../../../platform/process/hook-read-cache.js';
import {
  listNativeSdkHistoryPartitions,
  inspectNativeSdkClosedHistory,
} from '../../../domains/comet-native/native-sdk-history-discovery.js';
import * as workspaceRuntime from '../../../domains/workflow-contract/workspace-runtime.js';
import * as ownerStorage from '../../../domains/workflow-contract/change-runtime-owner.js';
import { createHash } from 'node:crypto';
import { listActiveNativeHookChanges } from '../../../domains/comet-native/native-hook-guard.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { createNativeSdkRuntime } from '../../../domains/comet-native/native-runtime-ownership.js';
import * as history from '../../../domains/comet-native/native-sdk-history.js';
import {
  createFileRuntimeStore,
  createPortableRunCheckpoint,
  readPortableRunCheckpoint,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
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
async function fixture(linked = false) {
  let root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-history-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const integrationRoot = root;
  if (linked) {
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '--allow-empty',
        '-m',
        'initial',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    root = path.join(root, 'linked');
    execFileSync('git', ['worktree', 'add', '-b', 'feature/history-change', root], {
      cwd: integrationRoot,
      stdio: 'ignore',
    });
  }
  const name = 'history-change';
  const cli = async (args: string[]) =>
    JSON.parse((await runNativeCli([...args, '--project-root', root, '--json'])).stdout!);
  expect((await cli(['new', name])).exitCode).toBe(0);
  const runtime = createNativeSdkRuntime(root);
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs', 'native'),
  });
  return { root, integrationRoot, name, cli, runtime, store };
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

  it.each(['runtime', 'bundle'] as const)(
    'migrates a stopped portable cancellation after its linked worktree is removed without changing evidence through %s',
    async (boundary) => {
      const f = await fixture(true);
      const changeDir = path.join(f.root, 'docs/comet/changes', f.name);
      await fs.writeFile(
        path.join(changeDir, 'brief.md'),
        '# Outcome\nKeep partial work.\n# Scope\nCancel safely.\n## Directory structure\n### Modified\n- src/ — preserve partial implementation.\n# Non-goals\nPublishing.\n# Acceptance examples\n- Existing work remains.\n# Constraints and invariants\nPreserve receipts.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n',
      );
      await fs.mkdir(path.join(changeDir, 'specs/workflow'), { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'specs/workflow/spec.md'),
        '# Workflow\nExisting work remains.\n',
      );
      expect((await f.cli(['next', f.name])).exitCode).toBe(0);
      const shaped = (await f.runtime.inspect(f.name)).state as { state_version: number };
      expect(
        (
          await f.cli([
            'next',
            f.name,
            '--confirmed',
            '--summary',
            'Confirmed Shape',
            '--expected-state-version',
            String(shaped.state_version),
            '--expected-action',
            'confirm-shape',
          ])
        ).exitCode,
      ).toBe(0);
      const initial = await f.runtime.inspect(f.name);
      expect(initial.state).toMatchObject({ phase: 'build' });
      const action = initial.actions.at(-1)!;
      const claimed = await f.runtime.claim({
        runId: f.name,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'original-host',
        claimToken: 'original-claim',
      });
      await f.runtime.cancel({
        runId: f.name,
        reason: 'Stop original work',
        stoppedActions: [
          {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: claimed.actions.at(-1)!.claim!.token,
            evidence: 'Original execution and child tasks stopped.',
          },
        ],
      });
      const original = (await f.store.read(f.name))!;
      execFileSync('git', ['add', '-A'], { cwd: f.root, stdio: 'ignore' });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.com',
          'commit',
          '-m',
          'preserve cancelled checkpoint',
        ],
        { cwd: f.root, stdio: 'ignore' },
      );
      const target = f.integrationRoot;
      execFileSync('git', ['merge', '--ff-only', 'feature/history-change'], {
        cwd: target,
        stdio: 'ignore',
      });
      expect(
        await ownerStorage.readSdkChangeOwner(target, 'native', f.name, { readOnly: true }),
      ).toBeNull();
      execFileSync('git', ['worktree', 'remove', f.root], { cwd: target, stdio: 'ignore' });
      const cli = async (args: string[]) =>
        JSON.parse((await runNativeCli([...args, '--project-root', target, '--json'])).stdout!);
      const targetStore = createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(target), 'sdk-runs/native'),
      });
      const portableFile = path.join(target, 'docs/comet/changes', f.name, 'comet-state.yaml');
      const portable = await fs.readFile(portableFile, 'utf8');
      expect((await cli(['doctor', f.name, '--repair', '--confirmed'])).exitCode).not.toBe(0);
      expect(await targetStore.read(f.name)).toBeNull();
      const migrated =
        boundary === 'runtime'
          ? await cli(['doctor', f.name, '--migrate-history'])
          : JSON.parse(
              spawnSync(
                process.execPath,
                [
                  path.resolve('assets/skills/comet-native/scripts/comet-native-doctor.mjs'),
                  f.name,
                  '--migrate-history',
                  '--project-root',
                  target,
                  '--json',
                ],
                { encoding: 'utf8' },
              ).stdout,
            );
      expect(migrated.exitCode, JSON.stringify(migrated)).toBe(0);
      expect(migrated.data.migrated).toEqual([f.name]);
      expect(await targetStore.readDisposition(f.name)).toBe('closed');
      const restored = (await targetStore.read(f.name))!;
      expect(restored.revision).toBe(original.revision);
      expect(restored.state).toEqual(original.state);
      expect(restored.state).toMatchObject({ phase: 'build', archived: false });
      expect(await f.store.read(f.name)).toEqual(original);
      expect(restored.actions).toEqual(
        readPortableRunCheckpoint(createPortableRunCheckpoint(original), f.name, {
          preserveSourceRevision: true,
        })!.actions,
      );
      expect(await fs.readFile(portableFile, 'utf8')).toBe(portable);
      const repeated = await cli(['doctor', f.name, '--migrate-history']);
      expect(repeated.exitCode, JSON.stringify(repeated)).toBe(0);
      const globalDoctor = await cli(['doctor']);
      expect(globalDoctor.exitCode, JSON.stringify(globalDoctor)).toBe(0);
      expect(await listActiveNativeHookChanges(target)).toEqual([]);
      expect(await fs.readFile(portableFile, 'utf8')).toBe(portable);
    },
  );

  it.each(['original', 'newer'] as const)(
    'does not shadow the %s authority in a registered source worktree',
    async (version) => {
      const f = await fixture(true);
      await f.runtime.cancel({ runId: f.name, reason: 'Stop work' });
      const target = f.integrationRoot;
      await fs.cp(path.join(f.root, 'docs'), path.join(target, 'docs'), { recursive: true });
      await fs.mkdir(path.join(target, '.comet'), { recursive: true });
      await fs.copyFile(
        path.join(f.root, '.comet/config.yaml'),
        path.join(target, '.comet/config.yaml'),
      );
      const original = (await f.store.read(f.name))!;
      if (version === 'newer') {
        expect(await f.store.reopenRun(f.name, original.revision)).toBe(true);
        expect(
          await f.store.compareAndSwap(f.name, original.revision, {
            ...original,
            revision: original.revision + 1,
          }),
        ).toBe(true);
      }
      const retained = await f.store.read(f.name);
      const result = JSON.parse(
        (
          await runNativeCli([
            'doctor',
            f.name,
            '--migrate-history',
            '--project-root',
            target,
            '--json',
          ])
        ).stdout!,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.data.findings[0].message).toContain('authoritative record');
      expect(
        await ownerStorage.readSdkChangeOwner(target, 'native', f.name, { readOnly: true }),
      ).toBeNull();
      expect(
        await createFileRuntimeStore<WorkflowRun>({
          rootDir: path.join(resolveWorkspaceRuntimeRootSync(target), 'sdk-runs/native'),
        }).read(f.name),
      ).toBeNull();
      expect(await f.store.read(f.name)).toEqual(retained);
    },
  );

  it.each([
    'active',
    'missing-stop',
    'corrupt-hash',
    'unknown-definition',
    'archive-obligation',
    'child-lineage',
    'fixed-application',
    'pending-cleanup',
    'existing-run',
    'existing-projection',
  ] as const)(
    'rejects portable history import with %s without overwriting local evidence',
    async (failure) => {
      const f = await fixture();
      const initial = await f.runtime.inspect(f.name);
      const action = initial.actions.at(-1)!;
      await f.runtime.claim({
        runId: f.name,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'original-host',
        claimToken: 'original-claim',
      });
      if (failure !== 'active')
        await f.runtime.cancel({
          runId: f.name,
          reason: 'Cancel work',
          ...(failure === 'missing-stop'
            ? {}
            : {
                stoppedActions: [
                  {
                    actionId: action.id,
                    attempt: action.attempt,
                    inputHash: action.inputHash,
                    claimToken: 'original-claim',
                    evidence: 'Original execution and child tasks stopped.',
                  },
                ],
              }),
        });
      const target = await fs.mkdtemp(path.join(os.tmpdir(), 'native-history-rejection-'));
      roots.push(target);
      execFileSync('git', ['init', '-b', 'dev'], { cwd: target, stdio: 'ignore' });
      await fs.cp(path.join(f.root, 'docs'), path.join(target, 'docs'), { recursive: true });
      await fs.mkdir(path.join(target, '.comet'));
      await fs.copyFile(
        path.join(f.root, '.comet/config.yaml'),
        path.join(target, '.comet/config.yaml'),
      );
      const runtimeRoot = resolveWorkspaceRuntimeRootSync(target);
      const store = createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(runtimeRoot, 'sdk-runs/native'),
      });
      const portableFile = path.join(target, 'docs/comet/changes', f.name, 'comet-state.yaml');
      const document = parseNativeStateDocument(
        await fs.readFile(portableFile, 'utf8'),
        'test checkpoint',
      ) as Record<string, unknown>;
      if (failure === 'corrupt-hash')
        (document.run_checkpoint as { hash: string }).hash = 'f'.repeat(64);
      if (failure === 'unknown-definition') {
        const run = readPortableRunCheckpoint(document.run_checkpoint, f.name, {
          preserveSourceRevision: true,
        })!;
        run.workflow.hash = 'f'.repeat(64);
        run.definitionHashes[JSON.stringify([run.workflow.id, run.workflow.version])] =
          run.workflow.hash;
        document.run_checkpoint = createPortableRunCheckpoint(run);
      }
      if (failure === 'child-lineage') {
        const run = readPortableRunCheckpoint(document.run_checkpoint, f.name, {
          preserveSourceRevision: true,
        })!;
        run.lineage = ['parent-run'];
        document.run_checkpoint = createPortableRunCheckpoint(run);
      }
      if (failure === 'archive-obligation') {
        const run = readPortableRunCheckpoint(document.run_checkpoint, f.name, {
          preserveSourceRevision: true,
        })!;
        run.actions[0].stepId = 'archive.finalize';
        document.run_checkpoint = createPortableRunCheckpoint(run);
      }
      if (failure === 'fixed-application')
        document.application_checkpoint = { id: 'custom-native' };
      await fs.writeFile(portableFile, NATIVE_MANAGED_RUN_MARKER + stringify(document));
      const source = await fs.readFile(portableFile, 'utf8');
      if (failure === 'pending-cleanup')
        await fs.writeFile(
          path.join(target, '.comet/current-change.json'),
          JSON.stringify({
            schema: 'comet.selection.v2',
            workflow: 'native',
            change: f.name,
            branch: null,
          }),
        );
      if (failure === 'existing-run')
        await store.restoreCheckpoint(f.name, null, (await f.store.read(f.name))!);
      const existing = await store.read(f.name);
      const markerFile = path.join(runtimeRoot, `state-projections/native/${f.name}.json`);
      if (failure === 'existing-projection') {
        await fs.mkdir(path.dirname(markerFile), { recursive: true });
        await fs.writeFile(markerFile, 'existing evidence');
      }
      const cli = async (args: string[]) =>
        JSON.parse((await runNativeCli([...args, '--project-root', target, '--json'])).stdout!);
      expect((await cli(['doctor'])).exitCode).not.toBe(0);
      await cli(['doctor', '--migrate-history']);
      expect(
        await ownerStorage.readSdkChangeOwner(target, 'native', f.name, { readOnly: true }),
      ).toBeNull();
      const result = await cli(['doctor', f.name, '--migrate-history']);
      expect(result.exitCode, JSON.stringify(result)).not.toBe(0);
      expect(result.data.findings).toHaveLength(1);
      if (failure === 'archive-obligation')
        expect(result.data.findings[0].message).toContain('Archive execution obligations');
      expect(await store.read(f.name)).toEqual(existing);
      expect(
        await ownerStorage.readSdkChangeOwner(target, 'native', f.name, { readOnly: true }),
      ).toBeNull();
      expect(await fs.readFile(portableFile, 'utf8')).toBe(source);
      if (failure === 'existing-projection')
        expect(await fs.readFile(markerFile, 'utf8')).toBe('existing evidence');
    },
  );

  it.each([
    'journal',
    'run',
    'owner',
    'projection',
    'closure',
    'duplicate-owner',
    'changed-source',
    'newer-local',
  ] as const)('keeps portable history import safe after interruption at %s', async (stage) => {
    const f = await fixture();
    await f.runtime.cancel({ runId: f.name, reason: 'Stop this task' });
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'native-history-interruption-'));
    roots.push(target);
    execFileSync('git', ['init', '-b', 'dev'], { cwd: target, stdio: 'ignore' });
    await fs.cp(path.join(f.root, 'docs'), path.join(target, 'docs'), { recursive: true });
    await fs.mkdir(path.join(target, '.comet'));
    await fs.copyFile(
      path.join(f.root, '.comet/config.yaml'),
      path.join(target, '.comet/config.yaml'),
    );
    const cli = async () =>
      JSON.parse(
        (
          await runNativeCli([
            'doctor',
            f.name,
            '--migrate-history',
            '--project-root',
            target,
            '--json',
          ])
        ).stdout!,
      );
    const sourceFile = path.join(target, 'docs/comet/changes', f.name, 'comet-state.yaml');
    const source = await fs.readFile(sourceFile, 'utf8');
    const runtimeRoot = resolveWorkspaceRuntimeRootSync(target);
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(runtimeRoot, 'sdk-runs/native'),
    });
    if (
      ['journal', 'projection', 'duplicate-owner', 'changed-source', 'newer-local'].includes(stage)
    ) {
      const write = atomicFiles.atomicWriteContainedText;
      vi.spyOn(atomicFiles, 'atomicWriteContainedText').mockImplementation(async (...args) => {
        await write(...args);
        if (args[0].includes(stage === 'journal' ? '/history-imports/' : '/state-projections/'))
          throw new Error('Injected publication interruption');
      });
    } else if (stage === 'run' || stage === 'owner') {
      const register = ownerStorage.registerSdkChangeOwner;
      vi.spyOn(ownerStorage, 'registerSdkChangeOwner').mockImplementation(async (...args) => {
        if (stage === 'owner') await register(...args);
        throw new Error('Injected owner interruption');
      });
    } else {
      const close = ownerStorage.closeSdkChangeOwner;
      vi.spyOn(ownerStorage, 'closeSdkChangeOwner').mockImplementation(async (...args) => {
        await close(...args);
        throw new Error('Injected closure interruption');
      });
    }
    expect((await cli()).exitCode).not.toBe(0);
    vi.restoreAllMocks();
    const imported = await store.read(f.name);
    if (stage === 'duplicate-owner' || stage === 'changed-source') {
      const active = path.join(runtimeRoot, 'change-owners/native', `${f.name}.json`);
      const historyFile = path.join(runtimeRoot, 'change-owner-history/native', `${f.name}.json`);
      await fs.mkdir(path.dirname(historyFile), { recursive: true });
      await fs.copyFile(active, historyFile);
      if (stage === 'changed-source') {
        const ownerSource = await fs.readFile(active, 'utf8');
        await fs.appendFile(sourceFile, '\n');
        expect((await cli()).exitCode).not.toBe(0);
        expect(await fs.readFile(active, 'utf8')).toBe(ownerSource);
        expect(await fs.readFile(historyFile, 'utf8')).toBe(ownerSource);
        expect(await store.read(f.name)).toEqual(imported);
        return;
      }
    }
    if (stage === 'newer-local') {
      const newer = { ...imported!, revision: imported!.revision + 1 };
      expect(await store.compareAndSwap(f.name, imported!.revision, newer)).toBe(true);
      expect((await cli()).exitCode).not.toBe(0);
      expect(await store.read(f.name)).toEqual(newer);
      return;
    }
    const resumed = await cli();
    expect(resumed.exitCode, JSON.stringify(resumed)).toBe(0);
    expect(await store.readDisposition(f.name)).toBe('closed');
    if (imported) expect(await store.read(f.name)).toEqual(imported);
    expect((await cli()).exitCode).toBe(0);
    expect(await fs.readFile(sourceFile, 'utf8')).toBe(source);
    expect(await history.hasNativeSdkPortableHistoryImport(target, f.name)).toBe(false);
  });

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
  it('rejects source authority appearing after the history import journal is published', async () => {
    const f = await fixture(true);
    await f.runtime.cancel({ runId: f.name, reason: 'Stop work' });
    const target = f.integrationRoot;
    await fs.cp(path.join(f.root, 'docs'), path.join(target, 'docs'), { recursive: true });
    await fs.mkdir(path.join(target, '.comet'), { recursive: true });
    await fs.copyFile(
      path.join(f.root, '.comet/config.yaml'),
      path.join(target, '.comet/config.yaml'),
    );
    const original = await f.store.read(f.name);
    const sourceFile = path.join(target, 'docs/comet/changes', f.name, 'comet-state.yaml');
    const sourceBytes = await fs.readFile(sourceFile);
    const targetStore = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(target), 'sdk-runs/native'),
    });
    let journalPublished = false;
    let absentObservations = 0;
    let presentObservations = 0;
    const listRoots = gitWorktrees.listGitWorktreeRoots;
    vi.spyOn(gitWorktrees, 'listGitWorktreeRoots').mockImplementation((projectRoot) => {
      const entries = listRoots(projectRoot);
      if (path.resolve(projectRoot) !== path.resolve(target)) return entries;
      if (journalPublished) {
        presentObservations++;
        return entries;
      }
      absentObservations++;
      return entries.filter((root) => path.resolve(root) !== path.resolve(f.root));
    });
    const write = atomicFiles.atomicWriteContainedText;
    vi.spyOn(atomicFiles, 'atomicWriteContainedText').mockImplementation(async (...args) => {
      await write(...args);
      if (args[0].includes('/history-imports/')) journalPublished = true;
    });
    const result = JSON.parse(
      (
        await runNativeCli([
          'doctor',
          f.name,
          '--migrate-history',
          '--project-root',
          target,
          '--json',
        ])
      ).stdout!,
    );
    expect(journalPublished).toBe(true);
    expect(absentObservations).toBeGreaterThan(0);
    expect(presentObservations).toBeGreaterThan(0);
    expect(result.exitCode).not.toBe(0);
    expect(result.data.findings[0].message).toContain('authoritative record');
    expect(
      await ownerStorage.readSdkChangeOwner(target, 'native', f.name, { readOnly: true }),
    ).toBeNull();
    expect(await targetStore.read(f.name)).toBeNull();
    expect(await history.hasNativeSdkPortableHistoryImport(target, f.name)).toBe(true);
    expect(await f.store.read(f.name)).toEqual(original);
    expect(await fs.readFile(sourceFile)).toEqual(sourceBytes);
  });
});
