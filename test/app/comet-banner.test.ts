import { describe, expect, it } from 'vitest';
import {
  COMET_BANNER_LINE_COUNT,
  COMET_LOGO,
  COMET_TAGLINE,
  canAnimateCometBanner,
  printCometBanner,
  renderCometBanner,
  renderCometBannerFrame,
} from '../../app/cli/comet-banner.js';

describe('Comet CLI banner rendering', () => {
  it('renders the exact tagline centered beneath the logo without ANSI by default', () => {
    const banner = renderCometBanner();
    const lines = banner.split('\n');

    expect(COMET_TAGLINE).toBe('Agent Skill Harness For Turning Ideas Into Evaluated Workflows');
    expect(lines).toHaveLength(COMET_BANNER_LINE_COUNT);
    expect(lines.slice(0, COMET_LOGO.length)).toEqual(COMET_LOGO);
    expect(lines.at(-1)?.trim()).toBe(COMET_TAGLINE);
    expect(lines.at(-1)?.length).toBe(
      Math.max(...COMET_LOGO.map((line) => line.length), COMET_TAGLINE.length),
    );
    expect(banner).not.toContain('\u001b[');
  });

  it('uses deep blue, bright cyan-blue, and brand blue across a sweep frame', () => {
    const frame = renderCometBannerFrame(24, 1);

    expect(frame).toContain('\u001b[38;2;22;78;154m');
    expect(frame).toContain('\u001b[38;2;88;184;255m');
    expect(frame).toContain('\u001b[38;2;11;111;251m');
    expect(frame).toContain('·');
    expect(frame).toContain('\u001b[0m');
  });

  it.each([
    [{ isTTY: false, env: {} }, false],
    [{ isTTY: true, env: { CI: '1' } }, false],
    [{ isTTY: true, env: { NO_COLOR: '' } }, false],
    [{ isTTY: true, env: { TERM: 'dumb' } }, false],
    [{ isTTY: true, env: {} }, true],
  ] as const)('decides whether animation is safe for %o', (runtime, expected) => {
    expect(canAnimateCometBanner(runtime)).toBe(expected);
  });

  it('plays one sweep, restores the cursor, and leaves a stable final frame', async () => {
    const chunks: string[] = [];
    const sleeps: number[] = [];

    await printCometBanner({
      runtime: {
        isTTY: true,
        env: {},
        write: (chunk) => chunks.push(chunk),
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      },
    });

    const output = chunks.join('');
    expect(output).toContain('\u001b[?25l');
    expect(output).toContain('\u001b[?25h');
    expect(output).toContain('·');
    expect(output).toContain('•');
    expect(output).toContain(COMET_TAGLINE);
    expect(sleeps).toEqual([...Array<number>(13).fill(45), 55, 55]);

    const lastParticleFrame = chunks.findLastIndex((chunk) => chunk.includes('    ·'));
    const stableFrame = chunks.findIndex((chunk) => chunk.includes(COMET_LOGO[0]));
    expect(lastParticleFrame).toBeGreaterThan(-1);
    expect(stableFrame).toBeGreaterThan(lastParticleFrame);
    expect(output.endsWith('\u001b[0m\u001b[?25h\n')).toBe(true);
  });

  it('prints plain static output when animation is unavailable or fails', async () => {
    const plainChunks: string[] = [];
    await printCometBanner({
      runtime: { isTTY: false, env: {}, write: (chunk) => plainChunks.push(chunk) },
    });
    expect(plainChunks.join('')).toContain(COMET_TAGLINE);
    expect(plainChunks.join('')).not.toContain('\u001b[');

    const fallbackChunks: string[] = [];
    await expect(
      printCometBanner({
        runtime: {
          isTTY: true,
          env: {},
          write: (chunk) => fallbackChunks.push(chunk),
          sleep: async () => {
            throw new Error('timer failed');
          },
        },
      }),
    ).resolves.toBeUndefined();
    const fallback = fallbackChunks.at(-1) ?? '';
    const cleanupStart = fallback.indexOf(`\u001b[${COMET_BANNER_LINE_COUNT}A`);
    const staticBannerStart = fallback.indexOf(`\n${renderCometBanner()}\n\n`);
    expect(fallback).toContain('\u001b[?25h');
    expect(cleanupStart).toBeGreaterThan(-1);
    expect(fallback.split('\u001b[2K')).toHaveLength(COMET_BANNER_LINE_COUNT + 1);
    expect(cleanupStart).toBeLessThan(staticBannerStart);
  });

  it('does not reject when animation and fallback writes both fail', async () => {
    let writeAttempts = 0;

    await expect(
      printCometBanner({
        runtime: {
          isTTY: true,
          env: {},
          write: () => {
            writeAttempts += 1;
            if (writeAttempts >= 3) throw new Error('output failed');
          },
          sleep: async () => {
            throw new Error('timer failed');
          },
        },
      }),
    ).resolves.toBeUndefined();
    expect(writeAttempts).toBe(3);
  });

  it('writes nothing when disabled for JSON mode', async () => {
    const chunks: string[] = [];
    await printCometBanner({
      enabled: false,
      runtime: { write: (chunk) => chunks.push(chunk) },
    });
    expect(chunks).toEqual([]);
  });
});
