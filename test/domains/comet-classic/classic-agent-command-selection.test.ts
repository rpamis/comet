import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { executeClassicSdkCommandCheck } from '../../../domains/comet-classic/classic-sdk-check.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it.each(
  ['compat', 'sdk'].flatMap((runtime) =>
    ['source', 'generated'].map((entry) => [runtime, entry] as const),
  ),
)(
  'runs only the Agent-selected Build command for %s through %s',
  async (runtime, entry) => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-agent-command-'));
    roots.push(base);
    const root = path.join(base, 'project'),
      home = path.join(base, 'home');
    await fs.mkdir(home);
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
    vi.stubEnv('COMET_SKIP_BUILD', undefined);
    await prepareClassicLegacyProject(root);
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    const invoke = async (...args: string[]) => {
      const separator = args.indexOf('--');
      args.splice(separator < 0 ? args.length : separator, 0, '--json');
      if (entry === 'source') return runClassicCli(args, undefined, { invocationCwd: root });
      const result = spawnSync(
        process.execPath,
        [path.resolve('assets/skills/comet/scripts/comet-runtime.mjs'), ...args],
        { cwd: root, encoding: 'utf8', windowsHide: true },
      );
      return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    };
    const cli = async (...args: string[]) => {
      const r = await invoke(...args);
      expect(r.exitCode, r.stdout ?? r.stderr).toBe(0);
      return JSON.parse(r.stdout!).data;
    };
    await cli('state', 'init', 'demo', 'tweak', '--runtime', runtime, '--isolation', 'current');
    const change = path.join(root, 'openspec/changes/demo');
    await fs.writeFile(
      path.join(change, 'proposal.md'),
      '# Proposal\nKeep the selected behavior.\n',
    );
    await fs.writeFile(path.join(change, 'design.md'), '# Design\nKeep the existing interface.\n');
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
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { build: 'node build.cjs' } }),
    );
    await fs.writeFile(
      path.join(root, 'build.cjs'),
      "require('node:fs').appendFileSync('build-count','x')",
    );
    await invoke('state', 'next', 'demo');
    const preview = await invoke('guard', 'demo', 'build');
    await expect(fs.stat(path.join(root, 'build-count'))).rejects.toMatchObject({ code: 'ENOENT' });
    const missing = await invoke('guard', 'demo', 'build', '--apply');
    expect(missing.exitCode).not.toBe(0);
    expect((missing.stdout ?? '') + (missing.stderr ?? '')).toMatch(/explicit|明确|选择/);
    await expect(fs.stat(path.join(root, 'build-count'))).rejects.toMatchObject({ code: 'ENOENT' });
    if (runtime === 'sdk')
      await cli('guard', 'demo', 'build', '--apply', '--', process.execPath, 'build.cjs');
    else {
      await cli('check', 'run', 'demo', 'build', '--local', '--', process.execPath, 'build.cjs');
      await cli('guard', 'demo', 'build', '--apply');
    }
    expect(await fs.readFile(path.join(root, 'build-count'), 'utf8')).toBe('x');
  },
  120000,
);

it.each(['source', 'generated'] as const)(
  'continues the original Classic check receipt without SDK parameters or repeated execution through %s',
  async (entry) => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-agent-continue-'));
    roots.push(base);
    const root = path.join(base, 'project'),
      home = path.join(base, 'home');
    await fs.mkdir(home);
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
    await prepareClassicLegacyProject(root);
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    const invoke = async (...args: string[]) => {
      if (entry === 'source')
        return runClassicCli([...args, '--json'], undefined, {
          projectRoot: root,
          invocationCwd: root,
        });
      const r = spawnSync(
        process.execPath,
        [path.resolve('assets/skills/comet/scripts/comet-runtime.mjs'), ...args, '--json'],
        { cwd: root, encoding: 'utf8', windowsHide: true },
      );
      return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    };
    const cli = async (...args: string[]) => {
      const r = await invoke(...args);
      expect(r.exitCode, r.stdout ?? r.stderr).toBe(0);
      return JSON.parse(r.stdout!).data;
    };
    await cli('state', 'init', 'demo', 'tweak', '--runtime', 'sdk', '--isolation', 'current');
    const change = path.join(root, 'openspec/changes/demo');
    await fs.writeFile(path.join(change, 'proposal.md'), 'Keep the selected behavior.\n');
    await fs.writeFile(path.join(change, 'design.md'), 'Reuse the current interface.\n');
    await fs.writeFile(
      path.join(change, 'tasks.md'),
      '- [x] Keep behavior <!-- comet-task:worker -->\n',
    );
    const open = await cli('guard', 'demo', 'open');
    await cli('guard', 'demo', 'open', '--apply', '--approval-hash', open.approvalHash);
    await cli('state', 'complete-build', 'demo', '--session', 'actual-builder');
    await fs.writeFile(
      path.join(root, 'build.cjs'),
      "require('node:fs').appendFileSync('build-count','x')",
    );
    const owned = await inspectClassicSdkRun(root, 'demo');
    const checked = await executeClassicSdkCommandCheck(
      owned.runtime,
      {
        runId: owned.run.runId,
        projectRoot: root,
        argv: [process.execPath, 'build.cjs'],
        cwd: '.',
        reusable: true,
      },
      owned.run,
    );
    expect(checked.evidenceWaits?.some((wait) => wait.status === 'pending')).toBe(true);
    const action = checked.actions.at(-1)!;
    const preview = await cli('state', 'next', 'demo');
    expect(preview.continuation.commandArgs).toEqual([
      'comet',
      'state',
      'next',
      'demo',
      '--continue',
      '--json',
    ]);
    expect(preview.continuation.requiredInputs).toEqual([]);
    expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(checked);
    const continued = await cli('state', 'next', 'demo', '--continue');
    expect(continued.phase).toBe('verify');
    const after = (await inspectClassicSdkRun(root, 'demo')).run;
    expect(after.runId).toBe(checked.runId);
    expect(after.actions.find((entry) => entry.id === action.id)).toEqual(action);
    expect(after.evidenceWaits?.filter((wait) => wait.status === 'pending')).toEqual([]);
    await cli('state', 'next', 'demo', '--continue');
    expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(after);
    expect(await fs.readFile(path.join(root, 'build-count'), 'utf8')).toBe('x');
  },
  120000,
);
