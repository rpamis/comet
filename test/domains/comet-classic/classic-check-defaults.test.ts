import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { collectCheckSnapshot } from '../../../domains/comet-classic/classic-check-snapshot.js';
import { readCheckPolicy } from '../../../domains/comet-classic/classic-check-policy.js';
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
const snapshot = () =>
  collectCheckSnapshot(root, path.join(root, 'openspec/changes/demo'), identity);
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
      'setTimeout(() => {}, 200)',
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

it('already excludes untracked ignored outputs in the public default check surface', async () => {
  await prepare('compat');
  await put('.gitignore', '.vite/\ncoverage/\nbin/\nobj/\n');
  const script = `for (const dir of ['.vite', 'coverage', 'bin', 'obj']) { require('fs').mkdirSync(dir, { recursive: true }); require('fs').writeFileSync(dir + '/result', 'generated'); }`;
  const result = await invoke(
    'check',
    'run',
    'demo',
    'build',
    '--',
    process.execPath,
    '-e',
    script,
  );
  expect(result.exitCode, result.stdout).toBe(0);
  expect(result.response.data.inputBefore).toBe(result.response.data.inputAfter);
});

it('reports undeclared output drift and accepts only explicitly selected output presets', async () => {
  await prepare('compat');
  const argv = [
    process.execPath,
    '-e',
    `require('fs').mkdirSync('.vite', { recursive: true }); require('fs').writeFileSync('.vite/result', String(Date.now()));`,
  ];
  const failed = await invoke('check', 'run', 'demo', 'build', '--', ...argv);
  expect(failed.exitCode, failed.stdout).toBe(1);
  expect(failed.response.stderr).toContain('.vite/result');
  await policy({ argv, presets: ['vite'] });
  const passed = await invoke('check', 'run', 'demo', 'build', '--', ...argv);
  expect(passed.exitCode, passed.stdout).toBe(0);
  expect(passed.response.data.inputBefore).toBe(passed.response.data.inputAfter);
});

it('includes ignored files explicitly declared by glob, including new files', async () => {
  await put('.gitignore', 'fixtures/generated/\n');
  await put('fixtures/generated/a.json', 'one');
  await policy({ files: ['fixtures/generated/**'] });
  const first = await snapshot();
  expect(first.entries.map((entry) => entry.p)).toContain('fixtures/generated/a.json');
  await put('fixtures/generated/a.json', 'two');
  const second = await snapshot();
  expect(second.digest).not.toBe(first.digest);
  await put('fixtures/generated/b.json', 'new');
  expect((await snapshot()).digest).not.toBe(second.digest);
});

it('expands output presets canonically without dropping source or dependency inputs', async () => {
  await policy({ presets: ['vite', 'coverage', 'dotnet'] });
  const first = await snapshot();
  for (const output of [
    '.vite/cache',
    'packages/ui/.vite/cache',
    'coverage/report',
    'packages/api/bin/app',
    'packages/api/obj/app',
    '.nyc_output/data',
  ])
    await put(output, 'output');
  expect((await snapshot()).digest).toBe(first.digest);
  const declaration = await readCheckPolicy(root, identity);
  await policy({ outputs: declaration.outputs, presets: ['dotnet', 'vite', 'coverage', 'vite'] });
  expect((await snapshot()).digest).toBe(first.digest);
  await put('src/source.ts', 'source');
  const source = await snapshot();
  expect(source.digest).not.toBe(first.digest);
  await put('node_modules/.modules.yaml', 'dependencies');
  expect((await snapshot()).digest).not.toBe(source.digest);
});

it.each([{ presets: ['unknown'] }, { presets: 'vite' }, { presets: [false] }])(
  'rejects invalid presets %j',
  async ({ presets }) => {
    await policy({ presets });
    await expect(snapshot()).rejects.toThrow(/preset/iu);
  },
);

it('does not ignore tracked inputs just because a gitignore rule matches', async () => {
  await put('.gitignore', 'generated/\n');
  await put('generated/input.json', 'one');
  execFileSync('git', ['add', '-f', 'generated/input.json'], { cwd: root });
  const first = await snapshot();
  expect(first.entries.map((entry) => entry.p)).toContain('generated/input.json');
  await put('generated/input.json', 'two');
  expect((await snapshot()).digest).not.toBe(first.digest);
});

it('includes ignored directory inputs and node_modules inputs when explicitly declared', async () => {
  await put('.gitignore', 'fixtures/\nnode_modules/\n');
  await put('fixtures/input.json', 'one');
  await put('node_modules/local-fixture/value.json', 'one');
  await policy({ files: ['fixtures', 'node_modules/local-fixture/**'] });
  const first = await snapshot();
  expect(first.entries.map((entry) => entry.p)).toEqual(
    expect.arrayContaining(['fixtures/input.json', 'node_modules/local-fixture/value.json']),
  );
  await put('fixtures/next.json', 'new');
  expect((await snapshot()).digest).not.toBe(first.digest);
});

it('keeps explicitly selected output directories neutral outside Git too', async () => {
  await fs.rm(path.join(root, '.git'), { recursive: true, force: true });
  await policy({ presets: ['vite', 'coverage', 'dotnet'] });
  const first = await snapshot();
  await put('.vite/result', 'cache');
  await put('bin/result', 'output');
  await put('coverage/result', 'report');
  expect((await snapshot()).digest).toBe(first.digest);
});

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

it('does not treat source files named bin or coverage as preset output directories', async () => {
  await policy({ presets: ['dotnet', 'coverage'] });
  const first = await snapshot();
  await put('bin', 'source script');
  await put('coverage', 'source script');
  const next = await snapshot();
  expect(next.digest).not.toBe(first.digest);
  expect(next.entries.map((entry) => entry.p)).toEqual(expect.arrayContaining(['bin', 'coverage']));
});

it('still binds policy file bytes when the command declares the policy itself as input', async () => {
  await policy({ files: ['.comet/check-policy.json'], presets: ['vite'] });
  const first = await snapshot();
  expect(first.entries.map((entry) => entry.p)).toContain('.comet/check-policy.json');
  await fs.appendFile(path.join(root, '.comet/check-policy.json'), '\n');
  expect((await snapshot()).digest).not.toBe(first.digest);
});

it('keeps new intermediate directories containing only declared outputs neutral outside Git', async () => {
  await fs.rm(path.join(root, '.git'), { recursive: true, force: true });
  await policy({ presets: ['vite', 'coverage', 'dotnet'] });
  const first = await snapshot();
  await put('packages/new-app/.vite/result', 'cache');
  await put('packages/new-service/obj/result', 'output');
  const outputs = await snapshot();
  expect(outputs.digest).toBe(first.digest);
  await put('packages/new-app/source.ts', 'real input');
  expect((await snapshot()).digest).not.toBe(first.digest);
});
