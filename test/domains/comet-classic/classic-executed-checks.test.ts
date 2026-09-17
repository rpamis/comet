import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as checkSnapshot from '../../../domains/comet-classic/classic-check-snapshot.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import { recoverCommandChecks } from '../../../domains/comet-classic/classic-command-checks.js';
import { ensureClassicRuntimeRun } from '../../../domains/comet-classic/classic-runtime-run.js';

describe('Classic executed check evidence', () => {
  let root: string;
  const cli = (...args: string[]) =>
    withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli(args),
    );

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-executed-'));
    await prepareClassicLegacyProject(root);
    expect((await cli('state', 'init', 'demo', 'hotfix')).exitCode).toBe(0);
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
    // Only the new execution's before/after snapshots, not the unrelated old check.
    expect(scan).toHaveBeenCalledTimes(2);
    expect(environment).toHaveBeenCalledTimes(2);
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
    expect(await fs.readFile(path.join(root, data.logRef), 'utf8')).toContain(
      '["--json","--help","a & b"]',
    );
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
      expect(await fs.readFile(path.join(root, evidence.logRef), 'utf8')).toContain(
        '--json|--help|--comet-task|literal',
      );
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
    await fs.unlink(path.join(root, JSON.parse(fresh.stdout!).data.logRef));
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
  });

  it('rejects declaration changes during execution even when source inputs are stable', async () => {
    const code = 'require("fs").appendFileSync(".comet/check-policy.json", "\\n")';
    await fs.writeFile(
      path.join(root, '.comet/check-policy.json'),
      JSON.stringify({
        version: 1,
        argv: [process.execPath, '-e', code],
        cwd: '.',
        files: ['input.txt'],
        git: 'none',
      }),
    );
    const result = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--',
      process.execPath,
      '-e',
      code,
    );
    expect(result.exitCode).not.toBe(0);
  });

  it('does not share a narrowed recovery snapshot with an unmatched security command', async () => {
    await fs.writeFile(
      path.join(root, '.comet/check-policy.json'),
      JSON.stringify({
        version: 1,
        argv: [process.execPath, 'check.cjs'],
        cwd: '.',
        files: ['input.txt', 'check.cjs'],
        git: 'none',
      }),
    );
    expect(
      (await cli('check', 'run', 'demo', 'build', '--local', '--', process.execPath, 'check.cjs'))
        .exitCode,
    ).toBe(0);
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
          'process.exit(0)',
        )
      ).exitCode,
    ).toBe(0);
    await fs.writeFile(path.join(root, 'security.config'), 'changed');
    const change = path.join(root, 'openspec/changes/demo');
    const { run } = await ensureClassicRuntimeRun(change);
    expect(await recoverCommandChecks(root, change, run)).toEqual({
      build: 'revalidated',
      verify: 'rerun-required',
    });
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

  it('scopes v2 policy evidence per command', async () => {
    const dir = path.join(root, 'openspec', 'changes', 'demo');
    await readyVerify();
    await fs.writeFile(
      path.join(root, '.comet', 'check-policy.json'),
      JSON.stringify({
        version: 2,
        commands: [
          {
            argv: [process.execPath, 'check.cjs'],
            cwd: '.',
            files: ['input.txt', 'check.cjs'],
            taskCheckboxes: 'include',
          },
          { argv: [process.execPath, '-e', 'process.exit(0)'], cwd: '.', files: ['check.cjs'] },
        ],
      }),
    );
    expect(
      (await cli('check', 'run', 'demo', 'build', '--local', '--', process.execPath, 'check.cjs'))
        .exitCode,
    ).toBe(0);
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
          'process.exit(0)',
        )
      ).exitCode,
    ).toBe(0);
    await fs.writeFile(path.join(root, 'input.txt'), 'changed');
    // The verify command never declared input.txt, so its evidence survives.
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
    expect((await cli('guard', 'demo', 'build')).exitCode).not.toBe(0);
    const recovered = await cli('state', 'check', 'demo', 'verify', '--recover', '--json');
    expect(JSON.parse(recovered.stdout!).data.evidence.scopes).toEqual({
      build: 'rerun-required',
      verify: 'revalidated',
    });
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

  it('explains invalidated evidence with the changed input paths', async () => {
    await readyVerify();
    await cli('check', 'run', 'demo', 'verify', '--local', '--', process.execPath, 'check.cjs');
    await fs.writeFile(path.join(root, 'input.txt'), 'bad');
    const guard = await cli('guard', 'demo', 'verify');
    expect(guard.exitCode).not.toBe(0);
    const text = `${guard.stdout ?? ''}${guard.stderr ?? ''}`;
    expect(text).toContain('Why:');
    expect(text).toContain('input.txt');
    expect(text).toContain('default whole-tree inputs');
  });

  it('revalidates each recovery scope against its recorded inputs and refreshes on change', async () => {
    await readyVerify();
    for (const scope of ['build', 'verify']) {
      const check = await cli(
        'check',
        'run',
        'demo',
        scope,
        '--local',
        '--',
        process.execPath,
        'check.cjs',
      );
      expect(check.exitCode, check.stderr).toBe(0);
    }
    const scan = vi.spyOn(checkSnapshot, 'collectCheckSnapshot');
    const first = await cli('state', 'check', 'demo', 'verify', '--recover', '--json');
    expect(first.exitCode, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout!).data.evidence.scopes).toEqual({
      build: 'revalidated',
      verify: 'revalidated',
    });
    // Each scope diffs against its own execution-time manifest.
    expect(scan).toHaveBeenCalledTimes(2);
    await fs.writeFile(path.join(root, 'input.txt'), 'bad');
    const second = await cli('state', 'check', 'demo', 'verify', '--recover', '--json');
    expect(JSON.parse(second.stdout!).data.evidence.scopes).toEqual({
      build: 'rerun-required',
      verify: 'rerun-required',
    });
    expect(scan).toHaveBeenCalledTimes(4);
  });

  it.each(['non-local', 'changed-input', 'damaged-log'])(
    'requires new evidence after recovery of %s checks',
    async (reason) => {
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
        await fs.writeFile(path.join(root, JSON.parse(result.stdout!).data.logRef), 'tampered');
      }
      const recovered = await cli('state', 'check', 'demo', 'verify', '--recover', '--json');
      expect(JSON.parse(recovered.stdout!).data.evidence.scopes.verify).toBe('rerun-required');
      expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
    },
  );

  it('does not resurrect stale evidence when inputs are restored after recovery', async () => {
    await readyVerify();
    await cli('check', 'run', 'demo', 'verify', '--local', '--', process.execPath, 'check.cjs');
    await fs.writeFile(path.join(root, 'input.txt'), 'bad');
    await cli('state', 'check', 'demo', 'verify', '--recover');
    await fs.writeFile(path.join(root, 'input.txt'), 'good');
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
  });

  it('does not bind success when the command changes its own inputs', async () => {
    await readyVerify();
    const result = await cli(
      'check',
      'run',
      'demo',
      'verify',
      '--local',
      '--',
      process.execPath,
      '-e',
      "require('fs').writeFileSync('input.txt', 'changed')",
    );
    expect(result.exitCode).not.toBe(0);
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

  it('includes tracked, staged, and untracked inputs in Git projects', async () => {
    spawnSync('git', ['init'], { cwd: root });
    spawnSync('git', ['add', 'input.txt'], { cwd: root });
    await readyVerify();
    await cli('check', 'run', 'demo', 'verify', '--local', '--', process.execPath, 'check.cjs');
    await fs.writeFile(path.join(root, 'new-config.json'), '{}');
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
  });

  it.each(['package-lock.json', '.comet/config.yaml', 'tests/acceptance.test.js'])(
    'invalidates a changed %s',
    async (file) => {
      await readyVerify();
      const target = path.join(root, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (file !== '.comet/config.yaml') await fs.writeFile(target, 'before');
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
            'check.cjs',
          )
        ).exitCode,
      ).toBe(0);
      await fs.appendFile(target, '\n# changed\n');
      expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
    },
  );

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

  it('allows only one of two concurrent guarded phase transitions to succeed', async () => {
    await readyVerify();
    await cli('check', 'run', 'demo', 'verify', '--', process.execPath, 'check.cjs');
    const results = await Promise.all([
      cli('guard', 'demo', 'verify', '--apply'),
      cli('guard', 'demo', 'verify', '--apply'),
    ]);
    expect(results.filter((result) => result.exitCode === 0)).toHaveLength(1);
    expect((await cli('state', 'get', 'demo', 'check_epoch')).stdout?.trim()).toBe('1');
  });

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
