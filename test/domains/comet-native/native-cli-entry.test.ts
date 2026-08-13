import { describe, expect, it, vi } from 'vitest';

const runNativeCli = vi.hoisted(() => vi.fn());

vi.mock('../../../domains/comet-native/native-cli.js', () => ({ runNativeCli }));

describe('Native CLI entry', () => {
  it('writes both output channels and returns the CLI exit code', async () => {
    runNativeCli.mockResolvedValueOnce({
      stdout: 'out',
      stderr: 'err',
      exitCode: 7,
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const { main } = await import('../../../domains/comet-native/native-cli-entry.js');
    await expect(main(['status'])).resolves.toBe(7);
    expect(runNativeCli).toHaveBeenCalledWith(['status']);
    expect(stdout).toHaveBeenCalledWith('out');
    expect(stderr).toHaveBeenCalledWith('err\n');
  });

  it('does not add a second newline to an existing stderr line', async () => {
    runNativeCli.mockResolvedValueOnce({ stdout: '', stderr: 'already\n', exitCode: 0 });
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const { main } = await import('../../../domains/comet-native/native-cli-entry.js');
    await expect(main()).resolves.toBe(0);
    expect(stderr).toHaveBeenCalledWith('already\n');
  });
});
