import { doctorCommand } from '../../../app/commands/doctor.js';
import { inspectClassicSdkRunDiagnostics } from '../../../domains/comet-classic/classic-sdk-diagnostics.js';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { isClassicSdkCancellationComplete } from '../../../domains/comet-classic/classic-sdk-run-lifecycle.js';
import { resolveCometResumeProbe } from '../../../domains/comet-classic/classic-resume-probe.js';
import { resolveCometEntryResumeProbe } from '../../../domains/comet-entry/resume-probe.js';
import { listActiveClassicHookChanges } from '../../../domains/comet-classic/classic-hook-guard.js';
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
    targets: [path.join(root, 'src/example.js')],
  };
  return { root, cli, dispatch, request };
}

function commitFixture(root: string): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('config', 'user.name', 'Comet cancellation test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '.');
  git('commit', '-m', 'fixture');
}

const resumeInput = {
  schema_version: 'comet.resume_probe.v1',
  utterance: 'continue',
  locale: 'en',
  agent_context: { non_trivial_work: true, already_in_comet_flow: false },
};

async function assertCancelledDoctorHealthy(root: string) {
  const before = (await inspectClassicSdkRun(root, 'demo')).run;
  const statePath = path.join(root, 'openspec/changes/demo/comet-state.yaml');
  const stateBytes = await fs.readFile(statePath);
  const logs: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((value) => {
    logs.push(String(value));
  });
  try {
    await doctorCommand(root, { json: true, scope: 'project' });
  } finally {
    log.mockRestore();
  }
  const report = JSON.parse(logs.find((value) => value.trim().startsWith('{'))!);
  const sdk = report.results.find((row: any) => row.check === 'comet-state.yaml: demo');
  expect(sdk, JSON.stringify(report)).toMatchObject({ status: 'pass' });
  expect(sdk.message).not.toMatch(/stoppedActions|stop evidence|execution-unresolved/u);
  expect(await inspectClassicSdkRunDiagnostics(root, before)).toMatchObject({
    healthy: true,
    executionReconciled: true,
    issues: [],
  });
  expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(before);
  expect(await fs.readFile(statePath)).toEqual(stateBytes);
}

it('excludes a fully cancelled Run from Classic and shared resume entry points', async () => {
  const f = await fixture();
  await f.dispatch({ operation: 'cancel', runId: 'demo', reason: 'User cancelled this change' });
  commitFixture(f.root);
  expect(await resolveCometResumeProbe(f.root, resumeInput)).toMatchObject({
    action: 'none',
    changeName: null,
    nextCommand: null,
  });
  expect(
    await resolveCometEntryResumeProbe(f.root, {
      ...resumeInput,
      schema_version: 'comet.resume_probe.v2',
    }),
  ).toMatchObject({
    action: 'none',
    changeName: null,
    nextCommand: null,
  });
  const copiedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-cancelled-copy-'));
  roots.push(copiedRoot);
  await fs.cp(f.root, copiedRoot, { recursive: true });
  expect(await resolveCometResumeProbe(copiedRoot, resumeInput)).toMatchObject({
    action: 'none',
    changeName: null,
    nextCommand: null,
  });
});

it('resumes the remaining active Run without a cancelled Run creating an ambiguous choice', async () => {
  const f = await fixture();
  await f.dispatch({ operation: 'cancel', runId: 'demo', reason: 'User cancelled this change' });
  expect((await f.cli('state', 'init', 'other', 'full', '--isolation', 'current')).exitCode).toBe(
    0,
  );
  commitFixture(f.root);
  const candidate = await resolveCometEntryResumeProbe(f.root, {
    ...resumeInput,
    schema_version: 'comet.resume_probe.v2',
  });
  expect(candidate).toMatchObject({
    action: 'ask_user',
    changeName: 'other',
    reasonCode: 'ambient-resume-confirmation-required',
    nextCommand: null,
  });
  expect(candidate.candidates.map(({ name }) => name)).toEqual(['other']);
  expect(
    await resolveCometEntryResumeProbe(f.root, {
      ...resumeInput,
      schema_version: 'comet.resume_probe.v2',
      utterance: '继续 other',
    }),
  ).toMatchObject({
    action: 'auto_resume',
    changeName: 'other',
    nextCommand: '/comet-classic',
  });
});

it('releases a cancelled claimed platform Skill without execution stop evidence and keeps its original history', async () => {
  const f = await fixture();
  const { run, runtime } = await inspectClassicSdkRun(f.root, 'demo');
  const action = run.actions[0];
  const claimed = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'SIMULATED original platform',
    claimToken: 'SIMULATED original claim',
  });
  await f.dispatch({
    operation: 'cancel',
    runId: run.runId,
    reason: 'SIMULATED USER cancels platform task',
  });
  const cancelled = (await inspectClassicSdkRun(f.root, 'demo')).run;
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.actions).toHaveLength(claimed.actions.length);
  const original = cancelled.actions.find((candidate) => candidate.id === action.id)!;
  expect(original).toMatchObject({
    status: 'cancelled',
    claim: claimed.actions.find((candidate) => candidate.id === action.id)!.claim,
  });
  expect(original.cancellation).toBeUndefined();
  expect(original.executionStop).toBeUndefined();
  expect(original.outcome).toBeUndefined();
  expect(isClassicSdkCancellationComplete(cancelled)).toBe(true);
  await assertCancelledDoctorHealthy(f.root);
  expect(await listActiveClassicHookChanges(f.root)).toEqual([]);
  expect((await inspectCometHook(f.root, f.request)).allowed).toBe(true);
  commitFixture(f.root);
  for (const [read, schema_version] of [
    [resolveCometResumeProbe, 'comet.resume_probe.v1'],
    [resolveCometEntryResumeProbe, 'comet.resume_probe.v2'],
  ] as const) {
    expect(await read(f.root, { ...resumeInput, schema_version })).toMatchObject({
      action: 'none',
      changeName: null,
      nextCommand: null,
    });
  }
});

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
  'releases a cancelled %s Build platform claim and preserves its approval, tasks, and unknown child protection',
  async (status) => {
    const f = await fixture('tweak');
    for (const file of ['proposal.md', 'design.md', 'tasks.md'])
      await fs.writeFile(
        path.join(f.root, 'openspec/changes/demo', file),
        file === 'tasks.md'
          ? '- [ ] SIMULATED Agent implements change\n'
          : '# SIMULATED ' + file + '\n',
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
    expect(run.state).toMatchObject({ phase: 'build' });
    expect(
      run.actions.some((action) => action.stepId === 'tweak.open' && action.status === 'succeeded'),
    ).toBe(true);
    await runtime.claim({
      runId: 'demo',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'SIMULATED original platform',
      claimToken: 'SIMULATED original claim',
    });
    if (status === 'unknown')
      await runtime.markUnknown({
        runId: 'demo',
        actionId: action.id,
        attempt: action.attempt,
        reason: 'SIMULATED platform disconnected',
      });
    const before = (await inspectClassicSdkRun(f.root, 'demo')).run;
    const taskBytes = await fs.readFile(path.join(f.root, 'openspec/changes/demo/tasks.md'));
    await f.dispatch({
      operation: 'cancel',
      runId: 'demo',
      reason: 'SIMULATED USER cancels platform task',
    });
    expect((await readCometCurrentSelection(f.root)).status).toBe('missing');
    expect(await listActiveClassicHookChanges(f.root)).toEqual([]);
    expect((await inspectCometHook(f.root, f.request)).allowed).toBe(true);
    expect((await f.cli('state', 'next', 'demo')).agent.continuation.mode).toBe('done');
    await f.cli('state', 'clear-selection');
    expect((await inspectCometHook(f.root, f.request)).allowed).toBe(true);
    const cancelled = (await inspectClassicSdkRun(f.root, 'demo')).run;
    await assertCancelledDoctorHealthy(f.root);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.workflow).toEqual(before.workflow);
    expect(cancelled.state).toEqual(before.state);
    expect(cancelled.actions.map((action) => action.id)).toEqual(
      before.actions.map((action) => action.id),
    );
    expect(cancelled.waits).toEqual(before.waits);
    expect(cancelled.outputs).toEqual(before.outputs);
    const original = cancelled.actions.find((candidate) => candidate.id === action.id)!;
    expect(original).toMatchObject({
      status: 'cancelled',
      claim: before.actions.find((candidate) => candidate.id === action.id)!.claim,
    });
    expect(original.cancellation).toBeUndefined();
    expect(original.executionStop).toBeUndefined();
    expect(original.outcome).toBeUndefined();
    expect(await fs.readFile(path.join(f.root, 'openspec/changes/demo/tasks.md'))).toEqual(
      taskBytes,
    );
    const withUnknownChild = {
      ...cancelled,
      children: [{ actionId: action.id, runId: 'unverified-child', workflow: cancelled.workflow }],
    };
    expect(isClassicSdkCancellationComplete(withUnknownChild)).toBe(false);
    expect(await inspectClassicSdkRunDiagnostics(f.root, withUnknownChild)).toMatchObject({
      healthy: false,
      issues: [{ code: 'classic-cancellation-business-unresolved' }],
    });
    // Cancelled original claim cannot submit a delayed success or start another dispatch.
    await expect(
      runtime.recordOutcome({
        runId: 'demo',
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'SIMULATED original claim',
          outcomeId: 'SIMULATED late success',
          status: 'succeeded',
          output: {},
        },
      }),
    ).rejects.toThrow();
    expect((await inspectClassicSdkRun(f.root, 'demo')).run).toEqual(cancelled);
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
