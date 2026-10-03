import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readWindowsProcessIdentity } from '../../../platform/process/windows-process-identity.js';
import { runExternalCommandAsync } from '../../../platform/process/external-command.js';

describe('optional Windows process creation probe', () => {
  let cacheRoot: string;
  afterEach(async () => {
    if (cacheRoot) await fs.rm(cacheRoot, { recursive: true, force: true });
  });

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
