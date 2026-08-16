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

  it('writes configured input to child stdin', () => {
    expect(
      runExternalCommand(
        process.execPath,
        [
          '-e',
          "process.stdin.setEncoding('utf8'); let input = ''; process.stdin.on('data', (chunk) => { input += chunk; }); process.stdin.on('end', () => process.stdout.write(input));",
        ],
        { input: 'hello from stdin', timeoutMs: 5_000 },
      ),
    ).toBe('hello from stdin');
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
