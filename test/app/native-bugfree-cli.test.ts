import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { bugfreeFixture } from '../helpers/native-bugfree.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import { resolveWorkspaceRuntimeRootSync } from '../../domains/workflow-contract/workspace-runtime.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('runs public CLI claims, requested checks, compact results, cold recovery and acceptance', async () => {
  await ensureCliBuilt(path.resolve('.'));
  const fixture = await bugfreeFixture((root) => roots.push(root), path.resolve('bin/comet.js'));
  let run = await fixture.candidate('expected\n');
  const status = await fixture.invoke('status', 'bugfree-test');
  expect(status.data).toMatchObject({ verifyMode: 'bugfree' });
  let state = run.state as {
    builder_handoff: { candidate_id: string };
    loop: { iteration: number; attempt: number };
  };
  await fixture.submit(
    {
      candidateId: state.builder_handoff.candidate_id,
      verifierExecutionRef: 'external-reviewer',
      response: {
        kind: 'request-checks',
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        checks: [
          {
            id: 'actual-value',
            name: 'Read actual value',
            executable: process.execPath,
            argv: [
              '-e',
              "if(require('node:fs').readFileSync('value.txt','utf8')!=='expected\\n')process.exit(1)",
            ],
            cwdRef: '.',
            timeoutMs: 10000,
            repeatable: true,
          },
        ],
      },
    },
    'external-reviewer',
  );
  await fixture.invoke('next', 'bugfree-test');
  run = await fixture.inspect();
  state = run.state;
  await fixture.submit(
    {
      candidateId: state.builder_handoff.candidate_id,
      verifierExecutionRef: 'external-reviewer',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'pass',
          passedAcceptanceIds: ['A1'],
          acceptance: [],
          risks: [],
          summary: 'Verified final value.',
        },
      },
    },
    'external-reviewer',
  );
  await fixture.invoke('next', 'bugfree-test');
  const report = await fs.readFile(path.join(fixture.change, 'verification.md'), 'utf8');
  expect(report).toContain('bugfree');
  expect(report).toContain('本轮实际执行');
  expect(report).toContain('actual-value');
  const final = await fixture.inspect();
  expect(final.waits.at(-1)?.stepId).toBe('verify.confirm');
  expect(final.status).toBe('waiting');
  const reviewerIds = final.actions
    .filter((action: { stepId: string }) => action.stepId === 'verify.verifier')
    .map((action: { id: string }) => action.id);
  const runtimeRoot = resolveWorkspaceRuntimeRootSync(fixture.root);
  expect(path.relative(process.env.COMET_DATA_DIR!, runtimeRoot).startsWith('..')).toBe(false);
  for (const directory of ['sdk-runs', 'applications', 'change-owners', 'state-projections'])
    await fs.rm(path.join(runtimeRoot, directory), { recursive: true, force: true });
  await expect(fixture.invoke('status', 'bugfree-test')).rejects.toThrow('checkpoint recovery');
  await fixture.invoke('doctor', 'bugfree-test', '--repair', '--confirmed');
  const restored = await fixture.inspect();
  expect(restored.input.verifyMode).toBe('bugfree');
  expect(
    restored.actions
      .filter((action: { stepId: string }) => action.stepId === 'verify.verifier')
      .map((action: { id: string }) => action.id),
  ).toEqual(reviewerIds);
  const wait = restored.waits.find(
    (entry: { stepId: string; status: string }) =>
      entry.stepId === 'verify.confirm' && entry.status === 'pending',
  );
  await fixture.invoke(
    'next',
    'bugfree-test',
    '--accept-result',
    '--summary',
    'Simulated fixture user accepts this result',
    '--proposal-hash',
    wait.proposalHash,
    '--expected-state-version',
    String(restored.state.state_version),
    '--expected-action',
    'accept-result',
  );
  const accepted = await fixture.inspect();
  expect(accepted.state.phase).toBe('archive');
  expect(accepted.waits.find((entry: { id: string }) => entry.id === wait.id).decision.choice).toBe(
    'approved',
  );
}, 180000);
