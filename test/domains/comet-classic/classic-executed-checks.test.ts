import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

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
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

  it('invalidates previous evidence on cold recovery and returns structured context', async () => {
    await readyVerify();
    await cli('check', 'run', 'demo', 'verify', '--local', '--', process.execPath, 'check.cjs');
    const result = await cli('state', 'check', 'demo', 'verify', '--recover', '--json');
    expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
    expect(JSON.parse(result.stdout!).data).toMatchObject({
      change: 'demo',
      phase: 'verify',
      evidence: { status: 'rerun-required' },
    });
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

  it('uses non-local evidence once and never turns it into a cache entry', async () => {
    await readyVerify();
    expect(
      (await cli('check', 'run', 'demo', 'verify', '--', process.execPath, 'check.cjs')).exitCode,
    ).toBe(0);
    expect((await cli('guard', 'demo', 'verify')).exitCode).toBe(0);
    expect((await cli('guard', 'demo', 'verify')).exitCode).not.toBe(0);
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
