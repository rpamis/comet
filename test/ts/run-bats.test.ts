import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

describe('run-bats shell runner', () => {
  it('resolves a usable bash instead of directly invoking PATH bash', async () => {
    const content = await fs.readFile(path.resolve('scripts', 'run-bats.js'), 'utf-8');

    expect(content).toContain('function findUsableBash');
    expect(content).toContain('process.env.COMET_TEST_BASH');
    expect(content).toContain('process.env.COMET_BASH');
    expect(content).not.toContain("spawnSync('bash'");
  });

  it('rejects WSL bash when resolving bash on Windows', async () => {
    const runner = await fs.readFile(path.resolve('scripts', 'run-bats.js'), 'utf-8');
    const shellTests = await fs.readFile(path.resolve('test', 'ts', 'comet-scripts.test.ts'), 'utf-8');

    expect(runner).toContain("process.platform === 'win32' && /linux/i.test(probe.stdout)");
    expect(shellTests).toContain("process.platform === 'win32' && /linux/i.test(probe.stdout)");
  });

  it('checks explicit Comet bash paths before shelling out to discover fallbacks', async () => {
    const content = await fs.readFile(
      path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-env.sh'),
      'utf-8',
    );

    const cometBashCheck = content.indexOf('if _comet_bash_is_usable "${COMET_BASH:-}"');
    const currentBashCheck = content.indexOf('if _comet_bash_is_usable "${BASH:-}"');
    const shellFallback = content.indexOf('command -v sh');

    expect(cometBashCheck).toBeGreaterThan(-1);
    expect(currentBashCheck).toBeGreaterThan(cometBashCheck);
    expect(shellFallback).toBeGreaterThan(currentBashCheck);
    expect(content).not.toContain('for _comet_bash_candidate in \\');
  });
});
