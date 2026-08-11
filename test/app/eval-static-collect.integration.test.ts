import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const temporary: string[] = [];

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
    temporary.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })),
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
      ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
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
});
