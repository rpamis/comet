import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  bundleCandidatesCommand,
  bundleCompileCommand,
  bundleDistributeCommand,
  bundleDraftCreateCommand,
  bundleDraftOptimizeCommand,
  bundleEvalPlanCommand,
  bundleEvalRecordCommand,
  bundleFactoryGuideCommand,
  bundleFactoryInitCommand,
  bundleFactoryGenerateCommand,
  bundleFactoryProposeCommand,
  bundleFactoryResolveCommand,
  bundleListCommand,
  bundlePublishCommand,
  bundleReviewSummaryCommand,
  bundleReviewCommand,
  bundleStatusCommand,
} from '../../../app/commands/bundle.js';
import type { RepositoryEvalResult } from '../../../domains/bundle/eval.js';
import { workflowFor as workflowDefinitionFor } from '../../helpers/workflow-plan.js';
import { createBundleDraft } from '../../../domains/bundle/draft.js';
import { loadBundle } from '../../../domains/bundle/load.js';
import {
  readBundleAuthoringState,
  writeBundleAuthoringState,
} from '../../../domains/bundle/state.js';
import { normalizeWorkflowDefinition } from '../../../domains/workflow-contract/index.js';

async function writeBundle(
  root: string,
  options: { name: string; entries?: string[]; requiresHooks?: boolean },
): Promise<void> {
  const entries = options.entries ?? ['entry'];
  for (const entry of entries) {
    await fs.mkdir(path.join(root, 'skills', entry), { recursive: true });
    await fs.writeFile(
      path.join(root, 'skills', entry, 'SKILL.md'),
      `---\nname: ${entry}\ndescription: ${entry}.\n---\n\n# ${entry}\n`,
    );
  }
  await fs.writeFile(
    path.join(root, 'bundle.yaml'),
    `apiVersion: comet/v1alpha1
kind: SkillBundle
metadata:
  name: ${options.name}
  version: 1.0.0
  description: Command fixture
  defaultLocale: en
  locales: [en]
skills:
${entries
  .map(
    (entry) => `  - id: ${entry}
    path: skills/${entry}
    visibility: entry`,
  )
  .join('\n')}
resources:
  rules: []
  hooks:${
    options.requiresHooks
      ? `
    - id: protect-write
      path: hooks/protect-write.yaml`
      : ' []'
  }
  references: []
  scripts:${
    options.requiresHooks
      ? `
    - id: verify
      path: scripts/verify.mjs
      sideEffect: read
      runtime: node`
      : ' []'
  }
  assets: []
platforms:
  requires: [skills${options.requiresHooks ? ', hooks' : ''}]
  optional: []
  overrides: []
engine:
  enabled: false
`,
  );
  if (options.requiresHooks) {
    await fs.mkdir(path.join(root, 'hooks'), { recursive: true });
    await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'hooks', 'protect-write.yaml'),
      `event: before_write
matcher: Write|Edit
script: verify
failure: block
requiresConfirmation: false
`,
    );
    await fs.writeFile(path.join(root, 'scripts', 'verify.mjs'), 'process.exit(0);\n');
  }
}

async function writeFactorySkill(
  projectRoot: string,
  name: string,
  options: { description?: string; flow?: string } = {},
): Promise<string> {
  const skillRoot = path.join(projectRoot, '.comet', 'skills', name);
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(
    path.join(skillRoot, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${options.description ?? `${name}.`}\n---\n# ${name}\n`,
  );
  if (options.flow) {
    await fs.mkdir(path.join(skillRoot, 'comet'), { recursive: true });
    await fs.writeFile(path.join(skillRoot, 'comet', 'flow.yaml'), options.flow, 'utf8');
  }
  return skillRoot;
}

function workflowFor(name: string, skills: string[]): ReturnType<typeof workflowDefinitionFor> {
  return workflowDefinitionFor(name, skills);
}

function passingResult(hash: string, entries = ['entry']): RepositoryEvalResult {
  return {
    schemaVersion: 2,
    provider: 'comet-eval',
    level: 'quick',
    draftHash: hash,
    evalManifestHash: 'b'.repeat(64),
    tasks: ['generic-skill-smoke'],
    treatments: entries,
    passAtK: { '1': 1 },
    weightedScore: { overall: 1 },
    instabilityGap: { overall: 0 },
    failures: [],
    reports: ['eval-report.html'],
    passed: true,
    summary: 'Command gates passed.',
  };
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

async function canonicalTestPath(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function expectPathEquivalent(actual: unknown, expected: string): Promise<void> {
  expect(typeof actual).toBe('string');
  expect(await canonicalTestPath(actual as string)).toBe(await canonicalTestPath(expected));
}

async function captureJson(run: () => Promise<void>): Promise<Record<string, unknown>> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await run();
    return JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
  } finally {
    log.mockRestore();
  }
}

async function captureText(run: () => Promise<void>): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await run();
    return log.mock.calls.map((call) => call.join(' ')).join('\n');
  } finally {
    log.mockRestore();
  }
}

describe('bundle commands', () => {
  let root: string;
  let projectRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-bundle-command-'));
    projectRoot = path.join(root, 'project');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports candidates from project preferences', async () => {
    const skillRoot = path.join(projectRoot, '.claude', 'skills', 'demo');
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      `version: 1
prefer:
  - demo
  - missing
`,
    );
    await fs.writeFile(
      path.join(skillRoot, 'SKILL.md'),
      '---\nname: demo\ndescription: Demo skill.\n---\n# Demo\n',
    );

    const result = await captureJson(() =>
      bundleCandidatesCommand({ project: projectRoot, json: true }),
    );

    expect(result).toMatchObject({
      candidates: [
        { name: 'demo', status: 'available' },
        { name: 'missing', status: 'missing' },
      ],
    });

    const text = await captureText(() => bundleCandidatesCommand({ project: projectRoot }));
    expect(text).toContain('demo: available');
    expect(text).toContain('missing: missing');
  });

  it('prints the Factory first-use guide for /comet-any', async () => {
    await writeFactorySkill(projectRoot, 'brainstorming', {
      description: 'Explore intent before implementation.',
    });

    const result = await captureJson(() =>
      bundleFactoryGuideCommand({ project: projectRoot, json: true }),
    );

    expect(result).toMatchObject({
      schemaVersion: 1,
      preference: { state: 'missing' },
      userMessage: { title: 'Start with /comet-any' },
    });

    const text = await captureText(() => bundleFactoryGuideCommand({ project: projectRoot }));
    expect(text).toContain('Preference file: missing');
    expect(text).toContain('Next step:');
  });

  it('creates and optimizes drafts, then reports status', async () => {
    const source = path.join(root, 'source');
    await writeBundle(source, { name: 'optimized-bundle' });

    const created = await captureJson(() =>
      bundleDraftCreateCommand('created-bundle', { project: projectRoot, json: true }),
    );
    const optimized = await captureJson(() =>
      bundleDraftOptimizeCommand(source, { project: projectRoot, json: true }),
    );
    const status = await captureJson(() =>
      bundleStatusCommand('optimized-bundle', { project: projectRoot, json: true }),
    );

    expect(created).toMatchObject({ name: 'created-bundle', status: 'draft' });
    expect(optimized).toMatchObject({ name: 'optimized-bundle', status: 'draft' });
    expect(status).toMatchObject({
      name: 'optimized-bundle',
      status: 'draft',
      resumeSummary: {
        schemaVersion: 1,
        currentStep: 'needs-eval',
        recommendedNextStep: { action: 'choose-eval-level', category: 'eval' },
      },
    });
    expect(status.currentHash).toMatch(/^[a-f0-9]{64}$/u);
    const text = await captureText(() =>
      bundleStatusCommand('optimized-bundle', { project: projectRoot }),
    );
    expect(text).toContain('Current step: needs-eval');
    expect(text).toContain('User next step: Run repository eval for the generated Skill');
    expect(text).toContain('Suggested user command:');
    expect(text).toContain('Still missing:');
    expect(text).toContain('- Passing eval evidence for the current draft');
    expect(text).not.toContain('choose-benchmark-level');
    expect(text).not.toContain('needs-benchmark');
    expect(text).not.toContain('Run a benchmark');
    expect(text).not.toContain('Benchmark: missing');
    expect(text).not.toContain('benchmark-record');
    expect(text).not.toContain('benchmark-plan');
  });

  it('lists recoverable Bundle authoring states with next actions', async () => {
    const source = path.join(root, 'source');
    await writeBundle(source, { name: 'optimized-bundle' });

    await captureJson(() =>
      bundleDraftCreateCommand('created-bundle', { project: projectRoot, json: true }),
    );
    await captureJson(() =>
      bundleDraftOptimizeCommand(source, { project: projectRoot, json: true }),
    );

    const result = await captureJson(() => bundleListCommand({ project: projectRoot, json: true }));

    expect(result).toMatchObject({
      bundles: [
        expect.objectContaining({
          resumeSummary: expect.objectContaining({
            schemaVersion: 1,
            currentStep: 'needs-eval',
            recommendedNextStep: expect.objectContaining({
              userCommand: expect.stringContaining('comet eval '),
            }),
          }),
        }),
        expect.objectContaining({
          resumeSummary: expect.objectContaining({
            schemaVersion: 1,
          }),
        }),
      ],
    });

    const text = await captureText(() => bundleListCommand({ project: projectRoot }));
    expect(text).toContain('created-bundle: draft');
    expect(text).toContain('Next action: choose-eval-level');
    expect(text).toContain('Suggested user command:');
    expect(text).toContain('optimized-bundle: draft');
    expect(text).not.toContain('choose-benchmark-level');
    expect(text).not.toContain('needs-benchmark');
    expect(text).not.toContain('Run a benchmark');
    expect(text).not.toContain('Benchmark: missing');
    expect(text).not.toContain('benchmark-record');
  });

  it('initializes Skill Creator metadata from a structured plan file', async () => {
    const skillRoot = path.join(projectRoot, '.claude', 'skills', 'brainstorming');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      `version: 1
prefer:
  - brainstorming
  - writing-plans
`,
    );
    await fs.writeFile(
      path.join(skillRoot, 'SKILL.md'),
      '---\nname: brainstorming\ndescription: Brainstorming.\n---\n# Brainstorming\n',
    );
    const planFile = path.join(root, 'factory-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a review-oriented Comet-native Skill.',
          workflow: workflowFor('factory-bundle', [
            'brainstorming',
            'writing-plans',
            'requesting-code-review',
          ]),
          deviations: [
            {
              skill: 'requesting-code-review',
              expectedIndex: 2,
              actualIndex: 1,
              reason: 'Review should happen before final drafting for this workflow.',
            },
          ],
          engineMode: 'deterministic',
          runnerMode: 'standalone',
          defaultLocale: 'zh',
          locales: ['zh', 'en'],
        },
        null,
        2,
      ),
    );

    const initialized = await captureJson(() =>
      bundleFactoryInitCommand('factory-bundle', {
        project: projectRoot,
        file: planFile,
        json: true,
      }),
    );

    expect(initialized).toMatchObject({
      name: 'factory-bundle',
      status: 'draft',
      defaultLocale: 'zh',
      locales: ['zh', 'en'],
      factory: {
        preferredSkills: ['brainstorming', 'writing-plans', 'requesting-code-review'],
        callChain: expect.arrayContaining([
          { skill: 'requesting-code-review', preferenceIndex: 2 },
        ]),
        deviations: [
          {
            skill: 'requesting-code-review',
            expectedIndex: 2,
            actualIndex: 1,
            reason: 'Review should happen before final drafting for this workflow.',
          },
        ],
      },
    });
    expect(initialized.factory).toMatchObject({
      resolvedSkills: expect.arrayContaining([
        expect.objectContaining({ query: 'brainstorming', preferenceIndex: 0 }),
        expect.objectContaining({ query: 'writing-plans', preferenceIndex: 1 }),
        expect.objectContaining({ query: 'requesting-code-review', preferenceIndex: 2 }),
      ]),
      planPath: path.join(
        projectRoot,
        '.comet',
        'bundle-factory-plans',
        'factory-bundle',
        'plan.json',
      ),
      planHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    await expect(
      fs.readFile(
        path.join(projectRoot, '.comet', 'bundle-factory-plans', 'factory-bundle', 'plan.json'),
        'utf8',
      ),
    ).resolves.toContain('"schemaVersion": 1');
  });
  it('persists project Skill preference metadata in Skill Creator state', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      `version: 1
mode: strict
prefer:
  - factory-alpha
require:
  - factory-beta
policies:
  missing: fail
  ambiguous: ask
  deviation: fail
  scripts: disclose
  hooks: disclose
`,
    );
    await writeFactorySkill(projectRoot, 'factory-alpha');
    await writeFactorySkill(projectRoot, 'factory-beta');
    const planFile = path.join(root, 'factory-preference-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a preference-backed workflow.',
          workflow: workflowFor('preference-backed-factory', ['factory-alpha']),
        },
        null,
        2,
      ),
    );

    await bundleFactoryInitCommand('preference-backed-factory', {
      project: projectRoot,
      file: planFile,
      json: true,
    });

    const state = await readBundleAuthoringState(projectRoot, 'preference-backed-factory');
    expect(state.factory).toMatchObject({
      preferredSkills: ['factory-alpha', 'factory-beta'],
      requiredSkills: ['factory-beta'],
      preferenceMode: 'strict',
      preferencePolicies: {
        missing: 'fail',
        ambiguous: 'ask',
        deviation: 'fail',
        scripts: 'disclose',
        hooks: 'disclose',
      },
      preferencePath: path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      preferenceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('blocks Factory init when preferences deny generated scripts or hooks', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      `version: 1
mode: strict
prefer:
  - factory-alpha
policies:
  scripts: deny
  hooks: disclose
`,
    );
    await writeFactorySkill(projectRoot, 'factory-alpha');
    const planFile = path.join(root, 'factory-deny-scripts-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a denied workflow.',
          workflow: workflowFor('deny-scripts-factory', ['factory-alpha']),
        },
        null,
        2,
      ),
    );

    await expect(
      bundleFactoryInitCommand('deny-scripts-factory', {
        project: projectRoot,
        file: planFile,
        json: true,
      }),
    ).rejects.toThrow(/preference policy denies scripts/iu);
  });

  it('builds a Skill Creator proposal without writing Bundle authoring state', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      `version: 1
mode: advisory
prefer:
  - factory-alpha
`,
    );
    await writeFactorySkill(projectRoot, 'factory-alpha');
    const planFile = path.join(root, 'factory-proposal-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a proposal first.',
          workflow: workflowFor('proposal-factory', ['factory-alpha']),
        },
        null,
        2,
      ),
    );

    const proposal = await captureJson(() =>
      bundleFactoryProposeCommand('proposal-factory', {
        project: projectRoot,
        file: planFile,
        json: true,
      }),
    );

    expect(proposal).toMatchObject({
      name: 'proposal-factory',
      goal: 'Create a proposal first.',
      preference: {
        mode: 'advisory',
        source: path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      },
      callChain: [{ skill: 'factory-alpha', preferenceIndex: 0 }],
      resolvedSkills: [{ query: 'factory-alpha', status: 'available' }],
      canGenerate: true,
    });
    await expect(readBundleAuthoringState(projectRoot, 'proposal-factory')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('prints a user-decision Skill Creator proposal before initialization', async () => {
    await writeFactorySkill(projectRoot, 'task3-guided-brainstorming', {
      description: 'Explore intent before implementation.',
    });
    const planFile = path.join(root, 'factory-decision-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a guided planning Skill',
          preferredSkills: ['task3-guided-brainstorming'],
          workflow: workflowFor('guided-planning', ['task3-guided-brainstorming']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    const proposal = await captureJson(() =>
      bundleFactoryProposeCommand('guided-planning', {
        project: projectRoot,
        file: planFile,
        json: true,
      }),
    );

    expect(proposal).toMatchObject({
      schemaVersion: 1,
      name: 'guided-planning',
      canGenerate: true,
      userSummary: {
        title: 'Create guided-planning as a Comet-native Skill',
        generatedControlPlane: expect.arrayContaining([
          'SKILL.md',
          'scripts/',
          'rules/',
          'hooks/',
          'comet/checks.yaml',
          'comet/eval.yaml',
        ]),
        requiredConfirmations: expect.arrayContaining([
          expect.objectContaining({ id: 'generate-scripts' }),
          expect.objectContaining({ id: 'generate-hooks' }),
        ]),
      },
      actions: expect.arrayContaining([
        expect.objectContaining({ id: 'confirm-generate' }),
        expect.objectContaining({ id: 'revise-proposal' }),
        expect.objectContaining({ id: 'cancel' }),
      ]),
      proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });

    const text = await captureText(() =>
      bundleFactoryProposeCommand('guided-planning', {
        project: projectRoot,
        file: planFile,
      }),
    );
    expect(text).toContain('Will reuse Skills:');
    expect(text).toContain('Will generate:');
    expect(text).toContain('Validate:');
    expect(text).toContain('Install/enable:');
    expect(text).toContain('Actions:');
  });
  it('does not offer confirm-generate on blocked Skill Creator proposals', async () => {
    const planFile = path.join(root, 'factory-blocked-proposal-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a blocked proposal.',
          preferredSkills: ['missing-factory-skill'],
          workflow: workflowFor('blocked-proposal-factory', ['missing-factory-skill']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    const proposal = await captureJson(() =>
      bundleFactoryProposeCommand('blocked-proposal-factory', {
        project: projectRoot,
        file: planFile,
        json: true,
      }),
    );

    expect(proposal).toMatchObject({
      canGenerate: false,
      actions: expect.arrayContaining([
        expect.objectContaining({ id: 'revise-proposal' }),
        expect.objectContaining({ id: 'cancel' }),
      ]),
    });
    expect(proposal.actions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'confirm-generate' })]),
    );
  });

  it('records confirmation metadata through the factory-init command', async () => {
    await writeFactorySkill(projectRoot, 'task3-command-confirmed', {
      description: 'Command confirmation test skill.',
    });
    const planFile = path.join(root, 'factory-init-confirmed-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a command-confirmed Skill',
          preferredSkills: ['task3-command-confirmed'],
          workflow: workflowFor('command-confirmed-skill', ['task3-command-confirmed']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    const initialized = await captureJson(() =>
      bundleFactoryInitCommand('command-confirmed-skill', {
        project: projectRoot,
        file: planFile,
        confirmedProposal: true,
        json: true,
      }),
    );

    expect(initialized).toMatchObject({
      factory: {
        proposalConfirmation: {
          confirmed: true,
          proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      },
    });

    const state = await readBundleAuthoringState(projectRoot, 'command-confirmed-skill');
    expect(state.factory?.proposalConfirmation).toMatchObject({
      confirmed: true,
      proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });
  it('invalidates proposal confirmation after factory-resolve and points status at reconfirmation', async () => {
    const skillRoot = await writeFactorySkill(projectRoot, 'task3-resolve-after-confirm', {
      description: 'Resolve after confirm test skill.',
    });
    const planFile = path.join(root, 'factory-resolve-after-confirm-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a Skill that will be resolved after confirmation',
          preferredSkills: ['task3-resolve-after-confirm'],
          workflow: workflowFor('resolve-after-confirm-skill', ['task3-resolve-after-confirm']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    await bundleFactoryInitCommand('resolve-after-confirm-skill', {
      project: projectRoot,
      file: planFile,
      confirmedProposal: true,
      json: true,
    });

    const resolved = await captureJson(() =>
      bundleFactoryResolveCommand('resolve-after-confirm-skill', {
        project: projectRoot,
        candidate: 'task3-resolve-after-confirm',
        source: skillRoot,
        json: true,
      }),
    );

    expect(resolved.factory).not.toHaveProperty('proposalConfirmation');
    const status = await captureJson(() =>
      bundleStatusCommand('resolve-after-confirm-skill', { project: projectRoot, json: true }),
    );
    expect(status).toMatchObject({
      nextAction: {
        action: 'confirm-proposal',
        backendCommand: expect.stringContaining('--confirmed-proposal'),
      },
    });
    await expect(
      bundleFactoryGenerateCommand('resolve-after-confirm-skill', {
        project: projectRoot,
        json: true,
      }),
    ).rejects.toThrow(/Skill Creator proposal confirmation/iu);
  });

  it('resolves factory sources selected through a physical path alias', async () => {
    const skillRoot = await writeFactorySkill(projectRoot, 'task3-resolve-aliased-source', {
      description: 'Aliased source selection test skill.',
    });
    const aliasedProjectRoot = path.join(root, 'project-alias');
    await fs.symlink(
      projectRoot,
      aliasedProjectRoot,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const aliasedSkillRoot = path.join(aliasedProjectRoot, path.relative(projectRoot, skillRoot));
    const planFile = path.join(root, 'factory-resolve-aliased-source-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a Skill resolved through an aliased source path',
          preferredSkills: ['task3-resolve-aliased-source'],
          workflow: workflowFor('resolve-aliased-source-skill', ['task3-resolve-aliased-source']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    await bundleFactoryInitCommand('resolve-aliased-source-skill', {
      project: projectRoot,
      file: planFile,
      json: true,
    });

    const resolved = await captureJson(() =>
      bundleFactoryResolveCommand('resolve-aliased-source-skill', {
        project: projectRoot,
        candidate: 'task3-resolve-aliased-source',
        source: aliasedSkillRoot,
        json: true,
      }),
    );

    expect(resolved).toMatchObject({
      factory: {
        resolvedSkills: [
          {
            query: 'task3-resolve-aliased-source',
            status: 'available',
            sources: [expect.objectContaining({ name: 'task3-resolve-aliased-source' })],
          },
        ],
      },
    });
    await expectPathEquivalent(resolved.factory.resolvedSkills[0].sources[0].root, skillRoot);
  });

  it('blocks Factory generation until the user confirms the proposal', async () => {
    await writeFactorySkill(projectRoot, 'task3-unconfirmed-generate', {
      description: 'Unconfirmed generation test skill.',
    });
    const planFile = path.join(root, 'factory-init-unconfirmed-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create an unconfirmed Skill',
          preferredSkills: ['task3-unconfirmed-generate'],
          workflow: workflowFor('unconfirmed-generate-skill', ['task3-unconfirmed-generate']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    await bundleFactoryInitCommand('unconfirmed-generate-skill', {
      project: projectRoot,
      file: planFile,
      json: true,
    });

    await expect(
      bundleFactoryGenerateCommand('unconfirmed-generate-skill', {
        project: projectRoot,
        json: true,
      }),
    ).rejects.toThrow(/Skill Creator proposal confirmation/iu);
  });

  it('rejects confirming a resolved Skill Creator state with a different plan', async () => {
    await writeFactorySkill(projectRoot, 'task3-plan-match-alpha', {
      description: 'Plan match test skill.',
    });
    const originalPlan = path.join(root, 'factory-plan-match-original.json');
    await fs.writeFile(
      originalPlan,
      JSON.stringify(
        {
          goal: 'Create the original Skill',
          preferredSkills: ['task3-plan-match-alpha'],
          workflow: workflowFor('plan-match-skill', ['task3-plan-match-alpha']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );
    await bundleFactoryInitCommand('plan-match-skill', {
      project: projectRoot,
      file: originalPlan,
      confirmedProposal: true,
      json: true,
    });

    const blockedPlan = path.join(root, 'factory-plan-match-blocked.json');
    await fs.writeFile(
      blockedPlan,
      JSON.stringify(
        {
          goal: 'Create a different blocked Skill',
          preferredSkills: ['task3-plan-match-missing'],
          workflow: workflowFor('plan-match-skill', ['task3-plan-match-missing']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    await expect(
      bundleFactoryInitCommand('plan-match-skill', {
        project: projectRoot,
        file: blockedPlan,
        confirmedProposal: true,
        json: true,
      }),
    ).rejects.toThrow(/does not match current Skill Creator plan/iu);
  });

  it('blocks publishing legacy Skill Creator states that lack proposal confirmation', async () => {
    await writeFactorySkill(projectRoot, 'task3-unconfirmed-publish', {
      description: 'Unconfirmed publish test skill.',
    });
    const planFile = path.join(root, 'factory-init-publish-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a publish-gated Skill',
          preferredSkills: ['task3-unconfirmed-publish'],
          workflow: workflowFor('unconfirmed-publish-skill', ['task3-unconfirmed-publish']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    await bundleFactoryInitCommand('unconfirmed-publish-skill', {
      project: projectRoot,
      file: planFile,
      confirmedProposal: true,
      json: true,
    });
    await bundleFactoryGenerateCommand('unconfirmed-publish-skill', {
      project: projectRoot,
      json: true,
    });
    const status = await captureJson(() =>
      bundleStatusCommand('unconfirmed-publish-skill', { project: projectRoot, json: true }),
    );
    const resultFile = path.join(root, 'unconfirmed-publish-eval.json');
    const evalManifestPath =
      (status.factory as { generatedSkillPackage?: { evalManifestPath?: string } } | undefined)
        ?.generatedSkillPackage?.evalManifestPath ?? null;
    const evalManifestHash = evalManifestPath
      ? sha256(await fs.readFile(evalManifestPath))
      : 'b'.repeat(64);
    await fs.writeFile(
      resultFile,
      JSON.stringify({
        ...passingResult(String(status.currentHash), ['unconfirmed-publish-skill']),
        evalManifestHash,
      }),
    );
    await bundleEvalRecordCommand('unconfirmed-publish-skill', {
      project: projectRoot,
      result: resultFile,
    });
    await bundleReviewCommand('unconfirmed-publish-skill', {
      project: projectRoot,
      approve: true,
      reviewer: 'alice',
    });

    const state = await readBundleAuthoringState(projectRoot, 'unconfirmed-publish-skill');
    const legacy = { ...state, factory: { ...state.factory! } };
    delete legacy.factory.proposalConfirmation;
    await writeBundleAuthoringState(projectRoot, legacy);

    await expect(
      bundlePublishCommand('unconfirmed-publish-skill', {
        project: projectRoot,
        platform: 'claude',
      }),
    ).rejects.toThrow(/Skill Creator proposal confirmation/iu);
  });

  it('blocks reviewing legacy Skill Creator states that lack proposal confirmation', async () => {
    await writeFactorySkill(projectRoot, 'task3-unconfirmed-review', {
      description: 'Unconfirmed review test skill.',
    });
    const planFile = path.join(root, 'factory-init-review-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a review-gated Skill',
          preferredSkills: ['task3-unconfirmed-review'],
          workflow: workflowFor('unconfirmed-review-skill', ['task3-unconfirmed-review']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
        },
        null,
        2,
      ),
    );

    await bundleFactoryInitCommand('unconfirmed-review-skill', {
      project: projectRoot,
      file: planFile,
      confirmedProposal: true,
      json: true,
    });
    await bundleFactoryGenerateCommand('unconfirmed-review-skill', {
      project: projectRoot,
      json: true,
    });
    const status = await captureJson(() =>
      bundleStatusCommand('unconfirmed-review-skill', { project: projectRoot, json: true }),
    );
    const resultFile = path.join(root, 'unconfirmed-review-eval.json');
    await fs.writeFile(
      resultFile,
      JSON.stringify(passingResult(String(status.currentHash), ['unconfirmed-review-skill'])),
    );
    await bundleEvalRecordCommand('unconfirmed-review-skill', {
      project: projectRoot,
      result: resultFile,
    });

    const state = await readBundleAuthoringState(projectRoot, 'unconfirmed-review-skill');
    const legacy = { ...state, factory: { ...state.factory! } };
    delete legacy.factory.proposalConfirmation;
    await writeBundleAuthoringState(projectRoot, legacy);

    await expect(
      bundleReviewCommand('unconfirmed-review-skill', {
        project: projectRoot,
        approve: true,
        reviewer: 'alice',
      }),
    ).rejects.toThrow(/Skill Creator proposal confirmation/iu);
  });

  it('stores composed flow metadata and uses it as the factory call chain', async () => {
    await writeFactorySkill(projectRoot, 'task3-review-flow', {
      description: 'Review flow.',
      flow: `steps:
  - use: task3-brainstorming
  - use: task3-writing-plans
`,
    });
    await writeFactorySkill(projectRoot, 'task3-brainstorming', {
      description: 'Explore the goal.',
    });
    await writeFactorySkill(projectRoot, 'task3-writing-plans', {
      description: 'Write the plan.',
    });
    const planFile = path.join(root, 'factory-composed-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a composed review workflow.',
          preferredSkills: ['task3-review-flow', 'task3-brainstorming', 'task3-writing-plans'],
          workflow: workflowFor('composed-factory', ['task3-review-flow']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
          defaultLocale: 'zh',
          locales: ['zh', 'en'],
        },
        null,
        2,
      ),
    );

    const initialized = await captureJson(() =>
      bundleFactoryInitCommand('composed-factory', {
        project: projectRoot,
        file: planFile,
        json: true,
      }),
    );

    expect(initialized).toMatchObject({
      factory: {
        callChain: [
          { skill: 'task3-brainstorming', preferenceIndex: 1 },
          { skill: 'task3-writing-plans', preferenceIndex: 2 },
        ],
        composition: {
          schemaVersion: 1,
          entrySkills: ['task3-review-flow'],
          issues: [],
        },
      },
    });
  });

  it('uses plan call-chain entries for atomic composition when preferred order differs', async () => {
    await writeFactorySkill(projectRoot, 'task3-atomic-first', {
      description: 'First atomic step.',
    });
    await writeFactorySkill(projectRoot, 'task3-atomic-second', {
      description: 'Second atomic step.',
    });
    const planFile = path.join(root, 'factory-atomic-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create an atomic-only workflow.',
          preferredSkills: ['task3-atomic-first', 'task3-atomic-second'],
          workflow: workflowFor('atomic-composed-factory', [
            'task3-atomic-second',
            'task3-atomic-first',
          ]),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
          defaultLocale: 'zh',
          locales: ['zh', 'en'],
        },
        null,
        2,
      ),
    );

    const initialized = await captureJson(() =>
      bundleFactoryInitCommand('atomic-composed-factory', {
        project: projectRoot,
        file: planFile,
        json: true,
      }),
    );

    expect(initialized).toMatchObject({
      factory: {
        callChain: [
          { skill: 'task3-atomic-second', preferenceIndex: 1 },
          { skill: 'task3-atomic-first', preferenceIndex: 0 },
        ],
        composition: {
          schemaVersion: 1,
          entrySkills: ['task3-atomic-second', 'task3-atomic-first'],
          issues: [],
        },
      },
    });
  });

  it('recomputes post-resolve composition from the original plan entry flow', async () => {
    await writeFactorySkill(projectRoot, 'task3-entry-review-flow', {
      description: 'Review flow entry.',
      flow: `steps:
  - use: task3-entry-brainstorming
  - use: task3-entry-writing-plans
`,
    });
    const selectedBrainstormingRoot = await writeFactorySkill(
      projectRoot,
      'task3-entry-brainstorming',
      {
        description: 'Selected brainstorming.',
      },
    );
    const alternateBrainstormingRoot = path.join(
      projectRoot,
      '.claude',
      'skills',
      'task3-entry-brainstorming',
    );
    await fs.mkdir(alternateBrainstormingRoot, { recursive: true });
    await fs.writeFile(
      path.join(alternateBrainstormingRoot, 'SKILL.md'),
      '---\nname: task3-entry-brainstorming\ndescription: Alternate brainstorming.\n---\n# task3-entry-brainstorming\n',
    );
    await writeFactorySkill(projectRoot, 'task3-entry-writing-plans', {
      description: 'Write the plan.',
    });
    const planFile = path.join(root, 'factory-recompute-entry-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a resolved entry workflow.',
          preferredSkills: [
            'task3-entry-review-flow',
            'task3-entry-brainstorming',
            'task3-entry-writing-plans',
          ],
          workflow: workflowFor('recomputed-entry-factory', ['task3-entry-review-flow']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
          defaultLocale: 'zh',
          locales: ['zh', 'en'],
        },
        null,
        2,
      ),
    );

    const initialized = await captureJson(() =>
      bundleFactoryInitCommand('recomputed-entry-factory', {
        project: projectRoot,
        file: planFile,
        json: true,
      }),
    );

    expect(initialized).toMatchObject({
      factory: {
        compositionEntrySkills: ['task3-entry-review-flow'],
        callChain: [{ skill: 'task3-entry-writing-plans', preferenceIndex: 2 }],
        composition: {
          entrySkills: ['task3-entry-review-flow'],
          issues: [
            expect.objectContaining({
              type: 'unavailable-use',
              fromSkill: 'task3-entry-review-flow',
              skill: 'task3-entry-brainstorming',
            }),
          ],
        },
        resolvedSkills: [
          { query: 'task3-entry-review-flow', status: 'available' },
          { query: 'task3-entry-brainstorming', status: 'ambiguous' },
          { query: 'task3-entry-writing-plans', status: 'available' },
        ],
      },
    });

    const resolved = await captureJson(() =>
      bundleFactoryResolveCommand('recomputed-entry-factory', {
        project: projectRoot,
        candidate: 'task3-entry-brainstorming',
        source: selectedBrainstormingRoot,
        json: true,
      }),
    );

    expect(resolved).toMatchObject({
      factory: {
        compositionEntrySkills: ['task3-entry-review-flow'],
        resolvedSkills: [
          { query: 'task3-entry-review-flow', status: 'available' },
          {
            query: 'task3-entry-brainstorming',
            status: 'available',
            sources: [expect.objectContaining({ name: 'task3-entry-brainstorming' })],
          },
          { query: 'task3-entry-writing-plans', status: 'available' },
        ],
      },
    });
    await expectPathEquivalent(
      resolved.factory.resolvedSkills[1].sources[0].root,
      selectedBrainstormingRoot,
    );
    expect(resolved.factory).not.toHaveProperty('composition');

    await bundleFactoryInitCommand('recomputed-entry-factory', {
      project: projectRoot,
      file: planFile,
      confirmedProposal: true,
      json: true,
    });

    const generated = await captureJson(() =>
      bundleFactoryGenerateCommand('recomputed-entry-factory', {
        project: projectRoot,
        json: true,
      }),
    );

    expect(generated).toMatchObject({
      factory: {
        compositionEntrySkills: ['task3-entry-review-flow'],
        callChain: [
          { skill: 'task3-entry-brainstorming', preferenceIndex: 1 },
          { skill: 'task3-entry-writing-plans', preferenceIndex: 2 },
        ],
        composition: {
          entrySkills: ['task3-entry-review-flow'],
          issues: [],
        },
        generatedSkillPackage: {
          entrySkill: 'recomputed-entry-factory',
        },
      },
    });
    await expect(
      fs.readFile(
        path.join(
          projectRoot,
          '.comet',
          'bundle-drafts',
          'recomputed-entry-factory',
          'skills',
          'recomputed-entry-factory',
          'comet',
          'skill.yaml',
        ),
        'utf8',
      ),
    ).resolves.toContain('recomputed-entry-factory-task3-entry-review-flow');
    await expect(
      fs.readFile(
        path.join(
          projectRoot,
          '.comet',
          'bundle-drafts',
          'recomputed-entry-factory',
          'skills',
          'recomputed-entry-factory',
          'reference',
          'composition-report.md',
        ),
        'utf8',
      ),
    ).resolves.toMatch(/task3-entry-brainstorming[\s\S]*task3-entry-writing-plans/u);
  });

  it('generates a draft bundle source from stored Skill Creator metadata', async () => {
    const workflow = normalizeWorkflowDefinition(workflowFor('factory-bundle', ['brainstorming']));
    await createBundleDraft({
      projectRoot,
      name: 'factory-bundle',
      candidates: [
        {
          name: 'brainstorming',
          preferenceIndex: 0,
          platform: 'codex',
          scope: 'project',
          origin: 'project',
          factory: { query: 'brainstorming' },
          root: path.join(projectRoot, '.codex', 'skills', 'brainstorming'),
          description: 'Explore intent.',
          skillMd: '# Brainstorming\n',
          hash: 'a'.repeat(64),
        },
      ],
      defaultLocale: 'zh',
      locales: ['zh', 'en'],
      engineEnabled: true,
      factory: {
        goal: 'Create a review-oriented Comet-native Skill.',
        preferredSkills: ['brainstorming', 'writing-plans'],
        requiredSkills: ['verification-before-completion'],
        preferenceMode: 'strict',
        preferencePolicies: {
          missing: 'fail',
          ambiguous: 'ask',
          deviation: 'fail',
          scripts: 'disclose',
          hooks: 'disclose',
        },
        preferencePath: path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
        preferenceHash: 'c'.repeat(64),
        preferenceWarnings: [],
        resolvedSkills: [
          {
            query: 'brainstorming',
            preferenceIndex: 0,
            status: 'available',
            sources: [
              {
                name: 'brainstorming',
                preferenceIndex: 0,
                platform: 'codex',
                scope: 'project',
                origin: 'project',
                factory: { query: 'brainstorming' },
                root: path.join(projectRoot, '.codex', 'skills', 'brainstorming'),
                description: 'Explore intent.',
                skillMd: '# Brainstorming\n',
                hash: 'a'.repeat(64),
              },
            ],
          },
        ],
        callChain: [
          { skill: 'brainstorming', preferenceIndex: 0 },
          { skill: 'writing-plans', preferenceIndex: 1 },
        ],
        workflowDefinition: workflow.input,
        workflowProtocol: workflow.protocol,
        deviations: [],
        engineMode: 'deterministic',
        runnerMode: 'standalone',
        proposalConfirmation: {
          confirmed: true,
          confirmedAt: new Date().toISOString(),
          proposalHash: 'd'.repeat(64),
          preferenceHash: 'c'.repeat(64),
          acceptedCapabilities: ['skills', 'scripts', 'rules', 'hooks', 'references'],
          warnings: [],
        },
      },
    });

    const generated = await captureJson(() =>
      bundleFactoryGenerateCommand('factory-bundle', { project: projectRoot, json: true }),
    );
    const compiled = await captureJson(() =>
      bundleCompileCommand('factory-bundle', {
        project: projectRoot,
        platform: 'claude',
        json: true,
      }),
    );

    expect(generated).toMatchObject({
      name: 'factory-bundle',
      status: 'draft',
      factory: {
        generatedSkillPackage: {
          entrySkill: 'factory-bundle',
          internalSkills: ['factory-bundle-brainstorming'],
          controlPlane: {
            checksPath: path.join(
              projectRoot,
              '.comet',
              'bundle-drafts',
              'factory-bundle',
              'skills',
              'factory-bundle',
              'comet',
              'checks.yaml',
            ),
            evalManifestPath: path.join(
              projectRoot,
              '.comet',
              'bundle-drafts',
              'factory-bundle',
              'skills',
              'factory-bundle',
              'comet',
              'eval.yaml',
            ),
            compositionReportPath: path.join(
              projectRoot,
              '.comet',
              'bundle-drafts',
              'factory-bundle',
              'skills',
              'factory-bundle',
              'reference',
              'composition-report.md',
            ),
            scripts: [
              path.join(
                projectRoot,
                '.comet',
                'bundle-drafts',
                'factory-bundle',
                'skills',
                'factory-bundle',
                'scripts',
                'comet-plan.mjs',
              ),
              path.join(
                projectRoot,
                '.comet',
                'bundle-drafts',
                'factory-bundle',
                'skills',
                'factory-bundle',
                'scripts',
                'comet-check.mjs',
              ),
              path.join(
                projectRoot,
                '.comet',
                'bundle-drafts',
                'factory-bundle',
                'skills',
                'factory-bundle',
                'scripts',
                'comet-hook-guard.mjs',
              ),
              path.join(
                projectRoot,
                '.comet',
                'bundle-drafts',
                'factory-bundle',
                'skills',
                'factory-bundle',
                'scripts',
                'workflow-state.mjs',
              ),
              path.join(
                projectRoot,
                '.comet',
                'bundle-drafts',
                'factory-bundle',
                'skills',
                'factory-bundle',
                'scripts',
                'workflow-guard.mjs',
              ),
              path.join(
                projectRoot,
                '.comet',
                'bundle-drafts',
                'factory-bundle',
                'skills',
                'factory-bundle',
                'scripts',
                'workflow-handoff.mjs',
              ),
            ],
          },
        },
      },
    });
    expect(compiled).toMatchObject({
      platform: 'claude',
      entrySkills: ['factory-bundle'],
    });
    const draftRoot = path.join(projectRoot, '.comet', 'bundle-drafts', 'factory-bundle');
    const bundleYaml = await fs.readFile(path.join(draftRoot, 'bundle.yaml'), 'utf8');
    expect(bundleYaml).toContain('name: factory-bundle');
    expect(bundleYaml).toContain('rules:');
    expect(bundleYaml).toContain('hooks:');
    expect(bundleYaml).toContain('references:');
    expect(bundleYaml).toContain('scripts:');
    const bundle = await loadBundle(draftRoot);
    expect(bundle.manifest.platforms.requires).toEqual([
      'skills',
      'scripts',
      'rules',
      'hooks',
      'references',
      'agents',
    ]);
    expect(bundle.manifest.resources.rules).toEqual([
      {
        id: 'factory-bundle-orchestration',
        path: 'rules/factory-bundle-orchestration.md',
        mode: 'always',
        required: true,
      },
    ]);
    expect(bundle.manifest.resources.hooks).toEqual([
      {
        id: 'factory-bundle-before-write-guard',
        path: 'hooks/factory-bundle-before-write-guard.yaml',
      },
      {
        id: 'factory-bundle-before-tool-guard',
        path: 'hooks/factory-bundle-before-tool-guard.yaml',
      },
    ]);
    expect(bundle.manifest.resources.references).toEqual([
      'skills/factory-bundle/reference/resolved-skills.json',
      'skills/factory-bundle/reference/workflow-protocol.json',
      'skills/factory-bundle/reference/decision-points.md',
      'skills/factory-bundle/reference/recovery.md',
      'skills/factory-bundle/reference/authoring-lanes.json',
      'skills/factory-bundle/reference/skill-review.md',
      'skills/factory-bundle/reference/composition-report.md',
      'skills/factory-bundle/reference/subagents/script-author.md',
    ]);
    expect(bundle.manifest.resources.scripts).toEqual([
      {
        id: 'comet-plan',
        path: 'skills/factory-bundle/scripts/comet-plan.mjs',
        sideEffect: 'write',
        runtime: 'node',
      },
      {
        id: 'comet-check',
        path: 'skills/factory-bundle/scripts/comet-check.mjs',
        sideEffect: 'read',
        runtime: 'node',
      },
      {
        id: 'comet-hook-guard',
        path: 'skills/factory-bundle/scripts/comet-hook-guard.mjs',
        sideEffect: 'read',
        runtime: 'node',
      },
      {
        id: 'workflow-state',
        path: 'skills/factory-bundle/scripts/workflow-state.mjs',
        sideEffect: 'write',
        runtime: 'node',
      },
      {
        id: 'workflow-guard',
        path: 'skills/factory-bundle/scripts/workflow-guard.mjs',
        sideEffect: 'read',
        runtime: 'node',
      },
      {
        id: 'workflow-handoff',
        path: 'skills/factory-bundle/scripts/workflow-handoff.mjs',
        sideEffect: 'read',
        runtime: 'node',
      },
    ]);
    expect(bundle.manifest.resources.agents).toEqual([
      {
        id: 'comet-any-script-author',
        path: 'skills/factory-bundle/agents/claude/comet-any-script-author.md',
        platform: 'claude',
        required: true,
      },
    ]);
    await expect(
      fs.access(path.join(draftRoot, 'rules', 'factory-bundle-orchestration.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(draftRoot, 'hooks', 'factory-bundle-before-write-guard.yaml')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(draftRoot, 'hooks', 'factory-bundle-before-tool-guard.yaml')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(draftRoot, 'skills', 'factory-bundle', 'reference', 'composition-report.md'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(draftRoot, 'skills', 'factory-bundle', 'reference', 'authoring-lanes.json'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          draftRoot,
          'skills',
          'factory-bundle',
          'agents',
          'claude',
          'comet-any-script-author.md',
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fs.readFile(
        path.join(draftRoot, 'skills', 'factory-bundle', 'reference', 'skill-review.md'),
        'utf8',
      ),
    ).resolves.toContain('deterministic-check-only');
    await expect(
      fs.access(path.join(draftRoot, 'skills', 'factory-bundle', 'scripts', 'comet-plan.mjs')),
    ).resolves.toBeUndefined();
    await expect(
      fs.readFile(path.join(draftRoot, 'skills', 'factory-bundle', 'comet', 'skill.yaml'), 'utf8'),
    ).resolves.toContain('kind: Skill');
    const resolvedEvidence = JSON.parse(
      await fs.readFile(
        path.join(draftRoot, 'skills', 'factory-bundle', 'reference', 'resolved-skills.json'),
        'utf8',
      ),
    ) as unknown;
    expect(resolvedEvidence).toMatchObject({
      preference: {
        mode: 'strict',
        requiredSkills: ['verification-before-completion'],
        sourceHash: 'c'.repeat(64),
      },
    });
    await expect(
      fs.readFile(
        path.join(draftRoot, 'skills', 'factory-bundle', 'reference', 'composition-report.md'),
        'utf8',
      ),
    ).resolves.toContain('Preference mode: strict');
  });

  it('blocks factory generation when candidates still need user resolution', async () => {
    await createBundleDraft({
      projectRoot,
      name: 'blocked-factory',
      candidates: [],
      defaultLocale: 'zh',
      locales: ['zh', 'en'],
      engineEnabled: true,
      factory: {
        goal: 'Create a workflow that still has unresolved candidates.',
        preferredSkills: ['ambiguous-skill', 'missing-skill'],
        resolvedSkills: [
          {
            query: 'ambiguous-skill',
            preferenceIndex: 0,
            status: 'ambiguous',
            sources: [
              {
                name: 'ambiguous-skill',
                preferenceIndex: 0,
                platform: 'codex',
                scope: 'project',
                origin: 'project',
                factory: { query: 'ambiguous-skill' },
                root: path.join(projectRoot, '.codex', 'skills', 'ambiguous-skill'),
                description: 'First candidate.',
                skillMd: '# Ambiguous\n',
                hash: 'a'.repeat(64),
              },
              {
                name: 'ambiguous-skill',
                preferenceIndex: 0,
                platform: 'agents',
                scope: 'global',
                origin: 'global',
                factory: { query: 'ambiguous-skill' },
                root: path.join(root, 'global', 'ambiguous-skill'),
                description: 'Second candidate.',
                skillMd: '# Ambiguous\n',
                hash: 'b'.repeat(64),
              },
            ],
          },
          {
            query: 'missing-skill',
            preferenceIndex: 1,
            status: 'missing',
            sources: [],
          },
        ],
        callChain: [{ skill: 'ambiguous-skill', preferenceIndex: 0 }],
        deviations: [],
        engineMode: 'deterministic',
        runnerMode: 'standalone',
      },
    });

    await expect(
      bundleFactoryGenerateCommand('blocked-factory', { project: projectRoot, json: true }),
    ).rejects.toThrow(/ambiguous-skill.*missing-skill|missing-skill.*ambiguous-skill/iu);
  });

  it('blocks factory generation when composition choices are unresolved', async () => {
    await writeFactorySkill(projectRoot, 'task3-choice-flow', {
      description: 'Choice flow.',
      flow: `steps:
  - choose:
      id: review
      options:
        - task3-missing-review-a
        - task3-missing-review-b
`,
    });
    const planFile = path.join(root, 'factory-choice-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a workflow with an unresolved review choice.',
          preferredSkills: ['task3-choice-flow'],
          workflow: workflowFor('composition-blocked-factory', ['task3-choice-flow']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
          defaultLocale: 'zh',
          locales: ['zh', 'en'],
        },
        null,
        2,
      ),
    );
    await bundleFactoryInitCommand('composition-blocked-factory', {
      project: projectRoot,
      file: planFile,
      json: true,
    });

    await expect(
      bundleFactoryGenerateCommand('composition-blocked-factory', {
        project: projectRoot,
        json: true,
      }),
    ).rejects.toThrow(/composition.*Choice review/iu);
  });

  it('blocks factory generation when a flow compiles duplicate final steps', async () => {
    await writeFactorySkill(projectRoot, 'task3-duplicate-flow', {
      description: 'Duplicate flow.',
      flow: `steps:
  - use: task3-duplicate-final
  - use: task3-duplicate-final
`,
    });
    await writeFactorySkill(projectRoot, 'task3-duplicate-final', {
      description: 'Final step.',
    });
    const planFile = path.join(root, 'factory-duplicate-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a workflow with duplicate final steps.',
          preferredSkills: ['task3-duplicate-flow', 'task3-duplicate-final'],
          workflow: workflowFor('duplicate-composition-factory', ['task3-duplicate-flow']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
          defaultLocale: 'zh',
          locales: ['zh', 'en'],
        },
        null,
        2,
      ),
    );
    await bundleFactoryInitCommand('duplicate-composition-factory', {
      project: projectRoot,
      file: planFile,
      json: true,
    });

    await expect(
      bundleFactoryGenerateCommand('duplicate-composition-factory', {
        project: projectRoot,
        json: true,
      }),
    ).rejects.toThrow(/composition.*duplicate.*task3-duplicate-final/iu);
  });

  it('blocks factory generation when a source flow is empty', async () => {
    await writeFactorySkill(projectRoot, 'task3-empty-flow', {
      description: 'Empty flow.',
      flow: `steps: []
`,
    });
    const planFile = path.join(root, 'factory-empty-flow-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a workflow from an empty flow.',
          preferredSkills: ['task3-empty-flow'],
          workflow: workflowFor('empty-flow-composition-factory', ['task3-empty-flow']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
          defaultLocale: 'zh',
          locales: ['zh', 'en'],
        },
        null,
        2,
      ),
    );
    await bundleFactoryInitCommand('empty-flow-composition-factory', {
      project: projectRoot,
      file: planFile,
      json: true,
    });

    await expect(
      bundleFactoryGenerateCommand('empty-flow-composition-factory', {
        project: projectRoot,
        json: true,
      }),
    ).rejects.toThrow(/composition.*empty flow/iu);
  });

  it('blocks factory generation when a composed source flow is referenced twice', async () => {
    await writeFactorySkill(projectRoot, 'task3-duplicate-composed-entry', {
      description: 'Duplicate composed entry.',
      flow: `steps:
  - use: task3-planning-flow
  - use: task3-planning-flow
`,
    });
    await writeFactorySkill(projectRoot, 'task3-planning-flow', {
      description: 'Nested planning flow.',
      flow: `steps:
  - use: task3-planning-brainstorm
  - use: task3-planning-write
`,
    });
    await writeFactorySkill(projectRoot, 'task3-planning-brainstorm', {
      description: 'Brainstorming step.',
    });
    await writeFactorySkill(projectRoot, 'task3-planning-write', {
      description: 'Writing step.',
    });
    const planFile = path.join(root, 'factory-duplicate-composed-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a workflow with duplicate composed flow references.',
          preferredSkills: [
            'task3-duplicate-composed-entry',
            'task3-planning-flow',
            'task3-planning-brainstorm',
            'task3-planning-write',
          ],
          workflow: workflowFor('duplicate-composed-flow-factory', [
            'task3-duplicate-composed-entry',
          ]),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
          defaultLocale: 'zh',
          locales: ['zh', 'en'],
        },
        null,
        2,
      ),
    );
    await bundleFactoryInitCommand('duplicate-composed-flow-factory', {
      project: projectRoot,
      file: planFile,
      json: true,
    });

    await expect(
      bundleFactoryGenerateCommand('duplicate-composed-flow-factory', {
        project: projectRoot,
        json: true,
      }),
    ).rejects.toThrow(/composition.*duplicate.*task3-planning-flow/iu);
  });

  it('keeps composition blocking after resolving an ambiguous candidate to a flow with unresolved choice', async () => {
    const secondRoot = path.join(projectRoot, '.claude', 'skills', 'task3-review-choice-flow');
    await writeFactorySkill(projectRoot, 'task3-review-choice-flow', {
      description: 'Atomic fallback.',
    });
    await fs.mkdir(secondRoot, { recursive: true });
    await fs.writeFile(
      path.join(secondRoot, 'SKILL.md'),
      '---\nname: task3-review-choice-flow\ndescription: Flow with unresolved choice.\n---\n# task3-review-choice-flow\n',
    );
    await fs.mkdir(path.join(secondRoot, 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(secondRoot, 'comet', 'flow.yaml'),
      `steps:
  - choose:
      id: review
      options:
        - task3-missing-review-a
        - task3-missing-review-b
`,
      'utf8',
    );
    const planFile = path.join(root, 'factory-resolved-choice-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify(
        {
          goal: 'Create a workflow whose resolved source has an unresolved choice.',
          preferredSkills: ['task3-review-choice-flow'],
          workflow: workflowFor('resolved-composition-blocked', ['task3-review-choice-flow']),
          engineMode: 'deterministic',
          runnerMode: 'standalone',
          defaultLocale: 'zh',
          locales: ['zh', 'en'],
        },
        null,
        2,
      ),
    );

    const initialized = await captureJson(() =>
      bundleFactoryInitCommand('resolved-composition-blocked', {
        project: projectRoot,
        file: planFile,
        json: true,
      }),
    );
    expect(initialized).toMatchObject({
      factory: {
        resolvedSkills: [{ query: 'task3-review-choice-flow', status: 'ambiguous' }],
      },
    });
    expect(initialized.factory).toMatchObject({
      composition: {
        entrySkills: ['task3-review-choice-flow'],
        issues: [],
      },
    });

    const resolved = await captureJson(() =>
      bundleFactoryResolveCommand('resolved-composition-blocked', {
        project: projectRoot,
        candidate: 'task3-review-choice-flow',
        source: secondRoot,
        json: true,
      }),
    );
    expect(resolved).toMatchObject({
      factory: {
        resolvedSkills: [
          {
            query: 'task3-review-choice-flow',
            status: 'available',
            sources: [expect.objectContaining({ name: 'task3-review-choice-flow' })],
          },
        ],
      },
    });
    await expectPathEquivalent(resolved.factory.resolvedSkills[0].sources[0].root, secondRoot);

    await expect(
      bundleFactoryGenerateCommand('resolved-composition-blocked', {
        project: projectRoot,
        json: true,
      }),
    ).rejects.toThrow(/composition.*Choice review/iu);

    await expect(
      fs.access(
        path.join(
          projectRoot,
          '.comet',
          'bundle-drafts',
          'resolved-composition-blocked',
          'skills',
          'resolved-composition-blocked',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resolves ambiguous and ignored missing factory candidates through command state updates', async () => {
    const firstRoot = path.join(projectRoot, '.codex', 'skills', 'review-flow');
    const secondRoot = path.join(projectRoot, '.claude', 'skills', 'review-flow');
    await createBundleDraft({
      projectRoot,
      name: 'resolvable-factory',
      candidates: [],
      defaultLocale: 'zh',
      locales: ['zh', 'en'],
      engineEnabled: true,
      factory: {
        goal: 'Create a workflow that can recover candidate choices.',
        preferredSkills: ['review-flow', 'optional-missing'],
        resolvedSkills: [
          {
            query: 'review-flow',
            preferenceIndex: 0,
            status: 'ambiguous',
            sources: [
              {
                name: 'review-flow',
                preferenceIndex: 0,
                platform: 'codex',
                scope: 'project',
                origin: 'project',
                factory: { query: 'review-flow' },
                root: firstRoot,
                description: 'First candidate.',
                skillMd: '# First\n',
                hash: 'a'.repeat(64),
              },
              {
                name: 'review-flow',
                preferenceIndex: 0,
                platform: 'claude',
                scope: 'project',
                origin: 'project',
                factory: { query: 'review-flow' },
                root: secondRoot,
                description: 'Second candidate.',
                skillMd: '# Second\n',
                hash: 'b'.repeat(64),
              },
            ],
          },
          {
            query: 'optional-missing',
            preferenceIndex: 1,
            status: 'missing',
            sources: [],
          },
        ],
        callChain: [
          { skill: 'review-flow', preferenceIndex: 0 },
          { skill: 'optional-missing', preferenceIndex: 1 },
        ],
        deviations: [],
        composition: {
          schemaVersion: 1,
          entrySkills: ['review-flow'],
          steps: [
            {
              id: 'step-1',
              skill: 'review-flow',
              source: 'atomic',
              preferenceIndex: 0,
            },
          ],
          choices: [],
          issues: [],
        },
        engineMode: 'deterministic',
        runnerMode: 'standalone',
        generatedSkillPackage: {
          entrySkill: 'resolvable-factory',
          internalSkills: [],
          packageRoot: path.join(projectRoot, '.comet', 'bundle-drafts', 'resolvable-factory'),
          enginePath: null,
          evalManifestPath: null,
        },
      },
    });

    const selected = await captureJson(() =>
      bundleFactoryResolveCommand('resolvable-factory', {
        project: projectRoot,
        candidate: 'review-flow',
        source: secondRoot,
        json: true,
      }),
    );
    const ignored = await captureJson(() =>
      bundleFactoryResolveCommand('resolvable-factory', {
        project: projectRoot,
        candidate: 'optional-missing',
        ignoreMissing: true,
        reason: 'The optional preference is not required for this generated Skill.',
        json: true,
      }),
    );

    expect(selected).toMatchObject({
      factory: {
        resolvedSkills: [
          {
            query: 'review-flow',
            status: 'available',
            sources: [{ root: secondRoot, hash: 'b'.repeat(64) }],
          },
          { query: 'optional-missing', status: 'missing' },
        ],
      },
    });
    expect(selected.factory).not.toHaveProperty('generatedSkillPackage');
    expect(selected.factory).not.toHaveProperty('composition');
    expect(ignored).toMatchObject({
      factory: {
        preferredSkills: ['review-flow'],
        resolvedSkills: [{ query: 'review-flow', status: 'available' }],
        callChain: [{ skill: 'review-flow', preferenceIndex: 0 }],
        deviations: [
          {
            skill: 'optional-missing',
            expectedIndex: 1,
            actualIndex: -1,
            reason: 'The optional preference is not required for this generated Skill.',
          },
        ],
      },
    });
    expect(ignored.factory).not.toHaveProperty('generatedSkillPackage');
    expect(ignored.factory).not.toHaveProperty('composition');
  });

  it('builds a factory review summary with compile and eval workload evidence', async () => {
    const skillRoot = path.join(projectRoot, '.claude', 'skills', 'factory-alpha');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'skill-preferences.yaml'),
      `version: 1
prefer:
  - factory-alpha
`,
    );
    await fs.writeFile(
      path.join(skillRoot, 'SKILL.md'),
      '---\nname: factory-alpha\ndescription: Alpha factory step.\n---\n# Alpha\n',
    );
    const planFile = path.join(root, 'review-plan.json');
    await fs.writeFile(
      planFile,
      JSON.stringify({
        goal: 'Create a reviewable factory Skill.',
        workflow: workflowFor('review-factory', ['factory-alpha']),
        engineMode: 'deterministic',
        runnerMode: 'standalone',
        defaultLocale: 'zh',
        locales: ['zh', 'en'],
      }),
    );
    await bundleFactoryInitCommand('review-factory', {
      project: projectRoot,
      file: planFile,
      confirmedProposal: true,
      json: true,
    });
    await bundleFactoryGenerateCommand('review-factory', { project: projectRoot, json: true });

    const summary = await captureJson(() =>
      bundleReviewSummaryCommand('review-factory', {
        project: projectRoot,
        platform: 'claude',
        json: true,
      }),
    );

    expect(summary).toMatchObject({
      schemaVersion: 1,
      name: 'review-factory',
      status: 'draft',
      factory: {
        goal: 'Create a reviewable factory Skill.',
        planPath: path.join(
          projectRoot,
          '.comet',
          'bundle-factory-plans',
          'review-factory',
          'plan.json',
        ),
        planHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        generatedSkillPackage: {
          entrySkill: 'review-factory',
        },
      },
      compile: {
        platform: 'claude',
        entrySkills: ['review-factory'],
      },
      evalPlans: {
        quick: { level: 'quick', tokenWorkload: 'low' },
        full: { level: 'full', tokenWorkload: 'high' },
      },
      eval: null,
      review: null,
    });

    const text = await captureText(() =>
      bundleReviewSummaryCommand('review-factory', {
        project: projectRoot,
        platform: 'claude',
      }),
    );
    expect(text).toContain('Validate this Skill:');
    expect(text).toContain('Next steps:');
    expect(text).not.toContain('Readiness: blocked\nBlockers:\n- [eval]');
  });

  it('points composition-blocked factory states away from factory-generate as the next action', async () => {
    await createBundleDraft({
      projectRoot,
      name: 'factory-composition-action',
      candidates: [],
      defaultLocale: 'zh',
      locales: ['zh', 'en'],
      engineEnabled: true,
      factory: {
        goal: 'Create a workflow with a composition issue.',
        preferredSkills: ['task3-choice-flow'],
        compositionEntrySkills: ['task3-choice-flow'],
        resolvedSkills: [
          {
            query: 'task3-choice-flow',
            preferenceIndex: 0,
            status: 'available',
            sources: [
              {
                name: 'task3-choice-flow',
                preferenceIndex: 0,
                platform: 'project',
                scope: 'project',
                origin: 'project',
                factory: { query: 'task3-choice-flow' },
                root: path.join(projectRoot, '.comet', 'skills', 'task3-choice-flow'),
                description: 'Choice flow.',
                skillMd: '# Choice flow\n',
                hash: 'c'.repeat(64),
              },
            ],
          },
        ],
        callChain: [{ skill: 'task3-choice-flow', preferenceIndex: 0 }],
        composition: {
          schemaVersion: 1,
          entrySkills: ['task3-choice-flow'],
          steps: [],
          choices: [
            {
              id: 'review',
              fromSkill: 'task3-choice-flow',
              options: ['task3-missing-review'],
              selectedSkill: null,
              reason: 'No options are available in resolved Skills.',
            },
          ],
          issues: [
            {
              type: 'unresolved-choice',
              message: 'Choice review from task3-choice-flow has no available options.',
              choiceId: 'review',
            },
          ],
        },
        deviations: [],
        engineMode: 'deterministic',
        runnerMode: 'standalone',
      },
    });

    const status = await captureJson(() =>
      bundleStatusCommand('factory-composition-action', { project: projectRoot, json: true }),
    );
    const listed = await captureJson(() => bundleListCommand({ project: projectRoot, json: true }));

    expect(status.nextAction).toMatchObject({
      action: 'fix-composition',
      backendCommand:
        'comet bundle review-summary factory-composition-action --platform <reference-platform>',
    });
    expect(status.nextAction.action).not.toBe('generate-factory-package');
    expect(String(status.nextAction.reason)).toMatch(/composition/i);
    expect(status.resumeSummary).toMatchObject({
      currentStep: 'needs-composition-fix',
      recommendedNextStep: { action: 'fix-composition' },
    });
    expect(listed).toMatchObject({
      bundles: [
        {
          name: 'factory-composition-action',
          nextAction: {
            action: 'fix-composition',
          },
          resumeSummary: {
            currentStep: 'needs-composition-fix',
            recommendedNextStep: { action: 'fix-composition' },
          },
        },
      ],
    });
    const [listedBundle] = listed.bundles as Array<{ nextAction: { reason: string } }>;
    expect(String(listedBundle!.nextAction.reason)).toMatch(/composition/i);
    const text = await captureText(() =>
      bundleStatusCommand('factory-composition-action', { project: projectRoot }),
    );
    expect(text).toContain('Already done:');
    expect(text).toContain('- Skill Creator metadata initialized');
    expect(text).toContain('Still missing:');
  });

  it('compiles a Bundle, plans Eval, records Eval, approves, publishes, and distributes', async () => {
    const source = path.join(root, 'lifecycle-source');
    await writeBundle(source, { name: 'lifecycle-bundle' });
    await bundleDraftOptimizeCommand(source, { project: projectRoot, json: true });
    const status = await captureJson(() =>
      bundleStatusCommand('lifecycle-bundle', { project: projectRoot, json: true }),
    );

    const compiled = await captureJson(() =>
      bundleCompileCommand('lifecycle-bundle', {
        project: projectRoot,
        platform: 'claude',
        json: true,
      }),
    );
    const evalPlan = await captureJson(() =>
      bundleEvalPlanCommand('lifecycle-bundle', {
        project: projectRoot,
        level: 'quick',
        json: true,
      }),
    );
    const resultFile = path.join(root, 'eval.json');
    await fs.writeFile(resultFile, JSON.stringify(passingResult(String(status.currentHash))));
    const evaluated = await captureJson(() =>
      bundleEvalRecordCommand('lifecycle-bundle', {
        project: projectRoot,
        result: resultFile,
        json: true,
      }),
    );
    const reviewed = await captureJson(() =>
      bundleReviewCommand('lifecycle-bundle', {
        project: projectRoot,
        approve: true,
        reviewer: 'alice',
        json: true,
      }),
    );
    const published = await captureJson(() =>
      bundlePublishCommand('lifecycle-bundle', {
        project: projectRoot,
        platform: 'claude',
        json: true,
      }),
    );
    const publishedReviewText = await captureText(() =>
      bundleReviewSummaryCommand('lifecycle-bundle', {
        project: projectRoot,
        platform: 'claude',
      }),
    );
    const distributed = await captureJson(() =>
      bundleDistributeCommand('lifecycle-bundle', {
        project: projectRoot,
        platform: ['claude'],
        scope: 'project',
        json: true,
      }),
    );

    expect(compiled).toMatchObject({ platform: 'claude', entrySkills: ['entry'] });
    expect(evalPlan).toMatchObject({ level: 'quick', tokenWorkload: 'low' });
    expect(evaluated).toMatchObject({ status: 'eval-passed' });
    expect(reviewed).toMatchObject({ status: 'review-approved' });
    expect(published).toMatchObject({ status: 'ready' });
    expect(publishedReviewText).toContain('Validate this Skill: ready for the next step');
    expect(publishedReviewText).toContain('Next steps:');
    expect(distributed).toMatchObject({
      platforms: [{ platform: 'claude', status: 'installed' }],
    });
  });

  it('rejects invalid lifecycle command combinations', async () => {
    const source = path.join(root, 'invalid-source');
    await writeBundle(source, { name: 'invalid-bundle', requiresHooks: true });
    await bundleDraftOptimizeCommand(source, { project: projectRoot, json: true });

    await expect(
      bundleReviewCommand('invalid-bundle', {
        project: projectRoot,
        approve: true,
        reject: true,
      }),
    ).rejects.toThrow(/approve.*reject|reject.*approve/iu);
    await expect(
      bundlePublishCommand('invalid-bundle', {
        project: projectRoot,
        platform: 'claude',
      }),
    ).rejects.toThrow(/Eval|review/iu);
    await expect(
      bundleDistributeCommand('invalid-bundle', {
        project: projectRoot,
        scope: 'project',
      }),
    ).rejects.toThrow(/platform/iu);

    const status = await captureJson(() =>
      bundleStatusCommand('invalid-bundle', { project: projectRoot, json: true }),
    );
    const resultFile = path.join(root, 'invalid-eval.json');
    await fs.writeFile(resultFile, JSON.stringify(passingResult(String(status.currentHash))));
    await bundleEvalRecordCommand('invalid-bundle', {
      project: projectRoot,
      result: resultFile,
    });
    await bundleReviewCommand('invalid-bundle', {
      project: projectRoot,
      approve: true,
      reviewer: 'alice',
    });
    await bundlePublishCommand('invalid-bundle', {
      project: projectRoot,
      platform: 'claude',
    });
    const distributed = await captureJson(() =>
      bundleDistributeCommand('invalid-bundle', {
        project: projectRoot,
        platform: ['claude'],
        scope: 'project',
        json: true,
      }),
    );
    expect(distributed).toMatchObject({
      platforms: [
        {
          platform: 'claude',
          status: 'cancelled',
          error: expect.stringMatching(/executable|confirm/iu),
          executableDisclosures: [
            expect.objectContaining({
              id: 'protect-write',
              sideEffect: 'read',
            }),
          ],
        },
      ],
    });

    const text = await captureText(() =>
      bundleDistributeCommand('invalid-bundle', {
        project: projectRoot,
        platform: ['claude'],
        scope: 'project',
      }),
    );
    expect(text).toContain('Executable disclosures:');
    expect(text).toContain('protect-write');
  });
});
