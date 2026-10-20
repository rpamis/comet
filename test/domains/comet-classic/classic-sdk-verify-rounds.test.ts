import { hashRuntimeValue, createFileRuntimeStore } from '../../../domains/engine/runtime.js';
import { resolveClassicLocalTarget } from '../../../domains/comet-classic/classic-runtime-paths.js';
import { parse, stringify } from 'yaml';
import {
  classicSdkCheckLogHash,
  classicSdkCheckDirectoryRef,
} from '../../../domains/comet-classic/classic-sdk-check-record.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { executeClassicSdkCommandCheck } from '../../../domains/comet-classic/classic-sdk-check.js';
import * as sdkOutput from '../../../domains/comet-classic/classic-sdk-output.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { classicVerificationReportReceipt } from '../../../domains/comet-classic/classic-verification-report.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { requireFileSymlink } from '../../helpers/file-symlink.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(
  profile: 'full' | 'tweak' | 'hotfix',
  buildFirst = true,
  confirmedConfiguration = false,
) {
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
      ...(confirmedConfiguration ? ['--confirmed'] : []),
    );
    if (!confirmedConfiguration)
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
  if (buildFirst) await build();
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

it('records an explicitly chosen Build configuration and its approval in one CLI handoff', async () => {
  const f = await fixture('full', false, true);
  const run = (await f.inspect()).run;
  expect(run.waits.find((wait) => wait.stepId === 'full.build.confirm')).toMatchObject({
    status: 'resolved',
    decision: { choice: 'approved' },
  });
  expect(run.actions.find((action) => action.stepId === 'full.build.execute')).toMatchObject({
    status: 'pending',
  });
  expect(run.waits.filter((wait) => wait.stepId === 'full.build.confirm')).toHaveLength(1);
});

it.each(['input', 'environment', 'unmarked', 'log'] as const)(
  'does not reuse SDK checks after %s changes',
  async (mutation) => {
    const f = await fixture('tweak', false);
    const argv = f.command('shared');
    vi.stubEnv('COMET_REUSE_TEST_ENV', 'before');
    await f.put(
      '.comet/check-policy.json',
      JSON.stringify({
        version: 2,
        commands: [{ argv, cwd: '.', files: ['source.js'], env: ['COMET_REUSE_TEST_ENV'] }],
      }),
    );
    await f.cli(
      'guard',
      'example',
      'build',
      '--apply',
      ...(mutation === 'unmarked' ? [] : ['--local']),
      '--',
      ...argv,
    );
    if (mutation === 'input') await f.put('source.js', 'export const ready = false;\n');
    if (mutation === 'environment') vi.stubEnv('COMET_REUSE_TEST_ENV', 'after');
    if (mutation === 'log') {
      const action = (await f.inspect()).run.actions.find(
        (entry) => entry.ref === 'classic-check',
      )!;
      const output = action.outcome!.output as { receiptRef: string };
      const log = (await resolveClassicLocalTarget(
        f.projectRoot,
        path.join(f.projectRoot, output.receiptRef),
      ))!.target;
      await fs.writeFile(log, 'changed execution log');
    }
    const result = await f.invoke(
      'guard',
      'example',
      'verify',
      '--report',
      f.reportRef,
      '--apply',
      '--local',
      '--',
      ...argv,
    );
    if (mutation === 'log') {
      expect(result.exitCode).not.toBe(0);
      expect(await fs.readFile(f.checkCount, 'utf8')).toBe('shared\n');
    } else {
      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.response.data.reused).toBe(false);
      expect(await fs.readFile(f.checkCount, 'utf8')).toBe('shared\nshared\n');
    }
  },
);

it('uses the committed claim without redundant inspection and rejects a stale supplied Run before executing', async () => {
  const f = await fixture('tweak', false);
  await f.cli('state', 'complete-build', 'example');
  const { runtime, run } = await f.inspect();
  const inspect = vi.spyOn(runtime, 'inspect');
  const input = {
    runId: run.runId,
    projectRoot: f.projectRoot,
    argv: f.command('committed-claim'),
  };
  try {
    const checked = await executeClassicSdkCommandCheck(runtime, input, run);
    expect(checked.actions.at(-1)?.status).toBe('succeeded');
    expect(inspect).not.toHaveBeenCalled();
    await expect(executeClassicSdkCommandCheck(runtime, input, run)).rejects.toThrow();
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('committed-claim\n');
    expect(inspect).not.toHaveBeenCalled();
  } finally {
    inspect.mockRestore();
  }
});

describe.each(['full', 'tweak', 'hotfix'] as const)('Classic SDK %s Verify rounds', (profile) => {
  it('reuses the same successful command across Build and Verify after validating its inputs and log', async () => {
    const f = await fixture(profile, false);
    const argv = f.command('shared');
    await f.put('source.js', 'export const ready = false;\n');
    await f.put('.gitignore', 'node_modules/\n');
    await f.put('node_modules/.modules.yaml', 'layoutVersion: 5\n');
    const probe = vi.spyOn(fs, 'lstat');
    const entryReads = vi.spyOn(sdkOutput, 'classicSdkEntryData');
    await f.put(
      '.comet/check-policy.json',
      JSON.stringify({
        version: 2,
        commands: [{ argv, cwd: '.', files: ['source.js'] }],
      }),
    );
    expect(
      (await f.invoke('guard', 'example', 'build', '--apply', '--local', '--', ...argv)).exitCode,
    ).toBe(0);
    expect(entryReads).toHaveBeenCalledTimes(1);
    entryReads.mockClear();
    const result = await f.invoke(
      'guard',
      'example',
      'verify',
      '--report',
      f.reportRef,
      '--apply',
      '--local',
      '--',
      ...argv,
    );
    expect(result.exitCode, result.stdout).toBe(0);
    expect(entryReads).toHaveBeenCalledTimes(1);
    const committed = entryReads.mock.calls[0][1].run;
    expect(result.response.data.run.revision).toBe(committed.revision);
    expect(result.response.data.phase).toBe((committed.state as { phase: string }).phase);
    entryReads.mockRestore();
    const pathChecks = probe.mock.calls.length;
    probe.mockRestore();
    expect(pathChecks).toBeLessThan(profile === 'full' ? 19_000 : 17_000);
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('shared\n');
    const run = (await f.inspect()).run;
    const checks = run.actions.filter((action) => action.ref === 'classic-check');
    expect(checks.at(-1)?.outcome?.output).toMatchObject({
      reused: true,
      reusedFrom: checks[0].id,
      deliveryInputs: { 'source.js': expect.stringMatching(/^(?:git:)?[a-f0-9]{40,64}$/) },
    });
    expect(
      Object.keys((checks.at(-1)?.outcome?.output as { deliveryInputs: object }).deliveryInputs),
    ).not.toContain('node_modules/.modules.yaml');
  });

  it('returns the committed Run and original receipt after a real Build failure without replay', async () => {
    const f = await fixture(profile, false);
    const failed = await f.invoke(
      'guard',
      'example',
      'build',
      '--apply',
      '--',
      ...f.command('failed-build', 7),
    );
    expect(failed.exitCode).not.toBe(0);
    const next = await f.cli('state', 'next', 'example');
    expect(failed.response.data).toMatchObject({
      phase: 'build',
      exitCode: 7,
      run: { id: next.run.id, revision: next.run.revision },
      nextAction: next.nextAction,
    });
    expect(failed.response.data.receiptRef).toMatch(/\.log$/u);
    expect(failed.response.agent.continuation).toBeTruthy();
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('failed-build\n');
    await f.build();
    expect((await f.cli('state', 'next', 'example')).phase).toBe('verify');
  });

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

describe('Classic SDK interrupted check recovery', () => {
  it('returns the original claim and completed check request, then resumes without executing again', async () => {
    const f = await fixture('tweak', false);
    await f.cli('state', 'complete-build', 'example');
    const { runtime, run } = await f.inspect();
    const argv = f.command('completed-before-disconnect');
    await expect(
      executeClassicSdkCommandCheck(
        {
          ...runtime,
          async recordOutcome() {
            throw new Error('Simulated disconnect after evidence write');
          },
        },
        { runId: run.runId, projectRoot: f.projectRoot, argv },
      ),
    ).rejects.toThrow('Simulated disconnect');
    const unknown = (await f.inspect()).run;
    const action = unknown.actions.find((entry) => entry.status === 'unknown')!;
    const checked = await f.invoke('state', 'check', 'example', 'build', '--recover', '--details');
    expect(checked.exitCode).not.toBe(0);
    expect(checked.response.data.checks.blocked).toBe(true);
    const recovery = checked.response.data.recovery;
    expect(recovery).toMatchObject({
      status: 'outcome-unknown',
      claim: action.claim,
      command: { argv, cwd: '.', timeoutMs: 300_000 },
      record: { status: 'completed' },
      evidence: { receiptRef: { exists: true }, manifestRef: { exists: true } },
      recordOutcomeRequest: {
        operation: 'record-outcome',
        runId: run.runId,
        expectedRevision: unknown.revision,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: action.claim!.token,
          status: 'succeeded',
        },
      },
    });
    expect((await f.inspect()).run).toEqual(unknown);
    const refused = await f.invoke('guard', 'example', 'build', '--apply', '--', ...argv);
    expect(refused.exitCode).not.toBe(0);
    const request = path.join(path.dirname(f.projectRoot), 'recover-check.json');
    await fs.writeFile(request, JSON.stringify(recovery.recordOutcomeRequest));
    const restored = await runtimeDispatchCommand(
      { request, application: recovery.dispatch.application, projectRoot: f.projectRoot },
      { invocationCwd: f.projectRoot },
    );
    expect(restored.exitCode, JSON.stringify(restored.response)).toBe(0);
    const continued = await f.cli('guard', 'example', 'build', '--apply', '--', ...argv);
    expect(continued.phase).toBe('verify');
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('completed-before-disconnect\n');
  });

  it('keeps old interrupted claims blocked when command and receipt records are unavailable', async () => {
    const f = await fixture('tweak', false);
    await f.cli('state', 'complete-build', 'example');
    const { runtime, run } = await f.inspect();
    const action = run.actions.find((entry) => entry.status === 'pending')!;
    const claimed = await runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-classic-check',
      claimToken: 'original-legacy-attempt',
    });
    const checked = await f.invoke('state', 'check', 'example', 'build', '--recover');
    expect(checked.exitCode).not.toBe(0);
    expect(checked.response.data.recovery).toMatchObject({
      claim: { executorId: 'comet-classic-check', token: 'original-legacy-attempt' },
      command: null,
      record: { status: 'missing' },
      evidence: { directory: classicSdkCheckDirectoryRef(run) },
      markUnknownRequest: {
        operation: 'mark-unknown',
        expectedRevision: claimed.revision,
        actionId: action.id,
      },
    });
    expect(checked.response.data.recovery).not.toHaveProperty('recordOutcomeRequest');
    expect((await f.inspect()).run).toEqual(claimed);
    // 本例只领取、从未启动检查；用真实的未执行事实填写公开恢复模板。
    const request = path.join(path.dirname(f.projectRoot), 'retry-check.json');
    const dispatch = async (value: unknown) => {
      await fs.writeFile(request, JSON.stringify(value));
      const result = await runtimeDispatchCommand(
        { request, application: 'classic-tweak', projectRoot: f.projectRoot },
        { invocationCwd: f.projectRoot },
      );
      expect(result.exitCode, JSON.stringify(result.response)).toBe(0);
    };
    await dispatch(checked.response.data.recovery.markUnknownRequest);
    const marked = await f.invoke('state', 'check', 'example', 'build', '--recover');
    const retry = marked.response.data.recovery.retryRequestTemplate;
    retry.reconciliation.evidence = {
      summary: 'Fixture called Runtime claim only and never invoked an executor or check command',
    };
    await dispatch(retry);
    const retried = (await f.inspect()).run.actions.find((entry) => entry.id === action.id)!;
    expect(retried).toMatchObject({ status: 'pending', attempt: action.attempt + 1 });
    await f.build();
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('build\n');
  });
});

describe('Classic SDK original execution receipts', () => {
  async function portableCheck() {
    const f = await fixture('tweak', false);
    await f.cli('state', 'complete-build', 'example');
    const { runtime, run } = await f.inspect();
    const checked = await executeClassicSdkCommandCheck(runtime, {
      runId: run.runId,
      projectRoot: f.projectRoot,
      argv: f.command('proof-boundary'),
    });
    const action = checked.actions.find(
      (entry) => entry.ref === 'classic-check' && entry.status === 'succeeded',
    )!;
    const output = action.outcome!.output as { receiptRef: string; contentHash: string };
    const local = (await resolveClassicLocalTarget(
      f.projectRoot,
      path.join(f.projectRoot, output.receiptRef),
    ))!.target;
    const stateFile = path.join(f.projectRoot, 'openspec/changes/example/comet-state.yaml');
    const original = await fs.readFile(stateFile, 'utf8');
    const validate = () =>
      classicSdkCheckLogHash(
        f.projectRoot,
        checked,
        action,
        output.receiptRef,
        output.contentHash,
        'Portable check log',
      );
    return { f, checked, action, output, local, stateFile, original, validate };
  }

  it('rejects a symbolic link replacing the local check log', async (context) => {
    await requireFileSymlink(context);
    const { local, stateFile, validate } = await portableCheck();
    await fs.unlink(local);
    await fs.symlink(stateFile, local);
    await expect(validate()).rejects.toThrow();
    expect((await fs.lstat(local)).isSymbolicLink()).toBe(true);
  });

  it('uses only a matching committed portable check when the local log is missing', async () => {
    const { f, checked, action, output, local, stateFile, original, validate } =
      await portableCheck();
    await fs.writeFile(local, 'tampered log');
    await expect(validate()).rejects.toThrow('changed');
    await fs.unlink(local);
    await fs.mkdir(local);
    await expect(validate()).rejects.toThrow('real file');
    await fs.rmdir(local);
    await expect(validate()).resolves.toBe(output.contentHash);
    for (const mutation of ['hash', 'claim', 'future', 'marker'] as const) {
      const document = parse(original);
      const checkpoint = document.run_checkpoint;
      if (mutation === 'hash') checkpoint.hash = '0'.repeat(64);
      if (mutation === 'claim') {
        checkpoint.run.actions.find(
          (entry: { id: string }) => entry.id === action.id,
        ).claim.executorId = 'other-executor';
        checkpoint.hash = hashRuntimeValue(checkpoint.run);
      }
      if (mutation === 'future') checkpoint.sourceRevision = checked.revision + 1;
      checkpoint.sourceHash = hashRuntimeValue({
        hash: checkpoint.hash,
        sourceRevision: checkpoint.sourceRevision,
      });
      await fs.writeFile(
        stateFile,
        (mutation === 'marker' ? '' : '# comet-execution: managed-run\n') + stringify(document),
      );
      await expect(validate(), mutation).rejects.toThrow();
    }
    await fs.writeFile(stateFile, original);
    for (const changed of [
      { ...action, attempt: action.attempt + 1 },
      { ...action, status: 'unknown' as const },
    ])
      await expect(
        classicSdkCheckLogHash(
          f.projectRoot,
          checked,
          changed,
          output.receiptRef,
          output.contentHash,
          'Portable check log',
        ),
      ).rejects.toThrow();
    await fs.writeFile(path.join(f.projectRoot, 'source.js'), 'export const ready = false;\n');
    const drifted = await f.invoke(
      'guard',
      'example',
      'build',
      '--apply',
      '--',
      ...f.command('proof-boundary'),
    );
    expect(drifted.exitCode).not.toBe(0);
    expect(drifted.stdout).toContain('inputs changed');
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('proof-boundary\n');
  });

  it.each([false, true])(
    'keeps a previously committed successful check usable without new receipts (checkpoint recovery=%s)',
    async (cold) => {
      const f = await fixture('tweak', false);
      await f.cli('state', 'complete-build', 'example');
      const { runtime, run } = await f.inspect();
      const argv = f.command('committed-success');
      const checked = await executeClassicSdkCommandCheck(runtime, {
        runId: run.runId,
        projectRoot: f.projectRoot,
        argv,
      });
      expect(checked.actions.at(-1)?.status).toBe('succeeded');
      expect(checked.evidenceWaits?.at(-1)?.status).toBe('pending');
      if (cold) {
        await fs.rename(
          resolveWorkspaceRuntimeRootSync(f.projectRoot),
          path.join(path.dirname(f.projectRoot), 'committed-check-runtime'),
        );
        await f.cli('state', 'next', 'example');
      } else
        await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(f.projectRoot), 'check-receipts'), {
          recursive: true,
        });
      const finished = await f.cli('guard', 'example', 'build', '--apply', '--', ...argv);
      expect(finished.phase).toBe('verify');
      expect(await fs.readFile(f.checkCount, 'utf8')).toBe('committed-success\n');
    },
  );

  it('continues already accepted Build and Verify evidence after losing the entire Runtime directory', async () => {
    const f = await fixture('tweak');
    const loseRuntime = async (label: string) => {
      const before = (await f.inspect()).run;
      await fs.rename(
        resolveWorkspaceRuntimeRootSync(f.projectRoot),
        path.join(path.dirname(f.projectRoot), label),
      );
      const next = await f.cli('state', 'next', 'example');
      expect(next.run.revision).toBe(before.revision);
      expect(next.phase).toBe((before.state as { phase: string }).phase);
    };
    await loseRuntime('accepted-build-runtime');
    expect((await f.verify()).exitCode).toBe(0);
    await loseRuntime('accepted-verify-runtime');
    const proposed = await f.cli(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Archive the verified candidate locally.',
    );
    await f.cli(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposed.wait.proposalHash,
      '--choice',
      'local',
    );
    await f.cli('guard', 'example', 'archive');
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('build\nverify\n');
  });

  it.each([
    'failed-result',
    'removed-binding',
    'old-claim',
    'changed-receipt',
    'missing-receipt',
  ] as const)('rejects %s in recovery and direct SDK evidence without replay', async (attack) => {
    const f = await fixture('tweak', false);
    await f.cli('state', 'complete-build', 'example');
    const { runtime, run } = await f.inspect();
    const argv = f.command('original-check', 7);
    await expect(
      executeClassicSdkCommandCheck(
        {
          ...runtime,
          async recordOutcome() {
            throw new Error('disconnect');
          },
        },
        { runId: run.runId, projectRoot: f.projectRoot, argv },
      ),
    ).rejects.toThrow('disconnect');
    const first = await f.invoke('state', 'check', 'example', 'build', '--recover');
    const originalRequest = first.response.data.recovery.recordOutcomeRequest;
    expect(originalRequest.outcome.status).toBe('failed');
    const recoveryFile = (await resolveClassicLocalTarget(
      f.projectRoot,
      path.join(f.projectRoot, first.response.data.recovery.record.ref),
    ))!.target;
    const record = JSON.parse(await fs.readFile(recoveryFile, 'utf8'));
    record.result.status = 'succeeded';
    record.result.output.exitCode = 0;
    if (attack === 'removed-binding') {
      delete record.inputHash;
      delete record.result.output.receiptRef;
    }
    if (attack === 'old-claim') record.claim.token = 'earlier-attempt';
    if (attack === 'changed-receipt') {
      const directory = path.join(
        resolveWorkspaceRuntimeRootSync(f.projectRoot),
        'check-receipts/classic',
      );
      const compact = path.join(directory, '.runtime-store-v2');
      const [id] = await fs.readdir(compact);
      const originalFile = path.join(compact, id, 'checkpoint.json');
      const receipt = JSON.parse(await fs.readFile(originalFile, 'utf8'));
      receipt.record.result.status = 'succeeded';
      receipt.record.result.output.exitCode = 0;
      receipt.hash = hashRuntimeValue({
        record: receipt.record,
        legacyRevision: receipt.legacyRevision,
      });
      await fs.writeFile(originalFile, JSON.stringify(receipt));
    }
    if (attack === 'missing-receipt')
      await fs.rm(
        path.join(resolveWorkspaceRuntimeRootSync(f.projectRoot), 'check-receipts/classic'),
        {
          recursive: true,
        },
      );
    await fs.writeFile(recoveryFile, JSON.stringify(record));
    const inspected = await f.invoke('state', 'check', 'example', 'build', '--recover');
    expect(inspected.response.data.recovery.record.status).toBe('invalid');
    expect(inspected.response.data.recovery).not.toHaveProperty('recordOutcomeRequest');
    const forged = structuredClone(originalRequest.outcome);
    forged.status = 'succeeded';
    forged.output.exitCode = 0;
    // 即便绕过恢复模板直接提交，也必须在原 Run 提交边界拒绝，不能落成成功。
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        outcome: forged,
        context: { requestId: 'forged-check-result', projectRoot: f.projectRoot },
      }),
    ).rejects.toThrow(/original Runtime execution receipt|原始执行收据/u);
    const guard = await f.invoke('guard', 'example', 'build', '--apply', '--', ...argv);
    expect(guard.exitCode).not.toBe(0);
    expect((await f.inspect()).state.phase).toBe('build');
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('original-check\n');
  });
  it.each([false, true])(
    'restores a lost report from the original receipt after cold recovery without executing again (legacy=%s)',
    async (legacy) => {
      const f = await fixture('tweak', false);
      await f.cli('state', 'complete-build', 'example');
      const { runtime, run } = await f.inspect();
      const argv = f.command('cold-original-execution');
      await expect(
        executeClassicSdkCommandCheck(
          {
            ...runtime,
            async recordOutcome() {
              throw new Error('lost report');
            },
          },
          { runId: run.runId, projectRoot: f.projectRoot, argv },
        ),
      ).rejects.toThrow('lost report');
      const oldRoot = resolveWorkspaceRuntimeRootSync(f.projectRoot);
      if (legacy) {
        const original = (await f.inspect()).run;
        const action = original.actions.at(-1)!;
        const recovery = (await f.invoke('state', 'check', 'example', 'build', '--recover'))
          .response.data.recovery;
        const result = {
          status: recovery.recordOutcomeRequest.outcome.status,
          output: recovery.recordOutcomeRequest.outcome.output,
        };
        const id = hashRuntimeValue({
          workflow: action.executionOrigin?.workflow ?? original.workflow,
          runId: original.runId,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claim: action.claim,
        });
        await fs.rename(
          path.join(oldRoot, 'check-receipts'),
          path.join(path.dirname(f.projectRoot), 'modern-check-receipts'),
        );
        await createFileRuntimeStore<{
          runId: string;
          revision: number;
          schema: string;
          result: unknown;
          resultHash: string;
        }>({
          rootDir: path.join(oldRoot, 'check-receipts/classic'),
        }).compareAndSwap(id, null, {
          runId: id,
          revision: 1,
          schema: 'comet.classic-sdk-check-receipt.v1',
          result,
          resultHash: hashRuntimeValue(result),
        });
        const rawRef = `${classicSdkCheckDirectoryRef(original)}/sdk-${hashRuntimeValue({ runId: original.runId, actionId: action.id, attempt: action.attempt, inputHash: action.inputHash, claim: action.claim })}.json`;
        const source = (await resolveClassicLocalTarget(
          f.projectRoot,
          path.join(f.projectRoot, recovery.record.ref),
        ))!.target;
        const target = (await resolveClassicLocalTarget(
          f.projectRoot,
          path.join(f.projectRoot, rawRef),
        ))!.target;
        await fs.rename(source, target);
      }
      const backup = path.join(path.dirname(f.projectRoot), 'original-execution-runtime');
      await fs.rename(oldRoot, backup);
      await f.cli('state', 'next', 'example');
      const cold = (await f.inspect()).run;
      expect(cold.actions.at(-1)?.claim?.token).toMatch(/^portable-/u);
      // 只恢复原执行器保存的记录；可编辑恢复 JSON 自身不授予成功结果。
      for (const directory of ['classic-sdk-checks', 'check-receipts'])
        await fs.cp(path.join(backup, directory), path.join(oldRoot, directory), {
          recursive: true,
        });
      const recovery = (await f.invoke('state', 'check', 'example', 'build', '--recover')).response
        .data.recovery;
      expect(recovery.record.status).toBe('completed');
      const restored = await f.inspect();
      await restored.runtime.recordOutcome({
        ...recovery.recordOutcomeRequest,
        context: { requestId: 'cold-original-result', projectRoot: f.projectRoot },
      });
      expect((await f.cli('guard', 'example', 'build', '--apply', '--', ...argv)).phase).toBe(
        'verify',
      );
      expect(await fs.readFile(f.checkCount, 'utf8')).toBe('cold-original-execution\n');
    },
  );
});
