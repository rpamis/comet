import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';
import { importLegacyWorkspaceRuntimeData } from '../../../domains/workflow-contract/legacy-runtime-import.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { readChangeRuntimeOwner } from '../../../domains/workflow-contract/change-runtime-owner.js';
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('imports old full business history without copying process files or rewriting the source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-business-import-'));
  roots.push(root);
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  vi.stubEnv('COMET_DATA_DIR', path.join(root, 'data'));
  const run = JSON.parse(
    await fs.readFile(
      'test/fixtures/classic-052-platform-upgrade/archived.deliver-pending.sdk-052.run.json',
      'utf8',
    ),
  ) as WorkflowRun;
  const legacy = path.join(project, '.comet/runtime'),
    source = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(legacy, 'sdk-runs/classic'),
    });
  await source.restoreCheckpoint!(run.runId, null, run);
  const owner = {
    schema: 'comet.change-owner.v1',
    workflow: 'classic',
    change: run.runId,
    format: 'sdk',
    application: 'classic-tweak',
    runId: run.runId,
  };
  await fs.mkdir(path.join(legacy, 'change-owners/classic'), { recursive: true });
  await fs.writeFile(
    path.join(legacy, 'change-owners/classic/' + run.runId + '.json'),
    JSON.stringify(owner),
  );
  await fs.mkdir(path.join(legacy, 'native/sdk-checks'), { recursive: true });
  await fs.writeFile(
    path.join(legacy, 'native/sdk-checks/process.json'),
    JSON.stringify({ pid: 99999, status: 'running' }),
  );
  await fs.writeFile(path.join(legacy, 'old.lock'), 'old process record');
  const before = await source.read(run.runId);
  const imported = await importLegacyWorkspaceRuntimeData(project);
  const target = resolveWorkspaceRuntimeRootSync(project),
    store = createFileRuntimeStore<WorkflowRun>({ rootDir: path.join(target, 'sdk-runs/classic') });
  expect(imported.imported).toContain('sdk-runs/classic/' + run.runId);
  expect(await store.read(run.runId)).toEqual(before);
  expect(await source.read(run.runId)).toEqual(before);
  expect(await readChangeRuntimeOwner(project, 'classic', run.runId)).toEqual(owner);
  expect(await fs.stat(path.join(target, 'native/sdk-checks')).catch(() => null)).toBeNull();
  expect(await fs.readFile(path.join(legacy, 'old.lock'), 'utf8')).toBe('old process record');
  expect(
    await fs
      .stat(path.join(project, '.comet', '.runtime.comet-runtime-migration.json'))
      .catch(() => null),
  ).toBeNull();
  expect((await importLegacyWorkspaceRuntimeData(project)).imported).toEqual([]);
  expect(await store.read(run.runId)).toEqual(before);
});

async function isolatedImportFixture(workflow: 'classic' | 'native' = 'classic') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-business-import-boundary-'));
  roots.push(root);
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  vi.stubEnv('COMET_DATA_DIR', path.join(root, 'data'));
  const fixture = JSON.parse(
    await fs.readFile(
      workflow === 'classic'
        ? 'test/fixtures/classic-052-platform-upgrade/archived.deliver-pending.sdk-052.run.json'
        : 'test/fixtures/native-052-platform-upgrade/v3-shape-revalidate-pending.json',
      'utf8',
    ),
  ) as WorkflowRun | { run: WorkflowRun };
  const run = 'run' in fixture ? fixture.run : fixture;
  const legacy = path.join(project, '.comet/runtime');
  const source = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(legacy, 'sdk-runs', workflow),
  });
  await source.restoreCheckpoint!(run.runId, null, run);
  const target = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(project), 'sdk-runs', workflow),
  });
  return { root, project, run, legacy, source, target };
}

it('preserves a closed storage record and historical ownership without reopening it', async () => {
  const { project, run, legacy, source, target } = await isolatedImportFixture('native');
  // 存储层关闭标记与业务结果分开核对，不改写发布样本的交付结果。
  expect(await source.closeRun!(run.runId, run.revision)).toBe(true);
  const owner = {
    schema: 'comet.change-owner.v1',
    workflow: 'native',
    change: run.runId,
    format: 'sdk',
    application: 'native',
    runId: run.runId,
  };
  const history = path.join(legacy, 'change-owner-history/native');
  await fs.mkdir(history, { recursive: true });
  const text = JSON.stringify(owner);
  await fs.writeFile(path.join(history, run.runId + '.json'), text);
  await importLegacyWorkspaceRuntimeData(project);
  expect(await target.read(run.runId)).toEqual(run);
  expect(await target.readDisposition(run.runId)).toBe('closed');
  expect(await source.readDisposition(run.runId)).toBe('closed');
  expect(await readChangeRuntimeOwner(project, 'native', run.runId, { readOnly: true })).toEqual(
    owner,
  );
  await expect(
    fs.access(
      path.join(
        resolveWorkspaceRuntimeRootSync(project),
        'change-owners/native',
        run.runId + '.json',
      ),
    ),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(path.join(history, run.runId + '.json'), 'utf8')).toBe(text);
  expect((await importLegacyWorkspaceRuntimeData(project)).imported).toEqual([]);
  expect(await target.readDisposition(run.runId)).toBe('closed');
});

it('keeps newer target history and original source bytes on repeated imports', async () => {
  const { project, run, legacy, source, target } = await isolatedImportFixture();
  await importLegacyWorkspaceRuntimeData(project);
  const next = {
    ...run,
    revision: run.revision + 1,
    reason: 'Current authoritative storage record must win.',
  };
  expect(await target.compareAndSwap(run.runId, run.revision, next)).toBe(true);
  const sourceFiles = await fs.readdir(legacy, { recursive: true });
  const before = await Promise.all(
    sourceFiles.map(async (ref) => {
      const file = path.join(legacy, ref);
      return (await fs.lstat(file)).isFile()
        ? [ref, (await fs.readFile(file)).toString('base64')]
        : [ref, null];
    }),
  );
  expect((await importLegacyWorkspaceRuntimeData(project)).imported).toEqual([]);
  expect(await target.read(run.runId)).toEqual(next);
  expect(await source.read(run.runId)).toEqual(run);
  const after = await Promise.all(
    sourceFiles.map(async (ref) => {
      const file = path.join(legacy, ref);
      return (await fs.lstat(file)).isFile()
        ? [ref, (await fs.readFile(file)).toString('base64')]
        : [ref, null];
    }),
  );
  expect(after).toEqual(before);
});

it('rejects a corrupt old Run without creating an authoritative target or rewriting the source', async () => {
  const { project, run, legacy, target } = await isolatedImportFixture();
  const directory = path.join(legacy, 'sdk-runs/classic');
  const entry = (await fs.readdir(directory, { withFileTypes: true })).find((entry) =>
    entry.isFile(),
  )!;
  expect(entry).toBeDefined();
  const file = path.join(directory, entry.name),
    corrupt = '{"interrupted":';
  await fs.writeFile(file, corrupt);
  await expect(importLegacyWorkspaceRuntimeData(project)).rejects.toThrow(/旧 Run 无法导入/);
  expect(await target.read(run.runId)).toBeNull();
  expect(
    await readChangeRuntimeOwner(project, 'classic', run.runId, { readOnly: true }),
  ).toBeNull();
  expect(await fs.readFile(file, 'utf8')).toBe(corrupt);
});
