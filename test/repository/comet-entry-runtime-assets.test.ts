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
const builder = path.resolve('scripts', 'build', 'build-entry-runtime.mjs');

describe('Comet entry resolver runtime release asset', () => {
  let temporaryRoot: string;
  let skillOnlyRuntime: string;

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-entry-runtime-'));
    skillOnlyRuntime = path.join(
      temporaryRoot,
      'installed-skills',
      'comet',
      'scripts',
      'comet-entry-runtime.mjs',
    );
    await fs.mkdir(path.dirname(skillOnlyRuntime), { recursive: true });
    await fs.copyFile(generatedRuntime, skillOnlyRuntime);
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

  it('resolves Native from project config with only the bundled Skill runtime available', async () => {
    const projectRoot = path.join(temporaryRoot, 'native-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'comet.config.yaml'),
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

  it('uses the no-config Classic fallback with only the bundled Skill runtime available', async () => {
    const projectRoot = path.join(temporaryRoot, 'classic-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });

    const result = runSkillOnly(projectRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schema: 'comet.workflow-resolution.v1',
      workflow: 'classic',
      skill: 'comet-classic',
      source: 'legacy-fallback',
    });
  });

  it('fails closed on malformed config instead of falling back to Classic', async () => {
    const projectRoot = path.join(temporaryRoot, 'invalid-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'comet.config.yaml'), 'schema: [broken\n', 'utf8');

    const result = runSkillOnly(projectRoot);

    expect(result.status).toBe(65);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/Invalid comet\.config\.yaml/iu);
    expect(result.stderr).not.toContain('legacy-fallback');
  });
});
