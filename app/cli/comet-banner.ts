import type { Writable } from 'node:stream';

export const COMET_TAGLINE = 'Agent Skill Harness For Turning Ideas Into Evaluated Workflows';

export const COMET_LOGO = [
  '   ██████╗ ██████╗ ███╗   ███╗███████╗████████╗',
  '  ██╔════╝██╔═══██╗████╗ ████║██╔════╝╚══██╔══╝',
  '  ██║     ██║   ██║██╔████╔██║█████╗     ██║   ',
  '  ██║     ██║   ██║██║╚██╔╝██║██╔══╝     ██║   ',
  '  ╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗   ██║   ',
  '   ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝   ╚═╝   ',
] as const;

const RESET = '\u001b[0m';
const DEEP_BLUE = '\u001b[38;2;22;78;154m';
const BRAND_BLUE = '\u001b[38;2;11;111;251m';
const BRIGHT_BLUE = '\u001b[38;2;88;184;255m';
const BANNER_WIDTH = Math.max(...COMET_LOGO.map((line) => line.length), COMET_TAGLINE.length);
const PARTICLES = [
  [],
  [
    [1, '·'],
    [5, '•'],
  ],
  [[4, '·']],
] as const;

export const COMET_BANNER_LINE_COUNT = COMET_LOGO.length + 1;

function center(text: string): string {
  const visibleText = text.trimEnd();
  const left = Math.max(0, Math.floor((BANNER_WIDTH - visibleText.length) / 2));
  return `${' '.repeat(left)}${visibleText}`.padEnd(BANNER_WIDTH);
}

export function renderCometBanner(options: { color?: boolean } = {}): string {
  const logo = options.color
    ? COMET_LOGO.map((line) => `${BRAND_BLUE}${center(line)}${RESET}`)
    : COMET_LOGO.map(center);
  const tagline = options.color
    ? `${BRIGHT_BLUE}${center(COMET_TAGLINE)}${RESET}`
    : center(COMET_TAGLINE);
  return [...logo, tagline].join('\n');
}

export function renderCometBannerFrame(litColumns: number, particleFrame = 0): string {
  const logo = COMET_LOGO.map((line, row) => {
    const canvas = [...center(line)];
    const logoEnd = Math.floor((BANNER_WIDTH - line.trimEnd().length) / 2) + line.trimEnd().length;
    const particles = row === 2 ? (PARTICLES[particleFrame] ?? []) : [];
    for (const [offset, particle] of particles) {
      const column = logoEnd + offset;
      if (column < BANNER_WIDTH) canvas[column] = particle;
    }

    let result = '';
    for (let column = 0; column < canvas.length; column += 1) {
      const color =
        column < litColumns - 2 ? BRAND_BLUE : column <= litColumns ? BRIGHT_BLUE : DEEP_BLUE;
      const isParticle = canvas[column] === '·' || canvas[column] === '•';
      result += `${isParticle ? BRIGHT_BLUE : color}${canvas[column]}`;
    }
    return `${result}${RESET}`;
  });
  return [...logo, `${BRIGHT_BLUE}${center(COMET_TAGLINE)}${RESET}`].join('\n');
}

export type BannerRuntime = {
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
  columns: number | undefined;
  write: (chunk: string) => void | Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
};

const ERASE_LINE = '\u001b[2K';

export function createBannerStreamWriter(stream: Writable): BannerRuntime['write'] {
  return (chunk) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => stream.removeListener('error', onError);
      const onError = (error: Error) => {
        cleanup();
        if (settled) return;
        settled = true;
        reject(error);
      };
      stream.once('error', onError);

      try {
        stream.write(chunk, (error?: Error | null) => {
          if (error) {
            if (!settled) {
              settled = true;
              reject(error);
            }
            setImmediate(cleanup);
            return;
          }
          cleanup();
          if (settled) return;
          settled = true;
          resolve();
        });
      } catch (error) {
        cleanup();
        settled = true;
        reject(error);
      }
    });
}

const defaultRuntime: BannerRuntime = {
  isTTY: Boolean(process.stdout.isTTY),
  env: process.env,
  columns: process.stdout.columns,
  write: createBannerStreamWriter(process.stdout),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export function canAnimateCometBanner(
  runtime: Pick<BannerRuntime, 'isTTY' | 'env' | 'columns'>,
): boolean {
  const ciEnabled = Boolean(runtime.env.CI && runtime.env.CI !== 'false');
  const noColor = Object.prototype.hasOwnProperty.call(runtime.env, 'NO_COLOR');
  return (
    runtime.isTTY &&
    !ciEnabled &&
    !noColor &&
    runtime.env.TERM !== 'dumb' &&
    runtime.columns !== undefined &&
    runtime.columns >= BANNER_WIDTH
  );
}

function replaceFrame(frame: string, first: boolean): string {
  const moveUp = first ? '' : `\u001b[${COMET_BANNER_LINE_COUNT}A`;
  return `${moveUp}${frame
    .split('\n')
    .map((line) => `\r${ERASE_LINE}${line}`)
    .join('\n')}\n`;
}

function clearRenderedFrame(): string {
  const lines = Array.from({ length: COMET_BANNER_LINE_COUNT }, () => `\r${ERASE_LINE}`).join('\n');
  return `\u001b[${COMET_BANNER_LINE_COUNT}A${lines}\n`;
}

async function writeSafely(runtime: Pick<BannerRuntime, 'write'>, chunk: string): Promise<void> {
  try {
    await runtime.write(chunk);
  } catch {
    // Output failures cannot be recovered when the stream itself is unavailable.
  }
}

export async function printCometBanner(
  options: { enabled?: boolean; runtime?: Partial<BannerRuntime> } = {},
): Promise<void> {
  if (options.enabled === false) return;
  const runtime = { ...defaultRuntime, ...options.runtime };
  if (!canAnimateCometBanner(runtime)) {
    await writeSafely(runtime, `\n${renderCometBanner()}\n\n`);
    return;
  }

  let started = false;
  try {
    await runtime.write('\n');
    for (let step = 0; step <= 12; step += 1) {
      const column = Math.round((BANNER_WIDTH * step) / 12);
      await runtime.write(replaceFrame(renderCometBannerFrame(column), !started));
      started = true;
      await runtime.sleep(45);
    }
    for (const particleFrame of [1, 2]) {
      await runtime.write(replaceFrame(renderCometBannerFrame(BANNER_WIDTH, particleFrame), false));
      await runtime.sleep(55);
    }
    await runtime.write(replaceFrame(renderCometBanner({ color: true }), false));
    await runtime.write(`${RESET}\n`);
  } catch {
    const cleanup = started ? clearRenderedFrame() : '';
    await writeSafely(runtime, `${RESET}${cleanup}\n${renderCometBanner()}\n\n`);
  }
}
