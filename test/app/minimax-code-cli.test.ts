import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'comet.js');

describe('MiniMax Code CLI lifecycle', () => {
  let temporaryRoot: string;
  let projectRoot: string;
  let homeDir: string;

  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 120_000);

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-minimax-cli-'));
    projectRoot = path.join(temporaryRoot, 'project');
    homeDir = path.join(temporaryRoot, 'home');
    await fs.mkdir(projectRoot);
    await fs.mkdir(homeDir);
  });

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  function runCli(...args: string[]) {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        XDG_CONFIG_HOME: path.join(homeDir, '.config'),
        APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
        COMET_DATA_DIR: path.join(homeDir, '.comet'),
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return JSON.parse(result.stdout);
  }

  it.each(['project', 'global'] as const)(
    'initializes, diagnoses, updates, and uninstalls %s Skills while preserving user files',
    async (scope) => {
      const baseDir = scope === 'global' ? homeDir : projectRoot;
      const platformRoot = path.join(baseDir, '.minimax');
      const userSkill = path.join(platformRoot, 'skills', 'my-skill', 'SKILL.md');
      const settings = path.join(platformRoot, 'config.yaml');
      await fs.mkdir(path.dirname(userSkill), { recursive: true });
      await fs.writeFile(userSkill, '# User Skill\n');
      await fs.writeFile(settings, 'userSetting: true\n');
      await fs.writeFile(path.join(projectRoot, 'AGENTS.md'), '# Project instructions\n');

      runCli(
        'init',
        projectRoot,
        '--platform',
        'minimax-code',
        '--scope',
        scope,
        '--workflow',
        'native',
        '--language',
        'zh',
        '--codegraph',
        'skip',
        '--yes',
      );

      const skillFile = path.join(platformRoot, 'skills', 'comet-native', 'SKILL.md');
      const installed = await fs.readFile(skillFile, 'utf8');
      expect(installed).toContain('comet-native');
      expect(runCli('doctor', projectRoot, '--scope', scope)).toMatchObject({ healthy: true });
      if (scope === 'project') {
        expect(await fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toContain(
          'comet.resume_probe.v2',
        );
      }

      await fs.writeFile(skillFile, 'Stale managed Skill\n');
      runCli(
        'update',
        projectRoot,
        '--platform',
        'minimax-code',
        '--scope',
        scope,
        '--skip-self-update',
        '--language',
        'zh',
        '--yes',
      );
      expect(await fs.readFile(skillFile, 'utf8')).toBe(installed);
      expect(runCli('doctor', projectRoot, '--scope', scope)).toMatchObject({ healthy: true });

      runCli('uninstall', projectRoot, '--scope', scope, '--force');
      await expect(fs.access(skillFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(userSkill, 'utf8')).toBe('# User Skill\n');
      expect(await fs.readFile(settings, 'utf8')).toBe('userSetting: true\n');
      expect(await fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toContain(
        '# Project instructions',
      );
      expect(await fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).not.toContain(
        'comet.resume_probe.v2',
      );
      for (const unsupported of ['rules', 'hooks.json', 'settings.local.json']) {
        await expect(fs.access(path.join(platformRoot, unsupported))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
      for (const unrelated of ['.claude', '.codex', '.agents']) {
        await expect(fs.access(path.join(baseDir, unrelated))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
    },
  );
});
