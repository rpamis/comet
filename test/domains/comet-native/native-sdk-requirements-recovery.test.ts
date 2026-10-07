import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import type { WorkflowRun } from '../../../domains/engine/runtime.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(supervisor = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-requirements-recovery-'));
  roots.push(root);
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  const name = 'revise-current-requirements';
  const cli = async (args: string[]) => {
    const result = await runNativeCli([...args, '--project-root', root, '--json']);
    return JSON.parse(result.stdout!);
  };
  expect((await cli(['new', name])).exitCode).toBe(0);
  const change = path.join(root, 'docs/comet/changes', name);
  const brief =
    '# Outcome\nShip the selected workflow.\n# Scope\nPreserve the selected workflow.\n' +
    '# Non-goals\nPublishing.\n# Acceptance examples\n- The selected workflow resumes.\n' +
    '# Constraints and invariants\nPreserve compatibility.\n# Decisions\nNone.\n' +
    '# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n';
  await fs.writeFile(path.join(change, 'brief.md'), brief);
  await fs.mkdir(path.join(change, 'specs/workflow'), { recursive: true });
  await fs.writeFile(
    path.join(change, 'specs/workflow/spec.md'),
    '# Workflow\nThe selected workflow resumes.\n',
  );
  if (supervisor)
    await fs.writeFile(
      path.join(change, 'children.yaml'),
      'schema: comet.native.children.v2\nchildren:\n  - name: api\n    summary: Build the API\n    depends_on: []\n  - name: ui\n    summary: Build the UI\n    depends_on: []\n',
    );
  const prepared = await cli(['next', name]);
  expect(prepared.exitCode, prepared.error?.message).toBe(0);
  const inspect = () => inspectNativeSdkRun(root, name);
  const runtime = createNativeSdkRuntime(root);
  const nextDecision = (run: WorkflowRun, action: string, proposalHash?: string) => [
    'next',
    name,
    action === 'confirm-shape' ? '--confirmed' : `--${action}`,
    '--summary',
    `User chose ${action}.`,
    ...(proposalHash ? ['--proposal-hash', proposalHash] : []),
    '--expected-state-version',
    String((run.state as NativePortableState).state_version),
    '--expected-action',
    action,
    ...(action === 'confirm-shape' && supervisor ? ['--coordination-mode', 'multi-session'] : []),
  ];
  const editRequirements = () =>
    fs.writeFile(
      path.join(change, 'brief.md'),
      brief.replace('The selected workflow resumes.', 'The revised workflow resumes.'),
    );
  const confirm = async () => {
    const { run } = await inspect();
    const result = await cli(nextDecision(run, 'confirm-shape'));
    expect(result.exitCode, result.error?.message).toBe(0);
    return (await inspect()).run;
  };
  const failBuilder = async (run: WorkflowRun, sequence = 1) => {
    const builder = run.actions.find(
      (action) => action.stepId === 'build.builder' && action.status === 'pending',
    )!;
    const context = { requestId: `failed-builder-${sequence}`, projectRoot: root };
    const claimed = await runtime.claim({
      runId: name,
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      executorId: 'native-host',
      sessionId: context.requestId,
      claimToken: context.requestId,
      context,
    });
    const action = claimed.actions.find(({ id }) => id === builder.id)!;
    const failed = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        outcomeId: context.requestId,
        status: 'failed',
        output: { summary: 'Builder stopped with partial implementation.' },
      },
      context,
    });
    return { run: failed, builder: failed.actions.find(({ id }) => id === builder.id)! };
  };
  return {
    root,
    name,
    cli,
    change,
    brief,
    prepared,
    inspect,
    runtime,
    nextDecision,
    editRequirements,
    confirm,
    failBuilder,
  };
}

describe('Native SDK requirements recovery', () => {
  it('keeps a pending Shape approvable across blank lines and soft line wrapping', async () => {
    const f = await fixture();
    const original = (await f.inspect()).run;
    await fs.writeFile(
      path.join(f.change, 'brief.md'),
      f.brief
        .replace('Ship the selected workflow.', 'Ship the selected\nworkflow.')
        .replace(/\n#/gu, '\n\n#'),
    );
    const current = await f.cli(['next', f.name]);
    expect(current.exitCode, current.error?.message).toBe(0);
    expect(current.data.run.revision).toBe(original.revision);
    expect(
      current.data.continuation.commandAlternatives.map((option: { name: string }) => option.name),
    ).toEqual(['confirm-shape', 'revise-requirements']);
    await f.confirm();
  });

  it('rejects missing or mismatched Shape revision identity without changing the pending proposal', async () => {
    const f = await fixture();
    const original = (await f.inspect()).run;
    const wait = original.waits.find(({ status }) => status === 'pending')!;
    await f.editRequirements();
    for (const proposalHash of [undefined, '0'.repeat(64)]) {
      const rejected = await f.cli(f.nextDecision(original, 'revise-requirements', proposalHash));
      expect(rejected).toMatchObject({ exitCode: 73, error: { code: 'conflict' } });
      expect((await f.inspect()).run).toEqual(original);
    }
    const emptySummary = f.nextDecision(original, 'revise-requirements', wait.proposalHash);
    emptySummary[emptySummary.indexOf('--summary') + 1] = '  ';
    expect((await f.cli(emptySummary)).exitCode).toBe(64);
    expect((await f.inspect()).run).toEqual(original);
  });

  it.each([false, true])(
    'renews an edited pending Shape without reusing approval (Supervisor=%s)',
    async (supervisor) => {
      const f = await fixture(supervisor);
      const original = (await f.inspect()).run;
      const wait = original.waits.find(({ status }) => status === 'pending')!;
      const oldConfirmation = f.nextDecision(original, 'confirm-shape');
      await f.editRequirements();
      const stale = await f.cli(oldConfirmation);
      expect(stale).toMatchObject({ exitCode: 73, error: { code: 'conflict' } });
      expect(stale.data.continuation.commandAlternatives).toMatchObject([
        { name: 'revise-requirements' },
      ]);
      for (const command of ['next', 'select']) {
        const status = await f.cli([command, f.name]);
        expect(status.exitCode, status.error?.message).toBe(0);
        expect(
          status.data.continuation.commandAlternatives.map(
            (option: { name: string }) => option.name,
          ),
        ).toEqual(['revise-requirements']);
        expect(status.data.continuation.commandAlternatives[0].commandArgs).toContain(
          wait.proposalHash,
        );
        expect(status.data.run.revision).toBe(original.revision);
      }
      const revision = f.nextDecision(original, 'revise-requirements', wait.proposalHash);
      const renewed = await f.cli(revision);
      expect(renewed.exitCode, renewed.error?.message).toBe(0);
      const latest = (await f.inspect()).run;
      expect(latest.state).toMatchObject({
        phase: 'shape',
        status: 'await-user',
        acceptance: [{ text: 'The revised workflow resumes.' }],
      });
      expect(latest.waits.find(({ id }) => id === wait.id)).toMatchObject({
        status: 'resolved',
        decision: { choice: 'rejected' },
      });
      expect(latest.waits.find(({ status }) => status === 'pending')!.id).not.toBe(wait.id);
      expect(
        latest.actions.some(
          ({ stepId }) => stepId === 'build.builder' || stepId === 'supervisor.prepare',
        ),
      ).toBe(false);
      expect((await f.cli(oldConfirmation)).exitCode).toBe(73);
      expect((await f.cli(revision)).exitCode).toBe(73);
      const repeat = await f.cli(['next', f.name]);
      expect(repeat.data.run.revision).toBe(latest.revision);
      await f.confirm();
      expect((await f.inspect()).state.phase).toBe('build');
    },
  );

  it('returns a failed ordinary Builder to Shape while preserving partial work and rejecting its old resume', async () => {
    const f = await fixture();
    const built = await f.confirm();
    const partialFile = path.join(f.root, 'partial.txt');
    await fs.writeFile(partialFile, 'preserved partial implementation\n');
    const { run, builder } = await f.failBuilder(built);
    const wait = run.waits.find(({ status }) => status === 'pending')!;
    const resume = f.nextDecision(run, 'continue-builder', wait.proposalHash);
    const preview = await f.cli(['next', f.name]);
    expect(
      preview.data.continuation.commandAlternatives.map((option: { name: string }) => option.name),
    ).toEqual(['continue-builder', 'revise-requirements']);
    await f.editRequirements();
    const revised = await f.cli(f.nextDecision(run, 'revise-requirements', wait.proposalHash));
    expect(revised.exitCode, revised.error?.message).toBe(0);
    const latest = (await f.inspect()).run;
    expect(latest.state).toMatchObject({
      phase: 'shape',
      status: 'active',
      acceptance: [],
      builder_handoff: null,
      verification: null,
      verification_result: 'pending',
    });
    expect(latest.actions.find(({ id }) => id === builder.id)).toEqual(builder);
    expect(latest.waits.find(({ id }) => id === wait.id)?.status).toBe('cancelled');
    expect((latest.state as NativePortableState).history.at(-1)?.summary.text).toBe(
      'User chose revise-requirements.',
    );
    expect(await fs.readFile(partialFile, 'utf8')).toBe('preserved partial implementation\n');
    expect((await f.cli(resume)).exitCode).toBe(73);
    await expect(
      f.runtime.claim({
        runId: f.name,
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        executorId: 'native-host',
        sessionId: 'stale-builder',
        claimToken: 'stale-builder',
      }),
    ).rejects.toThrow();
    const prepared = await f.cli(['next', f.name]);
    expect(prepared.exitCode, prepared.error?.message).toBe(0);
    expect((await f.inspect()).state).toMatchObject({ phase: 'shape', status: 'await-user' });
    await f.confirm();
    const final = (await f.inspect()).run;
    expect(
      final.actions.filter(
        ({ stepId, status }) => stepId === 'build.builder' && status === 'pending',
      ),
    ).toHaveLength(1);
    expect(final.actions.find(({ id }) => id === builder.id)).toEqual(builder);
  });

  it('binds stopped Builder revision to the current resume proposal even when the state version is unchanged', async () => {
    const f = await fixture();
    const { run: first } = await f.failBuilder(await f.confirm());
    const wait = first.waits.find(({ status }) => status === 'pending')!;
    const staleRevision = f.nextDecision(first, 'revise-requirements', wait.proposalHash);
    expect(
      (await f.cli(f.nextDecision(first, 'continue-builder', wait.proposalHash))).exitCode,
    ).toBe(0);
    const { run: second } = await f.failBuilder((await f.inspect()).run, 2);
    expect((second.state as NativePortableState).state_version).toBe(
      (first.state as NativePortableState).state_version,
    );
    expect((await f.cli(staleRevision)).exitCode).toBe(73);
    expect((await f.inspect()).run).toEqual(second);
    const current = second.waits.find(({ status }) => status === 'pending')!;
    for (const proposalHash of [undefined, wait.proposalHash]) {
      await expect(
        f.runtime.dispatchCommand({
          runId: f.name,
          expectedRevision: second.revision,
          commandId: `invalid-revise-${proposalHash ?? 'missing'}`,
          name: 'revise-requirements',
          input: {
            reason: 'User changed requirements.',
            expectedStateVersion: (second.state as NativePortableState).state_version,
            ...(proposalHash ? { proposalHash } : {}),
          },
          context: { requestId: 'invalid-revise', projectRoot: f.root },
        }),
      ).rejects.toThrow();
      expect((await f.inspect()).run).toEqual(second);
    }
    expect(
      (await f.cli(f.nextDecision(second, 'revise-requirements', current.proposalHash))).exitCode,
    ).toBe(0);
  });

  it.each(['pending', 'running', 'unknown'] as const)(
    'does not revise an ordinary Builder whose status is %s',
    async (status) => {
      const f = await fixture();
      let run = await f.confirm();
      const builder = run.actions.find(
        ({ stepId, status }) => stepId === 'build.builder' && status === 'pending',
      )!;
      if (status !== 'pending') {
        run = await f.runtime.claim({
          runId: f.name,
          actionId: builder.id,
          attempt: builder.attempt,
          inputHash: builder.inputHash,
          executorId: 'native-host',
          sessionId: 'original-builder',
          claimToken: 'original-builder',
          context: { requestId: 'original-builder', projectRoot: f.root },
        });
      }
      if (status === 'unknown') {
        run = await f.runtime.markUnknown({
          runId: f.name,
          actionId: builder.id,
          attempt: builder.attempt,
          reason: 'Original host result was interrupted.',
        });
      }
      const rejected = await f.cli(f.nextDecision(run, 'revise-requirements'));
      expect(rejected).toMatchObject({ exitCode: 73, error: { code: 'conflict' } });
      if (status !== 'pending') {
        expect(rejected.error.message).toContain('running/unknown');
        expect(rejected.data.activeActions).toMatchObject([
          { id: builder.id, status, claim: { token: 'original-builder' } },
        ]);
      }
      expect((await f.inspect()).run).toEqual(run);
      await expect(
        f.runtime.dispatchCommand({
          runId: f.name,
          expectedRevision: run.revision,
          commandId: 'blocked-revision',
          name: 'revise-requirements',
          input: {
            reason: 'User requested changed requirements.',
            expectedStateVersion: (run.state as NativePortableState).state_version,
          },
          context: { requestId: 'blocked-revision', projectRoot: f.root },
        }),
      ).rejects.toThrow();
      expect((await f.inspect()).run).toEqual(run);
    },
  );
});
