import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { randomUUID } from 'node:crypto';
import { writeClassicSdkDesignContext } from '../../../domains/comet-classic/classic-handoff.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { readPortableRunCheckpoint } from '../../../domains/engine/runtime.js';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import {
  executeClassicSdkArchive,
  recoverClassicSdkArchive,
} from '../../../domains/comet-classic/classic-sdk-archive.js';
import { executeClassicSdkArchivePreflight } from '../../../domains/comet-classic/classic-sdk-archive-preflight.js';
import { recordClassicArchiveRequirements } from '../../../domains/comet-classic/classic-artifact-requirements.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { createOpenSpecArchiveFixture } from '../../helpers/classic-openspec-fixture.js';
import { ensureCometProjectGitignore } from '../../../domains/workflow-contract/project-gitignore.js';
import { prepareClassicArchiveInputs } from '../../../domains/comet-classic/classic-sdk-archive-manifest.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(
  legacyDesign = false,
  profile: 'full' | 'tweak' | 'hotfix' = 'full',
  externalDesign = false,
  taskSource = '- [ ] Implement the adapter <!-- comet-task:impl -->\n',
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic revised candidate '));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await prepareClassicLegacyProject(projectRoot);
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  await ensureCometProjectGitignore(projectRoot);
  execFileSync('git', ['add', '--', '.gitignore'], { cwd: projectRoot, stdio: 'ignore' });
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
      'fixture',
    ],
    { cwd: projectRoot, stdio: 'ignore' },
  );
  const cli = async (...args: string[]) => {
    const result = await runClassicCli([args[0], '--json', ...args.slice(1)], undefined, {
      projectRoot,
      invocationCwd: projectRoot,
    });
    return JSON.parse(result.stdout!);
  };
  const ok = async (...args: string[]) => {
    const result = await cli(...args);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    return result.data;
  };
  const put = async (ref: string, text: string) => {
    await fs.mkdir(path.dirname(path.join(projectRoot, ref)), { recursive: true });
    await fs.writeFile(path.join(projectRoot, ref), text);
  };
  const change = 'openspec/changes/example';
  await ok('state', 'init', 'example', profile, '--isolation', 'current');
  await put(`${change}/proposal.md`, '# Proposal\nKeep the existing public API.\n');
  await put(`${change}/design.md`, '# Design\nUse the existing adapter.\n');
  await put(`${change}/tasks.md`, taskSource);
  const opened = await ok('guard', 'example', 'open');
  await ok('guard', 'example', 'open', '--apply', '--approval-hash', opened.approvalHash);
  if (profile !== 'full') {
    const escalation = await ok(
      'state',
      'propose-escalation',
      'example',
      '--reason',
      'The change now requires full Design approval.',
    );
    await ok(
      'state',
      'decide-escalation',
      'example',
      '--proposal-hash',
      escalation.wait.proposalHash,
      '--choice',
      'upgrade',
    );
  }
  const inspect = () => inspectClassicSdkRun(projectRoot, 'example');
  const design = async (proposal = 'Use the existing adapter.') => {
    let result;
    if (legacyDesign) {
      const { run, runtime } = await inspect();
      const action = run.actions.find(
        (candidate) => candidate.stepId === 'full.design.handoff' && candidate.status === 'pending',
      )!;
      const handoff = await writeClassicSdkDesignContext({
        projectRoot,
        changeDir: path.join(projectRoot, change),
        change: 'example',
        contextCompression: 'off',
      });
      const claimToken = randomUUID();
      const claimed = await runtime.claim({
        runId: run.runId,
        expectedRevision: run.revision,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'legacy-host',
        claimToken,
      });
      const submitted = await runtime.recordOutcome({
        runId: run.runId,
        expectedRevision: claimed.revision,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken,
          outcomeId: randomUUID(),
          status: 'succeeded',
          output: { proposal, ...handoff },
        },
        context: { requestId: 'legacy-proposal', projectRoot },
      });
      result = { wait: submitted.waits.at(-1)! };
    } else result = await ok('state', 'propose-design', 'example', '--proposal', proposal);
    await ok(
      'state',
      'decide-design',
      'example',
      '--proposal-hash',
      result.wait.proposalHash,
      '--choice',
      'approved',
    );
    return result.wait.proposalHash as string;
  };
  const designRef =
    legacyDesign || externalDesign
      ? 'docs/superpowers/specs/technical design.md'
      : `${change}/design.md`;
  const finishDesign = async (hash: string) => {
    await put(
      designRef,
      '---\ncomet_change: example\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\nUse the adapter and preserve the public API.\n',
    );
    return ok(
      'state',
      'complete-design',
      'example',
      '--design-doc',
      designRef,
      '--approval-hash',
      hash,
    );
  };
  const plan = 'docs/superpowers/plans/work plan.md';
  const prepareBuild = async () => {
    await finishDesign(await design());
    await put(
      'configuration.json',
      JSON.stringify({
        build_mode: 'executing-plans',
        tdd_mode: 'tdd',
        review_mode: 'standard',
        subagent_dispatch: null,
      }),
    );
    const proposed = await ok('state', 'propose-build', 'example', '--file', 'configuration.json');
    await ok(
      'state',
      'decide-build',
      'example',
      '--proposal-hash',
      proposed.wait.proposalHash,
      '--choice',
      'approved',
    );
    await put(
      plan,
      `<!-- comet-task-authority: ${change}/tasks.md -->\n# Plan\n<!-- comet-task-ref:impl -->\nImplement and validate.\n`,
    );
  };
  return { projectRoot, change, plan, put, cli, ok, inspect, design, finishDesign, prepareBuild };
}

describe('Classic candidate revisions', () => {
  it('stabilizes missing task IDs before Design approval and keeps later task scope protected', async () => {
    const f = await fixture(false, 'full', false, '- [ ] Implement the adapter\n');
    const proposal = await f.ok(
      'state',
      'propose-design',
      'example',
      '--proposal',
      'Use the existing adapter.',
    );
    const tasksFile = path.join(f.projectRoot, f.change, 'tasks.md');
    const assigned = await f.ok('state', 'tasks', 'example');
    expect(assigned.needsIds).toBe(false);
    expect(assigned.tasks[0]).toMatchObject({ text: 'Implement the adapter', completed: false });
    const taskId = assigned.tasks[0].id as string;
    expect(taskId).toBeTruthy();
    const source = await fs.readFile(tasksFile, 'utf8');
    const pending = (await f.inspect()).run;
    const repeated = await f.cli(
      'state',
      'propose-design',
      'example',
      '--proposal',
      'Use the existing adapter.',
    );
    expect(repeated.exitCode).not.toBe(0);
    expect((await f.inspect()).run).toEqual(pending);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await f.ok('state', 'tasks', 'example', '--assign-ids');
      expect(await fs.readFile(tasksFile, 'utf8')).toBe(source);
    }
    await f.ok(
      'state',
      'decide-design',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'approved',
    );
    await f.finishDesign(proposal.wait.proposalHash);
    await f.put(
      'configuration.json',
      JSON.stringify({
        build_mode: 'executing-plans',
        tdd_mode: 'tdd',
        review_mode: 'standard',
        subagent_dispatch: null,
      }),
    );
    await f.ok('state', 'propose-build', 'example', '--file', 'configuration.json', '--confirmed');
    await f.put(
      f.plan,
      `<!-- comet-task-authority: ${f.change}/tasks.md -->\n# Plan\n<!-- comet-task-ref:${taskId} -->\nImplement and validate.\n`,
    );
    const submitted = await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(submitted.nextAction.stepId).toBe('full.build.execute');
    const accepted = (await f.inspect()).run;
    await f.put(
      `${f.change}/tasks.md`,
      `- [ ] Replace the public API <!-- comet-task:${taskId} -->\n`,
    );
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(accepted.revision));
    const before = (await f.inspect()).run;
    const blocked = await f.cli('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('revise-design');
    expect((await f.inspect()).run).toEqual(before);
  });

  it('does not assign new task IDs through an already approved Design proposal', async () => {
    const f = await fixture(false, 'full', false, '- [ ] Implement the adapter\n');
    const hash = await f.design();
    const tasksFile = path.join(f.projectRoot, f.change, 'tasks.md');
    const source = (await fs.readFile(tasksFile, 'utf8')) + '- [ ] Add an unapproved capability\n';
    await fs.writeFile(tasksFile, source);
    const before = (await f.inspect()).run;
    const repeated = await f.cli(
      'state',
      'propose-design',
      'example',
      '--proposal',
      'Use the existing adapter.',
    );
    expect(repeated.exitCode).not.toBe(0);
    expect(await fs.readFile(tasksFile, 'utf8')).toBe(source);
    expect((await f.inspect()).run).toEqual(before);
    await f.put(
      `${f.change}/design.md`,
      '---\ncomet_change: example\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\nUse the existing adapter.\n',
    );
    const completed = await f.cli(
      'state',
      'complete-design',
      'example',
      '--design-doc',
      `${f.change}/design.md`,
      '--approval-hash',
      hash,
    );
    expect(completed.exitCode).not.toBe(0);
    expect(completed.stderr).toContain('revise-design');
  });

  it('rejects invalid Build semantics before claiming, then accepts a corrected proposal', async () => {
    const f = await fixture();
    await f.finishDesign(await f.design());
    const before = (await f.inspect()).run;
    await f.put(
      'configuration.json',
      JSON.stringify({
        build_mode: 'autonomous',
        tdd_mode: 'direct',
        review_mode: 'standard',
        subagent_dispatch: null,
        direct_override: true,
      }),
    );
    const invalid = await f.cli(
      'state',
      'propose-build',
      'example',
      '--file',
      'configuration.json',
    );
    expect(invalid.exitCode).not.toBe(0);
    expect(JSON.stringify(invalid)).toContain('direct_override');
    expect((await f.inspect()).run).toEqual(before);
    await f.put(
      'configuration.json',
      JSON.stringify({
        build_mode: 'autonomous',
        tdd_mode: 'direct',
        review_mode: 'standard',
        subagent_dispatch: null,
        direct_override: false,
      }),
    );
    const proposed = await f.ok(
      'state',
      'propose-build',
      'example',
      '--file',
      'configuration.json',
    );
    expect(proposed.wait.proposalHash).toEqual(expect.any(String));
  });

  it('repairs a rejected builtin Build proposal with its original claim and a new user decision', async () => {
    const f = await fixture();
    await f.finishDesign(await f.design());
    const { run, runtime } = await f.inspect();
    const action = run.actions.find((entry) => entry.stepId === 'full.build.configure')!;
    const claimToken = 'rejected-build-claim';
    const claimed = await runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-classic-state',
      claimToken,
    });
    const output = {
      buildMode: 'autonomous',
      tddMode: 'direct',
      reviewMode: 'standard',
      subagentDispatch: null,
      directOverride: true,
      isolation: 'current',
      boundBranch: 'main',
    };
    const outcome = {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken,
      outcomeId: 'rejected-build-outcome',
      status: 'succeeded' as const,
      output,
    };
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        expectedRevision: claimed.revision,
        outcome,
        context: { projectRoot: f.projectRoot, requestId: 'reject-build' },
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    const rejected = (await f.inspect()).run;
    const next = await f.ok('state', 'next', 'example');
    expect(next.continuation).toMatchObject({ mode: 'reconcile' });
    expect(next.continuation.commandArgs).toContain('propose-build');
    const recovery = await f.cli('state', 'check', 'example', 'build', '--recover');
    expect(recovery.exitCode).toBe(1);
    expect(JSON.stringify(recovery)).toContain('outcome-rejected');
    await f.put(
      'configuration.json',
      JSON.stringify({
        build_mode: 'autonomous',
        tdd_mode: 'direct',
        review_mode: 'standard',
        subagent_dispatch: null,
        direct_override: false,
      }),
    );
    expect(
      (
        await f.cli(
          'state',
          'propose-build',
          'example',
          '--file',
          'configuration.json',
          '--confirmed',
        )
      ).exitCode,
    ).not.toBe(0);
    expect((await f.inspect()).run).toEqual(rejected);
    expect(recovery.data.recovery.commandArgs).not.toContain('--project-root');
    expect(recovery.data.recovery.cwd).toBe(f.projectRoot);
    const roundtrip = await runClassicCli(
      recovery.data.recovery.commandArgs
        .slice(1)
        .map((argument: string) =>
          argument === '<configuration-json>' ? 'configuration.json' : argument,
        ),
      undefined,
      { invocationCwd: recovery.data.recovery.cwd },
    );
    expect(roundtrip.exitCode, roundtrip.stdout).toBe(0);
    const proposed = JSON.parse(roundtrip.stdout!).data;
    const repaired = (await f.inspect()).run;
    const repairedAction = repaired.actions.find((entry) => entry.id === action.id)!;
    expect(repairedAction).toMatchObject({
      status: 'succeeded',
      attempt: action.attempt,
      inputHash: action.inputHash,
      claim: { token: claimToken },
      rejectedOutcomes: [{ outcome }],
    });
    expect(repairedAction.outcome?.outcomeId).not.toBe(outcome.outcomeId);
    expect(repaired.waits.at(-1)).toMatchObject({
      status: 'pending',
      proposalHash: proposed.wait.proposalHash,
    });
    // 旧 revision 的并发回传不能覆盖修正后的提案。
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        expectedRevision: rejected.revision,
        outcome: {
          ...outcome,
          outcomeId: 'stale-build-outcome',
          output: { ...output, directOverride: false },
        },
        context: { projectRoot: f.projectRoot, requestId: 'stale-build' },
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(
      (await f.cli('state', 'propose-build', 'example', '--file', 'configuration.json')).exitCode,
    ).not.toBe(0);
    expect((await f.inspect()).run).toEqual(repaired);
    await f.ok(
      'state',
      'decide-build',
      'example',
      '--proposal-hash',
      proposed.wait.proposalHash,
      '--choice',
      'approved',
    );
    const approved = (await f.inspect()).run;
    expect(
      (await f.cli('state', 'propose-build', 'example', '--file', 'configuration.json')).exitCode,
    ).not.toBe(0);
    expect((await f.inspect()).run).toEqual(approved);
  });

  it.each(['comet-classic-state', 'external-executor'])(
    'does not take over an unreturned Build claim (%s)',
    async (executorId) => {
      const f = await fixture();
      await f.finishDesign(await f.design());
      const { run, runtime } = await f.inspect();
      const action = run.actions.find((entry) => entry.stepId === 'full.build.configure')!;
      const claimed = await runtime.claim({
        runId: run.runId,
        expectedRevision: run.revision,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId,
        claimToken: 'running-build-claim',
      });
      await f.put(
        'configuration.json',
        JSON.stringify({
          build_mode: 'autonomous',
          tdd_mode: 'direct',
          review_mode: 'standard',
          subagent_dispatch: null,
        }),
      );
      expect(
        (await f.cli('state', 'propose-build', 'example', '--file', 'configuration.json')).exitCode,
      ).not.toBe(0);
      expect((await f.inspect()).run).toEqual(claimed);
    },
  );

  it('allows the approved Design document to grow in place and retains Open approval history', async () => {
    const f = await fixture();
    const before = (await f.inspect()).run;
    const hash = await f.design();
    await f.finishDesign(hash);
    const after = (await f.inspect()).run;
    expect(after.state).toMatchObject({ phase: 'build', designDoc: `${f.change}/design.md` });
    expect(after.outputs['full.open.evidence']).toEqual(before.outputs['full.open.evidence']);
    expect(after.workflow).toEqual(before.workflow);
  });

  it('reproposes changed requirements atomically, rejects old decisions, and resumes the known old builtin Run', async () => {
    const f = await fixture();
    const hash = await f.design();
    const before = (await f.inspect()).run;
    await f.put(
      `${f.change}/tasks.md`,
      '- [ ] Implement the revised adapter <!-- comet-task:impl -->\n',
    );
    const blocked = await f.cli(
      'state',
      'complete-design',
      'example',
      '--design-doc',
      `${f.change}/design.md`,
      '--approval-hash',
      hash,
    );
    expect(blocked.exitCode).not.toBe(0);
    const checked = await f.cli('state', 'check', 'example', 'design', '--recover');
    expect(checked.exitCode).not.toBe(0);
    expect(checked.data.recoveryActions[0].commandArgs).toContain('revise-design');
    const revised = await f.ok(
      'state',
      'revise-design',
      'example',
      '--expected-revision',
      String(before.revision),
    );
    expect(revised.nextAction.stepId).toBe('full.design.handoff');
    const after = (await f.inspect()).run;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.workflow.hash).not.toBe(before.workflow.hash);
    expect(after.waits).toEqual(before.waits);
    expect(after.actions.slice(0, -1).filter((a) => a.status === 'succeeded')).toEqual(
      before.actions.filter((a) => a.status === 'succeeded'),
    );
    await f.ok('state', 'revise-design', 'example', '--expected-revision', String(before.revision));
    expect((await f.inspect()).run).toEqual(after);
    const stale = await f.cli(
      'state',
      'revise-design',
      'example',
      '--expected-revision',
      String(before.revision - 1),
    );
    expect(stale.exitCode).not.toBe(0);
    const proposal = await f.ok(
      'state',
      'propose-design',
      'example',
      '--proposal',
      'Implement the revised adapter.',
    );
    expect(proposal.wait.proposalHash).not.toBe(hash);
    const oldDecision = await f.cli(
      'state',
      'decide-design',
      'example',
      '--proposal-hash',
      hash,
      '--choice',
      'approved',
    );
    expect(oldDecision.exitCode).not.toBe(0);
    await f.ok(
      'state',
      'decide-design',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'approved',
    );
    await f.finishDesign(proposal.wait.proposalHash);
    const current = (await f.inspect()).run;
    const request = path.join(f.projectRoot, 'inspect.json');
    await fs.writeFile(request, JSON.stringify({ operation: 'inspect', runId: 'example' }));
    const dispatch = await runtimeDispatchCommand(
      { request, application: 'classic-full', projectRoot: f.projectRoot },
      { invocationCwd: f.projectRoot },
    );
    expect(dispatch.response).toMatchObject({
      status: 'succeeded',
      data: { revision: current.revision, workflow: current.workflow },
    });
  });

  it.each([false, true])(
    'revises a plan from execute or plan-ready (pause=%s), binding the new candidate and rejecting stale handles',
    async (pause) => {
      const f = await fixture();
      await f.prepareBuild();
      await f.ok(
        'state',
        'submit-plan',
        'example',
        '--plan',
        f.plan,
        ...(pause ? ['--pause'] : []),
      );
      const before = (await f.inspect()).run;
      const oldWait = before.waits.at(-1)!;
      const oldAction = before.actions.find((a) => a.status === 'pending');
      await fs.appendFile(
        path.join(f.projectRoot, f.plan),
        'Clarify the existing validation command.\n',
      );
      const drift = await f.cli('state', 'check', 'example', 'build', '--recover');
      expect(drift.exitCode).not.toBe(0);
      expect(drift.data.recoveryActions[0].commandArgs).toContain('revise-plan');
      await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
      const revised = (await f.inspect()).run;
      expect(revised.state).toEqual(before.state);
      if (oldAction) {
        const { runtime } = await f.inspect();
        await expect(
          runtime.claim({
            runId: revised.runId,
            expectedRevision: revised.revision,
            actionId: oldAction.id,
            attempt: oldAction.attempt,
            inputHash: oldAction.inputHash,
            executorId: 'test',
          }),
        ).rejects.toThrow();
      }
      await f.ok(
        'state',
        'submit-plan',
        'example',
        '--plan',
        f.plan,
        ...(pause ? ['--pause'] : []),
      );
      if (pause) {
        const current = (await f.inspect()).run.waits.at(-1)!;
        expect(current.proposalHash).not.toBe(oldWait.proposalHash);
        const stale = await f.cli(
          'state',
          'continue-plan',
          'example',
          '--proposal-hash',
          oldWait.proposalHash,
        );
        expect(stale.exitCode).not.toBe(0);
        await f.ok('state', 'continue-plan', 'example', '--proposal-hash', current.proposalHash);
      }
      await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
      await f.ok('state', 'complete-build', 'example');
    },
  );

  it('routes task scope changes through a fresh Design approval while preserving configured Build and task IDs', async () => {
    const f = await fixture();
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const before = (await f.inspect()).run;
    await f.put(
      `${f.change}/tasks.md`,
      '- [x] Implement the adapter <!-- comet-task:impl -->\n- [ ] Add a new capability <!-- comet-task:extra -->\n',
    );
    await fs.appendFile(path.join(f.projectRoot, f.plan), '<!-- comet-task-ref:extra -->\n');
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
    const blocked = await f.cli('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('revise-design');
    const current = (await f.inspect()).run;
    const revised = await f.ok(
      'state',
      'revise-design',
      'example',
      '--expected-revision',
      String(current.revision),
    );
    expect(revised).toMatchObject({
      phase: 'design',
      nextAction: { stepId: 'full.design.handoff', ref: 'comet-design' },
    });
    for (const args of [
      ['next', 'example'],
      ['select', 'example'],
      ['check', 'example', 'design'],
      ['check', 'example', 'design', '--recover'],
    ]) {
      const entry = await f.ok('state', ...args);
      expect(entry.phase).toBe('design');
      expect(entry.nextAction).toEqual(revised.nextAction);
    }
    expect((await f.cli('state', 'check', 'example', 'build')).exitCode).not.toBe(0);
    const projection = await fs.readFile(
      path.join(f.projectRoot, f.change, 'comet-state.yaml'),
      'utf8',
    );
    expect(projection).toContain('phase: design');
    await fs.rename(
      resolveWorkspaceRuntimeRootSync(f.projectRoot),
      path.join(f.projectRoot, '.comet/runtime-before-recovery'),
    );
    const recovered = await f.ok('state', 'next', 'example');
    expect(recovered.phase).toBe('design');
    expect(recovered.run.revision).toBe(revised.run.revision);
    expect(recovered.nextAction).toEqual(revised.nextAction);
    await f.ok('state', 'check', 'example', 'design');
    const hash = await f.design('Preserve the implemented adapter and approve the new capability.');
    const completed = await f.finishDesign(hash);
    expect(completed.nextAction.stepId).toBe('full.build.plan');
    const reapproved = (await f.inspect()).run;
    expect(reapproved.state).toMatchObject({
      phase: 'build',
      buildMode: 'executing-plans',
      tddMode: 'tdd',
      reviewMode: 'standard',
    });
    expect(reapproved.waits.filter((wait) => wait.stepId === 'full.build.confirm')).toEqual(
      before.waits.filter((wait) => wait.stepId === 'full.build.confirm'),
    );
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(await fs.readFile(path.join(f.projectRoot, f.change, 'tasks.md'), 'utf8')).toContain(
      '- [x] Implement the adapter <!-- comet-task:impl -->',
    );
  });
  it('requires new Design approval for changed legacy requirements and never accepts a forged definition hash', async () => {
    const f = await fixture(true);
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const before = (await f.inspect()).run;
    expect(before.outputs['full.design.handoff'].value).not.toHaveProperty('requirementsEvidence');
    await f.put(`${f.change}/tasks.md`, '- [ ] Replace the public API <!-- comet-task:impl -->\n');
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
    const blocked = await f.cli('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('revise-design');
    const { createClassicSdkStateStore } =
      await import('../../../domains/comet-classic/classic-sdk-state-store.js');
    const store = createClassicSdkStateStore(f.projectRoot);
    const current = (await f.inspect()).run;
    const forged = structuredClone(current);
    forged.revision += 1;
    forged.workflow.hash = 'a'.repeat(64);
    forged.definitionHashes[JSON.stringify([forged.workflow.id, forged.workflow.version])] =
      forged.workflow.hash;
    await store.compareAndSwap(current.runId, current.revision, forged);
    await expect(f.inspect()).rejects.toThrow(/definition|定义|hash/u);
  });

  it('rejects competing stale revisions and leaves a claimed Action untouched', async () => {
    const f = await fixture();
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const { run, runtime } = await f.inspect();
    const action = run.actions.find((candidate) => candidate.status === 'pending')!;
    const claimed = await runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'paused-worker',
    });
    const blocked = await f.cli(
      'state',
      'revise-plan',
      'example',
      '--expected-revision',
      String(claimed.revision),
    );
    expect(blocked.exitCode).not.toBe(0);
    expect((await f.inspect()).run).toEqual(claimed);
  });
  it('preserves archive references after revised-plan delivery', async () => {
    const f = await fixture();
    const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
    vi.stubEnv('COMET_OPENSPEC', openSpec.command);
    vi.stubEnv('OPENSPEC_TELEMETRY', '0');
    vi.stubEnv('DO_NOT_TRACK', '1');
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const before = (await f.inspect()).run;
    await fs.appendFile(
      path.join(f.projectRoot, f.plan),
      'Clarify validation without changing scope.\n',
    );
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const planned = (await f.inspect()).run;
    const { classicDesignEvidenceReceipt } =
      await import('../../../domains/comet-classic/classic-sdk-application.js');
    expect(planned.outputs['full.build.plan'].value).toMatchObject({
      designEvidence: await classicDesignEvidenceReceipt(f.projectRoot, `${f.change}/design.md`),
    });
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    execFileSync(
      'git',
      ['add', '--', 'openspec', 'docs', 'configuration.json', '.comet/config.yaml'],
      { cwd: f.projectRoot },
    );
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'implementation',
      ],
      { cwd: f.projectRoot, stdio: 'ignore' },
    );
    await f.ok(
      'guard',
      'example',
      'build',
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const report = 'docs/superpowers/reports/verify.md';
    await f.put(report, '# Verification\nAll current behavior checks pass.\n');
    await f.ok(
      'guard',
      'example',
      'verify',
      '--report',
      report,
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const proposal = await f.ok(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Archive the implemented adapter locally.',
    );
    await f.ok(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    await f.ok('guard', 'example', 'archive', '--apply');
    expect(await openSpec.invocations()).toEqual([
      { args: ['archive', 'example', '--yes'], cwd: await fs.realpath(f.projectRoot) },
    ]);
    const archived = (await f.inspect()).run;
    const archiveRef = (
      archived.outputs['full.archive.execute'].value as { archiveDirectory: string }
    ).archiveDirectory;
    expect(archived.state).toMatchObject({
      designDoc: `${archiveRef}/design.md`,
      handoffContext: `${archiveRef}/.comet/handoff/design-context.json`,
      plan: f.plan,
      verificationReport: report,
    });
    const projected = parseYaml(
      await fs.readFile(path.join(f.projectRoot, archiveRef, 'comet-state.yaml'), 'utf8'),
    );
    expect(projected.design_doc).toBe(`${archiveRef}/design.md`);
    expect(projected.handoff_context).toBe(`${archiveRef}/.comet/handoff/design-context.json`);
    expect(projected.plan).toBe(f.plan);
    expect(projected.verification_report).toBe(report);
    expect(readPortableRunCheckpoint(projected.run_checkpoint, 'example')?.state).toMatchObject({
      designDoc: `${archiveRef}/design.md`,
    });
    expect(archived.outputs['full.design.document'].value).toMatchObject({
      designDoc: `${f.change}/design.md`,
    });
    const source = await fs.readFile(path.join(f.projectRoot, archiveRef, 'design.md'), 'utf8');
    expect(source).toContain('status: final');
    expect(source).toContain(`archived-with: ${path.posix.basename(archiveRef)}`);
    execFileSync('git', ['add', '--', 'openspec', f.plan, report], { cwd: f.projectRoot });
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'archive'],
      { cwd: f.projectRoot, stdio: 'ignore' },
    );
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: f.projectRoot,
      encoding: 'utf8',
    }).trim();
    const delivered = await f.ok('state', 'complete-delivery', 'example', '--commit', commit);
    expect(delivered.nextAction.kind).toBe('done');
  });
  it('rejects Design document drift after plan acceptance and reports the legal reapproval command', async () => {
    const f = await fixture();
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const before = (await f.inspect()).run;
    await fs.appendFile(
      path.join(f.projectRoot, f.change, 'design.md'),
      'Change the chosen architecture.\n',
    );
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    const complete = await f.cli('state', 'complete-build', 'example');
    expect(complete.exitCode).not.toBe(0);
    expect(complete.stderr).toContain('revise-design');
    expect((await f.inspect()).run).toEqual(before);
    const recovery = await f.cli('state', 'check', 'example', 'build', '--recover');
    expect(recovery.exitCode).not.toBe(0);
    expect(recovery.data.recoveryActions[0].commandArgs).toContain('revise-design');
  });
  it('keeps the original builtin identity when revising a preset already upgraded to Full', async () => {
    const f = await fixture(false, 'tweak');
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const before = (await f.inspect()).run;
    expect(before.workflow.id).toBe('comet-classic-tweak');
    await fs.appendFile(
      path.join(f.projectRoot, f.plan),
      'Clarify the current implementation detail.\n',
    );
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const after = (await f.inspect()).run;
    expect(after.workflow.id).toBe(before.workflow.id);
    expect(after.state).toMatchObject({ workflow: 'full', phase: 'build' });
    expect(after.actions.at(-1)).toMatchObject({ stepId: 'full.build.execute', status: 'pending' });
  });
  it('keeps canonical design.md immutable when completing an external Design document', async () => {
    const f = await fixture(false, 'full', true);
    const hash = await f.design();
    await fs.appendFile(
      path.join(f.projectRoot, f.change, 'design.md'),
      'Unapproved source change.\n',
    );
    const external = 'docs/superpowers/specs/technical design.md';
    await f.put(
      external,
      '---\ncomet_change: example\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\nKeep the approved adapter.\n',
    );
    const before = (await f.inspect()).run;
    const blocked = await f.cli(
      'state',
      'complete-design',
      'example',
      '--design-doc',
      external,
      '--approval-hash',
      hash,
    );
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('revise-design');
    expect((await f.inspect()).run).toEqual(before);
  });

  it('rejects canonical source drift in Build when the accepted Design document is external', async () => {
    const f = await fixture(false, 'full', true);
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    await fs.appendFile(
      path.join(f.projectRoot, f.change, 'design.md'),
      'Unapproved source change.\n',
    );
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    const before = (await f.inspect()).run;
    const blocked = await f.cli('state', 'complete-build', 'example');
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('requirements changed after approval');
    expect((await f.inspect()).run).toEqual(before);
    const recovery = await f.cli('state', 'check', 'example', 'build', '--recover');
    expect(recovery.data.recoveryActions[0].commandArgs).toContain('revise-design');
  });
});

describe('Classic upgraded preset archive recovery', () => {
  it.each([
    ['tweak', 'running'],
    ['tweak', 'unknown'],
    ['hotfix', 'running'],
    ['hotfix', 'unknown'],
  ] as const)('recovers %s after a moved %s Archive on cold start', async (profile, status) => {
    const f = await fixture(false, profile);
    const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
    await fs.appendFile(
      openSpec.command,
      "\nprocess.stderr.write('injected disconnect after move'); process.exit(1);\n",
    );
    vi.stubEnv('COMET_OPENSPEC', openSpec.command);
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    await f.ok(
      'guard',
      'example',
      'build',
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const report = 'docs/superpowers/reports/verify.md';
    await f.put(report, '# Verification\nAll current behavior checks pass.\n');
    await f.ok(
      'guard',
      'example',
      'verify',
      '--report',
      report,
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const proposal = await f.ok(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Archive locally.',
    );
    await f.ok(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    const { runtime, run } = await f.inspect();
    const preflighted = await executeClassicSdkArchivePreflight(runtime, {
      runId: run.runId,
      projectRoot: f.projectRoot,
    });
    if (status === 'unknown') {
      await expect(
        executeClassicSdkArchive(runtime, { runId: run.runId, projectRoot: f.projectRoot }),
      ).rejects.toThrow('injected disconnect');
    } else {
      const action = preflighted.actions.at(-1)!;
      expect(action.stepId).toBe('full.archive.execute');
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'comet-classic-archive',
        claimToken: randomUUID(),
      });
      const active = path.join(f.projectRoot, f.change);
      await recordClassicArchiveRequirements(f.projectRoot, active);
      // 模拟真实归档边界：先保存原执行输入，再发生外部目录搬迁。
      await prepareClassicArchiveInputs(
        f.projectRoot,
        claimed,
        claimed.actions.at(-1)!,
        'openspec/specs',
      );
      await fs.rename(active, path.join(path.dirname(active), 'archive', '2026-10-20-example'));
    }
    const cold = await f.inspect();
    expect(cold.profile).toBe('full');
    expect(cold.run.workflow.id).toBe(`comet-classic-${profile}`);
    expect(cold.state).toMatchObject({ workflow: 'full', phase: 'archive', archived: false });
    expect(cold.run.actions.at(-1)).toMatchObject({ stepId: 'full.archive.execute', status });
    expect((await f.ok('state', 'next', 'example')).nextAction).toMatchObject({
      kind: 'reconcile',
      stepId: 'full.archive.execute',
    });

    if (status === 'running') {
      // 原领取方可能仍在运行，目录搬迁不能代替停止或丢失执行上下文的证据。
      const blocked = await f.cli('archive', 'example', '--recover');
      expect(blocked.exitCode).not.toBe(0);
      expect(blocked.stderr).toContain('markUnknownRequest');
      expect((await f.ok('state', 'next', 'example')).continuation.commandArgs).toEqual([
        'comet',
        'state',
        'check',
        'example',
        'archive',
        '--recover',
        '--json',
      ]);
      expect((await f.inspect()).run.actions.at(-1)?.status).toBe('running');
      const diagnosis = await f.cli('state', 'check', 'example', 'archive', '--recover');
      const request = path.join(f.projectRoot, 'archive-reconciliation.json');
      expect(diagnosis.data.recovery.markUnknownRequest.operation).toBe('mark-unknown');
      await fs.writeFile(request, JSON.stringify(diagnosis.data.recovery.markUnknownRequest));
      const dispatch = await runtimeDispatchCommand(
        { request, application: `classic-${profile}`, projectRoot: f.projectRoot },
        { invocationCwd: f.projectRoot },
      );
      expect(dispatch.response.status).toBe('succeeded');
      expect((await f.inspect()).run.actions.at(-1)?.status).toBe('unknown');
    }

    if (profile === 'tweak' && status === 'unknown') {
      for (const corruption of ['claim', 'attempt', 'executor'] as const) {
        const forged = structuredClone(cold.run);
        const action = forged.actions.at(-1)!;
        if (corruption === 'claim') action.claim!.token = 'unrelated-claim';
        else if (corruption === 'attempt') action.attempt++;
        else action.claim!.executorId = 'unrelated-executor';
        const recordOutcome = vi.fn();
        await expect(
          recoverClassicSdkArchive(
            { inspect: async () => forged, recordOutcome },
            { projectRoot: f.projectRoot, runId: forged.runId },
          ),
        ).rejects.toThrow(/does not match|no single moved Action/u);
        expect(recordOutcome).not.toHaveBeenCalled();
      }
      const store = createClassicSdkStateStore(f.projectRoot);
      for (const corruption of ['choice', 'unresolved'] as const) {
        const current = (await f.inspect()).run;
        const forged = structuredClone(current);
        forged.revision++;
        const wait = forged.waits.find(
          (entry) => entry.stepId === 'tweak.build.escalation-confirm',
        )!;
        if (corruption === 'choice') wait.decision!.choice = 'continue';
        else {
          wait.status = 'cancelled';
          delete wait.decision;
        }
        expect(await store.compareAndSwap(current.runId, current.revision, forged)).toBe(true);
        await expect(f.inspect()).rejects.toThrow('does not match its change ownership');
        expect((await f.cli('archive', 'example', '--recover')).exitCode).not.toBe(0);
        expect(
          await store.compareAndSwap(current.runId, forged.revision, {
            ...current,
            revision: forged.revision + 1,
          }),
        ).toBe(true);
      }
    }

    if (profile === 'hotfix') {
      const originalRuntime = path.join(f.projectRoot, '.comet/runtime-before-moved-restore');
      await fs.rename(resolveWorkspaceRuntimeRootSync(f.projectRoot), originalRuntime);
      await f.ok('state', 'next', 'example');
      expect((await f.inspect()).run.actions.at(-1)?.status).toBe('unknown');
      // 便携检查点不能补造外部执行前的文件快照，必须带回原设备保存的收据。
      const missing = await f.cli('archive', 'example', '--recover');
      expect(missing.exitCode).not.toBe(0);
      expect(missing.stderr).toContain('缺少原始执行清单');
      await fs.cp(
        path.join(originalRuntime, 'archive-inputs'),
        path.join(resolveWorkspaceRuntimeRootSync(f.projectRoot), 'archive-inputs'),
        { recursive: true },
      );
    }
    expect((await f.ok('state', 'next', 'example')).continuation.commandArgs).toEqual([
      'comet',
      'archive',
      'example',
      '--recover',
      '--json',
    ]);
    const recovery = await f.ok('archive', 'example', '--recover');
    expect(recovery.recoveredAction).toBe(cold.run.actions.at(-1)!.id);
    const recovered = await f.inspect();
    expect(recovered.state.archived).toBe(true);
    expect(recovered.run.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.deliver',
      status: 'pending',
    });
    if (status === 'unknown') expect(await openSpec.invocations()).toHaveLength(1);
    await fs.rename(
      resolveWorkspaceRuntimeRootSync(f.projectRoot),
      path.join(f.projectRoot, '.comet/runtime-before-archive-restore'),
    );
    await f.ok('state', 'next', 'example');
    const restored = await f.inspect();
    expect(restored.profile).toBe('full');
    expect(restored.state.archived).toBe(true);
    expect(restored.run.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.deliver',
      status: 'pending',
    });
  });
});
