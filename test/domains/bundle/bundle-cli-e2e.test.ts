import { spawnSync } from 'child_process';
import crypto from 'crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { RepositoryEvalResult } from '../../../domains/bundle/eval.js';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'comet.js');

async function writeBundle(root: string): Promise<void> {
  for (const entry of ['alpha', 'beta']) {
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
  name: e2e-bundle
  version: 1.0.0
  description: CLI E2E fixture
  defaultLocale: en
  locales: [en]
skills:
  - id: alpha
    path: skills/alpha
    visibility: entry
  - id: beta
    path: skills/beta
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

function passingResult(
  hash: string,
  entrySkills: string[] = ['alpha', 'beta'],
  evalManifestHash = 'b'.repeat(64),
): RepositoryEvalResult {
  return {
    schemaVersion: 2,
    provider: 'comet-eval',
    level: 'quick',
    draftHash: hash,
    evalManifestHash,
    tasks: ['generic-skill-smoke'],
    treatments: entrySkills,
    passAtK: { '1': 1 },
    weightedScore: { overall: 1 },
    instabilityGap: { overall: 0 },
    failures: [],
    reports: ['eval-report.html'],
    passed: true,
    summary: 'CLI E2E gates passed.',
  };
}

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

function runJson(...args: string[]): Record<string, unknown> {
  const result = runCli(...args, '--json');
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe('comet bundle CLI end to end', () => {
  let root: string;
  let projectRoot: string;
  let sourceRoot: string;

  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 120_000);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-bundle-cli-'));
    projectRoot = path.join(root, 'project');
    sourceRoot = path.join(root, 'source');
    await writeBundle(sourceRoot);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('optimizes, evaluates, approves, publishes, and distributes a Bundle', async () => {
    const draft = runJson('bundle', 'draft', 'optimize', sourceRoot, '--project', projectRoot);
    expect(draft).toMatchObject({ name: 'e2e-bundle', status: 'draft' });

    const status = runJson('bundle', 'status', 'e2e-bundle', '--project', projectRoot);
    expect(status).toMatchObject({ name: 'e2e-bundle', status: 'draft' });
    expect(status.currentHash).toMatch(/^[a-f0-9]{64}$/u);

    const compiled = runJson(
      'bundle',
      'compile',
      'e2e-bundle',
      '--project',
      projectRoot,
      '--platform',
      'claude',
    );
    expect(compiled).toMatchObject({
      platform: 'claude',
      entrySkills: ['alpha', 'beta'],
    });

    const evalPlan = runJson(
      'bundle',
      'eval-plan',
      'e2e-bundle',
      '--project',
      projectRoot,
      '--level',
      'quick',
    );
    expect(evalPlan).toMatchObject({ level: 'quick', tokenWorkload: 'low' });

    const resultFile = path.join(root, 'eval.json');
    await fs.writeFile(resultFile, JSON.stringify(passingResult(String(status.currentHash))));
    const evaluated = runJson(
      'bundle',
      'eval-record',
      'e2e-bundle',
      '--project',
      projectRoot,
      '--result',
      resultFile,
    );
    expect(evaluated).toMatchObject({ status: 'eval-passed' });

    const reviewed = runJson(
      'bundle',
      'review',
      'e2e-bundle',
      '--project',
      projectRoot,
      '--approve',
      '--reviewer',
      'alice',
    );
    expect(reviewed).toMatchObject({ status: 'review-approved' });

    const published = runJson(
      'bundle',
      'publish',
      'e2e-bundle',
      '--project',
      projectRoot,
      '--platform',
      'claude',
    );
    expect(published).toMatchObject({ status: 'ready' });

    const distributed = runJson(
      'bundle',
      'distribute',
      'e2e-bundle',
      '--project',
      projectRoot,
      '--platform',
      'claude',
      '--scope',
      'project',
    );
    expect(distributed).toMatchObject({
      platforms: [{ platform: 'claude', status: 'installed' }],
    });
    await expect(
      fs.access(path.join(projectRoot, '.claude', 'skills', 'alpha', 'SKILL.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(projectRoot, '.claude', 'skills', 'beta', 'SKILL.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(projectRoot, '.claude', 'skills', 'alpha', '.comet')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('lists recoverable authoring states through the built CLI', async () => {
    runJson('bundle', 'draft', 'create', 'recoverable-bundle', '--project', projectRoot);

    const listed = runJson('bundle', 'list', '--project', projectRoot);

    expect(listed).toMatchObject({
      bundles: [
        {
          name: 'recoverable-bundle',
          status: 'draft',
          nextAction: {
            action: 'choose-eval-level',
          },
        },
      ],
    });
  });
});
