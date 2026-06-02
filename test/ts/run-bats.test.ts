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
});
