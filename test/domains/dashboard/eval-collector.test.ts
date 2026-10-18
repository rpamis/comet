import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as evalDomain from '../../../domains/eval/index.js';
import { collectDashboardEvalRunPage } from '../../../domains/dashboard/eval-collector.js';
import { resolveDashboardIndexPath } from '../../../domains/dashboard/index-store.js';

describe('Eval summary list', () => {
  let project: string;
  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-summary-'));
    vi.stubEnv('LOCALAPPDATA', path.join(project, 'cache'));
    vi.stubEnv('XDG_CACHE_HOME', path.join(project, 'cache'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(project, { recursive: true, force: true });
  });
  async function seed(id: string, passed: boolean) {
    const root = path.join(project, '.comet/eval/runs', id);
    await fs.mkdir(path.join(root, 'reports'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'metadata.json'),
      JSON.stringify({
        completed_at: '2026-10-10T12:00:00Z',
        expected_case_matrix: { case_count: 1 },
      }),
    );
    await fs.writeFile(
      path.join(root, 'reports/case_report.json'),
      JSON.stringify({
        name: 'case',
        passed,
        sample_quality: { status: 'included' },
        final_response: 'private-case-body',
        events_summary: {
          skill_sources: [{ name: 'writer', path: 'writer' }],
          case_manifest: { task_hash: 'task', validator_hash: 'validator' },
        },
      }),
    );
  }
  it('does not reread completed case reports until a source changes', async () => {
    await seed('one', true);
    await seed('two', false);
    const read = vi.spyOn(evalDomain, 'readEvalRunSummary');
    const first = await collectDashboardEvalRunPage(project, { limit: 1 });
    expect(first.total).toBe(2);
    expect(first.items).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(first.items[0]).not.toHaveProperty('cases');
    expect(first.items[0]).not.toHaveProperty('config');
    expect(JSON.stringify(first)).not.toContain('private-case-body');
    read.mockClear();
    await collectDashboardEvalRunPage(project);
    expect(read).not.toHaveBeenCalled();
    await seed('two', true);
    const changed = await collectDashboardEvalRunPage(project);
    expect(read).toHaveBeenCalledTimes(1);
    expect(changed.items.every((run) => run.passed === 1)).toBe(true);
    await fs.rm(path.join(project, '.comet/eval/runs/one'), { recursive: true });
    expect((await collectDashboardEvalRunPage(project)).total).toBe(1);
  });
  it('keeps the list available when the SQLite cache is corrupt', async () => {
    await seed('one', true);
    const file = resolveDashboardIndexPath(project);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'not a SQLite database');
    expect(await collectDashboardEvalRunPage(project, { cached: true })).toMatchObject({
      total: 1,
      indexing: false,
      items: [{ id: 'one', passed: 1 }],
    });
  });
});
