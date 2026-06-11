import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';

const readmes = ['README.md', 'README-zh.md'];

describe('README assets', () => {
  it.each(readmes)('uses npm-friendly absolute image URLs in %s', async (readmePath) => {
    const content = await fs.readFile(readmePath, 'utf-8');

    expect(content).not.toMatch(/\b(?:src|srcset)=["'](?:\.\/)?img\//);
    expect(content).toContain('https://github.com/rpamis/comet/blob/master/img/');
  });

  it('documents build_pause in README state examples and field descriptions', async () => {
    const en = await fs.readFile('README.md', 'utf-8');
    const zh = await fs.readFile('README-zh.md', 'utf-8');

    expect(en).toContain('build_pause: null');
    expect(en).toContain('`build_pause` records an internal build-phase pause point');
    expect(en).toContain('`plan-ready` means the plan has been generated');

    expect(zh).toContain('build_pause: null');
    expect(zh).toContain('`build_pause` 记录 build 阶段内部暂停点');
    expect(zh).toContain('`plan-ready` 表示 plan 已生成');
  });
});
