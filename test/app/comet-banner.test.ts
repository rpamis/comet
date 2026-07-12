import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  COMET_BANNER_LINE_COUNT,
  COMET_LOGO,
  COMET_TAGLINE,
  canAnimateCometBanner,
  createBannerStreamWriter,
  printCometBanner,
  renderCometBanner,
  renderCometBannerFrame,
} from '../../app/cli/comet-banner.js';

describe('Comet CLI banner rendering', () => {
  it('centers the logo and tagline on one shared canvas without ANSI by default', () => {
    const banner = renderCometBanner();
    const lines = banner.split('\n');
    const canvasWidth = COMET_TAGLINE.length;

    expect(COMET_TAGLINE).toBe('Agent Skill Harness For Turning Ideas Into Evaluated Workflows');
    expect(lines).toHaveLength(COMET_BANNER_LINE_COUNT);
    for (const [index, logoLine] of COMET_LOGO.entries()) {
      const visibleLogo = logoLine.trimEnd();
      expect(lines[index]).toHaveLength(canvasWidth);
      expect(lines[index]?.indexOf(visibleLogo)).toBe(
        Math.floor((canvasWidth - visibleLogo.length) / 2),
      );
    }
    expect(lines.at(-1)?.trim()).toBe(COMET_TAGLINE);
    expect(lines.at(-1)?.length).toBe(canvasWidth);
    expect(banner).not.toContain('\u001b[');
  });

  it('uses deep blue, bright cyan-blue, and brand blue across a sweep frame', () => {
    const frame = renderCometBannerFrame(24, 1);

    expect(frame).toContain('\u001b[38;2;22;78;154m');
    expect(frame).toContain('\u001b[38;2;88;184;255m');
    expect(frame).toContain('\u001b[38;2;11;111;251m');
    expect(frame).toContain('·');
    expect(frame).toContain('\u001b[0m');

    const visibleLines = frame.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').split('\n');
    const particleLine = visibleLines[2] ?? '';
    const visibleLogo = COMET_LOGO[2].trimEnd();
    const logoEnd =
      Math.floor((COMET_TAGLINE.length - visibleLogo.length) / 2) + visibleLogo.length;
    expect(visibleLines.every((line) => line.length === COMET_TAGLINE.length)).toBe(true);
    expect(particleLine.indexOf('·')).toBeGreaterThanOrEqual(logoEnd);
    expect(particleLine.indexOf('•')).toBeGreaterThanOrEqual(logoEnd);
  });

  it.each([
    [{ isTTY: false, env: {}, columns: 80 }, false],
    [{ isTTY: true, env: { CI: '1' }, columns: 80 }, false],
    [{ isTTY: true, env: { NO_COLOR: '' }, columns: 80 }, false],
    [{ isTTY: true, env: { TERM: 'dumb' }, columns: 80 }, false],
    [{ isTTY: true, env: {}, columns: COMET_TAGLINE.length - 1 }, false],
    [{ isTTY: true, env: {}, columns: undefined }, false],
    [{ isTTY: true, env: {}, columns: 80 }, true],
  ] as const)('decides whether animation is safe for %o', (runtime, expected) => {
    expect(canAnimateCometBanner(runtime)).toBe(expected);
  });

  it('prints plain static output for narrow or unknown terminal widths', async () => {
    for (const columns of [COMET_TAGLINE.length - 1, undefined]) {
      const chunks: string[] = [];
      await printCometBanner({
        runtime: {
          isTTY: true,
          env: {},
          columns,
          write: (chunk) => chunks.push(chunk),
        },
      });
      expect(chunks.join('')).toContain(COMET_TAGLINE);
      expect(chunks.join('')).not.toContain('\u001b[');
    }
  });

  it('plays one sweep without changing cursor visibility and leaves a stable final frame', async () => {
    const chunks: string[] = [];
    const sleeps: number[] = [];

    await printCometBanner({
      runtime: {
        isTTY: true,
        env: {},
        columns: 80,
        write: (chunk) => chunks.push(chunk),
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      },
    });

    const output = chunks.join('');
    expect(output).not.toContain('\u001b[?25l');
    expect(output).not.toContain('\u001b[?25h');
    expect(output).toContain('·');
    expect(output).toContain('•');
    expect(output).toContain(COMET_TAGLINE);
    expect(sleeps).toEqual([...Array<number>(13).fill(45), 55, 55]);

    const lastParticleFrame = chunks.findLastIndex((chunk) => chunk.includes('·'));
    const stableFrame = chunks.findIndex((chunk) => chunk.includes(COMET_LOGO[0]));
    expect(lastParticleFrame).toBeGreaterThan(-1);
    expect(stableFrame).toBeGreaterThan(lastParticleFrame);
    expect(output.endsWith('\u001b[0m\n')).toBe(true);
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
          columns: 80,
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
    expect(fallback).not.toContain('\u001b[?25h');
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
          columns: 80,
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

  it.each([false, true])(
    'swallows asynchronous errors from a real Writable when isTTY is %s and removes listeners',
    async (isTTY) => {
      const stdout = new Writable({
        write(_chunk, _encoding, callback) {
          setImmediate(() => callback(new Error('async stdout failure')));
        },
      });

      await expect(
        printCometBanner({
          runtime: {
            isTTY,
            env: {},
            columns: 80,
            write: createBannerStreamWriter(stdout),
          },
        }),
      ).resolves.toBeUndefined();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stdout.listenerCount('error')).toBe(0);
    },
  );

  it('writes nothing when disabled for JSON mode', async () => {
    const chunks: string[] = [];
    await printCometBanner({
      enabled: false,
      runtime: { write: (chunk) => chunks.push(chunk) },
    });
    expect(chunks).toEqual([]);
  });
});
