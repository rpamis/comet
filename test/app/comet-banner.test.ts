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

function stripAnsiSequences(text: string): string {
  let visible = '';
  let insideSequence = false;
  for (const character of text) {
    if (character === '\u001b') {
      insideSequence = true;
    } else if (insideSequence) {
      if (/^[A-Za-z]$/.test(character)) insideSequence = false;
    } else {
      visible += character;
    }
  }
  return visible;
}

describe('Comet CLI banner rendering', () => {
  it('centers one fixed-grid ASCII logo block over the left-aligned tagline', () => {
    const banner = renderCometBanner();
    const lines = banner.split('\n');
    const cliIndent = '  ';
    const canvasWidth = cliIndent.length + COMET_TAGLINE.length;
    const logoWidth = Math.max(...COMET_LOGO.map((line) => line.length));
    const logoOffset = lines[0]?.indexOf(COMET_LOGO[0]) ?? -1;

    expect(COMET_TAGLINE).toBe('Agent Skill Harness For Turning Ideas Into Evaluated Workflows');
    expect(lines).toHaveLength(COMET_BANNER_LINE_COUNT);
    for (const [index, logoLine] of COMET_LOGO.entries()) {
      expect(lines[index]).toHaveLength(canvasWidth);
      expect(lines[index]?.slice(logoOffset, logoOffset + logoWidth)).toBe(
        logoLine.padEnd(logoWidth),
      );
    }
    expect(lines.at(-1)?.startsWith(`${cliIndent}${COMET_TAGLINE}`)).toBe(true);
    expect(lines.at(-1)?.length).toBe(canvasWidth);

    const logoLines = lines.slice(0, COMET_LOGO.length);
    const logoLeft = Math.min(...logoLines.map((line) => line.search(/\S/)));
    const logoRight = Math.max(...logoLines.map((line) => line.trimEnd().length));
    const taglineLeft = lines.at(-1)?.indexOf(COMET_TAGLINE) ?? -1;
    const taglineRight = taglineLeft + COMET_TAGLINE.length;
    expect(Math.abs(logoLeft + logoRight - (taglineLeft + taglineRight))).toBeLessThanOrEqual(1);
    expect(banner).not.toContain('\u001b[');
  });

  it('renders the tagline in rgb(208, 151, 53) when color is enabled', () => {
    const banner = renderCometBanner({ color: true });

    expect(banner).toContain(`\u001b[38;2;208;151;53m  ${COMET_TAGLINE}`);
  });

  it('uses deep blue, bright cyan-blue, and rgb(77, 197, 242) across a sweep frame', () => {
    const frame = renderCometBannerFrame(24, 1);

    expect(frame).toContain('\u001b[38;2;22;78;154m');
    expect(frame).toContain('\u001b[38;2;88;184;255m');
    expect(frame).toContain('\u001b[38;2;77;197;242m');
    expect(frame).toContain('·');
    expect(frame).toContain('\u001b[0m');

    const visibleLines = stripAnsiSequences(frame).split('\n');
    expect(visibleLines.every((line) => line.length === COMET_TAGLINE.length + 2)).toBe(true);
    expect(visibleLines.some((line) => line.includes('*'))).toBe(true);
    expect(visibleLines.some((line) => line.includes('•'))).toBe(true);
  });

  it.each([
    [{ isTTY: false, env: {}, getColumns: () => 80 }, false],
    [{ isTTY: true, env: { CI: '1' }, getColumns: () => 80 }, false],
    [{ isTTY: true, env: { NO_COLOR: '' }, getColumns: () => 80 }, false],
    [{ isTTY: true, env: { TERM: 'dumb' }, getColumns: () => 80 }, false],
    [{ isTTY: true, env: {}, getColumns: () => COMET_TAGLINE.length + 1 }, false],
    [{ isTTY: true, env: {}, getColumns: () => undefined }, false],
    [{ isTTY: true, env: {}, getColumns: () => 80 }, true],
  ] as const)('decides whether animation is safe for %o', (runtime, expected) => {
    expect(canAnimateCometBanner(runtime)).toBe(expected);
  });

  it('prints plain static output for narrow or unknown terminal widths', async () => {
    for (const columns of [COMET_TAGLINE.length + 1, undefined]) {
      const chunks: string[] = [];
      await printCometBanner({
        runtime: {
          isTTY: true,
          env: {},
          getColumns: () => columns,
          write: (chunk) => chunks.push(chunk),
        },
      });
      expect(chunks.join('')).toContain(COMET_TAGLINE);
      expect(chunks.join('')).not.toContain('\u001b[');
    }
  });

  it('keeps the entire static banner left-aligned in a wide terminal', async () => {
    const chunks: string[] = [];
    const terminalColumns = 100;

    await printCometBanner({
      runtime: {
        isTTY: true,
        env: { NO_COLOR: '' },
        getColumns: () => terminalColumns,
        write: (chunk) => chunks.push(chunk),
      },
    });

    const renderedLines = chunks.join('').split('\n').filter(Boolean);
    const baseLines = renderCometBanner().split('\n');
    expect(renderedLines).toEqual(baseLines);
  });

  it('re-reads terminal width without shifting the animation away from the left edge', async () => {
    const chunks: string[] = [];
    let reads = 0;

    await printCometBanner({
      runtime: {
        isTTY: true,
        env: {},
        getColumns: () => {
          reads += 1;
          return reads < 10 ? 100 : 120;
        },
        write: (chunk) => chunks.push(chunk),
        sleep: async () => undefined,
      },
    });

    const output = chunks.join('');
    expect(reads).toBeGreaterThan(30);
    expect(output).not.toContain(`\r\u001b[2K${' '.repeat(19)}\u001b[`);
    expect(output).not.toContain(`\r\u001b[2K${' '.repeat(29)}\u001b[`);
  });

  it('plays a vivid 1.8 second three-act sequence and leaves a stable final frame', async () => {
    const chunks: string[] = [];
    const sleeps: number[] = [];

    await printCometBanner({
      runtime: {
        isTTY: true,
        env: {},
        getColumns: () => 100,
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
    expect(sleeps).toEqual(Array<number>(36).fill(50));
    expect(sleeps.reduce((sum, value) => sum + value, 0)).toBe(1800);
    expect(output).toContain('*');

    const animationFrames = chunks.filter((chunk) => chunk.includes('\u001b[2K'));
    expect(animationFrames.some((frame) => !frame.includes(COMET_TAGLINE))).toBe(true);
    expect(
      animationFrames.some(
        (frame) => frame.includes('Turning Ideas') && !frame.includes(COMET_TAGLINE),
      ),
    ).toBe(true);

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
          getColumns: () => 100,
          write: (chunk) => fallbackChunks.push(chunk),
          sleep: async () => {
            throw new Error('timer failed');
          },
        },
      }),
    ).resolves.toBeUndefined();
    const fallback = fallbackChunks.at(-1) ?? '';
    const cleanupStart = fallback.indexOf(`\u001b[${COMET_BANNER_LINE_COUNT}A`);
    const firstStaticLine = renderCometBanner().split('\n')[0] ?? '';
    const staticBannerStart = fallback.indexOf(firstStaticLine);
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
          getColumns: () => 100,
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
            getColumns: () => 100,
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
