import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';

describe('Classic root show', () => {
  let projectRoot: string;
  let previousCwd: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-root-show-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
    await fs.mkdir(path.join(projectRoot, '.comet'));
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: legacy',
        '',
      ].join('\n'),
      'utf8',
    );
    previousCwd = process.cwd();
    process.chdir(projectRoot);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('reports a healthy configured root', async () => {
    await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });

    const result = await runClassicCli(['root', 'show']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout ?? '{}')).toMatchObject({
      schema: 'comet.classic-layout.v1',
      artifactLayout: 'legacy',
      openSpecRoot: 'openspec',
    });
  });

  it('fails when the configured root is missing', async () => {
    const result = await runClassicCli(['root', 'show']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Configured Classic OpenSpec root is missing');
  });

  it('fails when both roots exist', async () => {
    await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });

    const result = await runClassicCli(['root', 'show']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Classic layout conflict');
  });

  it('fails when a managed root is a directory link', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-root-show-outside-'));
    try {
      try {
        await fs.symlink(
          outsideRoot,
          path.join(projectRoot, 'openspec'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      const result = await runClassicCli(['root', 'show']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/symbolic link or junction/iu);
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('requires --apply --plan <id> and keeps dry-run read-only', async () => {
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectRoot, 'openspec', 'specs'), { recursive: true });

    const dryRun = await runClassicCli(['root', 'move', 'docs', '--dry-run']);
    expect(dryRun.exitCode).toBe(0);
    const planId = dryRun.stdout?.match(/^plan: ([a-f0-9]{64})$/mu)?.[1];
    expect(planId).toMatch(/^[a-f0-9]{64}$/u);
    await expect(fs.stat(path.join(projectRoot, 'docs', 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const missingPlan = await runClassicCli(['root', 'move', 'docs', '--apply']);
    expect(missingPlan.exitCode).toBe(64);
    expect(missingPlan.stderr).toContain('--apply --plan <id>');

    const applied = await runClassicCli([
      'root',
      'move',
      'docs',
      '--apply',
      '--plan',
      String(planId),
    ]);
    expect(applied.exitCode).toBe(0);
    await expect(fs.stat(path.join(projectRoot, 'docs', 'openspec'))).resolves.toBeDefined();
  });
});
