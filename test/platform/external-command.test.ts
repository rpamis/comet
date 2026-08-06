import { describe, expect, it } from 'vitest';

import {
  ExternalCommandError,
  runExternalCommand,
} from '../../platform/process/external-command.js';

describe('external command provider', () => {
  it('returns bounded command output without a shell', () => {
    expect(
      runExternalCommand(process.execPath, ['-e', 'process.stdout.write("ready")'], {
        timeoutMs: 5_000,
      }),
    ).toBe('ready');
  });

  it('preserves stderr in a typed failure', () => {
    expect(() =>
      runExternalCommand(
        process.execPath,
        ['-e', 'process.stderr.write("failed safely"); process.exit(2)'],
        { timeoutMs: 5_000 },
      ),
    ).toThrowError(ExternalCommandError);
    expect(() =>
      runExternalCommand(
        process.execPath,
        ['-e', 'process.stderr.write("failed safely"); process.exit(2)'],
        { timeoutMs: 5_000 },
      ),
    ).toThrow('failed safely');
  });
});
