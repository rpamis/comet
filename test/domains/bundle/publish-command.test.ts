import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  bundleDraftOptimizeCommand,
  bundleEvalRecordCommand,
  bundleListCommand,
  bundleStatusCommand,
} from '../../../app/commands/bundle.js';
import {
  publishApproveCommand,
  publishDistributeCommand,
  publishReviewCommand,
  publishRunCommand,
} from '../../../app/commands/publish.js';
import type { RepositoryEvalResult } from '../../../domains/bundle/eval.js';

async function writeBundle(root: string, name: string): Promise<void> {
  await fs.mkdir(path.join(root, 'skills', 'entry'), { recursive: true });
  await fs.mkdir(path.join(root, 'hooks'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'skills', 'entry', 'SKILL.md'),
    '---\nname: entry\ndescription: entry.\n---\n\n# entry\n',
  );
  await fs.writeFile(
    path.join(root, 'hooks', 'guard.yaml'),
    `event: before_write
matcher: Write|Edit
script: guard
failure: block
requiresConfirmation: false
`,
  );
  await fs.writeFile(path.join(root, 'scripts', 'guard.mjs'), 'process.exit(0);\n');
  await fs.writeFile(
    path.join(root, 'bundle.yaml'),
    `apiVersion: comet/v1alpha1
kind: SkillBundle
metadata:
  name: ${name}
  version: 1.0.0
  description: Publish facade fixture
  defaultLocale: en
  locales: [en]
skills:
  - id: entry
    path: skills/entry
    visibility: entry
resources:
  rules: []
  hooks:
    - id: guard
      path: hooks/guard.yaml
  references: []
  scripts:
    - id: guard
      path: scripts/guard.mjs
      sideEffect: read
      runtime: node
  assets: []
platforms:
  requires: [skills, hooks]
  optional: []
  overrides: []
engine:
  enabled: false
`,
  );
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
    summary: 'Publish facade gates passed.',
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

describe('Bundle and publish command facades', () => {
  let root: string;
  let projectRoot: string;
  let sourceRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-publish-command-'));
    projectRoot = path.join(root, 'project');
    sourceRoot = path.join(root, 'source');
    await writeBundle(sourceRoot, 'publish-facade');
    await bundleDraftOptimizeCommand(sourceRoot, { project: projectRoot, json: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('lists and inspects general Bundle drafts through the Bundle facade', async () => {
    const listed = await captureJson(() => bundleListCommand({ project: projectRoot, json: true }));
    const status = await captureJson(() =>
      bundleStatusCommand('publish-facade', { project: projectRoot, json: true }),
    );

    expect(listed).toMatchObject({
      bundles: [
        expect.objectContaining({
          resumeSummary: expect.objectContaining({
            currentStep: 'needs-eval',
          }),
        }),
      ],
    });
    expect(status).toMatchObject({
      name: 'publish-facade',
      status: 'draft',
      nextAction: { action: 'choose-eval-level' },
      resumeSummary: expect.objectContaining({
        recommendedNextStep: expect.objectContaining({
          category: 'eval',
        }),
      }),
    });

    const text = await captureText(() =>
      bundleStatusCommand('publish-facade', { project: projectRoot }),
    );
    expect(text).toContain('Found an unfinished Bundle');
    expect(text).toContain('Still needed:');
    expect(text).toContain('Current step: needs-eval');
    expect(text).toContain('Suggested user command:');
    expect(text).not.toContain('choose-benchmark-level');
    expect(text).not.toContain('needs-benchmark');
    expect(text).not.toContain('Run a benchmark');
    expect(text).not.toContain('Benchmark: missing');
    expect(text).not.toContain('benchmark-record');
  });

  it('reviews, approves, publishes, and distributes through the facade', async () => {
    const status = await captureJson(() =>
      bundleStatusCommand('publish-facade', { project: projectRoot, json: true }),
    );
    const resultFile = path.join(root, 'eval.json');
    await fs.writeFile(resultFile, JSON.stringify(passingResult(String(status.currentHash))));
    await bundleEvalRecordCommand('publish-facade', {
      project: projectRoot,
      result: resultFile,
      json: true,
    });

    const review = await captureJson(() =>
      publishReviewCommand('publish-facade', {
        project: projectRoot,
        platform: 'claude',
        json: true,
      }),
    );
    const approved = await captureJson(() =>
      publishApproveCommand('publish-facade', {
        project: projectRoot,
        reviewer: 'alice',
        json: true,
      }),
    );
    const publishableReviewText = await captureText(() =>
      publishReviewCommand('publish-facade', {
        project: projectRoot,
        platform: 'claude',
      }),
    );
    const published = await captureJson(() =>
      publishRunCommand('publish-facade', {
        project: projectRoot,
        platform: 'claude',
        json: true,
      }),
    );
    const publishedReviewText = await captureText(() =>
      publishReviewCommand('publish-facade', {
        project: projectRoot,
        platform: 'claude',
      }),
    );
    const distributed = await captureJson(() =>
      publishDistributeCommand('publish-facade', {
        project: projectRoot,
        platform: ['claude'],
        scope: 'project',
        confirmExecutables: true,
        json: true,
      }),
    );

    expect(review).toMatchObject({
      name: 'publish-facade',
      readiness: { state: 'reviewable' },
    });

    const reviewText = await captureText(() =>
      publishReviewCommand('publish-facade', {
        project: projectRoot,
        platform: 'claude',
      }),
    );
    expect(reviewText).toContain('Validate this Skill');
    expect(reviewText).toContain('Next steps:');

    expect(approved).toMatchObject({ status: 'review-approved' });
    expect(publishableReviewText).toContain('Validate this Skill: ready for the next step');
    expect(publishableReviewText).toContain('Next steps:');
    expect(published).toMatchObject({ status: 'ready' });
    expect(publishedReviewText).toContain('Validate this Skill: ready for the next step');
    expect(publishedReviewText).toContain('Next steps:');
    expect(distributed).toMatchObject({
      platforms: [
        {
          platform: 'claude',
          status: 'installed',
          executableDisclosures: [
            expect.objectContaining({
              id: expect.stringContaining('guard'),
              sideEffect: 'read',
            }),
          ],
          plannedFiles: expect.arrayContaining([
            expect.objectContaining({ kind: 'skill' }),
            expect.objectContaining({ kind: 'hook' }),
            expect.objectContaining({ kind: 'script' }),
          ]),
        },
      ],
    });

    const text = await captureText(() =>
      publishDistributeCommand('publish-facade', {
        project: projectRoot,
        platform: ['claude'],
        scope: 'project',
        confirmExecutables: true,
      }),
    );

    expect(text).toContain('Install result');
    expect(text).toContain('claude: installed');
    expect(text).toContain('Executable disclosures:');
  });

  it('previews publish distribution through the facade without writing files', async () => {
    const status = await captureJson(() =>
      bundleStatusCommand('publish-facade', { project: projectRoot, json: true }),
    );
    const resultFile = path.join(root, 'eval-preview.json');
    await fs.writeFile(resultFile, JSON.stringify(passingResult(String(status.currentHash))));
    await bundleEvalRecordCommand('publish-facade', {
      project: projectRoot,
      result: resultFile,
      json: true,
    });
    await publishApproveCommand('publish-facade', {
      project: projectRoot,
      reviewer: 'alice',
      json: true,
    });
    await publishRunCommand('publish-facade', {
      project: projectRoot,
      platform: 'claude',
      json: true,
    });

    const preview = await captureJson(() =>
      publishDistributeCommand('publish-facade', {
        project: projectRoot,
        platform: ['claude'],
        scope: 'project',
        preview: true,
        json: true,
      }),
    );

    expect(preview).toMatchObject({
      preview: true,
      platforms: [
        expect.objectContaining({
          status: 'planned',
          written: [],
          plannedFiles: expect.arrayContaining([expect.objectContaining({ kind: 'hook' })]),
        }),
      ],
    });

    const text = await captureText(() =>
      publishDistributeCommand('publish-facade', {
        project: projectRoot,
        platform: ['claude'],
        scope: 'project',
        preview: true,
      }),
    );
    expect(text).toContain('Install preview');
    expect(text).toContain('No files were written');
  });
});
