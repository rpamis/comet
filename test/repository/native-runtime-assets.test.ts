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

async function writeRuntimeWithRetry(contents: Buffer): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.writeFile(runtime, contents);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'UNKNOWN' && code !== 'EPERM') throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw lastError;
}

describe('Native runtime release asset', () => {
  it('publishes the Native Skill, references, and runtime from the manifest', () => {
    for (const relative of [
      'comet-native/SKILL.md',
      'comet-native/reference/artifacts.md',
      'comet-native/reference/clarification.md',
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
      'trust',
      'receipt',
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
    expect(source).toContain('comet.native.controller-trust-store.v1');
    expect(source).toContain('comet.native.creation-authorization.v1');
    expect(source).toContain('comet.native.review-trust-policy.v2');
    expect(source).toContain(
      'trust authorize <change-name> --controller-private-key-env <name> --output <path>',
    );
    expect(source).toContain(
      'new <change-name> --creation-authorization <path> [--language en|zh-CN]',
    );
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
      'comet native new <change-name> --creation-authorization <path> [--language en|zh-CN]',
    );
    expect(chinese).toContain(
      'comet native new <change-name> --creation-authorization <path> [--language en|zh-CN]',
    );
    expect(english).toContain('`new` creates default configuration and `<project>/docs/comet/`');
    expect(chinese).toContain('`new` 在配置缺失时创建默认配置和 `<project>/docs/comet/`');
  });

  it('detects a stale generated runtime', async () => {
    const original = await fs.readFile(runtime);
    try {
      await writeRuntimeWithRetry(Buffer.concat([original, Buffer.from('\n// stale fixture\n')]));
      const result = spawnSync(process.execPath, [builder, '--check'], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Native runtime script is stale');
    } finally {
      await writeRuntimeWithRetry(original);
    }
  });
});
