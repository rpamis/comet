import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listEvalRunSources } from '../../../domains/eval/eval-run-sources.js';

describe('Eval source discovery', () => {
  let root: string;
  let reports: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-sources-'));
    reports = path.join(root, '.comet/eval/runs/run-one/reports');
    await fs.mkdir(reports, { recursive: true });
    await fs.writeFile(path.join(reports, '..', 'metadata.json'), '{"completed_at":"2026-10-17"}');
    await fs.writeFile(path.join(reports, 'one_report.json'), '{"passed":true}');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });
  const fingerprint = async (root: string) => (await listEvalRunSources(root))[0]?.fingerprint;

  it('reuses directory enumeration but observes in-place edits to completed reports', async () => {
    const initial = await fingerprint(root);
    const readdir = vi.spyOn(fs, 'readdir');
    expect(await fingerprint(root)).toBe(initial);
    expect(readdir).toHaveBeenCalledTimes(1);
    await fs.writeFile(path.join(reports, 'one_report.json'), '{"passed":false}');
    expect(await fingerprint(root)).not.toBe(initial);
    expect(readdir).toHaveBeenCalledTimes(2);
  });
  it('observes report and run additions and removals', async () => {
    const initial = await fingerprint(root);
    await fs.writeFile(path.join(reports, 'two_report.json'), '{}');
    const added = await fingerprint(root);
    expect(added).not.toBe(initial);
    await fs.rm(path.join(reports, 'two_report.json'));
    expect(await fingerprint(root)).not.toBe(added);
    await fs.mkdir(path.join(reports, '../../run-two'));
    expect((await listEvalRunSources(root)).map((source) => source.id)).toEqual([
      'run-one',
      'run-two',
    ]);
    await fs.rm(path.join(reports, '../../run-two'), { recursive: true });
    expect(await listEvalRunSources(root)).toHaveLength(1);
  });
  it('rejects cached report files replaced by symlinks and recovers after repair', async () => {
    await fingerprint(root);
    const file = path.join(reports, 'one_report.json');
    await fs.rm(file);
    await fs.symlink(path.join(root, '.comet/eval/runs/run-one/metadata.json'), file);
    expect(await fingerprint(root)).toMatch(/^unreadable:/u);
    await fs.rm(file);
    await fs.writeFile(file, '{}');
    expect(await fingerprint(root)).not.toMatch(/^unreadable:/u);
  });
  it('rejects replaced report directories and ancestors without retaining a stale fingerprint', async () => {
    await fingerprint(root);
    const moved = path.join(root, 'retained-reports');
    await fs.rename(reports, moved);
    await fs.symlink(moved, reports, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await fingerprint(root)).toMatch(/^unreadable:/u);
    await fs.rm(reports);
    await fs.rename(moved, reports);
    expect(await fingerprint(root)).not.toMatch(/^unreadable:/u);
    const evalRoot = path.join(root, '.comet/eval');
    const movedEval = path.join(root, 'retained-eval');
    await fs.rename(evalRoot, movedEval);
    await fs.symlink(movedEval, evalRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(fingerprint(root)).rejects.toThrow('符号链接');
  });
  it('shares ancestor checks only within each bounded discovery pass', async () => {
    for (let i = 0; i < 20; i++) {
      const directory = path.join(reports, `../../run-${i}/reports`);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'one_report.json'), '{}');
    }
    await listEvalRunSources(root);
    const realpath = vi.spyOn(fs, 'realpath');
    const readdir = vi.spyOn(fs, 'readdir');
    expect(await listEvalRunSources(root)).toHaveLength(21);
    expect(realpath.mock.calls.length).toBeLessThan(60);
    expect(readdir).toHaveBeenCalledTimes(1);
  });
});
