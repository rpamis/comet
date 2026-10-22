import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRuntime, createMemoryRuntimeStore } from '../../../domains/engine/runtime.js';
import { createApplicationHook } from '../../../domains/workflow-application/application-hook.js';
import { loadWorkflowApplication } from '../../../domains/workflow-application/index.js';
import { createScopeCycleApplication } from '../../helpers/workflow-application.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-default-hook-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function childTree(count: number) {
  const entries = Array.from({ length: count }, (_, index) => `child${index}`);
  const child = {
    id: 'worker',
    version: '1',
    entry: 'work',
    steps: { work: { type: 'invoke_skill' as const, ref: 'read' } },
  };
  const parent = {
    id: 'parent',
    version: '1',
    entry: entries,
    steps: {
      ...Object.fromEntries(
        entries.map((stepId) => [
          stepId,
          {
            type: 'child_workflow' as const,
            workflow: { id: child.id, version: child.version },
          },
        ]),
      ),
      finish: { type: 'call_tool' as const, ref: 'write', join: entries },
    },
    transitions: entries.map((from) => ({ from, to: 'finish' })),
  };
  const runtime = createRuntime({ store: createMemoryRuntimeStore(), workflows: [parent, child] });
  let run = await runtime.start({ runId: 'parent', workflow: parent, input: null });
  run = await runtime.next({ runId: run.runId });
  const hookOptions: Parameters<typeof createApplicationHook>[0] = {
    projectRoot: root,
    packageRoot: path.join(root, 'package'),
    manifest: { id: 'scale', bindings: [], skills: [] } as Parameters<
      typeof createApplicationHook
    >[0]['manifest'],
    skills: new Map(),
    readChild: (runId) => runtime.inspect(runId),
    custom: () => ({ allowed: true, reason: 'declared tool write' }),
  };
  const hook = createApplicationHook(hookOptions);
  const request = { intent: 'write' as const, targets: [path.join(root, 'output.txt')] };
  return { runtime, run, hook, request, hookOptions };
}

it('allows current work after 128 verified completed child Runs without treating history as active width', async () => {
  const f = await childTree(128);
  for (const child of f.run.children) {
    const run = await f.runtime.inspect(child.runId);
    const action = run.actions[0];
    const claimToken = `claim-${run.runId}`;
    await f.runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'reader',
      claimToken,
    });
    await f.runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken,
        outcomeId: `done-${run.runId}`,
        status: 'succeeded',
        output: null,
      },
    });
  }
  const run = await f.runtime.next({ runId: f.run.runId });
  expect(
    run.actions.filter(
      (action) => action.type === 'child_workflow' && action.status === 'succeeded',
    ),
  ).toHaveLength(128);
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'finish', status: 'pending' });
  expect(await f.hook(run, f.request)).toMatchObject({ allowed: true });
  const invalidOwner = createApplicationHook({
    ...f.hookOptions,
    readChild: async (runId) => ({ ...(await f.runtime.inspect(runId)), lineage: ['other'] }),
  });
  expect(await invalidOwner(run, f.request)).toMatchObject({
    allowed: false,
    reason: '子流程没有当前 SDK Run 的有效归属',
  });
  const disk = await createScopeCycleApplication(root, true);
  const adapted = await loadWorkflowApplication({ file: disk.file, projectRoot: root });
  const writer = adapted.skills.get('writer')!;
  const terminalHook = createApplicationHook({
    ...f.hookOptions,
    manifest: {
      ...f.hookOptions.manifest,
      bindings: [
        {
          workflowId: 'worker',
          stepId: 'work',
          skillId: 'read',
          usage: 'action',
          capability: 'title',
        },
      ],
    },
    skills: new Map([['read', { ...writer, id: 'read' }]]),
  });
  const cancelled = await f.runtime.cancel({ runId: run.runId, reason: 'stop after children' });
  expect(await terminalHook(cancelled, { intent: 'write', targets: ['shared.txt'] })).toMatchObject(
    {
      allowed: false,
      reason: '已结束 Run 的声明产物保持固定；继续修改应启动新的 Run',
    },
  );
  expect(await terminalHook(cancelled, f.request)).toMatchObject({ allowed: true });
});

it('still rejects excessive active child width, including cancelled claims without stop confirmation', async () => {
  const f = await childTree(128);
  expect(await f.hook(f.run, f.request)).toMatchObject({
    allowed: false,
    reason: '活跃子流程超出安全读取范围',
  });
  for (const child of f.run.children) {
    const run = await f.runtime.inspect(child.runId);
    const action = run.actions[0];
    await f.runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'reader',
      claimToken: `claim-${run.runId}`,
    });
  }
  const cancelled = await f.runtime.cancel({
    runId: f.run.runId,
    reason: 'user stopped scheduling',
  });
  expect((await f.runtime.inspect(cancelled.children[0].runId)).actions[0]).toMatchObject({
    status: 'cancelled',
    claim: { executorId: 'reader' },
  });
  expect(await f.hook(cancelled, f.request)).toMatchObject({
    allowed: false,
    reason: '活跃子流程超出安全读取范围',
  });
});
async function fixture(custom = false, scope = 'shared.txt') {
  const disk = await createScopeCycleApplication(root, true);
  disk.manifest.skills[0].adapter.scope = [scope];
  (disk.manifest as typeof disk.manifest & { rule: string }).rule = 'rules/workflow-guard.md';
  await fs.mkdir(path.join(disk.packageRoot, 'rules'));
  await fs.writeFile(
    path.join(disk.packageRoot, 'rules/workflow-guard.md'),
    '# Application rule\n\nFollow the actual SDK Run.\n',
  );
  await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
  if (custom) {
    const source = await fs.readFile(path.join(disk.packageRoot, 'application.mjs'), 'utf8');
    await fs.writeFile(
      path.join(disk.packageRoot, 'application.mjs'),
      source.replace(
        'return { workflows:',
        'return { inspectHook: () => ({allowed:true,reason:"custom"}), workflows:',
      ),
    );
  }
  const loaded = await loadWorkflowApplication({ file: disk.file, projectRoot: root });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'default-hook',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'actual' },
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions[0].id,
    executorId: 'tool-host',
  });
  const inspect = (state: typeof run, refs: string[]) =>
    loaded.implementation.inspectHook!(state, {
      intent: 'write',
      toolName: 'Write',
      targets: refs.map((ref) => path.join(root, ref)),
    });
  return { disk, loaded, runtime, run, inspect };
}
it('provides a default Guard and grants only the currently claimed, approved Skill write scope', async () => {
  const f = await fixture();
  expect(typeof f.loaded.implementation.inspectHook).toBe('function');
  expect(await f.inspect(f.run, ['shared.txt'])).toMatchObject({ allowed: false });
  const wait = f.run.waits[0];
  let run = await f.runtime.resolveWait({
    runId: f.run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'fixture-approve',
    choice: 'approved',
  });
  expect(await f.inspect(run, ['shared.txt'])).toMatchObject({ allowed: false });
  const action = run.actions.find((action) => action.status === 'pending')!;
  run = await f.runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'local-skill',
    claimToken: 'fixture-claim',
    capabilities: ['skill-script'],
  });
  expect(await f.inspect(run, ['shared.txt'])).toMatchObject({ allowed: true });
  expect(await f.inspect(run, ['other.txt'])).toMatchObject({ allowed: false });
  expect(await f.inspect(run, ['shared.txt', '.comet/runtime/forged.json'])).toMatchObject({
    allowed: false,
  });
  run = await f.runtime.markUnknown({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: 'fixture lost result',
  });
  expect(await f.inspect(run, ['shared.txt'])).toMatchObject({ allowed: false });
});

it('a claimed root write scope still cannot modify host Rule carriers', async () => {
  const f = await fixture(true, '.');
  const wait = f.run.waits[0];
  let run = await f.runtime.resolveWait({
    runId: f.run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'root-scope-fixture',
    choice: 'approved',
  });
  const action = run.actions.find((action) => action.status === 'pending')!;
  run = await f.runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'local-skill',
    claimToken: 'root-fixture',
    capabilities: ['skill-script'],
  });
  expect(await f.inspect(run, ['normal.txt'])).toMatchObject({ allowed: true });
  for (const ref of ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'])
    expect(await f.inspect(run, [ref])).toMatchObject({ allowed: false });
});
it('custom Guards cannot grant writes to SDK state, fixed packages or unapproved Skill scopes', async () => {
  const f = await fixture(true);
  for (const ref of [
    '.comet/runtime/forged.json',
    '.comet/current-change.json',
    'package/application.mjs',
    'AGENTS.md',
    'AGENTS.override.md',
    'CLAUDE.md',
    'shared.txt',
  ])
    expect(await f.inspect(f.run, [ref])).toMatchObject({ allowed: false });
  expect(await f.inspect(f.run, ['.comet/requests/inspect.json'])).toMatchObject({ allowed: true });
});
it('requires the declared application Rule to exist within the fixed package', async () => {
  const f = await fixture();
  await fs.rm(path.join(f.disk.packageRoot, 'rules/workflow-guard.md'));
  await expect(loadWorkflowApplication({ file: f.disk.file, projectRoot: root })).rejects.toThrow(
    /规则|Rule/,
  );
});

it('rejects nested default write scopes when repair-cycle reachability does not serialize active work', async () => {
  const disk = await createScopeCycleApplication(root, false);
  disk.manifest.skills[0].adapter.scope = ['reports'];
  const nested = structuredClone(disk.manifest.skills[0]);
  nested.id = 'nested-writer';
  nested.adapter.scope = ['reports/final.md'];
  disk.manifest.skills.push(nested);
  disk.manifest.bindings[1].skillId = nested.id;
  await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
  const module = path.join(disk.packageRoot, 'application.mjs');
  await fs.writeFile(
    module,
    (await fs.readFile(module, 'utf8')).replace(
      'export function createApplication',
      'workflow.steps.right = {...workflow.steps.right, ref:"nested-writer"};\nexport function createApplication',
    ),
  );
  const loaded = await loadWorkflowApplication({ file: disk.file, projectRoot: root });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'nested',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'actual' },
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions[0].id,
    executorId: 'tool-host',
  });
  const wait = run.waits[0];
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'approved',
    choice: 'approved',
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'tool-host',
  });
  const action = run.actions.find((a) => a.stepId === 'left')!;
  await expect(
    runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'local-skill',
      capabilities: ['skill-script'],
      claimToken: 'nested-claim',
    }),
  ).rejects.toMatchObject({ code: 'COMMAND_REJECTED' });
  expect((await runtime.inspect(run.runId)).actions.find((a) => a.id === action.id)?.status).toBe(
    'pending',
  );
});

it('serializes competing claims across sibling Runs and retains unknown write ownership', async () => {
  const disk = await createScopeCycleApplication(root, true);
  disk.manifest.skills[0].adapter.inputSchema = { type: 'object' };
  await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
  const module = path.join(disk.packageRoot, 'application.mjs');
  await fs.writeFile(
    module,
    (await fs.readFile(module, 'utf8')).replace(
      'workflows: [workflow]',
      `workflows: [workflow,{id:'parent',version:'1',entry:['a','b'],steps:{a:{type:'child_workflow',workflow:{id:'editorial',version:'1'}},b:{type:'child_workflow',workflow:{id:'editorial',version:'1'}}}}]`,
    ),
  );
  const loaded = await loadWorkflowApplication({ file: disk.file, projectRoot: root });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let parent = await runtime.start({
    runId: 'parent',
    workflow: { id: 'parent', version: '1' },
    input: { topic: 'actual' },
  });
  parent = await runtime.next({ runId: parent.runId });
  const claims = [];
  for (const child of parent.children) {
    let run = await runtime.inspect(child.runId);
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions[0].id,
      executorId: 'tool-host',
    });
    const wait = run.waits[0];
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'approved',
      choice: 'approved',
    });
    const action = run.actions.find((a) => a.status === 'pending')!;
    claims.push({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'local-skill',
      capabilities: ['skill-script'],
      claimToken: run.runId + '-claim',
    });
  }
  const results = await Promise.allSettled(claims.map((claim) => runtime.claim(claim)));
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ code: 'SCOPE_HELD' });
  expect(
    await loaded.implementation.inspectHook!(parent, { intent: 'write', targets: ['shared.txt'] }),
  ).toMatchObject({ allowed: true });
  const winner = results.findIndex((result) => result.status === 'fulfilled');
  await runtime.markUnknown({ ...claims[winner], reason: 'lost executor' });
  await expect(runtime.claim(claims[1 - winner])).rejects.toMatchObject({
    code: 'SCOPE_HELD',
  });
  expect(
    await loaded.implementation.inspectHook!(parent, { intent: 'write', targets: ['shared.txt'] }),
  ).toMatchObject({ allowed: false });
});
