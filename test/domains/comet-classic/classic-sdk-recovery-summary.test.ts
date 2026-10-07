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
  const opened = await cli(
    'guard',
    'demo',
    'open',
    '--apply',
    '--approval-hash',
    proposed.data.approvalHash,
  );
  return { projectRoot, changeDir, cli, opened };
}

const readers = [
  ['next', 'demo'],
  ['select', 'demo'],
  ['check', 'demo', 'design'],
  ['check', 'demo', 'design', '--recover'],
];

describe('Classic SDK compact entry and recovery summaries', () => {
  it('returns the same complete continuation after Open, Design proposal, decision and workspace resolve', async () => {
    const { projectRoot, cli, opened } = await fixture();
    expect(opened.data).toMatchObject({
      runtimeFormat: 'sdk',
      projectRoot,
      phase: 'design',
      layout: { schema: 'comet.classic-layout.v1' },
    });
    expect(opened.agent.workspace.cwd).toBe(projectRoot);
    expect(opened.data.continuation).toEqual(
      (await cli('state', 'next', 'demo')).data.continuation,
    );
    const proposed = await cli(
      'state',
      'propose-design',
      'demo',
      '--proposal',
      'Preserve the API and use the adapter.',
    );
    expect(proposed.data.configuration.handoffContext).toEqual(expect.any(String));
    expect(proposed.data.continuation.mode).toBe('ask');
    expect(proposed.data.continuation.current.waits[0].proposal).toBeDefined();
    expect(proposed.data.continuation).toEqual(
      (await cli('state', 'next', 'demo')).data.continuation,
    );
    const decided = await cli(
      'state',
      'decide-design',
      'demo',
      '--proposal-hash',
      proposed.data.wait.proposalHash,
      '--choice',
      'approved',
    );
    expect(decided.data.continuation).toMatchObject({
      mode: 'execute',
      skill: 'comet-design',
      stepId: 'full.design.document',
    });
    expect(decided.next).toEqual({ command: '/comet-design' });
    expect(decided.data.continuation).toEqual(
      (await cli('state', 'next', 'demo')).data.continuation,
    );
    const resolved = await cli('workspace', 'resolve', 'demo');
    expect(resolved.data.continuation).toEqual(decided.data.continuation);
    expect(resolved.agent.workspace.cwd).toBe(projectRoot);

    const current = decided.data.continuation.current.actions[0];
    expect(current).not.toHaveProperty('input');
    expect(current.inputSummary).toMatchObject({
      usage: 'host-context-only',
      scope: { change: 'demo', changeDir: 'openspec/changes/demo' },
      configurationRef: 'data.configuration',
    });
    expect(
      decided.data.continuation.current.approvals.some(
        (approval: { proposalHash: string }) =>
          approval.proposalHash === proposed.data.wait.proposalHash,
      ),
    ).toBe(true);
    const detailed = await runClassicCli(
      decided.data.continuation.inspection.commandArgs.slice(1),
      undefined,
      { projectRoot, invocationCwd: projectRoot },
    );
    const original = JSON.parse(detailed.stdout!).data.run.actions.find(
      (action: { id: string }) => action.id === current.id,
    );
    expect(original.inputHash).toBe(current.inputHash);
    expect(original.input.input).toEqual(current.inputSummary.scope);
    const designRef = 'openspec/changes/demo/design.md';
    await fs.writeFile(
      path.join(projectRoot, designRef),
      '---\ncomet_change: demo\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\nUse the adapter and preserve the public API.\n',
    );
    const completed = await runClassicCli(
      decided.data.continuation.completion.commandArgs
        .slice(1)
        .map((argument: string) => (argument === '<design-doc-ref>' ? designRef : argument)),
      undefined,
      { projectRoot, invocationCwd: projectRoot },
    );
    expect(completed.exitCode, completed.stdout).toBe(0);
    const latest = JSON.parse(completed.stdout!);
    expect(latest.data.continuation.stepId).toBe('full.build.configure');
    expect(latest.data.configuration.designDoc).toBe(designRef);
  });

  it('waits on the original running claim and supplies a legal unknown recovery command', async () => {
    const { projectRoot, cli } = await fixture();
    const inspected = await inspectClassicSdkRun(projectRoot, 'demo');
    const action = inspected.run.actions.find((entry) => entry.status === 'pending')!;
    const running = await inspected.runtime.claim({
      runId: inspected.run.runId,
      expectedRevision: inspected.run.revision,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'original-host',
      claimToken: 'original-claim',
    });
    const waiting = await cli('state', 'next', 'demo');
    expect(waiting.agent.continuation).toMatchObject({ mode: 'wait', commandArgs: null });
    expect(waiting.agent.continuation.currentRef).toBe('data.continuation.current');
    expect(waiting.data.continuation.current.actions[0].claim.token).toBe('original-claim');
    expect((await inspectClassicSdkRun(projectRoot, 'demo')).run.revision).toBe(running.revision);
    await inspected.runtime.markUnknown({
      runId: running.runId,
      expectedRevision: running.revision,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Original executor disconnected',
    });
    const unknown = await cli('state', 'next', 'demo');
    expect(unknown.agent.continuation.mode).toBe('reconcile');
    const recovery = await runClassicCli(
      unknown.agent.continuation.commandArgs.slice(1),
      undefined,
      {
        projectRoot,
        invocationCwd: projectRoot,
      },
    );
    const result = JSON.parse(recovery.stdout!);
    expect(result.exitCode).toBe(1);
    expect(result.data.recovery.claim.token).toBe('original-claim');
    expect(result.agent.continuation).toMatchObject({ mode: 'reconcile', actionId: action.id });
    expect(result.data.recovery.recordOutcomeRequest).toBeUndefined();
  });

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
