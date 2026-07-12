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
const LOGO_WIDTH = Math.max(...COMET_LOGO.map((line) => line.length), COMET_TAGLINE.length);
const PARTICLES = ['', '  ·   •', '    ·'];

export const COMET_BANNER_LINE_COUNT = COMET_LOGO.length + 1;

function center(text: string): string {
  const left = Math.max(0, Math.floor((LOGO_WIDTH - text.length) / 2));
  return `${' '.repeat(left)}${text}`.padEnd(LOGO_WIDTH);
}

export function renderCometBanner(options: { color?: boolean } = {}): string {
  const logo = options.color
    ? COMET_LOGO.map((line) => `${BRAND_BLUE}${line}${RESET}`)
    : [...COMET_LOGO];
  const tagline = options.color
    ? `${BRIGHT_BLUE}${center(COMET_TAGLINE)}${RESET}`
    : center(COMET_TAGLINE);
  return [...logo, tagline].join('\n');
}

export function renderCometBannerFrame(litColumns: number, particleFrame = 0): string {
  const logo = COMET_LOGO.map((line, row) => {
    let result = '';
    for (let column = 0; column < line.length; column += 1) {
      const color =
        column < litColumns - 2 ? BRAND_BLUE : column <= litColumns ? BRIGHT_BLUE : DEEP_BLUE;
      result += `${color}${line[column]}`;
    }
    const particles = row === 2 ? (PARTICLES[particleFrame] ?? '') : '';
    return `${result}${BRIGHT_BLUE}${particles}${RESET}`;
  });
  return [...logo, `${BRIGHT_BLUE}${center(COMET_TAGLINE)}${RESET}`].join('\n');
}

export type BannerRuntime = {
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
  write: (chunk: string) => void;
  sleep: (milliseconds: number) => Promise<void>;
};

const HIDE_CURSOR = '\u001b[?25l';
const SHOW_CURSOR = '\u001b[?25h';
const ERASE_LINE = '\u001b[2K';

const defaultRuntime: BannerRuntime = {
  isTTY: Boolean(process.stdout.isTTY),
  env: process.env,
  write: (chunk) => {
    process.stdout.write(chunk);
  },
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export function canAnimateCometBanner(runtime: Pick<BannerRuntime, 'isTTY' | 'env'>): boolean {
  const ciEnabled = Boolean(runtime.env.CI && runtime.env.CI !== 'false');
  const noColor = Object.prototype.hasOwnProperty.call(runtime.env, 'NO_COLOR');
  return runtime.isTTY && !ciEnabled && !noColor && runtime.env.TERM !== 'dumb';
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

export async function printCometBanner(
  options: { enabled?: boolean; runtime?: Partial<BannerRuntime> } = {},
): Promise<void> {
  if (options.enabled === false) return;
  const runtime = { ...defaultRuntime, ...options.runtime };
  if (!canAnimateCometBanner(runtime)) {
    runtime.write(`\n${renderCometBanner()}\n\n`);
    return;
  }

  let started = false;
  try {
    runtime.write(`\n${HIDE_CURSOR}`);
    for (let column = 0; column <= 48; column += 4) {
      runtime.write(replaceFrame(renderCometBannerFrame(column), !started));
      started = true;
      await runtime.sleep(45);
    }
    for (const particleFrame of [1, 2]) {
      runtime.write(replaceFrame(renderCometBannerFrame(50, particleFrame), false));
      await runtime.sleep(55);
    }
    runtime.write(replaceFrame(renderCometBanner({ color: true }), false));
    runtime.write(`${RESET}${SHOW_CURSOR}\n`);
  } catch {
    const cleanup = started ? clearRenderedFrame() : '';
    runtime.write(`${RESET}${SHOW_CURSOR}${cleanup}\n${renderCometBanner()}\n\n`);
  }
}
