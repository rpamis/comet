import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { collectDashboardSnapshot } from '../../src/dashboard/collector.js';

interface ChangeFixture {
  name: string;
  yaml?: Record<string, string>;
  tasks?: string;
  proposal?: boolean;
  design?: boolean;
  plan?: boolean;
  verifyReport?: string | null; // body or null to skip the file
  status?: 'active' | 'archived';
}

async function writeChange(root: string, fixture: ChangeFixture): Promise<void> {
  const status = fixture.status ?? 'active';
  const baseDir =
    status === 'archived'
      ? path.join(root, 'openspec', 'changes', 'archive', fixture.name)
      : path.join(root, 'openspec', 'changes', fixture.name);
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

  it('returns an empty snapshot when openspec/changes is missing', async () => {
    const snap = await collectDashboardSnapshot(root);

    expect(snap.changes.active).toEqual([]);
    expect(snap.changes.archived).toEqual([]);
    expect(snap.summary.activeChanges).toBe(0);
    expect(snap.summary.archivedChanges).toBe(0);
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
    expect(snap.changes.active[0].artifacts).toEqual({
      proposal: true,
      design: true,
      tasks: true,
      plan: true,
      verifyReport: false,
      cometYaml: true,
    });
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
    expect(archived.id).toBe('archive/2026-06-20-context-graph-notes');
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
});
