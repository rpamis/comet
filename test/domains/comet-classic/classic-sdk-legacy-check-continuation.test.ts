import '../../helpers/isolated-agent-home.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { fixture as platformFixture } from '../../helpers/classic-platform-migration.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { assertVerifyEvidenceCurrent } from '../../../domains/comet-classic/classic-sdk-archive-preflight.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { upgradeClassicRun } from '../../../domains/comet-classic/classic-sdk-run-upgrade.js';
import { defineClassicWorkflowApplication } from '../../../domains/comet-classic/classic-sdk-application.js';
import { parseWorkflowRun } from '../../../domains/engine/runtime.js';
import type { ClassicState } from '../../../domains/comet-classic/classic-state.js';
async function fixture(entry: 'source' | 'generated') {
  const f = await platformFixture(entry);
  await f.report('build');
  await f.cli('state', 'complete-build', 'demo', '--checks', 'checks.json');
  const ref = 'docs/superpowers/reports/verify.md';
  await fs.mkdir(path.dirname(path.join(f.root, ref)), { recursive: true });
  await fs.writeFile(path.join(f.root, ref), '# Verification\nActual platform check passed.\n');
  execFileSync(
    process.execPath,
    [
      '-e',
      "require('node:fs').appendFileSync(process.argv[1],'x')",
      path.join(f.root, 'verify-count'),
    ],
    { cwd: f.root },
  );
  await fs.writeFile(
    path.join(f.root, 'checks.json'),
    JSON.stringify({
      checks: [{ name: 'actual external Verify', result: 'passed' }],
    }),
  );
  await f.cli('guard', 'demo', 'verify', '--report', ref, '--apply', '--checks', 'checks.json');
  const run = await f.inspect();
  const original = run.actions.findLast((a) => a.stepId === 'tweak.verify.run')!;
  await f.cli('state', 'next', 'demo', '--continue');
  await f.cli('state', 'next', 'demo', '--continue');
  expect(await f.inspect()).toEqual(run);
  expect(await fs.readFile(path.join(f.root, 'verify-count'), 'utf8')).toBe('x');
  return { root: f.root, run, cli: f.cli, original };
}
it.each(['source', 'generated'] as const)(
  'accepts an original legacy Verify receipt after business continuation through %s without repeating the command',
  async (entry) => {
    const f = await fixture(entry);
    const proposal = await f.cli(
      'state',
      'propose-archive',
      'demo',
      '--summary',
      'Archive the verified result.',
    );
    const approved = await f.cli(
      'state',
      'decide-archive',
      'demo',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    expect(approved.phase).toBe('archive');
    const run = (await inspectClassicSdkRun(f.root, 'demo')).run;
    expect(run.waits.find((wait) => wait.id === proposal.wait.id)?.decision?.choice).toBe('local');
    expect(run.actions.find((a) => a.id === f.original.id)).toEqual(f.original);
    expect(await fs.readFile(path.join(f.root, 'verify-count'), 'utf8')).toBe('x');
  },
  120000,
);
it.each(['source', 'generated'] as const)(
  'continues a committed Classic Verify through %s after losing auxiliary receipts without replay',
  async (entry) => {
    const f = await fixture(entry);
    await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(f.root), 'check-receipts'), {
      recursive: true,
      force: true,
    });
    const proposal = await f.cli(
      'state',
      'propose-archive',
      'demo',
      '--summary',
      'Archive the original result.',
    );
    await f.cli(
      'state',
      'decide-archive',
      'demo',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    const current = (await inspectClassicSdkRun(f.root, 'demo')).run;
    expect(current.runId).toBe(f.run.runId);
    expect(current.actions.find((action) => action.id === f.original.id)).toEqual(f.original);
    expect(await fs.readFile(path.join(f.root, 'verify-count'), 'utf8')).toBe('x');
  },
);
it('retains original receipt, latest failure, and pending user decision checks for legacy continuation', async () => {
  const f = await fixture('source');
  const source = JSON.parse(
    await fs.readFile(
      path.resolve(
        'test/fixtures/classic-052-platform-upgrade/verify-accepted.archive-prepare.sdk-052.run.json',
      ),
      'utf8',
    ),
  );
  const run = upgradeClassicRun(source, defineClassicWorkflowApplication('tweak').workflow);
  await assertVerifyEvidenceCurrent(run, f.root, run.state as unknown as ClassicState, 1);
  const original = run.actions.findLast((a) => a.stepId === 'tweak.verify.check')!;
  for (const kind of [
    'wrong-reference',
    'wrong-request',
    'latest-failure',
    'missing-original-receipt',
  ] as const) {
    const changed = structuredClone(run);
    const check = changed.actions.find((a) => a.id === original.id)!;
    const receipt = changed.evidenceWaits!.find((w) => w.kind === 'classic-verify-check')!.receipt!;
    if (kind === 'wrong-reference') receipt.ref += '.other';
    if (kind === 'wrong-request') receipt.contentHash = '0'.repeat(64);
    if (kind === 'latest-failure') {
      check.status = 'failed';
      check.outcome!.status = 'failed';
    }
    if (kind === 'missing-original-receipt') check.claim!.token = 'another-claim';
    if (kind === 'missing-original-receipt')
      expect(() => parseWorkflowRun(changed), kind).toThrow();
    else
      await expect(
        assertVerifyEvidenceCurrent(changed, f.root, changed.state as unknown as ClassicState, 1),
        kind,
      ).rejects.toThrow();
  }
  expect(
    run.waits.filter((w) => w.stepId === 'tweak.archive.confirm' && w.status === 'resolved'),
  ).toEqual([]);
  expect(await fs.readFile(path.join(f.root, 'verify-count'), 'utf8')).toBe('x');
}, 120000);
