import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'comet.js');
const OPENSPEC_SKILLS = ['openspec-propose', 'openspec-apply-change'];

/**
 * Put a stand-in for the OpenSpec 2.0.0 CLI on PATH. Like the real 2.0.0, `init --tools <ids>`
 * writes every tool's Skills once to `.agents/skills/` and records the tool ids, one per line, in
 * `.agents/skills/.openspec-target`; it creates no `.opencode` directory. `recordedTargets`
 * overrides the recorded ids to simulate shared output generated for another tool.
 * Version 2.2 defaults to global Skills unless the caller sets the project scope.
 */
async function installFakeOpenSpec2(
  binDir: string,
  { recordedTargets, version = '2.0.0' }: { recordedTargets?: string[]; version?: string } = {},
): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  const script = path.join(binDir, 'openspec.mjs');
  await fs.writeFile(
    script,
    `import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const skills = ${JSON.stringify(OPENSPEC_SKILLS)};
const recordedTargets = ${JSON.stringify(recordedTargets ?? null)};
const version = ${JSON.stringify(version)};
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log(version);
} else if (args[0] === 'init') {
  const target = args[1];
  const tools = args[args.indexOf('--tools') + 1];
  if (tools === 'none') {
    fs.mkdirSync(path.join(target, 'openspec', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(target, 'openspec', 'config.yaml'), 'schema: spec-driven\\n');
  } else {
    const globalSkills = version === '2.2.0' && process.env.OPENSPEC_SKILLS_SCOPE !== 'project';
    if (globalSkills && path.resolve(target) === path.resolve(os.homedir())) {
      console.error('This is your home folder, where the global skills live. Run openspec init inside a project.');
      process.exit(1);
    }
    const root = path.join(globalSkills ? os.homedir() : target, '.agents', 'skills');
    for (const skill of skills) {
      fs.mkdirSync(path.join(root, skill), { recursive: true });
      fs.writeFileSync(path.join(root, skill, 'SKILL.md'), '# OpenSpec 2 ' + skill + '\\n');
    }
    const ids = recordedTargets ?? tools.split(',');
    if (!globalSkills) {
      fs.writeFileSync(path.join(root, '.openspec-target'), ids.join('\\n') + '\\n');
    }
  }
} else {
  process.exit(2);
}
`,
  );
  if (process.platform === 'win32') {
    await fs.writeFile(
      path.join(binDir, 'openspec.cmd'),
      `@"${process.execPath}" "${script}" %*\r\n`,
    );
  } else {
    const launcher = path.join(binDir, 'openspec');
    await fs.writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    await fs.chmod(launcher, 0o755);
  }
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(
    () => true,
    () => false,
  );
}

describe('comet init with OpenSpec 2 shared .agents output', () => {
  let temporaryRoot: string;
  let projectRoot: string;
  let homeDir: string;
  let binDir: string;

  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 120_000);

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-openspec2-init-cli-'));
    projectRoot = path.join(temporaryRoot, 'project');
    homeDir = path.join(temporaryRoot, 'home');
    binDir = path.join(temporaryRoot, 'bin');
    await fs.mkdir(projectRoot);
    await fs.mkdir(homeDir);
  });

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  async function runInit(platform = 'opencode', scope: 'global' | 'project' = 'project') {
    const destination = scope === 'global' ? homeDir : projectRoot;
    // Existing Superpowers Skills keep init from installing them over the network.
    const superpowers = path.join(destination, `.${platform}`, 'skills', 'brainstorming');
    await fs.mkdir(superpowers, { recursive: true });
    await fs.writeFile(path.join(superpowers, 'SKILL.md'), '# Superpowers\n');
    return spawnSync(
      process.execPath,
      [
        cli,
        'init',
        projectRoot,
        '--platform',
        platform,
        '--scope',
        scope,
        '--workflow',
        'classic',
        '--language',
        'en',
        '--codegraph',
        'skip',
        '--yes',
        '--json',
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          HOME: homeDir,
          USERPROFILE: homeDir,
          XDG_CONFIG_HOME: path.join(homeDir, '.config'),
          APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
          LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
          COMET_DATA_DIR: path.join(homeDir, '.comet'),
          OPENSPEC_SKILLS_SCOPE: 'global',
        },
      },
    );
  }

  it('installs OpenCode OpenSpec Skills from the shared .agents output through comet init', async () => {
    await installFakeOpenSpec2(binDir);

    const result = await runInit();

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'complete',
      selectedPlatforms: ['opencode'],
    });
    const skillsRoot = path.join(projectRoot, '.opencode', 'skills');
    for (const skill of OPENSPEC_SKILLS) {
      await expect(fs.readFile(path.join(skillsRoot, skill, 'SKILL.md'), 'utf8')).resolves.toBe(
        `# OpenSpec 2 ${skill}\n`,
      );
    }
    expect(await exists(path.join(skillsRoot, '.openspec-target'))).toBe(false);
    expect(await exists(path.join(projectRoot, '.agents'))).toBe(false);
  }, 180_000);

  it('rejects shared .agents output that OpenSpec generated for another tool', async () => {
    await installFakeOpenSpec2(binDir, { recordedTargets: ['codex'] });

    const result = await runInit();

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stdout + result.stderr).toContain('no tool output for opencode');
    const skillsRoot = path.join(projectRoot, '.opencode', 'skills');
    expect((await fs.readdir(skillsRoot)).filter((entry) => entry.startsWith('openspec-'))).toEqual(
      [],
    );
    expect(await exists(path.join(projectRoot, '.agents'))).toBe(false);
  }, 180_000);

  it.each(['global', 'project'] as const)(
    'installs Cursor OpenSpec 2.2 Skills only in the requested %s scope',
    async (scope) => {
      await installFakeOpenSpec2(binDir, { version: '2.2.0' });
      const result = await runInit('cursor', scope);

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: 'complete',
        selectedPlatforms: ['cursor'],
      });
      const destination = scope === 'global' ? homeDir : projectRoot;
      const otherRoot = scope === 'global' ? projectRoot : homeDir;
      const skillsRoot = path.join(destination, '.cursor', 'skills');
      for (const skill of OPENSPEC_SKILLS) {
        await expect(fs.readFile(path.join(skillsRoot, skill, 'SKILL.md'), 'utf8')).resolves.toBe(
          `# OpenSpec 2 ${skill}\n`,
        );
        expect(await exists(path.join(otherRoot, '.cursor', 'skills', skill))).toBe(false);
      }
      expect(await exists(path.join(projectRoot, 'docs', 'openspec', 'config.yaml'))).toBe(
        scope === 'project',
      );
      expect(await exists(path.join(projectRoot, 'openspec'))).toBe(false);
      expect(await exists(path.join(homeDir, 'openspec'))).toBe(false);
      expect(await exists(path.join(homeDir, '.agents'))).toBe(false);
      expect(await exists(path.join(projectRoot, '.agents'))).toBe(false);
    },
    180_000,
  );
});
