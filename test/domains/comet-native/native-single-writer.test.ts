import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { nativeNewCommand } from '../../../domains/comet-native/native-new-command.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { readNativeSdkRunRecord } from '../../../domains/comet-native/native-sdk-state-store.js';
import { projectNativeSupervisorTask } from '../../../domains/comet-native/native-supervisor-model.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-single-writer-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  return { root, paths };
}

it('creates a Native workspace without project or checkpoint lock directories', async () => {
  const { root, paths } = await project();
  const created = await nativeNewCommand(['single-writer'], root);
  expect(created.exitCode).toBe(0);
  expect((await readNativeSdkRunRecord(root, 'single-writer'))?.runId).toBe('single-writer');
  await expect(fs.access(path.join(paths.runtimeDir, 'locks'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(
    fs.access(path.join(resolveWorkspaceRuntimeRootSync(root), 'state-projections/native')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  const runtimeFiles = await fs.readdir(paths.workspaceRuntimeRoot, { recursive: true });
  expect(
    runtimeFiles.filter((file) => /\.lock(?:\.sqlite(?:-(?:journal|wal|shm))?)?$/u.test(file)),
  ).toEqual([]);
});

it('ignores retired Native lock records without changing their bytes or asking for a token', async () => {
  const { root, paths } = await project();
  const oldLocks = [
    path.join(paths.runtimeDir, 'locks', 'root-move.lock'),
    path.join(paths.runtimeDir, 'locks', '.recovery.lock'),
    path.join(paths.runtimeDir, 'locks', '.coordinator', 'old.claim'),
    path.join(
      resolveWorkspaceRuntimeRootSync(root),
      'state-projections/native',
      'single-writer.lock',
    ),
  ];
  const bytes = 'SIMULATED obsolete lock metadata: preserve as historical bytes\n';
  for (const file of oldLocks) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  }
  expect((await nativeNewCommand(['single-writer'], root)).exitCode).toBe(0);
  const original = await readNativeSdkRunRecord(root, 'single-writer');
  for (const args of [[], ['single-writer']]) {
    const diagnosed = await nativeDoctorCommand([...args], root);
    expect(diagnosed.exitCode).toBe(0);
    expect(diagnosed.data).not.toHaveProperty('locks');
    expect(JSON.stringify(diagnosed)).not.toContain('--lock-token');
  }
  expect(await readNativeSdkRunRecord(root, 'single-writer')).toEqual(original);
  for (const file of oldLocks) expect(await fs.readFile(file, 'utf8')).toBe(bytes);
});

it('returns Child results to the parent for serial submission without changing their original task identity', () => {
  const childRoot = path.resolve('isolated-child-worktree');
  const parentRoot = path.resolve('parent-control-worktree');
  const task = {
    role: 'builder' as const,
    child: 'original-child',
    projectRoot: childRoot,
    baseCommit: '1'.repeat(40),
    runId: 'original-child-task',
  };
  const projected = projectNativeSupervisorTask(task, 'original-parent', parentRoot);
  expect(projected).toMatchObject(task);
  expect(projected.instruction).toContain('自己的 worktree');
  expect(projected.instruction).toContain('JSON 返回父 Agent');
  expect(projected.instruction).toContain('controlProjectRoot 串行');
  expect(projected.returnAction.cwd).toBe(parentRoot);
  expect(projected.returnAction.commandArgs).toEqual([
    'comet',
    'native',
    'next',
    'original-parent',
    '--runner-input',
    '<temporary-json-file>',
    '--json',
  ]);
  expect(projected.returnAction.inputOptions[0].template).toMatchObject({
    child: task.child,
    runId: task.runId,
  });
});
