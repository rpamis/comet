import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { doctorCommand } from '../../app/commands/doctor.js';
import { inspectCometProjectStatus } from '../../domains/comet-entry/project-status.js';
import { runClassicCli } from '../../domains/comet-classic/classic-cli.js';
import { prepareClassicLegacyProject } from '../helpers/classic-project.js';

async function snapshot(root: string) {
  const entries: Record<string, { mtime: number; content: string | null }> = {};
  async function visit(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const stat = await fs.lstat(file);
      entries[path.relative(root, file)] = {
        mtime: stat.mtimeMs,
        content: stat.isFile() ? (await fs.readFile(file)).toString('base64') : null,
      };
      if (entry.isDirectory()) await visit(file);
    }
  }
  await visit(root);
  return entries;
}

describe('project Doctor SDK read-only diagnostics', () => {
  it('retains a missing non-selected Classic projection without creating transient locks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-sdk-readonly-'));
    const home = path.join(root, 'home');
    const exitCode = process.exitCode;
    await fs.mkdir(home);
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    try {
      execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
      await prepareClassicLegacyProject(root);
      const run = (args: string[]) =>
        runClassicCli(args, undefined, { projectRoot: root, invocationCwd: root });
      for (const name of ['broken', 'healthy']) {
        const initialized = await run([
          'state',
          'init',
          name,
          'full',
          '--isolation',
          'current',
          '--json',
        ]);
        expect(initialized.exitCode, initialized.stdout).toBe(0);
        expect((await run(['state', 'next', name, '--json'])).exitCode).toBe(0);
      }
      expect((await run(['state', 'select', 'healthy', '--json'])).exitCode).toBe(0);
      await fs.rm(path.join(root, 'openspec/changes/broken/.comet.yaml'));
      const before = await snapshot(root);
      const writes = [
        vi.spyOn(fs, 'mkdir'),
        vi.spyOn(fs, 'writeFile'),
        vi.spyOn(fs, 'rename'),
        vi.spyOn(fs, 'unlink'),
      ];
      const status = await inspectCometProjectStatus(root);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await doctorCommand(root, { json: true, scope: 'project', homeDir: home });
      const doctor = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      log.mockRestore();
      expect(
        status.workflows.classic.changes.find((change) => change.name === 'broken')?.error,
      ).toBeTruthy();
      expect(
        status.workflows.classic.changes.find((change) => change.name === 'healthy')?.runtimeMode,
      ).toBe('sdk');
      expect(doctor.results).toContainEqual({
        check: '.comet.yaml: broken',
        status: 'fail',
        message: expect.stringContaining('requires recovery'),
      });
      expect(doctor.results).toContainEqual({
        check: '.comet.yaml: healthy',
        status: 'pass',
        message: expect.stringContaining('mode: sdk'),
      });
      expect(doctor.results).toContainEqual({
        check: 'current selection',
        status: 'pass',
        message: 'classic:healthy (open)',
      });
      for (const write of writes) expect(write).not.toHaveBeenCalled();
      expect(await snapshot(root)).toEqual(before);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      process.exitCode = exitCode;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
