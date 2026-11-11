import '../../helpers/isolated-agent-home.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) =>
      fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    ),
  );
});
async function fixture(entry: 'source' | 'generated', runtime: 'compat' | 'sdk' = 'sdk') {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-migration-fixture-'));
  roots.push(base);
  const root = path.join(base, 'project');
  await prepareClassicLegacyProject(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const invoke = async (...args: string[]) => {
    const sep = args.indexOf('--');
    args.splice(sep < 0 ? args.length : sep, 0, '--json');
    if (entry === 'source')
      return runClassicCli(args, undefined, {
        projectRoot: root,
        invocationCwd: root,
      });
    const child = spawnSync(
      process.execPath,
      [path.resolve('assets/skills/comet/scripts/comet-runtime.mjs'), ...args],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    return {
      exitCode: child.status ?? 1,
      stdout: child.stdout,
      stderr: child.stderr,
    };
  };
  const cli = async (...args: string[]) => {
    const r = await invoke(...args);
    expect(r.exitCode, r.stdout || r.stderr).toBe(0);
    return JSON.parse(r.stdout!).data;
  };
  await cli('state', 'init', 'demo', 'tweak', '--runtime', runtime, '--isolation', 'current');
  const change = path.join(root, 'openspec/changes/demo');
  await fs.writeFile(path.join(change, 'proposal.md'), '# Proposal\nKeep selected behavior.\n');
  await fs.writeFile(path.join(change, 'design.md'), '# Design\nKeep interface.\n');
  await fs.writeFile(
    path.join(change, 'tasks.md'),
    '- [x] Keep behavior <!-- comet-task:worker -->\n',
  );
  const open = await cli('guard', 'demo', 'open');
  await cli(
    'guard',
    'demo',
    'open',
    '--apply',
    ...(runtime === 'sdk' ? ['--approval-hash', open.approvalHash] : []),
  );
  const inspect = async () => (await inspectClassicSdkRun(root, 'demo')).run;
  const report = async (label: string, code = 0) => {
    let actual = 0;
    try {
      execFileSync(
        process.execPath,
        [
          '-e',
          "require('node:fs').appendFileSync(process.argv[1],process.argv[2]+'\\n');process.exit(Number(process.argv[3]))",
          path.join(base, 'platform-count'),
          label,
          String(code),
        ],
        { cwd: root, stdio: 'ignore' },
      );
    } catch (e) {
      actual = (e as { status: number }).status;
    }
    expect(actual).toBe(code);
    await fs.writeFile(
      path.join(root, 'checks.json'),
      JSON.stringify({
        checks: [
          {
            name: label,
            result: actual === 0 ? 'passed' : 'failed',
            note: 'Observed external process exit ' + actual,
          },
        ],
      }),
    );
  };
  return { base, root, change, invoke, cli, inspect, report };
}
it.each(['source', 'generated'] as const)(
  'runs only the Agent-selected Build command through %s',
  async (entry) => {
    const f = await fixture(entry);
    await fs.writeFile(
      path.join(f.root, 'package.json'),
      JSON.stringify({ scripts: { build: 'node inferred.cjs' } }),
    );
    await fs.writeFile(
      path.join(f.root, 'inferred.cjs'),
      "require('node:fs').writeFileSync('inferred-count','bad')",
    );
    await f.cli('state', 'next', 'demo');
    await f.invoke('guard', 'demo', 'build');
    await expect(fs.stat(path.join(f.root, 'inferred-count'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const before = await f.inspect();
    const missing = await f.invoke('guard', 'demo', 'build', '--apply');
    expect(missing.exitCode).not.toBe(0);
    expect(await f.inspect()).toEqual(before);
    const guide = await f.cli(
      'check',
      'run',
      'demo',
      'build',
      '--',
      process.execPath,
      'inferred.cjs',
    );
    expect(guide).toMatchObject({
      status: 'platform-execution-required',
      checksExecuted: false,
    });
    await expect(fs.stat(path.join(f.root, 'inferred-count'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await f.report('selected-build');
    await f.cli('guard', 'demo', 'build', '--apply', '--checks', 'checks.json');
    expect((await f.inspect()).state).toMatchObject({ phase: 'verify' });
    expect(await fs.readFile(path.join(f.base, 'platform-count'), 'utf8')).toBe('selected-build\n');
    await expect(fs.stat(path.join(f.root, 'inferred-count'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  },
);
it.each(['source', 'generated'] as const)(
  'continues a submitted platform report without repeated execution through %s',
  async (entry) => {
    const f = await fixture(entry);
    await f.report('actual-builder');
    await f.cli(
      'state',
      'complete-build',
      'demo',
      '--session',
      'actual-builder',
      '--checks',
      'checks.json',
    );
    const before = await f.inspect();
    const action = before.actions.findLast((a) => a.stepId === 'tweak.build.execute')!;
    expect(action.outcome!.output).toMatchObject({
      checks: [{ name: 'actual-builder', result: 'passed' }],
    });
    await f.cli('state', 'next', 'demo');
    expect(await f.inspect()).toEqual(before);
    await f.cli('state', 'next', 'demo', '--continue');
    await f.cli('state', 'next', 'demo', '--continue');
    const after = await f.inspect();
    expect(after.runId).toBe(before.runId);
    expect(after.actions.find((a) => a.id === action.id)).toEqual(action);
    expect(after).toEqual(before);
    expect(await fs.readFile(path.join(f.base, 'platform-count'), 'utf8')).toBe('actual-builder\n');
  },
);
it.each(['source', 'generated'] as const)(
  'does not promote an actual failed report using an older successful report through %s',
  async (entry) => {
    const f = await fixture(entry);
    await f.report('build-pass');
    await f.cli('state', 'complete-build', 'demo', '--checks', 'checks.json');
    const reportRef = 'docs/superpowers/reports/verify.md';
    await fs.mkdir(path.dirname(path.join(f.root, reportRef)), {
      recursive: true,
    });
    await fs.writeFile(path.join(f.root, reportRef), '# Verify\nFailure requires repair.\n');
    await f.report('verify-failed', 7);
    const before = await f.inspect();
    const rejected = await f.invoke(
      'guard',
      'demo',
      'verify',
      '--report',
      reportRef,
      '--apply',
      '--checks',
      'checks.json',
    );
    expect(rejected.exitCode).not.toBe(0);
    expect(await f.inspect()).toEqual(before);
    await f.cli(
      'state',
      'transition',
      'demo',
      'verify-fail',
      '--reason',
      'Actual command exited 7.',
    );
    const failed = await f.inspect();
    expect(failed.runId).toBe(before.runId);
    expect(failed.state).toMatchObject({
      phase: 'build',
      verifyResult: 'fail',
      verifyFailures: 1,
    });
    expect(
      failed.actions.findLast((a) => a.stepId === 'tweak.verify.run')?.outcome?.output,
    ).toMatchObject({
      event: 'verify-fail',
      reason: 'Actual command exited 7.',
    });
    expect(await fs.readFile(path.join(f.base, 'platform-count'), 'utf8')).toBe(
      'build-pass\nverify-failed\n',
    );
  },
);
it.each(['source', 'generated'] as const)(
  'keeps literal argv and cwd in platform guidance without executing through %s',
  async (entry) => {
    const f = await fixture(entry);
    const argv = [
      process.execPath,
      '-e',
      "require('node:fs').writeFileSync('must-not-run','bad')",
      '--',
      '--json',
      '--help',
      'a & b',
    ];
    const before = await f.inspect();
    const guide = await f.cli('check', 'run', 'demo', 'verify', '--cwd', 'openspec', '--', ...argv);
    expect(guide).toMatchObject({
      status: 'platform-execution-required',
      checksExecuted: false,
      platformCommand: { argv, cwd: path.join(f.root, 'openspec') },
    });
    expect(await f.inspect()).toEqual(before);
    await expect(fs.stat(path.join(f.root, 'openspec/must-not-run'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const escaped = await f.invoke(
      'check',
      'run',
      'demo',
      'verify',
      '--cwd',
      '..',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    expect(escaped.exitCode).not.toBe(0);
    expect(await f.inspect()).toEqual(before);
  },
);
it.each(['source', 'generated'] as const)(
  'continues accepted Verify report and preserves Archive approval without legacy receipts through %s',
  async (entry) => {
    const { assertVerifyEvidenceCurrent } =
      await import('../../../domains/comet-classic/classic-sdk-archive-preflight.js');
    const f = await fixture(entry);
    await f.report('build');
    await f.cli('state', 'complete-build', 'demo', '--checks', 'checks.json');
    const reportRef = 'docs/superpowers/reports/accepted.md';
    await fs.mkdir(path.dirname(path.join(f.root, reportRef)), {
      recursive: true,
    });
    await fs.writeFile(path.join(f.root, reportRef), '# Verification\nActual command completed.\n');
    await f.report('verify');
    await f.cli(
      'guard',
      'demo',
      'verify',
      '--report',
      reportRef,
      '--apply',
      '--checks',
      'checks.json',
    );
    const before = await f.inspect();
    const original = before.actions.findLast((a) => a.stepId === 'tweak.verify.run')!;
    expect(before.actions.some((a) => a.ref === 'classic-check')).toBe(false);
    await assertVerifyEvidenceCurrent(before, f.root, before.state as never);
    for (const kind of ['wrong-reference', 'latest-failure'] as const) {
      const changed = structuredClone(before);
      const verified = changed.actions.find((a) => a.id === original.id)!;
      if (kind === 'wrong-reference')
        (verified.outcome!.output as any).verificationReport += '.other';
      else (verified.outcome!.output as any).checks[0].result = 'failed';
      await expect(
        assertVerifyEvidenceCurrent(changed, f.root, changed.state as never),
      ).rejects.toThrow();
    }
    const blocked = await f.invoke('guard', 'demo', 'archive', '--apply');
    expect(blocked.exitCode).not.toBe(0);
    expect(await f.inspect()).toEqual(before);
    await f.cli('state', 'next', 'demo', '--continue');
    await f.cli('state', 'next', 'demo', '--continue');
    expect(await f.inspect()).toEqual(before);
    const proposal = await f.cli(
      'state',
      'propose-archive',
      'demo',
      '--summary',
      'Archive the actual report locally.',
    );
    const pending = await f.inspect();
    expect(pending.waits.find((w) => w.id === proposal.wait.id)?.status).toBe('pending');
    expect(pending.actions.find((a) => a.id === original.id)).toEqual(original);
    await f.cli(
      'state',
      'decide-archive',
      'demo',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    const approved = await f.inspect();
    expect(approved.runId).toBe(before.runId);
    expect(approved.waits.find((w) => w.id === proposal.wait.id)?.decision?.choice).toBe('local');
    expect(approved.actions.find((a) => a.id === original.id)).toEqual(original);
    expect(await fs.readFile(path.join(f.base, 'platform-count'), 'utf8')).toBe('build\nverify\n');
  },
);

it.each(['source', 'generated'] as const)(
  'retains Compat selection and real platform reports without Runtime execution through %s',
  async (entry) => {
    const { readClassicState } = await import('../../../domains/comet-classic/classic-store.js');
    const f = await fixture(entry, 'compat');
    await fs.writeFile(
      path.join(f.root, 'package.json'),
      JSON.stringify({ scripts: { build: 'node inferred.cjs' } }),
    );
    await fs.writeFile(
      path.join(f.root, 'inferred.cjs'),
      "require('node:fs').writeFileSync('inferred-count','bad')",
    );
    await f.cli('state', 'next', 'demo');
    await f.invoke('guard', 'demo', 'build');
    const missing = await f.invoke('guard', 'demo', 'build', '--apply');
    expect(missing.exitCode).not.toBe(0);
    await expect(fs.stat(path.join(f.root, 'inferred-count'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const guide = await f.cli(
      'check',
      'run',
      'demo',
      'build',
      '--',
      process.execPath,
      'inferred.cjs',
    );
    expect(guide).toMatchObject({
      status: 'platform-execution-required',
      checksExecuted: false,
    });
    await f.report('selected-compat');
    await f.cli(
      'state',
      'record-check',
      'demo',
      'build',
      '--command',
      'actual Agent selected command',
      '--exit-code',
      '0',
    );
    await f.cli('guard', 'demo', 'build', '--apply');
    expect((await readClassicState(f.change, { migrate: false })).classic).toMatchObject({
      phase: 'verify',
    });
    expect(await fs.readFile(path.join(f.base, 'platform-count'), 'utf8')).toBe(
      'selected-compat\n',
    );
    await expect(fs.stat(path.join(f.root, 'inferred-count'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  },
);
