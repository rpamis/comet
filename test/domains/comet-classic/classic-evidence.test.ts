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
    await writeClassicConfig('legacy');
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
        verifyFailures: 0,
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

  it('does not satisfy linked evidence with a project traversal pointer', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-outside-'));
    try {
      const outsideReport = path.join(outsideRoot, 'verification.md');
      await fs.writeFile(outsideReport, '# Outside\n');
      projection.classic!.verificationReport = path.relative(projectRoot, outsideReport);

      const evidence = await collectClassicEvidence(changeDir, projection);
      const report = evidence.find((item) => item.code === 'verification.report');

      expect(report).toMatchObject({
        satisfied: false,
        source: projection.classic!.verificationReport!.replaceAll('\\', '/'),
      });
      expect(report?.detail).toContain('outside the project');
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not satisfy linked evidence through a junction outside the project', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-outside-'));
    const linkedDirectory = path.join(projectRoot, 'docs', 'linked-reports');
    try {
      await fs.writeFile(path.join(outsideRoot, 'verification.md'), '# Outside\n');
      await fs.mkdir(path.dirname(linkedDirectory), { recursive: true });
      try {
        await fs.symlink(outsideRoot, linkedDirectory, 'junction');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }
      projection.classic!.verificationReport = 'docs/linked-reports/verification.md';

      const evidence = await collectClassicEvidence(changeDir, projection);
      const report = evidence.find((item) => item.code === 'verification.report');

      expect(report).toMatchObject({
        satisfied: false,
        source: 'docs/linked-reports/verification.md',
      });
      expect(report?.detail).toContain('symbolic link');
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('resolves a missing legacy handoff pointer inside the configured docs archive', async () => {
    changeDir = path.join(projectRoot, 'docs', 'openspec', 'changes', 'archive', '2026-06-14-demo');
    await fs.rm(path.join(projectRoot, 'openspec'), { recursive: true, force: true });
    await fs.mkdir(path.join(changeDir, '.comet', 'handoff'), { recursive: true });
    await writeClassicConfig('docs');
    await fs.writeFile(
      path.join(changeDir, '.comet', 'handoff', 'context.json'),
      '{"context":true}\n',
      'utf8',
    );

    const evidence = await collectClassicEvidence(changeDir, projection);
    const handoff = evidence.find((item) => item.code === 'design.handoff');

    expect(handoff).toMatchObject({
      satisfied: true,
      source: 'openspec/changes/demo/.comet/handoff/context.json',
      detail: expect.stringContaining('archived change'),
    });
  });

  it('resolves a docs-layout handoff pointer inside the same configured docs archive', async () => {
    changeDir = path.join(projectRoot, 'docs', 'openspec', 'changes', 'archive', '2026-06-14-demo');
    await fs.rm(path.join(projectRoot, 'openspec'), { recursive: true, force: true });
    await fs.mkdir(path.join(changeDir, '.comet', 'handoff'), { recursive: true });
    await writeClassicConfig('docs');
    await fs.writeFile(
      path.join(changeDir, '.comet', 'handoff', 'context.json'),
      '{"context":true}\n',
      'utf8',
    );
    projection.classic!.handoffContext = 'docs/openspec/changes/demo/.comet/handoff/context.json';

    const evidence = await collectClassicEvidence(changeDir, projection);
    const handoff = evidence.find((item) => item.code === 'design.handoff');

    expect(handoff).toMatchObject({
      satisfied: true,
      source: 'docs/openspec/changes/demo/.comet/handoff/context.json',
      detail: expect.stringContaining('archived change'),
    });
  });

  it('does not satisfy a legacy handoff pointer from the alternate root during a dual-root conflict', async () => {
    changeDir = path.join(projectRoot, 'docs', 'openspec', 'changes', 'demo');
    await fs.mkdir(changeDir, { recursive: true });
    await writeClassicConfig('docs');
    await writeProjectFile(
      'openspec/changes/demo/.comet/handoff/context.json',
      '{"alternate":true}\n',
    );

    const evidence = await collectClassicEvidence(changeDir, projection);
    const handoff = evidence.find((item) => item.code === 'design.handoff');

    expect(handoff).toMatchObject({
      satisfied: false,
      source: 'openspec/changes/demo/.comet/handoff/context.json',
      detail: expect.stringContaining('Classic layout conflict'),
    });
  });

  it.each([
    {
      label: 'another change',
      archiveName: '2026-06-14-demo',
      pointerChange: 'other',
    },
    {
      label: 'a change whose archive name only shares the same suffix',
      archiveName: '2026-06-14-other-demo',
      pointerChange: 'demo',
    },
  ])('does not map a legacy pointer from $label', async ({ archiveName, pointerChange }) => {
    changeDir = path.join(projectRoot, 'docs', 'openspec', 'changes', 'archive', archiveName);
    await fs.rm(path.join(projectRoot, 'openspec'), { recursive: true, force: true });
    await fs.mkdir(path.join(changeDir, '.comet', 'handoff'), { recursive: true });
    await writeClassicConfig('docs');
    await fs.writeFile(
      path.join(changeDir, '.comet', 'handoff', 'context.json'),
      '{"context":true}\n',
      'utf8',
    );
    projection.classic!.handoffContext = `openspec/changes/${pointerChange}/.comet/handoff/context.json`;

    const evidence = await collectClassicEvidence(changeDir, projection);

    expect(evidenceSatisfied(evidence, 'design.handoff')).toBe(false);
  });

  it('does not apply the legacy handoff fallback outside the configured archive directory', async () => {
    changeDir = path.join(projectRoot, 'docs', 'openspec', 'changes', 'demo');
    await fs.rm(path.join(projectRoot, 'openspec'), { recursive: true, force: true });
    await fs.mkdir(path.join(changeDir, '.comet', 'handoff'), { recursive: true });
    await writeClassicConfig('docs');
    await fs.writeFile(
      path.join(changeDir, '.comet', 'handoff', 'context.json'),
      '{"context":true}\n',
      'utf8',
    );

    const evidence = await collectClassicEvidence(changeDir, projection);

    expect(evidenceSatisfied(evidence, 'design.handoff')).toBe(false);
  });

  it('rejects traversal in a legacy handoff pointer instead of applying archive fallback', async () => {
    changeDir = path.join(projectRoot, 'docs', 'openspec', 'changes', 'archive', '2026-06-14-demo');
    await fs.rm(path.join(projectRoot, 'openspec'), { recursive: true, force: true });
    await fs.mkdir(path.join(changeDir, '.comet'), { recursive: true });
    await writeClassicConfig('docs');
    await fs.writeFile(path.join(changeDir, 'outside.json'), '{"outside":true}\n', 'utf8');
    projection.classic!.handoffContext = 'openspec/changes/demo/.comet/handoff/../../outside.json';

    const evidence = await collectClassicEvidence(changeDir, projection);
    const handoff = evidence.find((item) => item.code === 'design.handoff');

    expect(handoff?.satisfied).toBe(false);
    expect(handoff?.detail).toContain('outside the project');
  });

  it('rejects a junction in the mapped archived handoff path', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-handoff-outside-'));
    changeDir = path.join(projectRoot, 'docs', 'openspec', 'changes', 'archive', '2026-06-14-demo');
    try {
      await fs.rm(path.join(projectRoot, 'openspec'), { recursive: true, force: true });
      await fs.mkdir(path.join(changeDir, '.comet'), { recursive: true });
      await writeClassicConfig('docs');
      await fs.writeFile(path.join(outsideRoot, 'context.json'), '{"outside":true}\n', 'utf8');
      try {
        await fs.symlink(
          outsideRoot,
          path.join(changeDir, '.comet', 'handoff'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      const evidence = await collectClassicEvidence(changeDir, projection);
      const handoff = evidence.find((item) => item.code === 'design.handoff');

      expect(handoff?.satisfied).toBe(false);
      expect(handoff?.detail).toContain('symbolic link');
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
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

  async function writeClassicConfig(artifactLayout: 'legacy' | 'docs'): Promise<void> {
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows:',
        '  - classic',
        'classic:',
        `  artifact_layout: ${artifactLayout}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }
});
