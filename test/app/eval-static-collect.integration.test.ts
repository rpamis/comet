import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const temporary: string[] = [];

async function snapshotTree(root: string): Promise<string[]> {
  const entries: string[] = [];
  const walk = async (current: string) => {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort()) {
      const target = path.join(current, entry.name);
      const relative = path.relative(root, target);
      if (entry.isSymbolicLink()) {
        entries.push(`${relative}:link:${await fs.readlink(target)}`);
      } else if (entry.isDirectory()) {
        await walk(target);
      } else {
        entries.push(`${relative}:file:${(await fs.readFile(target)).toString('base64')}`);
      }
    }
  };
  await walk(root);
  return entries;
}

async function installWorkloadSentinels(root: string) {
  const marker = path.join(root, 'sentinel.log');
  const bin = path.join(root, 'sentinel-bin');
  const preload = path.join(root, 'sentinel-preload.cjs');
  await fs.mkdir(bin, { recursive: true });
  for (const command of ['uv', 'docker', 'claude', 'codex', 'qodercli', 'codebuddy']) {
    const suffix = process.platform === 'win32' ? '.cmd' : '';
    const target = path.join(bin, `${command}${suffix}`);
    const body =
      process.platform === 'win32'
        ? `@echo off\necho ${command}>>"%COMET_EVAL_SENTINEL%"\nexit /b 97\n`
        : `#!/bin/sh\nprintf '%s\\n' '${command}' >> "$COMET_EVAL_SENTINEL"\nexit 97\n`;
    await fs.writeFile(target, body, 'utf8');
    if (process.platform !== 'win32') await fs.chmod(target, 0o755);
  }
  await fs.writeFile(
    preload,
    `const fs = require('fs');
const Module = require('module');
const marker = process.env.COMET_EVAL_SENTINEL;
const hit = (value) => { fs.appendFileSync(marker, value + '\\n'); throw new Error('static collect touched a forbidden boundary'); };
for (const name of ['connect', 'request']) {
  for (const moduleName of ['net', 'tls', 'http', 'https']) {
    try { require(moduleName)[name] = () => hit('network:' + moduleName); } catch {}
  }
}
global.fetch = () => hit('network:fetch');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) { if (/langsmith|langfuse|anthropic|openai|qoder|codebuddy/i.test(request)) hit('sdk:' + request); return originalLoad.call(this, request, parent, isMain); };
`,
    'utf8',
  );
  return { marker, bin, preload };
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, shell = false) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell,
    env,
  });
}

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((entry) =>
      fs.rm(entry, {
        recursive: true,
        force: true,
        maxRetries: process.platform === 'win32' ? 8 : 0,
        retryDelay: process.platform === 'win32' ? 100 : 0,
      }),
    ),
  );
});

describe('packaged static collect', () => {
  it('collects from a packed npm install for a fresh owner without an owner venv, cache, sync, or network', async () => {
    const owner = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-fresh-owner-'));
    temporary.push(owner);
    const packageDir = path.join(owner, 'package');
    await fs.mkdir(packageDir);
    const isolatedEnv = {
      ...process.env,
      npm_config_ignore_scripts: 'true',
      BENCH_CC_MODEL: undefined,
      ANTHROPIC_MODEL: undefined,
      OPENAI_MODEL: undefined,
      BENCH_CODEX_MODEL: undefined,
    };
    const pack = run(
      'pnpm',
      ['pack', '--pack-destination', packageDir],
      process.cwd(),
      isolatedEnv,
      process.platform === 'win32',
    );
    expect(pack.status, `${pack.stdout}\n${pack.stderr}`).toBe(0);
    const tarball = path.join(
      packageDir,
      (await fs.readdir(packageDir)).find((entry) => entry.endsWith('.tgz'))!,
    );
    const consumer = path.join(owner, 'consumer');
    await fs.mkdir(consumer);
    await fs.writeFile(path.join(consumer, 'package.json'), '{"private":true}\n', 'utf8');
    const installed = run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
      consumer,
      isolatedEnv,
      process.platform === 'win32',
    );
    expect(installed.status, `${installed.stdout}\n${installed.stderr}`).toBe(0);
    const skill = path.join(owner, 'skill');
    await fs.mkdir(skill);
    await fs.writeFile(path.join(skill, 'SKILL.md'), '# Temporary skill\n', 'utf8');

    const result = spawnSync(
      process.execPath,
      [
        path.join(consumer, 'node_modules', '@rpamis', 'comet', 'bin', 'comet.js'),
        'eval',
        skill,
        '--collect',
        '--project',
        owner,
      ],
      {
        cwd: owner,
        encoding: 'utf8',
        env: {
          ...isolatedEnv,
          UV_OFFLINE: '1',
          UV_NO_SYNC: '1',
          UV_PROJECT_ENVIRONMENT: path.join(owner, '.comet', 'eval', 'cache', 'venv'),
          HTTP_PROXY: 'http://127.0.0.1:9',
          HTTPS_PROXY: 'http://127.0.0.1:9',
        },
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout.split(/\r?\n/u)).toContain('Tasks: pending generation');
    await expect(
      fs.stat(path.join(owner, '.comet', 'eval', 'cache', 'venv')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const manifestDir = path.join(skill, 'comet');
    await fs.mkdir(manifestDir);
    const manifest = path.join(manifestDir, 'eval.yaml');
    await fs.writeFile(
      manifest,
      'apiVersion: comet.eval/v1alpha1\nkind: SkillEvalManifest\nmetadata: { name: temporary }\nskill: { name: temporary, source: .. }\nunknownTopLevel: true\n',
      'utf8',
    );
    const malformed = spawnSync(
      process.execPath,
      [
        path.join(consumer, 'node_modules', '@rpamis', 'comet', 'bin', 'comet.js'),
        'eval',
        manifest,
        '--collect',
        '--project',
        owner,
      ],
      { cwd: owner, encoding: 'utf8', env: isolatedEnv },
    );
    expect(malformed.status).not.toBe(0);
    expect(`${malformed.stdout}\n${malformed.stderr}`).toContain('unknownTopLevel: unknown field');
    await fs.rm(manifest);

    const invalidExplicit = spawnSync(
      process.execPath,
      [
        path.join(consumer, 'node_modules', '@rpamis', 'comet', 'bin', 'comet.js'),
        'eval',
        skill,
        '--collect',
        '--task',
        'not-a-task',
        '--project',
        owner,
      ],
      { cwd: owner, encoding: 'utf8', env: isolatedEnv },
    );
    expect(invalidExplicit.status).not.toBe(0);
    expect(`${invalidExplicit.stdout}\n${invalidExplicit.stderr}`).toContain(
      'Task not found: not-a-task',
    );

    const sourceTask = path.join(skill, 'tasks', 'source-task');
    await fs.mkdir(sourceTask, { recursive: true });
    await fs.writeFile(
      path.join(sourceTask, 'task.toml'),
      '[metadata]\nname = "inferred-source"\n',
      'utf8',
    );
    await fs.writeFile(path.join(sourceTask, 'instruction.md'), 'Do the work.\n', 'utf8');
    await fs.writeFile(
      manifest,
      'apiVersion: comet.eval/v1alpha1\nkind: SkillEvalManifest\nmetadata: { name: temporary }\nskill: { name: temporary, source: .. }\nevaluation:\n  tasks:\n    - source: tasks/source-task\n',
      'utf8',
    );
    const sourceCollected = spawnSync(
      process.execPath,
      [
        path.join(consumer, 'node_modules', '@rpamis', 'comet', 'bin', 'comet.js'),
        'eval',
        manifest,
        '--collect',
        '--project',
        owner,
      ],
      { cwd: owner, encoding: 'utf8', env: isolatedEnv },
    );
    expect(sourceCollected.status, `${sourceCollected.stdout}\n${sourceCollected.stderr}`).toBe(0);
    expect(sourceCollected.stdout).toContain('- inferred-source');
    await fs.rm(manifest);

    const generated = run(
      'uv',
      [
        'run',
        '--offline',
        '--no-sync',
        'python',
        '-c',
        [
          'from pathlib import Path; import sys; from scaffold.python.auto_tasks import ensure_generated_manifest; ensure_generated_manifest(Path(sys.argv[1]), Path(sys.argv[2]), agent="claude-code", model=None, profile="generic", interaction={"mode":"none","max_turns":12}, generate=lambda _: "{\\"tasks\\":[{\\"name\\":\\"generated-one\\",\\"prompt\\":\\"one\\",\\"expect\\":{\\"files\\":[\\"one.txt\\"]}},{\\"name\\":\\"generated-two\\",\\"prompt\\":\\"two\\",\\"expect\\":{\\"files\\":[\\"two.txt\\"]}}]}" )',
        ].join(''),
        skill,
        owner,
      ],
      path.resolve('eval'),
      isolatedEnv,
    );
    expect(generated.status, `${generated.stdout}\n${generated.stderr}`).toBe(0);

    const cached = spawnSync(
      process.execPath,
      [
        path.join(consumer, 'node_modules', '@rpamis', 'comet', 'bin', 'comet.js'),
        'eval',
        skill,
        '--collect',
        '--project',
        owner,
      ],
      { cwd: owner, encoding: 'utf8', env: { ...isolatedEnv, UV_OFFLINE: '1', UV_NO_SYNC: '1' } },
    );
    expect(cached.status, `${cached.stdout}\n${cached.stderr}`).toBe(0);
    expect(cached.stdout).toContain('Tasks: generated cache');
    expect(cached.stdout).toContain('- generated-one');
    expect(cached.stdout).toContain('- generated-two');

    const generatedDirs = await fs.readdir(path.join(owner, '.comet', 'eval', 'generated'));
    const metadata = path.join(
      owner,
      '.comet',
      'eval',
      'generated',
      generatedDirs[0],
      (await fs.readdir(path.join(owner, '.comet', 'eval', 'generated', generatedDirs[0])))[0],
      'generation.json',
    );
    await fs.writeFile(metadata, '{"generation_hash":"mismatch"}\n', 'utf8');
    const corrupt = spawnSync(
      process.execPath,
      [
        path.join(consumer, 'node_modules', '@rpamis', 'comet', 'bin', 'comet.js'),
        'eval',
        skill,
        '--collect',
        '--project',
        owner,
      ],
      { cwd: owner, encoding: 'utf8', env: isolatedEnv },
    );
    expect(corrupt.status, `${corrupt.stdout}\n${corrupt.stderr}`).toBe(0);
    expect(corrupt.stdout.split(/\r?\n/u)).toContain('Tasks: pending generation');
  });

  it('proves taskless collect is zero-workload at the real packaged CLI boundary', async () => {
    const owner = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-sentinel-owner-'));
    temporary.push(owner);
    const packageDir = path.join(owner, 'package');
    await fs.mkdir(packageDir);
    const baseEnv = {
      ...process.env,
      npm_config_ignore_scripts: 'true',
      ANTHROPIC_API_KEY: 'main-secret-value',
      OPENAI_API_KEY: 'main-openai-secret',
      BENCH_JUDGE_API_KEY: 'judge-secret-value',
      LANGSMITH_API_KEY: 'langsmith-secret-value',
      LANGFUSE_PUBLIC_KEY: 'langfuse-public-secret',
      LANGFUSE_SECRET_KEY: 'langfuse-secret-value',
    };
    const pack = run(
      'pnpm',
      ['pack', '--pack-destination', packageDir],
      process.cwd(),
      baseEnv,
      process.platform === 'win32',
    );
    expect(pack.status, `${pack.stdout}\n${pack.stderr}`).toBe(0);
    const tarball = path.join(
      packageDir,
      (await fs.readdir(packageDir)).find((entry) => entry.endsWith('.tgz'))!,
    );
    const consumer = path.join(owner, 'consumer');
    await fs.mkdir(consumer);
    await fs.writeFile(path.join(consumer, 'package.json'), '{"private":true}\n', 'utf8');
    const installed = run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
      consumer,
      baseEnv,
      process.platform === 'win32',
    );
    expect(installed.status, `${installed.stdout}\n${installed.stderr}`).toBe(0);

    const skill = path.join(owner, 'skill');
    await fs.mkdir(skill);
    await fs.writeFile(path.join(skill, 'SKILL.md'), '# Sentinel skill\n', 'utf8');
    const harnessRoot = path.join(consumer, 'node_modules', '@rpamis', 'comet', 'eval');
    const harnessBefore = await snapshotTree(harnessRoot);
    const sentinels = await installWorkloadSentinels(owner);
    temporary.push(sentinels.bin, sentinels.preload, sentinels.marker);
    const env = {
      ...baseEnv,
      PATH: `${sentinels.bin}${path.delimiter}${process.env.PATH ?? ''}`,
      COMET_EVAL_SENTINEL: sentinels.marker,
      NODE_OPTIONS: `--require=${sentinels.preload}`,
      UV_OFFLINE: '1',
      UV_NO_SYNC: '1',
      HTTP_PROXY: 'http://127.0.0.1:9',
      HTTPS_PROXY: 'http://127.0.0.1:9',
    };
    const cli = path.join(consumer, 'node_modules', '@rpamis', 'comet', 'bin', 'comet.js');
    for (const suite of ['local', 'langsmith', 'langfuse']) {
      const result = spawnSync(
        process.execPath,
        [
          '--require',
          sentinels.preload,
          cli,
          'eval',
          skill,
          '--collect',
          '--suite',
          suite,
          '--project',
          owner,
        ],
        { cwd: owner, encoding: 'utf8', env },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain('Tasks: pending generation');
      expect(output).toContain(
        'credentials, Docker, endpoints, plugins, and network were not tested',
      );
      expect(output).not.toContain('secret-value');
    }
    await expect(fs.stat(sentinels.marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await snapshotTree(harnessRoot)).toEqual(harnessBefore);
  });
});
