import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from 'yaml';
import { createBundleDraft } from '../../../domains/bundle/draft.js';
import { buildReadinessUserSummary } from '../../../domains/bundle/readiness-user-summary.js';
import { buildBundleReviewSummary } from '../../../domains/bundle/review-summary.js';
import {
  reconcileBundleAuthoringState,
  writeBundleAuthoringState,
} from '../../../domains/bundle/state.js';

async function writeMinimalBundle(root: string, name: string): Promise<void> {
  await fs.mkdir(path.join(root, 'skills', name), { recursive: true });
  await fs.writeFile(
    path.join(root, 'skills', name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Demo.\n---\n\n# ${name}\n`,
  );
  await fs.writeFile(
    path.join(root, 'bundle.yaml'),
    `apiVersion: comet/v1alpha1
kind: SkillBundle
metadata:
  name: ${name}
  version: 1.0.0
  description: Demo
  defaultLocale: en
  locales: [en]
skills:
  - id: ${name}
    path: skills/${name}
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

describe('Bundle review summary readiness', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-review-summary-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('requires current eval and review hashes before a general Bundle becomes publishable', async () => {
    const state = await createBundleDraft({
      projectRoot,
      name: 'general',
      candidates: [],
      defaultLocale: 'en',
      locales: ['en'],
      engineEnabled: false,
    });
    await writeMinimalBundle(state.draftPath, 'general');
    const current = await reconcileBundleAuthoringState(projectRoot, 'general');
    const review = {
      hash: current.currentHash!,
      decision: 'approved' as const,
      reviewer: 'human',
      at: '2026-10-06T00:00:00Z',
    };
    const evalEvidence = {
      level: 'quick' as const,
      hash: current.currentHash!,
      resultPath: path.join(projectRoot, 'result.json'),
      passed: true,
    };
    await writeBundleAuthoringState(projectRoot, {
      ...current,
      status: 'review-approved',
      review,
      eval: evalEvidence,
    });
    expect(
      (await buildBundleReviewSummary({ projectRoot, name: 'general', platform: 'codex' }))
        .readiness.state,
    ).toBe('publishable');
    await writeBundleAuthoringState(projectRoot, {
      ...current,
      status: 'review-approved',
      review: { ...review, hash: 'b'.repeat(64) },
      eval: evalEvidence,
    });
    expect(
      (await buildBundleReviewSummary({ projectRoot, name: 'general', platform: 'codex' }))
        .readiness.state,
    ).toBe('reviewable');
    await writeBundleAuthoringState(projectRoot, {
      ...current,
      status: 'review-approved',
      review,
      eval: { ...evalEvidence, hash: 'b'.repeat(64) },
    });
    expect(
      (await buildBundleReviewSummary({ projectRoot, name: 'general', platform: 'codex' }))
        .readiness.state,
    ).toBe('blocked');
  });

  it('blocks readiness when repository eval evidence is below quality gates', async () => {
    await createBundleDraft({
      projectRoot,
      name: 'repo-eval-failed',
      candidates: [],
      defaultLocale: 'en',
      locales: ['en'],
      engineEnabled: true,
    });
    const draftPath = path.join(projectRoot, '.comet', 'bundle-drafts', 'repo-eval-failed');
    await writeMinimalBundle(draftPath, 'repo-eval-failed');
    const state = await reconcileBundleAuthoringState(projectRoot, 'repo-eval-failed');
    const evalResult = path.join(projectRoot, 'repo-eval-failed-result.json');
    await fs.writeFile(
      evalResult,
      JSON.stringify(
        {
          schemaVersion: 2,
          provider: 'comet-eval',
          level: 'full',
          draftHash: state.currentHash,
          evalManifestHash: 'c'.repeat(64),
          tasks: ['entry-smoke'],
          treatments: ['generated-skill'],
          passAtK: { '1': 0 },
          weightedScore: { overall: 0.42 },
          instabilityGap: { overall: 0.2 },
          failures: ['entry-smoke failed'],
          reports: ['eval-report.html'],
          passed: false,
          summary: 'Repository eval failed entry smoke.',
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeBundleAuthoringState(projectRoot, {
      ...state,
      eval: {
        level: 'full',
        hash: state.currentHash!,
        resultPath: evalResult,
        passed: false,
      },
    });

    const summary = await buildBundleReviewSummary({
      projectRoot,
      name: 'repo-eval-failed',
      platform: 'claude',
    });

    expect(summary.readiness.blockers).toContain(
      '[eval] Eval evidence is below publish quality gates: Repository eval failed entry smoke.',
    );
    expect(summary.readiness.evidence.evalResult).toBe(evalResult);
  });

  it('blocks readiness when repository eval result failures conflict with state', async () => {
    await createBundleDraft({
      projectRoot,
      name: 'repo-eval-conflict',
      candidates: [],
      defaultLocale: 'en',
      locales: ['en'],
      engineEnabled: true,
    });
    const draftPath = path.join(projectRoot, '.comet', 'bundle-drafts', 'repo-eval-conflict');
    await writeMinimalBundle(draftPath, 'repo-eval-conflict');
    const state = await reconcileBundleAuthoringState(projectRoot, 'repo-eval-conflict');
    const evalResult = path.join(projectRoot, 'repo-eval-conflict-result.json');
    await fs.writeFile(
      evalResult,
      JSON.stringify(
        {
          schemaVersion: 2,
          provider: 'comet-eval',
          level: 'full',
          draftHash: state.currentHash,
          evalManifestHash: 'd'.repeat(64),
          tasks: ['entry-smoke'],
          treatments: ['generated-skill'],
          passAtK: { '1': 1 },
          weightedScore: { overall: 0.91 },
          instabilityGap: { overall: 0.03 },
          failures: ['quality gate failed after retry'],
          reports: ['eval-report.html'],
          passed: true,
          summary: 'Repository eval reported a quality gate failure.',
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeBundleAuthoringState(projectRoot, {
      ...state,
      status: 'eval-passed',
      eval: {
        level: 'full',
        hash: state.currentHash!,
        resultPath: evalResult,
        passed: true,
      },
    });

    const summary = await buildBundleReviewSummary({
      projectRoot,
      name: 'repo-eval-conflict',
      platform: 'claude',
    });

    expect(summary.readiness.blockers).toContain(
      '[eval] Eval evidence is below publish quality gates: Repository eval reported a quality gate failure.',
    );
  });

  it('adds fallback next steps for publishable and published states without user-summary items', () => {
    expect(
      buildReadinessUserSummary('ready-bundle', {
        state: 'publishable',
        blockers: [],
        warnings: [],
        evidence: {},
      }).nextSteps,
    ).toEqual([
      {
        label: 'Publish the approved candidate',
        command: 'comet publish run ready-bundle --platform <reference-platform>',
      },
    ]);

    expect(
      buildReadinessUserSummary('ready-bundle', {
        state: 'published',
        blockers: [],
        warnings: [],
        evidence: {},
      }).nextSteps,
    ).toEqual([
      {
        label: 'Preview distribution before installing into Agent platforms',
        command:
          'comet publish distribute ready-bundle --platform <platform> --scope project --preview',
      },
    ]);
  });
});
