import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { parse, stringify } from 'yaml';
import { optimizeBundleDraft } from '../../../domains/bundle/draft.js';
import { recordBundleEval, type RepositoryEvalResult } from '../../../domains/bundle/eval.js';
import { publishBundle, reviewBundle } from '../../../domains/bundle/publish.js';
import { distributeBundle } from '../../../domains/bundle/distribute.js';
import { reconcileBundleAuthoringState } from '../../../domains/bundle/state.js';

type FixtureOptions = {
  name: string;
  requiresHooks?: boolean;
  optionalRules?: boolean;
};

async function writeBundle(root: string, options: FixtureOptions): Promise<void> {
  const { name, requiresHooks = false, optionalRules = false } = options;
  await fs.mkdir(path.join(root, 'skills', 'entry'), { recursive: true });
  await fs.mkdir(path.join(root, 'locales', 'zh', 'skills', 'entry'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'bundle.yaml'),
    `apiVersion: comet/v1alpha1
kind: SkillBundle
metadata:
  name: ${name}
  version: 1.0.0
  description: Distribution fixture
  defaultLocale: en
  locales: [en, zh]
skills:
  - id: entry
    path: skills/entry
    visibility: entry
resources:
  rules:${
    optionalRules
      ? `
    - id: workflow
      path: rules/workflow.md
      mode: always
      required: false`
      : ' []'
  }
  hooks:${
    requiresHooks
      ? `
    - id: protect-write
      path: hooks/protect-write.yaml`
      : ' []'
  }
  references: []
  scripts:${
    requiresHooks
      ? `
    - id: verify
      path: scripts/verify.mjs
      sideEffect: read
      runtime: node`
      : ' []'
  }
  assets: []
platforms:
  requires: [skills${requiresHooks ? ', hooks' : ''}]
  optional: [${optionalRules ? 'rules' : ''}]
  overrides: []
engine:
  enabled: false
`,
  );
  await fs.writeFile(
    path.join(root, 'skills', 'entry', 'SKILL.md'),
    '---\nname: entry\ndescription: English entry.\n---\n\n# English Entry\n',
  );
  await fs.writeFile(
    path.join(root, 'locales', 'zh', 'skills', 'entry', 'SKILL.md'),
    '---\nname: entry\ndescription: Chinese entry.\n---\n\n# Chinese Entry\n',
  );
  if (optionalRules) {
    await fs.mkdir(path.join(root, 'rules'), { recursive: true });
    await fs.writeFile(path.join(root, 'rules', 'workflow.md'), '# Workflow Rule\n');
  }
  if (requiresHooks) {
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

function passingResult(hash: string): RepositoryEvalResult {
  return {
    schemaVersion: 2,
    provider: 'comet-eval',
    level: 'quick',
    draftHash: hash,
    evalManifestHash: 'b'.repeat(64),
    tasks: ['generic-skill-smoke'],
    treatments: ['entry'],
    passAtK: { '1': 1 },
    weightedScore: { overall: 1 },
    instabilityGap: { overall: 0 },
    failures: [],
    reports: ['eval-report.html'],
    passed: true,
    summary: 'Distribution gates passed.',
  };
}

describe('Bundle distribution', () => {
  let root: string;
  let projectRoot: string;
  let homeDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-bundle-distribute-'));
    projectRoot = path.join(root, 'project');
    homeDir = path.join(root, 'home');
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('requires a ready Bundle with the current published hash', async () => {
    await createDraft({ name: 'draft-bundle' });

    await expect(
      distributeBundle({
        projectRoot,
        name: 'draft-bundle',
        platforms: ['claude'],
        scope: 'project',
      }),
    ).rejects.toThrow(/ready/iu);

    const ready = await makeReady({ name: 'ready-bundle' });
    await fs.appendFile(path.join(ready.ready!.path, 'skills', 'entry', 'SKILL.md'), 'changed\n');

    await expect(
      distributeBundle({
        projectRoot,
        name: 'ready-bundle',
        platforms: ['claude'],
        scope: 'project',
      }),
    ).rejects.toThrow(/ready|current hash|changed/iu);
  });

  it('installs project and global targets using the platform registry paths', async () => {
    await makeReady({ name: 'path-bundle' });

    const projectResult = await distributeBundle({
      projectRoot,
      name: 'path-bundle',
      platforms: ['claude'],
      scope: 'project',
    });
    const globalResult = await distributeBundle({
      projectRoot,
      name: 'path-bundle',
      platforms: ['opencode'],
      scope: 'global',
    });

    expect(projectResult.platforms[0]).toMatchObject({ platform: 'claude', status: 'installed' });
    await expect(
      fs.access(path.join(projectRoot, '.claude', 'skills', 'entry', 'SKILL.md')),
    ).resolves.toBeUndefined();
    expect(globalResult.platforms[0]).toMatchObject({ platform: 'opencode', status: 'installed' });
    await expect(
      fs.access(path.join(homeDir, '.config', 'opencode', 'skills', 'entry', 'SKILL.md')),
    ).resolves.toBeUndefined();
  });

  it('installs declared Claude Code agents into .claude/agents', async () => {
    const draft = await createDraft({ name: 'agent-bundle' });
    await fs.mkdir(path.join(draft.draftPath, 'agents', 'claude'), { recursive: true });
    await fs.writeFile(
      path.join(draft.draftPath, 'agents', 'claude', 'agent-bundle-reviewer.md'),
      '---\nname: agent-bundle-reviewer\ndescription: Use when reviewing agent-bundle.\ntools: Read\nmodel: inherit\n---\n\n# Reviewer\n',
      'utf8',
    );
    const manifestPath = path.join(draft.draftPath, 'bundle.yaml');
    const manifest = parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    const resources = manifest.resources as Record<string, unknown>;
    resources.agents = [
      {
        id: 'agent-bundle-reviewer',
        path: 'agents/claude/agent-bundle-reviewer.md',
        platform: 'claude',
        required: true,
      },
    ];
    manifest.platforms = {
      ...(manifest.platforms as Record<string, unknown>),
      requires: ['skills', 'agents'],
    };
    await fs.writeFile(manifestPath, stringify(manifest), 'utf8');
    const state = await reconcileBundleAuthoringState(projectRoot, 'agent-bundle');
    const resultFile = path.join(root, 'agent-bundle-eval.json');
    await fs.writeFile(resultFile, JSON.stringify(passingResult(state.currentHash!), null, 2));
    await recordBundleEval(projectRoot, 'agent-bundle', resultFile);
    await reviewBundle({
      projectRoot,
      name: 'agent-bundle',
      decision: 'approved',
      reviewer: 'alice',
    });
    await publishBundle({
      projectRoot,
      name: 'agent-bundle',
      referencePlatform: 'claude',
    });

    const result = await distributeBundle({
      projectRoot,
      name: 'agent-bundle',
      platforms: ['claude'],
      scope: 'project',
    });

    expect(result.platforms[0]).toMatchObject({
      platform: 'claude',
      status: 'installed',
      plannedFiles: expect.arrayContaining([expect.objectContaining({ kind: 'agent' })]),
    });
    await expect(
      fs.access(path.join(projectRoot, '.claude', 'agents', 'agent-bundle-reviewer.md')),
    ).resolves.toBeUndefined();
  });

  it('uses locale overlays when compiling files to install', async () => {
    await makeReady({ name: 'locale-bundle' });

    await distributeBundle({
      projectRoot,
      name: 'locale-bundle',
      platforms: ['claude'],
      scope: 'project',
      locale: 'zh',
    });

    await expect(
      fs.readFile(path.join(projectRoot, '.claude', 'skills', 'entry', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('Chinese Entry');
  });

  it('requires explicit skips for unsupported optional capabilities', async () => {
    await makeReady({ name: 'optional-bundle', optionalRules: true });

    const blocked = await distributeBundle({
      projectRoot,
      name: 'optional-bundle',
      platforms: ['kimicode'],
      scope: 'project',
    });
    const installed = await distributeBundle({
      projectRoot,
      name: 'optional-bundle',
      platforms: ['kimicode'],
      scope: 'project',
      skipCapabilities: ['rules'],
    });

    expect(blocked.platforms[0]).toMatchObject({
      platform: 'kimicode',
      status: 'cancelled',
      unsupported: [expect.objectContaining({ capability: 'rules', required: false })],
    });
    expect(installed.platforms[0]).toMatchObject({
      platform: 'kimicode',
      status: 'installed',
      unsupported: [expect.objectContaining({ capability: 'rules', required: false })],
    });
  });

  it('cancels platforms with unsupported required capabilities', async () => {
    await makeReady({ name: 'hook-bundle', requiresHooks: true });

    const result = await distributeBundle({
      projectRoot,
      name: 'hook-bundle',
      platforms: ['kimicode'],
      scope: 'project',
      confirmedExecutables: true,
    });

    expect(result.platforms[0]).toMatchObject({
      platform: 'kimicode',
      status: 'cancelled',
      error: expect.stringContaining('hooks'),
      unsupported: [expect.objectContaining({ capability: 'hooks', required: true })],
      executableDisclosures: [],
      plannedFiles: expect.arrayContaining([
        expect.objectContaining({ kind: 'skill' }),
        expect.objectContaining({ kind: 'script' }),
      ]),
    });
    await expect(
      fs.access(path.join(projectRoot, '.kimi-code', 'skills', 'entry', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not allow skipCapabilities to skip required hooks', async () => {
    await makeReady({ name: 'required-hook-bundle', requiresHooks: true });

    const result = await distributeBundle({
      projectRoot,
      name: 'required-hook-bundle',
      platforms: ['kimicode'],
      scope: 'project',
      skipCapabilities: ['hooks'],
      confirmedExecutables: true,
    });

    expect(result.platforms[0]).toMatchObject({
      platform: 'kimicode',
      status: 'cancelled',
      error: expect.stringContaining('hooks'),
      unsupported: [expect.objectContaining({ capability: 'hooks', required: true })],
      executableDisclosures: [],
      plannedFiles: expect.any(Array),
    });
  });

  it('requires executable confirmation before writing hooks or scripts', async () => {
    await makeReady({ name: 'confirm-bundle', requiresHooks: true });

    const result = await distributeBundle({
      projectRoot,
      name: 'confirm-bundle',
      platforms: ['claude'],
      scope: 'project',
    });

    expect(result.platforms[0]).toMatchObject({
      platform: 'claude',
      status: 'cancelled',
      written: [],
      skipped: [],
      unsupported: [],
      error: expect.stringMatching(/executable|confirm/iu),
      executableDisclosures: [
        expect.objectContaining({
          id: 'protect-write',
          sideEffect: 'read',
          command: expect.stringContaining('verify.mjs'),
        }),
      ],
      plannedFiles: expect.arrayContaining([
        expect.objectContaining({ kind: 'skill' }),
        expect.objectContaining({ kind: 'hook' }),
        expect.objectContaining({ kind: 'script' }),
      ]),
    });
    await expect(
      fs.access(path.join(projectRoot, '.claude', 'skills', 'entry', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('previews distribution without writing platform files', async () => {
    await makeReady({ name: 'preview-bundle', requiresHooks: true });

    const result = await distributeBundle({
      projectRoot,
      name: 'preview-bundle',
      platforms: ['claude'],
      scope: 'project',
      preview: true,
    });

    expect(result.preview).toBe(true);
    expect(result.platforms[0]).toMatchObject({
      platform: 'claude',
      status: 'planned',
      written: [],
      skipped: [],
      plannedFiles: expect.arrayContaining([
        expect.objectContaining({ kind: 'skill' }),
        expect.objectContaining({ kind: 'hook' }),
        expect.objectContaining({ kind: 'script' }),
      ]),
      executableDisclosures: [
        expect.objectContaining({
          id: 'protect-write',
          sideEffect: 'read',
        }),
      ],
    });
    await expect(
      fs.access(path.join(projectRoot, '.claude', 'skills', 'entry', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels all planned platforms when any executable disclosure is unconfirmed', async () => {
    await makeReady({ name: 'multi-confirm-bundle', requiresHooks: true });

    const result = await distributeBundle({
      projectRoot,
      name: 'multi-confirm-bundle',
      platforms: ['claude', 'codex'],
      scope: 'project',
    });

    expect(result.platforms).toEqual([
      expect.objectContaining({
        platform: 'claude',
        status: 'cancelled',
        written: [],
        skipped: [],
        error: expect.stringMatching(/executable|confirm/iu),
        plannedFiles: expect.arrayContaining([
          expect.objectContaining({ kind: 'skill' }),
          expect.objectContaining({ kind: 'hook' }),
          expect.objectContaining({ kind: 'script' }),
        ]),
        executableDisclosures: [
          expect.objectContaining({ id: 'protect-write', sideEffect: 'read' }),
        ],
      }),
      expect.objectContaining({
        platform: 'codex',
        status: 'cancelled',
        written: [],
        skipped: [],
        error: expect.stringMatching(/executable|confirm/iu),
        plannedFiles: expect.arrayContaining([
          expect.objectContaining({ kind: 'skill' }),
          expect.objectContaining({ kind: 'hook' }),
          expect.objectContaining({ kind: 'script' }),
        ]),
        executableDisclosures: [
          expect.objectContaining({ id: 'protect-write', sideEffect: 'read' }),
        ],
      }),
    ]);
    await expect(
      fs.access(path.join(projectRoot, '.claude', 'skills', 'entry', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(projectRoot, '.agents', 'skills', 'entry', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('merges hook settings non-destructively after executable confirmation', async () => {
    await makeReady({ name: 'confirmed-hook-bundle', requiresHooks: true, optionalRules: true });
    const settingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'echo user' }] },
            ],
          },
        },
        null,
        2,
      ),
    );

    const result = await distributeBundle({
      projectRoot,
      name: 'confirmed-hook-bundle',
      platforms: ['claude'],
      scope: 'project',
      confirmedExecutables: true,
    });
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };

    expect(result.platforms[0].written).toContain(settingsPath);
    expect(result.platforms[0]).toMatchObject({
      plannedFiles: expect.arrayContaining([
        expect.objectContaining({
          kind: 'skill',
          destination: path.join(projectRoot, '.claude', 'skills', 'entry', 'SKILL.md'),
        }),
        expect.objectContaining({ kind: 'hook', destination: settingsPath }),
        expect.objectContaining({
          kind: 'rule',
          destination: path.join(projectRoot, '.claude', 'rules', 'workflow.md'),
        }),
        expect.objectContaining({
          kind: 'script',
          destination: path.join(
            projectRoot,
            '.claude',
            'skills',
            '.comet-bundles',
            'confirmed-hook-bundle',
            'scripts',
            'verify.mjs',
          ),
        }),
      ]),
      executableDisclosures: [
        expect.objectContaining({
          id: 'protect-write',
          sideEffect: 'read',
          command: expect.stringContaining('verify.mjs'),
          destination: settingsPath,
        }),
      ],
    });
    expect(settings.hooks.PreToolUse[0].hooks.map((hook) => hook.command)).toEqual(
      expect.arrayContaining(['echo user', expect.stringContaining('verify.mjs')]),
    );
  });

  it('skips existing target files by default and overwrites only when requested', async () => {
    await makeReady({ name: 'overwrite-bundle' });
    const skillPath = path.join(projectRoot, '.claude', 'skills', 'entry', 'SKILL.md');
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(skillPath, 'existing\n');

    const skipped = await distributeBundle({
      projectRoot,
      name: 'overwrite-bundle',
      platforms: ['claude'],
      scope: 'project',
    });
    await expect(fs.readFile(skillPath, 'utf8')).resolves.toBe('existing\n');
    const overwritten = await distributeBundle({
      projectRoot,
      name: 'overwrite-bundle',
      platforms: ['claude'],
      scope: 'project',
      overwrite: true,
    });

    expect(skipped.platforms[0].skipped).toContain(skillPath);
    expect(skipped.platforms[0].plannedFiles).toContainEqual({
      kind: 'skill',
      destination: skillPath,
    });
    await expect(fs.readFile(skillPath, 'utf8')).resolves.toContain('English Entry');
    expect(overwritten.platforms[0].written).toContain(skillPath);
  });

  it('keeps successful platforms when another platform fails', async () => {
    await makeReady({ name: 'partial-bundle' });

    const result = await distributeBundle({
      projectRoot,
      name: 'partial-bundle',
      platforms: ['claude', 'missing-platform'],
      scope: 'project',
    });

    expect(result.platforms).toEqual([
      expect.objectContaining({ platform: 'claude', status: 'installed' }),
      expect.objectContaining({
        platform: 'missing-platform',
        status: 'failed',
        executableDisclosures: [],
        plannedFiles: [],
      }),
    ]);
    await expect(
      fs.access(path.join(projectRoot, '.claude', 'skills', 'entry', 'SKILL.md')),
    ).resolves.toBeUndefined();
  });

  it('does not copy authoring or Eval state into installed platform files', async () => {
    await makeReady({ name: 'clean-bundle' });

    const result = await distributeBundle({
      projectRoot,
      name: 'clean-bundle',
      platforms: ['claude'],
      scope: 'project',
    });

    expect(result.platforms[0].written.every((file) => !file.includes('bundle-authoring'))).toBe(
      true,
    );
    expect(result.platforms[0].written.every((file) => !file.includes('bundle-evals'))).toBe(true);
    await expect(
      fs.access(path.join(projectRoot, '.claude', 'skills', 'entry', '.comet')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  async function createDraft(options: FixtureOptions) {
    const sourceRoot = path.join(root, `${options.name}-source`);
    await writeBundle(sourceRoot, options);
    return optimizeBundleDraft({
      projectRoot,
      name: options.name,
      sourceRoot,
      candidates: [],
      defaultLocale: 'en',
      locales: ['en', 'zh'],
      engineEnabled: false,
    });
  }

  async function makeReady(options: FixtureOptions) {
    await createDraft(options);
    const state = await reconcileBundleAuthoringState(projectRoot, options.name);
    const resultFile = path.join(root, `${options.name}-eval.json`);
    await fs.writeFile(resultFile, JSON.stringify(passingResult(state.currentHash!), null, 2));
    await recordBundleEval(projectRoot, options.name, resultFile);
    await reviewBundle({
      projectRoot,
      name: options.name,
      decision: 'approved',
      reviewer: 'alice',
    });
    return publishBundle({
      projectRoot,
      name: options.name,
      referencePlatform: 'claude',
    });
  }
});
