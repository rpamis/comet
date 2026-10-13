import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archiveFixture } from '../../helpers/eval-archive-fixture.js';
import { collectEvalRuns, readEvalRun, readEvalArtifact } from '../../../domains/eval/index.js';
import { creatorObservationFixture } from '../../helpers/dashboard-application-fixture.js';
import { setEvalBaseline, clearEvalBaseline } from '../../../domains/eval/index.js';
import { handleDashboardEvalRequest } from '../../../domains/dashboard/eval-routes.js';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-archive-'));
  vi.stubEnv('COMET_USER_DATA_ROOT', path.join(root, 'user'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

it('discovers a tracked review outside runtime storage without treating task success as formal Eval', async () => {
  const source = path.join(root, 'source'),
    project = path.join(root, 'clone');
  await fs.mkdir(source);
  await fs.mkdir(project);
  const creator = await creatorObservationFixture(source, 'original-creator', 'install');
  await archiveFixture(project, creator.run);
  const runs = await collectEvalRuns(project);
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({
    id: 'archive-example',
    origin: 'history',
    conclusion: 'incomplete',
    executionStatus: 'completed',
    availableActions: { stop: false, rerun: false, setBaseline: false, compare: false },
  });
  expect(await readEvalRun(project, 'archive-example')).toEqual(runs[0]);
  expect((await readEvalArtifact(project, 'archive-example', 'report.md')).content).toContain(
    '4/4',
  );
  expect(await fs.readdir(project)).toEqual(['eval']);
});

it('rejects changed snapshots, undeclared reports and traversal without reading external files', async () => {
  const source = path.join(root, 'source'),
    project = path.join(root, 'clone');
  await fs.mkdir(source);
  await fs.mkdir(project);
  const creator = await creatorObservationFixture(source, 'original-creator', 'install');
  const { archive, manifest } = await archiveFixture(project, creator.run);
  await expect(readEvalArtifact(project, 'archive-example', '../private.txt')).rejects.toThrow();
  await fs.appendFile(path.join(archive, 'report.md'), 'changed');
  await expect(readEvalArtifact(project, 'archive-example', 'report.md')).rejects.toThrow(
    '内容已变化',
  );
  await fs.appendFile(path.join(archive, 'runs/creator.json'), ' ');
  expect((await collectEvalRuns(project))[0].diagnostics.join(' ')).toContain('内容已变化');
  manifest.runs[0].file = '../private.txt';
  await fs.writeFile(path.join(archive, 'archive.json'), JSON.stringify(manifest));
  await expect(readEvalRun(project, 'archive-example')).rejects.toThrow('相对路径');
});

it('refuses baseline writes and rerun requests for archived assessments', async () => {
  const source = path.join(root, 'source'),
    project = path.join(root, 'clone');
  await fs.mkdir(source);
  await fs.mkdir(project);
  const creator = await creatorObservationFixture(source, 'original-creator', 'install');
  await archiveFixture(project, creator.run);
  await expect(setEvalBaseline(project, 'archive-example')).rejects.toThrow('只读');
  await expect(clearEvalBaseline(project, 'archive-example')).rejects.toThrow('只读');
  await expect(
    handleDashboardEvalRequest(
      project,
      'POST',
      '/runs/archive-example/rerun-preview',
      new URLSearchParams(),
      { target: 'application.json' },
    ),
  ).rejects.toThrow('只读');
  expect(await fs.readdir(project)).toEqual(['eval']);
});

it('reads compressed creator snapshots and rejects directory links outside the archive', async () => {
  const source = path.join(root, 'source'),
    project = path.join(root, 'clone');
  await fs.mkdir(source);
  await fs.mkdir(project);
  const creator = await creatorObservationFixture(source, 'original-creator', 'install');
  const { archive, manifest } = await archiveFixture(project, creator.run);
  const bytes = gzipSync(await fs.readFile(path.join(archive, 'runs/creator.json')));
  await fs.writeFile(path.join(archive, 'runs/creator.json.gz'), bytes);
  manifest.runs[0].file = 'runs/creator.json.gz';
  manifest.files['runs/creator.json.gz'] = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(archive, 'archive.json'), JSON.stringify(manifest));
  expect((await collectEvalRuns(project))[0].archiveId).toBe('example');
  await fs.rename(path.join(archive, 'runs'), path.join(root, 'outside-runs'));
  await fs.symlink(path.join(root, 'outside-runs'), path.join(archive, 'runs'), 'junction');
  expect((await collectEvalRuns(project))[0].diagnostics.join(' ')).toContain('symbolic link');
});
