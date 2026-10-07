import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { executeClassicSdkCommandCheck } from '../../../domains/comet-classic/classic-sdk-check.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { classicVerificationReportReceipt } from '../../../domains/comet-classic/classic-verification-report.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(profile: 'full' | 'tweak' | 'hotfix') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic verify rounds '));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await prepareClassicLegacyProject(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'source.js'), 'export const ready = true;\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: projectRoot });
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'],
    { cwd: projectRoot, stdio: 'ignore' },
  );
  const invoke = async (...args: string[]) => {
    const separator = args.indexOf('--');
    args.splice(separator < 0 ? args.length : separator, 0, '--json');
    const result = await runClassicCli(args, undefined, { invocationCwd: projectRoot });
    return { ...result, response: JSON.parse(result.stdout ?? '{}') };
  };
  const cli = async (...args: string[]) => {
    const result = await invoke(...args);
    expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
    return result.response.data;
  };
  const put = async (ref: string, text: string) => {
    await fs.mkdir(path.dirname(path.join(projectRoot, ref)), { recursive: true });
    await fs.writeFile(path.join(projectRoot, ref), text);
  };
  await cli('state', 'init', 'example', profile, '--isolation', 'current');
  const changeDir = 'openspec/changes/example';
  await put(`${changeDir}/proposal.md`, '# Proposal\nCorrect the ready constant.\n');
  await put(`${changeDir}/design.md`, '# Design\nKeep the existing public API.\n');
  await put(`${changeDir}/tasks.md`, '- [x] Implement the change <!-- comet-task:impl -->\n');
  const open = await cli('guard', 'example', 'open');
  await cli('guard', 'example', 'open', '--apply', '--approval-hash', open.approvalHash);
  const planRef = 'docs/superpowers/plans/work plan.md';
  if (profile === 'full') {
    const design = await cli(
      'state',
      'propose-design',
      'example',
      '--proposal',
      'Keep the existing public API.',
    );
    await cli(
      'state',
      'decide-design',
      'example',
      '--proposal-hash',
      design.wait.proposalHash,
      '--choice',
      'approved',
    );
    const designRef = 'docs/superpowers/specs/technical design.md';
    await put(
      designRef,
      '---\ncomet_change: example\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\nKeep the existing public API.\n',
    );
    await cli(
      'state',
      'complete-design',
      'example',
      '--design-doc',
      designRef,
      '--approval-hash',
      design.wait.proposalHash,
    );
    await put(
      'build configuration.json',
      JSON.stringify({
        build_mode: 'executing-plans',
        tdd_mode: 'tdd',
        review_mode: 'standard',
        subagent_dispatch: null,
      }),
    );
    const build = await cli(
      'state',
      'propose-build',
      'example',
      '--file',
      'build configuration.json',
    );
    await cli(
      'state',
      'decide-build',
      'example',
      '--proposal-hash',
      build.wait.proposalHash,
      '--choice',
      'approved',
    );
    await put(
      planRef,
      `<!-- comet-task-authority: ${changeDir}/tasks.md -->\n# Plan\n<!-- comet-task-ref:impl -->\nCheck the ready constant.\n`,
    );
    await cli('state', 'submit-plan', 'example', '--plan', planRef);
  }
  const checkCount = path.join(root, 'checks');
  const command = (label: string, exitCode = 0) => [
    process.execPath,
    '-e',
    `require('node:fs').appendFileSync(${JSON.stringify(checkCount)}, ${JSON.stringify(`${label}\n`)}); process.exit(${exitCode})`,
  ];
  const build = () => cli('guard', 'example', 'build', '--apply', '--', ...command('build'));
  await build();
  const reportRef = 'docs/superpowers/reports/final verify.md';
  const reportText = '# Verification\nFirst candidate assessment.\n';
  await put(reportRef, reportText);
  const verify = (ref = reportRef, exitCode = 0) =>
    invoke(
      'guard',
      'example',
      'verify',
      '--report',
      ref,
      '--apply',
      '--',
      ...command('verify', exitCode),
    );
  const inspect = () => inspectClassicSdkRun(projectRoot, 'example');
  const acceptReport = async (ref = reportRef) => {
    const { runtime, run } = await inspect();
    const action = run.actions.find(
      (candidate) => candidate.stepId === `${profile}.verify.run` && candidate.status === 'pending',
    )!;
    const claimToken = randomUUID();
    const claimed = await runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'verify-round-test',
      claimToken,
    });
    const reported = await runtime.recordOutcome({
      runId: run.runId,
      expectedRevision: claimed.revision,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output: { event: 'verification-ready', verificationReport: ref },
      },
      context: { requestId: randomUUID(), projectRoot },
    });
    const wait = reported.evidenceWaits!.find(
      (candidate) =>
        candidate.stepId === `${profile}.verify.report.evidence` && candidate.status === 'pending',
    )!;
    const receipt = await classicVerificationReportReceipt(projectRoot, ref, 'en');
    await cli('guard', 'example', 'verify', '--report', ref);
    return runtime.recordEvidence({
      runId: reported.runId,
      expectedRevision: reported.revision,
      evidenceId: wait.id,
      kind: wait.kind,
      ...receipt,
      submissionId: randomUUID(),
      context: { requestId: randomUUID(), projectRoot },
    });
  };
  return {
    projectRoot,
    profile,
    cli,
    invoke,
    put,
    build,
    verify,
    inspect,
    acceptReport,
    command,
    checkCount,
    planRef,
    reportRef,
    reportText,
  };
}

describe.each(['full', 'tweak', 'hotfix'] as const)('Classic SDK %s Verify rounds', (profile) => {
  it('reports the current continuation after failure and accepts a revised report after Build repair', async () => {
    const f = await fixture(profile);
    const failed = await f.verify(f.reportRef, 7);
    expect(failed.exitCode).not.toBe(0);
    const next = await f.cli('state', 'next', 'example');
    const failedRun = (await f.inspect()).run;
    const previousReport = failedRun.evidenceWaits!.find(
      (wait) => wait.stepId === `${profile}.verify.report.evidence`,
    )!;
    const previousCheck = failedRun.actions.find(
      (action) => action.stepId === `${profile}.verify.check`,
    )!;
    expect(previousCheck).toMatchObject({ status: 'failed', outcome: { output: { exitCode: 7 } } });
    expect(failed.response.data).toMatchObject(previousCheck.outcome!.output);
    if (profile === 'full') await f.cli('state', 'submit-plan', 'example', '--plan', f.planRef);
    await f.build();
    await f.put(
      f.reportRef,
      '# Verification\nRepaired candidate passes the previously failing case.\n',
    );
    const succeeded = await f.verify();
    expect(succeeded.exitCode, succeeded.stdout).toBe(0);
    expect(succeeded.response.data.phase).toBe('archive');
    const repaired = (await f.inspect()).run;
    expect(failed.response.data).toMatchObject({
      phase: 'build',
      run: { id: next.run.id, revision: next.run.revision, status: next.run.status },
      nextAction: next.nextAction,
    });
    expect(failed.response.agent.continuation).toMatchObject(next.nextAction);
    expect(repaired.runId).toBe(failedRun.runId);
    expect(repaired.evidenceWaits!.find((wait) => wait.id === previousReport.id)).toEqual(
      previousReport,
    );
    expect(repaired.actions.find((action) => action.id === previousCheck.id)).toEqual(
      previousCheck,
    );
    expect(
      repaired.evidenceWaits!.filter((wait) => wait.stepId === `${profile}.verify.report.evidence`),
    ).toHaveLength(2);
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('build\nverify\nbuild\nverify\n');
  });

  it('accepts a new report path after Archive reverify and rejects the old check receipt', async () => {
    const f = await fixture(profile);
    const verified = await f.verify();
    expect(verified.exitCode, verified.stdout).toBe(0);
    const firstRun = (await f.inspect()).run;
    const oldCheck = firstRun.actions.find(
      (action) => action.stepId === `${profile}.verify.check`,
    )!;
    const oldOutput = oldCheck.outcome!.output as { receiptRef: string; contentHash: string };
    const proposed = await f.cli(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Review the report again',
    );
    await f.cli(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposed.wait.proposalHash,
      '--choice',
      'reverify',
    );
    const reportRef = 'docs/superpowers/reports/revised verify.md';
    await f.put(reportRef, '# Verification\nSecond candidate assessment with updated coverage.\n');
    const preview = await f.invoke('guard', 'example', 'verify', '--report', reportRef);
    expect(preview.exitCode, preview.stdout).toBe(0);
    await f.acceptReport(reportRef);
    const { runtime, run } = await f.inspect();
    const checked = await executeClassicSdkCommandCheck(runtime, {
      runId: run.runId,
      projectRoot: f.projectRoot,
      argv: f.command('verify'),
    });
    const wait = checked.evidenceWaits!.find(
      (candidate) =>
        candidate.stepId === `${profile}.verify.check.evidence` && candidate.status === 'pending',
    )!;
    await expect(
      runtime.recordEvidence({
        runId: run.runId,
        expectedRevision: checked.revision,
        evidenceId: wait.id,
        kind: wait.kind,
        ref: oldOutput.receiptRef,
        contentHash: oldOutput.contentHash,
        submissionId: randomUUID(),
        context: { requestId: randomUUID(), projectRoot: f.projectRoot },
      }),
    ).rejects.toThrow('EVIDENCE_REJECTED');
    const resumed = await f.verify(reportRef);
    expect(resumed.exitCode, resumed.stdout).toBe(0);
    expect(resumed.response.data.phase).toBe('archive');
    const final = (await f.inspect()).run;
    expect(final.actions.find((action) => action.id === oldCheck.id)).toEqual(oldCheck);
    expect(
      final.actions.filter((action) => action.stepId === `${profile}.verify.check`),
    ).toHaveLength(2);
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('build\nverify\nverify\n');
  });

  it('blocks same-round report drift before and after the check, then resumes without executing it twice', async () => {
    const f = await fixture(profile);
    await f.acceptReport();
    const before = (await f.inspect()).run;
    const differentReport = 'docs/superpowers/reports/different verify.md';
    await f.put(differentReport, f.reportText);
    const changedRef = await f.verify(differentReport);
    expect(changedRef.exitCode).not.toBe(0);
    expect(changedRef.stdout).toContain('report does not match the current Run');
    expect((await f.inspect()).run).toEqual(before);
    await f.put(f.reportRef, '# Verification\nChanged after accepted evidence.\n');
    const drift = await f.verify();
    expect(drift.exitCode).not.toBe(0);
    expect(drift.stdout).toContain('changed after accepted evidence');
    expect((await f.inspect()).run).toEqual(before);
    await f.put(f.reportRef, f.reportText);
    const { runtime, run } = await f.inspect();
    const checked = await executeClassicSdkCommandCheck(runtime, {
      runId: run.runId,
      projectRoot: f.projectRoot,
      argv: f.command('verify'),
    });
    await f.put(f.reportRef, '# Verification\nChanged after successful check.\n');
    const afterCheckDrift = await f.verify();
    expect(afterCheckDrift.exitCode).not.toBe(0);
    expect(afterCheckDrift.stdout).toContain('changed after accepted evidence');
    expect((await f.inspect()).run).toEqual(checked);
    await f.put(f.reportRef, f.reportText);
    const resumed = await f.verify();
    expect(resumed.exitCode, resumed.stdout).toBe(0);
    expect(resumed.response.data.phase).toBe('archive');
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('build\nverify\n');
  });
});
