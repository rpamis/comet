import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRepositoryEvalResult,
  recordRepositoryEvalExperiment,
} from '../../../domains/bundle/eval-run-result.js';

const temporary: string[] = [];

async function createExperiment(options: { weightedScore?: number; passed?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-result-test-'));
  temporary.push(root);
  const experimentDir = path.join(root, 'experiment');
  const reportsDir = path.join(experimentDir, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const weightedScore = options.weightedScore ?? 0.84;
  const passed = options.passed ?? true;
  await fs.writeFile(
    path.join(experimentDir, 'expected-case-matrix.json'),
    JSON.stringify({
      schema: 'comet.eval.expected-case-matrix.v1',
      matrix_hash: 'sha256:fixture',
      cases: [
        { task: 'authoring-skill-smoke', treatment: 'CONTROL', rep: 1 },
        { task: 'authoring-skill-smoke', treatment: 'DYNAMIC_SKILL', rep: 1 },
      ],
    }),
  );
  await fs.writeFile(
    path.join(reportsDir, 'authoring_skill_smoke_CONTROL_r1_rep1_report.json'),
    JSON.stringify({
      name: 'authoring-skill-smoke-CONTROL-r1',
      passed: false,
      checks_passed: [],
      checks_failed: ['expected baseline failure'],
      rep: 1,
    }),
  );
  await fs.writeFile(
    path.join(reportsDir, 'authoring_skill_smoke_DYNAMIC_SKILL_r1_rep1_report.json'),
    JSON.stringify({
      name: 'authoring-skill-smoke-DYNAMIC_SKILL-r1',
      passed,
      checks_passed: [`[RUBRIC] weighted_score: ${weightedScore.toFixed(2)}`],
      checks_failed: passed ? [] : ['dynamic validation failed'],
      rep: 1,
    }),
  );
  await fs.writeFile(
    path.join(experimentDir, 'metadata.json'),
    JSON.stringify({
      report_outputs: {
        markdown: path.join(experimentDir, 'summary.md'),
        html: path.join(experimentDir, 'summary.html'),
      },
    }),
  );
  return experimentDir;
}

const manifestSource = `apiVersion: comet.eval/v1alpha1
kind: SkillEvalManifest
metadata:
  name: demo
  draftHash: <current-bundle-hash>
evaluation:
  recommendedTasks: [authoring-skill-smoke]
  baselineTreatments: [CONTROL]
  qualityGates:
    minWeightedScore: 0.8
    minPassAt1: 0.6
    maxInstabilityGap: 0.4
`;

const context = {
  projectRoot: '/project',
  name: 'demo',
  draftHash: 'a'.repeat(64),
  evalManifestHash: createHash('sha256').update(manifestSource).digest('hex'),
  sourceManifestPath: '/project/.comet/bundle-drafts/demo/skills/demo/comet/eval.yaml',
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('repository eval result generation', () => {
  it('ignores observational baseline failures and applies manifest quality gates to treatments', async () => {
    const experimentDir = await createExperiment();

    const result = await buildRepositoryEvalResult({
      context,
      experimentDir,
      level: 'quick',
      manifestSource,
    });

    expect(result).toMatchObject({
      schemaVersion: 2,
      provider: 'comet-eval',
      draftHash: context.draftHash,
      evalManifestHash: context.evalManifestHash,
      tasks: ['authoring-skill-smoke'],
      treatments: ['CONTROL', 'DYNAMIC_SKILL'],
      passAtK: { 'authoring-skill-smoke': 1 },
      weightedScore: { 'authoring-skill-smoke': 0.84 },
      instabilityGap: { 'authoring-skill-smoke': 0 },
      failures: [],
      passed: true,
    });
  });

  it('records explicit gate failures for the current draft instead of claiming success', async () => {
    const experimentDir = await createExperiment({ weightedScore: 0.72 });

    const result = await buildRepositoryEvalResult({
      context,
      experimentDir,
      level: 'quick',
      manifestSource,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      'authoring-skill-smoke weighted score 0.72 is below required 0.8',
    );
  });

  it('delegates the generated structured evidence to the Bundle recorder', async () => {
    const experimentDir = await createExperiment();
    const resultFile = path.join(temporary[0], 'recorded-result.json');
    const record = vi.fn().mockResolvedValue({ status: 'eval-passed' });

    const state = await recordRepositoryEvalExperiment(
      {
        context,
        experimentDir,
        level: 'quick',
        manifestSource,
      },
      { record, resultFile },
    );

    expect(record).toHaveBeenCalledWith(context.projectRoot, context.name, resultFile);
    expect(JSON.parse(await fs.readFile(resultFile, 'utf8'))).toMatchObject({
      draftHash: context.draftHash,
      passed: true,
    });
    expect(state).toEqual({ status: 'eval-passed' });
  });
});
