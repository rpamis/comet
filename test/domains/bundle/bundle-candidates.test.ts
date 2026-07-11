import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { discoverBundleCandidates } from '../../../domains/bundle/candidates.js';
import {
  readBundleSkillPreferences,
  readSkillPreferences,
} from '../../../domains/bundle/preferences.js';

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, 'SKILL.md'),
    `---
name: ${name}
description: ${description}
---

# ${name}
`,
  );
}

describe('Bundle candidate preferences and discovery', () => {
  let root: string;
  let projectRoot: string;
  let homeDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-bundle-candidates-'));
    projectRoot = path.join(root, 'project');
    homeDir = path.join(root, 'home');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads project Skill preferences from .comet/skill-preferences.yaml', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      `version: 1
mode: strict
prefer:
  - brainstorming
  - writing-plans
require:
  - verification-before-completion
policies:
  missing: fail
`,
    );

    await expect(readSkillPreferences(projectRoot)).resolves.toEqual([
      'brainstorming',
      'writing-plans',
      'verification-before-completion',
    ]);
    await expect(readBundleSkillPreferences(projectRoot)).resolves.toMatchObject({
      names: ['brainstorming', 'writing-plans', 'verification-before-completion'],
      preferences: {
        mode: 'strict',
        prefer: ['brainstorming', 'writing-plans'],
        require: ['verification-before-completion'],
        policies: expect.objectContaining({ missing: 'fail' }),
      },
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('returns null when the preferences file is missing', async () => {
    await expect(readSkillPreferences(projectRoot)).resolves.toBeNull();
  });

  it('reports invalid preference names as missing without reading outside Skill roots', async () => {
    const outside = path.join(projectRoot, '.claude', 'outside');
    await writeSkill(outside, 'outside', 'Must not be discovered through traversal.');

    const result = await discoverBundleCandidates({
      projectRoot,
      homeDir,
      preferences: ['../outside'],
    });

    expect(result).toEqual([
      { name: '../outside', preferenceIndex: 0, status: 'missing', sources: [] },
    ]);
  });

  it('preserves preference order on candidates and sources', async () => {
    const brainstormingSkill = path.join(projectRoot, '.agents', 'skills', 'brainstorming');
    const writingPlansSkill = path.join(homeDir, '.agents', 'skills', 'writing-plans');
    await writeSkill(brainstormingSkill, 'brainstorming', 'Explore intent before implementation.');
    await writeSkill(writingPlansSkill, 'writing-plans', 'Write implementation plans.');

    const result = await discoverBundleCandidates({
      projectRoot,
      homeDir,
      preferences: ['brainstorming', 'writing-plans'],
    });

    expect(result).toEqual([
      expect.objectContaining({
        name: 'brainstorming',
        preferenceIndex: 0,
        status: 'available',
        sources: [expect.objectContaining({ preferenceIndex: 0 })],
      }),
      expect.objectContaining({
        name: 'writing-plans',
        preferenceIndex: 1,
        status: 'available',
        sources: [expect.objectContaining({ preferenceIndex: 1 })],
      }),
    ]);
  });

  it('preserves explicit path sources instead of collapsing them to project scope', async () => {
    const explicitSkill = path.join(root, 'external-skill', 'skill-a');
    await writeSkill(explicitSkill, 'skill-a', 'Use an explicitly referenced Skill.');
    const realExplicitSkill = await fs.realpath(explicitSkill);

    const result = await discoverBundleCandidates({
      projectRoot,
      homeDir,
      preferences: [explicitSkill],
    });

    expect(result).toEqual([
      expect.objectContaining({
        name: explicitSkill,
        preferenceIndex: 0,
        status: 'available',
        sources: [
          expect.objectContaining({
            name: 'skill-a',
            preferenceIndex: 0,
            platform: 'explicit',
            scope: 'explicit',
            origin: 'explicit',
            root: realExplicitSkill,
            description: 'Use an explicitly referenced Skill.',
          }),
        ],
      }),
    ]);
  });

  it('reads actual SKILL.md descriptions and reports ambiguous providers', async () => {
    const claudeSkill = path.join(projectRoot, '.claude', 'skills', 'brainstorming');
    const codexSkill = path.join(homeDir, '.agents', 'skills', 'brainstorming');
    await writeSkill(claudeSkill, 'brainstorming', 'Explore intent before implementation.');
    await writeSkill(codexSkill, 'brainstorming', 'Generate and compare design options.');
    const realClaudeSkill = await fs.realpath(claudeSkill);
    const realCodexSkill = await fs.realpath(codexSkill);

    const result = await discoverBundleCandidates({
      projectRoot,
      homeDir,
      preferences: ['brainstorming', 'missing'],
    });

    expect(result).toEqual([
      {
        name: 'brainstorming',
        preferenceIndex: 0,
        status: 'ambiguous',
        sources: [
          expect.objectContaining({
            name: 'brainstorming',
            preferenceIndex: 0,
            platform: 'claude-code',
            scope: 'project',
            root: realClaudeSkill,
            description: 'Explore intent before implementation.',
            skillMd: expect.stringContaining('# brainstorming'),
            hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
          expect.objectContaining({
            name: 'brainstorming',
            preferenceIndex: 0,
            platform: 'codex',
            scope: 'global',
            root: realCodexSkill,
            description: 'Generate and compare design options.',
            skillMd: expect.stringContaining('# brainstorming'),
            hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        ],
      },
      { name: 'missing', preferenceIndex: 1, status: 'missing', sources: [] },
    ]);
  });

  it('scans available platform Skills when preferences are absent', async () => {
    await writeSkill(
      path.join(projectRoot, '.cursor', 'skills', 'writing-plans'),
      'writing-plans',
      'Write an implementation plan.',
    );
    await writeSkill(
      path.join(homeDir, '.qwen', 'skills', 'test-driven-development'),
      'test-driven-development',
      'Drive implementation from failing tests.',
    );

    const result = await discoverBundleCandidates({
      projectRoot,
      homeDir,
      preferences: null,
    });

    expect(result.map((candidate) => candidate.name)).toEqual([
      'test-driven-development',
      'writing-plans',
    ]);
    expect(result.every((candidate) => candidate.status === 'available')).toBe(true);
  });
});
