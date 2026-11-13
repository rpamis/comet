import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { doctorCommand } from '../../app/commands/doctor.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';

afterEach(() => vi.restoreAllMocks());

it.each(['source', 'cli'] as const)(
  'repairs a legacy lock only with current record identity and explicit stop confirmation (%s)',
  async (entry) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-lock-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const file = path.join(root, 'state.lock');
    const original = JSON.stringify({ pid: 2147483647, nonce: 'old-owner', createdAt: 1 });
    const options = { lockFile: file, json: true, homeDir: root };
    const command = async (
      settings: typeof options & {
        repair?: boolean;
        confirmed?: boolean;
        lockToken?: string;
      },
    ) => {
      if (entry === 'source') return doctorCommand(root, settings);
      const result = spawnSync(
        process.execPath,
        [
          path.resolve('bin/comet.js'),
          'doctor',
          root,
          '--lock-file',
          file,
          '--json',
          ...(settings.repair ? ['--repair'] : []),
          ...(settings.confirmed ? ['--confirmed'] : []),
          ...(settings.lockToken ? ['--lock-token', settings.lockToken] : []),
        ],
        { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: root, USERPROFILE: root } },
      );
      if (!result.stdout.trim()) throw new Error(result.stderr || String(result.error));
      console.log(result.stdout);
      return result.status;
    };
    try {
      await fs.writeFile(file, original);
      expect(await command(options)).toBe(1);
      const diagnostic = JSON.parse(String(log.mock.calls.at(-1)![0]));
      expect(diagnostic.lock.status).toBe('unknown');
      expect(diagnostic.recovery.commandArgs).toContain('--confirmed');
      expect(await fs.readFile(file, 'utf8')).toBe(original);
      expect(await command({ ...options, repair: true, lockToken: 'old-owner' })).toBe(1);
      expect(
        await command({
          ...options,
          repair: true,
          confirmed: true,
          lockToken: 'changed-owner',
        }),
      ).toBe(1);
      expect(await fs.readFile(file, 'utf8')).toBe(original);
      expect(
        await command({
          ...options,
          repair: true,
          confirmed: true,
          lockToken: 'old-owner',
        }),
      ).toBe(0);
      await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(
        await command({
          ...options,
          repair: true,
          confirmed: true,
          lockToken: 'old-owner',
        }),
      ).toBe(0);
      await expect(withRecoverableFileLock(file, async () => 'continued')).resolves.toBe(
        'continued',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

it('keeps a live transaction locked even when its record token and confirmation are supplied', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-live-lock-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const file = path.join(root, 'state.lock');
  try {
    await withRecoverableFileLock(file, async () => {
      const owner = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(
        await doctorCommand(root, {
          lockFile: file,
          lockToken: owner.nonce,
          confirmed: true,
          repair: true,
          json: true,
          homeDir: root,
        }),
      ).toBe(1);
      expect(JSON.parse(await fs.readFile(file, 'utf8')).nonce).toBe(owner.nonce);
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
