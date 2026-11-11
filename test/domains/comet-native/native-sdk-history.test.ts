import '../../helpers/isolated-agent-home.js';
import * as runtimeStoreModule from '../../../domains/engine/runtime-store.js';
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
    ).rejects.toThrow(/definition hash/);
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
      const sourceFile = path.join(target, 'docs/comet/changes', f.name, 'comet-state.yaml');
      const document = parseNativeStateDocument(
        await fs.readFile(sourceFile, 'utf8'),
        'actual checkpoint',
      ) as Record<string, unknown>;
      const saved = readPortableRunCheckpoint(document.run_checkpoint, f.name, {
        preserveSourceRevision: true,
      })!;
      expect(restored).toEqual(saved);
      expect(await targetStore.readDisposition(f.name)).toBe(
        status === 'cancelled' ? 'closed' : 'active',
      );
      if (status === 'cancelled') {
        expect((await cli(['next', f.name])).exitCode).toBe(0);
        expect(await targetStore.readDisposition(f.name)).toBe('closed');
        expect((await targetStore.read(f.name))!).toEqual(saved);
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
      await f.runtime.claim({
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
      const portable = (await fs.readFile(portableFile, 'utf8')).replace(/\r?\n/gu, '\r\n');
      await fs.writeFile(portableFile, portable);

      const migrated =
        boundary === 'runtime'
          ? await cli(['doctor', f.name, '--repair', '--confirmed'])
          : JSON.parse(
              spawnSync(
                process.execPath,
                [
                  path.resolve(
                    process.env.COMET_TEST_PACKAGE_ROOT ?? '.',
                    'assets/skills/comet-native/scripts/comet-native-doctor.mjs',
                  ),
                  f.name,
                  '--repair',
                  '--confirmed',
                  '--project-root',
                  target,
                  '--json',
                ],
                { encoding: 'utf8' },
              ).stdout,
            );
      expect(migrated.exitCode, JSON.stringify(migrated)).toBe(0);

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
      const repeated = await cli(['doctor', f.name, '--repair', '--confirmed']);
      expect(repeated.exitCode, JSON.stringify(repeated)).toBe(0);
      const globalDoctor = await cli(['doctor']);
      expect(globalDoctor.exitCode, JSON.stringify(globalDoctor)).toBe(0);
      expect(await listActiveNativeHookChanges(target)).toEqual([]);
      expect(await fs.readFile(portableFile, 'utf8')).toBe(portable);
    },
  );

  it.each(['original', 'newer'] as const)(
    'preserves the %s source authority when explicitly restoring a local cancellation',
    async (version) => {
      const f = await fixture(true);
      await f.runtime.cancel({ runId: f.name, reason: 'SIMULATED user cancellation' });
      const original = (await f.store.read(f.name))!;
      const target = f.integrationRoot;
      await fs.cp(path.join(f.root, 'docs'), path.join(target, 'docs'), { recursive: true });
      await fs.mkdir(path.join(target, '.comet'), { recursive: true });
      await fs.copyFile(
        path.join(f.root, '.comet/config.yaml'),
        path.join(target, '.comet/config.yaml'),
      );
      if (version === 'newer') {
        expect(await f.store.reopenRun(f.name, original.revision)).toBe(true);
        expect(
          await f.store.compareAndSwap(f.name, original.revision, {
            ...original,
            revision: original.revision + 1,
          }),
        ).toBe(true);
      }
      const retained = await f.store.read(f.name),
        portableFile = path.join(target, 'docs/comet/changes', f.name, 'comet-state.yaml'),
        bytes = await fs.readFile(portableFile),
        document = parseNativeStateDocument(bytes.toString(), 'actual checkpoint') as Record<
          string,
          unknown
        >,
        saved = readPortableRunCheckpoint(document.run_checkpoint, f.name, {
          preserveSourceRevision: true,
        })!;
      const store = createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(target), 'sdk-runs/native'),
      });
      const result = await runNativeCli([
        'doctor',
        f.name,
        '--repair',
        '--confirmed',
        '--project-root',
        target,
        '--json',
      ]);
      expect(result.exitCode, result.stdout).toBe(0);
      expect(await store.read(f.name)).toEqual(saved);
      expect(await store.readDisposition(f.name)).toBe('closed');
      expect(await f.store.read(f.name)).toEqual(retained);
      expect(await fs.readFile(portableFile)).toEqual(bytes);
      expect(await listActiveNativeHookChanges(target)).toEqual([]);
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
    'preserves portable and local evidence at common recovery boundary: %s',
    async (failure) => {
      const f = await fixture();
      const initial = await f.runtime.inspect(f.name),
        action = initial.actions.at(-1)!;
      // 此分支只保留原测试的 SIMULATED 步骤名称损坏；不生成归档领取、事务或成功证据。
      if (failure !== 'archive-obligation')
        await f.runtime.claim({
          runId: f.name,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'original-host',
          sessionId: 'SIMULATED-original-agent',
          claimToken: 'original-claim',
        });
      if (failure !== 'active')
        await f.runtime.cancel({
          runId: f.name,
          reason: 'SIMULATED user cancellation; platform cleanup is external',
        });
      const original = (await f.store.read(f.name))!;
      const target = await fs.mkdtemp(path.join(os.tmpdir(), 'native-common-history-guard-'));
      roots.push(target);
      execFileSync('git', ['init', '-b', 'main'], { cwd: target, stdio: 'ignore' });
      await fs.cp(path.join(f.root, 'docs'), path.join(target, 'docs'), { recursive: true });
      await fs.mkdir(path.join(target, '.comet'));
      await fs.copyFile(
        path.join(f.root, '.comet/config.yaml'),
        path.join(target, '.comet/config.yaml'),
      );
      const runtimeRoot = resolveWorkspaceRuntimeRootSync(target),
        store = createFileRuntimeStore<WorkflowRun>({
          rootDir: path.join(runtimeRoot, 'sdk-runs/native'),
        }),
        portableFile = path.join(target, 'docs/comet/changes', f.name, 'comet-state.yaml');
      const document = parseNativeStateDocument(
        await fs.readFile(portableFile, 'utf8'),
        'actual portable checkpoint',
      ) as Record<string, unknown>;
      if (failure === 'corrupt-hash')
        (document.run_checkpoint as { hash: string }).hash = 'f'.repeat(64);
      if (['unknown-definition', 'archive-obligation', 'child-lineage'].includes(failure)) {
        const run = readPortableRunCheckpoint(document.run_checkpoint, f.name, {
          preserveSourceRevision: true,
        })!;
        if (failure === 'unknown-definition') {
          run.workflow.hash = 'f'.repeat(64);
          run.definitionHashes[JSON.stringify([run.workflow.id, run.workflow.version])] =
            run.workflow.hash;
        }
        if (failure === 'archive-obligation') run.actions[0].stepId = 'archive.finalize';
        if (failure === 'child-lineage') run.lineage = ['parent-run'];
        document.run_checkpoint = createPortableRunCheckpoint(run);
      }
      if (failure === 'fixed-application')
        document.application_checkpoint = { id: 'custom-native' };
      await fs.writeFile(portableFile, NATIVE_MANAGED_RUN_MARKER + stringify(document));
      const source = await fs.readFile(portableFile);
      const selection = path.join(target, '.comet/current-change.json');
      if (failure === 'pending-cleanup')
        await fs.writeFile(
          selection,
          JSON.stringify({
            schema: 'comet.selection.v2',
            workflow: 'native',
            change: f.name,
            branch: null,
          }),
        );
      if (failure === 'existing-run') await store.restoreCheckpoint(f.name, null, original);
      const existing = await store.read(f.name),
        marker = path.join(runtimeRoot, 'state-projections/native/' + f.name + '.json');
      const existingCheckpoint =
        failure === 'existing-run'
          ? await fs.readFile(
              path.join(
                runtimeRoot,
                'sdk-runs/native/.runtime-store-v2',
                createHash('sha256').update(JSON.stringify(f.name)).digest('hex'),
                'checkpoint.json',
              ),
            )
          : null;
      const sourceEvidence =
        failure === 'existing-run'
          ? {
              portableFile: path.join(f.root, 'docs/comet/changes', f.name, 'comet-state.yaml'),
              checkpointFile: path.join(
                resolveWorkspaceRuntimeRootSync(f.root),
                'sdk-runs/native/.runtime-store-history',
                createHash('sha256').update(JSON.stringify(f.name)).digest('hex'),
                'checkpoint.json',
              ),
            }
          : null;
      const originalSourceBytes = sourceEvidence
        ? {
            portable: await fs.readFile(sourceEvidence.portableFile),
            checkpoint: await fs.readFile(sourceEvidence.checkpointFile),
          }
        : null;
      if (failure === 'existing-projection') {
        await fs.mkdir(path.dirname(marker), { recursive: true });
        await fs.writeFile(marker, 'Retired unrelated marker bytes\n');
      }
      const result = await runNativeCli([
        'doctor',
        f.name,
        '--repair',
        '--confirmed',
        '--project-root',
        target,
        '--json',
      ]);
      const restored = await store.read(f.name);
      if (
        ['corrupt-hash', 'unknown-definition', 'child-lineage', 'fixed-application'].includes(
          failure,
        )
      ) {
        expect(result.exitCode, result.stdout).not.toBe(0);
        expect(restored).toEqual(existing);
        expect(
          await ownerStorage.readSdkChangeOwner(target, 'native', f.name, { readOnly: true }),
        ).toBeNull();
      } else {
        expect(result.exitCode, result.stdout).toBe(0);
        const saved = readPortableRunCheckpoint(document.run_checkpoint, f.name, {
          preserveSourceRevision: true,
        })!;
        expect(restored).toEqual(failure === 'existing-run' ? original : saved);
        expect(await store.readDisposition(f.name)).toBe(
          failure === 'active' ? 'active' : 'closed',
        );
        if (failure === 'existing-run') {
          expect(existing).toEqual(original);
          expect(restored!.actions).toEqual(original.actions);
          expect(restored!.actions[0].claim).toEqual(original.actions[0].claim);
          expect(restored!.actions[0].claim?.token).toBe('original-claim');
          expect(
            await ownerStorage.readSdkChangeOwner(target, 'native', f.name, { readOnly: true }),
          ).toMatchObject({
            workflow: 'native',
            application: 'native',
            format: 'sdk',
            runId: f.name,
            change: f.name,
          });
          expect(
            await listSdkChangeNames(target, 'native', { readOnly: true, partition: 'active' }),
          ).toEqual([]);
          expect(
            await listSdkChangeNames(target, 'native', { readOnly: true, partition: 'history' }),
          ).toEqual([f.name]);
          const closedCheckpoint = path.join(
            runtimeRoot,
            'sdk-runs/native/.runtime-store-history',
            createHash('sha256').update(JSON.stringify(f.name)).digest('hex'),
            'checkpoint.json',
          );
          expect(await fs.readFile(closedCheckpoint)).toEqual(existingCheckpoint);
          const historyOwner = path.join(
            runtimeRoot,
            'change-owner-history/native',
            f.name + '.json',
          );
          const ownerBytes = await fs.readFile(historyOwner);
          const again = await runNativeCli([
            'doctor',
            f.name,
            '--repair',
            '--confirmed',
            '--project-root',
            target,
            '--json',
          ]);
          expect(again.exitCode, again.stdout).toBe(0);
          expect(await store.read(f.name)).toEqual(original);
          expect(await fs.readFile(closedCheckpoint)).toEqual(existingCheckpoint);
          expect(await fs.readFile(historyOwner)).toEqual(ownerBytes);
          expect(await fs.readFile(sourceEvidence!.portableFile)).toEqual(
            originalSourceBytes!.portable,
          );
          expect(await fs.readFile(sourceEvidence!.checkpointFile)).toEqual(
            originalSourceBytes!.checkpoint,
          );
        }
        if (failure === 'pending-cleanup')
          await expect(fs.access(selection)).rejects.toMatchObject({ code: 'ENOENT' });
        if (failure === 'existing-projection')
          expect(await fs.readFile(marker, 'utf8')).toBe('Retired unrelated marker bytes\n');
      }
      expect(await fs.readFile(portableFile)).toEqual(source);
      expect(await f.store.read(f.name)).toEqual(original);
    },
  );

  it.each([
    'owner-before',
    'owner-after',
    'run-after',
    'closure-after',
    'duplicate-owner',
    'changed-source',
    'newer-local',
  ] as const)(
    'preserves checkpoint authority after common recovery interruption: %s',
    async (stage) => {
      const f = await fixture();
      await f.runtime.cancel({ runId: f.name, reason: 'SIMULATED user cancellation' });
      const original = (await f.store.read(f.name))!;
      const target = await fs.mkdtemp(
        path.join(os.tmpdir(), 'native-common-history-interruption-'),
      );
      roots.push(target);
      execFileSync('git', ['init', '-b', 'main'], { cwd: target, stdio: 'ignore' });
      await fs.cp(path.join(f.root, 'docs'), path.join(target, 'docs'), { recursive: true });
      await fs.mkdir(path.join(target, '.comet'));
      await fs.copyFile(
        path.join(f.root, '.comet/config.yaml'),
        path.join(target, '.comet/config.yaml'),
      );
      const runtimeRoot = resolveWorkspaceRuntimeRootSync(target),
        store = createFileRuntimeStore<WorkflowRun>({
          rootDir: path.join(runtimeRoot, 'sdk-runs/native'),
        }),
        file = path.join(target, 'docs/comet/changes', f.name, 'comet-state.yaml'),
        source = await fs.readFile(file),
        document = parseNativeStateDocument(source.toString(), 'actual checkpoint') as Record<
          string,
          unknown
        >,
        saved = readPortableRunCheckpoint(document.run_checkpoint, f.name, {
          preserveSourceRevision: true,
        })!;
      const cli = async (args = ['--repair', '--confirmed']) =>
        JSON.parse(
          (await runNativeCli(['doctor', f.name, ...args, '--project-root', target, '--json']))
            .stdout!,
        );
      let injected = false;
      if (['owner-before', 'owner-after', 'duplicate-owner'].includes(stage)) {
        const register = ownerStorage.registerSdkChangeOwner;
        vi.spyOn(ownerStorage, 'registerSdkChangeOwner').mockImplementation(async (...args) => {
          if (path.resolve(args[0]) !== path.resolve(target)) return register(...args);
          if (injected) return register(...args);
          injected = true;
          if (stage !== 'owner-before') await register(...args);
          if (stage === 'duplicate-owner') {
            const active = path.join(runtimeRoot, 'change-owners/native', f.name + '.json'),
              historical = path.join(runtimeRoot, 'change-owner-history/native', f.name + '.json');
            await fs.mkdir(path.dirname(historical), { recursive: true });
            await fs.copyFile(active, historical);
          }
          throw new Error('SIMULATED interruption at ' + stage);
        });
      } else if (stage === 'closure-after') {
        const close = ownerStorage.closeSdkChangeOwner;
        vi.spyOn(ownerStorage, 'closeSdkChangeOwner').mockImplementation(async (...args) => {
          const value = await close(...args);
          if (path.resolve(args[0]) === path.resolve(target) && !injected) {
            injected = true;
            throw new Error('SIMULATED closure publication interruption');
          }
          return value;
        });
      } else {
        const create = runtimeStoreModule.createFileRuntimeStore;
        vi.spyOn(runtimeStoreModule, 'createFileRuntimeStore').mockImplementation((options) => {
          const actual = create(options);
          if (path.resolve(options.rootDir) !== path.resolve(runtimeRoot, 'sdk-runs/native'))
            return actual;
          const restore = actual.restoreCheckpoint!;
          return {
            ...actual,
            async restoreCheckpoint(...args: Parameters<typeof restore>) {
              const value = await restore(...args);
              if (!injected) {
                injected = true;
                throw new Error('SIMULATED committed checkpoint interruption');
              }
              return value;
            },
          };
        });
      }
      const first = await cli();
      expect(injected).toBe(true);
      expect(first.exitCode, JSON.stringify(first)).not.toBe(0);
      vi.restoreAllMocks();
      const imported = await store.read(f.name);
      if (imported) expect(imported).toEqual(saved);
      let expected = imported ?? saved,
        expectedSource = source;
      if (stage === 'changed-source') {
        const changed = {
          ...saved,
          reason: 'SIMULATED changed portable source after local checkpoint committed',
        };
        document.run_checkpoint = createPortableRunCheckpoint(changed);
        expectedSource = Buffer.from(NATIVE_MANAGED_RUN_MARKER + stringify(document));
        await fs.writeFile(file, expectedSource);
      }
      if (stage === 'newer-local') {
        const newer = { ...imported!, revision: imported!.revision + 1 };
        expect(await store.compareAndSwap(f.name, imported!.revision, newer)).toBe(true);
        expected = newer;
      }
      const resumed = await cli(
        stage === 'duplicate-owner' ? ['--migrate-history'] : ['--repair', '--confirmed'],
      );
      expect(resumed.exitCode, JSON.stringify(resumed)).toBe(0);
      expect(await store.read(f.name)).toEqual(expected);
      expect(await store.readDisposition(f.name)).toBe('closed');
      expect((await cli()).exitCode).toBe(0);
      expect(await store.read(f.name)).toEqual(expected);
      expect(await fs.readFile(file)).toEqual(expectedSource);
      expect(await f.store.read(f.name)).toEqual(original);
    },
  );

  it('reports explicit migration results without polluting JSON or ordinary doctor', async () => {
    const f = await fixture(),
      stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect((await f.cli(['doctor', f.name])).exitCode).toBe(0);
    expect(await f.store.readDisposition(f.name)).toBe('active');
    stderr.mockClear();
    const result = await runNativeCli([
      'doctor',
      '--migrate-history',
      '--project-root',
      f.root,
      '--json',
    ]);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      healthy: true,
      migrated: [],
      active: [f.name],
    });
    expect(result.stdout).not.toContain('[Comet]');
    expect(stderr.mock.calls.flat().join('')).not.toContain('Native 历史迁移');
  });

  it('keeps migration failures visible in the structured result', async () => {
    const f = await fixture(),
      result = await f.cli(['doctor', 'missing-history', '--migrate-history']);
    expect(result.exitCode).not.toBe(0);
    expect(result.data).toMatchObject({
      healthy: false,
      migrated: [],
      findings: [{ change: 'missing-history', code: 'native-history-migration-failed' }],
    });
  });

  it('rejects combining migration with unrelated mutation flags', async () => {
    const f = await fixture();
    expect((await f.cli(['doctor', '--migrate-history', '--repair'])).exitCode).not.toBe(0);
    expect(await f.store.readDisposition(f.name)).toBe('active');
  });

  it('preserves the original workspace when an explicit local recovery is refused', async () => {
    const f = await fixture(true);
    const original = (await f.store.read(f.name))!;
    const target = f.integrationRoot;
    await fs.cp(path.join(f.root, 'docs'), path.join(target, 'docs'), { recursive: true });
    await fs.mkdir(path.join(target, '.comet'));
    await fs.copyFile(
      path.join(f.root, '.comet/config.yaml'),
      path.join(target, '.comet/config.yaml'),
    );
    const file = path.join(target, 'docs/comet/changes', f.name, 'comet-state.yaml'),
      bytes = await fs.readFile(file);
    const result = await runNativeCli([
      'doctor',
      f.name,
      '--repair',
      '--confirmed',
      '--project-root',
      target,
      '--json',
    ]);
    expect(result.exitCode, result.stdout).not.toBe(0);
    expect(
      await ownerStorage.readSdkChangeOwner(target, 'native', f.name, { readOnly: true }),
    ).toBeNull();
    expect(
      await createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(target), 'sdk-runs/native'),
      }).read(f.name),
    ).toBeNull();
    expect(await f.store.read(f.name)).toEqual(original);
    expect(await fs.readFile(file)).toEqual(bytes);
  });

  it('does not report an unclosed terminal Run as migrated or release its selected business', async () => {
    const f = await fixture();
    const { createRuntime } = await import('../../../domains/engine/runtime.js');
    const { nativeSdkApplicationForRun } =
      await import('../../../domains/comet-native/native-sdk-application.js');
    const app = nativeSdkApplicationForRun(null);
    const raw = createRuntime({
      ...app,
      store: f.store,
      workflows: [app.workflow],
      transitionHandlers: [app.transitionHandler],
    });
    const cancelled = await raw.cancel({
      runId: f.name,
      reason: 'SIMULATED committed cancellation before selection cleanup',
    });
    const selection = path.join(f.root, '.comet/current-change.json'),
      bytes = await fs.readFile(selection);
    const result = await f.cli(['doctor', f.name, '--migrate-history']);
    expect(result.exitCode, JSON.stringify(result)).not.toBe(0);
    expect(result.data).toMatchObject({
      healthy: false,
      migrated: [],
      findings: [{ change: f.name, code: 'native-history-closure-pending' }],
    });
    expect(await f.store.read(f.name)).toEqual(cancelled);
    expect(await f.store.readDisposition(f.name)).toBe('active');
    expect(await fs.readFile(selection)).toEqual(bytes);
  });
});
