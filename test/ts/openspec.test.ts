import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

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
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/node'));
      const { isCommandAvailable } = await import('../../src/core/openspec.js');
      expect(isCommandAvailable('node')).toBe(true);
    });

    it('returns false when command throws', async () => {
      mockedExecSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      const { isCommandAvailable } = await import('../../src/core/openspec.js');
      expect(isCommandAvailable('missing-cmd')).toBe(false);
    });
  });

  describe('quoteShellArg', () => {
    it('doubles trailing backslashes before the closing quote on Windows', async () => {
      const { quoteShellArg } = await import('../../src/core/openspec.js');

      expect(quoteShellArg('C:\\Users\\', 'win32')).toBe('"C:\\Users\\\\"');
    });
  });

  describe('installOpenSpec', () => {
    it('accepts the Kimi OpenSpec tool id from platform definitions', async () => {
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecSync.mockReturnValueOnce(Buffer.from('ok'));

      const { installOpenSpec, quoteShellArg } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['kimi'], 'project');

      expect(result).toBe('installed');
      expect(mockedExecSync.mock.calls[1][0]).toContain(`--tools ${quoteShellArg('kimi')}`);
    });

    it('installs openspec when CLI is available', async () => {
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecSync.mockReturnValueOnce(Buffer.from('ok'));

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude', 'cursor'], 'project');

      expect(result).toBe('installed');
      expect(mockedExecSync).toHaveBeenCalledTimes(2);
    });

    it('returns failed when openspec CLI is not available', async () => {
      mockedExecSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      // The npm install call
      mockedExecSync.mockImplementationOnce(() => {
        throw new Error('npm failed');
      });

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
    });

    it('shows npm stderr and stdout details when CLI install fails', async () => {
      mockedExecSync.mockImplementationOnce(() => {
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
      mockedExecSync.mockImplementationOnce(() => {
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
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecSync.mockReturnValueOnce(Buffer.from('ok'));

      const { installOpenSpec, quoteShellArg } = await import('../../src/core/openspec.js');
      await installOpenSpec('/tmp/test', ['claude'], 'global');

      const initCall = mockedExecSync.mock.calls[1][0] as string;
      expect(initCall).not.toContain('--global');
      expect(initCall).toContain(`--tools ${quoteShellArg('claude')}`);
    });

    it('installs OpenSpec with all workflows through an isolated custom profile', async () => {
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecSync.mockReturnValueOnce(Buffer.from('ok'));
      const writeSpy = vi.spyOn(fs, 'writeFileSync');

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('installed');
      const initCall = mockedExecSync.mock.calls[1][0] as string;
      const initOptions = mockedExecSync.mock.calls[1][1] as { env?: NodeJS.ProcessEnv };
      expect(initCall).toContain('--profile custom');

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
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecSync.mockReturnValueOnce(Buffer.from('ok'));
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
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecSync.mockReturnValueOnce(Buffer.from('ok'));
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
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
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
      const { buildOpenSpecInitCommand } = await import('../../src/core/openspec.js');

      expect(
        buildOpenSpecInitCommand('/tmp/project', ['codex'], 'global', '/Users/Test User', 'darwin'),
      ).toBe("openspec init '/Users/Test User' --tools 'codex' --profile custom");
      expect(
        buildOpenSpecInitCommand('/tmp/project', ['codex'], 'global', '/home/test user', 'linux'),
      ).toBe("openspec init '/home/test user' --tools 'codex' --profile custom");
      expect(
        buildOpenSpecInitCommand(
          'D:\\Project\\Comet',
          ['codex'],
          'global',
          'C:\\Users\\Test User',
          'win32',
        ),
      ).toBe('openspec init "C:\\Users\\Test User" --tools "codex" --profile custom');
    });

    it('quotes the joined OpenSpec tools argument', async () => {
      const { buildOpenSpecInitCommand } = await import('../../src/core/openspec.js');

      expect(
        buildOpenSpecInitCommand(
          '/tmp/project',
          ['future tool', 'codex'],
          'project',
          '/home/user',
          'linux',
        ),
      ).toBe("openspec init '/tmp/project' --tools 'future tool,codex' --profile custom");
    });

    it('installs openspec CLI when not on PATH', async () => {
      // First call: isCommandAvailable fails
      mockedExecSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      // Second call: npm install succeeds
      mockedExecSync.mockReturnValueOnce(Buffer.from('installed'));
      // Third call: isCommandAvailable succeeds after install
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Fourth call: openspec init succeeds
      mockedExecSync.mockReturnValueOnce(Buffer.from('ok'));

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('installed');
    });

    it('returns failed when openspec init throws', async () => {
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecSync.mockImplementationOnce(() => {
        throw new Error('init failed');
      });

      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
    });

    it('shows openspec init stderr details when init throws', async () => {
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      const error = new Error('Command failed: openspec init ...') as Error & { stderr?: Buffer };
      error.stderr = Buffer.from('network timeout while fetching OpenSpec skills');
      mockedExecSync.mockImplementationOnce(() => {
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
      mockedExecSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      const error = new Error('Command failed: openspec init ...') as Error & {
        stderr?: Buffer;
        code?: string;
      };
      error.code = 'ETIMEDOUT';
      mockedExecSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installOpenSpec } = await import('../../src/core/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Process timed out'));
      errorSpy.mockRestore();
    });
  });
});
