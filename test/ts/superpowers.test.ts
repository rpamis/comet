import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

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
      const { SKILLS_AGENT_MAP } = await import('../../src/core/superpowers.js');
      expect(SKILLS_AGENT_MAP['claude']).toBe('claude-code');
    });

    it('maps cursor unchanged', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../src/core/superpowers.js');
      expect(SKILLS_AGENT_MAP['cursor']).toBe('cursor');
    });

    it('maps roocode to roo', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../src/core/superpowers.js');
      expect(SKILLS_AGENT_MAP['roocode']).toBe('roo');
    });

    it('maps kilocode to kilo', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../src/core/superpowers.js');
      expect(SKILLS_AGENT_MAP['kilocode']).toBe('kilo');
    });

    it('maps auggie to augment', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../src/core/superpowers.js');
      expect(SKILLS_AGENT_MAP['auggie']).toBe('augment');
    });

    it('maps forgecode unchanged', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../src/core/superpowers.js');
      expect(SKILLS_AGENT_MAP['forgecode']).toBe('forgecode');
    });

    it('maps platforms to valid skills CLI agent ids', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../src/core/superpowers.js');
      expect(SKILLS_AGENT_MAP['gemini']).toBe('gemini-cli');
      expect(SKILLS_AGENT_MAP['qwen']).toBe('qwen-code');
      expect(SKILLS_AGENT_MAP['kiro']).toBe('kiro-cli');
      expect(SKILLS_AGENT_MAP['kimicode']).toBe('kimi-code-cli');
      expect(SKILLS_AGENT_MAP['iflow']).toBe('iflow-cli');
      expect(SKILLS_AGENT_MAP['factory']).toBe('droid');
      expect(SKILLS_AGENT_MAP['amazon-q']).toBe('universal');
      expect(SKILLS_AGENT_MAP['costrict']).toBe('universal');
      expect(SKILLS_AGENT_MAP['lingma']).toBeNull();
    });

    it('has entries for all 29 platforms', async () => {
      const { SKILLS_AGENT_MAP } = await import('../../src/core/superpowers.js');
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
        'amazon-q',
        'qwen',
        'kilocode',
        'auggie',
        'kiro',
        'kimicode',
        'lingma',
        'junie',
        'codebuddy',
        'costrict',
        'crush',
        'factory',
        'iflow',
        'pi',
        'qoder',
        'antigravity',
        'bob',
        'forgecode',
        'trae',
      ];
      for (const id of platformIds) {
        expect(SKILLS_AGENT_MAP).toHaveProperty(id);
      }
      expect(Object.keys(SKILLS_AGENT_MAP)).toHaveLength(29);
    });
  });

  describe('installSuperpowersForPlatforms', () => {
    it('installs superpowers for valid platform ids', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('installed'));

      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
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

    it('builds command + args for install flags', async () => {
      const { buildSuperpowersInstallCommand } = await import('../../src/core/superpowers.js');

      expect(
        buildSuperpowersInstallCommand('/tmp/test', 'project', ['claude', 'cursor']),
      ).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['skills', 'add', 'obra/superpowers', '-y', '--agent', 'claude-code', '--agent', 'cursor'],
      });
    });

    it('excludes Lingma from the skills CLI command because skills@1.5.7 does not support it', async () => {
      const { buildSuperpowersInstallCommand } = await import('../../src/core/superpowers.js');

      expect(
        buildSuperpowersInstallCommand('/tmp/test', 'project', ['claude', 'lingma']),
      ).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['skills', 'add', 'obra/superpowers', '-y', '--agent', 'claude-code'],
      });
    });

    it('builds a staging command for Lingma so skills can be copied into .lingma', async () => {
      const { buildLingmaSuperpowersStageCommand } = await import('../../src/core/superpowers.js');

      expect(buildLingmaSuperpowersStageCommand()).toEqual({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['skills', 'add', 'obra/superpowers', '-y', '--agent', 'claude-code'],
      });
    });

    it('passes -g flag for global scope', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('installed'));

      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      await installSuperpowersForPlatforms('/tmp/test', 'global', ['claude']);

      const args = mockedExecFileSync.mock.calls[0][1] as string[];
      expect(args).toContain('-g');
    });

    it('throws when unknown platform ids are passed', async () => {
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      await expect(
        installSuperpowersForPlatforms('/tmp/test', 'project', ['unknown-platform']),
      ).rejects.toThrow('Unknown platform IDs: unknown-platform');
      expect(mockedExecFileSync).not.toHaveBeenCalled();
    });

    it('returns failed when execFileSync throws', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('install failed');
      });

      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
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
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
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
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
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
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
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
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
      const result = await installSuperpowersForPlatforms('/tmp/test', 'project', ['claude']);

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No error output captured'));
      errorSpy.mockRestore();
    });

    it('formats non-object command errors defensively', async () => {
      const { formatCommandErrorDetails } = await import('../../src/core/command-error.js');

      expect(formatCommandErrorDetails(null)).toEqual(['Unknown error occurred']);
      expect(formatCommandErrorDetails(undefined)).toEqual(['Unknown error occurred']);
    });

    it('throws when mixed with unknown platform ids', async () => {
      const { installSuperpowersForPlatforms } = await import('../../src/core/superpowers.js');
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
