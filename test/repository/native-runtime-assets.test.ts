import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import manifest from '../../assets/manifest.json';

const runtime = path.resolve(
  'assets',
  'skills',
  'comet-native',
  'scripts',
  'comet-native-runtime.mjs',
);
const builder = path.resolve('scripts', 'build', 'build-native-runtime.mjs');

describe('Native runtime release asset', () => {
  it('publishes the Native Skill, references, and runtime from the manifest', () => {
    for (const relative of [
      'comet-native/SKILL.md',
      'comet-native/reference/artifacts.md',
      'comet-native/reference/commands.md',
      'comet-native/reference/recovery.md',
      'comet-native/scripts/comet-native-runtime.mjs',
      'comet-native/scripts/comet-native-hook-guard.mjs',
    ]) {
      expect(manifest.skills).toContain(relative);
    }
  });

  it('ships one fresh self-contained Node runtime', async () => {
    const source = await fs.readFile(runtime, 'utf8');

    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    for (const command of [
      'init',
      'hook-guard',
      'root',
      'new',
      'list',
      'show',
      'status',
      'select',
      'next',
      'archive',
      'doctor',
    ]) {
      expect(source).toContain(command);
    }
    expect(source).not.toMatch(/domains\/comet-classic|openspec|superpowers|requiredSkillCalls/iu);
    expect(source).not.toMatch(/CLASSIC_RUN_STORAGE/u);
    expect(source).toContain('.comet/config.yaml');
    expect(source).toContain('parseCometHookRequest');
    expect(source).toContain('Hook write target could not be determined');
    execFileSync(process.execPath, [builder, '--check'], { stdio: 'pipe' });
  });

  it('documents the docs-based default artifact root bilingually', async () => {
    const english = await fs.readFile(
      path.resolve('assets', 'skills', 'comet-native', 'reference', 'commands.md'),
      'utf8',
    );
    const chinese = await fs.readFile(
      path.resolve('assets', 'skills-zh', 'comet-native', 'reference', 'commands.md'),
      'utf8',
    );

    expect(english).toContain(
      '`new` creates default configuration and `<project>/docs/comet/` when configuration is absent.',
    );
    expect(chinese).toContain('`new` 在配置缺失时创建默认配置和 `<project>/docs/comet/`。');
  });

  it('detects a stale generated runtime', async () => {
    const original = await fs.readFile(runtime);
    try {
      await fs.writeFile(runtime, Buffer.concat([original, Buffer.from('\n// stale fixture\n')]));
      const result = spawnSync(process.execPath, [builder, '--check'], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Native runtime script is stale');
    } finally {
      await fs.writeFile(runtime, original);
    }
  });
});
