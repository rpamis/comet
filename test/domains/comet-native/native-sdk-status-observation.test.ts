import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';
import {
  createPortableRunCheckpoint,
  readRuntimeProjection,
  queryRuntimeProjection,
} from '../../../domains/engine/runtime.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import { nativePortableStateFile } from '../../../domains/comet-native/native-portable-storage.js';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import * as executions from '../../../domains/comet-native/native-sdk-check-execution.js';
import { projectNativeSdkContinuation } from '../../../domains/comet-native/native-sdk-continuation.js';
import * as nativePaths from '../../../domains/comet-native/native-paths.js';
import {
  inspectNativeSdkStatus,
  projectNativeSdkStatus,
} from '../../../domains/comet-native/native-sdk-status.js';

const roots: string[] = [];
it('rejects a valid but different portable body on compact current reads', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'native-compact-observation-'));
  roots.push(projectRoot);
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  const name = 'compact-observation';
  const created = await runNativeCli(['new', name, '--project-root', projectRoot, '--json']);
  expect(created.exitCode, created.stderr).toBe(0);
  const authoritative = await createNativeSdkRuntime(projectRoot).inspect(name);
  const store = createNativeSdkStateStore(projectRoot, { readOnly: true });
  const paths = await nativePaths.nativeProjectPaths(
    projectRoot,
    (authoritative.input as { artifactRootRef: string }).artifactRootRef,
    { readOnly: true },
  );
  const file = nativePortableStateFile(paths, name);
  const original = await fs.readFile(file, 'utf8');
  const projection = await readRuntimeProjection(store, name);
  expect(queryRuntimeProjection(projection, { view: 'current' })).toMatchObject({
    runId: name,
    revision: authoritative.revision,
  });
  expect(await fs.readFile(file, 'utf8')).toBe(original);
  const document = parseDocument(original);
  document.set(
    'run_checkpoint',
    createPortableRunCheckpoint({ ...authoritative, reason: '与权威历史不一致的有效副本' }),
  );
  const changed = document.toString();
  await fs.writeFile(file, changed);
  await expect(readRuntimeProjection(store, name)).rejects.toThrow(/projection needs recovery/);
  expect(await fs.readFile(file, 'utf8')).toBe(changed);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('shares cancellation inspection only within one status projection and keeps independent continuations fresh', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'native-status-observation-'));
  roots.push(projectRoot);
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  const name = 'cancel-observation';
  const created = await runNativeCli(['new', name, '--project-root', projectRoot, '--json']);
  expect(created.exitCode, created.stderr).toBe(0);
  await createNativeSdkRuntime(projectRoot).cancel({ runId: name, reason: 'Stop before work' });
  const inspected = await inspectNativeSdkRun(projectRoot, name, { readOnly: true });
  const probe = vi.spyOn(executions, 'inspectNativeSdkCheckExecutions');
  const pathsProbe = vi.spyOn(nativePaths, 'nativeProjectPaths');

  const first = await projectNativeSdkStatus({ projectRoot, name }, inspected);
  expect(first).toMatchObject({
    status: 'cancelled',
    diagnostics: {
      stateReadable: true,
      executionReconciled: true,
      storageSettled: true,
      healthy: true,
      issues: [],
    },
    cancellation: { status: 'cancelled', quiescent: true },
    continuation: { status: 'cancelled', disposition: 'done' },
  });
  expect(probe).toHaveBeenCalledTimes(1);

  const second = await projectNativeSdkStatus({ projectRoot, name }, inspected);
  expect(second).toEqual(first);
  expect(probe).toHaveBeenCalledTimes(2);

  const continuation = await projectNativeSdkContinuation({
    projectRoot,
    run: inspected.run,
    state: inspected.state,
  });
  expect(continuation).toMatchObject({
    cancellation: { status: 'cancelled' },
    continuation: { status: 'cancelled', disposition: 'done' },
  });
  expect(probe).toHaveBeenCalledTimes(3);
  expect(pathsProbe).not.toHaveBeenCalled();

  // A new observation still validates authoritative storage before projecting it.
  await expect(inspectNativeSdkStatus({ projectRoot, name })).resolves.toEqual(first);
  expect(pathsProbe).toHaveBeenCalledTimes(1);

  const nativeRoot = path.join(projectRoot, 'docs', 'comet');
  const movedRoot = path.join(projectRoot, 'docs', 'moved-comet');
  await fs.rename(nativeRoot, movedRoot);
  await fs.symlink(movedRoot, nativeRoot, 'dir');
  await expect(inspectNativeSdkStatus({ projectRoot, name })).rejects.toThrow(/symbolic link/u);

  // Projection-only input; no synthetic candidate is persisted or dispatched.
  await expect(
    projectNativeSdkStatus(
      { projectRoot, name },
      {
        ...inspected,
        state: {
          ...inspected.state,
          builder_handoff: { candidate_id: 'projection-only-candidate' } as NonNullable<
            typeof inspected.state.builder_handoff
          >,
        },
      },
    ),
  ).rejects.toThrow(/symbolic link/u);
});

it('keeps unresolved execution diagnostics read-only and shares one active-run observation', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'native-active-observation-'));
  roots.push(projectRoot);
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  const name = 'unknown-observation';
  const created = await runNativeCli(['new', name, '--project-root', projectRoot, '--json']);
  expect(created.exitCode, created.stderr).toBe(0);
  const runtime = createNativeSdkRuntime(projectRoot);
  const initial = await runtime.inspect(name);
  const action = initial.actions.find((entry) => entry.status === 'pending')!;
  await runtime.claim({
    runId: name,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'original-host',
    claimToken: 'original-execution',
  });
  await runtime.markUnknown({
    runId: name,
    actionId: action.id,
    attempt: action.attempt,
    reason: '宿主回报中断，需核对原执行',
  });
  const inspected = await inspectNativeSdkRun(projectRoot, name, { readOnly: true });
  const probe = vi.spyOn(executions, 'inspectNativeSdkCheckExecutions');
  const status = await projectNativeSdkStatus({ projectRoot, name }, inspected);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(status.diagnostics).toMatchObject({
    stateReadable: true,
    executionReconciled: false,
    storageSettled: true,
    healthy: false,
    issues: [expect.objectContaining({ code: 'native-execution-outcome-unresolved' })],
  });
  expect((await runtime.inspect(name)).revision).toBe(inspected.run.revision);
});
