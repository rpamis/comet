import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  commandInvocation,
  resolveWindowsNodeShim,
  spawnCommand,
} from '../../../platform/process/spawn-command.js';

describe('spawnCommand on Windows', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    root = undefined;
  });

  it('recognizes only complete literal Node wrappers and preserves the declared executable and argv', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-literal-node-shim-'));
    const shim = path.join(root, 'probe.cmd');
    const entry = path.join(root, 'probe.cjs');
    const node = 'C:\\Program Files\\nodejs\\node.exe';
    const source = `@"${node}" "%~dp0probe.cjs" %*\r\n`;
    await fs.writeFile(entry, 'process.exit(0)');
    await fs.writeFile(shim, source);
    const args = ['with space', '中文'];
    const env = { NODE_PATH: 'original-value' };
    expect(resolveWindowsNodeShim(shim, args, env)).toEqual({
      command: node,
      args: [entry, ...args],
    });
    expect(args).toEqual(['with space', '中文']);
    expect(env).toEqual({ NODE_PATH: 'original-value' });
    for (const altered of [
      source + 'echo extra\r\n',
      source.replace('node.exe', 'other.exe'),
      source.replace('probe.cjs', '%INJECTED%.cjs'),
    ]) {
      await fs.writeFile(shim, altered);
      expect(resolveWindowsNodeShim(shim, args, env)).toBeNull();
    }
    await fs.writeFile(shim, source);
    await fs.unlink(entry);
    expect(() => resolveWindowsNodeShim(shim, args, env)).toThrow('Node CLI entry is missing');
  });

  it.runIf(process.platform === 'win32')(
    'launches a literal Node command shim directly without a PowerShell startup',
    async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-node-shim-'));
      const shim = path.join(root, 'probe.cmd');
      const entry = path.join(root, 'probe.cjs');
      const source = `@"${process.execPath}" "%~dp0probe.cjs" %*\r\n`;
      await fs.writeFile(shim, source);
      await fs.writeFile(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
      const args = ['space separated', '中文'];
      const invocation = commandInvocation(shim, args, { cwd: root });
      expect(invocation.command).toBe(process.execPath);
      expect(invocation.args).toEqual([entry, ...args]);
      expect(invocation.env).not.toHaveProperty('COMET_COMMAND_PAYLOAD');
      const child = spawnCommand(shim, args, { cwd: root });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      expect((await once(child, 'close'))[0]).toBe(0);
      expect(JSON.parse(output)).toEqual(args);
      expect(() => commandInvocation(shim, ['& whoami'], { cwd: root! })).toThrow('shell syntax');
      await fs.writeFile(shim, source + 'echo additional-command\r\n');
      expect(commandInvocation(shim, args, { cwd: root }).command).not.toBe(process.execPath);
    },
  );

  it.runIf(process.platform === 'win32')(
    'resolves PATH and PATHEXT case-insensitively for command shims',
    async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-spawn-command-'));
      await fs.writeFile(path.join(root, 'probe.cmd'), '@echo off\r\necho ready\r\n', 'utf8');
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: undefined,
        PATHEXT: undefined,
        SYSTEMROOT: undefined,
        Path: root,
        Pathext: '.CMD',
        SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT,
      };

      const child = spawnCommand('probe', [], { cwd: root, env });
      const [exitCode] = (await once(child, 'close')) as [number | null];

      expect(exitCode).toBe(0);
    },
  );

  it.runIf(process.platform === 'win32')(
    'rejects shell syntax in batch command arguments',
    async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-spawn-command-'));
      const batch = path.join(root, 'probe.cmd');
      await fs.writeFile(batch, '@echo off\r\n', 'utf8');

      expect(() => spawnCommand(batch, ['& whoami'], { cwd: root })).toThrow(
        'Windows batch check arguments must not contain shell syntax',
      );
    },
  );
});
