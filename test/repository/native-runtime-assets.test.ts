import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const runtime = path.resolve(
  'assets',
  'skills',
  'comet-native',
  'scripts',
  'comet-native-runtime.mjs',
);
const builder = path.resolve('scripts', 'build', 'build-native-runtime.mjs');

describe('Native runtime release asset', () => {
  it('ships one fresh self-contained Node runtime', async () => {
    const source = await fs.readFile(runtime, 'utf8');

    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    for (const command of [
      'init',
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
    execFileSync(process.execPath, [builder, '--check'], { stdio: 'pipe' });
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
