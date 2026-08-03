import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  collectDashboardChangeDetail,
  collectDashboardChangePage,
  collectDashboardOverview,
  collectDashboardSnapshot,
} from '../../../domains/dashboard/collector.js';

interface ChangeFixture {
  name: string;
  yaml?: Record<string, string>;
  tasks?: string;
  proposal?: boolean;
  design?: boolean;
  plan?: boolean;
  verifyReport?: string | null; // body or null to skip the file
  status?: 'active' | 'archived';
  changesPath?: 'openspec/changes' | 'docs/openspec/changes';
}

async function writeChange(root: string, fixture: ChangeFixture): Promise<void> {
  const status = fixture.status ?? 'active';
  const changesPath = fixture.changesPath ?? 'openspec/changes';
  const baseDir =
    status === 'archived'
      ? path.join(root, ...changesPath.split('/'), 'archive', fixture.name)
      : path.join(root, ...changesPath.split('/'), fixture.name);
  await fs.mkdir(baseDir, { recursive: true });

  if (fixture.yaml) {
    const lines = Object.entries(fixture.yaml).map(([k, v]) => `${k}: ${v}`);
    await fs.writeFile(path.join(baseDir, '.comet.yaml'), `${lines.join('\n')}\n`);
  }
  if (fixture.tasks !== undefined) {
    await fs.writeFile(path.join(baseDir, 'tasks.md'), fixture.tasks);
  }
  if (fixture.proposal) {
    await fs.writeFile(path.join(baseDir, 'proposal.md'), '# Proposal\n');
  }
  if (fixture.design) {
    await fs.writeFile(path.join(baseDir, 'design.md'), '# Design\n');
  }
  if (fixture.plan) {
    await fs.writeFile(path.join(baseDir, 'plan.md'), '# Plan\n');
  }
  if (fixture.verifyReport != null) {
    const reportDir = path.join(baseDir, '.comet');
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(path.join(reportDir, 'verify-result.md'), fixture.verifyReport);
  }
}

describe('collectDashboardSnapshot', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-collector-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('treats missing Classic roots as an empty state without configuration', async () => {
    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active).toEqual([]);
    expect(snap.changes.archived).toEqual([]);
    expect(snap.summary.activeChanges).toBe(0);
    expect(snap.summary.archivedChanges).toBe(0);
    expect(snap.classicError).toBeUndefined();
  });

  it('collects Classic changes for a Native-only project', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '  language: en',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeChange(root, {
      name: 'classic-discovered-alongside-native',
      yaml: { phase: 'build', workflow: 'classic' },
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active.map((change) => change.name)).toEqual([
      'classic-discovered-alongside-native',
    ]);
    expect(snap.changes.archived).toEqual([]);
    expect(snap.classicError).toBeUndefined();
  });

  it('collects Classic changes from the configured docs layout', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: docs',
        '',
      ].join('\n'),
    );
    const changeDir = path.join(root, 'docs', 'openspec', 'changes', 'docs-layout');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, '.comet.yaml'),
      ['phase: build', 'workflow: hotfix', 'archived: false', ''].join('\n'),
    );
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] todo\n');

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active.map((change) => change.name)).toEqual(['docs-layout']);
    expect(snap.changes.active[0].path).toBe(changeDir);
    expect(snap.changes.active[0].relativePath).toBe('docs/openspec/changes/docs-layout');
    expect(snap.classicError).toBeUndefined();
  });

  it('scans Classic roots despite invalid project config', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(path.join(root, '.comet', 'config.yaml'), 'classic: invalid\n');
    await writeChange(root, {
      name: 'must-not-be-guessed',
      yaml: { phase: 'build', workflow: 'hotfix' },
      tasks: '- [ ] todo\n',
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active.map((change) => change.name)).toEqual(['must-not-be-guessed']);
    expect(snap.classicError).toBeUndefined();
  });

  it('scans Classic roots despite malformed project config', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(path.join(root, '.comet', 'config.yaml'), 'schema: [broken\n');
    await writeChange(root, {
      name: 'must-not-be-scanned',
      yaml: { phase: 'build', workflow: 'hotfix' },
      tasks: '- [ ] todo\n',
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active.map((change) => change.name)).toEqual(['must-not-be-scanned']);
    expect(snap.classicError).toBeUndefined();
  });

  it('merges both Classic roots and keeps duplicate names distinct by relative path', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: docs',
        '',
      ].join('\n'),
    );
    await writeChange(root, {
      name: 'shared-change',
      changesPath: 'openspec/changes',
      yaml: { phase: 'build', workflow: 'legacy' },
    });
    await writeChange(root, {
      name: 'shared-change',
      changesPath: 'docs/openspec/changes',
      yaml: { phase: 'build', workflow: 'docs' },
    });
    await writeChange(root, {
      name: '2026-07-01-shared-archive',
      changesPath: 'openspec/changes',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true' },
    });
    await writeChange(root, {
      name: '2026-07-01-shared-archive',
      changesPath: 'docs/openspec/changes',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true' },
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active).toHaveLength(2);
    expect(snap.changes.active.map((change) => change.id)).toEqual(
      expect.arrayContaining([
        'openspec/changes/shared-change',
        'docs/openspec/changes/shared-change',
      ]),
    );
    expect(snap.changes.archived).toHaveLength(2);
    expect(snap.changes.archived.map((change) => change.id)).toEqual(
      expect.arrayContaining([
        'openspec/changes/archive/2026-07-01-shared-archive',
        'docs/openspec/changes/archive/2026-07-01-shared-archive',
      ]),
    );
    expect(snap.classicError).toBeUndefined();
  });

  it('collects active changes and ignores the archive directory entry', async () => {
    await writeChange(root, {
      name: 'dashboard-v0',
      yaml: { phase: 'build', workflow: 'full' },
      tasks: '## A\n- [x] done\n- [ ] todo\n',
      proposal: true,
      design: true,
      plan: true,
    });
    // archive/ subdirectory should not appear as an active candidate
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'archive'), { recursive: true });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active.map((c) => c.name)).toEqual(['dashboard-v0']);
    expect(snap.changes.active[0].phase).toBe('build');
    expect(snap.changes.active[0].tasks).toMatchObject({ completed: 1, total: 2 });
    expect(snap.changes.active[0].next).toMatchObject({ command: '/comet-build' });
    expect(snap.changes.active[0].artifacts).toMatchObject({
      proposal: true,
      design: true,
      tasks: true,
      plan: true,
      verifyReport: false,
      cometYaml: true,
    });
    expect(snap.changes.active[0].artifacts.grouped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'proposal', source: 'openspec', exists: true }),
        expect.objectContaining({ key: 'design', source: 'openspec', exists: true }),
        expect.objectContaining({ key: 'tasks', source: 'openspec', exists: true }),
        expect.objectContaining({ key: 'plan', source: 'superpowers', exists: true }),
      ]),
    );
    expect(snap.changes.active[0].artifactPreviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'proposal',
          label: '提案',
          exists: true,
          content: '# Proposal\n',
        }),
        expect.objectContaining({
          key: 'verifyReport',
          label: '验证报告',
          exists: false,
        }),
      ]),
    );
  });

  it('parses archived changes including date and original name', async () => {
    await writeChange(root, {
      name: '2026-06-20-context-graph-notes',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true', verify_result: 'pass' },
      tasks: '## Foo\n- [x] done\n',
      proposal: true,
      design: true,
      plan: true,
      verifyReport: '# Verify\nAll passed.',
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.archived).toHaveLength(1);
    const archived = snap.changes.archived[0];
    expect(archived.id).toBe('openspec/changes/archive/2026-06-20-context-graph-notes');
    expect(archived.status).toBe('archived');
    expect(archived.displayName).toBe('context-graph-notes');
    expect(archived.archive).toMatchObject({
      archiveName: '2026-06-20-context-graph-notes',
      originalName: 'context-graph-notes',
      archivedAt: '2026-06-20',
    });
    expect(archived.next).toBeUndefined();
    expect(archived.verify.result).toBe('pass');
    expect(archived.verify.reportExists).toBe(true);
  });

  it('resolves archived Superpowers artifacts from docs/superpowers path pointers', async () => {
    const designDocPath = path.join(root, 'docs', 'superpowers', 'specs', 'demo-design.md');
    const planPath = path.join(root, 'docs', 'superpowers', 'plans', 'demo-plan.md');
    const verifyPath = path.join(root, 'docs', 'superpowers', 'reports', 'demo-verify.md');
    await fs.mkdir(path.dirname(designDocPath), { recursive: true });
    await fs.mkdir(path.dirname(planPath), { recursive: true });
    await fs.mkdir(path.dirname(verifyPath), { recursive: true });
    await fs.writeFile(designDocPath, '# Design Doc\n');
    await fs.writeFile(planPath, '# Plan\n');
    await fs.writeFile(verifyPath, '# Verify\nAll passed.');

    await writeChange(root, {
      name: '2026-07-09-demo',
      status: 'archived',
      yaml: {
        phase: 'archive',
        archived: 'true',
        verify_result: 'pass',
        design_doc: 'docs/superpowers/specs/demo-design.md',
        plan: 'docs/superpowers/plans/demo-plan.md',
        verification_report: 'docs/superpowers/reports/demo-verify.md',
      },
    });

    const snap = await collectDashboardSnapshot(root);
    const archived = snap.changes.archived[0];

    expect(archived.artifacts.plan).toBe(true);
    expect(archived.artifacts.verifyReport).toBe(true);
    expect(archived.verify.reportExists).toBe(true);
    expect(archived.artifacts.grouped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'designDoc',
          source: 'superpowers',
          exists: true,
          path: designDocPath,
        }),
        expect.objectContaining({
          key: 'plan',
          source: 'superpowers',
          exists: true,
          path: planPath,
        }),
        expect.objectContaining({
          key: 'verifyReport',
          source: 'superpowers',
          exists: true,
          path: verifyPath,
        }),
      ]),
    );
    expect(archived.artifactPreviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'plan',
          exists: true,
          content: '# Plan\n',
        }),
        expect.objectContaining({
          key: 'verifyReport',
          exists: true,
          content: '# Verify\nAll passed.',
        }),
      ]),
    );
  });

  it('does not expose artifacts through project traversal pointers', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-outside-'));
    try {
      const outsidePlan = path.join(outsideRoot, 'plan.md');
      await fs.writeFile(outsidePlan, '# Outside plan\n');
      await writeChange(root, {
        name: 'unsafe-pointer',
        yaml: {
          phase: 'build',
          workflow: 'full',
          plan: path.relative(root, outsidePlan).replaceAll('\\', '/'),
        },
      });

      const snap = await collectDashboardSnapshot(root);
      const change = snap.changes.active[0];

      expect(change.artifacts.plan).toBe(false);
      expect(change.artifacts.grouped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'plan',
            exists: false,
          }),
        ]),
      );
      expect(change.artifactPreviews).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'plan',
            content: '# Outside plan\n',
          }),
        ]),
      );
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not expose artifacts through a junction outside the project', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-outside-'));
    const linkedDirectory = path.join(root, 'docs', 'linked-plans');
    try {
      await fs.writeFile(path.join(outsideRoot, 'plan.md'), '# Outside plan\n');
      await fs.mkdir(path.dirname(linkedDirectory), { recursive: true });
      try {
        await fs.symlink(outsideRoot, linkedDirectory, 'junction');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }
      await writeChange(root, {
        name: 'unsafe-junction',
        yaml: {
          phase: 'build',
          workflow: 'full',
          plan: 'docs/linked-plans/plan.md',
        },
      });

      const snap = await collectDashboardSnapshot(root);
      const change = snap.changes.active[0];

      expect(change.artifacts.plan).toBe(false);
      expect(change.artifactPreviews).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'plan',
            content: '# Outside plan\n',
          }),
        ]),
      );
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('skips a change directory junction instead of reading project-external state', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-change-outside-'));
    const changesRoot = path.join(root, 'openspec', 'changes');
    const linkedChange = path.join(changesRoot, 'external-change');
    try {
      await fs.writeFile(
        path.join(outsideRoot, '.comet.yaml'),
        'phase: build\nworkflow: TOP_SECRET\n',
      );
      await fs.writeFile(path.join(outsideRoot, 'tasks.md'), '- [ ] external secret task\n');
      await fs.mkdir(path.join(outsideRoot, 'specs', 'secret'), { recursive: true });
      await fs.writeFile(
        path.join(outsideRoot, 'specs', 'secret', 'spec.md'),
        '# External secret\n',
      );
      await fs.mkdir(changesRoot, { recursive: true });
      try {
        await fs.symlink(
          outsideRoot,
          linkedChange,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      const snap = await collectDashboardSnapshot(root);

      expect(snap.changes.active).toEqual([]);
      expect(JSON.stringify(snap)).not.toContain('TOP_SECRET');
      expect(JSON.stringify(snap)).not.toContain('external secret');
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it.each(['changes', 'archive'] as const)(
    'reports Classic unavailable when the %s root is a junction',
    async (kind) => {
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-root-outside-'));
      const openSpecRoot = path.join(root, 'openspec');
      try {
        await fs.mkdir(openSpecRoot, { recursive: true });
        const target =
          kind === 'changes'
            ? path.join(openSpecRoot, 'changes')
            : path.join(openSpecRoot, 'changes', 'archive');
        if (kind === 'archive') {
          await fs.mkdir(path.dirname(target), { recursive: true });
        }
        try {
          await fs.symlink(outsideRoot, target, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
          throw error;
        }

        const snap = await collectDashboardSnapshot(root);

        expect(snap.changes.active).toEqual([]);
        expect(snap.changes.archived).toEqual([]);
        expect(snap.classicError).toMatchObject({
          code: 'classic-dashboard-unavailable',
          message: expect.stringMatching(/symbolic link or junction/iu),
        });
      } finally {
        await fs.rm(outsideRoot, { recursive: true, force: true });
      }
    },
  );

  it('keeps the readable docs root when the legacy changes root is a junction', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-root-outside-'));
    const openSpecRoot = path.join(root, 'openspec');
    const linkedChanges = path.join(openSpecRoot, 'changes');
    try {
      await fs.mkdir(openSpecRoot, { recursive: true });
      await writeChange(root, {
        name: 'docs-survivor',
        changesPath: 'docs/openspec/changes',
        yaml: { phase: 'build', workflow: 'docs' },
      });
      try {
        await fs.symlink(
          outsideRoot,
          linkedChanges,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      const snap = await collectDashboardSnapshot(root);

      expect(snap.changes.active.map((change) => change.id)).toEqual([
        'docs/openspec/changes/docs-survivor',
      ]);
      expect(snap.classicError).toMatchObject({
        code: 'classic-dashboard-unavailable',
        message: expect.stringMatching(/symbolic link or junction/iu),
      });
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('sorts active changes by risk, then updatedAt, then name', async () => {
    await writeChange(root, {
      name: 'docs-cleanup',
      yaml: { phase: 'design', workflow: 'full' },
      proposal: true,
    });
    await writeChange(root, {
      name: 'auth-refactor',
      yaml: { phase: 'verify', verify_result: 'fail', workflow: 'full' },
      tasks: '- [x] done\n',
      proposal: true,
      design: true,
      plan: true,
    });
    await writeChange(root, {
      name: 'dashboard-v0',
      yaml: { phase: 'build', workflow: 'full' },
      tasks: '- [x] one\n- [ ] two\n',
      proposal: true,
      design: true,
      plan: true,
    });

    const snap = await collectDashboardSnapshot(root);

    // fail risk first, then warning (build with incomplete), then info-only design
    expect(snap.changes.active.map((c) => c.name)).toEqual([
      'auth-refactor',
      'dashboard-v0',
      'docs-cleanup',
    ]);
  });

  it('sorts archived changes by archivedAt descending', async () => {
    await writeChange(root, {
      name: '2026-06-15-dashboard-command',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true', verify_result: 'fail' },
    });
    await writeChange(root, {
      name: '2026-06-20-context-graph-notes',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true', verify_result: 'pass' },
    });
    await writeChange(root, {
      name: '2026-06-18-agent-workflow',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true', verify_result: 'pass' },
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.archived.map((c) => c.archive?.archivedAt)).toEqual([
      '2026-06-20',
      '2026-06-18',
      '2026-06-15',
    ]);
  });

  it('counts incomplete tasks across active changes in the summary', async () => {
    await writeChange(root, {
      name: 'a',
      yaml: { phase: 'build' },
      tasks: '- [x] one\n- [ ] two\n- [ ] three\n',
    });
    await writeChange(root, {
      name: 'b',
      yaml: { phase: 'build' },
      tasks: '- [x] one\n- [x] two\n',
    });
    await writeChange(root, {
      name: 'c-archived',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true' },
      tasks: '- [ ] should-not-count\n',
    });

    const snap = await collectDashboardSnapshot(root);

    expect(snap.summary.tasksIncomplete).toBe(2);
    expect(snap.summary.activeChanges).toBe(2);
    expect(snap.summary.archivedChanges).toBe(1);
  });

  it('marks unknown phase and surfaces a risk', async () => {
    await writeChange(root, {
      name: 'mystery',
      yaml: { workflow: 'full' },
      tasks: '',
    });

    const snap = await collectDashboardSnapshot(root);
    const item = snap.changes.active[0];

    expect(item.phase).toBe('unknown');
    expect(item.risks.some((r) => r.code === 'UNKNOWN_PHASE')).toBe(true);
    expect(item.next).toMatchObject({ command: null });
  });

  it('uses project basename and the provided clock for generatedAt', async () => {
    const now = new Date('2026-06-23T10:42:00Z');
    const snap = await collectDashboardSnapshot(root, { now });

    expect(snap.project.path).toBe(root);
    expect(snap.project.name).toBe(path.basename(root));
    expect(snap.project.generatedAt).toBe(now.toISOString());
  });

  it('skips a single broken change without aborting the whole sweep', async () => {
    await writeChange(root, {
      name: 'healthy',
      yaml: { phase: 'build' },
      tasks: '- [ ] one\n',
    });

    // Plant an unreadable .comet.yaml (a directory where a file should be)
    // so the per-change build throws when it tries to read it.
    const bogusDir = path.join(root, 'openspec', 'changes', 'bogus');
    await fs.mkdir(path.join(bogusDir, '.comet.yaml'), { recursive: true });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const snap = await collectDashboardSnapshot(root);
      expect(snap.changes.active.map((c) => c.name)).toEqual(['healthy']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('bogus'));
    } finally {
      warn.mockRestore();
    }
  });

  it('resolves plan from yaml path-pointer in docs/superpowers/', async () => {
    // Create plan in docs/superpowers/ (not in change dir)
    const planDir = path.join(root, 'docs', 'superpowers', 'plans');
    await fs.mkdir(planDir, { recursive: true });
    await fs.writeFile(path.join(planDir, '2026-06-28-my-feature.md'), '# Plan\n');

    await writeChange(root, {
      name: 'my-feature',
      yaml: { phase: 'build', plan: 'docs/superpowers/plans/2026-06-28-my-feature.md' },
      tasks: '- [ ] one\n',
      proposal: true,
      design: true,
    });

    const snap = await collectDashboardSnapshot(root);
    const item = snap.changes.active[0];

    expect(item.artifacts.plan).toBe(true);
    expect(item.artifacts.grouped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'plan',
          source: 'superpowers',
          exists: true,
          path: expect.stringContaining('2026-06-28-my-feature.md'),
        }),
      ]),
    );
  });

  it('resolves verify report from yaml path-pointer in docs/superpowers/', async () => {
    // Create verify report in docs/superpowers/
    const reportDir = path.join(root, 'docs', 'superpowers', 'reports');
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(path.join(reportDir, '2026-06-28-verify.md'), '# Verify\nAll passed.');

    await writeChange(root, {
      name: 'my-feature',
      yaml: {
        phase: 'verify',
        verify_result: 'pass',
        verification_report: 'docs/superpowers/reports/2026-06-28-verify.md',
      },
      tasks: '- [x] done\n',
      proposal: true,
      design: true,
    });

    const snap = await collectDashboardSnapshot(root);
    const item = snap.changes.active[0];

    expect(item.verify.reportExists).toBe(true);
    expect(item.verify.result).toBe('pass');
    expect(item.artifacts.verifyReport).toBe(true);
  });

  it('groups artifacts by source (openspec vs superpowers)', async () => {
    const planDir = path.join(root, 'docs', 'superpowers', 'plans');
    await fs.mkdir(planDir, { recursive: true });
    await fs.writeFile(path.join(planDir, '2026-06-28-f.md'), '# Plan\n');

    await writeChange(root, {
      name: 'feat-x',
      yaml: { phase: 'build', plan: 'docs/superpowers/plans/2026-06-28-f.md' },
      tasks: '- [ ] one\n',
      proposal: true,
      design: true,
    });

    const snap = await collectDashboardSnapshot(root);
    const grouped = snap.changes.active[0].artifacts.grouped;

    const openspecKeys = grouped.filter((a) => a.source === 'openspec').map((a) => a.key);
    const superpowersKeys = grouped.filter((a) => a.source === 'superpowers').map((a) => a.key);

    expect(openspecKeys).toContain('proposal');
    expect(openspecKeys).toContain('design');
    expect(openspecKeys).toContain('tasks');
    expect(superpowersKeys).toContain('plan');
  });

  it('returns paginated lightweight change rows without hidden artifact previews', async () => {
    for (let index = 0; index < 6; index += 1) {
      await writeChange(root, {
        name: `active-${index}`,
        yaml: { phase: 'build', workflow: 'classic' },
        tasks: '- [ ] pending\n',
        proposal: true,
        design: true,
        plan: true,
      });
    }

    const first = await collectDashboardChangePage(root, {
      status: 'active',
      limit: 5,
    });

    expect(first.total).toBe(6);
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.items[0]).toMatchObject({
      status: 'active',
      phase: 'build',
      tasks: { completed: 0, total: 1 },
      verify: { result: 'unknown' },
    });
    expect(first.items[0]).not.toHaveProperty('artifactPreviews');

    const second = await collectDashboardChangePage(root, {
      status: 'active',
      limit: 5,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('combines active and archived rows for the all tab with a stable page size', async () => {
    await writeChange(root, {
      name: 'active-one',
      yaml: { phase: 'build' },
      tasks: '- [ ] todo\n',
    });
    await writeChange(root, {
      name: '2026-06-20-archived-one',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true' },
      tasks: '- [x] done\n',
    });

    const page = await collectDashboardChangePage(root, {
      status: 'all',
      limit: 1,
    });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].status).toBe('active');
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it('loads full change details only through the detail lookup', async () => {
    await writeChange(root, {
      name: 'detail-only',
      yaml: { phase: 'build' },
      tasks: '- [ ] todo\n',
      proposal: true,
    });

    const detail = await collectDashboardChangeDetail(root, 'openspec/changes/detail-only');

    expect(detail).toMatchObject({
      id: 'openspec/changes/detail-only',
      name: 'detail-only',
      artifacts: { proposal: true },
    });
    expect(detail?.artifactPreviews.length).toBeGreaterThan(0);
    await expect(
      collectDashboardChangeDetail(root, 'openspec/changes/not-registered'),
    ).resolves.toBeNull();
    await expect(
      collectDashboardChangeDetail(root, 'openspec/changes/..\\outside'),
    ).resolves.toBeNull();
  });

  it('builds the dashboard overview without embedding Classic change details', async () => {
    await writeChange(root, {
      name: 'overview-active',
      yaml: { phase: 'build' },
      tasks: '- [ ] todo\n',
    });
    await writeChange(root, {
      name: '2026-06-20-overview-archived',
      status: 'archived',
      yaml: { phase: 'archive', archived: 'true' },
    });

    const overview = await collectDashboardOverview(root);

    expect(overview).toMatchObject({
      summary: { activeChanges: 1, archivedChanges: 1, tasksIncomplete: 1 },
      project: { path: root },
    });
    expect(overview).not.toHaveProperty('changes');
  });
});
