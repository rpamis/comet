import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  collectClassicEvidence,
  evidenceSatisfied,
} from '../../../domains/comet-classic/classic-evidence.js';
import type { ClassicStateProjection } from '../../../domains/comet-classic/classic-state.js';
import type { RunState } from '../../../domains/engine/types.js';

function runState(): RunState {
  return {
    runId: 'run-evidence',
    skill: 'comet-classic',
    skillVersion: '1',
    skillHash: 'a'.repeat(64),
    orchestration: 'deterministic',
    currentStep: 'full.build.execute',
    iteration: 0,
    pending: null,
    pendingRef: '.comet/pending-action.json',
    trajectoryRef: '.comet/trajectory.jsonl',
    contextRef: '.comet/context.md',
    artifactsRef: '.comet/artifacts.json',
    checkpointRef: '.comet/checkpoint.json',
    status: 'running',
    retries: {},
  };
}

describe('Classic evidence collection', () => {
  let projectRoot: string;
  let changeDir: string;
  let projection: ClassicStateProjection;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-evidence-'));
    changeDir = path.join(projectRoot, 'openspec', 'changes', 'demo');
    await fs.mkdir(path.join(changeDir, 'specs', 'demo'), { recursive: true });
    projection = {
      classic: {
        workflow: 'full',
        phase: 'build',
        contextCompression: 'off',
        buildMode: 'executing-plans',
        buildPause: null,
        subagentDispatch: null,
        tddMode: 'tdd',
        isolation: 'worktree',
        verifyMode: 'full',
        autoTransition: true,
        baseRef: null,
        designDoc: 'docs/superpowers/specs/demo-design.md',
        plan: 'docs/superpowers/plans/demo-plan.md',
        verifyResult: 'pass',
        verificationReport: 'docs/superpowers/verification/demo.md',
        branchStatus: 'handled',
        createdAt: '2026-06-14',
        verifiedAt: '2026-06-14',
        archiveConfirmation: null,
        archived: false,
        directOverride: null,
        handoffContext: 'openspec/changes/demo/.comet/handoff/context.json',
        handoffHash: 'b'.repeat(64),
        classicProfile: 'full',
        classicMigration: 1,
      },
      run: runState(),
      unknownKeys: [],
    };
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('collects structured evidence with stable codes and source paths', async () => {
    await Promise.all([
      fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n'),
      fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n'),
      fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] first\n- [x] second\n'),
      fs.writeFile(path.join(changeDir, 'specs', 'demo', 'spec.md'), '# Spec\n'),
      writeProjectFile('docs/superpowers/specs/demo-design.md', '# Design Doc\n'),
      writeProjectFile('docs/superpowers/plans/demo-plan.md', '# Plan\n'),
      writeProjectFile('docs/superpowers/verification/demo.md', '# Verified\n'),
      writeProjectFile('openspec/changes/demo/.comet/handoff/context.json', '{"context":true}\n'),
      fs
        .mkdir(path.join(changeDir, '.comet'), { recursive: true })
        .then(() => fs.writeFile(path.join(changeDir, '.comet', 'checkpoint.json'), '{}\n')),
    ]);

    const evidence = await collectClassicEvidence(changeDir, projection);

    for (const code of [
      'openspec.proposal',
      'openspec.design',
      'openspec.tasks',
      'openspec.delta-spec',
      'design.document',
      'build.plan',
      'build.tasks-complete',
      'verification.report',
      'design.handoff',
      'run.checkpoint',
    ]) {
      expect(evidenceSatisfied(evidence, code), code).toBe(true);
    }
    expect(evidence.find((item) => item.code === 'build.plan')?.source).toBe(
      'docs/superpowers/plans/demo-plan.md',
    );
  });

  it('reports incomplete task evidence without treating prose as a task', async () => {
    await fs.writeFile(
      path.join(changeDir, 'tasks.md'),
      ['Implementation notes', '- [x] complete', '- [ ] remaining', ''].join('\n'),
    );

    const evidence = await collectClassicEvidence(changeDir, projection);
    const tasks = evidence.find((item) => item.code === 'build.tasks-complete');

    expect(tasks).toMatchObject({
      satisfied: false,
      detail: '1 of 2 tasks complete',
    });
  });

  it('marks optional linked evidence missing without throwing', async () => {
    const evidence = await collectClassicEvidence(changeDir, projection);

    expect(evidenceSatisfied(evidence, 'design.document')).toBe(false);
    expect(evidenceSatisfied(evidence, 'build.plan')).toBe(false);
    expect(evidenceSatisfied(evidence, 'verification.report')).toBe(false);
    expect(evidenceSatisfied(evidence, 'design.handoff')).toBe(false);
    expect(evidenceSatisfied(evidence, 'run.checkpoint')).toBe(false);
  });

  it('derives archive confirmation evidence from Classic state', async () => {
    projection.classic!.archiveConfirmation = 'confirmed';

    const evidence = await collectClassicEvidence(changeDir, projection);

    expect(evidenceSatisfied(evidence, 'archive.confirmed')).toBe(true);
  });

  async function writeProjectFile(relativePath: string, content: string): Promise<void> {
    const file = path.join(projectRoot, relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
});
