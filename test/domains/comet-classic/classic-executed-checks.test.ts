import {
  resolveClassicRunDirectory,
  resolveClassicLocalTarget,
} from '../../../domains/comet-classic/classic-runtime-paths.js';
import { execFile, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as checkSnapshot from '../../../domains/comet-classic/classic-check-snapshot.js';
import * as processAdapter from '../../../platform/process/spawn-command.js';
import {
  runClassicCli,
  type ClassicCommandResult,
} from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import {
  latestCommandCheck,
  recoverCommandChecks,
} from '../../../domains/comet-classic/classic-command-checks.js';
import { ensureClassicRuntimeRun } from '../../../domains/comet-classic/classic-runtime-run.js';
import { readTrajectory } from '../../../domains/comet-classic/classic-run-store.js';

describe('Classic executed check evidence', () => {
  let root: string;
  const cli = (...args: string[]) =>
    withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli(args),
    );
  const generatedCli = (...args: string[]) =>
    new Promise<ClassicCommandResult>((resolve, reject) => {
      execFile(
        process.execPath,
        [path.resolve('assets/skills/comet/scripts/comet-runtime.mjs'), ...args, '--json'],
        { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error && (typeof error.code !== 'number' || error.killed || error.signal)) {
            reject(error);
            return;
          }
          try {
            const result = JSON.parse(stdout) as ClassicCommandResult;
            expect(result.exitCode, stdout + stderr).toBe(error?.code ?? 0);
            resolve(result);
          } catch (failure) {
            reject(failure);
          }
        },
      );
    });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-executed-'));
    await prepareClassicLegacyProject(root);
    expect((await cli('state', 'init', 'demo', 'hotfix', '--runtime', 'compat')).exitCode).toBe(0);
    await fs.writeFile(path.join(root, 'input.txt'), 'good');
    await fs.writeFile(
      path.join(root, 'check.cjs'),
      "process.exit(require('fs').readFileSync('input.txt', 'utf8') === 'good' ? 0 : 1)",
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it.each(['argv', 'cwd'])('compares %s before validating previous evidence', async (identity) => {
    await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const scan = vi.spyOn(checkSnapshot, 'collectCheckSnapshot');
    const environment = vi.spyOn(checkSnapshot, 'checkEnvironmentFingerprint');
    const result = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      ...(identity === 'cwd' ? ['--cwd', 'openspec'] : []),
      '--',
      process.execPath,
      '-e',
      identity === 'cwd' ? 'process.exit(0)' : 'process.exit(1)',
    );
    // A different command executes directly without the retired input/environment proof.
    expect(scan).not.toHaveBeenCalled();
    expect(environment).not.toHaveBeenCalled();
    expect(result.stdout).not.toContain('reused=true');
  });

  it('executes literal argv, preserves child JSON/help flags, and records runtime provenance', async () => {
    const result = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--json',
      '--',
      process.execPath,
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1)))',
      '--',
      '--json',
      '--help',
      'a & b',
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const data = JSON.parse(result.stdout!).data;
    expect(data).toMatchObject({ provenance: 'runtime', exitCode: 0, reusable: true });
    expect(
      await fs.readFile(
        (await resolveClassicLocalTarget(root, path.join(root, data.logRef)))!.target,
        'utf8',
      ),
    ).toContain('["--json","--help","a & b"]');
  });

  it('persists a bound SDK Action across check start and completion', async () => {
    const result = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--json',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const record = JSON.parse(result.stdout!).data;
    expect(record.action).toMatchObject({
      protocolVersion: 1,
      runId: record.runId,
      type: 'call_tool',
      ref: 'classic-check',
      status: 'succeeded',
      input: { scope: 'verify', argv: [process.execPath, '-e', 'process.exit(0)'] },
      outcome: { status: 'succeeded', output: { exitCode: 0 } },
    });
    expect(record.action.receipts).toHaveLength(1);
    const changeDir = path.join(root, 'openspec', 'changes', 'demo');
    const run = await ensureClassicRuntimeRun(changeDir);
    const events = await readTrajectory(changeDir, run.run.trajectoryRef);
    const started = events.find((event) => event.type === 'command_check_started');
    const executed = events.find((event) => event.type === 'command_check_executed');
    expect(started?.data.action).toMatchObject({
      id: record.action.id,
      status: 'running',
      inputHash: record.action.inputHash,
    });
    expect(executed?.data.action).toMatchObject({
      id: record.action.id,
      status: 'succeeded',
      inputHash: record.action.inputHash,
    });
  });

  it('rejects a check whose SDK Action outcome disagrees with the recorded execution', async () => {
    const result = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', 'demo');
    const { run } = await ensureClassicRuntimeRun(changeDir);
    const trajectoryFile = path.join(
      await resolveClassicRunDirectory(changeDir),
      run.trajectoryRef,
    );
    const events = (await fs.readFile(trajectoryFile, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    const executed = events.find((event) => event.type === 'command_check_executed');
    executed.data.action.outcome.output.exitCode = 1;
    await fs.writeFile(
      trajectoryFile,
      events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    );

    expect(await latestCommandCheck(root, changeDir, run, 'verify')).toBeNull();
  });

  it('does not fall back to an older success when the latest SDK Action is damaged', async () => {
    const argv = [process.execPath, '-e', 'process.exit(0)'];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await cli('check', 'run', 'demo', 'verify', '--', ...argv);
      expect(result.exitCode, result.stderr).toBe(0);
    }
    const changeDir = path.join(root, 'openspec', 'changes', 'demo');
    const { run } = await ensureClassicRuntimeRun(changeDir);
    const trajectoryFile = path.join(
      await resolveClassicRunDirectory(changeDir),
      run.trajectoryRef,
    );
    const events = (await fs.readFile(trajectoryFile, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    const latest = events.findLast((event) => event.type === 'command_check_executed');
    latest.data.action.outcome.output.exitCode = 1;
    await fs.writeFile(
      trajectoryFile,
      events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    );

    expect(await latestCommandCheck(root, changeDir, run, 'verify')).toBeNull();
  });

  it('does not trust a completed SDK Action without its matching start record', async () => {
    const result = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', 'demo');
    const { run } = await ensureClassicRuntimeRun(changeDir);
    const trajectoryFile = path.join(
      await resolveClassicRunDirectory(changeDir),
      run.trajectoryRef,
    );
    const events = (await fs.readFile(trajectoryFile, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    await fs.writeFile(
      trajectoryFile,
      events
        .filter((event) => event.type !== 'command_check_started')
        .map((event) => JSON.stringify(event))
        .join('\n') + '\n',
    );

    expect(await latestCommandCheck(root, changeDir, run, 'verify')).toBeNull();
  });

  it('binds cross-scope check reuse to a distinct SDK Action', async () => {
    const argv = [process.execPath, '-e', 'process.exit(0)'];
    const build = await cli('check', 'run', 'demo', 'build', '--local', '--json', '--', ...argv);
    expect(build.exitCode, build.stderr).toBe(0);
    const buildRecord = JSON.parse(build.stdout!).data;
    const verify = await cli('check', 'run', 'demo', 'verify', '--local', '--json', '--', ...argv);
    expect(verify.exitCode, verify.stderr).toBe(0);
    const verifyRecord = JSON.parse(verify.stdout!).data;
    expect(verifyRecord.reused).toBe(true);
    expect(verifyRecord.action).toMatchObject({
      runId: buildRecord.runId,
      status: 'succeeded',
      input: { scope: 'verify', argv },
      outcome: { status: 'succeeded', output: { exitCode: 0 } },
    });
    expect(verifyRecord.action.id).not.toBe(buildRecord.action.id);
  });

  it.each(['bin/comet.js', 'dist/app/cli/index.js'])(
    'preserves child flags through the public %s entry',
    async (entry) => {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve(entry),
          'check',
          'run',
          'demo',
          'verify',
          '--json',
          '--',
          process.execPath,
          '-e',
          'console.log(process.argv.slice(1).join("|"))',
          '--',
          '--json',
          '--help',
          '--comet-task',
          'literal',
        ],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 30_000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const evidence = JSON.parse(result.stdout).data;
      expect(
        await fs.readFile(
          (await resolveClassicLocalTarget(root, path.join(root, evidence.logRef)))!.target,
          'utf8',
        ),
      ).toContain('--json|--help|--comet-task|literal');
    },
  );

  it('does not infer or execute a build when prerequisite configuration is missing', async () => {
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: { build: "node -e \"require('fs').writeFileSync('unexpected', 'yes')\"" },
      }),
    );
    const result = await cli('guard', 'demo', 'build');
    expect(result.exitCode).not.toBe(0);
    expect(await fs.stat(path.join(root, 'unexpected')).catch(() => null)).toBeNull();
  });

  async function readyVerify() {
    const dir = path.join(root, 'openspec', 'changes', 'demo');
    await fs.writeFile(path.join(dir, 'tasks.md'), '- [x] implement\n');
    await fs.writeFile(path.join(dir, 'verification-report.md'), '# Verification\nPassed\n');
    await cli(
      'state',
      'set',
      'demo',
      'verification_report',
      'openspec/changes/demo/verification-report.md',
    );
    const file = path.join(dir, '.comet.yaml');
    await fs.writeFile(
      file,
      (await fs.readFile(file, 'utf8')).replace('phase: open', 'phase: verify'),
    );
  }

  it('reuses declared inputs through Guard but rejects policy changes and missing logs', async () => {
    await readyVerify();
    const policy = path.join(root, '.comet/check-policy.json');
    await fs.writeFile(
      policy,
      JSON.stringify({
        version: 1,
        argv: [process.execPath, 'check.cjs'],
        cwd: '.',
        files: ['input.txt', 'check.cjs'],
        git: 'none',
        env: [],
      }),
    );
    const check = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--json',
      '--',
      process.execPath,
      'check.cjs',
    );
    expect(check.exitCode, check.stderr).toBe(0);
    await fs.writeFile(path.join(root, 'unrelated.md'), 'unrelated');
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
    await fs.appendFile(policy, '\n');
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
    const fresh = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--json',
      '--',
      process.execPath,
      'check.cjs',
    );
    expect(fresh.exitCode, fresh.stderr).toBe(0);
    await fs.unlink(
      (await resolveClassicLocalTarget(
        root,
        path.join(root, JSON.parse(fresh.stdout!).data.logRef),
      ))!.target,
    );
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
  });

  it('rejects manually attested success at both verification entry points', async () => {
    await readyVerify();
    await cli(
      'state',
      'record-check',
      'demo',
      'verify',
      '--command',
      'not executed',
      '--exit-code',
      '0',
    );
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
    expect((await cli('state', 'transition', 'demo', 'verify-pass')).exitCode).not.toBe(0);
  });

  it('reuses unchanged local evidence but rejects a changed input and direct transition', async () => {
    await readyVerify();
    expect(
      (await cli('check', 'run', 'demo', 'verify', '--local', '--', process.execPath, 'check.cjs'))
        .exitCode,
    ).toBe(0);
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
    await fs.writeFile(path.join(root, 'input.txt'), 'bad');
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
    expect((await cli('state', 'transition', 'demo', 'verify-pass')).exitCode).not.toBe(0);
  });

  it('keeps evidence reusable across commits, staging and task checkbox ticks', async () => {
    const git = (...args: string[]) => spawnSync('git', args, { cwd: root, stdio: 'ignore' });
    const dir = path.join(root, 'openspec', 'changes', 'demo');
    await readyVerify();
    await fs.writeFile(path.join(dir, 'tasks.md'), '- [ ] implement\n');
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('add', '-A');
    git('commit', '-m', 'baseline');
    expect(
      (await cli('check', 'run', 'demo', 'verify', '--local', '--', process.execPath, 'check.cjs'))
        .exitCode,
    ).toBe(0);
    git('add', '-A');
    git('commit', '-m', 'progress');
    await fs.writeFile(path.join(dir, 'tasks.md'), '- [x] implement\n');
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
    await fs.writeFile(path.join(root, 'input.txt'), 'bad');
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
  });

  it('revalidates local evidence on cold recovery and returns structured context', async () => {
    await readyVerify();
    await cli('check', 'run', 'demo', 'verify', '--local', '--', process.execPath, 'check.cjs');
    const result = await cli('state', 'check', 'demo', 'verify', '--recover', '--json');
    expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
    expect(JSON.parse(result.stdout!).data).toMatchObject({
      change: 'demo',
      phase: 'verify',
      evidence: { status: 'revalidated', scopes: { verify: 'revalidated' } },
    });
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
  });

  it('keeps incremental evidence inside the phase until a full check replaces it', async () => {
    await readyVerify();
    const incremental = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--incremental',
      '--json',
      '--',
      process.execPath,
      'check.cjs',
    );
    expect(incremental.exitCode, incremental.stderr).toBe(0);
    expect(JSON.parse(incremental.stdout!).data.tier).toBe('incremental');
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
    const apply = await cli('guard', 'demo', 'verify', '--apply');
    expect(apply.exitCode).not.toBe(0);
    expect(`${apply.stdout ?? ''}${apply.stderr ?? ''}`).toContain('Incremental check evidence');
    const full = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--json',
      '--',
      process.execPath,
      'check.cjs',
    );
    expect(full.exitCode, full.stderr).toBe(0);
    expect(JSON.parse(full.stdout!).data.tier).toBe('full');
    expect((await cli('guard', 'demo', 'verify', '--apply')).exitCode).toBe(0);
  });

  it('explains cwd mismatch instead of reporting generic missing evidence', async () => {
    await readyVerify();
    await fs.mkdir(path.join(root, 'ui'));
    const check = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--cwd',
      'ui',
      '--json',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    expect(check.exitCode, check.stderr).toBe(0);
    expect(JSON.parse(check.stdout!).data.cwd).toBe('ui');
    const guard = await cli('guard', 'demo', 'verify');
    expect(guard.exitCode).not.toBe(0);
    const text = `${guard.stdout ?? ''}${guard.stderr ?? ''}`;
    expect(text).toContain('No current Runtime verify evidence from this directory');
    expect(text).toContain("ran in 'ui'");
    expect(text).toContain("invocation directory '.'");
    expect(text).toContain('npm --prefix');
  });

  it('prefers cwd mismatch guidance over detection hints for build evidence', async () => {
    await readyVerify();
    await fs.writeFile(
      path.join(root, 'openspec', 'changes', 'demo', 'proposal.md'),
      '# Proposal\n',
    );
    expect((await cli('state', 'set', 'demo', 'isolation', 'current')).exitCode).toBe(0);
    await fs.mkdir(path.join(root, 'ui'));
    const check = await cli(
      'check',
      'run',
      'demo',
      'build',
      '--local',
      '--cwd',
      'ui',
      '--json',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    expect(check.exitCode, check.stderr).toBe(0);
    const guard = await cli('guard', 'demo', 'build');
    expect(guard.exitCode).not.toBe(0);
    const text = `${guard.stdout ?? ''}${guard.stderr ?? ''}`;
    expect(text).toContain("ran in 'ui'");
    expect(text).toContain('npm --prefix');
    expect(text).toContain('.comet/check-policy.json');
    expect(text).not.toContain('Detection searched');
  });

  it('accepts subdirectory evidence when a v2 policy entry declares its cwd', async () => {
    await readyVerify();
    await fs.mkdir(path.join(root, 'ui'));
    await fs.writeFile(
      path.join(root, '.comet/check-policy.json'),
      JSON.stringify({
        version: 2,
        commands: [{ argv: [process.execPath, '-e', 'process.exit(0)'], cwd: 'ui' }],
      }),
    );
    const check = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--cwd',
      'ui',
      '--json',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    expect(check.exitCode, check.stderr).toBe(0);
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
    expect((await cli('guard', 'demo', 'verify', '--apply')).exitCode).toBe(0);
  });

  it('rejects evidence recorded in an undeclared directory despite other policy entries', async () => {
    await readyVerify();
    await fs.mkdir(path.join(root, 'ui'));
    await fs.mkdir(path.join(root, 'api'));
    await fs.writeFile(
      path.join(root, '.comet/check-policy.json'),
      JSON.stringify({
        version: 2,
        commands: [{ argv: [process.execPath, '-e', 'process.exit(0)'], cwd: 'ui' }],
      }),
    );
    const check = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--cwd',
      'api',
      '--json',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    expect(check.exitCode, check.stderr).toBe(0);
    const guard = await cli('guard', 'demo', 'verify');
    expect(guard.exitCode).not.toBe(0);
    const text = `${guard.stdout ?? ''}${guard.stderr ?? ''}`;
    expect(text).toContain("ran in 'api'");
    expect(text).toContain("declare this command with cwd 'api'");
  });

  it('requires a full rerun when recovering incremental evidence', async () => {
    await readyVerify();
    await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--incremental',
      '--',
      process.execPath,
      'check.cjs',
    );
    const recovered = await cli('state', 'check', 'demo', 'verify', '--recover', '--json');
    expect(JSON.parse(recovered.stdout!).data.evidence.scopes.verify).toBe('rerun-required');
  });

  it.each(['non-local'])('requires new evidence after recovery of %s checks', async (reason) => {
    await readyVerify();
    const result = await cli(
      'check',
      'run',
      'demo',
      'verify',
      ...(reason === 'non-local' ? [] : ['--local']),
      '--json',
      '--',
      process.execPath,
      'check.cjs',
    );
    expect(result.exitCode).toBe(0);
    if (reason === 'changed-input') await fs.writeFile(path.join(root, 'input.txt'), 'bad');
    if (reason === 'damaged-log') {
      await fs.writeFile(
        (await resolveClassicLocalTarget(
          root,
          path.join(root, JSON.parse(result.stdout!).data.logRef),
        ))!.target,
        'tampered',
      );
    }
    const recovered = await cli('state', 'check', 'demo', 'verify', '--recover', '--json');
    expect(JSON.parse(recovered.stdout!).data.evidence.scopes.verify).toBe('rerun-required');
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
  });

  it('records failure and timeout instead of falling back to an older success', async () => {
    await readyVerify();
    await cli('check', 'run', 'demo', 'verify', '--local', '--', process.execPath, 'check.cjs');
    expect(
      (
        await cli(
          'check',
          'run',
          'demo',
          'verify',
          '--local',
          '--',
          process.execPath,
          '-e',
          'process.exit(7)',
        )
      ).exitCode,
    ).toBe(7);
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
    expect(
      (
        await cli(
          'check',
          'run',
          'demo',
          'verify',
          '--timeout-ms',
          '100',
          '--',
          process.execPath,
          '-e',
          'setInterval(() => {}, 1000)',
        )
      ).exitCode,
    ).not.toBe(0);
  });

  it('keeps non-local evidence for previews and consumes it on the atomic phase update', async () => {
    await readyVerify();
    expect(
      (await cli('check', 'run', 'demo', 'verify', '--', process.execPath, 'check.cjs')).exitCode,
    ).toBe(0);
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
    expect((await cli('guard', 'demo', 'verify', '--apply')).exitCode).toBe(0);
    expect((await cli('state', 'get', 'demo', 'check_epoch')).stdout?.trim()).toBe('1');
    expect((await cli('state', 'transition', 'demo', 'archive-reopen')).exitCode).toBe(0);
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
  });

  it.each(['source', 'generated'] as const)(
    'allows only one of two concurrent guarded phase transitions to succeed via %s',
    async (mode) => {
      await readyVerify();
      const check = await cli(
        'check',
        'run',
        'demo',
        'verify',
        '--',
        process.execPath,
        'check.cjs',
      );
      expect(check.exitCode, check.stderr).toBe(0);
      const guard = mode === 'generated' ? generatedCli : cli;
      const results = await Promise.all([
        guard('guard', 'demo', 'verify', '--apply'),
        guard('guard', 'demo', 'verify', '--apply'),
      ]);
      const winners = results.filter((result) => result.exitCode === 0);
      expect(winners, JSON.stringify(results)).toHaveLength(1);
      expect(winners[0].data).toMatchObject({
        phase: 'archive',
        configuration: { phase: 'archive' },
      });
      expect((await cli('state', 'get', 'demo', 'phase')).stdout?.trim()).toBe('archive');
      expect((await cli('state', 'get', 'demo', 'check_epoch')).stdout?.trim()).toBe('1');
    },
  );

  it('preserves non-local evidence if a different guard prerequisite fails', async () => {
    await readyVerify();
    await cli('check', 'run', 'demo', 'verify', '--', process.execPath, 'check.cjs');
    await cli('state', 'set', 'demo', 'verification_report', 'null');
    expect((await cli('guard', 'demo', 'verify', '--apply')).exitCode).not.toBe(0);
    await cli(
      'state',
      'set',
      'demo',
      'verification_report',
      'openspec/changes/demo/verification-report.md',
    );
    expect((await cli('guard', 'demo', 'verify', '--apply')).exitCode).toBe(0);
  });

  it('prevents manual writes to the check epoch', async () => {
    expect((await cli('state', 'set', 'demo', 'check_epoch', '0')).exitCode).not.toBe(0);
  });

  it('does not expose older success after a failed executable launch', async () => {
    await readyVerify();
    expect(
      (await cli('check', 'run', 'demo', 'verify', '--local', '--', process.execPath, 'check.cjs'))
        .exitCode,
    ).toBe(0);
    expect(
      (await cli('check', 'run', 'demo', 'verify', '--', path.join(root, 'missing-program')))
        .exitCode,
    ).not.toBe(0);
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
  });

  it('preserves and reruns an interrupted check instead of inferring another build', async () => {
    const changeDir = path.join(root, 'openspec', 'changes', 'demo');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] implement\n');
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
    await cli('state', 'set', 'demo', 'isolation', 'current');
    const stateFile = path.join(changeDir, '.comet.yaml');
    await fs.writeFile(
      stateFile,
      (await fs.readFile(stateFile, 'utf8')).replace('phase: open', 'phase: build'),
    );
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          build: "node -e \"require('fs').writeFileSync('unexpected-build', 'yes')\"",
        },
      }),
    );
    // 在进程启动前中断，保留真实预留的命令；Guard 不能自行换成推测的 build。
    const launch = vi.spyOn(processAdapter, 'spawnCommand').mockImplementationOnce(() => {
      throw new Error('simulated prelaunch interruption');
    });
    const check = await cli(
      'check',
      'run',
      'demo',
      'build',
      '--local',
      '--',
      process.execPath,
      'check.cjs',
    );
    expect(check.exitCode).not.toBe(0);
    expect(`${check.stdout ?? ''}${check.stderr ?? ''}`).toContain(
      'simulated prelaunch interruption',
    );
    launch.mockRestore();
    const guard = await cli('guard', 'demo', 'build');
    expect(guard.exitCode).not.toBe(0);
    expect(`${guard.stdout ?? ''}${guard.stderr ?? ''}`).toContain('did not complete');
    expect(`${guard.stdout ?? ''}${guard.stderr ?? ''}`).toContain('comet check rerun demo build');
    await expect(fs.stat(path.join(root, 'unexpected-build'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const rerun = await cli('check', 'rerun', 'demo', 'build');
    expect(rerun.exitCode, rerun.stderr).toBe(0);
  });

  it('does not rerun an interrupted check with a corrupted SDK Action binding', async () => {
    const changeDir = path.join(root, 'openspec', 'changes', 'demo');
    const launch = vi.spyOn(processAdapter, 'spawnCommand').mockImplementationOnce(() => {
      throw new Error('simulated prelaunch interruption');
    });
    const marker = path.join(root, 'unexpected-rerun');
    const check = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--',
      process.execPath,
      '-e',
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
    );
    expect(check.exitCode).not.toBe(0);
    launch.mockRestore();
    const { run } = await ensureClassicRuntimeRun(changeDir);
    const trajectoryFile = path.join(
      await resolveClassicRunDirectory(changeDir),
      run.trajectoryRef,
    );
    const events = (await fs.readFile(trajectoryFile, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    const started = events.find((event) => event.type === 'command_check_started');
    started.data.action.input.argv = ['different-command'];
    await fs.writeFile(
      trajectoryFile,
      events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    );
    const rerun = await cli('check', 'rerun', 'demo', 'verify');
    expect(rerun.exitCode).not.toBe(0);
    await expect(fs.access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not rebuild after an explicit successful build check', async () => {
    const dir = path.join(root, 'openspec', 'changes', 'demo');
    await fs.writeFile(path.join(dir, 'tasks.md'), '- [x] implement\n');
    await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\n');
    await cli('state', 'set', 'demo', 'isolation', 'current');
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e "process.exit(99)"' } }),
    );
    const checked = await cli(
      'check',
      'run',
      'demo',
      'build',
      '--local',
      '--',
      process.execPath,
      'check.cjs',
    );
    expect(checked.exitCode, checked.stderr).toBe(0);
    const guard = await cli('guard', 'demo', 'build');
    expect(guard.exitCode, guard.stderr).toBe(0);
    expect((await cli('guard', 'demo', 'build')).exitCode).toBe(0);
    const reused = await cli(
      'check',
      'run',
      'demo',
      'build',
      '--local',
      '--json',
      '--',
      process.execPath,
      'check.cjs',
    );
    expect(JSON.parse(reused.stdout!).data.reused).toBe(true);
  });
});
