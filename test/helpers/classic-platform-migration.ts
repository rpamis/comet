import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, vi } from 'vitest';
import { runClassicCli } from '../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../domains/comet-classic/classic-sdk-status.js';
import { prepareClassicLegacyProject } from './classic-project.js';
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
export async function fixture(entry: 'source' | 'generated', runtime: 'compat' | 'sdk' = 'sdk') {
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
