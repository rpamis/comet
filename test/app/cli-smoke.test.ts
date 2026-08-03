import { spawnSync } from 'child_process';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createNativeChange } from '../../domains/comet-native/native-change.js';
import { nativeProjectPaths } from '../../domains/comet-native/native-paths.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'comet.js');

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('built CLI smoke', () => {
  let projectRoot: string;

  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 120_000);

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-smoke-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('runs doctor through bin/comet.js after the CLI build', async () => {
    const result = runCli('doctor', projectRoot, '--scope', 'project');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Comet Doctor (scope: project)');
  });

  it('runs status through bin/comet.js after the CLI build', async () => {
    const result = runCli('status', projectRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('No active changes.');
  });

  it('shows both Classic roots through the built dashboard CLI without config', async () => {
    await fs.mkdir(path.join(projectRoot, '.git'));
    const changesPaths = ['openspec/changes', 'docs/openspec/changes'] as const;
    for (const changesPath of changesPaths) {
      const changesRoot = path.join(projectRoot, ...changesPath.split('/'));
      await fs.mkdir(path.join(changesRoot, 'archive'), { recursive: true });
      const changeRoot = path.join(changesRoot, 'dashboard-visible');
      await fs.mkdir(changeRoot, { recursive: true });
      await fs.writeFile(
        path.join(changeRoot, '.comet.yaml'),
        ['workflow: full', 'phase: build', 'archived: false', ''].join('\n'),
      );
    }

    const nestedChange = path.join(projectRoot, 'docs', 'openspec', 'changes', 'dashboard-visible');
    const result = runCli('dashboard', nestedChange, '--json');

    expect(result.status, result.stderr).toBe(0);
    const snapshot = JSON.parse(result.stdout);
    expect(snapshot.project.path).toBe(projectRoot);
    expect(snapshot.changes.active.map((change: { id: string }) => change.id)).toEqual(
      expect.arrayContaining([
        'openspec/changes/dashboard-visible',
        'docs/openspec/changes/dashboard-visible',
      ]),
    );
    expect(snapshot.classicError).toBeUndefined();
  });

  it('resolves the configured workflow through bin/comet.js from a nested directory', async () => {
    const initialized = runCli(
      'native',
      'init',
      '--project-root',
      projectRoot,
      '--root',
      'docs',
      '--json',
    );
    expect(initialized.status, initialized.stderr).toBe(0);
    const nested = path.join(projectRoot, 'packages', 'app', 'src');
    await fs.mkdir(nested, { recursive: true });

    const resolved = runCli('workflow', 'resolve', nested, '--json');

    expect(resolved.status, resolved.stderr).toBe(0);
    expect(JSON.parse(resolved.stdout)).toEqual({
      schema: 'comet.workflow-resolution.v1',
      workflow: 'native',
      skill: 'comet-native',
      source: 'project-config',
    });
  });

  it('accepts -v as a version alias', async () => {
    const result = runCli('-v');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/u);
    expect(result.stderr).toBe('');
  });

  it('renders init failures as stable JSON without a Node.js stack trace', () => {
    const result = runCli(
      'init',
      projectRoot,
      '--scope',
      'global',
      '--workflow',
      'classic',
      '--root',
      'docs',
      '--language',
      'en',
      '--json',
    );

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('--root is only valid when the Native workflow is enabled'),
    });
    expect(result.stderr).toContain('--root is only valid when the Native workflow is enabled');
    expect(result.stderr).not.toContain('at initCommand');
  });

  it('runs the Native facade without changing root status and doctor commands', async () => {
    const initialized = runCli('native', 'init', '--project-root', projectRoot, '--json');
    await createNativeChange({
      paths: await nativeProjectPaths(projectRoot, 'docs'),
      name: 'smoke-change',
      language: 'en',
      verificationProtocol: 'legacy-v1',
    });
    const status = runCli(
      'native',
      'status',
      'smoke-change',
      '--project-root',
      projectRoot,
      '--json',
    );

    expect(initialized.status, initialized.stderr).toBe(0);
    expect(JSON.parse(initialized.stdout)).toMatchObject({ command: 'init', exitCode: 0 });
    expect(status.status, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      command: 'status',
      data: { name: 'smoke-change', phase: 'shape' },
    });
    expect(runCli('status', projectRoot).stdout).toContain('No active changes.');
  });
});
