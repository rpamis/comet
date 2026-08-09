import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  executeNativeCheck,
  nativePortableArgvDisplay,
  resolveNativeCheckCwd,
} from '../../../domains/comet-native/native-check-executor.js';

describe('Native check executor', () => {
  let root: string;
  let runtimeDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-check-'));
    runtimeDir = path.join(root, '.comet', 'runtime', 'native', 'changes', 'example');
    await fs.mkdir(runtimeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('streams output longer than 64 KiB to a log without summary validation', async () => {
    const result = await executeNativeCheck({
      projectRoot: root,
      runtimeDir,
      operationId: 'verify-1',
      plan: {
        id: 'long-output',
        name: 'Long output',
        executable: process.execPath,
        argv: ['-e', "process.stdout.write('x'.repeat(256 * 1024))"],
        cwdRef: '.',
        timeoutMs: 10_000,
        repeatable: true,
      },
    });

    expect(result.status).toBe('passed');
    expect((await fs.stat(path.join(runtimeDir, ...result.logRef.split('/')))).size).toBe(
      256 * 1024,
    );
    expect(result).not.toHaveProperty('outputSummary');
  });

  it('derives failed and interrupted states from exit and timeout', async () => {
    const failed = await executeNativeCheck({
      projectRoot: root,
      runtimeDir,
      operationId: 'verify-2',
      plan: {
        id: 'failure',
        name: 'Failure',
        executable: process.execPath,
        argv: ['-e', 'process.exit(7)'],
        cwdRef: '.',
        timeoutMs: 10_000,
        repeatable: true,
      },
    });
    const timedOut = await executeNativeCheck({
      projectRoot: root,
      runtimeDir,
      operationId: 'verify-3',
      plan: {
        id: 'timeout',
        name: 'Timeout',
        executable: process.execPath,
        argv: ['-e', 'setInterval(() => {}, 1000)'],
        cwdRef: '.',
        timeoutMs: 50,
        repeatable: true,
      },
    });

    expect(failed).toMatchObject({ status: 'failed', exitCode: 7, timedOut: false });
    expect(timedOut).toMatchObject({ status: 'interrupted', timedOut: true });
  });

  it.runIf(process.platform === 'win32')(
    'resolves Windows command shims without a shell',
    async () => {
      const result = await executeNativeCheck({
        projectRoot: root,
        runtimeDir,
        operationId: 'verify-shim',
        plan: {
          id: 'pnpm-version',
          name: 'pnpm version',
          executable: 'pnpm',
          argv: ['--version'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      });

      expect(result).toMatchObject({ status: 'passed', exitCode: 0, timedOut: false });
    },
  );

  it('terminates the complete child process tree after timeout', async () => {
    const marker = path.join(root, 'late-grandchild.txt');
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 600)`;
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore', windowsHide: true }); setInterval(() => {}, 1000)`;
    const result = await executeNativeCheck({
      projectRoot: root,
      runtimeDir,
      operationId: 'verify-tree-timeout',
      plan: {
        id: 'tree-timeout',
        name: 'Tree timeout',
        executable: process.execPath,
        argv: ['-e', parent],
        cwdRef: '.',
        timeoutMs: 100,
        repeatable: true,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(result).toMatchObject({ status: 'interrupted', timedOut: true });
    await expect(fs.stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps cwd inside the project and redacts portable argv displays', () => {
    expect(resolveNativeCheckCwd(root, '.')).toBe(root);
    expect(() => resolveNativeCheckCwd(root, '../outside')).toThrow('project-relative');
    expect(nativePortableArgvDisplay(['--token=secret-value'])).not.toContain('secret-value');
    expect(
      nativePortableArgvDisplay([
        '--token',
        'token-value',
        '--client-secret',
        'client-value',
        '-p',
        'password-value',
        '--safe',
        'visible-value',
      ]),
    ).toEqual([
      '--token',
      '[REDACTED]',
      '--client-secret',
      '[REDACTED]',
      '-p',
      '[REDACTED]',
      '--safe',
      'visible-value',
    ]);
  });
});
