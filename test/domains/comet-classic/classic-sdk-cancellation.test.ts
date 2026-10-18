import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { isClassicSdkCancellationComplete } from '../../../domains/comet-classic/classic-sdk-run-lifecycle.js';
import {
  listActiveClassicHookChanges,
  inspectClassicHookGuard,
} from '../../../domains/comet-classic/classic-hook-guard.js';
import { inspectCometHook } from '../../../domains/comet-entry/hook-router.js';
import {
  readCometCurrentSelection,
  writeCometCurrentSelection,
} from '../../../domains/workflow-contract/current-selection.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(profile: 'full' | 'tweak' = 'full') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-cancellation-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const cli = async (...args: string[]) => {
    const result = await runClassicCli([args[0], '--json', ...args.slice(1)], undefined, {
      projectRoot: root,
      invocationCwd: root,
    });
    return JSON.parse(result.stdout!);
  };
  expect((await cli('state', 'init', 'demo', profile, '--isolation', 'current')).exitCode).toBe(0);
  expect((await cli('state', 'select', 'demo')).exitCode).toBe(0);
  const dispatch = async (request: object) => {
    const file = path.join(root, 'request.json');
    await fs.writeFile(file, JSON.stringify(request));
    const result = await runtimeDispatchCommand(
      { request: file, application: `classic-${profile}`, projectRoot: root },
      { invocationCwd: root },
    );
    expect(result.exitCode, JSON.stringify(result.response)).toBe(0);
    return result.response;
  };
  const request = {
    intent: 'write' as const,
    toolName: 'Write',
    targets: [path.join(root, 'src/example.ts')],
  };
  return { root, cli, dispatch, request };
}

it('releases a publicly cancelled unclaimed Run and retains its history and artifacts', async () => {
  const f = await fixture();
  expect((await inspectCometHook(f.root, f.request)).allowed).toBe(false);
  const original = (await inspectClassicSdkRun(f.root, 'demo')).run;
  await f.dispatch({ operation: 'cancel', runId: 'demo', reason: 'User cancelled this change' });
  const cancelled = (await inspectClassicSdkRun(f.root, 'demo')).run;
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.workflow).toEqual(original.workflow);
  expect(cancelled.actions.map((action) => action.id)).toEqual(
    original.actions.map((action) => action.id),
  );
  expect(await fs.stat(path.join(f.root, 'openspec/changes/demo/comet-state.yaml'))).toBeDefined();
  expect(await readCometCurrentSelection(f.root)).toMatchObject({ status: 'missing' });
  expect(await listActiveClassicHookChanges(f.root)).toEqual([]);
  expect((await inspectCometHook(f.root, f.request)).allowed).toBe(true);
  expect((await f.cli('state', 'next', 'demo')).agent.continuation.mode).toBe('done');
  expect((await f.cli('state', 'select', 'demo')).exitCode).not.toBe(0);
  expect((await f.cli('state', 'clear-selection')).exitCode).toBe(0);
  expect((await inspectCometHook(f.root, f.request)).allowed).toBe(true);
  // Interrupted selection cleanup is harmless to read-only routing and is retried by a write read.
  await writeCometCurrentSelection(f.root, {
    schema: 'comet.selection.v2',
    workflow: 'classic',
    change: 'demo',
    branch: null,
  });
  expect((await inspectCometHook(f.root, f.request)).allowed).toBe(true);
  expect(await readCometCurrentSelection(f.root)).toMatchObject({ status: 'selected' });
  await f.cli('state', 'next', 'demo');
  expect(await readCometCurrentSelection(f.root)).toMatchObject({ status: 'missing' });
});

it.each(['running', 'unknown'] as const)(
  'keeps a cancelled %s Build claim guarded until the original host acknowledges stopping',
  async (status) => {
    const f = await fixture('tweak');
    for (const file of ['proposal.md', 'design.md', 'tasks.md'])
      await fs.writeFile(
        path.join(f.root, 'openspec/changes/demo', file),
        file === 'tasks.md' ? '- [ ] Implement change\n' : `# ${file}\n`,
      );
    const preview = await f.cli('guard', 'demo', 'open');
    expect(
      (
        await f.cli(
          'guard',
          'demo',
          'open',
          '--apply',
          '--approval-hash',
          preview.data.approvalHash,
        )
      ).exitCode,
    ).toBe(0);
    const { run, runtime } = await inspectClassicSdkRun(f.root, 'demo');
    const action = run.actions.find((action) => action.status === 'pending')!;
    await runtime.claim({
      runId: 'demo',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'original-host',
      claimToken: 'original-claim',
    });
    if (status === 'unknown')
      await runtime.markUnknown({
        runId: 'demo',
        actionId: action.id,
        attempt: action.attempt,
        reason: 'host disconnected',
      });
    await f.dispatch({ operation: 'cancel', runId: 'demo', reason: 'User cancelled' });
    expect((await readCometCurrentSelection(f.root)).status).toBe('selected');
    expect(await listActiveClassicHookChanges(f.root)).toHaveLength(1);
    expect((await inspectCometHook(f.root, f.request)).allowed).toBe(false);
    expect((await f.cli('state', 'next', 'demo')).agent.continuation.mode).toBe('reconcile');
    await f.cli('state', 'clear-selection');
    expect((await inspectCometHook(f.root, f.request)).allowed).toBe(false);
    expect((await inspectClassicHookGuard(f.root, 'demo', f.request)).allowed).toBe(false);
    await f.dispatch({
      operation: 'cancel',
      runId: 'demo',
      reason: 'User cancelled',
      stoppedActions: [
        {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'original-claim',
          evidence: 'Original host confirmed its execution and child tasks have stopped',
        },
      ],
    });
    expect(await listActiveClassicHookChanges(f.root)).toEqual([]);
    expect((await inspectCometHook(f.root, f.request)).allowed).toBe(true);
    const cancelled = (await inspectClassicSdkRun(f.root, 'demo')).run;
    expect(
      isClassicSdkCancellationComplete({
        ...cancelled,
        children: [
          { actionId: action.id, runId: 'unverified-child', workflow: cancelled.workflow },
        ],
      }),
    ).toBe(false);
  },
);

it('does not clear another current change when cancellation settles', async () => {
  const f = await fixture();
  expect((await f.cli('state', 'init', 'other', 'full', '--isolation', 'current')).exitCode).toBe(
    0,
  );
  expect((await f.cli('state', 'select', 'other')).exitCode).toBe(0);
  await f.dispatch({ operation: 'cancel', runId: 'demo', reason: 'Cancel only demo' });
  expect(await readCometCurrentSelection(f.root)).toMatchObject({
    status: 'selected',
    selection: { change: 'other' },
  });
});
