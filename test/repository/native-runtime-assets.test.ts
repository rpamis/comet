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
    expect(source).toContain('Hook write target could not be determined');
    expect(source).not.toContain('comet.native.controller-trust-store.v1');
    expect(source).not.toContain('comet.native.creation-authorization.v1');
    expect(source).not.toContain('comet.native.review-trust-policy.v2');
    expect(source).not.toContain('implementation-attestation');
    expect(source).not.toContain('independent-review');
    expect(source).not.toContain('waiver-receipt');
    expect(source).not.toContain('trust authorize');
    expect(source).toContain('new <change-name> [--language en|zh-CN]');
    execFileSync(process.execPath, [builder, '--check'], { stdio: 'pipe' });
  });

  it('ships one self-contained bundle per command launcher', async () => {
    const scriptsDir = path.resolve('assets', 'skills', 'comet-native', 'scripts');
    // Each per-command launcher must be a self-contained esbuild bundle: it
    // starts with the Node shebang and never re-imports the shared runtime,
    // so loading e.g. the hook-guard launcher only evaluates that command's
    // dependency graph.
    const commandScripts = [
      'comet-native-hook-guard.mjs',
      'comet-native-init.mjs',
      'comet-native-root.mjs',
      'comet-native-new.mjs',
      'comet-native-spec.mjs',
      'comet-native-show.mjs',
      'comet-native-status.mjs',
      'comet-native-select.mjs',
      'comet-native-checkpoint.mjs',
      'comet-native-check.mjs',
      'comet-native-evidence.mjs',
      'comet-native-receipt.mjs',
      'comet-native-next.mjs',
      'comet-native-archive.mjs',
      'comet-native-doctor.mjs',
    ];
    for (const script of commandScripts) {
      const source = await fs.readFile(path.join(scriptsDir, script), 'utf8');
      expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
      expect(source).not.toMatch(/from\s+['"]\.\/comet-native-runtime\.mjs['"]/u);
    }
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

    expect(english).toContain('comet native new <change-name> [--language en|zh-CN]');
    expect(chinese).toContain('comet native new <change-name> [--language en|zh-CN]');
    expect(english).toContain('When configuration is absent');
    expect(english).toContain('`docs/comet/`');
    expect(chinese).toContain('配置缺失时');
    expect(chinese).toContain('`docs/comet/`');
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
