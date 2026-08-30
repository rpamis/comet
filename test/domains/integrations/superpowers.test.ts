import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);
const SUPERPOWERS_SKILL_ARGS = [
  '--skill',
  'brainstorming',
  '--skill',
  'dispatching-parallel-agents',
  '--skill',
  'executing-plans',
  '--skill',
  'finishing-a-development-branch',
  '--skill',
  'receiving-code-review',
  '--skill',
  'requesting-code-review',
  '--skill',
  'subagent-driven-development',
  '--skill',
  'systematic-debugging',
  '--skill',
  'test-driven-development',
  '--skill',
  'using-git-worktrees',
  '--skill',
  'verification-before-completion',
  '--skill',
  'writing-plans',
  '--skill',
  'writing-skills',
];

function expectedSuperpowersArgs(...suffix: string[]): string[] {
  return ['skills', 'add', 'obra/superpowers', '-y', ...SUPERPOWERS_SKILL_ARGS, ...suffix];
}

describe('superpowers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SKILLS_AGENT_MAP', () => {
    it('maps claude to claude-code', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../../domains/integrations/superpowers.js');
      expect(SKILLS_AGENT_MAP['claude']).toBe('claude-code');
    });

    it('maps cursor unchanged', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../../domains/integrations/superpowers.js');
      expect(SKILLS_AGENT_MAP['cursor']).toBe('cursor');
    });

    it('maps roocode to roo', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../../domains/integrations/superpowers.js');
      expect(SKILLS_AGENT_MAP['roocode']).toBe('roo');
    });

    it('maps kilocode to kilo', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../../domains/integrations/superpowers.js');
      expect(SKILLS_AGENT_MAP['kilocode']).toBe('kilo');
    });

    it('maps auggie to augment', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../../domains/integrations/superpowers.js');
      expect(SKILLS_AGENT_MAP['auggie']).toBe('augment');
    });

    it('maps forgecode unchanged', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../../domains/integrations/superpowers.js');
      expect(SKILLS_AGENT_MAP['forgecode']).toBe('forgecode');
    });

    it('maps platforms to valid skills CLI agent ids', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../../domains/integrations/superpowers.js');
      expect(SKILLS_AGENT_MAP['gemini']).toBe('gemini-cli');
      expect(SKILLS_AGENT_MAP['grok']).toBeNull();
      expect(SKILLS_AGENT_MAP['qwen']).toBe('qwen-code');
      expect(SKILLS_AGENT_MAP['kiro']).toBe('kiro-cli');
      expect(SKILLS_AGENT_MAP['kimicode']).toBe('kimi-code-cli');
      expect(SKILLS_AGENT_MAP['iflow']).toBe('iflow-cli');
      expect(SKILLS_AGENT_MAP['factory']).toBe('droid');
      expect(SKILLS_AGENT_MAP['amazon-q']).toBe('universal');
      expect(SKILLS_AGENT_MAP['costrict']).toBe('universal');
      expect(SKILLS_AGENT_MAP['lingma']).toBeNull();
      expect(SKILLS_AGENT_MAP['zcode']).toBeNull();
      expect(SKILLS_AGENT_MAP['mimocode']).toBeNull();
      expect(SKILLS_AGENT_MAP['oh-my-pi']).toBeNull();
      expect(SKILLS_AGENT_MAP['dsh']).toBeNull();
    });

    it('has entries for all 37 platforms', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../../domains/integrations/superpowers.js');
      const platformIds = [
        'claude',
        'cursor',
        'codex',
        'opencode',
        'windsurf',
        'cline',
        'roocode',
        'continue',
        'github-copilot',
        'gemini',
        'grok',
        'amazon-q',
        'qwen',
        'kilocode',
        'auggie',
        'kiro',
        'kimicode',
        'lingma',
        'junie',
        'codebuddy',
        'workbuddy',
        'costrict',
        'crush',
        'factory',
        'iflow',
        'pi',
        'oh-my-pi',
        'qoder',
        'antigravity',
        'antigravity2',
        'bob',
        'forgecode',
        'trae',
        'trae-cn',
        'zcode',
        'mimocode',
        'dsh',
      ];
      for (const id of platformIds) {
        expect(SKILLS_AGENT_MAP).toHaveProperty(id);
      }
      expect(Object.keys(SKILLS_AGENT_MAP)).toHaveLength(37);
    });
  });

  describe('installSuperpowersForPlatforms', () => {
    it('installs superpowers for valid platform ids', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('installed'));

      const { installSuperpowersForPlatforms } =
        await import('../../../domains/integrations/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', [
        'claude',
        'cursor',
      ]);

      expect(result).toBe('installed');
      const command = mockedExecFileSync.mock.calls[0][0] as string;
      const args = mockedExecFileSync.mock.calls[0][1] as string[];
      expect(command).toBe(process.platform === 'win32' ? 'npx.cmd' : 'npx');
      expect(args).toContain('skills');
      expect(args).toContain('add');
      expect(args).toContain('obra/superpowers');
      expect(args).toContain('-y');
      expect(args).toContain('--agent');
      expect(args).toContain('claude-code');
      expect(args).toContain('cursor');
      expect(mockedExecFileSync.mock.calls[0][2]).toMatchObject({ timeout: 300_000 });
    });

    it('does not select the user-level using-superpowers skill', async () => {
      const { buildSuperpowersInstallCommand } =
        await import('../../../domains/integrations/superpowers.js');

      const { args } = buildSuperpowersInstallCommand('/tmp/test', 'global', ['claude']);
      const selectedSkills = args.flatMap((arg, index) =>
        arg === '--skill' ? [args[index + 1]] : [],
      );

      expect(selectedSkills).toEqual(
        SUPERPOWERS_SKILL_ARGS.filter((arg) => arg !== '--skill').filter(
          (arg) => arg !== 'using-superpowers',
        ),
      );
      expect(selectedSkills).not.toContain('using-superpowers');
    });

    it('copies staged Grok Superpowers and writes a Comet install manifest', async () => {
      const projectDir = mkdtempSync(path.join(os.tmpdir(), 'comet-superpowers-grok-'));
      mockedExecFileSync.mockImplementation((_command, _args, options) => {
        const cwd = (options as { cwd?: string } | undefined)?.cwd ?? projectDir;
        mkdirSync(path.join(cwd, '.claude', 'skills', 'brainstorming'), { recursive: true });
        writeFileSync(
          path.join(cwd, '.claude', 'skills', 'brainstorming', 'SKILL.md'),
          '# Brainstorming\n',
        );
        return Buffer.from('installed');
      });

      try {
        const { installSuperpowersForPlatforms, getStagedSuperpowersManifestPath } =
          await import('../../../domains/integrations/superpowers.js');
        const result = await installSuperpowersForPlatforms(projectDir, 'project', ['grok']);

        expect(result).toBe('installed');
        expect(
          existsSync(path.join(projectDir, '.grok', 'skills', 'brainstorming', 'SKILL.md')),
        ).toBe(true);
        const manifestPath = getStagedSuperpowersManifestPath(projectDir, '.grok');
        expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual({
          source: 'obra/superpowers',
          skills: ['brainstorming'],
        });
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('does not copy using-superpowers from a staged installation', async () => {
      const projectDir = mkdtempSync(path.join(os.tmpdir(), 'comet-superpowers-filter-'));
      mockedExecFileSync.mockImplementation((_command, _args, options) => {
        const cwd = (options as { cwd?: string } | undefined)?.cwd ?? projectDir;
        for (const skillName of ['brainstorming', 'using-superpowers']) {
          mkdirSync(path.join(cwd, '.claude', 'skills', skillName), { recursive: true });
          writeFileSync(path.join(cwd, '.claude', 'skills', skillName, 'SKILL.md'), '# Skill\n');
        }
        return Buffer.from('installed');
      });

      try {
        const { installSuperpowersForPlatforms } =
          await import('../../../domains/integrations/superpowers.js');

        await expect(installSuperpowersForPlatforms(projectDir, 'project', ['grok'])).resolves.toBe(
          'installed',
        );
        expect(existsSync(path.join(projectDir, '.grok', 'skills', 'brainstorming'))).toBe(true);
        expect(existsSync(path.join(projectDir, '.grok', 'skills', 'using-superpowers'))).toBe(
          false,
        );
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('preserves an existing user-owned using-superpowers skill', async () => {
      const projectDir = mkdtempSync(path.join(os.tmpdir(), 'comet-superpowers-existing-'));
      const existingUserSkill = path.join(
        projectDir,
        '.grok',
        'skills',
        'using-superpowers',
        'SKILL.md',
      );
      mkdirSync(path.dirname(existingUserSkill), { recursive: true });
      writeFileSync(existingUserSkill, '# Existing user skill\n', 'utf8');
      mockedExecFileSync.mockImplementation((_command, _args, options) => {
        const cwd = (options as { cwd?: string } | undefined)?.cwd ?? projectDir;
        mkdirSync(path.join(cwd, '.claude', 'skills', 'using-superpowers'), { recursive: true });
        writeFileSync(
          path.join(cwd, '.claude', 'skills', 'using-superpowers', 'SKILL.md'),
          '# Updated source skill\n',
        );
        return Buffer.from('installed');
      });

      try {
        const { installSuperpowersForPlatforms } =
          await import('../../../domains/integrations/superpowers.js');

        await expect(installSuperpowersForPlatforms(projectDir, 'project', ['grok'])).resolves.toBe(
          'installed',
        );
        expect(readFileSync(existingUserSkill, 'utf8')).toBe('# Existing user skill\n');
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('builds command + args for install flags', async () => {
      const { buildSuperpowersInstallCommand } =
        await import('../../../domains/integrations/superpowers.js');

      expect(buildSuperpowersInstallCommand('/tmp/test', 'project', ['claude', 'cursor'])).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: expectedSuperpowersArgs('--agent', 'claude-code', '--agent', 'cursor'),
      });
    });

    it('excludes Lingma from the skills CLI command because skills@1.5.7 does not support it', async () => {
      const { buildSuperpowersInstallCommand } =
        await import('../../../domains/integrations/superpowers.js');

      expect(buildSuperpowersInstallCommand('/tmp/test', 'project', ['claude', 'lingma'])).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: expectedSuperpowersArgs('--agent', 'claude-code'),
      });
    });

    it('builds a staging command for Lingma so skills can be copied into .lingma', async () => {
      const { buildLingmaSuperpowersStageCommand } =
        await import('../../../domains/integrations/superpowers.js');

      expect(buildLingmaSuperpowersStageCommand()).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: expectedSuperpowersArgs('--agent', 'claude-code'),
      });
    });

    it('builds a staging command for ZCode so skills can be copied into .zcode', async () => {
      const { buildZCodeSuperpowersStageCommand } =
        await import('../../../domains/integrations/superpowers.js');

      expect(buildZCodeSuperpowersStageCommand()).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: expectedSuperpowersArgs('--agent', 'claude-code'),
      });
    });

    it('builds a staging command for MimoCode so skills can be copied into .mimocode', async () => {
      const { buildMimoCodeSuperpowersStageCommand } =
        await import('../../../domains/integrations/superpowers.js');

      expect(buildMimoCodeSuperpowersStageCommand()).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: expectedSuperpowersArgs('--agent', 'claude-code'),
      });
    });

    it('builds a staging command for Oh My Pi so skills can be copied into .omp', async () => {
      const { buildOhMyPiSuperpowersStageCommand } =
        await import('../../../domains/integrations/superpowers.js');

      expect(buildOhMyPiSuperpowersStageCommand()).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: expectedSuperpowersArgs('--agent', 'claude-code'),
      });
    });

    it('builds a staging command for dsh so skills can be copied into .dsh', async () => {
      const { buildDshSuperpowersStageCommand } =
        await import('../../../domains/integrations/superpowers.js');

      expect(buildDshSuperpowersStageCommand()).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: expectedSuperpowersArgs('--agent', 'claude-code'),
      });
    });

    it('installs ZCode superpowers via the claude-code staging flow', async () => {
      mockedExecFileSync.mockImplementation((command: unknown, args?: unknown, opts?: unknown) => {
        const cmd = String(command);
        const cmdArgs = Array.isArray(args) ? args.map((arg) => String(arg)) : [];
        if (
          (cmd === 'npx' || cmd === 'npx.cmd') &&
          cmdArgs[0] === 'skills' &&
          cmdArgs.includes('claude-code')
        ) {
          const cwd = (opts as { cwd?: string } | undefined)?.cwd ?? os.tmpdir();
          const stagedSkillsDir = path.join(cwd, '.claude', 'skills', 'brainstorming');
          mkdirSync(stagedSkillsDir, { recursive: true });
          return Buffer.from('installed');
        }
        return Buffer.from('');
      });

      const { installSuperpowersForPlatforms } =
        await import('../../../domains/integrations/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['zcode']);

      expect(result).toBe('installed');
      const stagingCall = mockedExecFileSync.mock.calls.find((call) => {
        const cmdArgs = Array.isArray(call[1]) ? call[1].map((a) => String(a)) : [];
        return cmdArgs.includes('claude-code') && cmdArgs.includes('obra/superpowers');
      });
      expect(stagingCall).toBeDefined();
    });

    it('installs MimoCode superpowers via the claude-code staging flow', async () => {
      mockedExecFileSync.mockImplementation((command: unknown, args?: unknown, opts?: unknown) => {
        const cmd = String(command);
        const cmdArgs = Array.isArray(args) ? args.map((arg) => String(arg)) : [];
        if (
          (cmd === 'npx' || cmd === 'npx.cmd') &&
          cmdArgs[0] === 'skills' &&
          cmdArgs.includes('claude-code')
        ) {
          const cwd = (opts as { cwd?: string } | undefined)?.cwd ?? os.tmpdir();
          const stagedSkillsDir = path.join(cwd, '.claude', 'skills', 'brainstorming');
          mkdirSync(stagedSkillsDir, { recursive: true });
          return Buffer.from('installed');
        }
        return Buffer.from('');
      });

      const projectPath = mkdtempSync(path.join(os.tmpdir(), 'comet-mimocode-superpowers-'));
      try {
        const { installSuperpowersForPlatforms } =
          await import('../../../domains/integrations/superpowers.js');
        const result = await installSuperpowersForPlatforms(projectPath, 'project', ['mimocode']);

        expect(result).toBe('installed');
        const stagingCall = mockedExecFileSync.mock.calls.find((call) => {
          const cmdArgs = Array.isArray(call[1]) ? call[1].map((a) => String(a)) : [];
          return cmdArgs.includes('claude-code') && cmdArgs.includes('obra/superpowers');
        });
        expect(stagingCall).toBeDefined();
      } finally {
        rmSync(projectPath, { recursive: true, force: true });
      }
    });

    it('installs Oh My Pi superpowers into the native .omp skills root', async () => {
      mockedExecFileSync.mockImplementation(
        (_command: unknown, _args?: unknown, opts?: unknown) => {
          const cwd = (opts as { cwd?: string } | undefined)?.cwd ?? os.tmpdir();
          mkdirSync(path.join(cwd, '.claude', 'skills', 'brainstorming'), { recursive: true });
          return Buffer.from('installed');
        },
      );
      const projectPath = mkdtempSync(path.join(os.tmpdir(), 'comet-oh-my-pi-superpowers-'));
      try {
        const { installSuperpowersForPlatforms } =
          await import('../../../domains/integrations/superpowers.js');

        await expect(
          installSuperpowersForPlatforms(projectPath, 'project', ['oh-my-pi']),
        ).resolves.toBe('installed');
        expect(existsSync(path.join(projectPath, '.omp', 'skills', 'brainstorming'))).toBe(true);
      } finally {
        rmSync(projectPath, { recursive: true, force: true });
      }
    });

    it('installs dsh superpowers into the native .dsh skills root', async () => {
      mockedExecFileSync.mockImplementation(
        (_command: unknown, _args?: unknown, opts?: unknown) => {
          const cwd = (opts as { cwd?: string } | undefined)?.cwd ?? os.tmpdir();
          mkdirSync(path.join(cwd, '.claude', 'skills', 'brainstorming'), { recursive: true });
          return Buffer.from('installed');
        },
      );
      const projectPath = mkdtempSync(path.join(os.tmpdir(), 'comet-dsh-superpowers-'));
      try {
        const { installSuperpowersForPlatforms } =
          await import('../../../domains/integrations/superpowers.js');

        await expect(installSuperpowersForPlatforms(projectPath, 'project', ['dsh'])).resolves.toBe(
          'installed',
        );
        expect(existsSync(path.join(projectPath, '.dsh', 'skills', 'brainstorming'))).toBe(true);
      } finally {
        rmSync(projectPath, { recursive: true, force: true });
      }
    });

    it('does not overwrite a user-owned dsh Superpowers name', async () => {
      mockedExecFileSync.mockImplementation(
        (_command: unknown, _args?: unknown, opts?: unknown) => {
          const cwd = (opts as { cwd?: string } | undefined)?.cwd ?? os.tmpdir();
          mkdirSync(path.join(cwd, '.claude', 'skills', 'brainstorming'), { recursive: true });
          return Buffer.from('installed');
        },
      );
      const projectPath = mkdtempSync(path.join(os.tmpdir(), 'comet-dsh-superpowers-owned-'));
      try {
        const userSkill = path.join(projectPath, '.dsh', 'skills', 'brainstorming', 'SKILL.md');
        mkdirSync(path.dirname(userSkill), { recursive: true });
        writeFileSync(userSkill, '# User skill\n', 'utf8');

        const { installSuperpowersForPlatforms } =
          await import('../../../domains/integrations/superpowers.js');
        await expect(installSuperpowersForPlatforms(projectPath, 'project', ['dsh'])).resolves.toBe(
          'installed',
        );
        expect(readFileSync(userSkill, 'utf8')).toBe('# User skill\n');
      } finally {
        rmSync(projectPath, { recursive: true, force: true });
      }
    });

    it('passes -g flag for global scope', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('installed'));

      const { installSuperpowersForPlatforms } =
        await import('../../../domains/integrations/superpowers.js');
      await installSuperpowersForPlatforms('/tmp/test', 'global', ['claude']);

      const args = mockedExecFileSync.mock.calls[0][1] as string[];
      expect(args).toContain('-g');
    });

    it('throws when unknown platform ids are passed', async () => {
      const { installSuperpowersForPlatforms } =
        await import('../../../domains/integrations/superpowers.js');
      await expect(
        installSuperpowersForPlatforms('/tmp/test', 'project', ['unknown-platform']),
      ).rejects.toThrow('Unknown platform IDs: unknown-platform');
      expect(mockedExecFileSync).not.toHaveBeenCalled();
    });

    it('returns failed when execFileSync throws', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('install failed');
      });

      const { installSuperpowersForPlatforms } =
        await import('../../../domains/integrations/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
    });

    it('shows stderr details when execFileSync fails', async () => {
      const error = new Error('Command failed: npx skills add ...') as Error & { stderr?: Buffer };
      error.stderr = Buffer.from('fatal: unable to access: Failed to connect to github.com');
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installSuperpowersForPlatforms } =
        await import('../../../domains/integrations/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('fatal: unable to access: Failed to connect to github.com'),
      );
      errorSpy.mockRestore();
    });

    it('shows stdout details when execFileSync fails', async () => {
      const error = new Error('Command failed: npx skills add ...') as Error & { stdout?: Buffer };
      error.stdout = Buffer.from('request to github.com timed out');
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installSuperpowersForPlatforms } =
        await import('../../../domains/integrations/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('request to github.com timed out'),
      );
      errorSpy.mockRestore();
    });

    it('shows ENOENT fallback when command is not found', async () => {
      const error = new Error('spawnSync ENOENT') as Error & { code?: string };
      error.code = 'ENOENT';
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installSuperpowersForPlatforms } =
        await import('../../../domains/integrations/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Command not found'));
      errorSpy.mockRestore();
    });

    it('shows generic fallback when output is empty without error code', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('Command failed: npx skills add ...');
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installSuperpowersForPlatforms } =
        await import('../../../domains/integrations/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No error output captured'));
      errorSpy.mockRestore();
    });

    it('formats non-object command errors defensively', async () => {
      const { formatCommandErrorDetails } =
        await import('../../../platform/process/command-error.js');

      expect(formatCommandErrorDetails(null)).toEqual(['Unknown error occurred']);
      expect(formatCommandErrorDetails(undefined)).toEqual(['Unknown error occurred']);
    });

    it('throws when mixed with unknown platform ids', async () => {
      const { installSuperpowersForPlatforms } =
        await import('../../../domains/integrations/superpowers.js');
      await expect(
        installSuperpowersForPlatforms('/tmp/test', 'project', [
          'claude',
          'unknown-1',
          'cursor',
          'unknown-2',
        ]),
      ).rejects.toThrow('Unknown platform IDs: unknown-1, unknown-2');
    });
  });
});
