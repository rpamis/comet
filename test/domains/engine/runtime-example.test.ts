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

  it('reconciles an interrupted external operation only after explicit stopped confirmation', async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-sdk-recovery-'));
    const recovery = path.join(repositoryRoot, 'scripts/lib/runtime-sdk-recovery-example.mjs');
    const execute = (...args: string[]) =>
      spawnSync(process.execPath, [recovery, '--root-dir', rootDir, ...args], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      });
    const first = execute();
    expect(first.status, first.stderr).toBe(0);
    const uncertain = JSON.parse(first.stdout);
    expect(uncertain.reason).toBe('execution-unknown');
    const receiptFile = path.join(rootDir, 'external-receipt.json');
    const originalReceipt = await fs.readFile(receiptFile, 'utf8');
    const refused = execute('--reconcile');
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('--confirmed-stopped');
    const completed = execute('--reconcile', '--confirmed-stopped');
    expect(completed.status, completed.stderr).toBe(0);
    const accepted = JSON.parse(completed.stdout);
    expect(accepted.reason).toBe('completed');
    expect(accepted.actionId).toBe(uncertain.actionId);
    expect(accepted.attempt).toBe(1);
    expect(await fs.readFile(receiptFile, 'utf8')).toBe(originalReceipt);
    const repeated = execute();
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(JSON.parse(repeated.stdout).reason).toBe('completed');
    expect(await fs.readFile(receiptFile, 'utf8')).toBe(originalReceipt);
  });
});
