import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { statusCommand } from '../../app/commands/status.js';
import { runNativeCli } from '../../domains/comet-native/native-cli.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-status-history-'));
  vi.stubEnv('HOME', root);
  vi.stubEnv('USERPROFILE', root);
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
  for (const args of [
    ['new', 'closed-change'],
    ['cancel', 'closed-change'],
    ['new', 'active-change'],
  ]) {
    const result = await runNativeCli([...args, '--project-root', root, '--json']);
    expect(result.exitCode, result.stderr).toBe(0);
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

it('defaults CLI JSON to active and preserves the full JSON shape with includeHistory', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await statusCommand(root, { json: true });
  const active = JSON.parse(log.mock.calls.at(-1)![0]);
  expect(active.workflows.native.changes.map((c: { name: string }) => c.name)).toEqual([
    'active-change',
  ]);
  await statusCommand(root, { json: true, includeHistory: true });
  const full = JSON.parse(log.mock.calls.at(-1)![0]);
  expect(full.workflows.native.changes.map((c: { name: string }) => c.name)).toEqual([
    'active-change',
    'closed-change',
  ]);
  expect(Object.keys(active)).toEqual(Object.keys(full));
  expect(full.schema).toBe('comet.status.v2');
  expect(full.changes).toEqual([]);
  await statusCommand(root, { json: true, includeHistory: 'true' as unknown as boolean });
  expect(JSON.parse(log.mock.calls.at(-1)![0]).workflows.native.changes).toHaveLength(1);
});

it('defaults human output to active and includes closed history only when requested', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await statusCommand(root);
  expect(log.mock.calls.flat().join('\n')).toContain('active-change');
  expect(log.mock.calls.flat().join('\n')).not.toContain('closed-change');
  log.mockClear();
  await statusCommand(root, { includeHistory: true });
  expect(log.mock.calls.flat().join('\n')).toContain('closed-change');
});

it.each([false, true])(
  'parses the actual Commander include-history option (%s)',
  async (includeHistory) => {
    const argv = process.argv;
    const exitCode = process.exitCode;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      process.argv = [
        process.execPath,
        'comet',
        'status',
        root,
        '--json',
        ...(includeHistory ? ['--include-history'] : []),
      ];
      vi.resetModules();
      await import('../../app/cli/index.js');
      expect(process.exitCode).toBe(exitCode);
      const result = JSON.parse(log.mock.calls.at(-1)![0]);
      expect(result.workflows.native.changes.map((c: { name: string }) => c.name)).toEqual(
        includeHistory ? ['active-change', 'closed-change'] : ['active-change'],
      );
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
    }
  },
);
