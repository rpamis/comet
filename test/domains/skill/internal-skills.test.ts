import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import {
  getManagedSkillPaths,
  getManifestSkills,
  getUserFacingSkillNames,
  readManifest,
  type Manifest,
} from '../../../domains/skill/platform-install.js';

const manifest: Manifest = {
  version: '1.0.0',
  skills: ['comet/SKILL.md', 'comet-open/SKILL.md', 'comet/scripts/runtime.mjs'],
  internalSkills: ['comet/runtime/classic/skill.yaml'],
};

describe('internal Skill assets', () => {
  it('binds every Classic entry Skill to an explicit current change', async () => {
    const skillNames = [
      'comet',
      'comet-open',
      'comet-design',
      'comet-build',
      'comet-verify',
      'comet-archive',
      'comet-hotfix',
      'comet-tweak',
    ];

    for (const name of skillNames) {
      const [chinese, english] = await Promise.all(
        ['assets/skills-zh', 'assets/skills'].map((root) =>
          fs.readFile(path.resolve(root, name, 'SKILL.md'), 'utf8'),
        ),
      );
      expect(chinese, `${name} Chinese selection protocol`).toContain(
        'comet state select <change-name>',
      );
      expect(english, `${name} English selection protocol`).toContain(
        'comet state select <change-name>',
      );
    }

    const [chineseRule, englishRule] = await Promise.all([
      fs.readFile(path.resolve('assets/skills/comet/rules/comet-phase-guard.md'), 'utf8'),
      fs.readFile(path.resolve('assets/skills/comet/rules/comet-phase-guard.en.md'), 'utf8'),
    ]);
    expect(chineseRule).toContain('多个 active change');
    expect(englishRule).toContain('multiple active changes');

    const [chineseBuild, englishBuild] = await Promise.all([
      fs.readFile(path.resolve('assets/skills-zh/comet-build/SKILL.md'), 'utf8'),
      fs.readFile(path.resolve('assets/skills/comet-build/SKILL.md'), 'utf8'),
    ]);
    expect(chineseBuild.match(/comet state select <change-name>/gu)).toHaveLength(2);
    expect(englishBuild.match(/comet state select <change-name>/gu)).toHaveLength(2);
  });

  it('includes internal Skills in managed lifecycle paths', () => {
    expect(getManagedSkillPaths(manifest)).toEqual([
      'comet/SKILL.md',
      'comet-open/SKILL.md',
      'comet/scripts/runtime.mjs',
      'comet/runtime/classic/skill.yaml',
    ]);
  });

  it('excludes internal Skills from user-facing command names', () => {
    expect(getUserFacingSkillNames(manifest)).toEqual(['comet', 'comet-open']);
  });

  it('declares the internalSkills collection in the shipped manifest', async () => {
    const shipped = await readManifest();

    expect(shipped.internalSkills).toEqual([
      'comet/runtime/classic/skill.yaml',
      'comet/runtime/classic/guardrails.yaml',
      'comet/runtime/classic/checks.yaml',
    ]);
    expect(getUserFacingSkillNames(shipped)).not.toContain('comet-classic');
    expect(getUserFacingSkillNames(shipped)).not.toContain('runtime');
    expect(await getManifestSkills()).toEqual(getManagedSkillPaths(shipped));
  });
});
