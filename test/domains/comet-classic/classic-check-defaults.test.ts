import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readCheckPolicy } from '../../../domains/comet-classic/classic-check-policy.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

let root: string;
const identity = { argv: [process.execPath, 'check.cjs'], cwd: '.' };
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-check-defaults-'));
  await prepareClassicLegacyProject(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
});
async function put(ref: string, text: string) {
  await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
  await fs.writeFile(path.join(root, ref), text);
}
async function invoke(...args: string[]) {
  const separator = args.indexOf('--');
  args.splice(separator < 0 ? args.length : separator, 0, '--json');
  const result = await runClassicCli(args, undefined, { invocationCwd: root });
  return { ...result, response: JSON.parse(result.stdout ?? '{}') };
}
async function cli(...args: string[]) {
  const result = await invoke(...args);
  expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
  return result.response.data;
}
async function prepare(runtime: 'compat' | 'sdk') {
  await cli('state', 'init', 'demo', 'tweak', '--runtime', runtime, '--isolation', 'current');
  await put('openspec/changes/demo/proposal.md', '# Proposal\nFix source.\n');
  await put('openspec/changes/demo/design.md', '# Design\nKeep public behavior.\n');
  await put('openspec/changes/demo/tasks.md', '- [x] Fix source <!-- comet-task:source -->\n');
  const open = await cli('guard', 'demo', 'open');
  await cli(
    'guard',
    'demo',
    'open',
    '--apply',
    ...(runtime === 'sdk' ? ['--approval-hash', open.approvalHash] : []),
  );
  if (runtime === 'sdk') await cli('state', 'complete-build', 'demo');
}
const policy = (command: Record<string, unknown>) =>
  put(
    '.comet/check-policy.json',
    JSON.stringify({ version: 2, commands: [{ ...identity, ...command }] }),
  );

it.each(['compat', 'sdk'] as const)(
  'applies project timeout to the public %s check run',
  async (runtime) => {
    await prepare(runtime);
    await fs.appendFile(path.join(root, '.comet/config.yaml'), '  check_timeout_ms: 25\n');
    const result = await invoke(
      'check',
      'run',
      'demo',
      'build',
      '--',
      process.execPath,
      '-e',
      // 保持命令存活到超时终止，避免它在 Windows taskkill 枚举期间自然退出。
      'setTimeout(() => {}, 20000)',
    );
    expect(result.exitCode, result.stdout).toBe(124);
    expect(result.response.data.timeoutMs).toBe(25);
  },
);

it.each(['compat', 'sdk'] as const)(
  'lets explicit CLI timeout override the project default for %s',
  async (runtime) => {
    await prepare(runtime);
    await fs.appendFile(path.join(root, '.comet/config.yaml'), '  check_timeout_ms: 1\n');
    const result = await invoke(
      'check',
      'run',
      'demo',
      'build',
      '--timeout-ms',
      '5000',
      '--',
      process.execPath,
      '-e',
      'setTimeout(() => {}, 50)',
    );
    expect(result.exitCode, result.stdout).toBe(0);
    expect(result.response.data.timeoutMs).toBe(5000);
  },
);

it.each([{ presets: ['unknown'] }, { presets: 'vite' }, { presets: [false] }])(
  'rejects invalid presets %j',
  async ({ presets }) => {
    await policy({ presets });
    await expect(readCheckPolicy(root, identity)).rejects.toThrow(/preset/iu);
  },
);

it('does not reuse a command executed under a different explicit timeout', async () => {
  await prepare('compat');
  const argv = [process.execPath, '-e', 'setTimeout(() => {}, 50)'];
  const first = await cli(
    'check',
    'run',
    'demo',
    'build',
    '--local',
    '--timeout-ms',
    '5000',
    '--',
    ...argv,
  );
  expect(first.exitCode).toBe(0);
  const second = await invoke(
    'check',
    'run',
    'demo',
    'build',
    '--local',
    '--timeout-ms',
    '1',
    '--',
    ...argv,
  );
  expect(second.exitCode, second.stdout).toBe(124);
  expect(second.response.data.timeoutMs).toBe(1);
  expect(second.response.data.reused).not.toBe(true);
});

it('rerun preserves the previous resolved timeout rather than a changed project default', async () => {
  await prepare('compat');
  const configPath = path.join(root, '.comet/config.yaml');
  const initialConfig = await fs.readFile(configPath, 'utf8');
  await fs.writeFile(configPath, initialConfig + '  check_timeout_ms: 5000\n');
  const first = await cli(
    'check',
    'run',
    'demo',
    'build',
    '--',
    process.execPath,
    '-e',
    'setTimeout(() => {}, 50)',
  );
  expect(first.timeoutMs).toBe(5000);
  await fs.writeFile(configPath, initialConfig + '  check_timeout_ms: 1\n');
  const rerun = await cli('check', 'rerun', 'demo', 'build');
  expect(rerun.timeoutMs).toBe(5000);
});
