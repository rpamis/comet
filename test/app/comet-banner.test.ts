import { describe, expect, it } from 'vitest';
import {
  COMET_BANNER_LINE_COUNT,
  COMET_LOGO,
  COMET_TAGLINE,
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
});
