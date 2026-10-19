import { describe, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';

describe('Classic compact JSON CLI', () => {
  it('keeps default JSON and applies an explicit compact view without changing handler input', async () => {
    const input = { task: 'work '.repeat(100) };
    const handler = async (args: string[]) => ({
      exitCode: 0,
      data: { input, current: input, args },
    });
    const full = await runClassicCli(['state', 'show', '--json'], { state: handler });
    const compact = await runClassicCli(['state', 'show', '--json', '--compact'], {
      state: handler,
    });
    expect(JSON.parse(full.stdout!)).not.toHaveProperty('outputView');
    expect(JSON.parse(compact.stdout!)).toMatchObject({
      exitCode: 0,
      data: { input, args: ['show'] },
      outputView: { references: { '/data/current': '/data/input' } },
    });
    expect(compact.stderr).toBeUndefined();
  });
  it('requires JSON and preserves flags after the subprocess boundary', async () => {
    expect((await runClassicCli(['state', '--compact'])).exitCode).toBe(64);
    const result = await runClassicCli(['check', '--json', '--', 'node', '--compact'], {
      check: async (args) => ({ exitCode: 0, data: { args } }),
    });
    expect(JSON.parse(result.stdout!).data.args).toEqual(['--', 'node', '--compact']);
    expect(JSON.parse(result.stdout!)).not.toHaveProperty('outputView');
  });
});
