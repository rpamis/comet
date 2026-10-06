import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from 'yaml';
import { optimizeBundleDraft } from '../../../domains/bundle/draft.js';
import { recordBundleEval, type RepositoryEvalResult } from '../../../domains/bundle/eval.js';

import { publishBundle, reviewBundle } from '../../../domains/bundle/publish.js';
import { reconcileBundleAuthoringState } from '../../../domains/bundle/state.js';
import type { BundleAuthoringState } from '../../../domains/bundle/types.js';

async function writeBundle(root: string, name: string, requiresHooks = false): Promise<void> {
  await fs.mkdir(path.join(root, 'skills', 'entry'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'bundle.yaml'),
    `apiVersion: comet/v1alpha1
kind: SkillBundle
metadata:
  name: ${name}
  version: 1.0.0
  description: Publish fixture
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
  requires: [skills${requiresHooks ? ', hooks' : ''}]
  optional: []
  overrides: []
engine:
  enabled: false
`,
  );
  await fs.writeFile(
    path.join(root, 'skills', 'entry', 'SKILL.md'),
    '---\nname: entry\ndescription: Publish entry.\n---\n\n# Entry\n',
  );
}

function passingResult(hash: string, evalManifestHash = 'b'.repeat(64)): RepositoryEvalResult {
  return {
    schemaVersion: 2,
    provider: 'comet-eval',
    level: 'quick',
    draftHash: hash,
    evalManifestHash,
    tasks: ['generic-skill-smoke'],
    treatments: ['entry'],
    passAtK: { '1': 1 },
    weightedScore: { overall: 1 },
    instabilityGap: { overall: 0 },
    failures: [],
    reports: ['eval-report.html'],
    passed: true,
    summary: 'Publish gates passed.',
  };
}

describe('Bundle review and publish', () => {
  let root: string;
  let projectRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-bundle-publish-'));
    projectRoot = path.join(root, 'project');
    await createDraft('publish-bundle');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('requires eval-passed before approval and binds reviewer, time, and current hash', async () => {
    await expect(
      reviewBundle({
        projectRoot,
        name: 'publish-bundle',
        decision: 'approved',
        reviewer: 'alice',
      }),
    ).rejects.toThrow(/eval-passed/iu);

    const evaluated = await recordPassingEval('publish-bundle');
    const reviewed = await reviewBundle({
      projectRoot,
      name: 'publish-bundle',
      decision: 'approved',
      reviewer: 'alice',
    });

    expect(reviewed).toMatchObject({
      status: 'review-approved',
      review: {
        hash: evaluated.currentHash,
        decision: 'approved',
        reviewer: 'alice',
        at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      },
    });
  });

  it('records rejection and returns the Bundle to draft', async () => {
    const evaluated = await recordPassingEval('publish-bundle');

    const rejected = await reviewBundle({
      projectRoot,
      name: 'publish-bundle',
      decision: 'rejected',
      reviewer: 'bob',
    });

    expect(rejected).toMatchObject({
      status: 'draft',
      currentHash: evaluated.currentHash,
      review: {
        hash: evaluated.currentHash,
        decision: 'rejected',
        reviewer: 'bob',
      },
    });
  });

  it('invalidates approval when content changes after review', async () => {
    await recordPassingEval('publish-bundle');
    const reviewed = await reviewBundle({
      projectRoot,
      name: 'publish-bundle',
      decision: 'approved',
      reviewer: 'alice',
    });
    await fs.appendFile(path.join(reviewed.draftPath, 'skills', 'entry', 'SKILL.md'), 'changed\n');

    const reconciled = await reconcileBundleAuthoringState(projectRoot, 'publish-bundle');

    expect(reconciled.status).toBe('draft');
    expect(reconciled.review).toBeUndefined();
    expect(reconciled.eval).toBeUndefined();
  });

  it('reruns reference-platform compilation and refuses unsupported required capabilities', async () => {
    await createDraft('hook-bundle', true);
    await recordPassingEval('hook-bundle');
    await reviewBundle({
      projectRoot,
      name: 'hook-bundle',
      decision: 'approved',
      reviewer: 'alice',
    });

    await expect(
      publishBundle({
        projectRoot,
        name: 'hook-bundle',
        referencePlatform: 'cursor',
      }),
    ).rejects.toThrow(/required.*hooks|hooks.*required/iu);
  });

  it('publishes atomically, marks ready, and copies only the draft Bundle', async () => {
    await recordPassingEval('publish-bundle');
    await reviewBundle({
      projectRoot,
      name: 'publish-bundle',
      decision: 'approved',
      reviewer: 'alice',
    });

    const ready = await publishBundle({
      projectRoot,
      name: 'publish-bundle',
      referencePlatform: 'claude',
    });

    expect(ready).toMatchObject({
      status: 'ready',
      ready: {
        hash: ready.currentHash,
        path: path.join(projectRoot, '.comet', 'bundles', 'publish-bundle'),
        publishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      },
    });
    await expect(fs.access(path.join(ready.ready!.path, 'bundle.yaml'))).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(ready.ready!.path, '.comet', 'bundle-authoring')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(ready.ready!.path, '.comet', 'bundle-evals')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses an existing published target unless overwrite is explicit', async () => {
    await recordPassingEval('publish-bundle');
    await reviewBundle({
      projectRoot,
      name: 'publish-bundle',
      decision: 'approved',
      reviewer: 'alice',
    });
    const destination = path.join(projectRoot, '.comet', 'bundles', 'publish-bundle');
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, 'keep.txt'), 'existing\n');

    await expect(
      publishBundle({
        projectRoot,
        name: 'publish-bundle',
        referencePlatform: 'claude',
      }),
    ).rejects.toThrow(/already exists.*overwrite/iu);
    await expect(fs.readFile(path.join(destination, 'keep.txt'), 'utf8')).resolves.toBe(
      'existing\n',
    );
  });

  it('replaces an existing published Bundle when overwrite is explicit', async () => {
    await recordPassingEval('publish-bundle');
    await reviewBundle({
      projectRoot,
      name: 'publish-bundle',
      decision: 'approved',
      reviewer: 'alice',
    });
    const destination = path.join(projectRoot, '.comet', 'bundles', 'publish-bundle');
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, 'keep.txt'), 'previous\n');

    const ready = await publishBundle({
      projectRoot,
      name: 'publish-bundle',
      referencePlatform: 'claude',
      overwrite: true,
    });

    expect(ready.status).toBe('ready');
    await expect(fs.access(path.join(destination, 'bundle.yaml'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(destination, 'keep.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(
      (await fs.readdir(path.dirname(destination))).some((entry) => entry.includes('.backup-')),
    ).toBe(false);
  });

  it('rolls back the previous published Bundle when overwrite replacement fails', async () => {
    await recordPassingEval('publish-bundle');
    await reviewBundle({
      projectRoot,
      name: 'publish-bundle',
      decision: 'approved',
      reviewer: 'alice',
    });
    const destination = path.join(projectRoot, '.comet', 'bundles', 'publish-bundle');
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, 'keep.txt'), 'previous\n');

    const originalRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (
        path.basename(String(from)).startsWith('.publish-bundle.') &&
        path.basename(String(from)).endsWith('.tmp') &&
        String(to) === destination
      ) {
        throw new Error('simulated replacement failure');
      }
      return originalRename(from, to);
    });

    await expect(
      publishBundle({
        projectRoot,
        name: 'publish-bundle',
        referencePlatform: 'claude',
        overwrite: true,
      }),
    ).rejects.toThrow('simulated replacement failure');
    await expect(fs.readFile(path.join(destination, 'keep.txt'), 'utf8')).resolves.toBe(
      'previous\n',
    );
    expect(
      (await fs.readdir(path.dirname(destination))).some((entry) => entry.includes('.backup-')),
    ).toBe(false);
  });

  async function createDraft(name: string, requiresHooks = false) {
    const sourceRoot = path.join(root, `${name}-source`);
    await writeBundle(sourceRoot, name, requiresHooks);
    return optimizeBundleDraft({
      projectRoot,
      name,
      sourceRoot,
      candidates: [],
      defaultLocale: 'en',
      locales: ['en'],
      engineEnabled: false,
    });
  }

  async function recordPassingEval(
    name: string,
    createResult: (
      hash: string,
      entry: string,
      evalManifestHash: string,
    ) => RepositoryEvalResult = (hash, _entry, evalManifestHash) =>
      passingResult(hash, evalManifestHash),
  ) {
    const state = await reconcileBundleAuthoringState(projectRoot, name);
    const evalManifestHash = 'b'.repeat(64);
    const resultFile = path.join(root, `${name}-eval.json`);
    await fs.writeFile(
      resultFile,
      JSON.stringify(createResult(state.currentHash!, name, evalManifestHash), null, 2),
    );
    return recordBundleEval(projectRoot, name, resultFile);
  }
});
