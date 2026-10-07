import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SDK warm continuation instructions', () => {
  it.each(['comet-design', 'comet-verify', 'comet-archive'])(
    '%s reuses current context without skipping freshness or approval checks',
    async (name) => {
      const content = await readFile(path.resolve('assets/skills-zh', name, 'SKILL.md'), 'utf8');
      const sdk = content.split('## SDK Run 路径')[1].split('以下旧 Runtime')[0];
      expect(sdk).toContain('最新有效响应');
      expect(sdk).toContain('冷恢复');
      expect(sdk).toContain('响应版本已过期');
      expect(sdk).toContain('Runtime 校验当前版本与证据');
      expect(sdk).toContain('不能用缓存跳过检查或批准');
      expect(sdk).toMatch(/结果未明时|结果明确前/);
      expect(sdk).not.toMatch(/先运行 `comet state next/);
      expect(sdk).not.toContain('Guard 通过后再次运行');
    },
  );

  it.each(['comet-design', 'comet-verify', 'comet-archive'])(
    '%s keeps the same warm-context safeguards in English',
    async (name) => {
      const content = await readFile(path.resolve('assets/skills', name, 'SKILL.md'), 'utf8');
      const sdk = content.split('## SDK Run path')[1].split('The remaining original Runtime')[0];
      expect(sdk).toContain('latest valid response');
      expect(sdk).toContain('cold recovery');
      expect(sdk).toContain('stale response version');
      expect(sdk).toContain('cached context cannot bypass checks or approval');
      expect(sdk).not.toContain('After Guard succeeds, read');
    },
  );

  it.each(['skills', 'skills-zh'])('%s skips a redundant next after selection', async (root) => {
    for (const name of ['comet-classic', 'comet-open']) {
      const content = await readFile(path.resolve('assets', root, name, 'SKILL.md'), 'utf8');
      expect(content).not.toMatch(/comet state select <(?:name|change-name)>\ncomet state next/);
      expect(content).toContain('comet state select');
      expect(content).toContain('comet state next');
    }
  });

  it('makes Native SDK archive preview optional and follows fresh continuation', async () => {
    const content = await readFile(
      path.resolve('assets/skills-zh/comet-native/reference/commands.md'),
      'utf8',
    );
    expect(content).toContain('仅需预览或诊断时使用');
    expect(content).toContain('每次只按返回的最新 continuation 继续');
    expect(content).not.toContain('再逐次执行 `native archive');
  });
});
