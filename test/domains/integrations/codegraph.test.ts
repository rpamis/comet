import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe('codegraph', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-codegraph-'));
    vi.resetAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects an existing project CodeGraph index', async () => {
    const codegraphDir = path.join(tmpDir, '.codegraph');
    fs.mkdirSync(codegraphDir, { recursive: true });
    fs.writeFileSync(path.join(codegraphDir, '.gitignore'), '*\n!.gitignore\n');

    const { hasCodegraphProjectIndex } = await import('../../../domains/integrations/codegraph.js');

    expect(hasCodegraphProjectIndex(tmpDir)).toBe(false);

    fs.writeFileSync(path.join(codegraphDir, 'codegraph.db'), '');

    expect(hasCodegraphProjectIndex(tmpDir)).toBe(true);
  });

  it('skips install when a project CodeGraph index already exists', async () => {
    const codegraphDir = path.join(tmpDir, '.codegraph');
    fs.mkdirSync(codegraphDir, { recursive: true });
    fs.writeFileSync(path.join(codegraphDir, 'codegraph.db'), '');

    const { installCodegraph } = await import('../../../domains/integrations/codegraph.js');
    const result = await installCodegraph(tmpDir, 'project');

    expect(result).toBe('skipped');
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('uses a pnpm global CodeGraph binary instead of reinstalling with npm', async () => {
    const pnpmBinDir = path.join(tmpDir, 'pnpm-bin');
    fs.mkdirSync(pnpmBinDir, { recursive: true });
    const shimName = process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph';
    const shimPath = path.join(pnpmBinDir, shimName);
    fs.writeFileSync(shimPath, '');

    mockedExecFileSync.mockImplementation((command: unknown, args?: unknown) => {
      const cmd = String(command);
      const cmdArgs = Array.isArray(args) ? args.map(String) : [];
      if ((cmd === 'where' || cmd === 'which') && cmdArgs[0] === 'codegraph') {
        throw new Error('not on PATH');
      }
      if ((cmd === 'pnpm' || cmd === 'pnpm.cmd') && cmdArgs.join(' ') === 'bin -g') {
        return `${pnpmBinDir}\n`;
      }
      return Buffer.from('ok');
    });

    const { installCodegraph } = await import('../../../domains/integrations/codegraph.js');
    const result = await installCodegraph(tmpDir, 'project');

    expect(result).toBe('installed');
    expect(mockedExecFileSync.mock.calls).not.toContainEqual(
      expect.arrayContaining([
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['install', '-g', '@colbymchenry/codegraph'],
      ]),
    );
    expect(mockedExecFileSync.mock.calls).toContainEqual(
      expect.arrayContaining([shimPath, ['install', '--yes']]),
    );
  });

  it.each([
    {
      name: 'ready',
      payload: {
        initialized: true,
        pendingChanges: { added: 0, modified: 0, removed: 0 },
        index: { state: 'complete', reindexRecommended: false, pendingRefs: 0 },
      },
      expected: 'index_ready',
      remediation: null,
    },
    {
      name: 'stale',
      payload: {
        initialized: true,
        pendingChanges: { added: 0, modified: 2, removed: 0 },
        index: { state: 'complete', reindexRecommended: false, pendingRefs: 0 },
      },
      expected: 'index_stale',
      remediation: 'codegraph sync',
    },
    {
      name: 'stale extraction',
      payload: {
        initialized: true,
        pendingChanges: { added: 0, modified: 0, removed: 0 },
        index: { state: 'complete', reindexRecommended: true, pendingRefs: 0 },
      },
      expected: 'index_stale',
      remediation: 'codegraph index',
    },
    {
      name: 'incomplete',
      payload: {
        initialized: true,
        pendingChanges: { added: 0, modified: 0, removed: 0 },
        index: { state: 'partial', reindexRecommended: false, pendingRefs: 0 },
      },
      expected: 'index_incomplete',
      remediation: 'codegraph index',
    },
  ])('classifies a $name CodeGraph status response', async ({ payload, expected, remediation }) => {
    const codegraphDir = path.join(tmpDir, '.codegraph');
    fs.mkdirSync(codegraphDir, { recursive: true });
    fs.writeFileSync(path.join(codegraphDir, 'codegraph.db'), '');
    mockedExecFileSync.mockImplementation((command: unknown, args?: unknown) => {
      const cmd = String(command);
      const cmdArgs = Array.isArray(args) ? args.map(String) : [];
      if ((cmd === 'where' || cmd === 'which') && cmdArgs[0] === 'codegraph') {
        return Buffer.from('/usr/bin/codegraph');
      }
      if (cmd === 'codegraph' && cmdArgs[0] === 'status') {
        return JSON.stringify(payload);
      }
      return Buffer.from('');
    });

    const { inspectCodegraphIndex } = await import('../../../domains/integrations/codegraph.js');
    const result = inspectCodegraphIndex(tmpDir);

    expect(result).toMatchObject({
      status: expected,
      remediation,
      repairable: expected !== 'index_ready',
    });
  });

  it('reports a missing project index without invoking CodeGraph status', async () => {
    mockedExecFileSync.mockImplementation((command: unknown, args?: unknown) => {
      const cmd = String(command);
      const cmdArgs = Array.isArray(args) ? args.map(String) : [];
      if ((cmd === 'where' || cmd === 'which') && cmdArgs[0] === 'codegraph') {
        return Buffer.from('/usr/bin/codegraph');
      }
      return Buffer.from('');
    });

    const { inspectCodegraphIndex } = await import('../../../domains/integrations/codegraph.js');
    const result = inspectCodegraphIndex(tmpDir);

    expect(result).toMatchObject({
      status: 'project_not_initialized',
      remediation: 'codegraph init -i',
      repairable: true,
    });
    expect(mockedExecFileSync.mock.calls).not.toContainEqual(
      expect.arrayContaining(['codegraph', expect.arrayContaining(['status'])]),
    );
  });

  it('reports a missing CodeGraph CLI as non-repairable', async () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('command not found');
    });

    const { inspectCodegraphIndex } = await import('../../../domains/integrations/codegraph.js');

    expect(inspectCodegraphIndex(tmpDir)).toMatchObject({
      status: 'cli_missing',
      repairable: false,
      remediation: 'npm install -g @colbymchenry/codegraph',
    });
  });

  it('classifies incomplete, stale, and malformed status payloads', async () => {
    const codegraphDir = path.join(tmpDir, '.codegraph');
    fs.mkdirSync(codegraphDir, { recursive: true });
    fs.writeFileSync(path.join(codegraphDir, 'codegraph.db'), '');
    const payloads = [
      {
        payload: {
          initialized: false,
          index: { state: 'complete', pendingRefs: 0 },
        },
        expected: 'project_not_initialized',
      },
      {
        payload: {
          initialized: true,
          index: { state: 'complete', pendingRefs: 2 },
        },
        expected: 'index_incomplete',
      },
      {
        payload: {
          initialized: true,
          index: { state: 'complete', pendingRefs: 0 },
          worktreeMismatch: 'other-worktree',
        },
        expected: 'index_stale',
      },
      {
        payload: {
          initialized: true,
          pendingChanges: { added: 1, removed: 1 },
          index: { state: 'complete', pendingRefs: 0 },
        },
        expected: 'index_stale',
      },
    ] as const;

    for (const { payload, expected } of payloads) {
      mockedExecFileSync.mockImplementation((command: unknown, args?: unknown) => {
        const cmd = String(command);
        const cmdArgs = Array.isArray(args) ? args.map(String) : [];
        if ((cmd === 'where' || cmd === 'which') && cmdArgs[0] === 'codegraph') {
          return Buffer.from('/usr/bin/codegraph');
        }
        if (cmd === 'codegraph' && cmdArgs[0] === 'status') return JSON.stringify(payload);
        return Buffer.from('');
      });
      const { inspectCodegraphIndex } = await import('../../../domains/integrations/codegraph.js');
      expect(inspectCodegraphIndex(tmpDir).status).toBe(expected);
      vi.resetModules();
    }
  });

  it('reports status command failures and empty output as unavailable', async () => {
    const codegraphDir = path.join(tmpDir, '.codegraph');
    fs.mkdirSync(codegraphDir, { recursive: true });
    fs.writeFileSync(path.join(codegraphDir, 'codegraph.db'), '');
    mockedExecFileSync.mockImplementation((command: unknown, args?: unknown) => {
      const cmd = String(command);
      const cmdArgs = Array.isArray(args) ? args.map(String) : [];
      if ((cmd === 'where' || cmd === 'which') && cmdArgs[0] === 'codegraph') {
        return Buffer.from('/usr/bin/codegraph');
      }
      if (cmd === 'codegraph' && cmdArgs[0] === 'status') throw new Error('status failed');
      return Buffer.from('');
    });
    const { inspectCodegraphIndex } = await import('../../../domains/integrations/codegraph.js');
    expect(inspectCodegraphIndex(tmpDir)).toMatchObject({ status: 'status_unavailable' });
  });

  it('handles unavailable installation and install or init failures', async () => {
    mockedExecFileSync.mockImplementation((command: unknown, args?: unknown) => {
      const cmd = String(command);
      const cmdArgs = Array.isArray(args) ? args.map(String) : [];
      if ((cmd === 'where' || cmd === 'which') && cmdArgs[0] === 'codegraph') {
        throw new Error('not found');
      }
      if ((cmd === 'pnpm' || cmd === 'pnpm.cmd') && cmdArgs.join(' ') === 'bin -g') {
        throw new Error('no global bin');
      }
      throw new Error('install failed');
    });
    const { initializeCodegraphProject, installCodegraph, repairCodegraphIndex } =
      await import('../../../domains/integrations/codegraph.js');
    await expect(installCodegraph(tmpDir, 'project', false, true)).resolves.toBe('skipped');
    await expect(initializeCodegraphProject(tmpDir, false, true)).resolves.toBe('skipped');
    expect(() => repairCodegraphIndex(tmpDir, 'index_stale', true)).toThrow(
      'CodeGraph CLI is not installed',
    );
  });

  it('reports a current project index separately from an unregistered Codex MCP', async () => {
    const homeDir = path.join(tmpDir, 'home');
    fs.mkdirSync(path.join(tmpDir, '.codegraph'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.codegraph', 'codegraph.db'), '');
    fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.codex', 'config.toml'),
      '[mcp_servers.other]\ncommand = "other"\n',
    );
    mockedExecFileSync.mockImplementation((command: unknown, args?: unknown) => {
      const cmd = String(command);
      const cmdArgs = Array.isArray(args) ? args.map(String) : [];
      if ((cmd === 'where' || cmd === 'which') && cmdArgs[0] === 'codegraph') {
        return Buffer.from('/usr/bin/codegraph');
      }
      if (cmd === 'codegraph' && cmdArgs[0] === 'status') {
        return JSON.stringify({
          initialized: true,
          pendingChanges: { added: 0, modified: 0, removed: 0 },
          index: { state: 'complete', reindexRecommended: false, pendingRefs: 0 },
        });
      }
      return Buffer.from('');
    });

    const { inspectCodegraphIntegration } =
      await import('../../../domains/integrations/codegraph.js');
    const result = inspectCodegraphIntegration(tmpDir, 'project', homeDir);

    expect(result).toMatchObject({
      cliStatus: 'installed',
      indexStatus: 'current',
      mcpStatus: 'not_registered',
      effectiveForAgent: { codex: false },
    });
    expect(result.agents).toContainEqual(
      expect.objectContaining({
        id: 'codex',
        registered: false,
        scope: 'global',
      }),
    );
  });

  it('reports a registered Claude MCP independently from project index readiness', async () => {
    const homeDir = path.join(tmpDir, 'home');
    fs.mkdirSync(path.join(tmpDir, '.codegraph'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.codegraph', 'codegraph.db'), '');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          codegraph: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] },
        },
      }),
    );
    mockedExecFileSync.mockImplementation((command: unknown, args?: unknown) => {
      const cmd = String(command);
      const cmdArgs = Array.isArray(args) ? args.map(String) : [];
      if ((cmd === 'where' || cmd === 'which') && cmdArgs[0] === 'codegraph') {
        return Buffer.from('/usr/bin/codegraph');
      }
      if (cmd === 'codegraph' && cmdArgs[0] === 'status') {
        return JSON.stringify({
          initialized: true,
          pendingChanges: { added: 0, modified: 0, removed: 0 },
          index: { state: 'complete', reindexRecommended: false, pendingRefs: 0 },
        });
      }
      return Buffer.from('');
    });

    const { inspectCodegraphIntegration } =
      await import('../../../domains/integrations/codegraph.js');
    const result = inspectCodegraphIntegration(tmpDir, 'project', homeDir);

    expect(result).toMatchObject({
      mcpStatus: 'registered',
      effectiveForAgent: { claude: true },
    });
    expect(result.agents).toContainEqual(
      expect.objectContaining({
        id: 'claude',
        registered: true,
        scope: 'global',
        configPath: path.join(homeDir, '.claude.json'),
      }),
    );
  });

  it.each([
    ['project_not_initialized', 'init'],
    ['index_incomplete', 'index'],
    ['index_stale', 'sync'],
  ] as const)('repairs %s with the matching CodeGraph command', async (status, command) => {
    mockedExecFileSync.mockImplementation((tool: unknown, args?: unknown) => {
      const cmd = String(tool);
      const cmdArgs = Array.isArray(args) ? args.map(String) : [];
      if ((cmd === 'where' || cmd === 'which') && cmdArgs[0] === 'codegraph') {
        return Buffer.from('/usr/bin/codegraph');
      }
      return Buffer.from('');
    });

    const { repairCodegraphIndex } = await import('../../../domains/integrations/codegraph.js');
    repairCodegraphIndex(tmpDir, status);

    expect(mockedExecFileSync.mock.calls).toContainEqual(
      expect.arrayContaining([
        'codegraph',
        command === 'init' ? ['init', '-i'] : [command],
        expect.objectContaining({ cwd: tmpDir }),
      ]),
    );
  });
});
