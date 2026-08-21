import { describe, expect, it } from 'vitest';
import { stripUtf8Bom } from '../../platform/fs/strip-bom.js';

const BOM = String.fromCharCode(0xfeff);

describe('stripUtf8Bom', () => {
  it('removes a single leading UTF-8 BOM', () => {
    expect(stripUtf8Bom(BOM + '{"ok":true}')).toBe('{"ok":true}');
  });

  it('keeps text without a BOM unchanged', () => {
    expect(stripUtf8Bom('{"ok":true}')).toBe('{"ok":true}');
  });

  it('only strips the first character, keeping interior BOMs intact', () => {
    expect(stripUtf8Bom(BOM + 'a' + BOM + 'b')).toBe('a' + BOM + 'b');
  });

  it('handles empty and BOM-only strings', () => {
    expect(stripUtf8Bom('')).toBe('');
    expect(stripUtf8Bom(BOM)).toBe('');
  });
});
