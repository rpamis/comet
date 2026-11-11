import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createOpenSpecArchiveFixture } from '../../helpers/classic-openspec-fixture.js';
import { canRepairClassicDelivery } from '../../../domains/comet-classic/classic-sdk-delivery-repair-model.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

it('repairs archived Classic v2 delivery with platform reports without replaying commands or Archive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-agent-checks-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'base',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  const cli = async (...args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve('assets/skills/comet/scripts/comet-runtime.mjs'),
        args[0],
        '--json',
        ...args.slice(1),
      ],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    return JSON.parse(result.stdout!);
  };
  const initialized = await cli('state', 'init', 'example', 'hotfix', '--isolation', 'current');
  expect(initialized.exitCode, initialized.stderr).toBe(0);
  const dir = path.join(root, 'openspec/changes/example');
  await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\nFix a small defect.\n');
  await fs.writeFile(path.join(dir, 'design.md'), '# Design\nKeep the existing scope.\n');
  await fs.writeFile(path.join(dir, 'tasks.md'), '- [ ] Implement the change\n');
  const preview = await cli('guard', 'example', 'open');
  const opened = await cli(
    'guard',
    'example',
    'open',
    '--apply',
    '--approval-hash',
    preview.data.approvalHash,
  );
  expect(opened.exitCode, opened.stderr).toBe(0);
  await fs.writeFile(path.join(dir, 'tasks.md'), '- [x] Implement the change\n');
  await fs.writeFile(
    path.join(root, 'checks.json'),
    JSON.stringify({ checks: [{ name: 'Actual platform command exited 7', result: 'failed' }] }),
  );
  const before = (await inspectClassicSdkRun(root, 'example')).run;
  const managed = await cli(
    'check',
    'run',
    'example',
    'build',
    '--',
    process.execPath,
    '-e',
    'process.exit(0)',
  );
  expect(managed.exitCode).toBe(0);
  expect(managed.data).toMatchObject({
    status: 'platform-execution-required',
    checksExecuted: false,
  });
  expect((await inspectClassicSdkRun(root, 'example')).run).toEqual(before);
  const rejected = await cli('state', 'complete-build', 'example', '--checks', 'checks.json');
  expect(rejected.exitCode).not.toBe(0);
  expect((await inspectClassicSdkRun(root, 'example')).run).toEqual(before);
  await fs.writeFile(
    path.join(root, 'checks.json'),
    JSON.stringify({
      checks: [
        {
          name: 'Generate required output',
          result: 'passed',
          note: 'Actual platform Node command created generated/check-output.bin in projectRoot.',
        },
      ],
    }),
  );
  execFileSync(
    process.execPath,
    [
      '-e',
      "const fs=require('node:fs');fs.mkdirSync('generated',{recursive:true});fs.writeFileSync('generated/check-output.bin','actual output');",
    ],
    { cwd: root },
  );
  const completed = await cli('state', 'complete-build', 'example', '--checks', 'checks.json');
  expect(completed.exitCode, completed.stderr).toBe(0);
  const next = (await inspectClassicSdkRun(root, 'example')).run;
  expect(next.workflow.version).toBe('2');
  expect(next.actions.some((action) => action.stepId.endsWith('.build.check'))).toBe(false);
  expect(next.actions.find((action) => action.status === 'pending')?.stepId).toBe(
    'hotfix.verify.run',
  );
  expect(completed.data.checksMode).toBe('agent');
  const reportRef = 'docs/superpowers/reports/example.md';
  await fs.mkdir(path.dirname(path.join(root, reportRef)), { recursive: true });
  await fs.writeFile(
    path.join(root, reportRef),
    '# Verification\nAll scoped acceptance items were reviewed.\n',
  );
  const verified = await cli(
    'guard',
    'example',
    'verify',
    '--report',
    reportRef,
    '--apply',
    '--checks',
    'checks.json',
  );
  expect(verified.exitCode, verified.stderr).toBe(0);
  const final = (await inspectClassicSdkRun(root, 'example')).run;
  expect((final.state as { phase: string }).phase).toBe('archive');
  expect(final.actions.some((action) => action.stepId.endsWith('.verify.check'))).toBe(false);
  expect(final.actions.find((action) => action.status === 'pending')?.stepId).toBe(
    'hotfix.archive.prepare',
  );
  await fs.writeFile(
    path.join(root, '.comet/check-policy.json'),
    JSON.stringify({
      version: 2,
      commands: [
        {
          argv: [
            process.execPath,
            '-e',
            "const fs=require('node:fs');fs.mkdirSync('generated',{recursive:true});fs.writeFileSync('generated/check-output.bin','actual output');",
          ],
          cwd: '.',
          outputs: ['generated/**'],
        },
      ],
    }),
  );
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-agent-repair-tool-'));
  roots.push(fixtureRoot);
  const openSpec = await createOpenSpecArchiveFixture(fixtureRoot);
  vi.stubEnv('COMET_OPENSPEC', openSpec.command);
  const proposal = await cli(
    'state',
    'propose-archive',
    'example',
    '--summary',
    'Fixture user approves local delivery.',
  );
  expect(proposal.exitCode, proposal.stderr).toBe(0);
  const approval = await cli(
    'state',
    'decide-archive',
    'example',
    '--proposal-hash',
    proposal.data.wait.proposalHash,
    '--choice',
    'local',
  );
  expect(approval.exitCode, approval.stderr).toBe(0);
  const archived = await cli('guard', 'example', 'archive', '--apply');
  expect(archived.exitCode, JSON.stringify(archived)).toBe(0);
  const original = (await inspectClassicSdkRun(root, 'example')).run;
  expect(original.workflow.version).toBe('2');
  expect(canRepairClassicDelivery(original)).toBe(true);
  await fs.unlink(path.join(root, 'generated/check-output.bin'));
  const missing = await cli(
    'state',
    'repair-delivery',
    'example',
    '--expected-revision',
    String(original.revision),
  );
  expect(missing.exitCode).not.toBe(0);
  expect((await inspectClassicSdkRun(root, 'example')).run).toEqual(original);
  await fs.writeFile(
    path.join(root, 'failed.json'),
    JSON.stringify({ checks: [{ name: 'Real failed check', result: 'failed' }] }),
  );
  const failed = await cli(
    'state',
    'repair-delivery',
    'example',
    '--expected-revision',
    String(original.revision),
    '--checks',
    'failed.json',
  );
  expect(failed.exitCode).not.toBe(0);
  expect((await inspectClassicSdkRun(root, 'example')).run).toEqual(original);
  // The platform regenerates the output; Runtime must never execute the policy command.
  await fs.writeFile(path.join(root, 'generated/check-output.bin'), 'platform regenerated');
  const repair = await cli(
    'state',
    'repair-delivery',
    'example',
    '--expected-revision',
    String(original.revision),
    '--checks',
    'checks.json',
  );
  const after = (await inspectClassicSdkRun(root, 'example')).run;
  expect(repair.exitCode, JSON.stringify(repair)).toBe(0);
  expect(after.runId).toBe(original.runId);
  expect(after.workflow.version).toBe('2');
  expect(await openSpec.invocations()).toHaveLength(1);
  expect(after.actions.filter((a) => a.stepId.endsWith('.verify.check'))).toEqual([]);
  const continued = await cli('state', 'next', 'example', '--continue');
  expect(
    continued.exitCode,
    JSON.stringify((await inspectClassicSdkRun(root, 'example')).run.actions.at(-1)),
  ).toBe(0);
  const waiting = (await inspectClassicSdkRun(root, 'example')).run;
  const decision = waiting.waits.find((w) => w.status === 'pending')!;
  expect(decision.stepId).toBe('hotfix.delivery.confirm');
  expect(
    (
      await cli(
        'state',
        'complete-delivery',
        'example',
        '--commit',
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      )
    ).exitCode,
  ).not.toBe(0);
  expect((await inspectClassicSdkRun(root, 'example')).run).toEqual(waiting);
  expect(
    (
      await cli(
        'state',
        'decide-delivery-repair',
        'example',
        '--proposal-hash',
        decision.proposalHash,
        '--choice',
        'approved',
      )
    ).exitCode,
  ).toBe(0);
  expect(await fs.readFile(path.join(root, 'generated/check-output.bin'), 'utf8')).toBe(
    'platform regenerated',
  );
  const archiveRef = (
    original.outputs['hotfix.archive.execute'].value as { archiveDirectory: string }
  ).archiveDirectory;
  execFileSync(
    'git',
    ['add', '--', archiveRef, reportRef, 'generated/check-output.bin', 'checks.json'],
    { cwd: root },
  );
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'deliver'],
    { cwd: root, stdio: 'ignore' },
  );
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const delivered = await cli('state', 'complete-delivery', 'example', '--commit', sha);
  expect(delivered.exitCode, JSON.stringify(delivered)).toBe(0);
  expect((await inspectClassicSdkRun(root, 'example')).run.status).toBe('completed');
  expect(await openSpec.invocations()).toHaveLength(1);
  vi.unstubAllEnvs();
});
