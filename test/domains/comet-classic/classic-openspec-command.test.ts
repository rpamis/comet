import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));
vi.mock('../../../platform/process/node-cli-command.js', () => ({
  resolveNodeCliCommand: (command: string, args: string[]) => ({ command, args }),
}));

const mockedSpawnSync = vi.mocked(spawnSync);

describe('Classic OpenSpec adapter', () => {
  let projectRoot: string;
  let previousCwd: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    previousCwd = process.cwd();
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-openspec-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
    await fs.mkdir(path.join(projectRoot, '.comet'));
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'native:',
        '  artifact_root: docs',
        'classic:',
        '  artifact_layout: docs',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'docs', 'openspec', 'config.yaml'),
      'schema: spec-driven\n',
      'utf8',
    );
    process.chdir(projectRoot);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function seedReadyArchiveChange(): Promise<void> {
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [null, '', ''],
      stdout: '',
      stderr: '',
      status: 1,
      signal: null,
    });
    expect((await runClassicCli(['state', 'init', 'demo', 'full'])).exitCode).toBe(0);
    const previousForcePhase = process.env.COMET_FORCE_PHASE;
    process.env.COMET_FORCE_PHASE = '1';
    try {
      expect((await runClassicCli(['state', 'set', 'demo', 'phase', 'archive'])).exitCode).toBe(0);
    } finally {
      if (previousForcePhase === undefined) delete process.env.COMET_FORCE_PHASE;
      else process.env.COMET_FORCE_PHASE = previousForcePhase;
    }
    expect((await runClassicCli(['state', 'set', 'demo', 'verify_result', 'pass'])).exitCode).toBe(
      0,
    );
    expect((await runClassicCli(['state', 'transition', 'demo', 'archive-confirm'])).exitCode).toBe(
      0,
    );
  }

  it('runs OpenSpec from the configured base and preserves output, JSON args, and exit code', async () => {
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [null, '{"changes":[]}\n', 'warning\n'],
      stdout: '{"changes":[]}\n',
      stderr: 'warning\n',
      status: 9,
      signal: null,
    });

    const result = await runClassicCli(['openspec', '--', 'status', '--change', 'demo', '--json']);

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'openspec',
      ['status', '--change', 'demo', '--json'],
      expect.objectContaining({ cwd: path.join(projectRoot, 'docs') }),
    );
    expect(result).toEqual({
      exitCode: 9,
      stdout: '{"changes":[]}\n',
      stderr: 'warning\n',
    });
  });

  it('uses the configured docs root when a standalone OpenSpec root also exists', async () => {
    await fs.mkdir(path.join(projectRoot, 'openspec'));
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [null, 'standalone root is independent\n', ''],
      stdout: 'standalone root is independent\n',
      stderr: '',
      status: 0,
      signal: null,
    });

    const result = await runClassicCli(['openspec', 'status']);

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'standalone root is independent\n',
      stderr: undefined,
    });
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'openspec',
      ['status'],
      expect.objectContaining({ cwd: path.join(projectRoot, 'docs') }),
    );
  });

  it('returns executable adapter next actions while preserving the raw upstream context', async () => {
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: JSON.stringify({
        changeName: 'demo',
        nextSteps: ['openspec instructions proposal --change demo'],
        artifacts: [{ id: 'proposal', status: 'ready' }],
      }),
      stderr: '',
      status: 0,
      signal: null,
    });
    const status = JSON.parse(
      (
        await runClassicCli([
          'openspec',
          '--agent-json',
          '--',
          'status',
          '--change',
          'demo',
          '--json',
        ])
      ).stdout!,
    );
    expect(status.data.upstream.cwd).toBe(path.join(projectRoot, 'docs'));
    expect(status.data.upstream.data.nextSteps).toEqual([
      'openspec instructions proposal --change demo',
    ]);
    expect(status.data.nextAction.cwd).toBe(projectRoot);
    expect(status.data.nextAction.argv).toEqual([
      'comet',
      'classic',
      'openspec',
      '--agent-json',
      '--',
      'instructions',
      'proposal',
      '--change',
      'demo',
      '--json',
    ]);
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: '{"template":"# Proposal"}',
      stderr: '',
      status: 0,
      signal: null,
    });
    const instructions = await runClassicCli(status.data.nextAction.argv.slice(2));
    expect(instructions.exitCode).toBe(0);
    expect(mockedSpawnSync).toHaveBeenLastCalledWith(
      'openspec',
      ['instructions', 'proposal', '--change', 'demo', '--json'],
      expect.objectContaining({ cwd: path.join(projectRoot, 'docs'), shell: false }),
    );
    expect(JSON.parse(instructions.stdout!).data.nextAction.argv).toContain('status');
  });

  it('fails closed when the configured OpenSpec root is missing', async () => {
    await fs.rm(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });

    const result = await runClassicCli(['openspec', 'status']);

    expect(result.exitCode).toBe(70);
    expect(result.stderr).toContain('Configured Classic OpenSpec root is missing');
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it('fails closed when the configured OpenSpec root was not initialized', async () => {
    await fs.rm(path.join(projectRoot, 'docs', 'openspec', 'config.yaml'));

    const result = await runClassicCli(['openspec', 'status']);

    expect(result.exitCode).toBe(70);
    expect(result.stderr).toContain('Classic OpenSpec root is unhealthy');
    expect(result.stderr).toContain('config.yaml is missing');
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it('fails closed when the configured OpenSpec project config is corrupt', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'docs', 'openspec', 'config.yaml'),
      'schema: [broken\n',
      'utf8',
    );

    const result = await runClassicCli(['openspec', 'status']);

    expect(result.exitCode).toBe(70);
    expect(result.stderr).toContain('Classic OpenSpec root is unhealthy');
    expect(result.stderr).toContain('invalid YAML');
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it('routes archive through the shared adapter and preserves OpenSpec process output', async () => {
    await seedReadyArchiveChange();
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [null, 'archive stdout\n', 'archive stderr\n'],
      stdout: 'archive stdout\n',
      stderr: 'archive stderr\n',
      status: 9,
      signal: null,
    });
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    let result: Awaited<ReturnType<typeof runClassicCli>>;
    try {
      result = await runClassicCli(['archive', 'demo']);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'openspec',
      ['archive', 'demo', '--yes'],
      expect.objectContaining({
        cwd: path.join(projectRoot, 'docs'),
        windowsHide: true,
      }),
    );
    expect(result.exitCode).toBe(9);
    expect(result.stdout).toBe('archive stdout\n');
    expect(result.stderr).toContain('archive stderr\n');
  });

  it('uses the shared missing-executable exit mapping without moving the active change', async () => {
    await seedReadyArchiveChange();
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [null, '', ''],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: Object.assign(new Error('spawn openspec ENOENT'), { code: 'ENOENT' }),
    });

    const result = await runClassicCli(['archive', 'demo']);

    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('OpenSpec CLI not found: openspec');
    await expect(
      fs.access(path.join(projectRoot, 'docs', 'openspec', 'changes', 'demo', '.comet.yaml')),
    ).resolves.toBeUndefined();
  });
});
