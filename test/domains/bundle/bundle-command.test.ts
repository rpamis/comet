import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  bundleListCommand,
  bundlePublishCommand,
  bundleReviewSummaryCommand,
  bundleReviewCommand,
  bundleStatusCommand,
} from '../../../app/commands/bundle.js';
import type { RepositoryEvalResult } from '../../../domains/bundle/eval.js';

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
