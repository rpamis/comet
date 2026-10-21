import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createRuntime,
  createPortableRunCheckpoint,
  readPortableRunCheckpoint,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import {
  loadWorkflowApplication,
  inspectWorkflowApplicationStorageIndex,
  repairWorkflowApplicationStorageIndex,
} from '../../../domains/workflow-application/index.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { createScopeCycleApplication } from '../../helpers/workflow-application.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function root() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cross-scope-'));
  roots.push(directory);
  return directory;
}
async function fixture(
  projectRoot: string,
  id: string,
  scope = 'shared.txt',
  runId = 'same-run',
  workspaceRoot?: string,
) {
  const packageDirectory = path.join(projectRoot, id);
  await fs.mkdir(packageDirectory);
  const disk = await createScopeCycleApplication(packageDirectory, true);
  disk.manifest.id = id;
  disk.manifest.skills[0].adapter.scope = [scope];
  if (workspaceRoot) {
    for (const binding of disk.manifest.bindings) binding.workspaceFrom = 'input.workspaceRoot';
    disk.manifest.skills[0].adapter.inputSchema = { type: 'object' };
  }
  await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
  const loaded = await loadWorkflowApplication({ file: disk.file, projectRoot });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId,
    workflow: { id: 'editorial', version: '1' },
    input: { topic: id, ...(workspaceRoot ? { workspaceRoot } : {}) },
  });
  run = await runtime.execute({ runId, actionId: run.actions[0].id, executorId: 'tool-host' });
  run = await runtime.resolveWait({
    runId,
    waitId: run.waits[0].id,
    proposalHash: run.waits[0].proposalHash,
    decisionId: `${id}-approval`,
    choice: 'approved',
  });
  const action = run.actions.at(-1)!;
  const request = {
    runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'local-skill',
    capabilities: ['skill-script'],
  };
  return { disk, loaded, runtime, run, action, request };
}
it('serializes simultaneous cross-application claims including identical Run IDs', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  const outcomes = await Promise.allSettled([
    alpha.runtime.claim(alpha.request),
    beta.runtime.claim(beta.request),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  const rejected = outcomes.find(
    (outcome) => outcome.status === 'rejected',
  ) as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ code: 'SCOPE_HELD', blockedRunIds: ['same-run'] });
  expect(
    [await alpha.runtime.inspect('same-run'), await beta.runtime.inspect('same-run')]
      .flatMap((run) => run.actions)
      .filter((action) => action.status === 'running'),
  ).toHaveLength(1);
});
it('uses each pinned application manifest and canonical paths rather than current bindings', async () => {
  const project = await root();
  await fs.mkdir(path.join(project, 'actual'));
  await fs.symlink(path.join(project, 'actual'), path.join(project, 'alias'), 'dir');
  const alpha = await fixture(project, 'alpha', 'actual');
  const beta = await fixture(project, 'beta', 'alias/nested.txt');
  const independent = await fixture(project, 'independent', 'elsewhere.txt');
  await alpha.runtime.claim(alpha.request);
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({
    code: 'SCOPE_HELD',
    blockedApplicationIds: ['alpha'],
  });
  expect((await independent.runtime.claim(independent.request)).actions.at(-1)?.status).toBe(
    'running',
  );
});
it('retains cancelled ownership across cold application reload until exact stop acknowledgement', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  const claimed = await alpha.runtime.claim({ ...alpha.request, claimToken: 'original' });
  const action = claimed.actions.at(-1)!;
  await alpha.runtime.cancel({ runId: claimed.runId, reason: 'cancel scheduling only' });
  const reload = await loadWorkflowApplication({ file: beta.disk.file, projectRoot: project });
  const runtime = createRuntime({ ...reload.implementation, store: reload.store });
  await expect(runtime.claim(beta.request)).rejects.toMatchObject({ code: 'SCOPE_HELD' });
  await alpha.runtime.acknowledgeStopped({
    runId: claimed.runId,
    stoppedActions: [
      {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'original',
        evidence: 'The original executor and all child processes have exited.',
      },
    ],
  });
  expect((await runtime.claim(beta.request)).actions.at(-1)?.status).toBe('running');
});
it('does not forget an active app when its complete Store directory disappears', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  await alpha.runtime.claim(alpha.request);
  const directory = path.join(resolveWorkspaceRuntimeRootSync(project), 'applications', 'alpha');
  const backup = path.join(project, 'preserved-alpha');
  await fs.rename(directory, backup);
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
  await fs.rename(backup, directory);
  const index = await inspectWorkflowApplicationStorageIndex(project, 'alpha');
  await repairWorkflowApplicationStorageIndex({
    projectRoot: project,
    applicationId: 'alpha',
    operation: 'audit',
    expectedEpoch: index!.epoch,
  });
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({ code: 'SCOPE_HELD' });
});
it('does not read inactive peer Run checkpoints or their full member inventory on a warm claim', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  await alpha.runtime.cancel({ runId: alpha.run.runId, reason: 'no execution' });
  const beta = await fixture(project, 'beta');
  const opened = vi.spyOn(fs, 'open');
  await beta.runtime.claim(beta.request);
  const peerPaths = opened.mock.calls
    .map((call) => String(call[0]))
    .filter((file) => file.includes(`${path.sep}applications${path.sep}alpha${path.sep}`));
  expect(
    peerPaths.some((file) => file.endsWith('checkpoint.json') || file.endsWith('inventory.json')),
  ).toBe(false);
});
it('rejects a corrupt peer holder index without executing the new action', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  await alpha.runtime.claim(alpha.request);
  await fs.writeFile(
    path.join(
      resolveWorkspaceRuntimeRootSync(project),
      'applications',
      'alpha',
      '.runtime-store-coordination',
      'index.json',
    ),
    '{}',
  );
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
  expect((await beta.runtime.inspect(beta.run.runId)).actions.at(-1)?.status).toBe('pending');
});

it('keeps unknown executions occupied across applications and protects fixed manifest identity', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  await alpha.runtime.claim({ ...alpha.request, claimToken: 'lost-owner' });
  await alpha.runtime.markUnknown({
    ...alpha.request,
    claimToken: 'lost-owner',
    reason: 'executor disconnected',
  });
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({ code: 'SCOPE_HELD' });
  await fs.writeFile(alpha.disk.file, '{}');
  await expect(beta.runtime.claim(beta.request)).rejects.toThrow();
  expect((await beta.runtime.inspect(beta.run.runId)).actions.at(-1)?.status).toBe('pending');
});
it('does not confuse an application named workspace with the workspace lock', async () => {
  const project = await root();
  const app = await fixture(project, 'workspace');
  expect((await app.runtime.claim(app.request)).actions.at(-1)?.status).toBe('running');
});
it('bootstraps workspace membership from existing per-application holder indexes', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  await alpha.runtime.claim(alpha.request);
  // 旧发布布局只有各应用 holder 索引，没有工作区级成员清单。
  const inventory = path.join(
    resolveWorkspaceRuntimeRootSync(project),
    'application-scope-locks',
    'workspace-applications.json',
  );
  await fs.rm(inventory);
  const beta = await fixture(project, 'beta');
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({ code: 'SCOPE_HELD' });
  expect(JSON.parse(await fs.readFile(inventory, 'utf8')).applications).toEqual(['alpha', 'beta']);
});
it('refuses a corrupt workspace membership checksum instead of reconstructing away holders', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  await alpha.runtime.claim(alpha.request);
  const inventory = path.join(
    resolveWorkspaceRuntimeRootSync(project),
    'application-scope-locks',
    'workspace-applications.json',
  );
  const data = JSON.parse(await fs.readFile(inventory, 'utf8'));
  data.applications = ['beta'];
  await fs.writeFile(inventory, JSON.stringify(data));
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
  expect((await beta.runtime.inspect(beta.run.runId)).actions.at(-1)?.status).toBe('pending');
});
it('still permits releasing an existing claim when an unrelated application directory is corrupt', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha', 'alpha.txt');
  const beta = await fixture(project, 'beta', 'beta.txt');
  await beta.runtime.claim({ ...beta.request, claimToken: 'beta-owner' });
  await fs.writeFile(
    path.join(resolveWorkspaceRuntimeRootSync(project), 'applications', 'bad-entry'),
    'not a directory',
  );
  const cancelled = await beta.runtime.cancel({
    runId: beta.run.runId,
    reason: 'stop existing execution',
    stoppedActions: [
      {
        actionId: beta.action.id,
        attempt: beta.action.attempt,
        inputHash: beta.action.inputHash,
        claimToken: 'beta-owner',
        evidence: 'The original executor and all child processes have exited.',
      },
    ],
  });
  expect(cancelled.status).toBe('cancelled');
  await expect(alpha.runtime.claim(alpha.request)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
});
it('rejects replacing an occupied app Store with a new empty directory under the same ID', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  await alpha.runtime.claim(alpha.request);
  const directory = path.join(resolveWorkspaceRuntimeRootSync(project), 'applications', 'alpha');
  await fs.rename(directory, path.join(project, 'preserved-alpha'));
  await fs.mkdir(directory);
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
  expect((await beta.runtime.inspect(beta.run.runId)).actions.at(-1)?.status).toBe('pending');
});

const portable = (run: WorkflowRun) =>
  readPortableRunCheckpoint(createPortableRunCheckpoint(run), run.runId, {
    preserveSourceRevision: true,
  })!;
const appDirectory = (project: string, id = 'alpha') =>
  path.join(resolveWorkspaceRuntimeRootSync(project), 'applications', id);
it('rejects a pre-claim checkpoint after the writer Store is lost, then restores the original unknown claim and releases only by proof', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  const stale = portable(alpha.run);
  const claimed = await alpha.runtime.claim({ ...alpha.request, claimToken: 'actual-writer' });
  const saved = portable(claimed);
  await fs.rm(appDirectory(project), { recursive: true });
  await expect(
    alpha.loaded.store.restoreCheckpoint!(stale.runId, null, stale),
  ).rejects.toMatchObject({ code: 'STORE_INDEX_CORRUPT' });
  expect(await alpha.loaded.store.restoreCheckpoint!(saved.runId, null, saved)).toBe(true);
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({ code: 'SCOPE_HELD' });
  const old = saved.actions.at(-1)!;
  await alpha.runtime.cancel({
    runId: saved.runId,
    reason: 'stop recovered original execution',
    stoppedActions: [
      {
        actionId: old.id,
        attempt: old.attempt,
        inputHash: old.inputHash,
        claimToken: old.claim!.token,
        evidence: 'The original executor and all child processes have exited.',
      },
    ],
  });
  expect((await beta.runtime.claim(beta.request)).actions.at(-1)?.status).toBe('running');
});
it('keeps the workspace fenced until every lost writer Run is recovered', async () => {
  const project = await root();
  const left = path.join(project, 'left-workspace');
  const right = path.join(project, 'right-workspace');
  await fs.mkdir(left);
  await fs.mkdir(right);
  const alpha = await fixture(project, 'alpha', 'shared.txt', 'first', left);
  const first = portable(
    await alpha.runtime.claim({ ...alpha.request, claimToken: 'first-owner' }),
  );
  let second = await alpha.runtime.start({
    runId: 'second',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'second', workspaceRoot: right },
  });
  second = await alpha.runtime.execute({
    runId: second.runId,
    actionId: second.actions[0].id,
    executorId: 'tool-host',
  });
  second = await alpha.runtime.resolveWait({
    runId: second.runId,
    waitId: second.waits[0].id,
    proposalHash: second.waits[0].proposalHash,
    decisionId: 'second-approval',
    choice: 'approved',
  });
  const action = second.actions.at(-1)!;
  second = portable(
    await alpha.runtime.claim({
      runId: second.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'local-skill',
      capabilities: ['skill-script'],
      claimToken: 'second-owner',
    }),
  );
  const beta = await fixture(project, 'beta', path.join(right, 'shared.txt'));
  await fs.rm(appDirectory(project), { recursive: true });
  expect(await alpha.loaded.store.restoreCheckpoint!(first.runId, null, first)).toBe(true);
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
  expect(await alpha.loaded.store.restoreCheckpoint!(second.runId, null, second)).toBe(true);
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({ code: 'SCOPE_HELD' });
});
it('does not accept a changed manifest to move a lost original writer to another scope', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const saved = portable(await alpha.runtime.claim(alpha.request));
  await fs.rm(appDirectory(project), { recursive: true });
  alpha.disk.manifest.skills[0].adapter.scope = ['other-file'];
  const replacementPackage = path.join(project, 'replacement-app');
  await fs.cp(alpha.disk.packageRoot, replacementPackage, { recursive: true });
  const replacementFile = path.join(replacementPackage, 'application.json');
  await fs.writeFile(replacementFile, JSON.stringify(alpha.disk.manifest));
  const changed = await loadWorkflowApplication({ file: replacementFile, projectRoot: project });
  await expect(changed.store.restoreCheckpoint!(saved.runId, null, saved)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
});
it('does not rebind an empty replacement when portable restore CAS fails', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  const saved = portable(await alpha.runtime.claim(alpha.request));
  await fs.rm(appDirectory(project), { recursive: true });
  expect(await alpha.loaded.store.restoreCheckpoint!(saved.runId, 1, saved)).toBe(false);
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
  expect(await alpha.loaded.store.restoreCheckpoint!(saved.runId, null, saved)).toBe(true);
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({ code: 'SCOPE_HELD' });
});
it('settles a proposed claim from actual authority when its CAS throws before commit', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  const rename = fs.rename.bind(fs);
  let rejected = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    if (
      !rejected &&
      String(destination).startsWith(appDirectory(project)) &&
      String(destination).endsWith('checkpoint.json')
    ) {
      rejected = true;
      throw new Error('before writer CAS');
    }
    await rename(source, destination);
  });
  await expect(alpha.runtime.claim(alpha.request)).rejects.toThrow('before writer CAS');
  vi.restoreAllMocks();
  expect(rejected).toBe(true);
  const inventory = JSON.parse(
    await fs.readFile(
      path.join(
        resolveWorkspaceRuntimeRootSync(project),
        'application-scope-locks/workspace-applications.json',
      ),
      'utf8',
    ),
  );
  expect(inventory.claims.alpha).toEqual([]);
  expect((await beta.runtime.claim(beta.request)).actions.at(-1)?.status).toBe('running');
});
it('retains the write-ahead claim if the app disappears immediately after the writer CAS', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha');
  const beta = await fixture(project, 'beta');
  const stale = portable(alpha.run);
  const rename = fs.rename.bind(fs);
  let saved: WorkflowRun | undefined;
  vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    await rename(source, destination);
    if (
      !saved &&
      String(destination).startsWith(appDirectory(project)) &&
      String(destination).endsWith('checkpoint.json')
    ) {
      saved = portable((await alpha.loaded.store.read(alpha.run.runId))!);
      await fs.rm(appDirectory(project), { recursive: true });
      throw new Error('lost app after writer CAS');
    }
  });
  await expect(
    alpha.runtime.claim({ ...alpha.request, claimToken: 'write-ahead-owner' }),
  ).rejects.toThrow();
  vi.restoreAllMocks();
  expect(saved).toBeDefined();
  await expect(
    alpha.loaded.store.restoreCheckpoint!(stale.runId, null, stale),
  ).rejects.toMatchObject({ code: 'STORE_INDEX_CORRUPT' });
  expect(await alpha.loaded.store.restoreCheckpoint!(saved!.runId, null, saved!)).toBe(true);
  await expect(beta.runtime.claim(beta.request)).rejects.toMatchObject({ code: 'SCOPE_HELD' });
});
it('allows restoring multiple missing applications without removing their remaining ownership fences', async () => {
  const project = await root();
  const alpha = await fixture(project, 'alpha', 'alpha.txt');
  const beta = await fixture(project, 'beta', 'beta.txt');
  const next = await fixture(project, 'next', 'beta.txt');
  const a = portable(await alpha.runtime.claim(alpha.request));
  const b = portable(await beta.runtime.claim(beta.request));
  await fs.rm(appDirectory(project, 'alpha'), { recursive: true });
  await fs.rm(appDirectory(project, 'beta'), { recursive: true });
  expect(await alpha.loaded.store.restoreCheckpoint!(a.runId, null, a)).toBe(true);
  await expect(next.runtime.claim(next.request)).rejects.toMatchObject({
    code: 'STORE_INDEX_CORRUPT',
  });
  expect(await beta.loaded.store.restoreCheckpoint!(b.runId, null, b)).toBe(true);
  await expect(next.runtime.claim(next.request)).rejects.toMatchObject({ code: 'SCOPE_HELD' });
});
it('does not turn a parallel read-only action into a writer recovery requirement', async () => {
  const project = await root();
  const disk = await createScopeCycleApplication(project, false);
  const reader = structuredClone(disk.manifest.skills[0]);
  reader.id = 'reader';
  reader.adapter.sideEffect = 'read';
  reader.adapter.scope = ['shared.txt'];
  disk.manifest.skills.push(reader);
  disk.manifest.bindings.find((binding) => binding.stepId === 'right')!.skillId = 'reader';
  await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
  const file = path.join(disk.packageRoot, 'application.mjs');
  const source = await fs.readFile(file, 'utf8');
  await fs.writeFile(
    file,
    source.replace(
      '"right":{"type":"invoke_skill","ref":"writer"',
      '"right":{"type":"invoke_skill","ref":"reader"',
    ),
  );
  const loaded = await loadWorkflowApplication({ file: disk.file, projectRoot: project });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'mixed',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'mixed' },
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions[0].id,
    executorId: 'tool-host',
  });
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: run.waits[0].id,
    proposalHash: run.waits[0].proposalHash,
    decisionId: 'approve-mixed',
    choice: 'approved',
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'tool-host',
  });
  for (const action of run.actions.filter((action) => action.status === 'pending'))
    await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'local-skill',
      capabilities: ['skill-script'],
    });
  run = await runtime.inspect(run.runId);
  const inventory = JSON.parse(
    await fs.readFile(
      path.join(
        resolveWorkspaceRuntimeRootSync(project),
        'application-scope-locks/workspace-applications.json',
      ),
      'utf8',
    ),
  );
  expect(inventory.claims[loaded.identity.id]).toHaveLength(1);
  expect(inventory.claims[loaded.identity.id][0].actionId).toBe(
    run.actions.find((action) => action.stepId === 'left')!.id,
  );
  const saved = portable(run);
  await fs.rm(appDirectory(project, loaded.identity.id), { recursive: true });
  expect(await loaded.store.restoreCheckpoint!(saved.runId, null, saved)).toBe(true);
  expect(
    (await runtime.inspect(run.runId)).actions.filter((action) => action.status === 'unknown'),
  ).toHaveLength(2);
});
