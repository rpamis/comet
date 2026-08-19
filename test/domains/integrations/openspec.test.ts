import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { stageOpenSpecSkills, unquoteWindowsArg } from '../../helpers/openspec-test-utils.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock child_process
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

function createStagedOpenSpecCliMock(): (command: string, args: readonly unknown[]) => Buffer {
  return (command, args) => {
    if (command === 'where' || command === 'which') return Buffer.from('/usr/bin/openspec');
    if (command === 'npm' || command === 'npm.cmd') return Buffer.from('upgraded');
    if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
      return Buffer.from('1.5.0');
    }
    if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
      const target = unquoteWindowsArg(args[1]);
      const tools = args[args.indexOf('--tools') + 1];
      if (tools !== 'none') {
        stageOpenSpecSkills(target, String(tools));
      }
      return Buffer.from('ok');
    }
    return Buffer.from('ok');
  };
}

describe('openspec', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    // Default OpenSpec CLI behavior: available, and `openspec init` stages real
    // tool output so mergeGeneratedToolDirectories has something to copy.
    mockedExecFileSync.mockImplementation(createStagedOpenSpecCliMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('isCommandAvailable', () => {
    it('returns true when command is on PATH', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/node'));
      const { isCommandAvailable } = await import('../../../domains/integrations/openspec.js');
      expect(isCommandAvailable('node')).toBe(true);
    });

    it('returns false when command throws', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      const { isCommandAvailable } = await import('../../../domains/integrations/openspec.js');
      expect(isCommandAvailable('missing-cmd')).toBe(false);
    });
  });

  describe('OpenSpec CLI compatibility', () => {
    it.each([
      ['1.5.0', true],
      ['OpenSpec 1.5.1', true],
      ['v2.0.0', true],
      ['1.4.9', false],
      ['1.5.0-beta.1', false],
      ['unknown', false],
    ])('evaluates %s against the minimum supported version', async (version, compatible) => {
      const { isOpenSpecVersionCompatible } =
        await import('../../../domains/integrations/openspec.js');

      expect(isOpenSpecVersionCompatible(version)).toBe(compatible);
    });

    it('explains an incompatible existing CLI without claiming it is unavailable', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('1.3.1'));

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project', false);

      expect(result).toBe('failed');
      expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('OpenSpec 1.3.1'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requires >= 1.5.0'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('upgrade was not selected'));
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('OpenSpec CLI not available'),
      );
      errorSpy.mockRestore();
    });

    it('rejects an incompatible existing CLI when an optional upgrade fails', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('npm upgrade failed');
      });
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('1.3.1'));

      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
      expect(mockedExecFileSync).toHaveBeenCalledTimes(3);
    });
  });

  describe('installOpenSpec', () => {
    it('separates project tool generation from the docs OpenSpec artifact root', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-docs-layout-'));
      try {
        mockedExecFileSync.mockImplementation((command, args) => {
          if (command === 'where' || command === 'which') {
            return Buffer.from('/usr/bin/openspec');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
            return Buffer.from('1.5.0');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
            const target = unquoteWindowsArg(args[1]);
            const tools = args[args.indexOf('--tools') + 1];
            if (tools === 'none') {
              fs.mkdirSync(path.join(target, 'openspec', 'changes', 'archive'), {
                recursive: true,
              });
            } else {
              const generated = path.join(target, '.claude', 'skills', 'openspec-new-change');
              fs.mkdirSync(generated, { recursive: true });
              fs.writeFileSync(path.join(generated, 'SKILL.md'), '# generated\n');
            }
            return Buffer.from('ok');
          }
          return Buffer.from('ok');
        });

        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(tmpDir, ['claude'], 'project', false, [], 'docs');

        expect(result).toBe('installed');
        expect(
          fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'openspec-new-change', 'SKILL.md')),
        ).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'docs', 'openspec', 'changes', 'archive'))).toBe(
          true,
        );
        expect(fs.existsSync(path.join(tmpDir, 'openspec'))).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('mirrors CodeBuddy-compatible OpenSpec output into WorkBuddy project and global roots', async () => {
      const projectDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'comet-openspec-workbuddy-project-'),
      );
      const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-workbuddy-global-'));
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(globalDir);
      try {
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');

        await expect(
          installOpenSpec(
            projectDir,
            ['codebuddy'],
            'project',
            false,
            [],
            'docs',
            undefined,
            undefined,
            ['workbuddy'],
          ),
        ).resolves.toBe('installed');
        await expect(
          installOpenSpec(
            projectDir,
            ['codebuddy'],
            'global',
            false,
            [],
            'legacy',
            undefined,
            undefined,
            ['workbuddy'],
          ),
        ).resolves.toBe('installed');

        expect(
          fs.existsSync(
            path.join(projectDir, '.workbuddy', 'skills', 'openspec-propose', 'SKILL.md'),
          ),
        ).toBe(true);
        expect(
          fs.existsSync(
            path.join(globalDir, '.workbuddy', 'skills', 'openspec-propose', 'SKILL.md'),
          ),
        ).toBe(true);
        expect(fs.existsSync(path.join(projectDir, '.codebuddy'))).toBe(false);
        expect(fs.existsSync(path.join(globalDir, '.codebuddy'))).toBe(false);
      } finally {
        homedirSpy.mockRestore();
        fs.rmSync(projectDir, { recursive: true, force: true });
        fs.rmSync(globalDir, { recursive: true, force: true });
      }
    });

    it('mirrors Codex-compatible OpenSpec output into Grok project and global roots', async () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-grok-project-'));
      const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-grok-global-'));
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(globalDir);
      try {
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');

        await expect(
          installOpenSpec(
            projectDir,
            ['codex'],
            'project',
            false,
            [],
            'docs',
            undefined,
            undefined,
            [],
            ['grok'],
          ),
        ).resolves.toBe('installed');
        await expect(
          installOpenSpec(
            projectDir,
            ['codex'],
            'global',
            false,
            [],
            'legacy',
            undefined,
            undefined,
            [],
            ['grok'],
          ),
        ).resolves.toBe('installed');

        expect(
          fs.existsSync(path.join(projectDir, '.grok', 'skills', 'openspec-propose', 'SKILL.md')),
        ).toBe(true);
        expect(fs.existsSync(path.join(projectDir, '.agents'))).toBe(false);
        expect(
          fs.existsSync(path.join(globalDir, '.grok', 'skills', 'openspec-propose', 'SKILL.md')),
        ).toBe(true);
        expect(fs.existsSync(path.join(globalDir, '.agents'))).toBe(false);
      } finally {
        homedirSpy.mockRestore();
        fs.rmSync(projectDir, { recursive: true, force: true });
        fs.rmSync(globalDir, { recursive: true, force: true });
      }
    });

    it('reports a failed global OpenSpec mirror copy as failed', async () => {
      const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-grok-copy-fail-'));
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(globalDir);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        fs.writeFileSync(path.join(globalDir, '.grok'), 'not a directory');
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');

        await expect(
          installOpenSpec(
            globalDir,
            ['codex'],
            'global',
            false,
            ['grok'],
            'legacy',
            undefined,
            undefined,
            [],
            [],
            ['grok'],
          ),
        ).resolves.toBe('failed');
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('OpenSpec init failed'));
      } finally {
        errorSpy.mockRestore();
        homedirSpy.mockRestore();
        fs.rmSync(globalDir, { recursive: true, force: true });
      }
    });

    it('installs Codex OpenSpec Skills from the legacy .codex CLI staging output into the canonical agent root (OpenSpec <= 1.7)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-codex-tools-'));
      try {
        mockedExecFileSync.mockImplementation((command, args) => {
          if (command === 'where' || command === 'which') return Buffer.from('/usr/bin/openspec');
          if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
            return Buffer.from('1.5.0');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
            const target = unquoteWindowsArg(args[1]);
            const tools = args[args.indexOf('--tools') + 1];
            if (tools === 'codex') {
              const generated = path.join(target, '.codex', 'skills', 'openspec-new-change');
              fs.mkdirSync(generated, { recursive: true });
              fs.writeFileSync(path.join(generated, 'SKILL.md'), '# Codex OpenSpec\n');
            } else {
              fs.mkdirSync(path.join(target, 'openspec', 'changes', 'archive'), {
                recursive: true,
              });
            }
            return Buffer.from('ok');
          }
          return Buffer.from('ok');
        });

        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(tmpDir, ['codex'], 'project', false);

        expect(result).toBe('installed');
        await expect(
          fs.promises.readFile(
            path.join(tmpDir, '.agents', 'skills', 'openspec-new-change', 'SKILL.md'),
            'utf8',
          ),
        ).resolves.toBe('# Codex OpenSpec\n');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
    it('installs Codex OpenSpec Skills from the current .agents CLI staging output (OpenSpec 1.8)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-codex-agents-tools-'));
      try {
        mockedExecFileSync.mockImplementation((command, args) => {
          if (command === 'where' || command === 'which') return Buffer.from('/usr/bin/openspec');
          if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
            return Buffer.from('1.8.0');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
            const target = unquoteWindowsArg(args[1]);
            const tools = args[args.indexOf('--tools') + 1];
            if (tools === 'codex') {
              const generated = path.join(target, '.agents', 'skills', 'openspec-new-change');
              fs.mkdirSync(generated, { recursive: true });
              fs.writeFileSync(
                path.join(generated, 'SKILL.md'),
                '---\ngeneratedBy: "1.8.0"\n---\n# Codex OpenSpec\n',
              );
            } else {
              fs.mkdirSync(path.join(target, 'openspec', 'changes', 'archive'), {
                recursive: true,
              });
            }
            return Buffer.from('ok');
          }
          return Buffer.from('ok');
        });

        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(tmpDir, ['codex'], 'project', false);

        expect(result).toBe('installed');
        await expect(
          fs.promises.readFile(
            path.join(tmpDir, '.agents', 'skills', 'openspec-new-change', 'SKILL.md'),
            'utf8',
          ),
        ).resolves.toContain('generatedBy: "1.8.0"');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('fails when OpenSpec stages no tool output for a requested platform', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-missing-tools-'));
      try {
        mockedExecFileSync.mockImplementation((command, args) => {
          if (command === 'where' || command === 'which') return Buffer.from('/usr/bin/openspec');
          if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
            return Buffer.from('1.8.0');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
            const target = unquoteWindowsArg(args[1]);
            fs.mkdirSync(path.join(target, 'openspec', 'changes', 'archive'), {
              recursive: true,
            });
            return Buffer.from('ok');
          }
          return Buffer.from('ok');
        });

        const failures: Error[] = [];
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(
          tmpDir,
          ['codex'],
          'project',
          false,
          [],
          'legacy',
          undefined,
          (error) => failures.push(error),
        );

        expect(result).toBe('failed');
        expect(failures[0]?.message).toContain('no tool output');
        expect(fs.existsSync(path.join(tmpDir, '.agents'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, '.codex'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'openspec'))).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('fails when OpenSpec stages an empty tool directory for a requested platform', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-empty-tools-'));
      try {
        mockedExecFileSync.mockImplementation((command, args) => {
          if (command === 'where' || command === 'which') return Buffer.from('/usr/bin/openspec');
          if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
            return Buffer.from('1.8.0');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
            const target = unquoteWindowsArg(args[1]);
            const tools = args[args.indexOf('--tools') + 1];
            if (tools === 'codex') {
              fs.mkdirSync(path.join(target, '.agents', 'skills'), { recursive: true });
            } else {
              fs.mkdirSync(path.join(target, 'openspec', 'changes', 'archive'), {
                recursive: true,
              });
            }
            return Buffer.from('ok');
          }
          return Buffer.from('ok');
        });

        const failures: Error[] = [];
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(
          tmpDir,
          ['codex'],
          'project',
          false,
          [],
          'legacy',
          undefined,
          (error) => failures.push(error),
        );

        expect(result).toBe('failed');
        expect(failures[0]?.message).toContain('empty tool output');
        expect(fs.existsSync(path.join(tmpDir, '.agents'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'openspec'))).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('preflights all requested platforms before writing project files when a later platform has no output', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-partial-missing-'));
      try {
        mockedExecFileSync.mockImplementation((command, args) => {
          if (command === 'where' || command === 'which') return Buffer.from('/usr/bin/openspec');
          if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
            return Buffer.from('1.8.0');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
            const target = unquoteWindowsArg(args[1]);
            const tools = String(args[args.indexOf('--tools') + 1]);
            if (tools.includes('claude')) {
              stageOpenSpecSkills(target, 'claude');
            } else {
              fs.mkdirSync(path.join(target, 'openspec', 'changes', 'archive'), {
                recursive: true,
              });
            }
            return Buffer.from('ok');
          }
          return Buffer.from('ok');
        });

        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(tmpDir, ['claude', 'codex'], 'project', false);

        expect(result).toBe('failed');
        // No partial updates: the earlier platform and the artifact root stay untouched.
        expect(fs.existsSync(path.join(tmpDir, '.claude'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, '.agents'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'openspec'))).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('preflights all requested platforms before writing project files when a later platform is empty', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-partial-empty-'));
      try {
        mockedExecFileSync.mockImplementation((command, args) => {
          if (command === 'where' || command === 'which') return Buffer.from('/usr/bin/openspec');
          if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
            return Buffer.from('1.8.0');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
            const target = unquoteWindowsArg(args[1]);
            const tools = String(args[args.indexOf('--tools') + 1]);
            if (tools === 'claude,codex') {
              stageOpenSpecSkills(target, 'claude');
              fs.mkdirSync(path.join(target, '.agents', 'skills'), { recursive: true });
            } else if (tools === 'claude') {
              stageOpenSpecSkills(target, 'claude');
            } else {
              fs.mkdirSync(path.join(target, 'openspec', 'changes', 'archive'), {
                recursive: true,
              });
            }
            return Buffer.from('ok');
          }
          return Buffer.from('ok');
        });

        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(tmpDir, ['claude', 'codex'], 'project', false);

        expect(result).toBe('failed');
        // No partial updates: the earlier platform and the artifact root stay untouched.
        expect(fs.existsSync(path.join(tmpDir, '.claude'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, '.agents'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'openspec'))).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('refreshes stale Codex OpenSpec skills under a docs artifact layout with OpenSpec 1.8', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-codex-docs-'));
      try {
        const staleSkill = path.join(
          tmpDir,
          '.agents',
          'skills',
          'openspec-new-change',
          'SKILL.md',
        );
        fs.mkdirSync(path.dirname(staleSkill), { recursive: true });
        fs.writeFileSync(staleSkill, '---\ngeneratedBy: "1.7.0"\n---\n# Codex OpenSpec\n', 'utf8');

        mockedExecFileSync.mockImplementation((command, args) => {
          if (command === 'where' || command === 'which') return Buffer.from('/usr/bin/openspec');
          if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
            return Buffer.from('1.8.0');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
            const target = unquoteWindowsArg(args[1]);
            const tools = args[args.indexOf('--tools') + 1];
            if (tools === 'codex') {
              const generated = path.join(target, '.agents', 'skills', 'openspec-new-change');
              fs.mkdirSync(generated, { recursive: true });
              fs.writeFileSync(
                path.join(generated, 'SKILL.md'),
                '---\ngeneratedBy: "1.8.0"\n---\n# Codex OpenSpec refreshed\n',
              );
            } else {
              fs.mkdirSync(path.join(target, 'openspec', 'changes', 'archive'), {
                recursive: true,
              });
            }
            return Buffer.from('ok');
          }
          return Buffer.from('ok');
        });

        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(tmpDir, ['codex'], 'project', false, [], 'docs');

        expect(result).toBe('installed');
        await expect(
          fs.promises.readFile(
            path.join(tmpDir, '.agents', 'skills', 'openspec-new-change', 'SKILL.md'),
            'utf8',
          ),
        ).resolves.toContain('generatedBy: "1.8.0"');
        expect(fs.existsSync(path.join(tmpDir, 'docs', 'openspec', 'changes', 'archive'))).toBe(
          true,
        );
        expect(fs.existsSync(path.join(tmpDir, 'openspec'))).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('separates project tool generation from the legacy OpenSpec artifact root', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-legacy-layout-'));
      try {
        mockedExecFileSync.mockImplementation((command, args) => {
          if (command === 'where' || command === 'which') {
            return Buffer.from('/usr/bin/openspec');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
            return Buffer.from('1.5.0');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
            const target = unquoteWindowsArg(args[1]);
            const tools = args[args.indexOf('--tools') + 1];
            if (tools === 'none') {
              fs.mkdirSync(path.join(target, 'openspec', 'changes', 'archive'), {
                recursive: true,
              });
              fs.writeFileSync(
                path.join(target, 'openspec', 'config.yaml'),
                'schema: spec-driven\n',
              );
            } else {
              const generated = path.join(target, '.claude', 'skills', 'openspec-new-change');
              fs.mkdirSync(generated, { recursive: true });
              fs.writeFileSync(path.join(generated, 'SKILL.md'), '# generated\n');
            }
            return Buffer.from('ok');
          }
          return Buffer.from('ok');
        });

        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(tmpDir, ['claude'], 'project', false, [], 'legacy');
        const initCalls = mockedExecFileSync.mock.calls.filter(
          ([command, args]) => command === 'openspec' && Array.isArray(args) && args[0] === 'init',
        );

        expect(result).toBe('installed');
        expect(initCalls).toHaveLength(2);
        expect(initCalls[0][1]).toEqual(expect.arrayContaining(['--tools', 'claude']));
        expect(initCalls[0][1]?.[1]).not.toBe(tmpDir);
        expect(
          initCalls[1][1]?.map((arg, index) => (index === 1 ? unquoteWindowsArg(arg) : arg)),
        ).toEqual(['init', tmpDir, '--tools', 'none', '--profile', 'custom']);
        await expect(
          fs.promises.readFile(
            path.join(tmpDir, '.claude', 'skills', 'openspec-new-change', 'SKILL.md'),
            'utf8',
          ),
        ).resolves.toBe('# generated\n');
        await expect(
          fs.promises.readFile(path.join(tmpDir, 'openspec', 'config.yaml'), 'utf8'),
        ).resolves.toBe('schema: spec-driven\n');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('initializes a project artifact root without staging platform tools', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-artifact-only-'));
      try {
        mockedExecFileSync.mockImplementation((command, args) => {
          if (command === 'where' || command === 'which') {
            return Buffer.from('/usr/bin/openspec');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
            return Buffer.from('1.5.0');
          }
          if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
            const target = unquoteWindowsArg(args[1]);
            fs.mkdirSync(path.join(target, 'openspec'), { recursive: true });
            fs.writeFileSync(path.join(target, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
            return Buffer.from('ok');
          }
          return Buffer.from('ok');
        });

        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(tmpDir, [], 'project', false, [], 'docs');

        expect(result).toBe('installed');
        expect(
          mockedExecFileSync.mock.calls.filter(
            ([command, args]) =>
              command === 'openspec' && Array.isArray(args) && args[0] === 'init',
          ),
        ).toHaveLength(1);
        expect(mockedExecFileSync.mock.calls.at(-1)?.[1]).toEqual(
          expect.arrayContaining(['--tools', 'none']),
        );
        expect(fs.existsSync(path.join(tmpDir, '.claude'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'docs', 'openspec', 'config.yaml'))).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it.each(['initial', 'after-guard'] as const)(
      'rejects an %s project platform junction without copying staged tools outside',
      async (replacement) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-platform-race-'));
        const outsideRoot = fs.mkdtempSync(
          path.join(os.tmpdir(), 'comet-openspec-platform-outside-'),
        );
        const platformRoot = path.join(tmpDir, '.claude', 'skills');
        const heldPlatformRoot = path.join(tmpDir, '.claude', 'skills-held');
        let replaced = false;
        try {
          fs.mkdirSync(platformRoot, { recursive: true });
          const probe = path.join(tmpDir, '.junction-probe');
          try {
            fs.symlinkSync(outsideRoot, probe, process.platform === 'win32' ? 'junction' : 'dir');
            fs.rmSync(probe, { force: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
            throw error;
          }
          if (replacement === 'initial') {
            fs.rmSync(platformRoot, { recursive: true, force: true });
            fs.symlinkSync(
              outsideRoot,
              platformRoot,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
            replaced = true;
          }
          mockedExecFileSync.mockImplementation((command, args) => {
            if (command === 'where' || command === 'which') {
              return Buffer.from('/usr/bin/openspec');
            }
            if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
              return Buffer.from('1.5.0');
            }
            if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
              const target = unquoteWindowsArg(args[1]);
              const tools = args[args.indexOf('--tools') + 1];
              if (tools === 'none') {
                fs.mkdirSync(path.join(target, 'openspec'), { recursive: true });
                fs.writeFileSync(
                  path.join(target, 'openspec', 'config.yaml'),
                  'schema: spec-driven\n',
                );
              } else {
                const generated = path.join(
                  target,
                  '.claude',
                  'skills',
                  'openspec-new-change',
                  'SKILL.md',
                );
                fs.mkdirSync(path.dirname(generated), { recursive: true });
                fs.writeFileSync(generated, '# staged\n');
              }
              return Buffer.from('ok');
            }
            return Buffer.from('ok');
          });
          const guard = vi.fn(async () => {
            if (
              replacement === 'after-guard' &&
              !replaced &&
              fs.existsSync(path.join(tmpDir, 'docs', 'openspec', 'config.yaml'))
            ) {
              fs.renameSync(platformRoot, heldPlatformRoot);
              fs.symlinkSync(
                outsideRoot,
                platformRoot,
                process.platform === 'win32' ? 'junction' : 'dir',
              );
              replaced = true;
            }
          });

          const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
          const result = await installOpenSpec(
            tmpDir,
            ['claude'],
            'project',
            false,
            [],
            'docs',
            guard,
          );

          expect(replaced).toBe(true);
          expect(result).toBe('failed');
          expect(fs.readdirSync(outsideRoot)).toEqual([]);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fs.rmSync(outsideRoot, { recursive: true, force: true });
        }
      },
    );

    it.each([
      ['zcode', '.zcode', 'initial'],
      ['zcode', '.zcode', 'after-guard'],
      ['mimocode', '.mimocode', 'initial'],
      ['mimocode', '.mimocode', 'after-guard'],
    ] as const)(
      'rejects an %s project mirror destination %s identity change without writing outside (%s)',
      async (platformId, platformDir, replacement) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-mirror-race-'));
        const outsideRoot = fs.mkdtempSync(
          path.join(os.tmpdir(), 'comet-openspec-mirror-outside-'),
        );
        const destinationRoot = path.join(tmpDir, platformDir);
        const heldDestinationRoot = path.join(tmpDir, `${platformDir}-held`);
        let replaced = false;
        try {
          fs.mkdirSync(destinationRoot, { recursive: true });
          const probe = path.join(tmpDir, '.junction-probe');
          try {
            fs.symlinkSync(outsideRoot, probe, process.platform === 'win32' ? 'junction' : 'dir');
            fs.rmSync(probe, { force: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
            throw error;
          }
          const replaceDestination = () => {
            fs.renameSync(destinationRoot, heldDestinationRoot);
            fs.symlinkSync(
              outsideRoot,
              destinationRoot,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
            replaced = true;
          };
          if (replacement === 'initial') {
            replaceDestination();
          }
          mockedExecFileSync.mockImplementation((command, args) => {
            if (command === 'where' || command === 'which') {
              return Buffer.from('/usr/bin/openspec');
            }
            if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
              return Buffer.from('1.5.0');
            }
            if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
              const target = unquoteWindowsArg(args[1]);
              const tools = args[args.indexOf('--tools') + 1];
              if (tools === 'none') {
                fs.mkdirSync(path.join(target, 'openspec'), { recursive: true });
                fs.writeFileSync(
                  path.join(target, 'openspec', 'config.yaml'),
                  'schema: spec-driven\n',
                );
              } else {
                const generated = path.join(
                  target,
                  '.opencode',
                  'skills',
                  'openspec-new-change',
                  'SKILL.md',
                );
                fs.mkdirSync(path.dirname(generated), { recursive: true });
                fs.writeFileSync(generated, '# staged\n');
              }
              return Buffer.from('ok');
            }
            return Buffer.from('ok');
          });
          const guard = vi.fn(async () => {
            if (
              replacement === 'after-guard' &&
              !replaced &&
              fs.existsSync(path.join(tmpDir, 'docs', 'openspec', 'config.yaml'))
            ) {
              replaceDestination();
            }
          });

          const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
          const result = await installOpenSpec(
            tmpDir,
            ['opencode'],
            'project',
            false,
            [platformId],
            'docs',
            guard,
          );

          expect(replaced).toBe(true);
          expect(result).toBe('failed');
          expect(fs.readdirSync(outsideRoot)).toEqual([]);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fs.rmSync(outsideRoot, { recursive: true, force: true });
        }
      },
    );

    it.each(['initial', 'after-guard'] as const)(
      'rejects an %s docs artifact-base junction before OpenSpec writes outside',
      async (replacement) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-artifact-race-'));
        const outsideRoot = fs.mkdtempSync(
          path.join(os.tmpdir(), 'comet-openspec-artifact-outside-'),
        );
        const docsRoot = path.join(tmpDir, 'docs');
        const heldDocsRoot = path.join(tmpDir, 'docs-held');
        let guardCalls = 0;
        let replaced = false;
        try {
          fs.mkdirSync(docsRoot, { recursive: true });
          const probe = path.join(tmpDir, '.junction-probe');
          try {
            fs.symlinkSync(outsideRoot, probe, process.platform === 'win32' ? 'junction' : 'dir');
            fs.rmSync(probe, { force: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
            throw error;
          }
          if (replacement === 'initial') {
            fs.rmSync(docsRoot, { recursive: true, force: true });
            fs.symlinkSync(
              outsideRoot,
              docsRoot,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
            replaced = true;
          }
          mockedExecFileSync.mockImplementation((command, args) => {
            if (command === 'where' || command === 'which') {
              return Buffer.from('/usr/bin/openspec');
            }
            if (command === 'openspec' && Array.isArray(args) && args[0] === '--version') {
              return Buffer.from('1.5.0');
            }
            if (command === 'openspec' && Array.isArray(args) && args[0] === 'init') {
              const target = unquoteWindowsArg(args[1]);
              const tools = args[args.indexOf('--tools') + 1];
              if (tools === 'none') {
                fs.mkdirSync(path.join(target, 'openspec'), { recursive: true });
                fs.writeFileSync(
                  path.join(target, 'openspec', 'config.yaml'),
                  'schema: spec-driven\n',
                );
              } else {
                const generated = path.join(
                  target,
                  '.claude',
                  'skills',
                  'openspec-new-change',
                  'SKILL.md',
                );
                fs.mkdirSync(path.dirname(generated), { recursive: true });
                fs.writeFileSync(generated, '# staged\n');
              }
              return Buffer.from('ok');
            }
            return Buffer.from('ok');
          });
          const guard = vi.fn(async () => {
            guardCalls++;
            if (replacement === 'after-guard' && !replaced && guardCalls === 4) {
              fs.renameSync(docsRoot, heldDocsRoot);
              fs.symlinkSync(
                outsideRoot,
                docsRoot,
                process.platform === 'win32' ? 'junction' : 'dir',
              );
              replaced = true;
            }
          });

          const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
          const result = await installOpenSpec(
            tmpDir,
            ['claude'],
            'project',
            false,
            [],
            'docs',
            guard,
          );

          expect(replaced).toBe(true);
          expect(result).toBe('failed');
          expect(fs.readdirSync(outsideRoot)).toEqual([]);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fs.rmSync(outsideRoot, { recursive: true, force: true });
        }
      },
    );

    it('accepts the Kimi OpenSpec tool id from platform definitions', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('ok'));

      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-project-'));
      try {
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(projectDir, ['kimi'], 'project');

        expect(result).toBe('installed');
        const initCall = mockedExecFileSync.mock.calls.find(
          ([command, args]) => command === 'openspec' && Array.isArray(args) && args[0] === 'init',
        );
        expect(initCall).toBeDefined();
        expect(initCall?.[1]).toEqual(
          expect.arrayContaining(['--tools', 'kimi', '--profile', 'custom']),
        );
        expect(initCall?.[1]?.[1]).not.toBe(projectDir);
        expect(
          mockedExecFileSync.mock.calls.some(
            ([command, args]) =>
              command === 'openspec' &&
              Array.isArray(args) &&
              args[0] === 'init' &&
              unquoteWindowsArg(args[1]) === projectDir &&
              args.includes('none'),
          ),
        ).toBe(true);
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('copies OpenSpec opencode output into MimoCode project paths', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-mimocode-openspec-'));
      try {
        const sourceSkill = path.join(tmpDir, '.opencode', 'skills', 'openspec-core');
        const sourceCommand = path.join(tmpDir, '.opencode', 'commands', 'openspec.md');
        fs.mkdirSync(sourceSkill, { recursive: true });
        fs.mkdirSync(path.dirname(sourceCommand), { recursive: true });
        fs.writeFileSync(path.join(sourceSkill, 'SKILL.md'), '# OpenSpec\n');
        fs.writeFileSync(sourceCommand, '# OpenSpec command\n');

        const { mirrorOpenCodeCompatibleOpenSpecPaths } =
          await import('../../../domains/integrations/openspec.js');
        mirrorOpenCodeCompatibleOpenSpecPaths(tmpDir, 'project', ['mimocode']);

        expect(
          fs.existsSync(path.join(tmpDir, '.mimocode', 'skills', 'openspec-core', 'SKILL.md')),
        ).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, '.mimocode', 'commands', 'openspec.md'))).toBe(true);
        expect(fs.existsSync(sourceCommand)).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('installs openspec when CLI is available', async () => {
      // First call: isCommandAvailable succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Second call: npm upgrade succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      // Third call: isCommandAvailable after upgrade succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));

      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-project-'));
      try {
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(projectDir, ['claude', 'cursor'], 'project');

        expect(result).toBe('installed');
        expect(mockedExecFileSync).toHaveBeenCalledTimes(5);
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('installs the OpenSpec CLI globally for project scope to avoid project node_modules', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));

      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-project-'));
      try {
        const { getNpmExecutable, installOpenSpec } =
          await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(projectDir, ['claude'], 'project');

        expect(result).toBe('installed');
        const npmCall = mockedExecFileSync.mock.calls.find(
          ([command, args]) =>
            command === getNpmExecutable() &&
            Array.isArray(args) &&
            args.includes('@fission-ai/openspec@latest'),
        );
        expect(npmCall?.[1]).toEqual(['install', '-g', '@fission-ai/openspec@latest']);
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('returns failed when openspec CLI is not available', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      // The npm install call
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('npm failed');
      });

      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
    });

    it('shows npm stderr and stdout details when CLI install fails', async () => {
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('not found');
      });
      const error = new Error(
        'Command failed: npm install -g @fission-ai/openspec@latest',
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
      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
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

      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
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
      const writeSpy = vi.spyOn(fs, 'writeFileSync');

      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-project-'));
      try {
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(projectDir, ['claude'], 'project');

        expect(result).toBe('installed');
        const initExec = mockedExecFileSync.mock.calls[3][0] as string;
        const initArgs = mockedExecFileSync.mock.calls[3][1] as string[];
        const initOptions = mockedExecFileSync.mock.calls[3][2] as { env?: NodeJS.ProcessEnv };
        expect(initExec).toBe('openspec');
        expect(initArgs).toEqual(
          expect.arrayContaining(['--tools', 'claude', '--profile', 'custom']),
        );
        expect(initArgs[1]).not.toBe(projectDir);
        expect(
          (mockedExecFileSync.mock.calls[4][1] as string[])?.map((arg, index) =>
            index === 1 ? unquoteWindowsArg(arg) : arg,
          ),
        ).toEqual(['init', projectDir, '--tools', 'none', '--profile', 'custom']);

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
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('writes the default OpenSpec config under XDG_CONFIG_HOME on non-Windows platforms', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      const xdgConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-xdg-'));
      vi.stubEnv('XDG_CONFIG_HOME', xdgConfigHome);
      const writeSpy = vi.spyOn(fs, 'writeFileSync');

      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-project-'));
      try {
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(projectDir, ['claude'], 'project');

        expect(result).toBe('installed');
        expect(
          writeSpy.mock.calls.some(
            ([file]) => file === path.join(xdgConfigHome, 'openspec', 'config.json'),
          ),
        ).toBe(true);
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('removes a default OpenSpec config backup when writing the replacement config fails', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
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

      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-project-'));
      try {
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(projectDir, ['claude'], 'project');

        expect(result).toBe('installed');
        expect(fs.existsSync(backupPath)).toBe(false);
        expect(fs.readFileSync(configPath, 'utf-8')).toBe('{"existing":true}\n');
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
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

      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
      expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('uses the home directory as the OpenSpec init target for global scope', async () => {
      const { buildOpenSpecInitInvocation } =
        await import('../../../domains/integrations/openspec.js');

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
      const { buildOpenSpecInitInvocation } =
        await import('../../../domains/integrations/openspec.js');

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
      const { buildOpenSpecInitInvocation } =
        await import('../../../domains/integrations/openspec.js');

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

      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-project-'));
      try {
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(projectDir, ['claude'], 'project');

        expect(result).toBe('installed');
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('installs the OpenSpec CLI globally even when initializing project scope', async () => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-project-'));
      try {
        mockedExecFileSync.mockImplementationOnce(() => {
          throw new Error('not found');
        });
        mockedExecFileSync.mockReturnValueOnce(Buffer.from('installed'));
        mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));

        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(projectDir, ['claude'], 'project');

        expect(result).toBe('installed');
        expect(mockedExecFileSync.mock.calls[1]).toEqual([
          expect.stringMatching(/^npm(?:\.cmd)?$/),
          ['install', '-g', '@fission-ai/openspec@latest'],
          expect.objectContaining({
            cwd: expect.not.stringContaining(projectDir),
          }),
        ]);
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('returns failed when openspec init throws', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('init failed');
      });

      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['claude'], 'project');

      expect(result).toBe('failed');
    });

    it('checks a project mutation guard before starting OpenSpec init', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('1.5.0'));
      const guard = vi.fn(async () => {
        throw new Error('project config drifted');
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
      await expect(
        installOpenSpec('/tmp/test', ['claude'], 'project', false, [], 'legacy', guard),
      ).rejects.toThrow(/before OpenSpec project mutation.*project config drifted/iu);
      expect(guard).toHaveBeenCalledTimes(1);
      expect(mockedExecFileSync).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/before OpenSpec project mutation.*project config drifted/iu),
      );
      errorSpy.mockRestore();
    });

    it('reports a partial failure when the project mutation guard detects drift after init', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('1.5.0'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('ok'));
      const guard = vi
        .fn<() => Promise<void>>()
        .mockResolvedValueOnce()
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error('project config drifted'));

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
      await expect(
        installOpenSpec('/tmp/test', ['claude'], 'project', false, [], 'legacy', guard),
      ).rejects.toThrow(/partial failure.*project config drifted/iu);
      expect(guard).toHaveBeenCalledTimes(3);
      expect(
        mockedExecFileSync.mock.calls.filter(
          ([command, args]) =>
            String(command) === 'openspec' && Array.isArray(args) && args.map(String)[0] === 'init',
        ),
      ).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/partial failure.*project config drifted/iu),
      );
      errorSpy.mockRestore();
    });

    it('shows openspec init stderr details when init throws', async () => {
      // First call: isCommandAvailable succeeds
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      // Second call: npm upgrade fails (gracefully falls back to existing version)
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('npm upgrade failed');
      });
      // Third call: existing OpenSpec version is compatible
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('1.5.0'));
      // Fourth call: openspec init fails with stderr
      const error = new Error('Command failed: openspec init ...') as Error & { stderr?: Buffer };
      error.stderr = Buffer.from('network timeout while fetching OpenSpec skills');
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
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
      // Third call: existing OpenSpec version is compatible
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('1.5.0'));
      // Fourth call: openspec init fails with timeout
      const error = new Error('Command failed: openspec init ...') as Error & {
        stderr?: Buffer;
        code?: string;
      };
      error.code = 'ETIMEDOUT';
      mockedExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
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
      const profileError = new Error(
        'Command failed: openspec init /tmp/test --tools claude --profile custom',
      ) as Error & { stderr?: Buffer };
      profileError.stderr = Buffer.from("error: unknown option '--profile'");
      mockedExecFileSync.mockImplementationOnce(() => {
        throw profileError;
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec-project-'));
      try {
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        const result = await installOpenSpec(projectDir, ['claude'], 'project');

        expect(result).toBe('installed');
        expect(mockedExecFileSync).toHaveBeenCalledTimes(6);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('retrying without it'));

        // The staging retry drops --profile, while the independent artifact-root
        // init still runs with --tools none.
        const retryArgs = mockedExecFileSync.mock.calls[4][1] as string[];
        expect(retryArgs).not.toContain('--profile');
        const artifactArgs = mockedExecFileSync.mock.calls[5][1] as string[];
        expect(
          artifactArgs.map((arg, index) => (index === 1 ? unquoteWindowsArg(arg) : arg)),
        ).toEqual(['init', projectDir, '--tools', 'none', '--profile', 'custom']);

        warnSpy.mockRestore();
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('returns failed when retry without --profile also fails', async () => {
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
      mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
      const profileError = new Error('Command failed: openspec init ...') as Error & {
        stderr?: Buffer;
      };
      profileError.stderr = Buffer.from("error: unknown option '--profile'");
      mockedExecFileSync.mockImplementationOnce(() => {
        throw profileError;
      });
      // Retry also fails
      mockedExecFileSync.mockImplementationOnce(() => {
        throw new Error('retry also failed');
      });

      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
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

      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
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

      const { migrateOpenCodeOpenSpecPaths } =
        await import('../../../domains/integrations/openspec.js');
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

      const { migrateOpenCodeOpenSpecPaths } =
        await import('../../../domains/integrations/openspec.js');
      expect(() => migrateOpenCodeOpenSpecPaths(fakeHome)).not.toThrow();

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('integrates with installOpenSpec for global scope with opencode tool', async () => {
      mockedExecFileSync.mockReturnValue(Buffer.from('/usr/bin/openspec'));
      mockedExecFileSync.mockReturnValue(Buffer.from('ok'));
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-install-test-'));
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);

      const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
      const result = await installOpenSpec('/tmp/test', ['opencode', 'claude'], 'global');

      expect(result).toBe('installed');

      homedirSpy.mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // Regression for issue #123: on Windows, project paths containing spaces
    // must be quoted so the shell does not split them into multiple args.
    describe('Windows paths with spaces (issue #123)', () => {
      const realPlatform = process.platform;
      function stubWin32() {
        Object.defineProperty(process, 'platform', { value: 'win32' });
      }
      function restorePlatform() {
        Object.defineProperty(process, 'platform', { value: realPlatform });
      }
      afterEach(restorePlatform);

      it('quotes a project path with spaces when invoking openspec init on Windows', async () => {
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec win project-'));
        try {
          // isCommandAvailable -> ready; npm upgrade; re-check -> ready; init succeeds.
          mockedExecFileSync.mockReturnValueOnce(Buffer.from('C:\\openspec.cmd'));
          mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
          mockedExecFileSync.mockReturnValueOnce(Buffer.from('C:\\openspec.cmd'));

          stubWin32();
          const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
          const result = await installOpenSpec(projectDir, ['claude'], 'project');

          expect(result).toBe('installed');
          const quotedProjectDir = `"${projectDir}"`;
          const initCall = mockedExecFileSync.mock.calls.find(
            ([command, args]) =>
              command === 'openspec' && Array.isArray(args) && args.includes(quotedProjectDir),
          );
          expect(initCall).toBeDefined();
          const initArgs = initCall?.[1] as string[];
          // The space-containing path is a single quoted argument.
          expect(initArgs).toContain(quotedProjectDir);
          // Artifact-root initialization is isolated from tool generation.
          expect(initArgs).toContain('--tools');
          expect(initArgs).toContain('none');
          const stagingInit = mockedExecFileSync.mock.calls.find(
            ([command, args]) =>
              command === 'openspec' &&
              Array.isArray(args) &&
              args[0] === 'init' &&
              args.includes('claude'),
          );
          expect(stagingInit).toBeDefined();
          // Shell must be enabled so the quotes are honored by cmd.exe.
          const initOptions = mockedExecFileSync.mock.calls.find(
            ([command, args]) =>
              command === 'openspec' && Array.isArray(args) && args.includes(quotedProjectDir),
          )?.[2] as { shell?: boolean };
          expect(initOptions?.shell).toBe(true);
        } finally {
          fs.rmSync(projectDir, { recursive: true, force: true });
        }
      });

      it('quotes the fallback init invocation path when retrying without --profile', async () => {
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-openspec win project-'));
        try {
          mockedExecFileSync.mockReturnValueOnce(Buffer.from('C:\\openspec.cmd'));
          mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
          mockedExecFileSync.mockReturnValueOnce(Buffer.from('C:\\openspec.cmd'));
          // Staging tool generation succeeds with real staged output before the
          // artifact-root init exercises the profile fallback.
          mockedExecFileSync.mockImplementationOnce((command, args) => {
            const target = unquoteWindowsArg((args as string[])[1]);
            const generated = path.join(target, '.claude', 'skills', 'openspec-propose');
            fs.mkdirSync(generated, { recursive: true });
            fs.writeFileSync(path.join(generated, 'SKILL.md'), '# staged\n');
            return Buffer.from('ok');
          });
          const profileError = new Error('Command failed: openspec init ...') as Error & {
            stderr?: Buffer;
          };
          profileError.stderr = Buffer.from("error: unknown option '--profile'");
          mockedExecFileSync.mockImplementationOnce(() => {
            throw profileError;
          });
          mockedExecFileSync.mockReturnValueOnce(Buffer.from('ok'));

          stubWin32();
          const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
          const result = await installOpenSpec(projectDir, ['claude'], 'project');

          expect(result).toBe('installed');
          const quotedProjectDir = `"${projectDir}"`;
          // The retry call (without --profile) must also quote the spaced path.
          const retryCall = mockedExecFileSync.mock.calls.find(
            ([command, args]) =>
              command === 'openspec' &&
              Array.isArray(args) &&
              args.includes(quotedProjectDir) &&
              !args.includes('--profile'),
          );
          expect(retryCall).toBeDefined();
        } finally {
          fs.rmSync(projectDir, { recursive: true, force: true });
        }
      });

      it('does not quote args on non-Windows platforms (no regression)', async () => {
        mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));
        mockedExecFileSync.mockReturnValueOnce(Buffer.from('upgraded'));
        mockedExecFileSync.mockReturnValueOnce(Buffer.from('/usr/bin/openspec'));

        // Force a non-Windows platform regardless of where the suite runs.
        Object.defineProperty(process, 'platform', { value: 'linux' });
        const { installOpenSpec } = await import('../../../domains/integrations/openspec.js');
        await installOpenSpec('/home/test user/project', ['claude'], 'project');

        const initCall = mockedExecFileSync.mock.calls.find(
          ([command, args]) =>
            command === 'openspec' &&
            Array.isArray(args) &&
            args.includes('/home/test user/project'),
        );
        const initArgs = initCall?.[1] as string[];
        // On non-Windows, args are passed to argv directly — no quoting.
        expect(initArgs).toContain('/home/test user/project');
        const initOptions = initCall?.[2] as { shell?: boolean };
        expect(initOptions?.shell).toBe(false);
      });
    });
  });
});
