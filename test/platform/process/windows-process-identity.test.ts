import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWindowsProcessIdentity } from '../../../platform/process/windows-process-identity.js';
import { runExternalCommandAsync } from '../../../platform/process/external-command.js';
import * as externalCommand from '../../../platform/process/external-command.js';

describe('optional Windows process creation probe', () => {
  let cacheRoot: string;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (cacheRoot)
      await fs.rm(cacheRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

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
