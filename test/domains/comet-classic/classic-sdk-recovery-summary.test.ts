import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic sdk recovery summary '));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await prepareClassicLegacyProject(projectRoot);
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  const cli = async (...args: string[]) => {
    const result = await runClassicCli([...args, '--json'], undefined, {
      projectRoot,
      invocationCwd: projectRoot,
    });
    const response = JSON.parse(result.stdout!);
    expect(response.exitCode, JSON.stringify(response)).toBe(0);
    return response;
  };
  await cli('state', 'init', 'demo', 'full', '--isolation', 'current');
  const changeDir = path.join(projectRoot, 'openspec/changes/demo');
  await Promise.all([
    fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\nPreserve the current API.\n'),
    fs.writeFile(path.join(changeDir, 'design.md'), '# Design\nUse the existing adapter.\n'),
    fs.writeFile(
      path.join(changeDir, 'tasks.md'),
      '- [ ] Implement the adapter <!-- comet-task:a -->\n',
    ),
  ]);
  const proposed = await cli('guard', 'demo', 'open');
  await cli('guard', 'demo', 'open', '--apply', '--approval-hash', proposed.data.approvalHash);
  return { projectRoot, changeDir, cli };
}

const readers = [
  ['next', 'demo'],
  ['select', 'demo'],
  ['check', 'demo', 'design'],
  ['check', 'demo', 'design', '--recover'],
];

describe('Classic SDK compact entry and recovery summaries', () => {
  it.each(readers)('returns stable recovery context for state %s', async (...args) => {
    const { projectRoot, changeDir, cli } = await fixture();
    const before = (await inspectClassicSdkRun(projectRoot, 'demo')).run;
    const response = await cli('state', ...args);
    expect(response.data).toMatchObject({
      runtimeFormat: 'sdk',
      phase: 'design',
      projectRoot,
      changeDir,
      workspace: { projectRoot },
      layout: {
        schema: 'comet.classic-layout.v1',
        changesRoot: path.join(projectRoot, 'openspec/changes'),
      },
      artifactRefs: {
        change: 'openspec/changes/demo',
        tasks: 'openspec/changes/demo/tasks.md',
        designDoc: 'openspec/changes/demo/design.md',
        plansRoot: 'docs/superpowers/plans',
      },
      configurationReadiness: { missingFields: expect.any(Array) },
      taskState: { total: 1, completed: 0, next: { id: 'a' } },
      coordination: { stale: false },
      delivery: null,
      run: { id: 'demo', revision: before.revision, status: before.status },
      nextAction: { kind: 'action', stepId: 'full.design.handoff' },
    });
    expect(response.agent.workspace.cwd).toBe(projectRoot);
    expect(response.agent.continuation).toMatchObject({
      ...response.data.nextAction,
      cwd: projectRoot,
    });
    expect(response.data.run.actions).toHaveLength(1);
    expect(response.data.run.actions[0].status).toBe('pending');
    expect(response.data.run.waits).toHaveLength(0);
    expect(response.data.run.evidenceWaits).toHaveLength(0);
    expect(response.data.run.outputs).toBeUndefined();
    expect(response.data.run.definitionHashes).toBeUndefined();
    expect(response.data.taskState.tasks).toBeUndefined();
    expect((await inspectClassicSdkRun(projectRoot, 'demo')).run).toEqual(before);
  });

  it.each(readers)('expands task and Run history only with state %s --details', async (...args) => {
    const { projectRoot, cli } = await fixture();
    const before = (await inspectClassicSdkRun(projectRoot, 'demo')).run;
    const compact = await cli('state', ...args);
    const detailed = await cli('state', ...args, '--details');
    expect(detailed.data.run).toEqual({ ...before, id: before.runId });
    expect(detailed.data.run.actions.length).toBeGreaterThan(compact.data.run.actions.length);
    expect(detailed.data.taskState.tasks).toHaveLength(1);
    expect(detailed.data.nextAction).toEqual(compact.data.nextAction);
    expect(detailed.agent.continuation).toEqual(compact.agent.continuation);
    expect((await inspectClassicSdkRun(projectRoot, 'demo')).run).toEqual(before);
  });

  it('keeps the current decision proposal and hash in compact responses', async () => {
    const { projectRoot, cli } = await fixture();
    const proposed = await cli('state', 'propose-design', 'demo', '--proposal', 'Use the adapter.');
    const pending = (await inspectClassicSdkRun(projectRoot, 'demo')).run.waits.find(
      (wait) => wait.status === 'pending',
    )!;
    const response = await cli('state', 'next', 'demo');
    expect(response.data.run.actions).toHaveLength(0);
    expect(response.data.run.waits).toHaveLength(1);
    expect(response.data.run.waits[0]).toMatchObject({
      id: proposed.data.wait.id,
      proposalHash: proposed.data.wait.proposalHash,
      proposal: pending.proposal,
      choices: proposed.data.wait.choices,
      status: 'pending',
    });
    expect(response.data.nextAction).toMatchObject({
      kind: 'decision',
      waitId: proposed.data.wait.id,
      proposalHash: proposed.data.wait.proposalHash,
    });
  });

  it.each(['next', 'select'])('documents and validates %s detail options', async (command) => {
    const help = await runClassicCli(['state', command, '--help']);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain(`comet state ${command} <change-name> [--details]`);
    expect(help.stdout).toContain('full Run history');
    const { projectRoot } = await fixture();
    for (const options of [['--unexpected'], ['--details', '--details']]) {
      const result = await runClassicCli(
        ['state', command, 'demo', ...options, '--json'],
        undefined,
        {
          projectRoot,
          invocationCwd: projectRoot,
        },
      );
      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stdout!).stderr).toContain(`[--details]`);
    }
  });
});
