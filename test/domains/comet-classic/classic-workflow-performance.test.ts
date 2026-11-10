import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import * as openspec from '../../../domains/comet-classic/classic-openspec-execution.js';
import * as owners from '../../../domains/workflow-contract/change-runtime-owner.js';
import * as branches from '../../../domains/comet-classic/classic-branch-binding.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-work-budget-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  const cli = (...args: string[]) =>
    withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli([...args, '--json']),
    );
  expect((await cli('state', 'init', 'demo', 'full', '--runtime', 'sdk')).exitCode).toBe(0);
  const directory = path.join(root, 'openspec/changes/demo');
  await fs.writeFile(
    path.join(directory, '.openspec.yaml'),
    'schema: spec-driven\nskip_specs: true\n',
  );
  await fs.writeFile(path.join(directory, 'proposal.md'), '# Proposal\nOptimize the fixture.\n');
  await fs.writeFile(
    path.join(directory, 'design.md'),
    '# Design\nUse the current implementation.\n',
  );
  await fs.writeFile(path.join(directory, 'tasks.md'), '- [ ] Implement the fixture\n');
  const upstream = vi.spyOn(openspec, 'executeClassicOpenSpec').mockResolvedValue({
    exitCode: 0,
    stdout: JSON.stringify({
      changeRoot: directory,
      applyRequires: ['tasks'],
      artifacts: [
        { id: 'proposal', outputPath: 'proposal.md', status: 'done', requires: [] },
        { id: 'design', outputPath: 'design.md', status: 'done', requires: ['proposal'] },
        { id: 'tasks', outputPath: 'tasks.md', status: 'done', requires: ['design'] },
      ],
    }),
  });
  return { root, directory, cli, upstream };
}

it('validates Design sources once per prepare and submit boundary and rereads on the next command', async () => {
  const f = await fixture();
  const preview = await f.cli('guard', 'demo', 'open');
  expect(preview.exitCode, preview.stdout).toBe(0);
  const approval = JSON.parse(preview.stdout!).data.approvalHash;
  expect(
    (await f.cli('guard', 'demo', 'open', '--apply', '--approval-hash', approval)).exitCode,
  ).toBe(0);
  f.upstream.mockClear();
  const proposed = await f.cli(
    'state',
    'propose-design',
    'demo',
    '--proposal',
    'Use the current implementation.',
  );
  expect(proposed.exitCode, proposed.stdout ?? proposed.stderr).toBe(0);
  expect(JSON.parse(proposed.stdout!).data.wait.proposalHash).toBeTruthy();
  expect(f.upstream).toHaveBeenCalledTimes(2);
  await fs.writeFile(path.join(f.directory, 'tasks.md'), '');
  const cold = await f.cli('state', 'next', 'demo');
  expect(JSON.parse(cold.stdout!).data.continuation.mode).toBe('reconcile');
  expect(f.upstream).toHaveBeenCalledTimes(3);
});

it('reads Classic ownership once for next and avoids Git probes without branch isolation', async () => {
  const f = await fixture();
  const owner = vi.spyOn(owners, 'readSdkChangeOwner');
  const branch = vi.spyOn(branches, 'liveGitBranch');
  const worktree = vi.spyOn(branches, 'isGitWorkTree');
  const next = await f.cli('state', 'next', 'demo');
  expect(next.exitCode, next.stdout).toBe(0);
  expect(JSON.parse(next.stdout!).data).toMatchObject({
    phase: 'open',
    diagnostics: { healthy: true },
  });
  // resolveClassicChangeRuntimeOwner is the boundary read; downstream consumers reuse it.
  expect(owner).not.toHaveBeenCalled();
  expect(branch).not.toHaveBeenCalled();
  expect(worktree).not.toHaveBeenCalled();
});
