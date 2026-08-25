import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getUserFacingSkillNames,
  isManagedSkillPathForSelection,
  readManifest,
} from '../../../domains/skill/platform-install.js';

const languageRoots = ['assets/skills', 'assets/skills-zh'] as const;
const workflowSkills = ['comet-native', 'comet-classic', 'comet-hotfix', 'comet-tweak'] as const;
const requiredContractMarkers = [
  'comet.memory.review.v1',
  'comet.memory.actions.v1',
  'create',
  'update',
  'forget',
  'skip',
  'global',
  'project',
  'candidateKey',
  'budget.maxActions',
  'language',
  'type',
];

async function readSkill(root: (typeof languageRoots)[number]): Promise<string> {
  return fs.readFile(path.resolve(root, 'comet-memory', 'SKILL.md'), 'utf8');
}

describe('comet-memory Skill assets', () => {
  it('registers the fixed Skill in the manifest and ships both language variants', async () => {
    const manifest = await readManifest();
    expect(getUserFacingSkillNames(manifest)).toContain('comet-memory');
    expect(manifest.skills).toContain('comet-memory/SKILL.md');
    expect(manifest.skills).toContain('comet-memory/agents/openai.yaml');
    for (const root of languageRoots) {
      await expect(
        fs.access(path.resolve(root, 'comet-memory', 'SKILL.md')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.resolve(root, 'comet-memory', 'agents', 'openai.yaml')),
      ).resolves.toBeUndefined();
    }
  });

  it('keeps the machine contract and safety boundary in both languages', async () => {
    const skills = await Promise.all(
      languageRoots.map(async (root) => ({ root, content: await readSkill(root) })),
    );
    for (const { root, content } of skills) {
      expect(content).toContain('name: comet-memory');
      for (const marker of requiredContractMarkers) expect(content).toContain(marker);
      expect(content).toContain('prompt injection');
      expect(content).toContain('skip');
      expect(content).not.toContain('profile.md');
      if (root === 'assets/skills-zh') {
        expect(content).toContain('不写文件');
        expect(content).toContain('完整 transcript');
      } else {
        expect(content).toContain('Do not write files');
        expect(content).toContain('complete transcripts');
      }
    }
  });

  it('keeps the Chinese and English Skill focused on the same fixed decisions', async () => {
    const [english, chinese] = await Promise.all(languageRoots.map((root) => readSkill(root)));
    for (const marker of requiredContractMarkers) {
      expect(english, `English marker ${marker}`).toContain(marker);
      expect(chinese, `Chinese marker ${marker}`).toContain(marker);
    }
    expect(english).toContain('Do not write files');
    expect(chinese).toContain('不写文件');
    expect(english).toContain('Explicit memory wins');
    expect(chinese).toContain('明确记忆优先');
    expect(english).toContain('single scope');
    expect(chinese).toContain('单一 scope');
  });

  it('keeps the shared Skill installed for every workflow selection', async () => {
    const skillPaths = ['comet-memory/SKILL.md', 'comet-memory/agents/openai.yaml'];
    for (const workflow of ['classic', 'native', 'both'] as const) {
      for (const skillPath of skillPaths) {
        expect(isManagedSkillPathForSelection(skillPath, workflow)).toBe(true);
      }
    }
    expect(isManagedSkillPathForSelection('comet-native/SKILL.md', 'classic')).toBe(false);
    expect(isManagedSkillPathForSelection('comet-classic/SKILL.md', 'native')).toBe(false);
  });

  it('keeps workflow observations limited to reusable user information', async () => {
    for (const skill of workflowSkills) {
      const [english, chinese] = await Promise.all(
        languageRoots.map((root) => fs.readFile(path.resolve(root, skill, 'SKILL.md'), 'utf8')),
      );
      for (const marker of ['任务摘要', '进展', '命令输出', '测试结果']) {
        expect(chinese).toContain(marker);
      }
      expect(chinese).toMatch(/不写|不得(?:保存|写)/u);
      for (const marker of ['task summar', 'progress', 'command output', 'test result']) {
        expect(english).toContain(marker);
      }
      expect(english).toMatch(/never|neither command may save/iu);
    }
  });
});
