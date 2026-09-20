import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import manifest from '../../assets/manifest.json';

const generatedRuntime = path.resolve(
  'assets',
  'skills',
  'comet',
  'scripts',
  'comet-entry-runtime.mjs',
);
const generatedHookRouter = path.resolve(
  'assets',
  'skills',
  'comet',
  'scripts',
  'comet-hook-router.mjs',
);
const builder = path.resolve('scripts', 'build', 'build-entry-runtime.mjs');

describe('Comet entry resolver runtime release asset', () => {
  let temporaryRoot: string;
  let skillOnlyRuntime: string;
  let skillOnlyHookRouter: string;

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-entry-runtime-'));
    skillOnlyRuntime = path.join(
      temporaryRoot,
      'installed-skills',
      'comet',
      'scripts',
      'comet-entry-runtime.mjs',
    );
    skillOnlyHookRouter = path.join(
      temporaryRoot,
      'installed-skills',
      'comet',
      'scripts',
      'comet-hook-router.mjs',
    );
    await fs.mkdir(path.dirname(skillOnlyRuntime), { recursive: true });
    await fs.copyFile(generatedRuntime, skillOnlyRuntime);
    await fs.copyFile(generatedHookRouter, skillOnlyHookRouter);
  });

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  function runSkillOnly(projectRoot: string) {
    return spawnSync(process.execPath, [skillOnlyRuntime, projectRoot, '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, PATH: '' },
    });
  }

  it('publishes one fresh self-contained resolver without workflow execution logic', async () => {
    expect(manifest.skills).toContain('comet/scripts/comet-entry-runtime.mjs');
    const source = await fs.readFile(generatedRuntime, 'utf8');

    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(source).toContain('comet.workflow-resolution.v1');
    expect(source).not.toMatch(
      /openspec|superpowers|comet native|comet state|comet guard|runNativeCli|runClassicCli|classic-runtime|native-runtime/iu,
    );
    execFileSync(process.execPath, [builder, '--check'], { stdio: 'pipe' });
  });

  it('publishes a fresh Hook Router that validates platform configuration', async () => {
    expect(manifest.skills).toContain('comet/scripts/comet-hook-router.mjs');
    const source = await fs.readFile(generatedHookRouter, 'utf8');
    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(source).toContain('comet.selection.v2');
    expect(source).toContain('Multiple active Comet changes');

    const unsupported = spawnSync(
      process.execPath,
      [generatedHookRouter, '--platform', 'unknown-platform'],
      { cwd: temporaryRoot, encoding: 'utf8' },
    );
    expect(unsupported.status).toBe(64);
    expect(unsupported.stderr).toContain('unsupported Hook platform');

    const outsideProject = spawnSync(
      process.execPath,
      [generatedHookRouter, '--platform', 'claude'],
      {
        cwd: temporaryRoot,
        encoding: 'utf8',
        env: { ...process.env, FILE_PATH: 'src/app.ts' },
      },
    );
    expect(outsideProject.status).toBe(0);
    expect(outsideProject.stdout).toBe('');
    expect(outsideProject.stderr).toBe('');
  });

  it('initializes plugin context from an installed-only Hook Router with the build version', async () => {
    const projectRoot = path.join(temporaryRoot, 'context-project');
    const home = path.join(temporaryRoot, 'home');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [skillOnlyHookRouter, '--platform', 'claude', '--project-root', projectRoot],
      {
        cwd: projectRoot,
        input: JSON.stringify({ hook_event_name: 'BeforeAgentStart', prompt: 'Inspect context' }),
        encoding: 'utf8',
        env: { ...process.env, HOME: home, USERPROFILE: home, PATH: '' },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('Unable to locate package.json');
    await expect(
      fs.access(path.join(home, '.comet', 'plugins', 'state.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const packageVersion = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'))
      .version as string;
    expect(await fs.readFile(skillOnlyHookRouter, 'utf8')).toContain(`return"${packageVersion}"`);
  });

  it('reports bounded plugin initialization failures from an installed-only Hook Router', async () => {
    const projectRoot = path.join(temporaryRoot, 'broken-context-project');
    const home = path.join(temporaryRoot, 'broken-home');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.mkdir(path.join(home, '.comet', 'plugins'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.comet', 'plugins', 'state.json'),
      '{ invalid plugin state',
      'utf8',
    );
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [skillOnlyHookRouter, '--platform', 'claude', '--project-root', projectRoot],
      {
        cwd: projectRoot,
        input: JSON.stringify({ hook_event_name: 'BeforeAgentStart', prompt: 'Inspect context' }),
        encoding: 'utf8',
        env: { ...process.env, HOME: home, USERPROFILE: home, PATH: '' },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Comet context is temporarily unavailable');
    expect(result.stderr.length).toBeLessThanOrEqual(513);
    expect(result.stderr).not.toContain('Unable to locate package.json');
  });

  it('does not let an unrelated malformed Classic change block the selected Classic owner', async () => {
    const projectRoot = path.join(temporaryRoot, 'classic-targeted-owner');
    const selectedDir = path.join(projectRoot, 'openspec', 'changes', 'selected');
    const malformedDir = path.join(projectRoot, 'openspec', 'changes', 'malformed');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.mkdir(selectedDir, { recursive: true });
    await fs.mkdir(malformedDir, { recursive: true });
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
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'current-change.json'),
      `${JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'classic',
        change: 'selected',
        branch: null,
      })}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(selectedDir, '.comet.yaml'),
      [
        'workflow: hotfix',
        'phase: build',
        'design_doc: null',
        'plan: null',
        'verification_report: null',
        'build_mode: direct',
        'isolation: null',
        'verify_mode: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(path.join(malformedDir, '.comet.yaml'), 'workflow: [broken\n', 'utf8');

    const result = spawnSync(
      process.execPath,
      [skillOnlyHookRouter, '--platform', 'claude', '--project-root', projectRoot],
      {
        cwd: projectRoot,
        input: JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: 'src/feature.ts' },
        }),
        encoding: 'utf8',
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('blocks a selected Classic change from writing another Classic change artifact', async () => {
    const projectRoot = path.join(temporaryRoot, 'classic-cross-owner');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
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
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'current-change.json'),
      `${JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'classic',
        change: 'selected',
        branch: null,
      })}\n`,
      'utf8',
    );
    for (const changeName of ['selected', 'other']) {
      const changeDir = path.join(projectRoot, 'openspec', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, '.comet.yaml'),
        [
          'workflow: hotfix',
          'phase: build',
          'design_doc: null',
          'plan: null',
          'verification_report: null',
          'build_mode: direct',
          'isolation: null',
          'verify_mode: null',
          'verify_result: pending',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
        'utf8',
      );
    }

    for (const target of [
      'openspec/changes/other/tasks.md',
      'openspec/changes/other/.comet/handoff/design-context.json',
    ]) {
      const result = spawnSync(
        process.execPath,
        [skillOnlyHookRouter, '--platform', 'claude', '--project-root', projectRoot],
        {
          cwd: projectRoot,
          input: JSON.stringify({
            tool_name: 'Write',
            tool_input: { file_path: target },
          }),
          encoding: 'utf8',
        },
      );

      expect(result.status, target).toBe(2);
      expect(result.stdout, target).toBe('');
      expect(result.stderr, target).toContain("belongs to Classic change 'other'");
      expect(result.stderr, target).toContain("current selection is 'selected'");
    }
  });

  it.runIf(process.platform === 'win32')(
    'blocks a Windows case variant that targets another selected Classic change',
    async () => {
      const projectRoot = path.join(temporaryRoot, 'classic-cross-owner-case');
      await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
      await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
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
      await fs.writeFile(
        path.join(projectRoot, '.comet', 'current-change.json'),
        `${JSON.stringify({
          schema: 'comet.selection.v2',
          workflow: 'classic',
          change: 'selected',
          branch: null,
        })}\n`,
        'utf8',
      );
      for (const changeName of ['selected', 'other']) {
        const changeDir = path.join(projectRoot, 'openspec', 'changes', changeName);
        await fs.mkdir(changeDir, { recursive: true });
        await fs.writeFile(
          path.join(changeDir, '.comet.yaml'),
          [
            'workflow: hotfix',
            'phase: build',
            'design_doc: null',
            'plan: null',
            'verification_report: null',
            'build_mode: direct',
            'isolation: null',
            'verify_mode: null',
            'verify_result: pending',
            'verified_at: null',
            'archived: false',
            '',
          ].join('\n'),
          'utf8',
        );
      }

      const result = spawnSync(
        process.execPath,
        [skillOnlyHookRouter, '--platform', 'claude', '--project-root', projectRoot],
        {
          cwd: projectRoot,
          input: JSON.stringify({
            tool_name: 'Write',
            tool_input: { file_path: 'OpenSpec/changes/other/tasks.md' },
          }),
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain("belongs to Classic change 'other'");
      expect(result.stderr).toContain("current selection is 'selected'");
    },
  );

  it('blocks a selected Classic change from writing an archived Classic artifact', async () => {
    const projectRoot = path.join(temporaryRoot, 'classic-archive-owner');
    const selectedDir = path.join(projectRoot, 'openspec', 'changes', 'selected');
    const archivedDir = path.join(
      projectRoot,
      'openspec',
      'changes',
      'archive',
      '2026-09-20-other',
    );
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.mkdir(selectedDir, { recursive: true });
    await fs.mkdir(archivedDir, { recursive: true });
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
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'current-change.json'),
      `${JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'classic',
        change: 'selected',
        branch: null,
      })}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(selectedDir, '.comet.yaml'),
      [
        'workflow: hotfix',
        'phase: build',
        'design_doc: null',
        'plan: null',
        'verification_report: null',
        'build_mode: direct',
        'isolation: null',
        'verify_mode: null',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(archivedDir, '.comet.yaml'),
      ['workflow: full', 'phase: archive', 'archived: true', ''].join('\n'),
      'utf8',
    );

    for (const target of [
      'openspec/changes/archive/2026-09-20-other/tasks.md',
      'openspec/changes/archive/2026-09-20-other/.comet/handoff/design-context.json',
    ]) {
      const result = spawnSync(
        process.execPath,
        [skillOnlyHookRouter, '--platform', 'claude', '--project-root', projectRoot],
        {
          cwd: projectRoot,
          input: JSON.stringify({
            tool_name: 'Write',
            tool_input: { file_path: target },
          }),
          encoding: 'utf8',
        },
      );

      expect(result.status, target).toBe(2);
      expect(result.stdout, target).toBe('');
      expect(result.stderr, target).toContain("belongs to archived Classic change 'other'");
      expect(result.stderr, target).toContain("current selection is 'selected'");
    }
  });

  it('resolves Native from project config with only the bundled Skill runtime available', async () => {
    const projectRoot = path.join(temporaryRoot, 'native-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = runSkillOnly(projectRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schema: 'comet.workflow-resolution.v1',
      workflow: 'native',
      skill: 'comet-native',
      source: 'project-config',
    });
  });

  it('fails closed when configuration is absent with only the bundled Skill runtime available', async () => {
    const projectRoot = path.join(temporaryRoot, 'classic-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });

    const result = runSkillOnly(projectRoot);

    expect(result.status).toBe(65);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'failed',
      exitCode: 65,
      error: expect.stringContaining('.comet/config.yaml is missing'),
    });
    expect(result.stderr).toBe('');
  });

  it('fails closed on malformed config instead of falling back to Classic', async () => {
    const projectRoot = path.join(temporaryRoot, 'invalid-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: [broken\n',
      'utf8',
    );

    const result = runSkillOnly(projectRoot);

    expect(result.status).toBe(65);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'failed',
      exitCode: 65,
      error: expect.stringMatching(/Invalid \.comet\/config\.yaml/iu),
    });
    expect(result.stdout).not.toContain('legacy-fallback');
    expect(result.stderr).toBe('');
  });
});
