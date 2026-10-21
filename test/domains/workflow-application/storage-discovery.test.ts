import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createRuntime,
  hashRuntimeValue,
  readRuntimeProjection,
} from '../../../domains/engine/runtime.js';
import { loadWorkflowApplication } from '../../../domains/workflow-application/application.js';
import { invokeWorkflowApplicationSkill } from '../../../domains/workflow-application/skill-invocation.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import * as runtimeExports from '../../../domains/engine/runtime.js';
import { getCurrentVersion } from '../../../platform/version/version.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-any-discovery-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
async function application(id: string, count = 1, cloneExisting = false) {
  const pkg = path.join(root, id);
  await fs.mkdir(pkg);
  const file = path.join(pkg, 'application.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      schema: 'comet.workflow.application.v1',
      id,
      version: '1',
      base: 'standalone',
      runtimeVersion: getCurrentVersion(),
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    }),
  );
  await fs.writeFile(path.join(pkg, 'SKILL.md'), '# Test application\n');
  const workflow = {
    id: 'simple',
    version: '1',
    entry: 'step0',
    steps: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`step${i}`, { type: 'call_tool', ref: 'tool' }]),
    ),
    transitions: Array.from({ length: count - 1 }, (_, i) => ({
      from: `step${i}`,
      to: `step${i + 1}`,
    })),
  };
  await fs.writeFile(
    path.join(pkg, 'application.mjs'),
    `export function createApplication(context){${cloneExisting ? 'if (context.existingRun) structuredClone(context.existingRun);' : ''}return {workflows:[${JSON.stringify(workflow)}]};}`,
  );
  const loaded = await loadWorkflowApplication({ file, projectRoot: root });
  return {
    file,
    id,
    loaded,
    runtime: createRuntime({ ...loaded.implementation, store: loaded.store }),
  };
}
async function start(
  app: Awaited<ReturnType<typeof application>>,
  id: string,
  completed = false,
  steps = Infinity,
  outputBytes = 8192,
) {
  let run = await app.runtime.start({
    runId: id,
    workflow: { id: 'simple', version: '1' },
    input: { topic: id },
  });
  if (completed) {
    while (steps-- > 0 && run.actions.some((a) => a.status === 'pending')) {
      const action = run.actions.at(-1)!;
      run = await app.runtime.claim({
        runId: id,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'host',
      });
      run = await app.runtime.recordOutcome({
        runId: id,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: run.actions.at(-1)!.claim!.token,
          outcomeId: `outcome-${action.id}`,
          status: 'succeeded',
          output: { text: 'x'.repeat(outputBytes) },
        },
      });
    }
  }
  return run;
}
const checkpoint = (id: string, runId: string, closed = false) =>
  path.join(
    resolveWorkspaceRuntimeRootSync(root),
    'applications',
    id,
    closed ? '.runtime-store-history' : '.runtime-store-v2',
    hashRuntimeValue(runId),
    'checkpoint.json',
  );

it.each(['inspect', 'resume'] as const)(
  '%s without ID isolates application and validated closed history',
  async (operation) => {
    const app = await application('main');
    const other = await application('other');
    await start(app, 'live');
    await start(other, 'other-live');
    await start(app, 'closed', true);
    await fs.writeFile(checkpoint('main', 'closed', true), '{corrupt history');
    await fs.writeFile(checkpoint('other', 'other-live'), '{corrupt other app');
    const open = vi.spyOn(fs, 'open');
    const result = await invokeWorkflowApplicationSkill({
      file: app.file,
      projectRoot: root,
      request: { operation },
    });
    expect(result.run.runId).toBe('live');
    expect(open.mock.calls.some(([file]) => String(file).includes('/applications/other/'))).toBe(
      false,
    );
    expect(
      open.mock.calls.some(([file]) => String(file).includes('/.runtime-store-history/')),
    ).toBe(false);
    await expect(
      invokeWorkflowApplicationSkill({
        file: app.file,
        projectRoot: root,
        request: { operation, runId: 'closed' },
      }),
    ).rejects.toThrow();
    const marker = path.join(
      resolveWorkspaceRuntimeRootSync(root),
      'applications',
      'main',
      hashRuntimeValue('closed'),
    );
    const validMarker = JSON.parse(await fs.readFile(marker, 'utf8'));
    await fs.writeFile(
      marker,
      JSON.stringify({ ...validMarker, writerProtocol: 'unknown-protocol' }),
    );
    await expect(
      invokeWorkflowApplicationSkill({ file: app.file, projectRoot: root, request: { operation } }),
    ).rejects.toThrow('无法读取');
    await fs.writeFile(marker, '{}');
    await expect(
      invokeWorkflowApplicationSkill({ file: app.file, projectRoot: root, request: { operation } }),
    ).rejects.toThrow('无法读取');
  },
);

it('still blocks ambiguous or corrupt active runs', async () => {
  const app = await application('main');
  await start(app, 'one');
  await start(app, 'two');
  const invoke = () =>
    invokeWorkflowApplicationSkill({
      file: app.file,
      projectRoot: root,
      request: { operation: 'resume' },
    });
  await expect(invoke()).rejects.toThrow('多个未结束任务');
  await fs.writeFile(checkpoint('main', 'two'), '{broken');
  await expect(invoke()).rejects.toThrow('无法读取');
});

it.each([false, true])(
  'loaded SDK queries preserve compact projections and checks (readOnly=%s)',
  async (readOnly) => {
    const app = await application('chain', 8);
    await start(app, 'done', true);
    await start(app, 'live', true, 7);
    const loaded = await loadWorkflowApplication({
      file: app.file,
      projectRoot: root,
      readOnly,
    });
    const read = vi.spyOn(loaded.store, 'read').mockRejectedValue(new Error('full read forbidden'));
    for (const id of ['done', 'live']) {
      const projection = await readRuntimeProjection(loaded.store, id);
      expect(projection.stats?.materializedEntries).toBe(0);
      expect(Object.isFrozen(projection.run)).toBe(true);
    }
    const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
    expect(await runtime.query({ runId: 'done', view: 'summary' })).toMatchObject({
      runId: 'done',
      status: 'completed',
    });
    expect(read).not.toHaveBeenCalled();
    const changed = structuredClone(loaded.implementation.workflows);
    changed[0].steps.step0 = { type: 'call_tool', ref: 'changed' };
    await expect(
      createRuntime({ ...loaded.implementation, workflows: changed, store: loaded.store }).query({
        runId: 'done',
        view: 'summary',
      }),
    ).rejects.toThrow();
    await fs.appendFile(path.join(root, 'chain', 'SKILL.md'), 'changed package');
    await expect(runtime.query({ runId: 'done', view: 'summary' })).rejects.toMatchObject({
      code: 'WORKFLOW_CHANGED',
    });
  },
);

it('resumes a healthy task after a proven aborted registration without ignoring uncertain records', async () => {
  const app = await application('main');
  const link = fs.link.bind(fs);
  vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
    if (path.basename(String(destination)) === 'checkpoint.json')
      throw new Error('publication failed');
    return link(source, destination);
  });
  await expect(start(app, 'aborted')).rejects.toThrow('publication failed');
  vi.restoreAllMocks();
  await start(app, 'healthy');
  const invoke = () =>
    invokeWorkflowApplicationSkill({
      file: app.file,
      projectRoot: root,
      request: { operation: 'resume' },
    });
  expect((await invoke()).run.runId).toBe('healthy');
  expect((await invoke()).run.runId).toBe('healthy');
  await fs.writeFile(checkpoint('main', 'aborted'), '{uncertain committed data');
  await expect(invoke()).rejects.toThrow('无法读取');
});

it('keeps the Skill current view bounded while retaining explicit complete evidence', async () => {
  const app = await application('skill-history', 101);
  const run = await start(app, 'long-lived', true, 100, 512);
  expect(run.actions).toHaveLength(101);
  const inspect = await invokeWorkflowApplicationSkill({
    file: app.file,
    projectRoot: root,
    request: { operation: 'inspect', runId: run.runId },
  });
  expect(inspect.run.history.actions).toBe(101);
  expect(inspect.run.current.actions).toHaveLength(1);
  expect(inspect.run.continuation.mode).toBe('execute');
  // 当前 Action 的输入本身可能包含已声明的依赖；不能通过删掉必需输入伪造有界读取。
  const currentAction = inspect.run.current.actions[0];
  const claimed = await invokeWorkflowApplicationSkill({
    file: app.file,
    projectRoot: root,
    request: { operation: 'claim', runId: run.runId, actionId: currentAction.id },
  });
  expect(claimed.run.current.actions[0].status).toBe('running');
  expect(claimed.receipts.actions).toHaveLength(1);
  const receipt = JSON.parse(Buffer.from(claimed.receipts.actions[0], 'base64url').toString());
  const completed = await invokeWorkflowApplicationSkill({
    file: app.file,
    projectRoot: root,
    request: {
      operation: 'record-outcome',
      receipt,
      result: { status: 'succeeded', output: { text: 'last output' } },
    },
  });
  expect(completed.run.status).toBe('completed');
  expect(completed.run.outputsOmitted?.count).toBe(101);
  expect(completed.run.outputs).toBeUndefined();
  expect(Buffer.byteLength(JSON.stringify(completed))).toBeLessThan(5000);
  const originalRuntime = runtimeExports.createRuntime;
  const projections: Awaited<ReturnType<ReturnType<typeof createRuntime>['inspectProjection']>>[] =
    [];
  vi.spyOn(runtimeExports, 'createRuntime').mockImplementation((options) => {
    const runtime = originalRuntime(options);
    return {
      ...runtime,
      inspect: async () => {
        throw new Error('Skill current view must not inspect full history');
      },
      inspectProjection: async (id) => {
        const projection = await runtime.inspectProjection(id);
        projections.push(projection);
        return projection;
      },
    };
  });
  for (const operation of ['inspect', 'resume'] as const) {
    const result = await invokeWorkflowApplicationSkill({
      file: app.file,
      projectRoot: root,
      request: { operation, runId: run.runId },
    });
    expect(result.run.history.actions).toBe(101);
    expect(result.run.current.actions).toEqual([]);
    expect(result.run.outputsOmitted?.count).toBe(101);
    expect(result.run.inspection.request).toEqual({ operation: 'inspect', runId: run.runId });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(5000);
  }
  expect(projections).toHaveLength(2);
  expect(projections.every((projection) => projection.stats?.materializedEntries === 0)).toBe(true);
  vi.restoreAllMocks();
  const loaded = await loadWorkflowApplication({
    file: app.file,
    projectRoot: root,
    runId: run.runId,
    readOnly: true,
  });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  const projection = await runtime.inspectProjection(run.runId);
  expect(projection.stats?.materializedEntries).toBe(0);
  expect((await runtime.inspect(run.runId)).outputs.step0).toEqual({
    sequence: 1,
    value: { text: 'x'.repeat(512) },
  });
}, 240_000);

it('keeps unknown claimed work and its original receipt in the compact Skill view', async () => {
  const app = await application('unknown-work');
  let run = await start(app, 'uncertain');
  const action = run.actions[0];
  run = await app.runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'host',
  });
  const token = run.actions[0].claim!.token;
  await app.runtime.markUnknown({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: 'original host disconnected',
  });
  const resumed = await invokeWorkflowApplicationSkill({
    file: app.file,
    projectRoot: root,
    request: { operation: 'resume', runId: run.runId },
  });
  expect(resumed.run.continuation.mode).toBe('reconcile');
  expect(resumed.run.current.actions[0]).toMatchObject({
    id: action.id,
    status: 'unknown',
    claim: { token },
  });
  expect(
    JSON.parse(Buffer.from(resumed.receipts.actions[0], 'base64url').toString()),
  ).toMatchObject({ actionId: action.id, claimToken: token });
  await expect(
    invokeWorkflowApplicationSkill({
      file: app.file,
      projectRoot: root,
      request: { operation: 'claim', runId: run.runId, actionId: action.id },
    }),
  ).rejects.toThrow('pending');
});

it('keeps explicit factory history access compatible with structuredClone', async () => {
  const app = await application('factory-history', 2, true);
  const run = await start(app, 'original', true, 1);
  const loaded = await loadWorkflowApplication({
    file: app.file,
    projectRoot: root,
    runId: run.runId,
    readOnly: true,
  });
  expect(
    (
      await createRuntime({ ...loaded.implementation, store: loaded.store }).inspectProjection(
        run.runId,
      )
    ).run.revision,
  ).toBe(run.revision);
});
