import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createBundleDraft, optimizeBundleDraft } from '../../../domains/bundle/draft.js';
import { initializeBundleFactoryState } from '../../../domains/bundle/factory.js';
import { recordAuthoringLane } from '../../../domains/bundle/authoring.js';
import {
  readBundleAuthoringState,
  reconcileBundleAuthoringState,
  writeBundleAuthoringState,
} from '../../../domains/bundle/state.js';
import type { BundleAuthoringState } from '../../../domains/bundle/types.js';
import { workflowFor as workflowDefinitionFor } from '../../helpers/workflow-plan.js';

async function writeBundle(root: string, name: string, version = '1.0.0'): Promise<void> {
  await fs.mkdir(path.join(root, 'skills', 'demo'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'bundle.yaml'),
    `apiVersion: comet/v1alpha1
kind: SkillBundle
metadata:
  name: ${name}
  version: ${version}
  description: Authoring fixture
  defaultLocale: en
  locales: [en, zh]
skills:
  - id: demo
    path: skills/demo
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
  await fs.writeFile(
    path.join(root, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: Demo entry.\n---\n\n# Demo\n',
  );
}

async function writeFactorySkill(projectRoot: string, name: string): Promise<void> {
  const skillRoot = path.join(projectRoot, '.comet', 'skills', name);
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(
    path.join(skillRoot, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name}.\n---\n# ${name}\n`,
  );
}

function workflowFor(name: string, skills: string[]): ReturnType<typeof workflowDefinitionFor> {
  return workflowDefinitionFor(name, skills);
}

describe('Bundle authoring lifecycle', () => {
  let root: string;
  let projectRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-bundle-authoring-'));
    projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates a draft directory and atomically persists authoring choices', async () => {
    const state = await createBundleDraft({
      projectRoot,
      name: 'demo-bundle',
      candidates: [
        {
          name: 'brainstorming',
          preferenceIndex: 0,
          platform: 'codex',
          scope: 'project',
          origin: 'project',
          factory: { query: 'brainstorming' },
          root: path.join(projectRoot, '.agents', 'skills', 'brainstorming'),
          description: 'Explore intent.',
          skillMd: '# Brainstorming\n',
          hash: 'a'.repeat(64),
        },
      ],
      defaultLocale: 'zh',
      locales: ['zh', 'en'],
      engineEnabled: true,
    });

    expect(state).toMatchObject({
      schemaVersion: 1,
      name: 'demo-bundle',
      mode: 'create',
      status: 'draft',
      currentHash: null,
      defaultLocale: 'zh',
      locales: ['zh', 'en'],
      engineEnabled: true,
      candidates: [expect.objectContaining({ name: 'brainstorming', hash: 'a'.repeat(64) })],
    });
    await expect(fs.stat(state.draftPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(readBundleAuthoringState(projectRoot, 'demo-bundle')).resolves.toEqual(state);
    expect(await fs.readdir(path.join(projectRoot, '.comet', 'bundle-authoring'))).toEqual([
      'demo-bundle.json',
    ]);
  });

  it('serializes project paths relatively while rehydrating them for runtime operations', async () => {
    const state = await createBundleDraft({
      projectRoot,
      name: 'portable-state',
      candidates: [
        {
          name: 'brainstorming',
          preferenceIndex: 0,
          platform: 'codex',
          scope: 'project',
          origin: 'project',
          factory: { query: 'brainstorming' },
          root: path.join(projectRoot, '.agents', 'skills', 'brainstorming'),
          description: 'Explore intent.',
          skillMd: '# Brainstorming\n',
          hash: 'c'.repeat(64),
        },
      ],
      defaultLocale: 'zh',
      locales: ['zh'],
      engineEnabled: true,
    });

    const persisted = JSON.parse(
      await fs.readFile(
        path.join(projectRoot, '.comet', 'bundle-authoring', 'portable-state.json'),
        'utf8',
      ),
    );
    expect(persisted.draftPath).toBe('./.comet/bundle-drafts/portable-state');
    expect(persisted.candidates[0].root).toBe('./.agents/skills/brainstorming');
    expect(JSON.stringify(persisted)).not.toContain(projectRoot);
    await expect(readBundleAuthoringState(projectRoot, 'portable-state')).resolves.toEqual(state);
  });

  it('restores portable state in a different project root without rewriting workflow artifact references', async () => {
    const sourceState = await createBundleDraft({
      projectRoot,
      name: 'relocated-state',
      candidates: [
        {
          name: 'brainstorming',
          preferenceIndex: 0,
          platform: 'codex',
          scope: 'project',
          origin: 'project',
          factory: { query: 'brainstorming' },
          root: path.join(projectRoot, '.agents', 'skills', 'brainstorming'),
          description: 'Explore intent.',
          skillMd: '# Brainstorming\n',
          hash: 'd'.repeat(64),
        },
      ],
      defaultLocale: 'zh',
      locales: ['zh'],
      engineEnabled: true,
    });
    const recoveredProjectRoot = path.join(root, 'recovered-project');
    const state: BundleAuthoringState = {
      ...sourceState,
      base: {
        root: path.join(projectRoot, '.agents', 'skills', 'base'),
        version: '1.0.0',
        hash: 'e'.repeat(64),
      },
      eval: {
        level: 'quick',
        hash: 'f'.repeat(64),
        resultPath: path.join(
          projectRoot,
          '.comet',
          'bundle-evals',
          'relocated-state',
          'result.json',
        ),
        passed: true,
      },
      ready: {
        hash: 'f'.repeat(64),
        path: path.join(projectRoot, '.comet', 'bundles', 'relocated-state'),
        publishedAt: '2026-07-25T00:00:00.000Z',
      },
      factory: {
        goal: 'Create a portable bundle.',
        preferredSkills: [],
        resolvedSkills: [
          {
            query: 'brainstorming',
            preferenceIndex: 0,
            status: 'available',
            sources: [sourceState.candidates[0]],
          },
        ],
        callChain: [],
        deviations: [],
        engineMode: 'none',
        runnerMode: 'standalone',
        preferencePath: path.join(projectRoot, '.comet', 'preferences.json'),
        planPath: path.join(projectRoot, '.comet', 'bundle-drafts', 'relocated-state', 'plan.json'),
        generatedSkillPackage: {
          entrySkill: 'relocated-state',
          internalSkills: [],
          packageRoot: path.join(
            projectRoot,
            '.comet',
            'bundle-drafts',
            'relocated-state',
            'skills',
            'relocated-state',
          ),
          enginePath: path.join(
            projectRoot,
            '.comet',
            'bundle-drafts',
            'relocated-state',
            'skills',
            'relocated-state',
            'comet',
          ),
          evalManifestPath: path.join(
            projectRoot,
            '.comet',
            'bundle-drafts',
            'relocated-state',
            'skills',
            'relocated-state',
            'comet',
            'eval.yaml',
          ),
          controlPlane: {
            checksPath: path.join(
              projectRoot,
              '.comet',
              'bundle-drafts',
              'relocated-state',
              'skills',
              'relocated-state',
              'comet',
              'checks.yaml',
            ),
            evalManifestPath: path.join(
              projectRoot,
              '.comet',
              'bundle-drafts',
              'relocated-state',
              'skills',
              'relocated-state',
              'comet',
              'eval.yaml',
            ),
            compositionReportPath: path.join(
              projectRoot,
              '.comet',
              'bundle-drafts',
              'relocated-state',
              'skills',
              'relocated-state',
              'reference',
              'composition-report.md',
            ),
            scripts: [
              path.join(
                projectRoot,
                '.comet',
                'bundle-drafts',
                'relocated-state',
                'skills',
                'relocated-state',
                'scripts',
                'comet-plan.mjs',
              ),
            ],
          },
          platformAgents: [
            {
              id: 'relocated-state-author',
              platform: 'claude',
              path: path.join(
                projectRoot,
                '.comet',
                'bundle-drafts',
                'relocated-state',
                'skills',
                'relocated-state',
                'agents',
                'claude',
                'author.md',
              ),
            },
          ],
        },
        authoringContent: { artifactReference: './reports/*.json' },
      },
    };
    await writeBundleAuthoringState(projectRoot, state);

    const sourceStatePath = path.join(
      projectRoot,
      '.comet',
      'bundle-authoring',
      'relocated-state.json',
    );
    const persisted = JSON.parse(await fs.readFile(sourceStatePath, 'utf8'));
    expect(persisted.draftPath).toBe('./.comet/bundle-drafts/relocated-state');
    expect(persisted.eval.resultPath).toBe('./.comet/bundle-evals/relocated-state/result.json');
    expect(persisted.factory.resolvedSkills[0].sources[0].root).toBe(
      './.agents/skills/brainstorming',
    );
    expect(persisted.factory.generatedSkillPackage.controlPlane.scripts).toEqual([
      './.comet/bundle-drafts/relocated-state/skills/relocated-state/scripts/comet-plan.mjs',
    ]);
    expect(persisted.factory.authoringContent.artifactReference).toBe('./reports/*.json');
    expect(JSON.stringify(persisted)).not.toContain(projectRoot);

    const legacyWindowsPortablePath = (value: string) =>
      `./${value.slice(2).replaceAll('/', '\\')}`;
    persisted.draftPath = legacyWindowsPortablePath(persisted.draftPath);
    persisted.base.root = legacyWindowsPortablePath(persisted.base.root);
    persisted.candidates[0].root = legacyWindowsPortablePath(persisted.candidates[0].root);
    persisted.eval.resultPath = legacyWindowsPortablePath(persisted.eval.resultPath);
    persisted.ready.path = legacyWindowsPortablePath(persisted.ready.path);
    persisted.factory.preferencePath = legacyWindowsPortablePath(persisted.factory.preferencePath);
    persisted.factory.planPath = legacyWindowsPortablePath(persisted.factory.planPath);
    persisted.factory.resolvedSkills[0].sources[0].root = legacyWindowsPortablePath(
      persisted.factory.resolvedSkills[0].sources[0].root,
    );
    const generated = persisted.factory.generatedSkillPackage;
    generated.packageRoot = legacyWindowsPortablePath(generated.packageRoot);
    generated.enginePath = legacyWindowsPortablePath(generated.enginePath);
    generated.evalManifestPath = legacyWindowsPortablePath(generated.evalManifestPath);
    generated.controlPlane.checksPath = legacyWindowsPortablePath(
      generated.controlPlane.checksPath,
    );
    generated.controlPlane.evalManifestPath = legacyWindowsPortablePath(
      generated.controlPlane.evalManifestPath,
    );
    generated.controlPlane.compositionReportPath = legacyWindowsPortablePath(
      generated.controlPlane.compositionReportPath,
    );
    generated.controlPlane.scripts = generated.controlPlane.scripts.map(legacyWindowsPortablePath);
    generated.platformAgents[0].path = legacyWindowsPortablePath(generated.platformAgents[0].path);
    await fs.writeFile(sourceStatePath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');

    const recoveredStatePath = path.join(
      recoveredProjectRoot,
      '.comet',
      'bundle-authoring',
      'relocated-state.json',
    );
    await fs.mkdir(path.dirname(recoveredStatePath), { recursive: true });
    await fs.copyFile(sourceStatePath, recoveredStatePath);

    await expect(
      readBundleAuthoringState(recoveredProjectRoot, 'relocated-state'),
    ).resolves.toMatchObject({
      draftPath: path.join(recoveredProjectRoot, '.comet', 'bundle-drafts', 'relocated-state'),
      base: { root: path.join(recoveredProjectRoot, '.agents', 'skills', 'base') },
      candidates: [{ root: path.join(recoveredProjectRoot, '.agents', 'skills', 'brainstorming') }],
      eval: {
        resultPath: path.join(
          recoveredProjectRoot,
          '.comet',
          'bundle-evals',
          'relocated-state',
          'result.json',
        ),
      },
      ready: { path: path.join(recoveredProjectRoot, '.comet', 'bundles', 'relocated-state') },
      factory: {
        preferencePath: path.join(recoveredProjectRoot, '.comet', 'preferences.json'),
        planPath: path.join(
          recoveredProjectRoot,
          '.comet',
          'bundle-drafts',
          'relocated-state',
          'plan.json',
        ),
        resolvedSkills: [
          {
            sources: [
              {
                root: path.join(recoveredProjectRoot, '.agents', 'skills', 'brainstorming'),
              },
            ],
          },
        ],
        generatedSkillPackage: {
          packageRoot: path.join(
            recoveredProjectRoot,
            '.comet',
            'bundle-drafts',
            'relocated-state',
            'skills',
            'relocated-state',
          ),
          controlPlane: {
            scripts: [
              path.join(
                recoveredProjectRoot,
                '.comet',
                'bundle-drafts',
                'relocated-state',
                'skills',
                'relocated-state',
                'scripts',
                'comet-plan.mjs',
              ),
            ],
          },
          platformAgents: [
            {
              path: path.join(
                recoveredProjectRoot,
                '.comet',
                'bundle-drafts',
                'relocated-state',
                'skills',
                'relocated-state',
                'agents',
                'claude',
                'author.md',
              ),
            },
          ],
        },
        authoringContent: { artifactReference: './reports/*.json' },
      },
    });
  });

  it('persists Skill Creator metadata with ordered preferences and deviation reasons', async () => {
    const resolvedSource = {
      name: 'brainstorming',
      preferenceIndex: 0,
      platform: 'codex',
      scope: 'project' as const,
      origin: 'project' as const,
      factory: { query: 'brainstorming' },
      root: path.join(projectRoot, '.agents', 'skills', 'brainstorming'),
      description: 'Explore intent.',
      skillMd: '# Brainstorming\n',
      hash: 'b'.repeat(64),
    };

    const state = await createBundleDraft({
      projectRoot,
      name: 'factory-bundle',
      candidates: [resolvedSource],
      defaultLocale: 'zh',
      locales: ['zh', 'en'],
      engineEnabled: true,
      factory: {
        goal: 'Create a Comet-native workflow authoring Skill.',
        preferredSkills: ['brainstorming', 'writing-plans'],
        resolvedSkills: [
          {
            query: 'brainstorming',
            preferenceIndex: 0,
            status: 'available',
            sources: [resolvedSource],
          },
          {
            query: 'writing-plans',
            preferenceIndex: 1,
            status: 'missing',
            sources: [],
          },
        ],
        callChain: [
          { skill: 'brainstorming', preferenceIndex: 0 },
          { skill: 'writing-plans', preferenceIndex: 1 },
        ],
        deviations: [
          {
            skill: 'writing-plans',
            expectedIndex: 1,
            actualIndex: 0,
            reason: 'Planning starts first because the user already supplied a concrete workflow.',
          },
        ],
        engineMode: 'deterministic',
        runnerMode: 'standalone',
      },
    });

    expect(state.factory).toEqual({
      goal: 'Create a Comet-native workflow authoring Skill.',
      preferredSkills: ['brainstorming', 'writing-plans'],
      resolvedSkills: [
        {
          query: 'brainstorming',
          preferenceIndex: 0,
          status: 'available',
          sources: [resolvedSource],
        },
        {
          query: 'writing-plans',
          preferenceIndex: 1,
          status: 'missing',
          sources: [],
        },
      ],
      callChain: [
        { skill: 'brainstorming', preferenceIndex: 0 },
        { skill: 'writing-plans', preferenceIndex: 1 },
      ],
      deviations: [
        {
          skill: 'writing-plans',
          expectedIndex: 1,
          actualIndex: 0,
          reason: 'Planning starts first because the user already supplied a concrete workflow.',
        },
      ],
      engineMode: 'deterministic',
      runnerMode: 'standalone',
    });
    await expect(readBundleAuthoringState(projectRoot, 'factory-bundle')).resolves.toMatchObject({
      factory: state.factory,
    });
  });

  it('never overwrites an existing draft directory', async () => {
    const existing = path.join(projectRoot, '.comet', 'bundle-drafts', 'existing');
    await fs.mkdir(existing, { recursive: true });
    await fs.writeFile(path.join(existing, 'notes.txt'), 'keep me\n');

    await expect(
      createBundleDraft({
        projectRoot,
        name: 'existing',
        candidates: [],
        defaultLocale: 'en',
        locales: ['en'],
        engineEnabled: false,
      }),
    ).rejects.toThrow('already exists');
    await expect(fs.readFile(path.join(existing, 'notes.txt'), 'utf8')).resolves.toBe('keep me\n');
  });

  it('copies an existing Bundle into an optimize draft without changing the source', async () => {
    const sourceRoot = path.join(root, 'source');
    await writeBundle(sourceRoot, 'demo-bundle', '2.3.4');
    const realSourceRoot = await fs.realpath(sourceRoot);
    const sourceBefore = await fs.readFile(
      path.join(sourceRoot, 'skills', 'demo', 'SKILL.md'),
      'utf8',
    );

    const state = await optimizeBundleDraft({
      projectRoot,
      name: 'demo-bundle',
      sourceRoot,
      candidates: [],
      defaultLocale: 'en',
      locales: ['en', 'zh'],
      engineEnabled: false,
    });

    expect(state).toMatchObject({
      mode: 'optimize',
      status: 'draft',
      currentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      base: {
        root: realSourceRoot,
        version: '2.3.4',
        hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(state.currentHash).toBe(state.base?.hash);
    await fs.appendFile(path.join(state.draftPath, 'skills', 'demo', 'SKILL.md'), 'draft edit\n');
    await expect(
      fs.readFile(path.join(sourceRoot, 'skills', 'demo', 'SKILL.md'), 'utf8'),
    ).resolves.toBe(sourceBefore);
  });

  it('replaces state as complete JSON without leaving temporary files', async () => {
    const state = await createBundleDraft({
      projectRoot,
      name: 'atomic',
      candidates: [],
      defaultLocale: 'en',
      locales: ['en'],
      engineEnabled: false,
    });
    await writeBundleAuthoringState(projectRoot, {
      ...state,
      defaultLocale: 'zh',
      locales: ['zh', 'en'],
    });
    await writeBundleAuthoringState(projectRoot, {
      ...state,
      defaultLocale: 'en',
      locales: ['en'],
    });

    await expect(readBundleAuthoringState(projectRoot, 'atomic')).resolves.toMatchObject({
      defaultLocale: 'en',
      locales: ['en'],
    });
    expect(await fs.readdir(path.join(projectRoot, '.comet', 'bundle-authoring'))).toEqual([
      'atomic.json',
    ]);
  });

  it('invalidates Eval, review, and ready when the draft hash changes', async () => {
    const state = await preparedReadyState('draft-drift');
    await fs.appendFile(path.join(state.draftPath, 'skills', 'demo', 'SKILL.md'), 'changed\n');

    const reconciled = await reconcileBundleAuthoringState(projectRoot, state.name);

    expect(reconciled.status).toBe('draft');
    expect(reconciled.currentHash).not.toBe(state.currentHash);
    expect(reconciled.eval).toBeUndefined();
    expect(reconciled.review).toBeUndefined();
    expect(reconciled.ready).toBeUndefined();
    expect(reconciled.conflict).toBeUndefined();
  });

  it('demotes to the preserved draft when only the ready copy drifts', async () => {
    const state = await preparedReadyState('ready-drift');
    await fs.appendFile(path.join(state.ready!.path, 'skills', 'demo', 'SKILL.md'), 'changed\n');

    const reconciled = await reconcileBundleAuthoringState(projectRoot, state.name);

    expect(reconciled).toMatchObject({
      status: 'draft',
      currentHash: state.ready!.hash,
    });
    expect(reconciled.ready).toBeUndefined();
    await expect(fs.access(state.draftPath)).resolves.toBeUndefined();
    await expect(fs.access(state.ready!.path)).resolves.toBeUndefined();
  });

  it('records drift-conflict and preserves both copies when draft and ready both change', async () => {
    const state = await preparedReadyState('dual-drift');
    await fs.appendFile(
      path.join(state.draftPath, 'skills', 'demo', 'SKILL.md'),
      'draft changed\n',
    );
    await fs.appendFile(
      path.join(state.ready!.path, 'skills', 'demo', 'SKILL.md'),
      'ready changed\n',
    );

    const reconciled = await reconcileBundleAuthoringState(projectRoot, state.name);

    expect(reconciled).toMatchObject({
      status: 'drift-conflict',
      conflict: {
        draftHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        readyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(reconciled.conflict?.draftHash).not.toBe(reconciled.conflict?.readyHash);
    expect(reconciled.ready).toEqual(state.ready);
    await expect(
      fs.readFile(path.join(state.draftPath, 'skills', 'demo', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('draft changed');
    await expect(
      fs.readFile(path.join(state.ready!.path, 'skills', 'demo', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('ready changed');
  });

  it('records user proposal confirmation metadata during Factory initialization', async () => {
    await writeFactorySkill(projectRoot, 'task3-confirmed-brainstorming');
    const planFile = path.join(root, 'confirmed-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a confirmed Skill',
          preferredSkills: ['task3-confirmed-brainstorming'],
          workflow: workflowFor('confirmed-skill', ['task3-confirmed-brainstorming']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    const state = await initializeBundleFactoryState({
      projectRoot,
      name: 'confirmed-skill',
      filePath: planFile,
      confirmedProposal: true,
    });

    expect(state.factory?.proposalConfirmation).toMatchObject({
      confirmed: true,
      proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      acceptedCapabilities: ['skills', 'scripts', 'rules', 'hooks', 'references', 'agents'],
    });
    expect(state.factory?.proposalConfirmation?.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('rejects confirming a blocked Skill Creator proposal', async () => {
    const planFile = path.join(root, 'blocked-confirmed-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a blocked Skill',
          preferredSkills: ['task3-missing-skill'],
          workflow: workflowFor('blocked-confirmed-skill', ['task3-missing-skill']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    await expect(
      initializeBundleFactoryState({
        projectRoot,
        name: 'blocked-confirmed-skill',
        filePath: planFile,
        confirmedProposal: true,
      }),
    ).rejects.toThrow(/Cannot confirm blocked Skill Creator proposal/iu);
  });

  it('preserves the JSON parse cause when an authoring lane output is malformed', async () => {
    const malformed = path.join(root, 'malformed-authoring-output.json');
    await fs.writeFile(malformed, '{not json\n');

    let caught: unknown;
    try {
      await recordAuthoringLane({
        projectRoot,
        name: 'demo-bundle',
        lane: 'script',
        file: malformed,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('Authoring lane output is not valid JSON');
    expect((caught as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
  });

  async function preparedReadyState(name: string): Promise<BundleAuthoringState> {
    const sourceRoot = path.join(root, `${name}-source`);
    await writeBundle(sourceRoot, name);
    const state = await optimizeBundleDraft({
      projectRoot,
      name,
      sourceRoot,
      candidates: [],
      defaultLocale: 'en',
      locales: ['en', 'zh'],
      engineEnabled: false,
    });
    const readyPath = path.join(projectRoot, '.comet', 'bundles', name);
    await fs.mkdir(path.dirname(readyPath), { recursive: true });
    await fs.cp(state.draftPath, readyPath, { recursive: true });
    const ready: BundleAuthoringState = {
      ...state,
      status: 'ready',
      eval: {
        level: 'full',
        hash: state.currentHash!,
        resultPath: path.join(projectRoot, '.comet', 'bundle-evals', `${name}.json`),
        passed: true,
      },
      review: {
        hash: state.currentHash!,
        decision: 'approved',
        reviewer: 'user',
        at: '2026-06-15T00:00:00.000Z',
      },
      ready: {
        hash: state.currentHash!,
        path: readyPath,
        publishedAt: '2026-06-15T00:00:00.000Z',
      },
    };
    await writeBundleAuthoringState(projectRoot, ready);
    return ready;
  }
});
