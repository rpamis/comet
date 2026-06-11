import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock child_process
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe('openspec', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('isCommandAvailable', () => {
    it('returns true when command is on PATH', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/node'));
      const { isCommandAvailable } = await import('../../src/core/openspec.js');
      expect(isCommandAvailable('node')).toBe(true);
    });

    it('returns false when command throws', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      const { isCommandAvailable } = await import('../../src/core/openspec.js');
      expect(isCommandAvailable('missing-cmd')).toBe(false);
    });
  });

  describe('installOpenSpec', () => {
    it('installs openspec when CLI is available', async () => {
      // First call: isCommandAvailable succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Second call: npm upgrade succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      // Third call: isCommandAvailable after upgrade succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Fourth call: openspec init succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('ok'));

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude', 'cursor'], 'project');

      expect(result).toBe('installed');
      expect(mockedExecFileSync).toHaveBeenCalledTimes(4);
    });

    it('returns failed when openspec CLI is not available', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      // The npm install call
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('npm failed');
      });

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
    });

    it('shows npm stderr and stdout details when CLI install fails', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      const error = new Error(
        'Command failed: npm install @fission-ai/openspec@latest',
      ) as Error & {
        stderr?: Buffer;
        stdout?: Buffer;
      };
      error.stderr = Buffer.from('npm ERR! request to registry.npmjs.org failed');
      error.stdout = Buffer.from('npm notice retrying request');
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('npm ERR! request to registry.npmjs.org failed'),
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('npm notice retrying request'));
      errorSpy.mockRestore();
    });

    it('does not pass unsupported --global flag for global scope', async () => {
      // First call: isCommandAvailable
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Second call: npm upgrade
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      // Third call: isCommandAvailable after upgrade
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Fourth call: openspec init
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('ok'));

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      await installOpenSpec('/tmp/test', ['claude'], 'global');

      const initExec = mockedExecFileSync.mock.calls[3][0] as string;
      const initArgs = mockedExecFileSync.mock.calls[3][1] as string[];
      expect(initExec).toBe('openspec');
      expect(initArgs).not.toContain('--global');
      expect(initArgs).toContain('--tools');
      expect(initArgs).toContain('claude');
    });

    it('installs OpenSpec with all workflows through an isolated custom profile', async () => {
      // First call: isCommandAvailable
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Second call: npm upgrade
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      // Third call: isCommandAvailable after upgrade
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Fourth call: openspec init
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('ok'));
      const writeSpy = vi.spyOn(fs, 'writeFileSync');

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('installed');
      const initExec = mockedExecFileSync.mock.calls[3][0] as string;
      const initArgs = mockedExecFileSync.mock.calls[3][1] as string[];
      const initOptions = mockedExecFileSync.mock.calls[3][2] as { env?: NodeJS.ProcessEnv };
      expect(initExec).toBe('openspec');
      expect(initArgs).toEqual(['init', '/tmp/test', '--tools', 'claude', '--profile', 'custom']);

      const configHome = initOptions.env?.XDG_CONFIG_HOME;
      expect(configHome).toBeTruthy();
      const configWrite = writeSpy.mock.calls.find(
        ([file]) =>
          typeof file === 'string' && file.replace(/\\/g, '/').endsWith('openspec/config.json'),
      );
      expect(configWrite).toBeTruthy();
      const config = JSON.parse(configWrite?.[1] as string) as {
        profile?: string;
        delivery?: string;
        workflows?: string[];
      };

      expect(config.profile).toBe('custom');
      expect(config.delivery).toBe('both');
      expect(config.workflows).toEqual([
        'propose',
        'explore',
        'new',
        'continue',
        'apply',
        'ff',
        'sync',
        'archive',
        'bulk-archive',
        'verify',
        'onboard',
      ]);
    });

    it('writes the default OpenSpec config under XDG_CONFIG_HOME on non-Windows platforms', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('ok'));
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      const xdgConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-xdg-'));
      vi.stubEnv('XDG_CONFIG_HOME', xdgConfigHome);
      const writeSpy = vi.spyOn(fs, 'writeFileSync');

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('installed');
      expect(
        writeSpy.mock.calls.some(
          ([file]) => file === path.join(xdgConfigHome, 'openspec', 'config.json'),
        ),
      ).toBe(true);
    });

    it('removes a default OpenSpec config backup when writing the replacement config fails', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('ok'));
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      const xdgConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-backup-'));
      vi.stubEnv('XDG_CONFIG_HOME', xdgConfigHome);
      const configDir = path.join(xdgConfigHome, 'openspec');
      const configPath = path.join(configDir, 'config.json');
      const backupPath = configPath + '.comet-backup';
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, '{"existing":true}\n', 'utf-8');
      const originalWriteFileSync = fs.writeFileSync;
      vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
        if (file === configPath) {
          throw new Error('default config write failed');
        }
        return originalWriteFileSync(file, data, options);
      });

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('installed');
      expect(fs.existsSync(backupPath)).toBe(false);
      expect(fs.readFileSync(configPath, 'utf-8')).toBe('{"existing":true}\n');
    });

    it('cleans up the temporary OpenSpec profile directory if config creation fails', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-test-'));
      vi.spyOn(fs, 'mkdtempSync').mockReturnValueOnce(tempDir);
      vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
        throw new Error('config write failed');
      });

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
      expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('uses the home directory as the OpenSpec init target for global scope', async () => {
      const { buildOpenSpecInitInvocation } = await import('../../src/core/openspec.js');

      expect(
        buildOpenSpecInitInvocation('/tmp/project', ['codex'], 'global', '/Users/Test User'),
      ).toEqual({
        command: 'openspec',
        args: ['init', '/Users/Test User', '--tools', 'codex', '--profile', 'custom'],
      });
      expect(
        buildOpenSpecInitInvocation('/tmp/project', ['codex'], 'global', '/home/test user'),
      ).toEqual({
        command: 'openspec',
        args: ['init', '/home/test user', '--tools', 'codex', '--profile', 'custom'],
      });
      expect(
        buildOpenSpecInitInvocation(
          'D:\\Project\\Comet',
          ['codex'],
          'global',
          'C:\\Users\\Test User',
        ),
      ).toEqual({
        command: 'openspec',
        args: ['init', 'C:\\Users\\Test User', '--tools', 'codex', '--profile', 'custom'],
      });
    });

    it('joins the OpenSpec tools list into one --tools argument', async () => {
      const { buildOpenSpecInitInvocation } = await import('../../src/core/openspec.js');

      expect(
        buildOpenSpecInitInvocation(
          '/tmp/project',
          ['future tool', 'codex'],
          'project',
          '/home/user',
        ),
      ).toEqual({
        command: 'openspec',
        args: ['init', '/tmp/project', '--tools', 'future tool,codex', '--profile', 'custom'],
      });
    });

    it('omits --profile flag when includeProfileFlag is false', async () => {
      const { buildOpenSpecInitInvocation } = await import('../../src/core/openspec.js');

      expect(
        buildOpenSpecInitInvocation('/tmp/project', ['claude'], 'project', '/home/user', false),
      ).toEqual({
        command: 'openspec',
        args: ['init', '/tmp/project', '--tools', 'claude'],
      });
    });

    it('installs openspec CLI when not on PATH', async () => {
      // First call: isCommandAvailable fails
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      // Second call: npm install succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('installed'));
      // Third call: isCommandAvailable succeeds after install
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Fourth call: openspec init succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('ok'));

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('installed');
    });

    it('returns failed when openspec init throws', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('init failed');
      });

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
    });

    it('shows openspec init stderr details when init throws', async () => {
      // First call: isCommandAvailable succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Second call: npm upgrade fails (gracefully falls back to existing version)
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('npm upgrade failed');
      });
      // Third call: openspec init fails with stderr
      const error = new Error('Command failed: openspec init ...') as Error & { stderr?: Buffer };
      error.stderr = Buffer.from('network timeout while fetching OpenSpec skills');
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('network timeout while fetching OpenSpec skills'),
      );
      errorSpy.mockRestore();
    });

    it('shows timeout fallback when stderr and stdout are both empty', async () => {
      // First call: isCommandAvailable succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Second call: npm upgrade fails (gracefully falls back to existing version)
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('npm upgrade failed');
      });
      // Third call: openspec init fails with timeout
      const error = new Error('Command failed: openspec init ...') as Error & {
        stderr?: Buffer;
        code?: string;
      };
      error.code = 'ETIMEDOUT';
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Process timed out'));
      errorSpy.mockRestore();
    });

    it('retries without --profile when openspec reports unknown option in stderr', async () => {
      // First call: isCommandAvailable
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Second call: npm upgrade
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      // Third call: isCommandAvailable after upgrade
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Fourth call: openspec init with --profile fails (stderr captured by pipe)
      const profileError = new Error('Command failed: openspec init /tmp/test --tools claude --profile custom') as Error & { stderr?: Buffer };
      profileError.stderr = Buffer.from("error: unknown option '--profile'");
      mockedExecFileSync.mockImplementationOnce(() => {
        throw profileError;
      });
      // Fifth call: openspec init without --profile succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('ok'));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('installed');
      expect(mockedExecFileSync).toHaveBeenCalledTimes(5);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('retrying without it'),
      );

      // Verify the retry call did not include --profile
      const retryArgs = mockedExecFileSync.mock.calls[4][1] as string[];
      expect(retryArgs).not.toContain('--profile');

      warnSpy.mockRestore();
    });

    it('returns failed when retry without --profile also fails', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      const profileError = new Error('Command failed: openspec init ...') as Error & { stderr?: Buffer };
      profileError.stderr = Buffer.from("error: unknown option '--profile'");
      mockedExecFileSync.mockImplementationOnce(() => {
        throw profileError;
      });
      // Retry also fails
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('retry also failed');
      });

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
      expect(mockedExecFileSync).toHaveBeenCalledTimes(5);
    });

    it('does not retry when init fails for a non-profile reason', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      const error = new Error('Command failed: openspec init ...') as Error & { stderr?: Buffer };
      error.stderr = Buffer.from('network timeout');
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
      // Only 4 calls: isCommandAvailable + upgrade + isCommandAvailable + failed init (no retry)
      expect(mockedExecFileSync).toHaveBeenCalledTimes(4);
    });

    it('merges with existing content in ~/.config/opencode/ without overwrite errors', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-migrate-test-'));
      const fakeHome = path.join(tmpDir, 'home');
      const wrongSkillsDir = path.join(fakeHome, '.opencode', 'skills');
      const correctSkillsDir = path.join(fakeHome, '.config', 'opencode', 'skills');

      fs.mkdirSync(path.join(correctSkillsDir, 'comet'), { recursive: true });
      fs.writeFileSync(path.join(correctSkillsDir, 'comet', 'SKILL.md'), 'comet skill');

      fs.mkdirSync(path.join(wrongSkillsDir, 'openspec-propose'), { recursive: true });
      fs.writeFileSync(path.join(wrongSkillsDir, 'openspec-propose', 'SKILL.md'), 'propose skill');

      const { migrateOpenCodeOpenSpecPaths } = await import('../../src/core/openspec.js');
      migrateOpenCodeOpenSpecPaths(fakeHome);

      expect(fs.readFileSync(path.join(correctSkillsDir, 'comet', 'SKILL.md'), 'utf-8')).toBe(
        'comet skill',
      );
      expect(
        fs.readFileSync(path.join(correctSkillsDir, 'openspec-propose', 'SKILL.md'), 'utf-8'),
      ).toBe('propose skill');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('handles errors gracefully when source directory is a file instead of a directory', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-migrate-test-'));
      const fakeHome = path.join(tmpDir, 'home');

      fs.mkdirSync(path.join(fakeHome, '.opencode'), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.opencode', 'skills'), 'this is a file, not a dir');

      const { migrateOpenCodeOpenSpecPaths } = await import('../../src/core/openspec.js');
      expect(() => migrateOpenCodeOpenSpecPaths(fakeHome)).not.toThrow();

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('integrates with installOpenSpec for global scope with opencode tool', async () => {
      mockedExecFileSync.mockReturnValue(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValue(Buffer.from('ok'));
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-install-test-'));
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['opencode', 'claude'], 'global');

      expect(result).toBe('installed');

      homedirSpy.mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
