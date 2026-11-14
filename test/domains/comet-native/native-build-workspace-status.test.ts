import '../../helpers/isolated-agent-home.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import { inspectCometProjectStatus } from '../../../domains/comet-entry/project-status.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('reads the current moved Run through source status without advancing or rewriting either workspace', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-build-status-'));
  roots.push(projectRoot);
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'baseline',
    ],
    { cwd: projectRoot, stdio: 'ignore' },
  );
  const cli = async (args: string[]) => {
    const result = await runNativeCli([...args, '--project-root', projectRoot, '--json']);
    const envelope = JSON.parse(result.stdout!);
    expect(envelope.exitCode, envelope.error?.message).toBe(0);
    return envelope;
  };
  await cli(['new', 'shape-a']);
  await cli(['new', 'shape-b']);
  const changeDir = path.join(projectRoot, 'docs/comet/changes/shape-a');
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Outcome\nShip behavior.\n# Scope\nOne feature.\n## Directory structure\n### Modified\n- src/ — feature.\n# Non-goals\nNone.\n# Acceptance examples\n- Behavior works.\n# Constraints and invariants\nPreserve compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nFocused tests.\n',
  );
  await fs.mkdir(path.join(changeDir, 'specs/feature'), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'specs/feature/spec.md'), '# Feature\nBehavior works.\n');
  const prepared = await cli(['next', 'shape-a']);
  await cli([
    'next',
    'shape-a',
    '--confirmed',
    '--summary',
    'Approved',
    '--expected-state-version',
    String(prepared.data.stateVersion),
    '--expected-action',
    'confirm-shape',
  ]);
  const claimed = await cli(['next', 'shape-a', '--session', 'target-builder']);
  expect(claimed.data.task.session).toBe('target-builder');
  const target = path.join(projectRoot, '.worktrees/shape-a');
  const sourceFile = path.join(changeDir, 'comet-state.yaml');
  const targetFile = path.join(target, 'docs/comet/changes/shape-a/comet-state.yaml');
  const sourceBefore = await fs.readFile(sourceFile, 'utf8');
  const targetBefore = await fs.readFile(targetFile, 'utf8');
  const before = await inspectNativeSdkRun(target, 'shape-a', { readOnly: true });

  const sourceRun = await inspectNativeSdkRun(projectRoot, 'shape-a', { readOnly: true });
  expect(sourceRun.run).toEqual(before.run);
  const status = await cli(['status', 'shape-a']);
  expect(status.data.workspace).toMatchObject({ projectRoot: target, bindingState: 'aligned' });
  expect(status.data.run.revision).toBe(before.run.revision);
  const project = await inspectCometProjectStatus(projectRoot);
  const moved = project.workflows.native.changes.find((change) => change.name === 'shape-a');
  expect(moved).toMatchObject({
    phase: 'build',
    workspace: { projectRoot: target, bindingState: 'aligned' },
  });
  expect(moved).not.toHaveProperty('error');
  await expect(
    createNativeSdkStateStore(projectRoot).compareAndSwap('shape-a', before.run.revision, {
      ...before.run,
      revision: before.run.revision + 1,
    }),
  ).rejects.toThrow('moved');

  expect((await inspectNativeSdkRun(target, 'shape-a', { readOnly: true })).run).toEqual(
    before.run,
  );
  expect(await fs.readFile(sourceFile, 'utf8')).toBe(sourceBefore);
  expect(await fs.readFile(targetFile, 'utf8')).toBe(targetBefore);
});
