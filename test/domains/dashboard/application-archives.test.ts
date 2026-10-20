import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  collectDashboardApplicationRunPage,
  collectDashboardApplicationRunDetail,
  readDashboardApplicationArtifact,
} from '../../../domains/dashboard/application-collector.js';
import { archiveFixture } from '../../helpers/eval-archive-fixture.js';
import {
  applicationObservationFixture,
  creatorObservationFixture,
} from '../../helpers/dashboard-application-fixture.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-archive-'));
  vi.stubEnv('COMET_USER_DATA_ROOT', path.join(root, 'user'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

it('shows original creator and parent/child snapshots in a fresh project with readonly reports', async () => {
  const source = path.join(root, 'source'),
    project = path.join(root, 'clone');
  await fs.mkdir(source);
  await fs.mkdir(project);
  const creator = await creatorObservationFixture(source, 'original-creator', 'install');
  const app = await applicationObservationFixture(source, {
    id: 'example-app',
    version: '3',
    parallel: true,
    child: true,
    definition: true,
    presentation: { title: 'Archived application' },
  });
  const fixture = await archiveFixture(project, creator.run);
  fixture.manifest.application.contentHash = app.identity.contentHash;
  fixture.manifest.application.packageHash = app.packageHash;
  await fs.cp(app.identity.packageRoot, path.join(fixture.archive, 'application'), {
    recursive: true,
  });
  const ids = [app.run.runId, (await app.runtime.inspect(app.run.runId)).children[0].runId];
  for (let i = 0; i < ids.length; i++) {
    const file = `runs/app-${i}.json`,
      record = await app.outer.read(ids[i]);
    const bytes = JSON.stringify(record);
    await fs.writeFile(path.join(fixture.archive, file), bytes);
    fixture.manifest.files[file] = createHash('sha256').update(bytes).digest('hex');
    fixture.manifest.runs.push({ kind: 'application', runId: ids[i], file });
  }
  await fs.writeFile(path.join(fixture.archive, 'archive.json'), JSON.stringify(fixture.manifest));
  const page = await collectDashboardApplicationRunPage(project);
  expect(page.items).toHaveLength(3);
  expect(page.items.every((r) => r.archive?.id === 'example')).toBe(true);
  const parent = page.items.find((r) => r.runId === ids[0])!;
  const child = page.items.find((r) => r.runId === ids[1])!;
  expect(child.parentLocator).toBe(parent.locator);
  const detail = (await collectDashboardApplicationRunDetail(project, parent.locator))!;
  expect(detail.inspection).toBeNull();
  expect(detail.fixedIdentity?.projectRoot).toBe(source);
  expect(detail.children[0].locator).toBe(child.locator);
  expect(detail.records.some((r) => r.childLocator === child.locator)).toBe(true);
  expect(detail.material.status).toBe('matched');
  expect(detail.material).toEqual({ status: 'matched' });
  expect(detail.definition).toMatchObject({ status: 'available', title: 'Archived application' });
  expect(detail.evidence.find((e) => e.kind === 'model')).toMatchObject({
    status: 'incomplete',
    evalRunId: 'archive-example',
  });
  const report = detail.artifacts.find((a) => a.label === '专项复核报告')!;
  expect(
    (await readDashboardApplicationArtifact(project, parent.locator, report.id))?.content,
  ).toContain('4/4');
});
