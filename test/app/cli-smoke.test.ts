import { spawnSync } from 'child_process';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
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

  it('accepts -v as a version alias', async () => {
    const result = runCli('-v');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/u);
    expect(result.stderr).toBe('');
  });
});
