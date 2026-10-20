import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import { defineWorkflow, hashRuntimeValue } from '../../../domains/engine/runtime.js';
import {
  classicSdkApplicationForRun,
  classicSdkRevisionApplication,
} from '../../../domains/comet-classic/classic-sdk-revision-application.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';

const roots: string[] = [];

it.each([
  ['hotfix', 'ebdb8fb3cdffb000a5f63fa58ebecc34c4ba9e147d0ecb916e2f61a8eb796b64'],
  ['hotfix', 'eaaac8f3ab31fdb9c338f8819d4afa19c95afd16fe66d233319c4b6af40ac078'],
  ['hotfix', 'bccf5f519340c5a9204711a3b008b4ac1f12b0493570820b0e9f3a134459988f'],
  ['hotfix', 'f6ea048de7fb4a912c70b0374796dcc23e1babc7eb25c5bf02ac5af7a6ed0415'],
  ['tweak', '2433e88162fdc02b42691a781694fc16566900d547fd343c9a56e7039f7dad31'],
  ['tweak', 'f910bb14738f9ead86128931c71a9f1d3627be0792eb3e0f70969a311befbe6a'],
  ['tweak', 'c79f0014b2af6b662720714f11263de50d0c9740f24ea09e4a22198161140189'],
  ['tweak', 'fd0963baf2d32bf216347ec6da02ec0bf1acb12d3de10fc20cd127b63c940987'],
] as const)('recognizes the persisted %s definition %s', (profile, hash) => {
  const run = { workflow: { hash } } as Parameters<typeof classicSdkApplicationForRun>[1];
  const selected = classicSdkApplicationForRun(profile, run);
  expect(hashRuntimeValue(defineWorkflow(selected.workflow))).toBe(hash);
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(profile: 'hotfix' | 'tweak', legacy = false, completed = true) {
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
  const cli = async (...args: string[]) =>
    JSON.parse(
      (
        await runClassicCli([args[0], '--json', ...args.slice(1)], undefined, {
          projectRoot: root,
          invocationCwd: root,
        })
      ).stdout!,
    );
  const ok = async (...args: string[]) => {
    const result = await cli(...args);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    return result.data;
  };
  await ok('state', 'init', 'example', profile, '--isolation', 'current');
  if (legacy) {
    const store = createClassicSdkStateStore(root);
    const run = (await store.read('example'))!;
    const workflow = structuredClone(classicSdkRevisionApplication(profile).workflow);
    const step = workflow.steps[`${profile}.build.execute`];
    delete (step.outputSchema as { properties: Record<string, unknown> }).properties
      .requirementsEvidence;
    delete step.validator;
    const definition = defineWorkflow(workflow);
    const hash = hashRuntimeValue(definition);
    const previous = structuredClone(run);
    previous.workflow.hash = hash;
    previous.definitionHashes[JSON.stringify([definition.id, definition.version])] = hash;
    previous.revision++;
    expect(await store.compareAndSwap(run.runId, run.revision, previous)).toBe(true);
  }
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
  const check = ['--apply', '--', process.execPath, '-e', 'process.exit(0)'];
  return { root, directory, proposal, cli, ok, check };
}

describe.each(['hotfix', 'tweak'] as const)('%s approved scope', (profile) => {
  it('allows public task ID assignment and completion without another scope approval', async () => {
    const { ok, check } = await fixture(profile, false, false);
    const listed = await ok('state', 'tasks', 'example', '--assign-ids');
    await ok('state', 'task-complete', 'example', listed.tasks[0].id, '--expect', listed.revision);
    expect((await ok('guard', 'example', 'build', ...check)).phase).toBe('verify');
  });

  it('blocks changed requirements at Build and Verify while allowing checkbox completion', async () => {
    const { root, directory, proposal, cli, ok, check } = await fixture(profile);
    const changed = '# Proposal\nReplace authentication and migrate credentials.\n';
    await fs.writeFile(path.join(directory, 'proposal.md'), changed);
    expect((await cli('guard', 'example', 'build', ...check)).exitCode).not.toBe(0);
    await fs.writeFile(path.join(directory, 'proposal.md'), proposal);
    await fs.writeFile(path.join(directory, 'tasks.md'), '- [x] Replace authentication instead\n');
    expect((await cli('guard', 'example', 'build', ...check)).exitCode).not.toBe(0);
    await fs.writeFile(path.join(directory, 'tasks.md'), '- [x] Fix the greeting typo\n');
    expect((await ok('guard', 'example', 'build', ...check)).phase).toBe('verify');
    const report = 'docs/superpowers/reports/example.md';
    await fs.mkdir(path.dirname(path.join(root, report)), { recursive: true });
    await fs.writeFile(
      path.join(root, report),
      '# Verification report\nThe greeting typo is corrected and related checks passed.\n',
    );
    await fs.writeFile(path.join(directory, 'proposal.md'), changed);
    expect(
      (await cli('guard', 'example', 'verify', '--report', report, ...check)).exitCode,
    ).not.toBe(0);
    await fs.writeFile(path.join(directory, 'proposal.md'), proposal);
    expect((await ok('guard', 'example', 'verify', '--report', report, ...check)).phase).toBe(
      'archive',
    );
  });
  it('upgrades a known previous definition for a fresh scope decision without rewriting completed Actions', async () => {
    const { root, directory, ok, check } = await fixture(profile, true);
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
    expect(after.workflow.hash).not.toBe(before.workflow.hash);
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
  it('binds scope confirmation to the proposed artifacts before continuing the same preset', async () => {
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
    await fs.appendFile(path.join(directory, 'proposal.md'), 'Also change authentication.\n');
    expect(
      (
        await cli(
          'state',
          'decide-escalation',
          'example',
          '--proposal-hash',
          hash,
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
