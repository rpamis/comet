import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ensureClassicRun } from '../../../domains/comet-classic/classic-migrate.js';
import {
  readClassicState,
  writeClassicState,
} from '../../../domains/comet-classic/classic-store.js';
import type { ClassicState } from '../../../domains/comet-classic/classic-state.js';
import {
  readArtifacts,
  readCheckpoint,
  readContext,
  readTrajectory,
} from '../../../domains/engine/run-store.js';
import type { SkillPackage } from '../../../domains/skill/types.js';

const stableSteps = [
  'full.open',
  'full.design.handoff',
  'full.design.document',
  'full.build.plan',
  'full.build.plan-ready',
  'full.build.configure',
  'full.build.execute',
  'full.build.complete',
  'full.build.fix',
  'full.verify.run',
  'full.verify.branch',
  'full.archive.confirm',
  'full.archive.execute',
  'hotfix.open',
  'hotfix.build.execute',
  'hotfix.build.complete',
  'hotfix.verify.run',
  'hotfix.verify.branch',
  'hotfix.archive.confirm',
  'hotfix.archive.execute',
  'tweak.open',
  'tweak.build.execute',
  'tweak.build.complete',
  'tweak.verify.run',
  'tweak.verify.branch',
  'tweak.archive.confirm',
  'tweak.archive.execute',
  'completed',
];

function classic(overrides: Partial<ClassicState> = {}): ClassicState {
  return {
    workflow: 'full',
    phase: 'open',
    contextCompression: 'off',
    buildMode: null,
    buildPause: null,
    subagentDispatch: null,
    tddMode: null,
    isolation: null,
    verifyMode: null,
    autoTransition: true,
    baseRef: null,
    designDoc: null,
    plan: null,
    verifyResult: 'pending',
    verifyFailures: 0,
    verificationReport: null,
    branchStatus: 'pending',
    createdAt: '2026-06-14',
    verifiedAt: null,
    archiveConfirmation: null,
    archived: false,
    directOverride: null,
    handoffContext: null,
    handoffHash: null,
    classicProfile: null,
    classicMigration: null,
    ...overrides,
  };
}

describe('Classic legacy migration', () => {
  let projectRoot: string;
  let changeDir: string;
  let skillRoot: string;
  let pkg: SkillPackage;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-migrate-'));
    changeDir = path.join(projectRoot, 'openspec', 'changes', 'demo');
    skillRoot = path.join(projectRoot, 'classic-skill');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Classic\n');
    pkg = classicPackage(skillRoot);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it.each([
    ['full', 'full.open'],
    ['hotfix', 'hotfix.open'],
    ['tweak', 'tweak.open'],
  ] as const)('migrates a legacy %s change', async (workflow, expectedStep) => {
    await writeClassicState(changeDir, {
      classic: classic({ workflow }),
      run: null,
    });

    const result = await ensureClassicRun(changeDir, {
      skillPackage: pkg,
      runId: () => `run-${workflow}`,
      now: () => new Date('2026-06-14T00:00:00.000Z'),
    });
    const projection = await readClassicState(changeDir);

    expect(result.migrated).toBe(true);
    expect(projection.classic).toMatchObject({
      classicProfile: workflow,
      classicMigration: 1,
    });
    expect(projection.run).toMatchObject({
      runId: `run-${workflow}`,
      skill: 'comet-classic',
      currentStep: expectedStep,
    });
  });

  it('imports handoff context and delegated progress into Run storage', async () => {
    const handoff = 'openspec/changes/demo/.comet/handoff/context.json';
    const progress = path.join(changeDir, 'subagent-progress.md');
    await writeProjectFile(handoff, '{"handoff":true}\n');
    await fs.writeFile(progress, '# Progress\n');
    await writeClassicState(changeDir, {
      classic: classic({
        phase: 'design',
        handoffContext: handoff,
        handoffHash: 'b'.repeat(64),
      }),
      run: null,
    });

    const result = await ensureClassicRun(changeDir, {
      skillPackage: pkg,
      runId: () => 'run-import',
      now: () => new Date('2026-06-14T00:00:00.000Z'),
    });

    expect(await readContext(changeDir, result.run.contextRef)).toBe('{"handoff":true}\n');
    expect(await readArtifacts(changeDir, result.run.artifactsRef)).toMatchObject({
      handoff_context: handoff,
      subagent_progress: 'openspec/changes/demo/subagent-progress.md',
    });
    expect(await readCheckpoint(changeDir, result.run.checkpointRef)).toMatchObject({
      runId: 'run-import',
      contextHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      artifactsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('is byte-idempotent and does not duplicate migration events', async () => {
    await writeClassicState(changeDir, { classic: classic(), run: null });
    const options = {
      skillPackage: pkg,
      runId: () => 'run-stable',
      now: () => new Date('2026-06-14T00:00:00.000Z'),
    };

    const first = await ensureClassicRun(changeDir, options);
    const yamlBefore = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');
    const trajectoryBefore = await fs.readFile(
      path.join(changeDir, first.run.trajectoryRef),
      'utf8',
    );
    const second = await ensureClassicRun(changeDir, options);

    expect(second.migrated).toBe(false);
    expect(second.run.runId).toBe('run-stable');
    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).toBe(yamlBefore);
    expect(await fs.readFile(path.join(changeDir, first.run.trajectoryRef), 'utf8')).toBe(
      trajectoryBefore,
    );
    expect(await readTrajectory(changeDir, first.run.trajectoryRef)).toHaveLength(2);
  });

  it('leaves state unchanged when the Skill snapshot cannot be created', async () => {
    await writeClassicState(changeDir, { classic: classic(), run: null });
    const before = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');
    await fs.rm(path.join(skillRoot, 'SKILL.md'));

    await expect(
      ensureClassicRun(changeDir, {
        skillPackage: pkg,
        runId: () => 'run-fail',
      }),
    ).rejects.toThrow('SKILL.md');

    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).toBe(before);
    await expect(fs.access(path.join(changeDir, '.comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('fails closed on contradictory legacy state without creating Run files', async () => {
    await writeClassicState(changeDir, {
      classic: classic({ phase: 'build', archived: true }),
      run: null,
    });
    const before = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

    await expect(
      ensureClassicRun(changeDir, {
        skillPackage: pkg,
        runId: () => 'run-contradiction',
      }),
    ).rejects.toThrow('archived=true requires phase=archive');

    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).toBe(before);
    expect((await readClassicState(changeDir)).run).toBeNull();
  });

  it('migrates old Classic state idempotently on repeated reads', async () => {
    await fs.writeFile(
      path.join(changeDir, '.comet.yaml'),
      `workflow: full
phase: build
context_compression: off
build_mode: executing-plans
build_pause: null
subagent_dispatch: null
tdd_mode: tdd
isolation: worktree
verify_mode: full
auto_transition: true
base_ref: null
design_doc: null
plan: docs/superpowers/plans/demo.md
verify_result: pending
verification_report: null
branch_status: pending
created_at: 2026-06-22
verified_at: null
archived: false
direct_override: null
handoff_context: null
handoff_hash: null
`,
    );

    const first = await ensureClassicRun(changeDir, { skillPackage: pkg });
    const afterFirst = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');
    const second = await ensureClassicRun(changeDir, { skillPackage: pkg });
    const afterSecond = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

    expect(second.run.runId).toBe(first.run.runId);
    expect(afterSecond).toBe(afterFirst);
  });

  it('accepts an existing Run whose stored hash points to its immutable old snapshot', async () => {
    await writeClassicState(changeDir, { classic: classic(), run: null });
    const first = await ensureClassicRun(changeDir, {
      skillPackage: pkg,
      runId: () => 'run-existing-snapshot',
      now: () => new Date('2026-06-14T00:00:00.000Z'),
    });

    const runtimeRoot = path.join(projectRoot, 'runtime-package');
    await fs.mkdir(runtimeRoot, { recursive: true });
    const runtimePackage: SkillPackage = {
      ...classicPackage(runtimeRoot),
      packageKind: 'runtime',
    };

    const second = await ensureClassicRun(changeDir, {
      skillPackage: runtimePackage,
      now: () => new Date('2026-06-15T00:00:00.000Z'),
    });

    expect(second.migrated).toBe(false);
    expect(second.run.runId).toBe(first.run.runId);
    expect(second.run.skillHash).toBe(first.run.skillHash);
    expect(second.snapshotDir).toBe(
      path.join(changeDir, '.comet', 'skill-snapshots', first.run.skillHash),
    );
  });

  async function writeProjectFile(relativePath: string, content: string): Promise<void> {
    const file = path.join(projectRoot, relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
});

function classicPackage(root: string): SkillPackage {
  return {
    root,
    definition: {
      apiVersion: 'comet/v1alpha1',
      kind: 'Skill',
      metadata: {
        name: 'comet-classic',
        version: '1',
        description: 'Classic compatibility',
      },
      goal: { statement: 'Complete Classic workflow', inputs: [], outputs: [], success: [] },
      orchestration: {
        mode: 'deterministic',
        entry: 'full.open',
        steps: stableSteps.map((id) => ({ id, action: { type: 'checkpoint' } })),
      },
      skills: [],
      agents: [],
      tools: [],
    },
    guardrails: {
      allowedSkills: [],
      allowedAgents: [],
      allowedTools: [],
      maxIterations: 100,
      maxRetriesPerAction: 3,
      confirmationRequiredFor: [],
    },
    evals: [],
  };
}
