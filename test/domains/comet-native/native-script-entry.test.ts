import { afterEach, describe, expect, it, vi } from 'vitest';

import { runNativeScript } from '../../../domains/comet-native/native-script-entry.js';
import { NativeUsageError } from '../../../domains/comet-native/native-cli-shared.js';

describe('Native direct script entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
