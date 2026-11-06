import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('optional walkthrough Skill contract', () => {
  for (const language of ['skills', 'skills-zh']) {
    it(`${language} loads detailed guidance only when enabled for both workflows`, () => {
      for (const skill of [
        'comet-native',
        'comet-build',
        'comet-tweak',
        'comet-hotfix',
        'comet-verify',
      ]) {
        const source = readFileSync(path.resolve('assets', language, skill, 'SKILL.md'), 'utf8');
        expect(source).toContain('change_walkthrough');
        expect(source).toContain(language === 'skills' ? 'enabled by default' : '默认开启');
        expect(source).toContain('../comet/reference/change-walkthrough.md');
      }
      const reference = readFileSync(
        path.resolve('assets', language, 'comet/reference/change-walkthrough.md'),
        'utf8',
      );
      expect(reference).toContain('comet walkthrough <native|classic>');
      expect(reference).toContain('--verification-only');
      expect(reference).toContain('not-run');
      expect(reference).toContain(
        language === 'skills' ? 'defaults to `true`' : '默认及缺省为 `true`',
      );
      expect(reference).toContain('diagrams');
      expect(reference).toContain('"type": "flow"');
      expect(reference).toContain('"type":"comparison"');
      expect(reference).toContain('2–6');
      expect(reference).not.toContain('<style>');
      const archive = readFileSync(
        path.resolve('assets', language, 'comet-archive/SKILL.md'),
        'utf8',
      );
      expect(archive).toContain('walkthrough.html');
    });
  }
});
