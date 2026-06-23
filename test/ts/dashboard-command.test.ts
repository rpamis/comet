import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { dashboardCommand } from '../../src/commands/dashboard.js';

describe('dashboardCommand --json', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dash-cmd-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('prints a single dashboard snapshot and returns', async () => {
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'sample');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, '.comet.yaml'),
      ['phase: build', 'workflow: full', ''].join('\n'),
    );
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] one\n- [ ] two\n');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let captured = '';
    try {
      await dashboardCommand(tmpDir, { json: true });
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

  it('rejects invalid port values', async () => {
    await expect(dashboardCommand(tmpDir, { port: -1 })).rejects.toThrow(/Invalid --port/);
    await expect(dashboardCommand(tmpDir, { port: 70_000 })).rejects.toThrow(/Invalid --port/);
  });
});
