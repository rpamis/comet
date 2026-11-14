import '../../helpers/isolated-agent-home.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';

interface NativeResult {
  exitCode: number;
  error?: { message: string };
  data?: {
    stateVersion?: number;
    phase?: string;
    task?: { actionId: string; session: string; status: string };
  };
}

describe('Native Build workspace recovery', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-build-workspace-recovery-'));
    git('init', '-b', 'main');
    git('commit', '--allow-empty', '-m', 'Fixture baseline');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  function git(...args: string[]): void {
    execFileSync(
      'git',
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args],
      {
        cwd: projectRoot,
        stdio: 'ignore',
      },
    );
  }

  async function cli(args: string[], root = projectRoot): Promise<NativeResult> {
    const result = await runNativeCli([...args, '--project-root', root, '--json']);
    return JSON.parse(result.stdout!) as NativeResult;
  }

  async function prepareShape(): Promise<number> {
    for (const name of ['shape-a', 'shape-b']) {
      const created = await cli(['new', name]);
      expect(created.exitCode, created.error?.message).toBe(0);
    }
    const changeDir = path.join(projectRoot, 'docs/comet/changes/shape-a');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Outcome\nShip behavior.\n# Scope\nOne feature.\n## Directory structure\n### Modified\n- src/ — feature.\n# Non-goals\nNone.\n# Acceptance examples\n- Behavior works.\n# Constraints and invariants\nPreserve compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nFocused tests.\n',
    );
    await fs.mkdir(path.join(changeDir, 'specs/feature'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs/feature/spec.md'),
      '# Feature\nBehavior works.\n',
    );
    const ready = await cli(['next', 'shape-a']);
    expect(ready.exitCode, ready.error?.message).toBe(0);
    return ready.data!.stateVersion!;
  }

  async function approve(version: number): Promise<void> {
    const approved = await cli([
      'next',
      'shape-a',
      '--confirmed',
      '--defer-build',
      '--summary',
      'Approve and queue implementation',
      '--expected-state-version',
      String(version),
      '--expected-action',
      'confirm-shape',
    ]);
    expect(approved.exitCode, approved.error?.message).toBe(0);
  }

  it('preserves the current target checkpoint and original Builder when its local Run is missing', async () => {
    await approve(await prepareShape());
    const first = await cli(['next', 'shape-a', '--session', 'original-builder']);
    expect(first.exitCode, first.error?.message).toBe(0);
    expect(first.data?.task).toMatchObject({ session: 'original-builder', status: 'running' });

    const target = path.join(projectRoot, '.worktrees/shape-a');
    const checkpointFile = path.join(target, 'docs/comet/changes/shape-a/comet-state.yaml');
    const checkpoint = await fs.readFile(checkpointFile);
    const localRunDirectory = path.join(resolveWorkspaceRuntimeRootSync(target), 'sdk-runs/native');
    await fs.rename(localRunDirectory, `${localRunDirectory}-saved`);

    const retried = await cli(['next', 'shape-a', '--session', 'replacement-builder']);
    expect(retried.data?.task?.session).not.toBe('replacement-builder');
    expect(await fs.readFile(checkpointFile)).toEqual(checkpoint);

    const repaired = await cli(['doctor', 'shape-a', '--repair', '--confirmed'], target);
    expect(repaired.exitCode, repaired.error?.message).toBe(0);
    const resumed = await cli(['next', 'shape-a', '--session', 'original-builder'], target);
    expect(resumed.exitCode, resumed.error?.message).toBe(0);
    const recovered = (await inspectNativeSdkRun(target, 'shape-a', { readOnly: true })).run;
    const builder = recovered.actions.find((action) => action.stepId === 'build.builder');
    expect(builder?.id).toBe(first.data!.task!.actionId);
    expect(builder?.claim?.sessionId).toBe('original-builder');
    expect(['running', 'unknown']).toContain(builder?.status);
  });

  it('inherits committed Shape documents while preserving the approved Run', async () => {
    const version = await prepareShape();
    git('add', 'docs');
    git('commit', '-m', 'Review Shape documents');
    await approve(version);
    const started = await cli(['next', 'shape-a', '--session', 'approved-builder']);
    expect(started.exitCode, started.error?.message).toBe(0);
    expect(started.data?.task).toMatchObject({ session: 'approved-builder', status: 'running' });
    const target = path.join(projectRoot, '.worktrees/shape-a');
    const spec = 'docs/comet/changes/shape-a/specs/feature/spec.md';
    expect(await fs.readFile(path.join(target, spec), 'utf8')).toBe(
      await fs.readFile(path.join(projectRoot, spec), 'utf8'),
    );
    expect((await cli(['status', 'shape-b'])).data?.phase).toBe('shape');
  });
});
