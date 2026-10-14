import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startDashboardServer,
  type DashboardServerHandle,
} from '../../../domains/dashboard/server.js';
import { collectDashboardApplicationRunPage } from '../../../domains/dashboard/application-collector.js';
import {
  loadWorkflowApplication,
  readWorkflowApplicationRunRecord,
} from '../../../domains/workflow-application/index.js';
import {
  createRuntime,
  createFileRuntimeStore,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { inspectApplicationSkill } from '../../../domains/workflow-application/index.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { createDiskApplication } from '../../helpers/workflow-application.js';
import {
  creatorObservationFixture,
  completeFixtureAction,
} from '../../helpers/dashboard-application-fixture.js';

let root: string,
  project: string,
  locator: string,
  source: Awaited<ReturnType<typeof createDiskApplication>>,
  server: DashboardServerHandle;
const endpoint = () =>
  `${server.url}/api/dashboard/projects/${encodeURIComponent(projectId)}/application-delivery`;
let projectId: string;
async function post(body: unknown) {
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locator, ...(body as object) }),
  });
  return { status: response.status, body: await response.json() };
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-delivery-'));
  project = path.join(root, 'source');
  await fs.mkdir(project);
  vi.stubEnv('COMET_DATA_DIR', path.join(root, 'data'));
  vi.stubEnv('COMET_USER_DATA_ROOT', path.join(root, 'user-data'));
  source = await createDiskApplication(project);
  await fs.cp(source.skillRoot, path.join(source.packageRoot, 'skills/writer'), {
    recursive: true,
  });
  source.manifest.skills[0].root = 'skills/writer';
  await fs.writeFile(source.file, JSON.stringify(source.manifest));
  const application = await loadWorkflowApplication({
    file: source.file,
    projectRoot: project,
    runId: 'delivery-source',
  });
  await createRuntime({ ...application.implementation, store: application.store }).start({
    runId: 'delivery-source',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'Delivery' },
  });
  locator = (await collectDashboardApplicationRunPage(project)).items[0].locator;
  server = await startDashboardServer({ projectPath: project, port: 0 });
  const directory = await (await fetch(`${server.url}/api/dashboard/projects`)).json();
  projectId = directory.projects.find((p: { path: string }) => p.path === project).id;
});
afterEach(async () => {
  await server?.close();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

it('previews and confirms multi-platform delivery into a custom project without advancing its Run', async () => {
  const targetDirectory = path.join(root, 'consumer');
  await fs.mkdir(targetDirectory);
  const before = await readWorkflowApplicationRunRecord(project, 'editorial', 'delivery-source');
  const request = {
    action: 'preview-install',
    scope: 'project',
    targetDirectory,
    platforms: ['cursor', 'workbuddy'],
  };
  const preview = await post(request);
  expect(preview.status).toBe(200);
  expect(preview.body.platforms.map((p: { id: string }) => p.id)).toEqual(['cursor', 'workbuddy']);
  expect(await fs.readdir(targetDirectory)).toEqual([]);
  const installed = await post({
    ...request,
    action: 'install',
    confirmationHash: preview.body.confirmationHash,
  });
  expect(installed.status).toBe(200);
  expect(
    await fs.readFile(path.join(targetDirectory, '.cursor/skills/editorial/SKILL.md'), 'utf8'),
  ).toContain('editorial');
  expect(
    await fs.readFile(
      path.join(targetDirectory, '.workbuddy/skills/writer/scripts/run.mjs'),
      'utf8',
    ),
  ).toContain('JSON.parse');
  expect(await readWorkflowApplicationRunRecord(project, 'editorial', 'delivery-source')).toEqual(
    before,
  );
});

it('supports an isolated user root and rejects changed targets and unconfirmed installs', async () => {
  const targetDirectory = path.join(root, 'home');
  await fs.mkdir(targetDirectory);
  const request = {
    action: 'preview-install',
    scope: 'user',
    targetDirectory,
    platforms: ['cursor'],
  };
  const preview = await post(request);
  expect(preview.status).toBe(200);
  expect(preview.body.target).toBe(path.join(targetDirectory, '.comet/applications'));
  expect((await post({ ...request, action: 'install' })).status).toBe(400);
  const other = path.join(root, 'other-home');
  await fs.mkdir(other);
  expect(
    (
      await post({
        ...request,
        action: 'install',
        targetDirectory: other,
        confirmationHash: preview.body.confirmationHash,
      })
    ).status,
  ).toBe(409);
  expect(await fs.readdir(other)).toEqual([]);
  expect(
    (await post({ ...request, action: 'install', confirmationHash: preview.body.confirmationHash }))
      .status,
  ).toBe(200);
});

it('previews and exports the complete package to a custom directory and preserves existing targets', async () => {
  const destination = path.join(root, 'exported');
  const request = { action: 'preview-export', destination };
  const preview = await post(request);
  expect(preview.status).toBe(200);
  expect(preview.body.files).toContain('skills/writer/scripts/run.mjs');
  await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(
    (await post({ ...request, action: 'export', confirmationHash: preview.body.confirmationHash }))
      .status,
  ).toBe(200);
  expect(await fs.readFile(path.join(destination, 'application.json'), 'utf8')).toContain(
    'editorial',
  );
  expect((await post(request)).status).toBe(409);
});

it('distributes a completed Creator candidate but rejects historical archives', async () => {
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(project), 'creator'),
  });
  const runtime = createRuntime({
    store,
    workflows: [
      {
        id: 'comet-creator',
        version: '3',
        entry: 'prepare',
        steps: {
          prepare: { type: 'handoff', ref: 'prepare' },
          compile: { type: 'handoff', ref: 'compile' },
          install: { type: 'handoff', ref: 'install' },
        },
        transitions: [
          { from: 'prepare', to: 'compile' },
          { from: 'compile', to: 'install' },
        ],
      },
    ],
  });
  let run = await runtime.start({
    runId: 'delivered-creator',
    workflow: { id: 'comet-creator', version: '3' },
    input: { goal: '完成的应用' },
  });
  run = await completeFixtureAction(runtime, run, 'prepare', {
    plan: {
      manifest: {
        id: source.manifest.id,
        version: source.manifest.version,
        base: source.manifest.base,
      },
    },
  });
  run = await completeFixtureAction(runtime, run, 'compile', {
    file: source.file,
    contentHash: (await inspectApplicationSkill(source.packageRoot)).contentHash,
  });
  await completeFixtureAction(runtime, run, 'install', { file: source.file });
  const creator = (await collectDashboardApplicationRunPage(project)).items.find(
    (r) => r.runId === 'delivered-creator',
  )!;
  expect(creator.status).toBe('delivered');
  expect(
    (
      await post({
        locator: creator.locator,
        action: 'preview-export',
        destination: path.join(root, 'from-creator'),
      })
    ).status,
  ).toBe(200);
  await fs.mkdir(path.join(project, 'eval/archives'), { recursive: true });
  await fs.cp(
    path.resolve('eval/archives/grill-test-20261013'),
    path.join(project, 'eval/archives/grill-test-20261013'),
    { recursive: true },
  );
  const archive = (await collectDashboardApplicationRunPage(project)).items.find((r) => r.archive)!;
  expect(
    (
      await post({
        locator: archive.locator,
        action: 'preview-export',
        destination: path.join(root, 'from-archive'),
      })
    ).status,
  ).toBe(409);
});

it('rejects unfinished creation, stale packages, unsupported platforms and cross-origin writes', async () => {
  await creatorObservationFixture(project);
  const early = (await collectDashboardApplicationRunPage(project)).items.find(
    (r) => r.kind === 'creator',
  )!;
  expect(
    (
      await post({
        locator: early.locator,
        action: 'preview-export',
        destination: path.join(root, 'early'),
      })
    ).status,
  ).toBe(409);
  expect(
    (await post({ action: 'preview-install', platforms: ['unknown'], scope: 'project' })).status,
  ).toBe(400);
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://example.com' },
    body: JSON.stringify({ locator, action: 'install' }),
  });
  expect(response.status).toBe(403);
  await fs.appendFile(path.join(source.packageRoot, 'SKILL.md'), '\nchanged');
  expect(
    (await post({ action: 'preview-export', destination: path.join(root, 'stale') })).status,
  ).toBe(409);
});
