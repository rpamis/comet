import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  normalizeSkillPreferencesDocument,
  readProjectSkillPreferences,
  skillPreferenceEntries,
} from '../../../domains/skill/preferences.js';

describe('project skill preferences', () => {
  let root: string;
  let projectRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-skill-preferences-'));
    projectRoot = path.join(root, 'project');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns null when .comet/skill-preferences.yaml is missing', async () => {
    await expect(readProjectSkillPreferences(projectRoot)).resolves.toBeNull();
  });

  it('normalizes mode, preferences, required Skills, policies and hash', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      `version: 1
mode: strict
prefer:
  - brainstorming
  - writing-plans
  - brainstorming
require:
  - verification-before-completion
policies:
  missing: fail
  ambiguous: ask
  deviation: fail
  scripts: disclose
  hooks: deny
`,
    );

    const result = await readProjectSkillPreferences(projectRoot);

    expect(result).toMatchObject({
      path: path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      preferences: {
        version: 1,
        mode: 'strict',
        prefer: ['brainstorming', 'writing-plans'],
        require: ['verification-before-completion'],
        policies: {
          missing: 'fail',
          ambiguous: 'ask',
          deviation: 'fail',
          scripts: 'disclose',
          hooks: 'deny',
        },
      },
      warnings: [
        {
          code: 'duplicate-prefer',
          message: 'Duplicate prefer Skill ignored: brainstorming',
          skill: 'brainstorming',
        },
      ],
    });
    expect(result?.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(skillPreferenceEntries(result!.preferences)).toEqual([
      { query: 'brainstorming', preferenceIndex: 0 },
      { query: 'writing-plans', preferenceIndex: 1 },
      { query: 'verification-before-completion', preferenceIndex: 2 },
    ]);
  });

  it('applies defaults for optional fields', () => {
    const result = normalizeSkillPreferencesDocument(
      { version: 1 },
      '.comet/skill-preferences.yaml',
    );

    expect(result).toEqual({
      preferences: {
        version: 1,
        mode: 'advisory',
        prefer: [],
        require: [],
        policies: {
          missing: 'ask',
          ambiguous: 'ask',
          deviation: 'explain',
          scripts: 'disclose',
          hooks: 'disclose',
        },
      },
      warnings: [],
    });
  });

  it('rejects invalid version, mode and policy values', () => {
    expect(() =>
      normalizeSkillPreferencesDocument({ version: 2 }, '.comet/skill-preferences.yaml'),
    ).toThrow(/version must be 1/iu);
    expect(() =>
      normalizeSkillPreferencesDocument(
        { version: 1, mode: 'locked' },
        '.comet/skill-preferences.yaml',
      ),
    ).toThrow(/mode must be one of advisory, strict/iu);
    expect(() =>
      normalizeSkillPreferencesDocument(
        { version: 1, policies: { hooks: 'maybe' } },
        '.comet/skill-preferences.yaml',
      ),
    ).toThrow(/policies\.hooks/iu);
    expect(() =>
      normalizeSkillPreferencesDocument(
        { version: 1, policies: [] },
        '.comet/skill-preferences.yaml',
      ),
    ).toThrow(/policies must be an object/iu);
    expect(() =>
      normalizeSkillPreferencesDocument(
        { version: 1, prefer: ['brainstorming', ' '] },
        '.comet/skill-preferences.yaml',
      ),
    ).toThrow(/prefer\[1\] must be a non-empty string/iu);
  });

  it('warns on unknown fields without blocking v1 parsing', () => {
    const result = normalizeSkillPreferencesDocument(
      { version: 1, prefer: ['brainstorming'], extra: true },
      '.comet/skill-preferences.yaml',
    );

    expect(result.warnings).toEqual([
      {
        code: 'unknown-field',
        message: 'Unknown top-level field ignored: extra',
        field: 'extra',
      },
    ]);
  });
});
