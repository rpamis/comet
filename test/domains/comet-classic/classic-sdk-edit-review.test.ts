import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { runClassicEditReviewCommand } from '../../../domains/comet-classic/classic-edit-review-command.js';
import { inspectClassicHookGuard } from '../../../domains/comet-classic/classic-hook-guard.js';
import { parseCometHookRequest } from '../../../platform/process/hook-adapter.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('reviews a generic edit after a normal SDK Build and continues Verify without a stuck claimed Action', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-edit-review-'));
  roots.push(base);
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
  await prepareClassicLegacyProject(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-b', 'main');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'baseline',
  );
  const cli = async (...args: string[]) => {
    const separator = args.indexOf('--');
    args.splice(separator < 0 ? args.length : separator, 0, '--json');
    const result = await runClassicCli(args, undefined, { projectRoot: root, invocationCwd: root });
    expect(result.exitCode, result.stdout).toBe(0);
    return JSON.parse(result.stdout!);
  };
  await cli('state', 'init', 'demo', 'tweak', '--isolation', 'current');
  const change = path.join(root, 'openspec/changes/demo');
  for (const [ref, source] of Object.entries({
    'proposal.md': '# Proposal\nPreserve the worker behavior.\n',
    'design.md': '# Design\nPreserve behavior.\n',
    'tasks.md': '- [x] Implement the worker\n',
  }))
    await fs.writeFile(path.join(change, ref), source);
  await fs.writeFile(path.join(root, 'worker.py'), 'value = 1\n');
  const preview = await cli('guard', 'demo', 'open');
  await cli('guard', 'demo', 'open', '--apply', '--approval-hash', preview.data.approvalHash);
  await cli(
    'guard',
    'demo',
    'build',
    '--apply',
    '--session',
    'builder-session',
    '--',
    process.execPath,
    '-e',
    '',
  );
  const run = (await inspectClassicSdkRun(root, 'demo')).run;
  expect(
    run.actions.find((action) => action.stepId === 'tweak.build.execute')?.claim?.sessionId,
  ).toBe('builder-session');
  const after = '# Explanation.\nvalue = 1\n';
  const input = {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'worker.py'), content: after },
  };
  const request = parseCometHookRequest(JSON.stringify(input));
  expect((await inspectClassicHookGuard(root, 'demo', request)).allowed).toBe(false);
  expect((await cli('state', 'next', 'demo')).agent.continuation.commandArgs).toContain('claim');
  const requestFile = path.join(base, 'edit.json');
  await fs.writeFile(requestFile, JSON.stringify(input));
  await expect(
    runClassicEditReviewCommand({
      projectRoot: root,
      name: 'demo',
      operation: 'claim',
      file: requestFile,
      sessionId: 'builder-session',
    }),
  ).rejects.toThrow('独立');
  const claimed = await runClassicEditReviewCommand({
    projectRoot: root,
    name: 'demo',
    operation: 'claim',
    file: requestFile,
    sessionId: 'independent-reviewer',
  });
  const template = claimed as { recordTemplate: Record<string, unknown> };
  const recordFile = path.join(base, 'review.json');
  await fs.writeFile(
    recordFile,
    JSON.stringify({
      ...template.recordTemplate,
      decision: 'non-behavioral',
      summary: 'The explanation changes no behavior or acceptance conditions.',
    }),
  );
  await runClassicEditReviewCommand({
    projectRoot: root,
    name: 'demo',
    operation: 'record',
    file: recordFile,
  });
  expect((await cli('state', 'next', 'demo')).agent.continuation.requiredInputs).toContain(
    '重试已经复核通过的原始编辑调用',
  );
  expect((await inspectClassicHookGuard(root, 'demo', request)).allowed).toBe(true);
  await fs.writeFile(path.join(root, 'worker.py'), after);
  const current = (await inspectClassicSdkRun(root, 'demo')).run;
  expect(current.actions).toEqual(run.actions);
  const report = 'docs/superpowers/reports/verify.md';
  await fs.mkdir(path.dirname(path.join(root, report)), { recursive: true });
  await fs.writeFile(
    path.join(root, report),
    '# Verification\nThe worker behavior is unchanged.\n',
  );
  expect(
    (
      await cli(
        'guard',
        'demo',
        'verify',
        '--report',
        report,
        '--apply',
        '--',
        process.execPath,
        '-e',
        '',
      )
    ).data.phase,
  ).toBe('archive');
});
