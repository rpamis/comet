import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

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
