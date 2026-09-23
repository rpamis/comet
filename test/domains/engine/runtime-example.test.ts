import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const example = path.join(repositoryRoot, 'scripts/lib/runtime-sdk-example.mjs');
let rootDir = '';

afterEach(async () => {
  if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
});

describe('published Runtime SDK example', () => {
  it('persists an approval wait and resumes it in a separate process', async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-sdk-example-'));
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [example, '--root-dir', rootDir, ...args], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      });

    const waiting = run();
    expect(waiting.status, waiting.stderr).toBe(0);
    expect(waiting.stdout).toContain('waiting');
    await expect(fs.readFile(path.join(rootDir, 'published/report.md'), 'utf8')).rejects.toThrow();

    const completed = run('--approve');
    expect(completed.status, completed.stderr).toBe(0);
    expect(completed.stdout).toContain('completed');
    await expect(fs.readFile(path.join(rootDir, 'published/report.md'), 'utf8')).resolves.toContain(
      'skill harness design',
    );
  });
});
