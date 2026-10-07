import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { prepareNativeApplication } from '../../helpers/native-application.js';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import { settleNativeSdkCancellation } from '../../../domains/comet-native/native-sdk-cancellation-cleanup.js';
import { readCometCurrentSelection } from '../../../domains/workflow-contract/current-selection.js';
import type { RuntimeStoppedAction } from '../../../domains/engine/runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(stage: 'unstarted' | 'approval' | 'builder' = 'unstarted') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-cancellation-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const name = 'cancel-original';
  const cli = async (args: string[]) => {
    const result = await runNativeCli([...args, '--project-root', root, '--json']);
    return JSON.parse(result.stdout!);
  };
  expect((await cli(['new', name])).exitCode).toBe(0);
  const change = path.join(root, 'docs/comet/changes', name);
  const runtime = createNativeSdkRuntime(root);
  if (stage !== 'unstarted') {
    await fs.writeFile(
      path.join(change, 'brief.md'),
      '# Outcome\nKeep partial work.\n# Scope\nCancel safely.\n# Non-goals\nPublishing.\n' +
        '# Acceptance examples\n- Existing work remains.\n# Constraints and invariants\nPreserve receipts.\n' +
        '# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n',
    );
    await fs.mkdir(path.join(change, 'specs/workflow'), { recursive: true });
    await fs.writeFile(
      path.join(change, 'specs/workflow/spec.md'),
      '# Workflow\nExisting work remains.\n',
    );
    const prepared = await cli(['next', name]);
    expect(prepared.exitCode, prepared.error?.message).toBe(0);
    if (stage === 'builder') {
      const { state } = await inspectNativeSdkRun(root, name);
      const confirmed = await cli([
        'next',
        name,
        '--confirmed',
        '--summary',
        'Confirmed complete Shape',
        '--expected-state-version',
        String(state.state_version),
        '--expected-action',
        'confirm-shape',
      ]);
      expect(confirmed.exitCode, confirmed.error?.message).toBe(0);
    }
  }
  return { root, name, cli, runtime, change };
}

describe('Native cancellation lifecycle', () => {
  it('reports pending selection cleanup and the retained root lock age gate instead of declaring cancellation complete', async () => {
    const f = await fixture('unstarted');
    const before = await f.runtime.inspect(f.name);
    const paths = await nativeProjectPaths(
      f.root,
      (before.input as { artifactRootRef: string }).artifactRootRef,
    );
    await fs.mkdir(paths.locksDir, { recursive: true });
    const lock = path.join(paths.locksDir, 'root-move.lock');
    const owner = {
      id: 'controlled-foreign-root',
      pid: 2147483647,
      hostname: 'controlled-foreign-host',
      createdAt: new Date().toISOString(),
      operation: 'Controlled root move interruption',
    };
    await fs.writeFile(lock, JSON.stringify(owner));
    await expect(
      f.runtime.cancel({ runId: f.name, reason: 'Cancel while root cleanup is blocked' }),
    ).rejects.toThrow(/current selection release remains pending/);
    const status = await f.cli(['status', f.name]);
    expect(status.data).toMatchObject({
      status: 'cancelling',
      cancellation: {
        quiescent: true,
        cleanupRequired: true,
        cleanup: { rootMoveLock: { status: 'unknown', owner, minimumUnknownOwnerAgeMs: 900000 } },
      },
      continuation: {
        disposition: 'blocked',
        commandArgs: ['comet', 'native', 'doctor', '--json', '--project-root', f.root],
      },
    });
    expect(status.data.cancellation.cleanup.rootMoveLock.remainingMs).toBeGreaterThan(850000);
    const doctor = await f.cli(['doctor', f.name]);
    expect(doctor.data.healthy).toBe(false);
    expect(
      doctor.data.findings.some(
        (finding: { code: string }) => finding.code === 'sdk-cancellation-cleanup-pending',
      ),
    ).toBe(true);
    expect(JSON.parse(await fs.readFile(lock, 'utf8'))).toEqual(owner);
    // 受控假持有者自行释放它创建的锁；不是让 Runtime 绕过未知 owner 的保护。
    await fs.unlink(lock);
    expect((await f.cli(['doctor', f.name, '--repair'])).exitCode).toBe(0);
    expect((await f.cli(['status', f.name])).data.status).toBe('cancelled');
    expect((await f.cli(['new', 'after-root-release'])).exitCode).toBe(0);
    await fs.writeFile(lock, JSON.stringify(owner));
    expect((await f.cli(['next', f.name])).exitCode).toBe(0);
    expect((await f.cli(['doctor', f.name, '--repair'])).data.healthy).toBe(true);
    expect(JSON.parse(await fs.readFile(lock, 'utf8'))).toEqual(owner);
    expect(await readCometCurrentSelection(f.root)).toMatchObject({
      status: 'selected',
      selection: { change: 'after-root-release' },
    });
  });

  it.each(['unstarted', 'builder'] as const)(
    'returns actionable cancellation closure directly in the %s CLI response without changing the SDK Run shape',
    async (stage) => {
      const f = await fixture(stage);
      if (stage === 'builder') {
        const run = await f.runtime.inspect(f.name);
        const action = run.actions.find((entry) => entry.stepId === 'build.builder')!;
        await f.runtime.claim({
          runId: f.name,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'original-host',
          claimToken: 'cancellation-response',
        });
      }
      const requestFile = path.join(f.root, 'cancel-request.json');
      await fs.writeFile(
        requestFile,
        JSON.stringify({ operation: 'cancel', runId: f.name, reason: 'Stop this task' }),
      );
      const result = await runtimeDispatchCommand(
        { request: requestFile, application: 'native', projectRoot: f.root },
        { output: 'compact' },
      );
      expect(result.response.status).toBe('succeeded');
      const cli = result.cliResponse as {
        data: unknown;
        cancellation: { status: string };
        continuation: { disposition: string };
      };
      expect(cli.data).toMatchObject(
        result.response.status === 'succeeded' ? result.response.data : null,
      );
      expect(cli.data).toMatchObject({
        continuation: { mode: stage === 'unstarted' ? 'done' : 'reconcile' },
      });
      expect(cli.cancellation.status).toBe(stage === 'unstarted' ? 'cancelled' : 'cancelling');
      expect(cli.continuation.disposition).toBe(stage === 'unstarted' ? 'done' : 'blocked');
    },
  );

  it('releases a cancelled fixed custom Native application from its own store', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-custom-cancellation-'));
    roots.push(root);
    const f = await prepareNativeApplication(root);
    const builder = f.pending(f.run, 'build.builder');
    const claimed = await f.claim(builder, 'custom-builder');
    const action = claimed.actions.find(({ id }) => id === builder.id)!;
    await f.dispatch({ operation: 'cancel', runId: f.name, reason: 'Stop this custom task' });
    const cancelling = await f.native(['status', f.name]);
    expect(cancelling).toMatchObject({
      status: 'cancelling',
      application: { id: 'native-candidate-review' },
    });
    await f.dispatch({
      operation: 'cancel',
      runId: f.name,
      reason: 'Original host stopped',
      stoppedActions: [
        {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: action.claim!.token,
          evidence: 'Original custom Builder and all its children stopped; candidate.txt retained.',
        },
      ],
    });
    const status = await f.native(['status', f.name]);
    expect(status).toMatchObject({
      status: 'cancelled',
      cancellation: { quiescent: true },
      continuation: { disposition: 'done' },
    });
    expect((await f.native(['new', 'replacement'])).name).toBe('replacement');
    const cancelled = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.actions.find(({ id }) => id === action.id)?.cancellation?.evidence).toContain(
      'retained',
    );
  });
  it.each(['unstarted', 'approval', 'builder'] as const)(
    'ends %s work and releases the workspace without Archive',
    async (stage) => {
      const f = await fixture(stage);
      const before = await f.runtime.inspect(f.name);
      const originalBrief = await fs.readFile(path.join(f.change, 'brief.md'), 'utf8');
      const requestFile = path.join(f.root, 'cancel-request.json');
      await fs.writeFile(
        requestFile,
        JSON.stringify({
          operation: 'cancel',
          runId: f.name,
          expectedRevision: before.revision,
          reason: 'User no longer needs this task',
        }),
      );
      const response = await runtimeDispatchCommand({
        request: requestFile,
        application: 'native',
        projectRoot: f.root,
      });
      expect(response.response.status, JSON.stringify(response.response)).toBe('succeeded');
      const cancelled = await f.runtime.inspect(f.name);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.state).toEqual(before.state);
      expect(cancelled.actions.filter(({ status }) => status === 'succeeded')).toEqual(
        before.actions.filter(({ status }) => status === 'succeeded'),
      );
      const status = await f.cli(['status', f.name]);
      expect(status.exitCode, status.error?.message).toBe(0);
      expect(status.data).toMatchObject({
        status: 'cancelled',
        cancellation: { quiescent: true },
        continuation: {
          disposition: 'done',
          status: 'cancelled',
          action: 'none',
          requiredInputs: [],
          commandArgs: null,
        },
      });
      expect(status.data.pendingActions).toBeUndefined();
      expect(status.data.continuation.commandAlternatives).toEqual([]);
      expect(status.data.continuation.requiresUserDecision).toBe(false);
      expect(status.data.continuation.runnerAction.kind).toBe('none');
      const next = await f.cli(['next', f.name, '--summary', 'No further work']);
      expect(next.exitCode).toBe(0);
      expect(next.data.continuation).toEqual(status.data.continuation);
      expect((await f.cli(['doctor', f.name, '--repair'])).data).toMatchObject({
        healthy: true,
        findings: [],
        status: 'cancelled',
      });
      expect(await readCometCurrentSelection(f.root)).toEqual({ status: 'missing' });
      expect(await f.runtime.cancel({ runId: f.name, reason: 'Cancel again' })).toEqual(cancelled);
      expect(await fs.readFile(path.join(f.change, 'brief.md'), 'utf8')).toBe(originalBrief);
      const replacement = await f.cli(['new', 'replacement']);
      expect(replacement.exitCode, replacement.error?.message).toBe(0);
      await settleNativeSdkCancellation({ projectRoot: f.root, run: cancelled });
      expect(await readCometCurrentSelection(f.root)).toMatchObject({
        status: 'selected',
        selection: { change: 'replacement' },
      });
      expect((await f.runtime.inspect(f.name)).revision).toBe(cancelled.revision);
    },
  );

  it.each([false, true])(
    'retains a claimed Builder until its original host proves it stopped (unknown=%s)',
    async (unknown) => {
      const f = await fixture('builder');
      const before = await f.runtime.inspect(f.name);
      const builder = before.actions.find(
        ({ stepId, status }) => stepId === 'build.builder' && status === 'pending',
      )!;
      expect(builder).toBeDefined();
      await f.runtime.claim({
        runId: f.name,
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        executorId: 'native-host',
        sessionId: 'original-builder',
        claimToken: 'original-claim',
      });
      if (unknown)
        await f.runtime.markUnknown({
          runId: f.name,
          actionId: builder.id,
          attempt: builder.attempt,
          reason: 'Original host temporarily disconnected',
        });
      await fs.writeFile(
        path.join(f.root, 'partial-work.txt'),
        'Preserve my unfinished implementation\n',
      );
      const cancelled = await f.runtime.cancel({
        runId: f.name,
        reason: 'User stopped the original work',
      });
      const status = await f.cli(['status', f.name]);
      expect(status.data).toMatchObject({
        status: 'cancelling',
        continuation: {
          disposition: 'blocked',
          action: 'none',
          requiredInputs: ['original-execution-stop-evidence'],
        },
      });
      expect(status.data.pendingActions).toBeUndefined();
      expect(status.data.continuation.commandAlternatives).toEqual([]);
      expect(status.data.continuation.requiresUserDecision).toBe(false);
      expect(status.data.continuation.runnerAction.kind).toBe('none');
      expect((await f.cli(['new', 'blocked-replacement'])).exitCode).toBe(73);
      expect((await f.cli(['doctor', f.name, '--repair'])).data).toMatchObject({
        healthy: false,
        findings: [{ code: 'sdk-cancellation-execution-unresolved' }],
      });
      const request = status.data.cancellation.outstandingActions[0].acknowledgementRequest;
      expect(request).toMatchObject({
        operation: 'cancel',
        runId: f.name,
        expectedRevision: cancelled.revision,
        stoppedActions: [
          {
            actionId: builder.id,
            attempt: builder.attempt,
            inputHash: builder.inputHash,
            claimToken: 'original-claim',
          },
        ],
      });
      const evidence =
        'Original Builder and all its child tasks are stopped; partial-work.txt is retained.';
      const stopped: RuntimeStoppedAction = { ...request.stoppedActions[0], evidence };
      const requestFile = path.join(f.root, 'stopped-request.json');
      await fs.writeFile(requestFile, JSON.stringify({ ...request, stoppedActions: [stopped] }));
      const response = await runtimeDispatchCommand({
        request: requestFile,
        application: 'native',
        projectRoot: f.root,
      });
      expect(response.response.status, JSON.stringify(response.response)).toBe('succeeded');
      expect((await f.cli(['status', f.name])).data).toMatchObject({
        status: 'cancelled',
        cancellation: { quiescent: true },
      });
      expect((await f.cli(['new', 'replacement'])).exitCode).toBe(0);
      await expect(
        f.runtime.recordOutcome({
          runId: f.name,
          outcome: {
            actionId: builder.id,
            attempt: builder.attempt,
            inputHash: builder.inputHash,
            claimToken: 'original-claim',
            outcomeId: 'late-result',
            status: 'failed',
            output: { summary: 'Late result' },
          },
        }),
      ).rejects.toThrow(/RUN_CANCELLED/);
      expect(await fs.readFile(path.join(f.root, 'partial-work.txt'), 'utf8')).toBe(
        'Preserve my unfinished implementation\n',
      );
      expect(
        (await f.runtime.inspect(f.name)).actions.find(({ id }) => id === builder.id)?.cancellation
          ?.evidence,
      ).toBe(evidence);
    },
  );
});
