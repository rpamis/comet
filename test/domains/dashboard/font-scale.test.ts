import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import {
  dashboardFontScaleCss,
  normalizeFontScale,
  readFontScale,
  writeFontScale,
} from '../../../domains/dashboard/web/src/font-scale.js';

describe('dashboard font size preference', () => {
  it('defaults invalid preferences and bounds values to supported slider steps', () => {
    for (const value of [null, '', 'oops', Infinity, undefined])
      expect(normalizeFontScale(value)).toBe(100);
    expect(normalizeFontScale(80)).toBe(90);
    expect(normalizeFontScale(200)).toBe(150);
    expect(normalizeFontScale('124')).toBe(125);
  });
  it('continues when browser storage is unavailable', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readFontScale(storage)).toBe(100);
    expect(() => writeFontScale(125, storage)).not.toThrow();
  });
  it('scales absolute CSS and Tailwind fonts once while preserving relative and root fonts', async () => {
    const result = await postcss([dashboardFontScaleCss()]).process(
      ':root {font-size:14px} .body{font-size:13px}.title{font-size:var(--text-lg)}.child{font-size:1.2em}.inherited{font-size:inherit}',
      { from: undefined },
    );
    expect(result.css).toContain('font-size:14px');
    expect(result.css).toContain('font-size:calc(13px * var(--dashboard-font-scale, 1))');
    expect(result.css).toContain('font-size:calc(var(--text-lg) * var(--dashboard-font-scale, 1))');
    expect(result.css).toContain('font-size:1.2em');
    expect(result.css).toContain('font-size:inherit');
    const again = await postcss([dashboardFontScaleCss()]).process(result.css, { from: undefined });
    expect(again.css).toBe(result.css);
  });
});
