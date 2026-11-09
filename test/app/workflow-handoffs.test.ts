import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import { prepareClassicLegacyProject } from '../helpers/classic-project.js';

const repository = path.resolve('.');
const roots: string[] = [];
beforeAll(() => ensureCliBuilt(repository), 120_000);
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const resolved = await fs.realpath(root);
    if (
      path.dirname(resolved) !== (await fs.realpath(os.tmpdir())) ||
      !path.basename(resolved).startsWith('comet-cli-handoffs-')
    )
      throw new Error('Unexpected test cleanup target');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

it('reports live command progress before a Classic CLI check finishes', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-handoffs-'));
  roots.push(base);
  const root = path.join(base, 'project'),
    home = path.join(base, 'home');
  await fs.mkdir(home);
  await prepareClassicLegacyProject(root);
  await fs.appendFile(path.join(root, '.comet/config.yaml'), '  document_evidence: strict\n');
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData/Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData/Local'),
    XDG_DATA_HOME: path.join(home, '.local/share'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_CONFIG_SYSTEM: path.join(home, 'git-system'),
    COMET_DAEMON: 'off',
    COMET_SKIP_UPDATE_CHECK: '1',
    NODE_OPTIONS: '',
    COMET_TASK: '',
    COMET_TASK_PHASE: '',
    COMET_TASK_PATH: '',
  };
  const runProcess = (program: string, args: string[], input?: string) =>
    spawnSync(program, args, {
      cwd: root,
      env,
      encoding: 'utf8',
      input,
      timeout: 90_000,
      windowsHide: true,
    });
  expect(runProcess('git', ['init', '-b', 'main']).status).toBe(0);
  expect(
    runProcess('git', [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ]).status,
  ).toBe(0);
  const node = globalThis.process.execPath;
  const cli = (...args: string[]) =>
    runProcess(node, [path.join(repository, 'bin/comet.js'), ...args]);
  const checked = (...args: string[]) => {
    const result = cli(...args);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return { result, body: JSON.parse(result.stdout) };
  };
  checked(
    'state',
    'init',
    'demo',
    'tweak',
    '--isolation',
    'current',
    '--runtime',
    'compat',
    '--json',
  );
  checked('state', 'select', 'demo', '--json');
  const change = path.join(root, 'openspec/changes/demo');
  for (const [name, source] of Object.entries({
    'proposal.md': '# Proposal\nPreserve the worker.\n',
    'design.md': '# Design\nKeep output one.\n',
    'tasks.md': '- [x] Keep worker behavior\n',
  }))
    await fs.writeFile(path.join(change, name), source);
  await fs.writeFile(path.join(root, 'worker.py'), 'value = 1\n');
  checked('guard', 'demo', 'open', '--apply', '--json');
  const marker = path.join(base, 'executions');
  const argv = [
    node,
    '-e',
    "setTimeout(()=>require('node:fs').appendFileSync(process.argv[1],'checked\\n'),8000)",
    marker,
  ];
  await fs.writeFile(
    path.join(root, '.comet/check-policy.json'),
    JSON.stringify({ version: 2, commands: [{ argv, cwd: '.', files: ['worker.py'] }] }),
  );
  const live = await new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
    progressBeforeFinish: boolean;
  }>((resolve, reject) => {
    const child = spawn(
      node,
      [
        path.join(repository, 'bin/comet.js'),
        'check',
        'run',
        'demo',
        'build',
        '--json',
        '--',
        ...argv,
      ],
      { cwd: root, env, timeout: 90_000, windowsHide: true },
    );
    let stdout = '',
      stderr = '',
      progressBeforeFinish = false;
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.includes('[Comet]') && !existsSync(marker)) progressBeforeFinish = true;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr, progressBeforeFinish }));
  });
  expect(live.status, live.stderr || live.stdout).toBe(0);
  expect(live.progressBeforeFinish).toBe(true);
  const build = { body: JSON.parse(live.stdout), result: live };
  expect(build.body.data.exitCode).toBe(0);
  expect(await fs.readFile(marker, 'utf8')).toBe('checked\n');
  expect(build.result.stderr).toContain('[Comet]');
});
