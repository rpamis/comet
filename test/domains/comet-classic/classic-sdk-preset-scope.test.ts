import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(profile: 'hotfix' | 'tweak', completed = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-preset-scope-'));
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
    if (args[0] === 'guard' && ['build', 'verify'].includes(args[2]) && args.includes('--apply')) {
      execFileSync(process.execPath, ['-e', 'process.exit(0)'], { cwd: root, stdio: 'pipe' });
      await fs.writeFile(
        path.join(root, 'platform-checks.json'),
        JSON.stringify({
          checks: [
            {
              name: 'Actual platform Node exit 0',
              result: 'passed',
              note: 'Safe deterministic Node command really completed before this submission.',
            },
          ],
        }),
      );
    }
    return JSON.parse(
      (
        await runClassicCli([args[0], '--json', ...args.slice(1)], undefined, {
          projectRoot: root,
          invocationCwd: root,
        })
      ).stdout!,
    );
  };
  const ok = async (...args: string[]) => {
    const result = await cli(...args);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    return result.data;
  };
  await ok('state', 'init', 'example', profile, '--isolation', 'current');
  const directory = path.join(root, 'openspec/changes/example');
  const proposal = '# Proposal\nFix the greeting typo without changing behavior.\n';
  await fs.writeFile(path.join(directory, 'proposal.md'), proposal);
  await fs.writeFile(
    path.join(directory, 'design.md'),
    '# Design\nPreserve the existing behavior.\n',
  );
  await fs.writeFile(path.join(directory, 'tasks.md'), '- [ ] Fix the greeting typo\n');
  const opened = await ok('guard', 'example', 'open');
  await ok('guard', 'example', 'open', '--apply', '--approval-hash', opened.approvalHash);
  if (completed)
    await fs.writeFile(path.join(directory, 'tasks.md'), '- [x] Fix the greeting typo\n');
  const check = ['--apply', '--checks', 'platform-checks.json'];
  return { root, directory, proposal, cli, ok, check };
}

describe.each(['hotfix', 'tweak'] as const)('%s approved scope', (profile) => {
  it('allows public task ID assignment and completion without another scope approval', async () => {
    const { ok, check } = await fixture(profile, false);
    const listed = await ok('state', 'tasks', 'example', '--assign-ids');
    await ok('state', 'task-complete', 'example', listed.tasks[0].id, '--expect', listed.revision);
    expect((await ok('guard', 'example', 'build', ...check)).phase).toBe('verify');
  });

  it('reconfirms actual requirement revisions explicitly in Build and Verify', async () => {
    const { root, directory, cli, ok, check } = await fixture(profile);
    const approve = async (reason: string) => {
      const proposal = await ok('state', 'propose-escalation', 'example', '--reason', reason);
      const before = (await inspectClassicSdkRun(root, 'example')).run;
      expect((await cli('guard', 'example', 'build', ...check)).exitCode).not.toBe(0);
      expect((await inspectClassicSdkRun(root, 'example')).run).toEqual(before);
      await ok(
        'state',
        'decide-escalation',
        'example',
        '--proposal-hash',
        proposal.wait.proposalHash,
        '--choice',
        'continue',
      );
    };
    await fs.writeFile(
      path.join(directory, 'proposal.md'),
      '# Proposal\nFix the typo and punctuation.\n',
    );
    await approve('Fixture user approves adding punctuation.');
    await fs.writeFile(path.join(directory, 'tasks.md'), '- [x] Fix typo and punctuation\n');
    expect((await ok('guard', 'example', 'build', ...check)).phase).toBe('verify');
    const before = (await inspectClassicSdkRun(root, 'example')).run;
    await ok('state', 'continue-build', 'example', '--expected-revision', String(before.revision));
    await fs.appendFile(
      path.join(directory, 'proposal.md'),
      'Also improve greeting capitalization.\n',
    );
    await approve('Fixture user approves the capitalization revision.');
    expect((await ok('guard', 'example', 'build', ...check)).phase).toBe('verify');
    const report = 'docs/superpowers/reports/example.md';
    await fs.mkdir(path.dirname(path.join(root, report)), { recursive: true });
    await fs.writeFile(
      path.join(root, report),
      '# Verification\nThe revised greeting checks passed.\n',
    );
    expect((await ok('guard', 'example', 'verify', '--report', report, ...check)).phase).toBe(
      'archive',
    );
  });
  it('adds explicit requirement revision without rewriting completed Actions after neutral edits', async () => {
    const { root, directory, proposal, cli, ok, check } = await fixture(profile);
    const legacy = await inspectClassicSdkRun(root, 'example');
    const action = legacy.run.actions.find((action) => action.status === 'pending')!;
    await legacy.runtime.claim({
      runId: 'example',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-classic-state',
      claimToken: 'legacy-scope',
    });
    const requested = await legacy.runtime.recordOutcome({
      runId: 'example',
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'legacy-scope',
        outcomeId: 'legacy-scope-proposal',
        status: 'succeeded',
        output: {
          event: 'escalation-requested',
          proposal: 'Continue the unchanged approved scope.',
        },
      },
    });
    const wait = requested.waits.find((wait) => wait.status === 'pending')!;
    await fs.appendFile(
      path.join(directory, 'proposal.md'),
      '<!-- Agent clarified the same scope. -->\n',
    );
    await ok(
      'state',
      'decide-escalation',
      'example',
      '--proposal-hash',
      wait.proposalHash,
      '--choice',
      'continue',
    );
    const before = (await inspectClassicSdkRun(root, 'example')).run;
    await fs.appendFile(
      path.join(directory, 'proposal.md'),
      'Also correct greeting punctuation.\n',
    );
    const proposed = await ok(
      'state',
      'propose-escalation',
      'example',
      '--reason',
      'Include punctuation.',
    );
    const after = (await inspectClassicSdkRun(root, 'example')).run;
    expect(after.workflow).toEqual(before.workflow);
    expect(proposed.wait.proposalHash).not.toBe(wait.proposalHash);
    expect(after.actions.slice(0, before.actions.length - 1)).toEqual(before.actions.slice(0, -1));
    await ok(
      'state',
      'decide-escalation',
      'example',
      '--proposal-hash',
      proposed.wait.proposalHash,
      '--choice',
      'continue',
    );
    expect((await ok('guard', 'example', 'build', ...check)).phase).toBe('verify');
  });
  it('keeps the original scope decision after neutral edits and rejects a stale SDK proposal', async () => {
    const { directory, cli, ok, check } = await fixture(profile);
    const proposal = '# Proposal\nCorrect greeting punctuation as well as the typo.\n';
    await fs.writeFile(path.join(directory, 'proposal.md'), proposal);
    await fs.writeFile(
      path.join(directory, 'tasks.md'),
      '- [ ] Correct greeting punctuation and typo\n',
    );
    const proposed = await ok(
      'state',
      'propose-escalation',
      'example',
      '--reason',
      'Include greeting punctuation in the same change.',
    );
    const hash = proposed.wait.proposalHash;
    await fs.appendFile(
      path.join(directory, 'proposal.md'),
      '<!-- Agent clarified the same scope. -->\n',
    );
    expect(
      (
        await cli(
          'state',
          'decide-escalation',
          'example',
          '--proposal-hash',
          '0'.repeat(64),
          '--choice',
          'continue',
        )
      ).exitCode,
    ).not.toBe(0);
    await fs.writeFile(path.join(directory, 'proposal.md'), proposal);
    await ok(
      'state',
      'decide-escalation',
      'example',
      '--proposal-hash',
      hash,
      '--choice',
      'continue',
    );
    await fs.writeFile(
      path.join(directory, 'tasks.md'),
      '- [x] Correct greeting punctuation and typo\n',
    );
    expect((await ok('guard', 'example', 'build', ...check)).phase).toBe('verify');
  });
});
