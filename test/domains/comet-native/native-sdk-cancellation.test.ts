import '../../helpers/isolated-agent-home.js';
import { nativeSdkApplicationForRun } from '../../../domains/comet-native/native-sdk-application.js';
import { createRuntime, createFileRuntimeStore } from '../../../domains/engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import {
  listActiveNativeHookChanges,
  inspectNativeHookGuard,
  parseNativeHookRequest,
} from '../../../domains/comet-native/native-hook-guard.js';
import { listActiveNativeChangesOwnedByWorkspace } from '../../../domains/comet-native/native-change.js';
import { createNativePortableChange } from '../../../domains/comet-native/native-portable-requirements.js';
import { createNativeSdkChange } from '../../../domains/comet-native/native-sdk-create.js';
import { isNativeSdkChangeCancellationComplete } from '../../../domains/comet-native/native-sdk-cancellation.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareNativeApplication } from '../../helpers/native-application.js';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import { settleNativeSdkCancellation } from '../../../domains/comet-native/native-sdk-cancellation-cleanup.js';
import * as selectionModule from '../../../domains/workflow-contract/current-selection.js';
import { readCometCurrentSelection } from '../../../domains/workflow-contract/current-selection.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
      '# Outcome\nKeep partial work.\n# Scope\nCancel safely.\n' +
        '## Directory structure\n### Modified\n- src/ — preserve partial implementation when cancelled.\n# Non-goals\nPublishing.\n' +
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
  it('cancels claimed Builder scheduling while retaining its original claim without process-stop receipts', async () => {
    const f = await fixture('builder');
    const before = await f.runtime.inspect(f.name),
      action = before.actions.at(-1)!;
    const claimed = await f.runtime.claim({
      runId: f.name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'original-host',
      claimToken: 'retained-host-claim',
    });
    const cancelled = await f.runtime.cancel({ runId: f.name, reason: 'Stop scheduling' });
    expect(await isNativeSdkChangeCancellationComplete(f.root, f.name)).toBe(true);
    const store = createFileRuntimeStore({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs', 'native'),
    });
    expect(await store.readDisposition(f.name)).toBe('closed');
    const original = cancelled.actions.find((a) => a.id === action.id)!;
    expect(original).toMatchObject({ status: 'cancelled', claim: claimed.actions.at(-1)!.claim });
    expect(original.executionStop).toBeUndefined();
    expect(original.cancellation?.evidence).toBeUndefined();
    const status = await f.cli(['status', f.name]);
    expect(status.data).toMatchObject({
      status: 'cancelled',
      cancellation: { quiescent: true, outstandingActions: [] },
    });
    expect(status.data.continuation.userCommunication.agentInstruction).toContain(
      'does not certify process termination',
    );
    for (const command of [
      'comet native doctor ' + f.name + ' --repair --json',
      'comet runtime dispatch --application native --request original-result.json',
    ])
      expect(
        await inspectNativeHookGuard(
          f.root,
          parseNativeHookRequest(JSON.stringify({ tool_name: 'Bash', tool_input: { command } })),
          f.name,
        ),
      ).toMatchObject({ allowed: true });
    expect(
      await inspectNativeHookGuard(f.root, { intent: 'write', targets: ['src/replacement.ts'] }),
    ).toMatchObject({ allowed: true });
    expect(
      await inspectNativeHookGuard(
        f.root,
        { intent: 'write', targets: ['src/replacement.ts'] },
        f.name,
      ),
    ).toMatchObject({ allowed: true });
    expect(await listActiveNativeHookChanges(f.root)).toEqual([]);
  });

  it('keeps failed selection cleanup visible until explicit repair and preserves the original cancelled Run', async () => {
    const f = await fixture('unstarted');
    const before = await f.runtime.inspect(f.name);
    const paths = await nativeProjectPaths(
      f.root,
      (before.input as { artifactRootRef: string }).artifactRootRef,
    );
    const release = vi
      .spyOn(selectionModule, 'clearCometCurrentSelectionIf')
      .mockRejectedValue(new Error('SIMULATED selection publication failure'));
    await expect(
      f.runtime.cancel({ runId: f.name, reason: 'Cancel with failed selection publication' }),
    ).rejects.toThrow(/current selection release remains pending/);
    const cancelled = await f.runtime.inspect(f.name);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.state).toEqual(before.state);
    await expect(
      settleNativeSdkCancellation({ projectRoot: f.root, run: cancelled }),
    ).rejects.toThrow(/current selection release remains pending/);
    const status = await f.cli(['status', f.name]);
    expect(status.data).toMatchObject({
      status: 'cancelling',
      cancellation: {
        quiescent: true,
        cleanupRequired: true,
      },
      continuation: {
        disposition: 'blocked',
        commandArgs: ['comet', 'native', 'doctor', '--json', '--project-root', f.root],
      },
    });
    expect(await isNativeSdkChangeCancellationComplete(f.root, f.name)).toBe(false);
    for (const command of [
      `comet native doctor ${f.name} --repair --json`,
      'comet runtime dispatch --application native --request original-result.json',
    ]) {
      const request = parseNativeHookRequest(
        JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      );
      expect(await inspectNativeHookGuard(f.root, request, f.name)).toMatchObject({
        allowed: true,
      });
    }

    expect(
      await inspectNativeHookGuard(f.root, { intent: 'write', targets: ['src/replacement.ts'] }),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining('cancelling') });
    expect(
      await inspectNativeHookGuard(
        f.root,
        { intent: 'write', targets: ['src/replacement.ts'] },
        f.name,
      ),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining('cancelling') });

    expect(await listActiveNativeHookChanges(f.root)).toEqual([
      expect.objectContaining({ name: f.name }),
    ]);
    const doctor = await f.cli(['doctor', f.name]);
    expect(doctor.data.healthy).toBe(false);
    expect(
      doctor.data.diagnostics.issues.some(
        (finding: { code: string }) => finding.code === 'sdk-cancellation-cleanup-pending',
      ),
      JSON.stringify(doctor.data),
    ).toBe(true);
    release.mockRestore();
    // A failed selection write is repaired explicitly; the cancelled Run remains original.
    expect(await listActiveNativeChangesOwnedByWorkspace(paths)).toEqual([f.name]);
    const creation = {
      paths,
      name: 'blocked-replacement',
      language: 'en' as const,
      workspaceBinding: { isolation: 'current' as const, changeBranch: null, targetBranch: null },
    };
    for (const create of [createNativeSdkChange, createNativePortableChange]) {
      await expect(create(creation)).rejects.toThrow(/active|workspace|isolation/i);
    }
    expect(await readCometCurrentSelection(f.root)).toMatchObject({
      status: 'selected',
      selection: { change: f.name },
    });
    expect((await f.cli(['doctor', f.name, '--repair'])).exitCode).toBe(0);
    expect((await f.cli(['status', f.name])).data.status).toBe('cancelled');
    expect((await f.cli(['new', 'after-root-release'])).exitCode).toBe(0);
    expect((await f.cli(['next', f.name])).exitCode).toBe(0);
    expect((await f.cli(['doctor', f.name, '--repair'])).data.healthy).toBe(true);
    expect((await f.cli(['doctor'])).data.healthy).toBe(true);
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
      if (result.response.status !== 'succeeded') throw Error('Expected successful cancellation');
      expect(result.response.data).toEqual(await f.runtime.inspect(f.name));
      expect(cli.data).toMatchObject({
        runId: result.response.data.runId,
        revision: result.response.data.revision,
        status: result.response.data.status,
        state: result.response.data.state,
      });
      for (const field of ['actions', 'history', 'outputs', 'commands'])
        expect(cli.data).not.toHaveProperty(field);
      expect(cli.data).toMatchObject({
        continuation: { mode: 'done' },
      });
      expect(cli.cancellation.status).toBe('cancelled');
      expect(cli.continuation.disposition).toBe('done');
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
    const status = await f.native(['status', f.name]);
    expect(status).toMatchObject({
      status: 'cancelled',
      application: { id: 'native-candidate-review' },
      cancellation: { quiescent: true },
      continuation: { disposition: 'done' },
    });
    expect((await f.native(['new', 'replacement'])).name).toBe('replacement');
    const cancelled = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(cancelled.status).toBe('cancelled');
    const original = cancelled.actions.find(({ id }) => id === action.id)!;
    expect(original.claim).toEqual(action.claim);
    expect(original.status).toBe('cancelled');
    expect(original.executionStop).toBeUndefined();
    expect(original.cancellation?.evidence).toBeUndefined();
    expect(await fs.readFile(path.join(f.projectRoot, 'candidate.txt'), 'utf8')).toBe(
      'unreviewed\n',
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
        diagnostics: { issues: [] },
        status: 'cancelled',
      });
      expect(await isNativeSdkChangeCancellationComplete(f.root, f.name)).toBe(true);
      expect(await listActiveNativeHookChanges(f.root)).toEqual([]);
      expect(
        await inspectNativeHookGuard(f.root, { intent: 'write', targets: ['src/replacement.ts'] }),
      ).toMatchObject({ allowed: true });
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
    'retains a cancelled Builder claim and partial work without a stop receipt (unknown=%s)',
    async (unknown) => {
      const f = await fixture('builder');
      const before = await f.runtime.inspect(f.name),
        builder = before.actions.find(
          (a) => a.stepId === 'build.builder' && a.status === 'pending',
        )!;
      expect(builder).toBeDefined();
      const claimed = await f.runtime.claim({
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
        status: 'cancelled',
        cancellation: { quiescent: true, outstandingActions: [] },
        continuation: { disposition: 'done', action: 'none', requiredInputs: [] },
      });
      expect(status.data.pendingActions).toBeUndefined();
      expect(status.data.continuation.commandAlternatives).toEqual([]);
      expect(status.data.continuation.requiresUserDecision).toBe(false);
      expect(status.data.continuation.runnerAction.kind).toBe('none');
      expect(status.data.continuation.userCommunication.agentInstruction).toContain(
        'does not certify process termination',
      );
      const doctor = await f.cli(['doctor', f.name, '--repair']);
      expect(doctor.data).toMatchObject({ healthy: true, diagnostics: { issues: [] } });
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
      const original = (await f.runtime.inspect(f.name)).actions.find((a) => a.id === builder.id)!;
      expect(original.claim).toEqual(claimed.actions.find((a) => a.id === builder.id)!.claim);
      expect(original.status).toBe('cancelled');
      expect(original.executionStop).toBeUndefined();
      expect(original.cancellation?.evidence).toBeUndefined();
      expect((await f.runtime.inspect(f.name)).revision).toBe(cancelled.revision);
    },
  );
});
