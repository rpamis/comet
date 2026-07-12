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

type Rgb = readonly [red: number, green: number, blue: number];
type AnimationPhase = 'preheat' | 'sweep' | 'settle';

const RESET = '\u001b[0m';
const DIM_BLUE: Rgb = [7, 31, 63];
const DEEP_BLUE: Rgb = [22, 78, 154];
const BRAND_BLUE: Rgb = [77, 197, 242];
const BRIGHT_BLUE: Rgb = [88, 184, 255];
const TAGLINE_GOLD: Rgb = [208, 151, 53];
const CLI_INDENT = '  ';
const LOGO_WIDTH = Math.max(...COMET_LOGO.map((line) => line.length));
const BANNER_WIDTH = Math.max(LOGO_WIDTH, CLI_INDENT.length + COMET_TAGLINE.length);
const LOGO_CONTENT_LEFT = Math.min(
  ...COMET_LOGO.map((line) => {
    const firstCharacter = line.search(/\S/);
    return firstCharacter < 0 ? LOGO_WIDTH : firstCharacter;
  }),
);
const LOGO_CONTENT_RIGHT = Math.max(...COMET_LOGO.map((line) => line.trimEnd().length));
const LOGO_OFFSET =
  CLI_INDENT.length +
  Math.floor((COMET_TAGLINE.length - (LOGO_CONTENT_RIGHT - LOGO_CONTENT_LEFT)) / 2) -
  LOGO_CONTENT_LEFT;
const FRAME_DELAY_MS = 50;
const PREHEAT_FRAMES = 6;
const SWEEP_FRAMES = 16;
const SETTLE_FRAMES = 14;

export const COMET_BANNER_LINE_COUNT = COMET_LOGO.length + 1;

function ansi([red, green, blue]: Rgb): string {
  return `\u001b[38;2;${red};${green};${blue}m`;
}

function mix(from: Rgb, to: Rgb, progress: number): Rgb {
  const amount = Math.max(0, Math.min(1, progress));
  return from.map((value, index) =>
    Math.round(value + (to[index] - value) * amount),
  ) as unknown as Rgb;
}

function taglineOnCanvas(text: string): string {
  const visibleText = text.trimEnd();
  return `${CLI_INDENT}${visibleText}`.padEnd(BANNER_WIDTH);
}

function logoLineOnCanvas(line: string): string {
  return `${' '.repeat(LOGO_OFFSET)}${line}`.padEnd(BANNER_WIDTH);
}

function revealTaglineFromCenter(text: string, progress: number): string {
  const count = Math.min(text.length, Math.max(0, Math.ceil(text.length * progress)));
  const start = Math.floor((text.length - count) / 2);
  return `${CLI_INDENT}${' '.repeat(start)}${text.slice(start, start + count)}`.padEnd(
    BANNER_WIDTH,
  );
}

function setParticle(canvas: string[], column: number, particle: string): void {
  if (column >= 0 && column < canvas.length) canvas[column] = particle;
}

function logoBounds(): { start: number; end: number } {
  return {
    start: LOGO_OFFSET + LOGO_CONTENT_LEFT,
    end: LOGO_OFFSET + LOGO_CONTENT_RIGHT,
  };
}

function particlesForPhase(
  canvas: string[],
  row: number,
  phase: AnimationPhase,
  progress: number,
): void {
  const { start, end } = logoBounds();

  if (phase === 'preheat') {
    const lead = Math.round((start - 1) * progress);
    if (row === 1) setParticle(canvas, lead, '*');
    if (row === 3) setParticle(canvas, lead - 3, '·');
    if (row === 4) setParticle(canvas, lead - 5, '•');
    return;
  }

  if (phase === 'sweep') {
    const head = Math.round((BANNER_WIDTH + 8) * progress) - 4;
    if (row === 1) setParticle(canvas, head - 5, '·');
    if (row === 2) setParticle(canvas, head - 3, '*');
    if (row === 4) setParticle(canvas, head - 7, '•');
    return;
  }

  if (progress >= 1) return;
  const energy = progress < 0.55 ? progress / 0.55 : (1 - progress) / 0.45;
  const spread = Math.max(1, Math.round(energy * Math.max(1, BANNER_WIDTH - end - 1)));
  if (row === 1) setParticle(canvas, end + spread, '·');
  if (row === 2) setParticle(canvas, end + Math.max(1, spread - 2), '*');
  if (row === 4) setParticle(canvas, end + Math.max(1, Math.floor(spread / 2)), '•');
}

function colorForColumn(phase: AnimationPhase, progress: number, column: number): Rgb {
  if (phase === 'preheat') return mix(DIM_BLUE, DEEP_BLUE, progress);
  if (phase === 'settle') return BRAND_BLUE;

  const head = Math.round((BANNER_WIDTH + 8) * progress) - 4;
  const distance = head - column;
  if (distance < -2) return DEEP_BLUE;
  if (distance <= 2) return BRIGHT_BLUE;
  if (distance <= 8) return mix(BRIGHT_BLUE, BRAND_BLUE, distance / 8);
  return BRAND_BLUE;
}

export function renderCometAnimationFrame(phase: AnimationPhase, progress: number): string {
  const amount = Math.max(0, Math.min(1, progress));
  const logo = COMET_LOGO.map((line, row) => {
    const canvas = [...logoLineOnCanvas(line)];
    particlesForPhase(canvas, row, phase, amount);
    return `${canvas
      .map((character, column) => {
        const particle = character === '·' || character === '•' || character === '*';
        return `${ansi(particle ? BRIGHT_BLUE : colorForColumn(phase, amount, column))}${character}`;
      })
      .join('')}${RESET}`;
  });

  const taglineProgress = phase === 'settle' ? Math.max(0, (amount - 0.57) / 0.43) : 0;
  const tagline = revealTaglineFromCenter(COMET_TAGLINE, taglineProgress);
  return [...logo, `${ansi(TAGLINE_GOLD)}${tagline}${RESET}`].join('\n');
}

export function renderCometBanner(options: { color?: boolean } = {}): string {
  const logo = options.color
    ? COMET_LOGO.map((line) => `${ansi(BRAND_BLUE)}${logoLineOnCanvas(line)}${RESET}`)
    : COMET_LOGO.map(logoLineOnCanvas);
  const tagline = options.color
    ? `${ansi(TAGLINE_GOLD)}${taglineOnCanvas(COMET_TAGLINE)}${RESET}`
    : taglineOnCanvas(COMET_TAGLINE);
  return [...logo, tagline].join('\n');
}

export function renderCometBannerFrame(litColumns: number, particleFrame = 0): string {
  const progress = Math.max(0, Math.min(1, litColumns / BANNER_WIDTH));
  return renderCometAnimationFrame('sweep', Math.min(1, progress + particleFrame * 0.01));
}

export type BannerRuntime = {
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
  getColumns: () => number | undefined;
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
  getColumns: () => process.stdout.columns,
  write: createBannerStreamWriter(process.stdout),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function readColumns(runtime: Pick<BannerRuntime, 'getColumns'>): number | undefined {
  return runtime.getColumns();
}

function isAutomated(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CI && env.CI !== 'false');
}

export function canAnimateCometBanner(
  runtime: Pick<BannerRuntime, 'isTTY' | 'env' | 'getColumns'>,
): boolean {
  const noColor = Object.prototype.hasOwnProperty.call(runtime.env, 'NO_COLOR');
  const columns = readColumns(runtime);
  return (
    runtime.isTTY &&
    !isAutomated(runtime.env) &&
    !noColor &&
    runtime.env.TERM !== 'dumb' &&
    columns !== undefined &&
    columns >= BANNER_WIDTH
  );
}

function staticFrameForRuntime(): string {
  return renderCometBanner();
}

function animationFrameForRuntime(runtime: BannerRuntime, frame: string): string {
  const columns = readColumns(runtime);
  if (columns === undefined || columns < BANNER_WIDTH) throw new Error('terminal width changed');
  return frame;
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

function timeline(): Array<{ phase: AnimationPhase; progress: number }> {
  const frames: Array<{ phase: AnimationPhase; progress: number }> = [];
  for (let index = 0; index < PREHEAT_FRAMES; index += 1) {
    frames.push({ phase: 'preheat', progress: index / (PREHEAT_FRAMES - 1) });
  }
  for (let index = 0; index < SWEEP_FRAMES; index += 1) {
    frames.push({ phase: 'sweep', progress: index / (SWEEP_FRAMES - 1) });
  }
  for (let index = 0; index < SETTLE_FRAMES; index += 1) {
    frames.push({ phase: 'settle', progress: index / (SETTLE_FRAMES - 1) });
  }
  return frames;
}

export async function printCometBanner(
  options: { enabled?: boolean; runtime?: Partial<BannerRuntime> } = {},
): Promise<void> {
  if (options.enabled === false) return;
  const runtime = { ...defaultRuntime, ...options.runtime };
  if (!canAnimateCometBanner(runtime)) {
    await writeSafely(runtime, `\n${staticFrameForRuntime()}\n\n`);
    return;
  }

  let started = false;
  try {
    await runtime.write('\n');
    for (const frame of timeline()) {
      const rendered = animationFrameForRuntime(
        runtime,
        renderCometAnimationFrame(frame.phase, frame.progress),
      );
      await runtime.write(replaceFrame(rendered, !started));
      started = true;
      await runtime.sleep(FRAME_DELAY_MS);
    }
    const stable = animationFrameForRuntime(runtime, renderCometBanner({ color: true }));
    await runtime.write(replaceFrame(stable, false));
    await runtime.write(`${RESET}\n`);
  } catch {
    const cleanup = started ? clearRenderedFrame() : '';
    await writeSafely(runtime, `${RESET}${cleanup}\n${staticFrameForRuntime()}\n\n`);
  }
}
