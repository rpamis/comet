import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import {
  defineClassicAgentWorkflowApplication,
  defineClassicWorkflowApplication,
} from '../../../domains/comet-classic/classic-sdk-application.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { defineWorkflow } from '../../../domains/engine/runtime.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

it.each(['full', 'hotfix', 'tweak'] as const)(
  'compiles Classic %s with platform reports and an explicit Archive approval',
  (profile) => {
    const legacy = defineWorkflow(defineClassicWorkflowApplication(profile).workflow);
    const current = defineWorkflow(defineClassicAgentWorkflowApplication(profile).workflow);
    expect(legacy.version).toBe('2');
    expect(current.version).toBe('2');
    expect(
      Object.keys(current.steps).filter((id) =>
        /\.(build|verify)\.check(?:\.evidence)?$/u.test(id),
      ),
    ).toEqual([]);
    expect(Object.keys(legacy.steps).some((id) => id.endsWith('.verify.check'))).toBe(false);
    expect(current.steps[`${profile}.archive.confirm`]).toMatchObject({ type: 'ask_user' });
  },
);

it('continues a new Classic Run with platform check reports and rejects failed reports before claiming', async () => {
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
    const result = await runClassicCli([args[0], '--json', ...args.slice(1)], undefined, {
      projectRoot: root,
      invocationCwd: root,
    });
    return JSON.parse(result.stdout!);
  };
  const initialized = await cli('state', 'init', 'demo', 'hotfix', '--isolation', 'current');
  expect(initialized.exitCode, initialized.stderr).toBe(0);
  const dir = path.join(root, 'openspec/changes/demo');
  await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\nFix a small defect.\n');
  await fs.writeFile(path.join(dir, 'design.md'), '# Design\nKeep the existing scope.\n');
  await fs.writeFile(path.join(dir, 'tasks.md'), '- [ ] Implement the change\n');
  const preview = await cli('guard', 'demo', 'open');
  const opened = await cli(
    'guard',
    'demo',
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
  const before = (await inspectClassicSdkRun(root, 'demo')).run;
  const managed = await cli(
    'check',
    'run',
    'demo',
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
  expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(before);
  const rejected = await cli('state', 'complete-build', 'demo', '--checks', 'checks.json');
  expect(rejected.exitCode).not.toBe(0);
  expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(before);
  await fs.writeFile(
    path.join(root, 'checks.json'),
    JSON.stringify({
      checks: [],
      checksReason: 'No executable check applies to this documentation change.',
    }),
  );
  const completed = await cli('state', 'complete-build', 'demo', '--checks', 'checks.json');
  expect(completed.exitCode, completed.stderr).toBe(0);
  const next = (await inspectClassicSdkRun(root, 'demo')).run;
  expect(next.workflow.version).toBe('2');
  expect(next.actions.some((action) => action.stepId.endsWith('.build.check'))).toBe(false);
  expect(next.actions.find((action) => action.status === 'pending')?.stepId).toBe(
    'hotfix.verify.run',
  );
  expect(completed.data.checksMode).toBe('agent');
  const reportRef = 'docs/superpowers/reports/demo.md';
  await fs.mkdir(path.dirname(path.join(root, reportRef)), { recursive: true });
  await fs.writeFile(
    path.join(root, reportRef),
    '# Verification\nAll scoped acceptance items were reviewed.\n',
  );
  const verified = await cli(
    'guard',
    'demo',
    'verify',
    '--report',
    reportRef,
    '--apply',
    '--checks',
    'checks.json',
  );
  expect(verified.exitCode, verified.stderr).toBe(0);
  const final = (await inspectClassicSdkRun(root, 'demo')).run;
  expect((final.state as { phase: string }).phase).toBe('archive');
  expect(final.actions.some((action) => action.stepId.endsWith('.verify.check'))).toBe(false);
  expect(final.actions.find((action) => action.status === 'pending')?.stepId).toBe(
    'hotfix.archive.prepare',
  );
});
