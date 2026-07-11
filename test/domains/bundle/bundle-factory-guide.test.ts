import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { buildBundleFactoryGuide } from '../../../domains/bundle/factory-guide.js';
import { createBundleDraft, optimizeBundleDraft } from '../../../domains/bundle/draft.js';

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

async function writeBundle(root: string, name: string): Promise<void> {
  await fs.mkdir(path.join(root, 'skills', 'entry'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'skills', 'entry', 'SKILL.md'),
    '---\nname: entry\ndescription: entry.\n---\n\n# entry\n',
  );
  await fs.writeFile(
    path.join(root, 'bundle.yaml'),
    `apiVersion: comet/v1alpha1
kind: SkillBundle
metadata:
  name: ${name}
  version: 1.0.0
  description: Command fixture
  defaultLocale: en
  locales: [en]
skills:
  - id: entry
    path: skills/entry
    visibility: entry
resources:
  rules: []
  hooks: []
  references: []
  scripts: []
  assets: []
platforms:
  requires: [skills]
  optional: []
  overrides: []
engine:
  enabled: false
`,
  );
}

describe('Skill Creator first-use guide', () => {
  let root: string;
  let projectRoot: string;
  let homeDir: string;
  let builtinRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-factory-guide-'));
    projectRoot = path.join(root, 'project');
    homeDir = path.join(root, 'home');
    builtinRoot = path.join(root, 'builtin');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('guides first-use projects without saved preferences', async () => {
    await writeSkill(
      path.join(projectRoot, '.agents', 'skills', 'brainstorming'),
      'brainstorming',
      'Explore intent before implementation.',
    );
    await writeSkill(
      path.join(homeDir, '.agents', 'skills', 'writing-plans'),
      'writing-plans',
      'Write implementation plans.',
    );

    const guide = await buildBundleFactoryGuide({ projectRoot, homeDir, builtinRoot });

    expect(guide).toMatchObject({
      schemaVersion: 1,
      preference: {
        state: 'missing',
        path: path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      },
      firstRun: true,
      userMessage: {
        title: 'Start with /comet-any',
      },
    });
    expect(guide.inventory.recommended.map((item) => item.name)).toEqual([
      'brainstorming',
      'writing-plans',
    ]);
    expect(guide.nextQuestions).toContain('What Skill do you want to create or optimize?');
    expect(guide.nextQuestions).toContain(
      'Should Comet save these preferences to .comet/skill-preferences.yaml?',
    );
  });

  it('points invalid saved preferences at the file to fix', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      `version: 2
prefer:
  - brainstorming
`,
    );

    const guide = await buildBundleFactoryGuide({ projectRoot, homeDir, builtinRoot });

    expect(guide.firstRun).toBe(false);
    expect(guide.preference).toMatchObject({
      state: 'invalid',
      error: expect.stringContaining('version must be 1'),
    });
    expect(guide.userMessage).toMatchObject({
      title: 'Fix project Skill preferences',
      summary: expect.stringContaining('.comet/skill-preferences.yaml'),
      nextStep: expect.stringContaining('Open .comet/skill-preferences.yaml'),
    });
  });

  it('surfaces resumable Skill Creator flows before starting a new one', async () => {
    await createBundleDraft({
      projectRoot,
      name: 'half-built',
      candidates: [],
      defaultLocale: 'en',
      locales: ['en'],
      engineEnabled: true,
      factory: {
        goal: 'Create a half-built Skill',
        preferredSkills: ['brainstorming'],
        resolvedSkills: [
          { query: 'brainstorming', preferenceIndex: 0, status: 'available', sources: [] },
        ],
        callChain: [{ skill: 'brainstorming', preferenceIndex: 0 }],
        deviations: [],
        engineMode: 'deterministic',
        runnerMode: 'standalone',
      },
    });

    const guide = await buildBundleFactoryGuide({ projectRoot, homeDir, builtinRoot });

    expect(guide.firstRun).toBe(false);
    expect(guide.resumable).toEqual([
      expect.objectContaining({
        name: 'half-built',
        goal: 'Create a half-built Skill',
        currentStep: 'needs-proposal-confirmation',
        recommendedNextStep: expect.objectContaining({
          action: 'confirm-proposal',
        }),
      }),
    ]);
    expect(guide.userMessage.summary).toContain('unfinished Skill creation flow');
  });

  it('does not rewrite authoring state when the draft hash drifts', async () => {
    const sourceRoot = path.join(root, 'source');
    await writeBundle(sourceRoot, 'read-only-guide');
    await optimizeBundleDraft({
      projectRoot,
      sourceRoot,
      name: 'read-only-guide',
      candidates: [],
      defaultLocale: 'en',
      locales: ['en'],
      engineEnabled: false,
    });

    const draftBundlePath = path.join(
      projectRoot,
      '.comet',
      'bundle-drafts',
      'read-only-guide',
      'bundle.yaml',
    );
    const statePath = path.join(projectRoot, '.comet', 'bundle-authoring', 'read-only-guide.json');
    await fs.writeFile(
      draftBundlePath,
      (await fs.readFile(draftBundlePath, 'utf8')).replace(
        'description: Command fixture',
        'description: Drifted fixture',
      ),
    );

    const before = await fs.readFile(statePath, 'utf8');
    await buildBundleFactoryGuide({ projectRoot, homeDir, builtinRoot });
    const after = await fs.readFile(statePath, 'utf8');

    expect(after).toBe(before);
  });
});
