import '../../helpers/isolated-agent-home.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareNativeApplication } from '../../helpers/native-application.js';
import { loadOwnedNativeSdkRuntime } from '../../../domains/comet-native/native-runtime-ownership.js';
import { parseNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { projectNativeSdkContinuation } from '../../../domains/comet-native/native-sdk-continuation.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { createPortableRunCheckpoint, type WorkflowRun } from '../../../domains/engine/runtime.js';
import { readWorkflowApplicationRun } from '../../../domains/workflow-application/index.js';

type Fixture = Awaited<ReturnType<typeof prepareNativeApplication>>;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(kind: 'custom' | 'native' = 'custom') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-child-verifier-recovery-'));
  roots.push(root);
  const f = await prepareNativeApplication(root, true, kind);
  f.git(f.projectRoot, ['config', 'user.name', 'Comet Test']);
  f.git(f.projectRoot, ['config', 'user.email', 'comet-test@example.com']);
  let run = f.run;
  const sibling = run.actions.filter((action) => action.stepId === 'supervisor.child.builder')[1];
  run = await f.submitBuilder(
    f.pending(run, 'supervisor.child.builder'),
    'approved\n',
    'left-builder',
  );
  if (kind === 'custom')
    run = await f.dispatch({
      operation: 'execute',
      runId: f.name,
      actionId: f.pending(run, 'native.extension.child.candidate-review').id,
      executorId: 'native-review-script',
    });
  const verifier = f.pending(run, 'supervisor.child.verifier');
  run = await f.claim(verifier, 'left-verifier');
  return {
    ...f,
    run,
    verifier: run.actions.find((action) => action.id === verifier.id)!,
    sibling,
  };
}
async function failVerifier(f: Awaited<ReturnType<typeof fixture>>) {
  return f.record(
    f.verifier,
    {
      summary: 'The original host executed and failed after starting the review',
    },
    'failed',
  );
}
async function decide(
  f: Fixture,
  run: WorkflowRun,
  action: 'retry-verifier' | 'revise-implementation',
  proposalHash?: string,
) {
  const wait = run.waits.findLast((wait) => wait.stepId === 'supervisor.child.verifier-retry')!;
  return f.native([
    'next',
    f.name,
    `--${action}`,
    '--summary',
    'The original failed host has stopped; use a new session',
    '--proposal-hash',
    proposalHash ?? wait.proposalHash,
    '--expected-state-version',
    String((run.state as { state_version: number }).state_version),
    '--expected-action',
    action,
  ]);
}

describe('Supervisor Child Verifier execution failure', () => {
  // 包含真实 Git worktree 与固定应用的完整恢复链路，沿用 Supervisor 集成测试预算。
  it('preserves a real custom application failure and receipts, advances its sibling, and retries only its review', async () => {
    const f = await fixture();
    const identity = (await loadOwnedNativeSdkRuntime(f.projectRoot, f.name)).application!.identity;
    let run = await failVerifier(f);
    expect(run.status).toBe('running');
    const original = run.actions.find((action) => action.id === f.verifier.id)!;
    expect(original).toMatchObject({
      status: 'failed',
      attempt: 1,
      claim: f.verifier.claim,
      outcome: { status: 'failed' },
      reconciliations: [],
    });
    expect(run.actions.find((action) => action.id === f.sibling.id)).toEqual(f.sibling);
    expect(run.waits.at(-1)).toMatchObject({
      stepId: 'supervisor.child.verifier-retry',
      status: 'pending',
      choices: ['retry', 'repair'],
    });
    const status = await f.native(['status', f.name]);
    expect(status).toMatchObject({
      continuation: { disposition: 'await-user', action: 'retry-verifier' },
    });
    expect(
      (status as { continuation: { commandAlternatives: unknown[] } }).continuation
        .commandAlternatives,
    ).toHaveLength(2);
    await expect(decide(f, run, 'retry-verifier', '0'.repeat(64))).rejects.toThrow('stale');
    await expect(
      f.dispatch({
        operation: 'retry',
        runId: f.name,
        actionId: original.id,
        attempt: original.attempt,
      }),
    ).rejects.toThrow('ACTION_ALREADY_ADVANCED');
    run = await f.submitBuilder(f.sibling, 'approved sibling\n', 'right-builder');
    const completedSibling = run.actions.find((action) => action.id === f.sibling.id)!;
    await decide(f, run, 'retry-verifier');
    const resumed = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name);
    expect(resumed.application!.identity).toEqual(identity);
    run = await resumed.runtime.inspect(f.name);
    const retry = f.pending(run, 'supervisor.child.verifier');
    expect(retry.id).not.toBe(original.id);
    expect(retry).toMatchObject({
      attempt: 1,
      input: {
        activation: {
          ...(original.input as { activation: Record<string, string> }).activation,
          failedVerifierActionId: original.id,
        },
      },
    });
    expect(run.actions.find((action) => action.id === original.id)).toEqual(original);
    expect(run.actions.find((action) => action.id === f.sibling.id)).toEqual(completedSibling);
    expect(
      run.actions.filter(
        (action) =>
          ['supervisor.child.checks', 'native.extension.child.candidate-review'].includes(
            action.stepId,
          ) && action.status === 'succeeded',
      ),
    ).toHaveLength(1);
    run = await f.claim(retry, 'replacement-verifier');
    const claimed = run.actions.find((action) => action.id === retry.id)!;
    run = await f.record(claimed, {
      verdict: 'pass',
      candidateCommit: (retry.input as { activation: { candidateCommit: string } }).activation
        .candidateCommit,
      evidence: {
        summary: 'Independent replacement reviewed the retained candidate',
        checks: [
          {
            name: 'candidate-process',
            result: 'passed',
            note: 'Actual current candidate review Skill already checked this retained candidate.',
          },
        ],
        acceptance: [
          {
            id: 'A1',
            result: 'passed',
            reason: 'Reviewed original candidate independently',
          },
        ],
      },
    });
    expect(f.pending(run, 'supervisor.child.integrate')).toBeTruthy();
    expect(run.actions.find((action) => action.id === original.id)).toEqual(original);
  }, 240_000);

  it('uses the same recovery Wait for the built-in Native Supervisor', async () => {
    const f = await fixture('native');
    const run = await failVerifier(f);
    expect(run.status).toBe('running');
    const original = run.actions.find((action) => action.id === f.verifier.id)!;
    expect(run.waits.at(-1)).toMatchObject({
      stepId: 'supervisor.child.verifier-retry',
      status: 'pending',
    });
    await decide(f, run, 'retry-verifier');
    const next = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(next.actions.find((action) => action.id === f.sibling.id)).toEqual(f.sibling);
    expect(next.actions.find((action) => action.id === original.id)).toEqual(original);
    expect(f.pending(next, 'supervisor.child.verifier').id).not.toBe(original.id);
  });

  it('offers a new Builder repair without changing the original execution failure', async () => {
    const f = await fixture();
    const run = await failVerifier(f);
    const original = run.actions.find((action) => action.id === f.verifier.id)!;
    await decide(f, run, 'revise-implementation');
    const next = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(next.actions.find((action) => action.id === original.id)).toEqual(original);
    expect(next.actions.at(-1)).toMatchObject({
      stepId: 'supervisor.child.builder',
      status: 'pending',
      input: {
        activation: { child: 'left', failedVerifierActionId: original.id },
      },
    });
    expect(next.actions.find((action) => action.id === f.sibling.id)).toEqual(f.sibling);
  });

  it('keeps an unknown verifier bound to its original task and creates no retry Wait', async () => {
    const f = await fixture();
    const loaded = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name),
      runtime = loaded.runtime;
    const run = await runtime.markUnknown({
      runId: f.name,
      actionId: f.verifier.id,
      attempt: f.verifier.attempt,
      reason: 'Original business task result unavailable; no stop assertion.',
    });
    expect(run.waits.some((w) => w.stepId === 'supervisor.child.verifier-retry')).toBe(false);
    expect(await f.native(['status', f.name])).toMatchObject({
      continuation: {
        disposition: 'blocked',
        requiredInputs: ['original-execution-result'],
        commandArgs: null,
      },
    });
    await nativeDoctorCommand([f.name, '--repair'], f.projectRoot);
    const recovered = await runtime.inspect(f.name);
    expect(recovered.actions).toEqual(run.actions);
    expect(recovered.waits).toEqual(run.waits);
    expect(recovered.outputs).toEqual(run.outputs);
    await nativeDoctorCommand([f.name, '--repair'], f.projectRoot);
    expect(await runtime.inspect(f.name)).toEqual(recovered);
    await expect(
      f.dispatch({
        operation: 'retry',
        runId: f.name,
        actionId: f.verifier.id,
        attempt: f.verifier.attempt,
      }),
    ).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(await runtime.inspect(f.name)).toEqual(recovered);
    const settled = await f.record(
      recovered.actions.find((a) => a.id === f.verifier.id)!,
      {
        summary: 'SIMULATED original Agent recovered its actual failed business execution result.',
      },
      'failed',
    );
    expect(settled.actions.filter((a) => a.stepId === 'supervisor.child.verifier')).toHaveLength(1);
    expect(settled.actions.find((a) => a.id === f.verifier.id)).toMatchObject({
      status: 'failed',
      claim: f.verifier.claim,
      attempt: f.verifier.attempt,
      inputHash: f.verifier.inputHash,
    });
    expect(settled.actions.find((a) => a.id === f.sibling.id)).toEqual(f.sibling);
    expect(
      settled.waits.filter((w) => w.stepId === 'supervisor.child.verifier-retry'),
    ).toHaveLength(1);
  });
  it('never advertises a pending claim for a failed or completed Run', async () => {
    const f = await fixture();
    const failed = await failVerifier(f);
    for (const status of ['failed', 'completed'] as const) {
      const run = {
        ...failed,
        status,
        reason: 'ACTION_FAILED: supervisor.child.verifier',
      };
      const projected = await projectNativeSdkContinuation({
        run,
        state: parseNativePortableState(run.state),
        projectRoot: f.projectRoot,
      });
      expect(projected.continuation).toMatchObject({
        disposition: 'blocked',
        action: 'none',
      });
      expect(projected).not.toHaveProperty('pendingAction');
      expect(projected).not.toHaveProperty('pendingActions');
    }
  });
});

async function currentFixedFixture(
  mode: 'pending' | 'running-builder' | 'two-verifiers' | 'transfer-builder' = 'pending',
) {
  if (mode === 'transfer-builder') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'current-fixed-transfer-'));
    roots.push(root);
    const f = await prepareNativeApplication(root, true, 'custom');
    const builder = f.pending(f.run, 'supervisor.child.builder');
    await fs.writeFile(
      path.join(
        (builder.input as { activation: { worktree: string } }).activation.worktree,
        'draft.txt',
      ),
      'retained original draft',
    );
    return {
      ...f,
      sibling: f.run.actions.filter((a) => a.stepId === 'supervisor.child.builder')[1],
    };
  }
  const f = await fixture();
  let run = f.run;
  if (mode === 'running-builder') run = await f.claim(f.sibling, 'original-sibling');
  if (mode === 'two-verifiers') {
    run = await f.submitBuilder(f.sibling, 'approved sibling\n', 'right-builder');
    run = await f.dispatch({
      operation: 'execute',
      runId: f.name,
      actionId: f.pending(run, 'native.extension.child.candidate-review').id,
      executorId: 'native-review-script',
    });
    const right = f.pending(run, 'supervisor.child.verifier');
    run = await f.claim(right, 'original-right-verifier');
    run = await f.record(
      run.actions.find((a) => a.id === right.id)!,
      { summary: 'SIMULATED original right Agent failed.' },
      'failed',
    );
  }
  run = await f.record(
    run.actions.find((a) => a.id === f.verifier.id)!,
    { summary: 'SIMULATED original left Agent failed.' },
    'failed',
  );
  return { ...f, run };
}
describe('current fixed custom Supervisor business recovery', () => {
  it('transfers a fixed custom definition without changing its hash or losing dirty Child work', async () => {
    const f = await currentFixedFixture('transfer-builder'),
      original = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name),
      identity = original.application!.identity,
      transfer = path.join(f.root, 'transfer');
    const exported = await runNativeCli([
      'transfer',
      'export',
      f.name,
      '--output',
      transfer,
      '--confirmed-stopped',
      '--project-root',
      f.projectRoot,
      '--json',
    ]);
    expect(exported.exitCode, exported.stdout).toBe(0);
    const target = path.join(f.root, 'target');
    execFileSync('git', ['clone', '--no-local', f.projectRoot, target], {
      stdio: 'pipe',
    });
    await writeProjectConfig(target, defaultProjectConfig('docs', 'en'));
    const imported = await runNativeCli([
      'transfer',
      'import',
      '--input',
      transfer,
      '--project-root',
      target,
      '--json',
    ]);
    expect(imported.exitCode, imported.stdout).toBe(0);
    const relocated = await loadOwnedNativeSdkRuntime(target, f.name),
      run = await relocated.runtime.inspect(f.name);
    expect(run.workflow).toEqual(f.run.workflow);
    expect(run.definitionHashes).toEqual(f.run.definitionHashes);
    expect(relocated.application!.identity).toEqual({
      ...identity,
      projectRoot: await fs.realpath(target),
    });
    expect(run.actions.map(({ id, stepId, status }) => ({ id, stepId, status }))).toEqual(
      f.run.actions.map(({ id, stepId, status }) => ({ id, stepId, status })),
    );
    const builder = run.actions.find(
      (a) => a.stepId === 'supervisor.child.builder' && a.status === 'pending',
    )!;
    expect(
      await fs.readFile(
        path.join(
          (builder.input as { activation: { worktree: string } }).activation.worktree,
          'draft.txt',
        ),
        'utf8',
      ),
    ).toBe('retained original draft');
  });
  it('reloads the current fixed failed review without changing identity, sibling work or its original decision', async () => {
    const f = await currentFixedFixture(),
      before = await readWorkflowApplicationRun(f.projectRoot, 'native-candidate-review', f.name),
      loaded = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name, {
        readOnly: true,
      }),
      identity = loaded.application!.identity;
    expect(await loaded.runtime.inspect(f.name)).toEqual(before);
    await nativeDoctorCommand([f.name], f.projectRoot);
    expect(
      await readWorkflowApplicationRun(f.projectRoot, 'native-candidate-review', f.name),
    ).toEqual(before);
    const current = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name),
      run = await current.runtime.inspect(f.name);
    expect(current.application!.identity).toEqual(identity);
    expect(run.actions).toEqual(f.run.actions);
    expect(run.waits).toEqual(f.run.waits);
    const wait = run.waits.find(
      (w) => w.stepId === 'supervisor.child.verifier-retry' && w.status === 'pending',
    )!;
    const retried = await current.runtime.resolveWait({
      runId: f.name,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'SIMULATED-USER-current-original-retry',
      choice: 'retry',
    });
    expect(retried.actions.find((a) => a.id === f.sibling.id)).toEqual(f.sibling);
    expect(retried.actions.slice(0, -1)).toEqual(run.actions);
    expect(retried.actions.at(-1)?.stepId).toBe('supervisor.child.verifier');
  });
  it('preserves both original user decisions after the running sibling reports a real Builder failure', async () => {
    const f = await currentFixedFixture('running-builder'),
      loaded = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name),
      sibling = f.run.actions.find((a) => a.id === f.sibling.id)!;
    const stopped = await loaded.runtime.recordOutcome({
      runId: f.name,
      outcome: {
        actionId: sibling.id,
        attempt: sibling.attempt,
        inputHash: sibling.inputHash,
        claimToken: sibling.claim!.token,
        outcomeId: 'original-sibling-failed',
        status: 'failed',
        output: { summary: 'SIMULATED original Builder actually failed.' },
      },
      context: {
        projectRoot: f.projectRoot,
        requestId: 'actual-sibling-failure',
      },
    });
    const before = structuredClone(stopped);
    const run = await loaded.runtime.next({ runId: f.name });
    expect(run.actions).toEqual(before.actions);
    expect(
      run.waits
        .filter((w) => w.status === 'pending')
        .map((w) => w.stepId)
        .sort(),
    ).toEqual(['supervisor.child.resume', 'supervisor.child.verifier-retry']);
    expect((await loaded.runtime.inspect(f.name)).waits).toEqual(run.waits);
  });
  it('creates one recovery Wait per original failed Verifier when both independent children failed', async () => {
    const f = await currentFixedFixture('two-verifiers'),
      failed = f.run.actions.filter(
        (a) => a.stepId === 'supervisor.child.verifier' && a.status === 'failed',
      );
    expect(failed).toHaveLength(2);
    const { runtime } = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name),
      run = await runtime.next({ runId: f.name });
    expect(run.actions).toEqual(f.run.actions);
    const waits = run.waits.filter(
      (w) => w.status === 'pending' && w.stepId === 'supervisor.child.verifier-retry',
    );
    expect(waits).toHaveLength(2);
    expect(
      waits
        .map(
          (w) =>
            (w.proposal as { activation: { failedVerifierActionId: string } }).activation
              .failedVerifierActionId,
        )
        .sort(),
    ).toEqual(failed.map((a) => a.id).sort());
    await runtime.next({ runId: f.name });
    expect((await runtime.inspect(f.name)).waits).toEqual(run.waits);
  });
  it('restores a checkpoint-only fixed application on writable load while read-only inspection remains unchanged', async () => {
    const f = await currentFixedFixture();
    await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(f.projectRoot), 'applications'), {
      recursive: true,
    });
    await expect(
      (async () => {
        const l = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name, {
          readOnly: true,
        });
        await l.runtime.inspect(f.name);
      })(),
    ).rejects.toThrow('checkpoint recovery');
    expect(
      await readWorkflowApplicationRun(f.projectRoot, 'native-candidate-review', f.name),
    ).toBeNull();
    const loaded = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name),
      run = await loaded.runtime.inspect(f.name);
    expect(run.workflow).toEqual(f.run.workflow);
    expect(run.actions).toEqual(createPortableRunCheckpoint(f.run).run.actions);
    expect(run.waits).toEqual(f.run.waits);
    expect(
      run.waits.some(
        (w) => w.status === 'pending' && w.stepId === 'supervisor.child.verifier-retry',
      ),
    ).toBe(true);
  });
  it.each(['fixed-package', 'running-sibling'] as const)(
    'preserves fixed application business identity and original records at the %s boundary',
    async (kind) => {
      const f = await currentFixedFixture(
          kind === 'running-sibling' ? 'running-builder' : 'pending',
        ),
        before = await readWorkflowApplicationRun(f.projectRoot, 'native-candidate-review', f.name);
      if (kind === 'fixed-package') {
        await fs.appendFile(
          path.join(path.dirname(f.file), 'application.mjs'),
          '\n// changed fixed package\n',
        );
        await expect(loadOwnedNativeSdkRuntime(f.projectRoot, f.name)).rejects.toThrow(
          /固定|changed|hash|binding/i,
        );
        expect(
          await readWorkflowApplicationRun(f.projectRoot, 'native-candidate-review', f.name),
        ).toEqual(before);
      } else {
        const loaded = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name),
          run = await loaded.runtime.inspect(f.name);
        expect(run.actions).toEqual(before!.actions);
        expect(run.waits).toEqual(before!.waits);
        expect(run.actions.find((a) => a.id === f.sibling.id)).toMatchObject({
          status: 'running',
          claim: f.run.actions.find((a) => a.id === f.sibling.id)!.claim,
        });
      }
    },
  );
});
