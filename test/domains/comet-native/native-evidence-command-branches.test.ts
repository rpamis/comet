import { afterEach, describe, expect, it, vi } from 'vitest';

const requiredPositional = vi.hoisted(() => (args: string[]) => args.shift() ?? 'format');
const takeOption = vi.hoisted(() => (args: string[], option: string) => {
  const index = args.indexOf(option);
  if (index < 0) return undefined;
  args.splice(index, 1);
  return args.splice(index, 1)[0];
});
const readBoundedEvidenceStdin = vi.hoisted(() => vi.fn());

vi.mock('../../../domains/comet-native/native-cli-shared.js', () => ({
  assertNoArguments: (args: string[]) => {
    if (args.length > 0) throw new Error(`Unexpected argument: ${args[0]}`);
  },
  NativeUsageError: class NativeUsageError extends Error {},
  readBoundedEvidenceFile: vi.fn(),
  readBoundedEvidenceStdin,
  requiredPositional,
  success: (command: string, data: unknown, stdout = '') => ({
    command,
    data,
    exitCode: 0,
    stdout,
  }),
  takeOption,
}));

import { nativeEvidenceCommand } from '../../../domains/comet-native/native-evidence-command.js';

describe('Native evidence command stdin branches', () => {
  afterEach(() => {
    delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    vi.restoreAllMocks();
  });

  it('rejects stdin formatting when stdin is interactive', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });

    await expect(nativeEvidenceCommand(['format'], 'project')).rejects.toThrow(
      'requires acceptance evidence entries JSON on stdin',
    );
  });

  it('formats a valid non-interactive stdin array and rejects JSON objects', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    readBoundedEvidenceStdin.mockResolvedValueOnce('[]').mockResolvedValueOnce('{}');

    await expect(nativeEvidenceCommand(['format'], 'project')).resolves.toMatchObject({
      command: 'evidence format',
      exitCode: 0,
    });
    await expect(nativeEvidenceCommand(['format'], 'project')).rejects.toThrow('JSON array');
  });
});
