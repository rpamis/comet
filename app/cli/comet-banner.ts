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
