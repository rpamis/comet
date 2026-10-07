import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRuntime,
  createFileRuntimeStore,
  createPortableRunCheckpoint,
  readPortableRunCheckpoint,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { loadWorkflowApplication } from '../../../domains/workflow-application/index.js';
import { readWorkflowApplicationRun } from '../../../domains/workflow-application/application.js';
import { createDiskApplication } from '../../helpers/workflow-application.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(base: 'standalone' | 'native' | 'classic-hotfix' = 'standalone') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fixed-app-checkpoint-'));
  roots.push(root);
  const disk = await createDiskApplication(root);
  if (base !== 'standalone') {
    disk.manifest.base = base;
    await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
  }
  const moduleFile = path.join(disk.packageRoot, 'application.mjs');
  await fs.writeFile(
    moduleFile,
    (await fs.readFile(moduleFile, 'utf8')).replace(
      'wrapStore: (store) => ({',
      'wrapStore: (store) => ({ ...store,',
    ),
  );
  const loaded = await loadWorkflowApplication({ file: disk.file, projectRoot: root });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'report',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'Actual topic' },
  });
  const action = run.actions[0];
  run = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'local-skill',
    claimToken: 'original-claim',
    capabilities: ['skill-script'],
  });
  const saved = readPortableRunCheckpoint(createPortableRunCheckpoint(run), run.runId, {
    preserveSourceRevision: true,
  })!;
  const rootDir = path.join(root, '.comet/runtime/applications/editorial');
  const raw = createFileRuntimeStore<{
    runId: string;
    revision: number;
    application: typeof loaded.identity;
    run: WorkflowRun;
  }>({ rootDir, mirroredRevisionPaths: ['run.revision'] });
  const lose = () => fs.rm(rootDir, { recursive: true });
  return { root, disk, loaded, run, saved, rootDir, raw, lose };
}

describe('fixed application checkpoint store boundary', () => {
  it.each([false, true])(
    'restores a missing or interrupted application record with matching nested revisions (partial=%s)',
    async (partial) => {
      const f = await fixture();
      await f.lose();
      if (partial)
        await f.raw.compareAndSwap(f.saved.runId, null, {
          runId: f.saved.runId,
          revision: 1,
          application: f.loaded.identity,
          run: { ...f.saved, revision: 1 },
        });
      expect(
        await f.loaded.store.restoreCheckpoint!(f.saved.runId, partial ? 1 : null, f.saved),
      ).toBe(true);
      expect(await f.loaded.store.read(f.saved.runId)).toEqual(f.saved);
      expect(await readWorkflowApplicationRun(f.root, 'editorial', f.saved.runId)).toEqual(f.saved);
      expect(
        await f.loaded.store.compareAndSwap(f.saved.runId, 1, { ...f.saved, revision: 2 }),
      ).toBe(false);
      expect(
        await f.loaded.store.compareAndSwap(f.saved.runId, f.saved.revision, {
          ...f.saved,
          revision: f.saved.revision + 1,
        }),
      ).toBe(true);
      const reopened = await loadWorkflowApplication({
        file: f.disk.file,
        projectRoot: f.root,
        runId: f.saved.runId,
        expectedIdentity: f.loaded.identity,
      });
      expect((await reopened.store.read(f.saved.runId))!.revision).toBe(f.saved.revision + 1);
    },
  );

  it.each(['native', 'classic-hotfix'] as const)(
    'requires matching %s change ownership before importing a fixed application Run',
    async (base) => {
      const f = await fixture(base);
      await f.lose();
      await expect(f.loaded.store.restoreCheckpoint!(f.saved.runId, null, f.saved)).rejects.toThrow(
        /change 归属/,
      );
      expect(await f.raw.read(f.saved.runId)).toBeNull();
      const workflow = base === 'native' ? 'native' : 'classic';
      const owner = {
        schema: COMET_CHANGE_OWNER_SCHEMA,
        workflow,
        change: f.saved.runId,
        format: 'sdk' as const,
        application: f.loaded.identity.id,
        runId: f.saved.runId,
      };
      await registerSdkChangeOwner(f.root, owner);
      expect(await f.loaded.store.restoreCheckpoint!(f.saved.runId, null, f.saved)).toBe(true);
      await f.lose();
      await fs.writeFile(
        path.join(f.root, '.comet/runtime/change-owners', workflow, `${f.saved.runId}.json`),
        JSON.stringify({ ...owner, application: 'another-application' }),
      );
      await expect(f.loaded.store.restoreCheckpoint!(f.saved.runId, null, f.saved)).rejects.toThrow(
        /change 归属/,
      );
      expect(await f.raw.read(f.saved.runId)).toBeNull();
    },
  );

  it('rejects active claims and mismatched Run IDs before restoring records', async () => {
    const f = await fixture();
    await f.lose();
    await expect(f.loaded.store.restoreCheckpoint!(f.run.runId, null, f.run)).rejects.toThrow(
      /portable checkpoint/,
    );
    await expect(f.loaded.store.restoreCheckpoint!('other', null, f.saved)).rejects.toThrow(
      /portable checkpoint/,
    );
    expect(await f.raw.read(f.saved.runId)).toBeNull();
  });

  it('revalidates fixed materials on restore and leaves missing history untouched on drift', async () => {
    const f = await fixture();
    await f.lose();
    await fs.appendFile(
      path.join(f.disk.packageRoot, 'application.mjs'),
      '\n// changed after load\n',
    );
    await expect(f.loaded.store.restoreCheckpoint!(f.saved.runId, null, f.saved)).rejects.toThrow(
      /漂移/,
    );
    expect(await f.raw.read(f.saved.runId)).toBeNull();
  });

  it.each(['application', 'state', 'nested-revision'])(
    'rejects %s drift in a retained initial application record',
    async (damage) => {
      const f = await fixture();
      await f.lose();
      const partial = {
        runId: f.saved.runId,
        revision: 1,
        application: f.loaded.identity,
        run: { ...f.saved, revision: 1 },
      };
      if (damage === 'application')
        partial.application = { ...partial.application, contentHash: '0'.repeat(64) };
      else if (damage === 'state') partial.run = { ...partial.run, input: { topic: 'changed' } };
      if (damage === 'nested-revision') {
        await expect(
          f.raw.compareAndSwap(f.saved.runId, null, { ...partial, run: f.saved }),
        ).rejects.toThrow(/镜像 revision/);
        expect(await f.raw.read(f.saved.runId)).toBeNull();
        return;
      }
      await f.raw.compareAndSwap(f.saved.runId, null, partial);
      if (damage === 'application')
        await expect(f.loaded.store.restoreCheckpoint!(f.saved.runId, 1, f.saved)).rejects.toThrow(
          /归属发生变化/,
        );
      else expect(await f.loaded.store.restoreCheckpoint!(f.saved.runId, 1, f.saved)).toBe(false);
      expect(await f.raw.read(f.saved.runId)).toEqual(partial);
    },
  );
});
