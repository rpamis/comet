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

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(
  legacyDesign = false,
  profile: 'full' | 'tweak' = 'full',
  externalDesign = false,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic revised candidate '));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await prepareClassicLegacyProject(projectRoot);
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
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
  await put(`${change}/tasks.md`, '- [ ] Implement the adapter <!-- comet-task:impl -->\n');
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
    const projection = await fs.readFile(path.join(f.projectRoot, f.change, '.comet.yaml'), 'utf8');
    expect(projection).toContain('phase: design');
    await fs.rename(
      path.join(f.projectRoot, '.comet/runtime'),
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
    vi.stubEnv('COMET_OPENSPEC', path.resolve('node_modules/.bin/openspec'));
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
      await fs.readFile(path.join(f.projectRoot, archiveRef, '.comet.yaml'), 'utf8'),
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
    execFileSync('git', ['add', '--', 'openspec', f.plan], { cwd: f.projectRoot });
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
  }, 60_000);
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
