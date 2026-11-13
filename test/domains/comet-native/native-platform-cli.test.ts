import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('creates a Native Run through the public CLI without managed execution directories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-platform-cli-')),
    data = await mkdtemp(path.join(os.tmpdir(), 'native-platform-data-'));
  roots.push(root, data);
  vi.stubEnv('COMET_DATA_DIR', data);
  await mkdir(path.join(root, '.git'));
  const result = await runNativeCli(['new', 'platform-task', '--project-root', root, '--json']);
  expect(result.exitCode, result.stderr ?? result.stdout).toBe(0);
  const { run } = await inspectNativeSdkRun(root, 'platform-task');
  expect(run.workflow.version).toBe('4');
  expect(run.actions.some((action) => action.stepId.includes('checks'))).toBe(false);
  const files = await readdir(resolveWorkspaceRuntimeRootSync(root), { recursive: true });
  expect(
    files.some((file) => /(?:check-executions|input-snapshots|native-local-execution)/u.test(file)),
  ).toBe(false);
});

it('keeps status show and selection in the requested workspace instead of searching linked worktrees', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'native-explicit-workspace-'));
  roots.push(base);
  const root = path.join(base, 'primary'),
    linked = path.join(base, 'linked');
  await mkdir(root);
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  git(['init', '-b', 'main']);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'baseline',
  ]);
  git(['worktree', 'add', '-b', 'linked', linked]);
  const invoke = (cwd: string, args: string[]) =>
    runNativeCli([...args, '--project-root', cwd, '--json']);
  expect((await invoke(root, ['new', 'primary-task'])).exitCode).toBe(0);
  expect((await invoke(linked, ['new', 'linked-task'])).exitCode).toBe(0);
  const selection = path.join(root, '.comet/current-change.json'),
    before = await readFile(selection, 'utf8');
  const listed = await invoke(root, ['status']);
  expect(listed.exitCode, listed.stdout).toBe(0);
  expect(listed.stdout).toContain('primary-task');
  expect(listed.stdout).not.toContain('linked-task');
  for (const command of ['status', 'show', 'select']) {
    const rejected = await invoke(root, [command, 'linked-task']);
    if (command === 'status') {
      expect(rejected.exitCode, rejected.stdout).toBe(0);
      expect(JSON.parse(rejected.stdout!).data).toMatchObject({
        phase: 'invalid',
        runtime: { status: 'missing' },
      });
    } else expect(rejected.exitCode, rejected.stdout).not.toBe(0);
    expect(await readFile(selection, 'utf8')).toBe(before);
  }
  expect((await invoke(linked, ['status', 'linked-task'])).exitCode).toBe(0);
});
