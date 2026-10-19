import { afterEach, describe, expect, it, vi } from 'vitest';

import { runNativeScript } from '../../../domains/comet-native/native-script-entry.js';
import { NativeUsageError } from '../../../domains/comet-native/native-cli-shared.js';

describe('Native direct script entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    'init',
    'root',
    'new',
    'spec',
    'show',
    'status',
    'select',
    'cancel',
    'next',
    'archive',
    'doctor',
    'transfer',
    'hook-guard',
  ])('accepts compact JSON in the shared %s launcher', async (command) => {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    const input = { task: 'context '.repeat(100) };
    const handler = vi.fn(async () => ({ command, exitCode: 0, data: { input, current: input } }));
    expect(
      await runNativeScript(command, handler, ['--json', '--compact', '--', '--compact']),
    ).toBe(0);
    expect(handler.mock.calls[0]?.[0]).toEqual(['--', '--compact']);
    expect(JSON.parse(output)).toMatchObject({
      command,
      exitCode: 0,
      outputView: {
        schema: 'comet.cli.compact.v1',
        references: { '/data/current': '/data/input' },
      },
    });
  });

  it('rejects compact without JSON before invoking the handler', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const handler = vi.fn();
    expect(await runNativeScript('status', handler, ['--compact'])).toBe(64);
    expect(handler).not.toHaveBeenCalled();
  });

  it('preserves the shared runtime command field for JSON errors', async () => {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });

    const exitCode = await runNativeScript(
      'status',
      async () => {
        throw new NativeUsageError('invalid status arguments');
      },
      ['--json'],
    );

    expect(exitCode).toBe(64);
    expect(JSON.parse(output)).toEqual({
      command: 'status',
      exitCode: 64,
      agent: {
        phase: null,
        status: null,
        stateVersion: null,
        workspace: { cwd: null },
        continuation: null,
      },
      error: { code: 'usage', message: 'invalid status arguments' },
    });
  });
});
