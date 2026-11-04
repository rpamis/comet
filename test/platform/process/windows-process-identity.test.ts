import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readWindowsProcessIdentity,
  inspectWindowsProcessPresence,
} from '../../../platform/process/windows-process-identity.js';
import { runExternalCommandAsync } from '../../../platform/process/external-command.js';
import * as externalCommand from '../../../platform/process/external-command.js';

describe('optional Windows process creation probe', () => {
  let cacheRoot: string;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (cacheRoot)
      await fs.rm(cacheRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it.each(['compiler failure', 'manifest failure'])(
    'removes unpublished probe executables after %s',
    async (failure) => {
      cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-identity-cleanup-'));
      const systemRoot = path.join(cacheRoot, 'system');
      const compiler = path.join(
        systemRoot,
        'Microsoft.NET',
        'Framework64',
        'v4.0.30319',
        'csc.exe',
      );
      await fs.mkdir(path.dirname(compiler), { recursive: true });
      await fs.writeFile(compiler, 'compiler fixture');
      vi.spyOn(externalCommand, 'runExternalCommandAsync').mockImplementation(
        async (command, args) => {
          if (command !== compiler) throw new Error('legacy unavailable');
          await fs.writeFile(args.find((arg) => arg.startsWith('/out:'))!.slice(5), 'probe output');
          if (failure === 'compiler failure')
            throw new Error('compiler timed out after writing output');
          return '';
        },
      );
      if (failure === 'manifest failure')
        vi.spyOn(fs, 'rename').mockRejectedValue(new Error('publish failed'));
      const probeRoot = path.join(cacheRoot, 'cache');
      await expect(
        readWindowsProcessIdentity(process.pid, { cacheRoot: probeRoot, systemRoot }),
      ).resolves.toBeNull();
      const [hash] = await fs.readdir(probeRoot);
      expect(await fs.readdir(path.join(probeRoot, hash))).toEqual([]);
    },
  );

  it('allows slow successful compilation and reuses the verified probe', async () => {
    cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-identity-slow-'));
    const systemRoot = path.join(cacheRoot, 'system');
    const compiler = path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    await fs.mkdir(path.dirname(compiler), { recursive: true });
    await fs.writeFile(compiler, 'compiler fixture');
    let compiles = 0;
    vi.spyOn(externalCommand, 'runExternalCommandAsync').mockImplementation(
      async (command, args, options) => {
        if (command === compiler) {
          compiles++;
          if (options!.timeoutMs! < 2000) throw new Error('slow compiler exceeded budget');
          await new Promise((resolve) => setTimeout(resolve, 1600));
          await fs.writeFile(
            args.find((arg) => arg.startsWith('/out:'))!.slice(5),
            'verified probe',
          );
          return '';
        }
        if (path.basename(command).startsWith('probe-')) return '123456789';
        throw new Error('legacy unavailable');
      },
    );
    const options = { cacheRoot: path.join(cacheRoot, 'cache'), systemRoot };
    await expect(readWindowsProcessIdentity(process.pid, options)).resolves.toBe(
      'win32-ps:123456789',
    );
    await expect(readWindowsProcessIdentity(process.pid, options)).resolves.toBe(
      'win32-ps:123456789',
    );
    expect(compiles).toBe(1);
    const [hash] = await fs.readdir(options.cacheRoot);
    const files = await fs.readdir(path.join(options.cacheRoot, hash));
    expect(files).toContain('probe.json');
    expect(files.filter((file) => file.endsWith('.exe'))).toHaveLength(1);
    expect(files.some((file) => file.endsWith('.cs') || file === 'prepare.lock')).toBe(false);
  });

  it('does not delete files when another process holds the preparation lock', async () => {
    cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-identity-contended-'));
    vi.spyOn(fs, 'open').mockRejectedValue(Object.assign(new Error('busy'), { code: 'EEXIST' }));
    const unlink = vi.spyOn(fs, 'unlink');
    vi.spyOn(externalCommand, 'runExternalCommandAsync').mockRejectedValue(
      new Error('legacy unavailable'),
    );
    await expect(readWindowsProcessIdentity(process.pid, { cacheRoot })).resolves.toBeNull();
    expect(unlink).not.toHaveBeenCalled();
  });

  it.each([
    ['0', 'absent'],
    ['1', 'present'],
    ['', 'unknown'],
    ['permission denied', 'unknown'],
  ])('uses only structured successful process enumeration %s as %s', async (output, expected) => {
    vi.spyOn(externalCommand, 'runExternalCommandAsync').mockResolvedValue(output);
    await expect(inspectWindowsProcessPresence(123456)).resolves.toBe(expected);
  });
  it('does not infer absence from an enumeration failure', async () => {
    vi.spyOn(externalCommand, 'runExternalCommandAsync').mockRejectedValue(
      new Error('probe timed out'),
    );
    await expect(inspectWindowsProcessPresence(123456)).resolves.toBe('unknown');
  });
  it.runIf(process.platform === 'win32')(
    'enumerates the current Windows process and an absent PID',
    async () => {
      await expect(inspectWindowsProcessPresence(process.pid)).resolves.toBe('present');
      await expect(inspectWindowsProcessPresence(2147483647)).resolves.toBe('absent');
    },
  );

  it.each(['compiler timeout', 'busy preparation lock'])(
    'retries after a cooldown when a transient %s clears',
    async (failure) => {
      cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-identity-retry-'));
      const systemRoot = path.join(cacheRoot, 'system');
      const compiler = path.join(
        systemRoot,
        'Microsoft.NET',
        'Framework64',
        'v4.0.30319',
        'csc.exe',
      );
      await fs.mkdir(path.dirname(compiler), { recursive: true });
      await fs.writeFile(compiler, 'test compiler');
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      let failed = false;
      const execute = vi
        .spyOn(externalCommand, 'runExternalCommandAsync')
        .mockImplementation(async (command, args) => {
          if (command === compiler) {
            if (failure === 'compiler timeout' && !failed) {
              failed = true;
              throw new Error('compiler timeout');
            }
            const output = args.find((argument) => argument.startsWith('/out:'))!.slice(5);
            await fs.writeFile(output, 'test probe');
            return '';
          }
          if (path.basename(command).startsWith('probe-')) return '123456789';
          throw new Error('legacy probe unavailable');
        });
      if (failure === 'busy preparation lock') {
        vi.spyOn(fs, 'open').mockRejectedValueOnce(
          Object.assign(new Error('preparation busy'), { code: 'EEXIST' }),
        );
      }
      const options = { cacheRoot: path.join(cacheRoot, 'probe-cache'), systemRoot };
      await expect(readWindowsProcessIdentity(process.pid, options)).resolves.toBeNull();
      const initialCompiles = execute.mock.calls.filter(([command]) => command === compiler).length;
      now = 9999;
      await expect(readWindowsProcessIdentity(process.pid, options)).resolves.toBeNull();
      expect(execute.mock.calls.filter(([command]) => command === compiler)).toHaveLength(
        initialCompiles,
      );
      now = 10_000;
      await expect(readWindowsProcessIdentity(process.pid, options)).resolves.toBeNull();
      expect(execute.mock.calls.filter(([command]) => command === compiler)).toHaveLength(
        initialCompiles,
      );
      now = 59_999;
      await expect(readWindowsProcessIdentity(process.pid, options)).resolves.toBeNull();
      expect(execute.mock.calls.filter(([command]) => command === compiler)).toHaveLength(
        initialCompiles,
      );
      now = 60_000;
      await expect(readWindowsProcessIdentity(process.pid, options)).resolves.toBe(
        'win32-ps:123456789',
      );
      expect(execute.mock.calls.filter(([command]) => command === compiler)).toHaveLength(
        initialCompiles + 1,
      );
    },
  );

  it('returns unknown when both the helper and legacy probes are unavailable', async () => {
    cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-identity-cache-'));
    await expect(
      readWindowsProcessIdentity(process.pid, {
        cacheRoot,
        systemRoot: path.join(cacheRoot, 'missing-system'),
      }),
    ).resolves.toBeNull();
  });

  it.runIf(process.platform === 'win32')(
    'prepares a reusable native probe with the exact legacy PowerShell identity',
    async () => {
      cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-identity-cache-'));
      const expected = (
        await runExternalCommandAsync(
          path.join(
            process.env.SystemRoot!,
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe',
          ),
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().Ticks.ToString()`,
          ],
          { timeoutMs: 5000 },
        )
      ).trim();
      await expect(readWindowsProcessIdentity(process.pid, { cacheRoot })).resolves.toBe(
        `win32-ps:${expected}`,
      );
      // 准备与探测并行；等待原子发布完成，再禁用系统组件验证快路径。
      let manifest: string | undefined;
      for (let index = 0; index < 100 && !manifest; index++) {
        const directories = await fs.readdir(cacheRoot);
        for (const directory of directories) {
          const candidate = path.join(cacheRoot, directory, 'probe.json');
          try {
            await fs.access(candidate);
            manifest = candidate;
          } catch {
            /* 尚未发布。 */
          }
        }
        if (!manifest) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(manifest).toBeTruthy();
      await expect(
        readWindowsProcessIdentity(process.pid, {
          cacheRoot,
          systemRoot: path.join(cacheRoot, 'missing-system'),
        }),
      ).resolves.toBe(`win32-ps:${expected}`);
      await fs.writeFile(manifest!, '{"file":"../untrusted.exe","hash":"invalid"}');
      await expect(readWindowsProcessIdentity(process.pid, { cacheRoot })).resolves.toBe(
        `win32-ps:${expected}`,
      );
    },
  );
});
