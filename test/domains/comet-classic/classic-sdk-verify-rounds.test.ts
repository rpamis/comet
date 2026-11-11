import '../../helpers/isolated-agent-home.js';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import * as openSpecCommands from '../../../domains/comet-classic/classic-openspec-command.js';

import { classicArchiveDocumentOutputs } from '../../../domains/comet-classic/classic-sdk-archive-documents.js';

import * as sdkOutput from '../../../domains/comet-classic/classic-sdk-output.js';

import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { classicVerificationReportReceipt } from '../../../domains/comet-classic/classic-verification-report.js';

import { renderCometProjectGitignore } from '../../../domains/workflow-contract/project-gitignore.js';

import { createOpenSpecArchiveFixture } from '../../helpers/classic-openspec-fixture.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
// Windows 完整生命周期包含多轮归档与真实 Git 核对，使用有界预算保留业务断言。
const fullLifecycleTimeout = process.platform === 'win32' ? 180_000 : undefined;

describe('Classic SDK Archive input repair', () => {
  it.each(['tweak', 'hotfix'] as const)(
    'returns %s from Verify to Build for changed scope and confirms only the new scope',
    async (profile) => {
      const f = await fixture(profile, true, false, 'source', '');
      const before = (await f.inspect()).run;
      expect(before.state).toMatchObject({ phase: 'verify' });
      await f.put(
        'openspec/changes/example/proposal.md',
        '# Proposal\nThe revised scope keeps the public API.\n',
      );
      await f.cli(
        'state',
        'continue-build',
        'example',
        '--expected-revision',
        String(before.revision),
      );
      const returned = (await f.inspect()).run;
      expect(returned.runId).toBe(before.runId);
      expect(returned.state).toMatchObject({
        phase: 'build',
        verifyResult: 'pending',
        archiveConfirmation: null,
      });
      const scope = await f.cli(
        'state',
        'propose-escalation',
        'example',
        '--reason',
        'The user revised the same preset scope.',
      );
      await f.cli(
        'state',
        'decide-escalation',
        'example',
        '--proposal-hash',
        scope.wait.proposalHash,
        '--choice',
        'continue',
      );
      expect((await f.inspect()).run.runId).toBe(before.runId);
      await f.build();
      expect((await f.verify()).exitCode).toBe(0);
    },
  );
  it('requires fresh verification and Archive approval after rebinding to a divergent branch', async () => {
    const f = await fixture('tweak', true, false, 'source', '');
    const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
    vi.stubEnv('COMET_OPENSPEC', openSpec.command);
    expect((await f.verify()).exitCode).toBe(0);
    const proposed = await f.cli(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Archive main locally.',
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
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: f.projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git('checkout', '-b', 'next');
    await f.put('source.js', 'export const ready = true; // changed branch\n');
    git('add', '--all');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'divergent branch',
    );
    const before = (await f.inspect()).run;
    await f.cli('state', 'rebind', 'example');
    const rebound = (await f.inspect()).run;
    expect(rebound.actions).toEqual(before.actions);
    expect(rebound.waits).toEqual(before.waits);
    expect((await f.invoke('guard', 'example', 'archive', '--apply')).exitCode).not.toBe(0);
    await expect(openSpec.invocations()).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await f.cli(
      'state',
      'reopen-verification',
      'example',
      '--expected-revision',
      String(rebound.revision),
    );
    expect((await f.verify()).exitCode).toBe(0);
    expect(
      (
        await f.invoke(
          'state',
          'decide-archive',
          'example',
          '--proposal-hash',
          proposed.wait.proposalHash,
          '--choice',
          'local',
        )
      ).exitCode,
    ).not.toBe(0);
    const fresh = await f.cli(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Archive next locally.',
    );
    await f.cli(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      fresh.wait.proposalHash,
      '--choice',
      'local',
    );
    await f.cli('guard', 'example', 'archive', '--apply');
    git('add', '--all');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'archive');
    await f.cli('state', 'complete-delivery', 'example', '--commit', git('rev-parse', 'HEAD'));
    expect((await f.inspect()).run.status).toBe('completed');
    expect(await openSpec.invocations()).toHaveLength(1);
  });
  async function failedArchive(
    legacyUnknown = false,
    profile: 'tweak' | 'full' = 'tweak',
    entry: 'source' | 'generated' = 'source',
  ) {
    const f = await fixture(profile, true, false, entry, '', '# Empty delta\n');
    const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
    const source = await fs.readFile(openSpec.command, 'utf8');
    await fs.writeFile(
      openSpec.command,
      source.replace(
        'await fs.rename(source, target);',
        "if ((await fs.readFile(path.join(source, 'specs/ready/spec.md'), 'utf8')).includes('Empty delta')) { console.log('Invalid delta; no files changed'); process.exit(1); }\nawait fs.rename(source, target);",
      ),
    );
    vi.stubEnv('COMET_OPENSPEC', openSpec.command);
    expect((await f.verify()).exitCode).toBe(0);
    const proposal = await f.cli(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Archive locally.',
    );
    await f.cli(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    if (legacyUnknown) {
      const execute = openSpecCommands.executeClassicOpenSpec;
      vi.spyOn(openSpecCommands, 'executeClassicOpenSpec').mockImplementationOnce(
        async (...args) => ({
          ...(await execute(...args)),
          executionCompleted: false,
        }),
      );
    }
    await f.invoke('guard', 'example', 'archive', '--apply');
    return { ...f, openSpec };
  }

  it.each([false, true])(
    'reopens the same Run after a stopped Archive without effects and completes fresh approval and delivery (legacy unknown: %s)',
    async (legacyUnknown) => {
      const f = await failedArchive(legacyUnknown);
      const { runtime } = await f.inspect();
      let { run } = await f.inspect();
      const action = run.actions.find((a) => a.stepId === 'tweak.archive.execute')!;
      expect(action.status).toBe(legacyUnknown ? 'unknown' : 'failed');
      if (!legacyUnknown)
        expect(action.outcome?.output).toMatchObject({
          reason: expect.stringContaining('Invalid delta'),
        });
      // 旧版把已退出进程标为 unknown；原领取方仍可如实补回失败结果。
      if (action.status === 'unknown') {
        const blocked = await f.invoke(
          'state',
          'repair-archive',
          'example',
          '--expected-revision',
          String(run.revision),
        );
        expect(blocked.exitCode).not.toBe(0);
        expect((await f.inspect()).run).toEqual(run);
        run = await runtime.recordOutcome({
          runId: run.runId,
          outcome: {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: action.claim!.token,
            outcomeId: randomUUID(),
            status: 'failed',
            output: {
              archiveStarted: true,
              reason: 'Invalid delta; no files changed',
            },
          },
        });
      }
      const originalAction = structuredClone(run.actions.find((a) => a.id === action.id));
      const repaired = await f.cli(
        'state',
        'repair-archive',
        'example',
        '--expected-revision',
        String(run.revision),
      );
      expect(repaired.run.id).toBe(run.runId);
      const after = (await f.inspect()).run;
      expect(after.actions.find((a) => a.id === action.id)).toEqual(originalAction);
      expect((after.state as { phase: string }).phase).toBe('open');
      expect(await f.openSpec.invocations()).toHaveLength(1);
      await f.put(
        'openspec/changes/example/specs/ready/spec.md',
        '# Ready\n## ADDED Requirements\n### Requirement: Ready\nThe system SHALL be ready.\n#### Scenario: Ready\n- **WHEN** checked\n- **THEN** ready\n',
      );
      const open = await f.cli('guard', 'example', 'open');
      await f.cli('guard', 'example', 'open', '--apply', '--approval-hash', open.approvalHash);
      await f.build();
      expect((await f.verify()).exitCode).toBe(0);
      const proposal = await f.cli(
        'state',
        'propose-archive',
        'example',
        '--summary',
        'Archive corrected inputs locally.',
      );
      await f.cli(
        'state',
        'decide-archive',
        'example',
        '--proposal-hash',
        proposal.wait.proposalHash,
        '--choice',
        'local',
      );
      await f.cli('guard', 'example', 'archive', '--apply');
      const git = (...args: string[]) =>
        execFileSync('git', args, {
          cwd: f.projectRoot,
          encoding: 'utf8',
        }).trim();
      git('add', '--all');
      git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'archive',
      );
      await f.cli('state', 'complete-delivery', 'example', '--commit', git('rev-parse', 'HEAD'));
      expect((await f.inspect()).run.status).toBe('completed');
      expect(await f.openSpec.invocations()).toHaveLength(2);
    },
  );

  it.each(['changed specifications', 'partial archive directory'])(
    'uses actual Archive progress for %s and rejects stale revisions',
    async (effect) => {
      const f = await failedArchive();
      const { run } = await f.inspect();
      await f.put(
        effect === 'changed specifications'
          ? 'openspec/specs/partial/spec.md'
          : 'openspec/changes/archive/2026-10-25-example/proposal.md',
        '# External partial update\n',
      );
      const result = await f.invoke(
        'state',
        'repair-archive',
        'example',
        '--expected-revision',
        String(run.revision),
      );
      if (effect === 'changed specifications') {
        expect(result.exitCode).toBe(0);
        expect((await f.inspect()).run.state).toMatchObject({ phase: 'open' });
      } else {
        expect(result.exitCode).not.toBe(0);
        expect((await f.inspect()).run.revision).toBe(run.revision);
      }
      expect(await f.openSpec.invocations()).toHaveLength(1);
      const stale = await f.invoke(
        'state',
        'repair-archive',
        'example',
        '--expected-revision',
        String(run.revision - 1),
      );
      expect(stale.exitCode).not.toBe(0);
    },
  );
});
function stopTestDescendant(pid: number) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(
  profile: 'full' | 'tweak' | 'hotfix',
  buildFirst = true,
  confirmedConfiguration = false,
  entry: 'source' | 'generated' = 'source',
  managedIgnore?: string,
  deltaSpec?: string,
) {
  // 项目、HOME 与 Runtime 数据使用同一临时根，避免探测预算受平台临时目录深度影响。
  const temporaryRoot = process.platform === 'darwin' ? await fs.realpath('/tmp') : os.tmpdir();
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(temporaryRoot, 'classic verify rounds ')),
  );
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('COMET_DATA_DIR', root);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await prepareClassicLegacyProject(projectRoot);
  if (managedIgnore !== undefined)
    await fs.writeFile(
      path.join(projectRoot, '.gitignore'),
      renderCometProjectGitignore(managedIgnore),
    );
  await fs.writeFile(path.join(projectRoot, 'source.js'), 'export const ready = true;\n');
  execFileSync('git', ['init', '-b', 'main'], {
    cwd: projectRoot,
    stdio: 'ignore',
  });
  execFileSync('git', ['add', '.'], { cwd: projectRoot });
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'],
    { cwd: projectRoot, stdio: 'ignore' },
  );
  // The test controller acts as the Agent platform: execute selected argv, then submit actual results.
  const selected = new Map<string, { exitCode: number; stdout: string; stderr: string }>();
  const platformExecute = async (argv: string[], reuse: boolean) => {
    const key = JSON.stringify(argv);
    let actual = reuse ? selected.get(key) : undefined;
    if (!actual) {
      const executable =
        process.platform === 'win32' && !path.isAbsolute(argv[0])
          ? (process.env.ComSpec ?? 'cmd.exe')
          : argv[0];
      const argvArgs = executable === argv[0] ? argv.slice(1) : ['/d', '/s', '/c', argv.join(' ')];
      const result = spawnSync(executable, argvArgs, {
        cwd: projectRoot,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
      });
      actual = {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
      selected.set(key, actual);
    }
    await fs.writeFile(
      path.join(projectRoot, '.comet/agent-checks.json'),
      JSON.stringify({
        checks: [
          {
            name: argv.join(' '),
            result: actual.exitCode === 0 ? 'passed' : 'failed',
            note: 'Observed platform process exit ' + actual.exitCode,
          },
        ],
      }),
    );
    return actual;
  };
  const invoke = async (...args: string[]) => {
    if (
      (args[0] === 'check' && args[1] === 'run') ||
      (args[0] === 'guard' && args.includes('--'))
    ) {
      const split = args.indexOf('--');
      const argv = args.slice(split + 1);
      const before = args.slice(0, split);
      if (args[0] === 'check') {
        const current = (await inspectClassicSdkRun(projectRoot, 'example')).run;
        if (current.waits.some((wait) => wait.status === 'pending'))
          return {
            exitCode: 1,
            stdout: JSON.stringify({ error: 'User approval is pending' }),
            response: { error: 'User approval is pending' },
          };
        const actual = await platformExecute(argv, before.includes('--local'));
        return {
          ...actual,
          response: {
            data: { checksExecuted: true, actualExitCode: actual.exitCode },
          },
        };
      }
      await platformExecute(argv, before.includes('--local'));
      args = before.filter(
        (arg, index) =>
          arg !== '--local' &&
          !['--cwd', '--timeout-ms'].includes(arg) &&
          !['--cwd', '--timeout-ms'].includes(before[index - 1]),
      );
      args.push('--checks', '.comet/agent-checks.json');
    }
    const separator = args.indexOf('--');
    args.splice(separator < 0 ? args.length : separator, 0, '--json');
    const result =
      entry === 'source' || (args[0] === 'state' && args[1] === 'init')
        ? await runClassicCli(args, undefined, { invocationCwd: projectRoot })
        : await new Promise<{
            exitCode: number;
            stdout: string;
            stderr: string;
          }>((resolve, reject) => {
            execFile(
              process.execPath,
              [path.resolve('assets/skills/comet/scripts/comet-runtime.mjs'), ...args],
              { cwd: projectRoot, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
              (error, stdout, stderr) => {
                if (error && (typeof error.code !== 'number' || error.killed || error.signal))
                  reject(error);
                else resolve({ exitCode: error?.code ?? 0, stdout, stderr });
              },
            );
          });
    return { ...result, response: JSON.parse(result.stdout ?? '{}') };
  };
  const cli = async (...args: string[]) => {
    const result = await invoke(...args);
    expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
    return result.response.data;
  };
  const put = async (ref: string, text: string) => {
    await fs.mkdir(path.dirname(path.join(projectRoot, ref)), {
      recursive: true,
    });
    await fs.writeFile(path.join(projectRoot, ref), text);
  };
  await cli('state', 'init', 'example', profile, '--isolation', 'current');
  const changeDir = 'openspec/changes/example';
  await put(`${changeDir}/proposal.md`, '# Proposal\nCorrect the ready constant.\n');
  await put(`${changeDir}/design.md`, '# Design\nKeep the existing public API.\n');
  await put(`${changeDir}/tasks.md`, '- [x] Implement the change <!-- comet-task:impl -->\n');
  if (deltaSpec) await put(`${changeDir}/specs/ready/spec.md`, deltaSpec);
  const open = await cli('guard', 'example', 'open');
  await cli('guard', 'example', 'open', '--apply', '--approval-hash', open.approvalHash);
  const planRef = 'docs/superpowers/plans/work plan.md';
  const configure = async (effectiveProfile: 'full' | 'tweak' | 'hotfix' = profile) => {
    if (effectiveProfile === 'full') {
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
  };
  await configure();
  const checkCount = path.join(root, 'checks');
  const command = (label: string, exitCode = 0) => [
    process.execPath,
    '-e',
    `require('node:fs').appendFileSync(${JSON.stringify(checkCount)}, ${JSON.stringify(`${label}\n`)}); process.exit(${exitCode})`,
  ];
  const platformReport = async (label: string, exitCode = 0) => {
    let actualExit = 0;
    const argv = command(label, exitCode);
    try {
      execFileSync(argv[0], argv.slice(1), {
        cwd: projectRoot,
        stdio: 'ignore',
      });
    } catch (error) {
      actualExit = (error as { status: number }).status;
    }
    expect(actualExit).toBe(exitCode);
    await put(
      '.comet/agent-checks.json',
      JSON.stringify({
        checks: [
          {
            name: label,
            result: actualExit === 0 ? 'passed' : 'failed',
            note: 'Actual external process exited ' + actualExit,
          },
        ],
      }),
    );
  };
  const build = async () => {
    await platformReport('build');
    return cli('guard', 'example', 'build', '--apply', '--checks', '.comet/agent-checks.json');
  };
  if (buildFirst) await build();
  const reportRef = 'docs/superpowers/reports/final verify.md';
  const reportText = '# Verification\nFirst candidate assessment.\n';
  await put(reportRef, reportText);
  const verify = async (ref = reportRef, exitCode = 0) => {
    await platformReport('verify', exitCode);
    return invoke(
      'guard',
      'example',
      'verify',
      '--report',
      ref,
      '--apply',
      '--checks',
      '.comet/agent-checks.json',
    );
  };
  const inspect = () => inspectClassicSdkRun(projectRoot, 'example');
  const acceptReport = async (ref = reportRef, staleRef?: string, pauseBeforeEvidence = false) => {
    await platformReport('verify');
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
        output: {
          event: 'verification-ready',
          verificationReport: ref,
          checks: [
            {
              name: 'platform-verify',
              result: 'passed',
              note: 'Actual platform verification result',
            },
          ],
        },
      },
      context: { requestId: randomUUID(), projectRoot },
    });
    const wait = reported.evidenceWaits!.find(
      (candidate) =>
        candidate.stepId === `${profile}.verify.report.evidence` && candidate.status === 'pending',
    )!;
    const receipt = await classicVerificationReportReceipt(projectRoot, ref, 'en');
    await cli('guard', 'example', 'verify', '--report', ref);
    if (pauseBeforeEvidence) return reported;
    if (staleRef) {
      await expect(
        runtime.recordEvidence({
          runId: reported.runId,
          expectedRevision: reported.revision,
          evidenceId: wait.id,
          kind: wait.kind,
          ref: staleRef,
          contentHash: action.inputHash,
          submissionId: randomUUID(),
          context: { requestId: randomUUID(), projectRoot },
        }),
      ).rejects.toThrow('EVIDENCE_REJECTED');
      expect((await inspect()).run).toEqual(reported);
    }
    return runtime.recordEvidence({
      runId: reported.runId,
      expectedRevision: reported.revision,
      evidenceId: wait.id,
      kind: wait.kind,
      ...receipt,
      contentHash: action.inputHash,
      submissionId: randomUUID(),
      context: { requestId: randomUUID(), projectRoot },
    });
  };
  return {
    projectRoot,
    configure,
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
    platformExecute,
    planRef,
    reportRef,
    reportText,
  };
}

it.each(
  (['tweak', 'hotfix'] as const).flatMap((profile) =>
    (['source', 'generated'] as const).map((entry) => ({ profile, entry })),
  ),
)(
  'runs first managed checks after $profile upgrades to full through $entry',
  async ({ profile, entry }) => {
    const f = await fixture(profile, false, false, entry);
    const original = (await f.inspect()).run;
    const buildArgv = f.command('upgraded-build');
    const verifyArgv = f.command('upgraded-verify');
    await f.put(
      '.comet/check-policy.json',
      JSON.stringify({
        version: 2,
        commands: [buildArgv, verifyArgv].map((argv) => ({
          argv,
          cwd: '.',
          files: ['source.js'],
        })),
      }),
    );
    const proposal = await f.cli(
      'state',
      'propose-escalation',
      'example',
      '--reason',
      'A full design is needed.',
    );
    expect(
      (await f.invoke('check', 'run', 'example', 'build', '--local', '--', ...buildArgv)).exitCode,
    ).not.toBe(0);
    await expect(fs.readFile(f.checkCount, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    // 隔离夹具模拟用户批准；首次检查不能代替升级、设计和实施配置的批准。
    await f.cli(
      'state',
      'decide-escalation',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'upgrade',
    );
    expect((await f.inspect()).state.phase).toBe('design');
    await f.configure('full');
    const approved = (await f.inspect()).run.waits.filter((wait) => wait.decision);
    await f.cli('check', 'run', 'example', 'build', '--local', '--', ...buildArgv);
    const prepared = (await f.inspect()).run;
    expect(prepared.workflow).toMatchObject({
      id: original.workflow.id,
      version: original.workflow.version,
    });
    expect(prepared.state).toMatchObject({ phase: 'build', workflow: 'full' });
    expect(prepared.actions.at(-1)).toMatchObject({
      stepId: 'full.build.execute',
      status: 'pending',
    });
    await f.cli('guard', 'example', 'build', '--apply', '--local', '--', ...buildArgv);
    expect((await f.inspect()).state.phase).toBe('verify');
    await f.cli(
      'check',
      'run',
      'example',
      'verify',
      '--report',
      f.reportRef,
      '--local',
      '--',
      ...verifyArgv,
    );
    expect((await f.inspect()).state).toMatchObject({
      phase: 'verify',
      verifyResult: 'pending',
    });
    await f.put(f.reportRef, '# Verification\nThe upgraded full workflow passed acceptance.\n');
    await f.cli(
      'guard',
      'example',
      'verify',
      '--report',
      f.reportRef,
      '--apply',
      '--local',
      '--',
      ...verifyArgv,
    );
    const finished = (await f.inspect()).run;
    expect(finished.runId).toBe(original.runId);
    expect(finished.workflow.id).toBe(original.workflow.id);
    expect(finished.state).toMatchObject({
      phase: 'archive',
      verifyResult: 'pass',
    });
    for (const wait of approved)
      expect(finished.waits.find(({ id }) => id === wait.id)).toEqual(wait);
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('upgraded-build\nupgraded-verify\n');
  },
  fullLifecycleTimeout,
);

it('reuses the first generated Verify check after creating its declared report without a policy override', async () => {
  const f = await fixture('tweak', true, false, 'generated');
  await fs.unlink(path.join(f.projectRoot, f.reportRef));
  const argv = f.command('generated-first-green');
  await f.cli(
    'check',
    'run',
    'example',
    'verify',
    '--report',
    f.reportRef,
    '--local',
    '--',
    ...argv,
  );
  const pending = (await f.inspect()).run;
  expect(pending.state).toMatchObject({
    phase: 'verify',
    verifyResult: 'pending',
  });
  await f.put(f.reportRef, '# Verification\nAgent reviewed the actual successful check.\n');
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
  expect((await f.inspect()).run.state).toMatchObject({
    phase: 'archive',
    verifyResult: 'pass',
  });
  expect(await fs.readFile(f.checkCount, 'utf8')).toBe('build\ngenerated-first-green\n');
});

it(
  'completes Archive and delivery in the same Run after the first managed check',
  async () => {
    const f = await fixture('tweak', false);
    const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
    vi.stubEnv('COMET_OPENSPEC', openSpec.command);
    const argv = f.command('first-delivery-green');
    await f.put(
      '.comet/check-policy.json',
      JSON.stringify({
        version: 2,
        commands: [{ argv, cwd: '.', files: ['source.js'] }],
      }),
    );
    await f.cli('check', 'run', 'example', 'build', '--local', '--', ...argv);
    await f.cli('guard', 'example', 'build', '--apply', '--local', '--', ...argv);
    await f.cli(
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
    const beforeArchive = await f.inspect();
    expect(beforeArchive.state, JSON.stringify(beforeArchive.state)).toMatchObject({
      phase: 'archive',
      archived: false,
      archiveConfirmation: 'pending',
    });
    const proposed = await f.cli(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Simulated fixture authorization for local delivery.',
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
    await f.cli('guard', 'example', 'archive', '--apply');
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: f.projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git('add', '--all', '--', 'source.js', 'openspec', 'docs/superpowers');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'fixture archive',
    );
    await f.cli('state', 'complete-delivery', 'example', '--commit', git('rev-parse', 'HEAD'));
    expect((await f.inspect()).run).toMatchObject({
      runId: 'example',
      status: 'completed',
    });
    expect(await openSpec.invocations()).toHaveLength(1);
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('first-delivery-green\n');
  },
  fullLifecycleTimeout,
);

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

// Worker-only case retained in originals and retirement mapping.

it.each(['changed-path', 'new-preferred-command'] as const)(
  'executes an Agent-selected PATH command when reuse is not requested (%s)',
  async (mutation) => {
    const f = await fixture('tweak', false);
    const parent = path.dirname(f.projectRoot);
    const command = 'comet-session-check';
    const executableName = process.platform === 'win32' ? `${command}.cmd` : command;
    const originalPath = process.env.PATH ?? '';
    for (const [directory, code] of [
      ['first-bin', 0],
      ['second-bin', 7],
    ] as const) {
      const bin = path.join(parent, directory);
      await fs.mkdir(bin);
      const source = `require('node:fs').appendFileSync(${JSON.stringify(f.checkCount)}, ${JSON.stringify(`${directory}\n`)}); process.exit(${code});\n`;
      const script = path.join(bin, 'check.cjs');
      if (process.platform === 'win32') await fs.writeFile(script, source);
      await fs.writeFile(
        path.join(bin, executableName),
        process.platform === 'win32'
          ? `@echo off\r\n"${process.execPath}" "${script}"\r\n`
          : `#!${process.execPath}\n${source}`,
        { mode: 0o755 },
      );
    }
    const argv = [command];
    await f.put(
      '.comet/check-policy.json',
      JSON.stringify({
        version: 2,
        commands: [{ argv, cwd: '.', files: ['source.js'] }],
      }),
    );
    const preferred = path.join(parent, 'preferred-bin');
    await fs.mkdir(preferred);
    const firstPath = [preferred, path.join(parent, 'first-bin'), originalPath].join(
      path.delimiter,
    );
    vi.stubEnv('PATH', firstPath);
    await f.cli('guard', 'example', 'build', '--apply', '--local', '--', ...argv);
    if (mutation === 'changed-path')
      vi.stubEnv('PATH', `${path.join(parent, 'second-bin')}${path.delimiter}${originalPath}`);
    else
      await fs.copyFile(
        path.join(parent, 'second-bin', executableName),
        path.join(preferred, executableName),
      );
    const verified = await f.invoke(
      'guard',
      'example',
      'verify',
      '--report',
      f.reportRef,
      '--apply',
      '--',
      ...argv,
    );
    expect(verified.exitCode, verified.stdout).not.toBe(0);
    expect((await f.inspect()).state.phase).toBe('verify');
    expect(
      JSON.parse(await fs.readFile(path.join(f.projectRoot, '.comet/agent-checks.json'), 'utf8'))
        .checks[0].result,
    ).toBe('failed');
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('first-bin\nsecond-bin\n');
  },
);

it('recovers only accepted Build document evidence after reopening Verify', async () => {
  const f = await fixture('full');
  const original = (await f.inspect()).run;
  const acceptedDesign = structuredClone(original.outputs['full.design.document']);
  const acceptedPlan = structuredClone(original.outputs['full.build.plan']);
  const approved = original.waits.filter((w) =>
    ['full.open.confirm', 'full.design.confirm', 'full.build.confirm'].includes(w.stepId),
  );
  await f.cli(
    'state',
    'reopen-verification',
    'example',
    '--expected-revision',
    String(original.revision),
  );
  expect((await f.verify()).exitCode).toBe(0);
  const run = (await f.inspect()).run;
  const action = run.actions.findLast((a) => a.stepId === 'full.archive.prepare')!;
  const docs = classicArchiveDocumentOutputs(run, action);
  expect(docs.outputs['full.design.document']).toEqual(acceptedDesign.value);
  expect(docs.outputs['full.build.plan']).toEqual(acceptedPlan.value);
  expect(run.outputs['full.design.document']).toEqual(acceptedDesign);
  expect(run.outputs['full.build.plan']).toEqual(acceptedPlan);
  expect(run.waits.filter((w) => approved.some((a) => a.id === w.id))).toEqual(approved);
  expect(run.runId).toBe(original.runId);
});

describe.each(['full', 'tweak', 'hotfix'] as const)('Classic SDK %s Verify rounds', (profile) => {
  it.each(['source', 'generated'] as const)(
    'completes the %s Runtime lifecycle across sessions, declared outputs and a reopened verification',
    async (entry) => {
      // 在候选创建前建立真实 init/update 的忽略规则，不能在检查后改写。
      const f = await fixture(profile, false, false, entry, 'generated/\n');
      const git = (...args: string[]) =>
        execFileSync(
          'git',
          ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
          { cwd: f.projectRoot, encoding: 'utf8' },
        ).trim();
      const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
      vi.stubEnv('COMET_OPENSPEC', openSpec.command);
      vi.stubEnv('CODEX_THREAD_ID', 'classic-build-session');
      vi.stubEnv('COMET_CLASSIC_TEST_MODE', 'development');
      const argv = [process.execPath, 'check.cjs'];
      await f.put(
        'check.cjs',
        [
          "const fs = require('node:fs');",
          "if (!fs.readFileSync('source.js', 'utf8').includes('ready = true')) process.exit(7);",
          "fs.mkdirSync('generated', { recursive: true });",
          "fs.writeFileSync('generated/check-report.json', JSON.stringify({ generatedAt: Date.now() }));",
          `fs.appendFileSync(${JSON.stringify(f.checkCount)}, 'checked\\n');`,
          '',
        ].join('\n'),
      );
      await f.put(
        '.comet/check-policy.json',
        JSON.stringify({
          version: 2,
          commands: [
            {
              argv,
              cwd: '.',
              files: ['source.js', 'check.cjs', 'generated/check-report.json'],
              outputs: ['generated/**'],
              env: ['COMET_CLASSIC_TEST_MODE'],
            },
          ],
        }),
      );
      if (profile === 'full') await f.cli('handoff', 'example', 'design', '--write');
      git('add', '--all');
      git('commit', '-m', 'implementation');
      expect(git('ls-files', '--', 'openspec/changes/example/.comet-state.lock')).toBe('');
      await f.cli('guard', 'example', 'build', '--apply', '--local', '--', ...argv);
      vi.stubEnv('CODEX_THREAD_ID', 'classic-verify-session');
      vi.stubEnv('TERM', 'xterm-256color');
      const verified = await f.cli(
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
      expect(verified).toMatchObject({
        phase: 'archive',
      });
      const proposal = await f.cli(
        'state',
        'propose-archive',
        'example',
        '--summary',
        'Archive locally.',
      );
      await f.cli(
        'state',
        'decide-archive',
        'example',
        '--proposal-hash',
        proposal.wait.proposalHash,
        '--choice',
        'local',
      );
      await f.put('source.js', 'export const ready = true; // revised implementation\n');
      await expect(openSpec.invocations()).rejects.toMatchObject({
        code: 'ENOENT',
      });
      const stale = await f.cli('state', 'next', 'example');
      await f.cli(
        'state',
        'reopen-verification',
        'example',
        '--expected-revision',
        String(stale.run.revision),
      );
      await f.put(
        f.reportRef,
        '# Verification\nThe revised implementation passes the current checks.\n',
      );
      vi.stubEnv('CODEX_THREAD_ID', 'classic-reverify-session');
      const reverified = await f.cli(
        'guard',
        'example',
        'verify',
        '--report',
        f.reportRef,
        '--apply',
        '--',
        ...argv,
      );
      expect(reverified).toMatchObject({ phase: 'archive' });
      expect(await fs.readFile(f.checkCount, 'utf8')).toBe('checked\nchecked\n');
      if (profile === 'full') {
        const current = await f.cli('state', 'next', 'example');
        await f.cli(
          'state',
          'reopen-verification',
          'example',
          '--expected-revision',
          String(current.run.revision),
        );
        const repeated = await f.cli(
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
        expect(repeated).toMatchObject({ phase: 'archive' });
        expect(await fs.readFile(f.checkCount, 'utf8')).toBe('checked\nchecked\n');
      }
      const rejected = await f.invoke(
        'state',
        'decide-archive',
        'example',
        '--proposal-hash',
        proposal.wait.proposalHash,
        '--choice',
        'local',
      );
      expect(rejected.exitCode).not.toBe(0);
      const finalProposal = await f.cli(
        'state',
        'propose-archive',
        'example',
        '--summary',
        'Archive the reverified implementation locally.',
      );
      await f.cli(
        'state',
        'decide-archive',
        'example',
        '--proposal-hash',
        finalProposal.wait.proposalHash,
        '--choice',
        'local',
      );
      vi.stubEnv('CODEX_THREAD_ID', 'classic-archive-session');
      await f.cli('guard', 'example', 'archive', '--apply');
      expect(await openSpec.invocations()).toEqual([
        {
          args: ['archive', 'example', '--yes'],
          cwd: await fs.realpath(f.projectRoot),
        },
      ]);
      git('add', '--all');
      git('commit', '-m', 'archive');
      const beforeDelivery = (await f.inspect()).run;
      const archiveRef = (
        beforeDelivery.outputs[`${profile}.archive.execute`].value as {
          archiveDirectory: string;
        }
      ).archiveDirectory;
      const unapproved = `${archiveRef}/.comet-state.lock/unapproved.md`;
      await f.put(unapproved, '# Unapproved requirements hidden in a local lock directory\n');
      expect(git('check-ignore', '--', unapproved)).toBe(unapproved);
      git('add', '--force', '--', unapproved);
      git('commit', '--amend', '--no-edit');
      const rejectedInternalFile = await f.invoke(
        'state',
        'complete-delivery',
        'example',
        '--commit',
        git('rev-parse', 'HEAD'),
      );
      expect(rejectedInternalFile.exitCode).not.toBe(0);
      expect(rejectedInternalFile.stdout, JSON.parse(rejectedInternalFile.stdout).stderr).toContain(
        unapproved,
      );
      expect((await f.inspect()).run).toEqual(beforeDelivery);
      await fs.unlink(path.join(f.projectRoot, unapproved));
      git('add', '--update', '--', unapproved);
      git('commit', '--amend', '--no-edit');
      const delivered = await f.cli(
        'state',
        'complete-delivery',
        'example',
        '--commit',
        git('rev-parse', 'HEAD'),
      );
      expect(delivered.nextAction.kind).toBe('done');
      expect((await f.inspect()).run.status).toBe('completed');
      expect(git('status', '--porcelain', '--untracked-files=no')).toBe('');
    },
    profile === 'full' ? fullLifecycleTimeout : undefined,
  );

  it('reuses the Agent-selected successful command across Build and Verify with its original source', async () => {
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
    const built = await f.invoke('guard', 'example', 'build', '--apply', '--local', '--', ...argv);
    expect(built.exitCode).toBe(0);
    expect(entryReads).toHaveBeenCalledTimes(1);
    entryReads.mockClear();
    const continuation = built.response.data.continuation;
    expect(continuation.completion.commandArgs).toContain('--checks');
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
    expect(run.state).toMatchObject({
      phase: 'archive',
      verifyResult: 'pass',
    });
  });

  it.each(['build', 'verify'] as const)(
    'records the first %s check before completion and reuses it without advancing early',
    async (scope) => {
      const f = await fixture(profile, scope === 'verify');
      const argv = f.command('first-green');
      await f.put(
        '.comet/check-policy.json',
        JSON.stringify({
          version: 2,
          commands: [{ argv, cwd: '.', files: ['source.js'] }],
        }),
      );
      const before = (await f.inspect()).run;
      const checked = await f.invoke(
        'check',
        'run',
        'example',
        scope,
        '--local',
        ...(scope === 'verify' ? ['--report', f.reportRef] : []),
        '--',
        ...argv,
      );
      expect(checked.exitCode, checked.stdout ?? checked.stderr).toBe(0);
      const staged = (await f.inspect()).run;
      expect(staged.runId).toBe(before.runId);
      expect(staged.state).toMatchObject({ phase: scope });
      expect(staged.actions.at(-1)?.stepId).toBe(
        `${profile}.${scope === 'build' ? 'build.execute' : 'verify.run'}`,
      );
      const completed = await f.invoke(
        'guard',
        'example',
        scope,
        ...(scope === 'verify' ? ['--report', f.reportRef] : []),
        '--apply',
        '--local',
        '--',
        ...argv,
      );
      expect(completed.exitCode, completed.stdout ?? completed.stderr).toBe(0);
      const count = await fs.readFile(f.checkCount, 'utf8');
      expect(count.split('\n').filter((label) => label === 'first-green')).toHaveLength(1);
      expect((await f.inspect()).state.phase).toBe(scope === 'build' ? 'verify' : 'archive');
    },
  );

  it.each(['build', 'verify'] as const)(
    'keeps the original task after a failed first %s check without replay',
    async (scope) => {
      const f = await fixture(profile, scope === 'verify');
      const argv = f.command('first-failure', 7);
      const failed = await f.invoke(
        'check',
        'run',
        'example',
        scope,
        ...(scope === 'verify' ? ['--report', f.reportRef] : []),
        '--',
        ...argv,
      );
      expect(failed.exitCode).not.toBe(0);
      const run = (await f.inspect()).run;
      expect(run.state).toMatchObject({ phase: scope });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: `${profile}.${scope === 'build' ? 'build.execute' : 'verify.run'}`,
        status: 'pending',
      });
      expect(
        JSON.parse(await fs.readFile(path.join(f.projectRoot, '.comet/agent-checks.json'), 'utf8'))
          .checks[0].result,
      ).toBe('failed');
      await f.cli('state', 'next', 'example');
      expect(await fs.readFile(f.checkCount, 'utf8')).toBe(
        `${scope === 'verify' ? 'build\n' : ''}first-failure\n`,
      );
    },
  );

  it('retains the exact external check plan without adding local reuse', async () => {
    const f = await fixture(profile, false);
    const argv = f.command('external-check');
    const result = await f.invoke(
      'guard',
      'example',
      'build',
      '--apply',
      '--cwd',
      '.',
      '--timeout-ms',
      '45678',
      '--',
      ...argv,
    );
    expect(result.exitCode, result.stdout).toBe(0);
    expect((await f.inspect()).state.phase).toBe('verify');
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('external-check\n');
    const continued = await f.invoke(
      'guard',
      'example',
      'verify',
      '--report',
      f.reportRef,
      '--apply',
      '--cwd',
      '.',
      '--timeout-ms',
      '45678',
      '--',
      ...argv,
    );
    expect(continued.exitCode, continued.stdout).toBe(0);
    expect((await f.inspect()).state.phase).toBe('archive');
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('external-check\nexternal-check\n');
  });

  it('returns the committed Run and original receipt after a real Build failure without replay', async () => {
    const f = await fixture(profile, false);
    const before = (await f.inspect()).run;
    const failed = await f.invoke(
      'guard',
      'example',
      'build',
      '--apply',
      '--',
      ...f.command('failed-build', 7),
    );
    expect(failed.exitCode).not.toBe(0);
    expect((await f.inspect()).run).toEqual(before);
    const next = await f.cli('state', 'next', 'example');
    expect(next.phase).toBe('build');
    expect((await f.inspect()).run).toEqual(before);
    expect(
      JSON.parse(await fs.readFile(path.join(f.projectRoot, '.comet/agent-checks.json'), 'utf8'))
        .checks[0],
    ).toMatchObject({ result: 'failed' });
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('failed-build\n');
    await f.build();
    expect((await f.cli('state', 'next', 'example')).phase).toBe('verify');
  });

  it('reports the current continuation after failure and accepts a revised report after Build repair', async () => {
    const f = await fixture(profile);
    const before = (await f.inspect()).run;
    const failed = await f.verify(f.reportRef, 7);
    expect(failed.exitCode).not.toBe(0);
    expect((await f.inspect()).run).toEqual(before);
    await f.cli(
      'state',
      'transition',
      'example',
      'verify-fail',
      '--reason',
      'Actual platform verification exited 7.',
    );
    const failedRun = (await f.inspect()).run;
    expect(failedRun.state).toMatchObject({
      phase: 'build',
      verifyResult: 'fail',
      verifyFailures: 1,
    });
    const original = failedRun.actions.findLast((a) => a.stepId === profile + '.verify.run')!;
    expect(original.outcome?.output).toMatchObject({
      event: 'verify-fail',
      reason: 'Actual platform verification exited 7.',
    });
    if (profile === 'full') await f.cli('state', 'submit-plan', 'example', '--plan', f.planRef);
    await f.build();
    await f.put(
      f.reportRef,
      '# Verification\nRepaired candidate passes the actual failing case.\n',
    );
    const succeeded = await f.verify();
    expect(succeeded.exitCode, succeeded.stdout).toBe(0);
    const repaired = (await f.inspect()).run;
    expect(repaired.state).toMatchObject({
      phase: 'archive',
      verifyResult: 'pass',
    });
    expect(repaired.runId).toBe(failedRun.runId);
    expect(repaired.actions.find((a) => a.id === original.id)).toEqual(original);
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('build\nverify\nbuild\nverify\n');
  });

  it('accepts a new report path after Archive reverify and rejects the old check receipt', async () => {
    const f = await fixture(profile);
    expect((await f.verify()).exitCode).toBe(0);
    const first = (await f.inspect()).run;
    const original = first.actions.findLast((a) => a.stepId === profile + '.verify.run')!;
    const proposal = await f.cli(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Review the report again.',
    );
    await f.cli(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'reverify',
    );
    const ref = 'docs/superpowers/reports/revised verify.md';
    await f.put(ref, '# Verification\nSecond assessment.\n');
    await f.acceptReport(ref, f.reportRef);
    const final = (await f.inspect()).run;
    expect(final.runId).toBe(first.runId);
    expect(final.state).toMatchObject({
      phase: 'archive',
      verifyResult: 'pass',
    });
    expect(final.actions.find((a) => a.id === original.id)).toEqual(original);
    expect(final.actions.filter((a) => a.stepId === profile + '.verify.run')).toHaveLength(2);
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('build\nverify\nverify\n');
  });

  it('keeps the selected report path and original check after Agent-accepted report edits', async () => {
    const f = await fixture(profile);
    await f.acceptReport(f.reportRef, undefined, true);
    const before = (await f.inspect()).run;
    const original = before.actions.findLast((a) => a.stepId === profile + '.verify.run')!;
    const other = 'docs/superpowers/reports/different verify.md';
    await f.put(other, f.reportText);
    const changed = await f.invoke(
      'guard',
      'example',
      'verify',
      '--report',
      other,
      '--apply',
      '--checks',
      '.comet/agent-checks.json',
    );
    expect(changed.exitCode).not.toBe(0);
    expect((await f.inspect()).run).toEqual(before);
    await f.put(f.reportRef, '# Verification\nAgent accepted revised explanation.\n');
    const resumed = await f.invoke(
      'guard',
      'example',
      'verify',
      '--report',
      f.reportRef,
      '--apply',
      '--checks',
      '.comet/agent-checks.json',
    );
    expect(resumed.exitCode, resumed.stdout).toBe(0);
    expect((await f.inspect()).run.actions.find((a) => a.id === original.id)).toEqual(original);
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('build\nverify\n');
  });
});

describe('Classic SDK Agent input judgment', () => {
  for (const { profile, failure, name } of [
    {
      profile: 'tweak',
      failure: false,
      name: 'refreshes only the Verify check after Archive approval without replacing the report or decision (failure=false)',
    },
    {
      profile: 'tweak',
      failure: true,
      name: 'refreshes only the Verify check after Archive approval without replacing the report or decision (failure=true)',
    },
    {
      profile: 'full',
      failure: false,
      name: 'preserves full Archive documents after a supplemental check and completes local delivery',
    },
    {
      profile: 'full',
      failure: true,
      name: 'recovers a failed supplemental full check without losing Archive documents or replaying Build',
    },
  ] as const) {
    it(
      name,
      async () => {
        if (profile === 'full') {
          const helperRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-refresh-openspec-'));
          roots.push(helperRoot);
          const openSpec = await createOpenSpecArchiveFixture(helperRoot);
          vi.stubEnv('COMET_OPENSPEC', openSpec.command);
        }
        const f = await fixture(profile);
        await f.put('handbook.md', 'original prose');
        const argv = [
          process.execPath,
          '-e',
          `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(f.checkCount)},'verify-only\\n');if(fs.readFileSync('handbook.md','utf8').includes('bad'))process.exit(1);`,
        ];
        expect(
          (
            await f.invoke(
              'guard',
              'example',
              'verify',
              '--report',
              f.reportRef,
              '--apply',
              '--',
              ...argv,
            )
          ).exitCode,
        ).toBe(0);
        const proposal = await f.cli(
          'state',
          'propose-archive',
          'example',
          '--summary',
          'Deliver the accepted result.',
        );
        await f.cli(
          'state',
          'decide-archive',
          'example',
          '--proposal-hash',
          proposal.wait.proposalHash,
          '--choice',
          'local',
        );
        const before = (await f.inspect()).run;
        expect(before.state).toMatchObject({
          phase: 'archive',
          archiveConfirmation: 'confirmed',
        });
        const source = before.actions.findLast((a) => a.stepId === profile + '.verify.run')!;
        const approval = before.waits.findLast((w) => w.stepId === profile + '.archive.confirm')!;
        let clarifiedDesign: { ref: string; text: string } | undefined;
        if (profile === 'full') {
          const ref = (before.state as any).designDoc;
          const text =
            (await fs.readFile(path.join(f.projectRoot, ref), 'utf8')) +
            '\nEditorial clarification preserves the approved public API.\n';
          clarifiedDesign = { ref, text };
          await f.put(ref, text);
        }
        await f.put('handbook.md', failure ? 'bad spelling' : 'clarified prose');
        const actual = await f.platformExecute(argv, false);
        expect(actual.exitCode).toBe(failure ? 1 : 0);
        expect((await f.inspect()).run).toEqual(before);
        expect(await fs.readFile(f.checkCount, 'utf8')).toBe('build\nverify-only\nverify-only\n');
        if (failure) {
          await f.cli(
            'state',
            'transition',
            'example',
            'verify-fail',
            '--reason',
            'Actual supplemental command exited 1.',
          );
          const failed = (await f.inspect()).run;
          expect(failed.runId).toBe(before.runId);
          expect(failed.state).toMatchObject({
            phase: 'build',
            verifyResult: 'fail',
          });
          expect(failed.actions.find((a) => a.id === source.id)).toEqual(source);
          expect(failed.waits.find((w) => w.id === approval.id)).toEqual(approval);
          const originalBuild = before.actions.findLast(
            (a) => a.stepId === profile + '.build.execute',
          )!.outcome!.output as any;
          await f.put(
            '.comet/retained-build-checks.json',
            JSON.stringify({
              checks: originalBuild.checks,
              checksReason: originalBuild.checksReason,
            }),
          );
          if (profile === 'full')
            await f.cli('state', 'submit-plan', 'example', '--plan', f.planRef);
          await f.cli(
            'guard',
            'example',
            'build',
            '--apply',
            '--checks',
            '.comet/retained-build-checks.json',
          );
          await f.put('handbook.md', 'repaired prose');
          expect((await f.platformExecute(argv, false)).exitCode).toBe(0);
          expect(
            (
              await f.invoke(
                'guard',
                'example',
                'verify',
                '--report',
                f.reportRef,
                '--apply',
                '--checks',
                '.comet/agent-checks.json',
              )
            ).exitCode,
          ).toBe(0);
          const fresh = await f.cli(
            'state',
            'propose-archive',
            'example',
            '--summary',
            'Deliver the independently reverified candidate.',
          );
          expect(fresh.wait.id).not.toBe(approval.id);
          await f.cli(
            'state',
            'decide-archive',
            'example',
            '--proposal-hash',
            fresh.wait.proposalHash,
            '--choice',
            'local',
          );
        } else {
          expect((await f.inspect()).run.waits).toEqual(before.waits);
          expect((await f.inspect()).run.evidenceWaits).toEqual(before.evidenceWaits);
        }
        if (profile === 'full') {
          await f.cli('guard', 'example', 'archive', '--apply');
          const git = (...args: string[]) =>
            execFileSync('git', args, {
              cwd: f.projectRoot,
              encoding: 'utf8',
            }).trim();
          git(
            'add',
            '--',
            'openspec',
            'docs/superpowers',
            'handbook.md',
            'build configuration.json',
          );
          git(
            '-c',
            'user.name=Test',
            '-c',
            'user.email=test@example.invalid',
            'commit',
            '-m',
            'archive supplemental full candidate',
          );
          await f.cli(
            'state',
            'complete-delivery',
            'example',
            '--commit',
            git('rev-parse', 'HEAD'),
          );
          const final = (await f.inspect()).run;
          expect(final.runId).toBe(before.runId);
          expect(final.status).toBe('completed');
          expect(final.actions.filter((a) => a.stepId === 'full.archive.execute')).toHaveLength(1);
          expect(final.actions.find((a) => a.id === source.id)).toEqual(source);
          expect(final.waits.find((w) => w.id === approval.id)).toEqual(approval);
          const { annotatedMarkdown, archivedClassicDocumentRef } =
            await import('../../../domains/comet-classic/classic-archive-annotation.js');
          const archiveRef = (final.outputs['full.archive.execute'].value as any).archiveDirectory;
          const designRef = archivedClassicDocumentRef(
            clarifiedDesign!.ref,
            'openspec/changes/example',
            archiveRef,
          )!;
          expect(await fs.readFile(path.join(f.projectRoot, designRef), 'utf8')).toBe(
            annotatedMarkdown(
              clarifiedDesign!.text,
              path.posix.basename(archiveRef),
              'status: final',
            ),
          );
        }
        expect(await fs.readFile(f.checkCount, 'utf8')).toBe(
          failure
            ? 'build\nverify-only\nverify-only\nverify-only\n'
            : 'build\nverify-only\nverify-only\n',
        );
      },
      fullLifecycleTimeout,
    );
  }
  it('continues after a batch of Agent-accepted saves without edit-review proof', async () => {
    const f = await fixture('tweak', false);
    const argv = f.command('shared');
    await f.put('notes.unknown', 'original input');
    const built = await f.invoke('guard', 'example', 'build', '--apply', '--local', '--', ...argv);
    expect(built.exitCode, built.stdout).toBe(0);
    const before = (await f.inspect()).run;
    const original = before.actions.findLast((action) => action.stepId === 'tweak.build.execute')!;
    for (let save = 0; save < 10; save++) await f.put('notes.unknown', `Explanation ${save}`);
    expect((await f.inspect()).run).toEqual(before);
    const verified = await f.invoke(
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
    expect(verified.exitCode, verified.stdout).toBe(0);
    expect(verified.response.data).toMatchObject({ phase: 'archive' });
    expect((await f.inspect()).run.actions.find((action) => action.id === original.id)).toEqual(
      original,
    );
    expect(await fs.readFile(f.checkCount, 'utf8')).toBe('shared\n');
    expect(await fs.readFile(path.join(f.projectRoot, 'notes.unknown'), 'utf8')).toBe(
      'Explanation 9',
    );
  });
  it.each([true, false])(
    'runs or reuses the README check according to the Agent selection (retain: %s)',
    async (retain) => {
      const f = await fixture('tweak', false);
      const argv = f.command('shared');
      await f.put('README.md', '# Guide\n');
      const built = await f.invoke(
        'guard',
        'example',
        'build',
        '--apply',
        '--local',
        '--',
        ...argv,
      );
      expect(built.exitCode, built.stdout).toBe(0);
      const run = (await f.inspect()).run;
      const original = run.actions.findLast((action) => action.stepId === 'tweak.build.execute')!;
      const after = '# Guide\n\nExplain how to use the project.\n';
      await f.put('README.md', after);
      const verified = await f.invoke(
        'guard',
        'example',
        'verify',
        '--report',
        f.reportRef,
        '--apply',
        ...(retain ? ['--local'] : []),
        '--',
        ...argv,
      );
      expect(verified.exitCode, verified.stdout).toBe(0);
      expect(verified.response.data).toMatchObject({ phase: 'archive' });
      expect((await f.inspect()).run.actions.find((action) => action.id === original.id)).toEqual(
        original,
      );
      expect(await fs.readFile(f.checkCount, 'utf8')).toBe(
        retain ? 'shared\n' : 'shared\nshared\n',
      );
      expect(await fs.readFile(path.join(f.projectRoot, 'README.md'), 'utf8')).toBe(after);
    },
  );
});

describe('Classic SDK stale Build check recovery', () => {
  it('provides a read-only recovery command for an interrupted running Builder', async () => {
    const f = await fixture('tweak', false);
    const { run, runtime } = await f.inspect();
    const action = run.actions.find((entry) => entry.stepId === 'tweak.build.execute')!;
    const claimed = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'original-builder',
      claimToken: 'original-claim',
    });
    const next = await f.cli('state', 'next', 'example');
    expect(next.continuation.commandArgs).toEqual([
      'comet',
      'state',
      'check',
      'example',
      'build',
      '--recover',
      '--json',
    ]);
    expect(next.continuation.instruction).toContain('停止');
    expect((await f.inspect()).run).toEqual(claimed);
    await f.put('partial.txt', 'user work retained\n');
    const before = await f.invoke('state', 'check', 'example', 'build', '--recover');
    expect(before.response.data.recovery).not.toHaveProperty('interruptedOutcomeRequestTemplate');
    await runtime.markUnknown({
      runId: run.runId,
      expectedRevision: claimed.revision,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Original executor confirmed stopped.',
    });
    const diagnosed = await f.invoke('state', 'check', 'example', 'build', '--recover');
    const template = diagnosed.response.data.recovery.interruptedOutcomeRequestTemplate;
    expect(template.outcome).toMatchObject({
      actionId: action.id,
      status: 'failed',
    });
    const failed = await runtime.recordOutcome({
      ...template,
      outcome: {
        ...template.outcome,
        claimToken: 'original-claim',
        outcomeId: 'interrupted-builder',
        output: {
          summary: 'Original executor stopped; partial work retained.',
        },
      },
      context: { projectRoot: f.projectRoot },
    });
    await f.cli(
      'state',
      'continue-build',
      'example',
      '--expected-revision',
      String(failed.revision),
    );
    const resumed = (await f.inspect()).run;
    expect(resumed.runId).toBe(run.runId);
    expect(resumed.actions.at(-1)).toMatchObject({
      stepId: 'tweak.build.execute',
      status: 'pending',
    });
    expect(await fs.readFile(path.join(f.projectRoot, 'partial.txt'), 'utf8')).toBe(
      'user work retained\n',
    );
  });
});
