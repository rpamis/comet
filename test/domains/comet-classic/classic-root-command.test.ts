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

  it('reads the Classic root when Native artifact defaults are missing', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native, classic]',
        'native:',
        '  language: en',
        'classic:',
        '  artifact_layout: legacy',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });

    const result = await runClassicCli(['root', 'show']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout ?? '{}')).toMatchObject({
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

  it('keeps dry-run read-only and applies without exposing a plan ID', async () => {
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectRoot, 'openspec', 'specs'), { recursive: true });

    const dryRun = await runClassicCli(['root', 'move', 'docs', '--dry-run']);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain('Classic 根目录迁移现状');
    expect(dryRun.stdout).toContain('仅查看现状，未修改任何文件');
    expect(dryRun.stdout).toContain('comet classic root move docs --apply');
    expect(dryRun.stdout).not.toContain('plan:');
    expect(dryRun.stdout).not.toContain('approved plan ID');
    await expect(fs.stat(path.join(projectRoot, 'docs', 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const legacySyntax = await runClassicCli([
      'root',
      'move',
      'docs',
      '--apply',
      '--plan',
      'a'.repeat(64),
    ]);
    expect(legacySyntax.exitCode).toBe(64);
    expect(legacySyntax.stderr).not.toContain('--plan');

    const applied = await runClassicCli(['root', 'move', 'docs', '--apply']);
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain('Classic 根目录迁移完成');
    expect(applied.stdout.trimEnd()).toMatch(/结果：迁移已完成。$/u);
    await expect(fs.stat(path.join(projectRoot, 'docs', 'openspec'))).resolves.toBeDefined();
  });

  it('renders root move output in English when classic.language is en', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: legacy',
        '  language: en',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectRoot, 'openspec', 'specs'), { recursive: true });

    const dryRun = await runClassicCli(['root', 'move', 'docs', '--dry-run']);

    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain('Classic root move status');
    expect(dryRun.stdout).toContain('Inspection only; no files were changed');
    expect(dryRun.stdout).not.toMatch(/[\u4e00-\u9fff]/u);
  });

  it('renders invalid migration journal errors in the configured language', async () => {
    await fs.writeFile(path.join(projectRoot, '.comet', 'classic-root-move.json'), '{}\n', 'utf8');
    await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });

    const result = await runClassicCli(['root', 'move', 'docs', '--dry-run']);

    expect(result.exitCode).toBe(70);
    expect(result.stderr).toContain('Classic 根目录迁移失败');
    expect(result.stderr).toContain('迁移记录格式或内容无效');
    expect(result.stderr).not.toContain('invalid Classic root move journal');
  });

  it('reports an already migrated docs layout without failing or mutating files', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: docs',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec', 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec', 'specs'), { recursive: true });

    const dryRun = await runClassicCli(['root', 'move', 'docs', '--dry-run']);
    const apply = await runClassicCli(['root', 'move', 'docs', '--apply']);

    expect(dryRun).toMatchObject({ exitCode: 0 });
    expect(dryRun.stdout).toContain('已经使用 docs/openspec');
    expect(apply).toMatchObject({ exitCode: 0 });
    expect(apply.stdout).toContain('无需重复迁移');
    await expect(fs.stat(path.join(projectRoot, 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
