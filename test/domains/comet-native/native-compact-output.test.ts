import { describe, expect, it } from 'vitest';
import { runNativeCliDetailed } from '../../../domains/comet-native/native-cli.js';

describe('Native compact JSON CLI', () => {
  it('keeps structured errors parseable and preserves detailed evidence', async () => {
    const full = await runNativeCliDetailed(['not-a-command', '--json']);
    const compact = await runNativeCliDetailed(['not-a-command', '--json', '--compact']);
    expect(full.output.exitCode).toBe(64);
    expect(compact.output.exitCode).toBe(64);
    expect(JSON.parse(full.output.stdout!)).not.toHaveProperty('outputView');
    expect(JSON.parse(compact.output.stdout!)).toMatchObject({
      exitCode: 64,
      error: { code: 'usage' },
    });
    expect(compact.output.stdout).toBe(full.output.stdout);
    expect(compact.dispatch).toEqual(full.dispatch);
    expect(compact.experience).toEqual(full.experience);
  });
  it('rejects compact without JSON before dispatch', async () => {
    const result = await runNativeCliDetailed(['next', '--compact']);
    expect(result.output.exitCode).toBe(64);
    expect(result.output.stderr).toContain('--compact requires --json');
  });
});
