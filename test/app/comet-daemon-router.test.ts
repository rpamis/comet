import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { shouldAutoStartCometDaemon } from '../../bin/comet-daemon-router.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import { isolatedBenchmarkEnvironment } from '../../scripts/benchmark/runtime-coldstart-benchmark.mjs';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin/comet.js');
const temporary: string[] = [];

function runCli(projectRoot: string, env: NodeJS.ProcessEnv, args: readonly string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
}

async function waitForRunningDaemon(projectRoot: string, env: NodeJS.ProcessEnv) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const daemon = runCli(projectRoot, env, [
      'daemon',
      'status',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(daemon.status, daemon.stderr).toBe(0);
    const status = JSON.parse(daemon.stdout) as { running: boolean; pid?: number };
    if (status.running) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Windows daemon did not start through the process broker');
}

function windowsParentProcessName(pid: number, env: NodeJS.ProcessEnv): string | null {
  const powershell = path.join(
    env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = [
    `$process = Get-CimInstance -Namespace root/cimv2 Win32_Process -Filter 'ProcessId=${pid}'`,
    'if ($null -eq $process) { exit 3 }',
    "$parent = Get-CimInstance -Namespace root/cimv2 Win32_Process -Filter ('ProcessId=' + $process.ParentProcessId)",
    "if ($null -eq $parent) { 'null' } else { $parent.Name | ConvertTo-Json -Compress }",
  ].join('; ');
  const result = spawnSync(
    powershell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim()) as string | null;
}

describe('CLI daemon router', () => {
  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 120_000);

  afterEach(async () => {
    await Promise.all(
      temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  it('keeps automatic daemon routing enabled on Windows unless explicitly disabled', () => {
    expect(shouldAutoStartCometDaemon({})).toBe(true);
    expect(shouldAutoStartCometDaemon({ COMET_DAEMON: 'on' })).toBe(true);
    expect(shouldAutoStartCometDaemon({ COMET_DAEMON: 'off' })).toBe(false);
  });

  it.runIf(process.platform === 'win32')(
    'starts the Windows daemon outside the invoking process tree',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-daemon-router-'));
      temporary.push(root);
      const home = path.join(root, 'home');
      const project = path.join(root, 'project');
      await fs.mkdir(home);
      await fs.mkdir(project);
      await writeProjectConfig(project, defaultProjectConfig('docs', 'en'));
      const env = {
        ...isolatedBenchmarkEnvironment(home),
        COMET_DAEMON: 'auto',
        COMET_DAEMON_IDLE_TIMEOUT_MS: '15000',
      };

      const status = runCli(project, env, [
        'native',
        'status',
        '--project-root',
        project,
        '--json',
      ]);
      expect(status.status, status.stderr).toBe(0);
      const daemonStatus = await waitForRunningDaemon(project, env);
      expect(daemonStatus.running).toBe(true);

      const parentProcessName = windowsParentProcessName(daemonStatus.pid!, env);

      const stopped = runCli(project, env, ['daemon', 'stop', '--project-root', project, '--json']);
      expect(stopped.status, stopped.stderr).toBe(0);
      expect(parentProcessName?.toLowerCase()).toBe('wmiprvse.exe');
    },
    45_000,
  );
});
