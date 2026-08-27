import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { getUserFacingSkillNames, readManifest } from '../../domains/skill/platform-install.js';

type OpenAiYaml = {
  interface?: { display_name?: unknown; short_description?: unknown };
  policy?: { allow_implicit_invocation?: unknown };
};

const languageRoots = ['assets/skills', 'assets/skills-zh'] as const;

// The root workflow and its phase/preset entries must be model-invocable so
// /comet can dispatch them without requiring a second manual slash command.
const implicitlyInvocableSkills = new Set([
  'comet-open',
  'comet-design',
  'comet-build',
  'comet-verify',
  'comet-archive',
  'comet-hotfix',
  'comet-tweak',
]);
const alwaysModelInvocableSkills = new Set(['comet', 'comet-classic', 'comet-native']);
const explicitOnlySkills = new Set(['comet-review', 'comet-any', 'comet-memory']);

async function readSkillFrontmatter(skillRoot: string, skillName: string): Promise<Set<string>> {
  const content = await fs.readFile(path.resolve(skillRoot, skillName, 'SKILL.md'), 'utf8');
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  const fields = new Set<string>();
  if (!match) return fields;
  for (const line of match[1].split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon > 0) fields.add(trimmed.slice(0, colon).trim());
  }
  return fields;
}

describe('Skill openai.yaml platform metadata', () => {
  it('ships an agents/openai.yaml for every user-facing skill in both languages', async () => {
    const manifest = await readManifest();
    const skillNames = getUserFacingSkillNames(manifest);

    for (const skillName of skillNames) {
      for (const root of languageRoots) {
        const openaiPath = path.resolve(root, skillName, 'agents', 'openai.yaml');
        expect(existsSync(openaiPath), `${root}/${skillName}/agents/openai.yaml exists`).toBe(true);
      }

      expect(
        manifest.skills,
        `${skillName}/agents/openai.yaml is registered in the manifest`,
      ).toContain(`${skillName}/agents/openai.yaml`);
    }
  });

  it('exposes interface display_name and short_description in every openai.yaml', async () => {
    const manifest = await readManifest();
    const skillNames = getUserFacingSkillNames(manifest);

    for (const skillName of skillNames) {
      for (const root of languageRoots) {
        const raw = await fs.readFile(
          path.resolve(root, skillName, 'agents', 'openai.yaml'),
          'utf8',
        );
        const doc = parseYaml(raw) as OpenAiYaml;

        expect(typeof doc.interface?.display_name, `${root}/${skillName} display_name`).toBe(
          'string',
        );
        expect(
          typeof doc.interface?.short_description,
          `${root}/${skillName} short_description`,
        ).toBe('string');
      }
    }
  });

  it('aligns Codex implicit-invocation policy with the Claude Code disable-model-invocation flag', async () => {
    const manifest = await readManifest();
    const skillNames = getUserFacingSkillNames(manifest);

    for (const skillName of skillNames) {
      const shouldBeImplicitlyInvocable =
        implicitlyInvocableSkills.has(skillName) || alwaysModelInvocableSkills.has(skillName);
      const shouldBeExplicitOnly = explicitOnlySkills.has(skillName);

      expect(
        shouldBeImplicitlyInvocable || shouldBeExplicitOnly,
        `${skillName} has an invocation policy classification`,
      ).toBe(true);

      for (const root of languageRoots) {
        const frontmatter = await readSkillFrontmatter(root, skillName);
        expect(
          frontmatter.has('disable-model-invocation'),
          `${root}/${skillName} disable-model-invocation presence`,
        ).toBe(shouldBeExplicitOnly);

        const raw = await fs.readFile(
          path.resolve(root, skillName, 'agents', 'openai.yaml'),
          'utf8',
        );
        const doc = parseYaml(raw) as OpenAiYaml;

        if (shouldBeExplicitOnly || implicitlyInvocableSkills.has(skillName)) {
          expect(
            doc.policy?.allow_implicit_invocation,
            `${root}/${skillName} invocation policy`,
          ).toBe(shouldBeImplicitlyInvocable);
        } else {
          expect(
            doc.policy,
            `${root}/${skillName} must not opt out of implicit invocation`,
          ).toBeUndefined();
        }
      }
    }
  });
});
