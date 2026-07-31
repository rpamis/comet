import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { dashboardCommand } from '../../app/commands/dashboard.js';

describe('dashboardCommand --json', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dash-cmd-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('prints a single dashboard snapshot and returns', async () => {
    const openSpecRoot = path.join(tmpDir, 'docs', 'openspec');
    await fs.mkdir(path.join(openSpecRoot, 'changes', 'archive'), { recursive: true });
    await fs.mkdir(path.join(openSpecRoot, 'specs'), { recursive: true });
    await fs.writeFile(path.join(openSpecRoot, 'config.yaml'), 'schema: spec-driven\n');
    const changeDir = path.join(openSpecRoot, 'changes', 'sample');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, '.comet.yaml'),
      ['phase: build', 'workflow: full', ''].join('\n'),
    );
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] one\n- [ ] two\n');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let captured = '';
    try {
      await dashboardCommand(changeDir, { json: true });
      captured = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const snap = JSON.parse(captured) as {
      project: { path: string };
      changes: { active: Array<{ name: string; phase: string; tasks: { total: number } }> };
    };

    expect(snap.project.path).toBe(tmpDir);
    expect(snap.changes.active).toHaveLength(1);
    expect(snap.changes.active[0]).toMatchObject({
      name: 'sample',
      phase: 'build',
      tasks: { total: 2 },
    });
  });

  it('keeps a nested Native dashboard rooted at its project config', async () => {
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '  language: en',
        '',
      ].join('\n'),
    );
    const nested = path.join(tmpDir, 'packages', 'app', 'src');
    await fs.mkdir(nested, { recursive: true });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let captured = '';
    try {
      await dashboardCommand(nested, { json: true });
      captured = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const snap = JSON.parse(captured) as {
      project: { path: string };
      changes: { active: unknown[]; archived: unknown[] };
    };

    expect(snap.project.path).toBe(tmpDir);
    expect(snap.changes.active).toEqual([]);
    expect(snap.changes.archived).toEqual([]);
  });

  it('rejects invalid port values', async () => {
    await expect(dashboardCommand(tmpDir, { port: -1 })).rejects.toThrow(/Invalid --port/);
    await expect(dashboardCommand(tmpDir, { port: 70_000 })).rejects.toThrow(/Invalid --port/);
  });
});
