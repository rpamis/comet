import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRuntime, hashRuntimeValue } from '../../../domains/engine/runtime.js';
import { loadWorkflowApplication } from '../../../domains/workflow-application/index.js';
import {
  prepareWorkflowApplicationPlan,
  compileWorkflowApplication,
  type WorkflowApplicationProposal,
} from '../../../domains/workflow-generation/index.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-standalone-compiler-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const ports = `import {createRuntimeExecutor,defineRuntimeHandler} from '@rpamis/comet/runtime';
export function createBindings(){
  const work=defineRuntimeHandler({type:'call_tool',parseInput:v=>v,execute:async(v,{action})=>({status:'succeeded',output:{actual:action.stepId}})});
  return {executors:[createRuntimeExecutor({id:'custom-local',handlers:{'custom.work':work}})],validators:[]};
}`;
const handler = (destination: string) =>
  `export function route({run,event}) {return {state:{},next:event.kind==='action-outcome'&&event.stepId==='choose'?['${destination}']:[]};}`;
function proposal(destination = 'left'): WorkflowApplicationProposal {
  const source = handler(destination);
  return {
    schema: 'comet.workflow.application.plan.v1',
    manifest: {
      schema: 'comet.workflow.application.v1',
      id: 'custom-fork',
      version: '1',
      base: 'standalone',
      runtimeVersion: '0.4.5',
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    },
    composition: {
      kind: 'standalone',
      executorIds: ['custom-local'],
      validatorRefs: [],
      transitionHandlers: [
        {
          id: 'route',
          version: '1',
          module: 'route.mjs',
          exportName: 'route',
          sourceHash: hashRuntimeValue(source),
        },
      ],
      workflows: [
        {
          id: 'custom-fork',
          version: '1',
          entry: 'choose',
          initialState: {},
          stateSchema: { type: 'object', additionalProperties: false },
          transitionHandler: { id: 'route', version: '1' },
          steps: {
            choose: {
              type: 'call_tool',
              ref: 'custom.work',
              outputSchema: {
                type: 'object',
                required: ['actual'],
                properties: { actual: { type: 'string' } },
              },
            },
            [destination]: { type: 'call_tool', ref: 'custom.work' },
          },
          transitions: [{ from: 'choose', to: destination }],
          maxTransitions: 4,
        },
      ],
    },
    modules: { 'bindings.mjs': ports, 'route.mjs': source },
  };
}
async function compile(p: WorkflowApplicationProposal, name = 'compiled') {
  const plan = await prepareWorkflowApplicationPlan({
    proposal: p,
    projectRoot: root,
    packageRoot: path.join(root, 'preview'),
  });
  const compiled = await compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    projectRoot: root,
    packageRoot: path.join(root, name),
  });
  return {
    plan,
    compiled,
    loaded: await loadWorkflowApplication({ file: compiled.file, projectRoot: root }),
  };
}
it('assembles custom declared flows and real handlers deterministically, graph changes alter actual execution', async () => {
  const left = await compile(proposal(), 'left');
  const repeated = await compile(proposal(), 'repeated');
  expect(left.compiled.contentHash).toBe(repeated.compiled.contentHash);
  const right = await compile(proposal('right'), 'right');
  for (const [name, candidate] of [
    ['left', left],
    ['right', right],
  ] as const) {
    const runtime = createRuntime({
      ...candidate.loaded.implementation,
      store: candidate.loaded.store,
    });
    await runtime.start({ runId: name, workflow: { id: 'custom-fork', version: '1' }, input: {} });
    const run = (await runtime.runUntilBlocked({ runId: name, executorId: 'custom-local' })).run;
    expect(run.status).toBe('completed');
    expect(run.actions.map((a) => a.stepId)).toEqual(['choose', name]);
  }
});
it('rejects wrong handler bytes, missing ports, missing validators and conflicting declared graph snapshots', async () => {
  const wrong = proposal();
  if (wrong.composition.kind !== 'standalone') throw new Error('fixture');
  wrong.composition.transitionHandlers[0].sourceHash = '0'.repeat(64);
  await expect(compile(wrong)).rejects.toThrow(/摘要/);
  const missing = proposal();
  if (missing.composition.kind !== 'standalone') throw new Error('fixture');
  missing.composition.executorIds = [];
  await expect(compile(missing)).rejects.toThrow(/执行器/);
  const validator = proposal();
  if (validator.composition.kind !== 'standalone') throw new Error('fixture');
  validator.composition.workflows[0].steps.choose.validator = {
    id: 'actual-artifact',
    version: '1',
  };
  await expect(compile(validator)).rejects.toThrow(/验证器/);
  const { plan } = await compile(proposal(), 'valid');
  plan.workflows[0].maxTransitions = 8;
  await expect(
    compileWorkflowApplication({
      plan,
      confirmationHash: hashRuntimeValue(plan),
      projectRoot: root,
      packageRoot: path.join(root, 'conflict'),
    }),
  ).rejects.toThrow(/不匹配/);
});
it('uses native SDK child workflow and explicit joins and resumes the same independent approval in a cold runtime', async () => {
  const p = proposal();
  if (p.composition.kind !== 'standalone') throw new Error('fixture');
  p.composition.transitionHandlers = [];
  delete p.modules['route.mjs'];
  p.composition.workflows = [
    {
      id: 'custom-fork',
      version: '1',
      entry: 'draft',
      steps: {
        draft: { type: 'child_workflow', workflow: { id: 'draft-parts', version: '1' } },
        approve: { type: 'ask_user', proposalFrom: 'draft', choices: ['approved', 'revise'] },
        deliver: { type: 'call_tool', ref: 'custom.work' },
      },
      transitions: [
        { from: 'draft', to: 'approve' },
        { from: 'approve', to: 'deliver', on: 'approved' },
        { from: 'approve', to: 'draft', on: 'revise' },
      ],
      maxTransitions: 12,
    },
    {
      id: 'draft-parts',
      version: '1',
      entry: ['first', 'second'],
      steps: {
        first: { type: 'call_tool', ref: 'custom.work' },
        second: { type: 'call_tool', ref: 'custom.work' },
        join: { type: 'call_tool', ref: 'custom.work', join: ['first', 'second'] },
      },
      transitions: [
        { from: 'first', to: 'join' },
        { from: 'second', to: 'join' },
      ],
    },
  ];
  const { loaded } = await compile(p);
  let runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  await runtime.start({ runId: 'cold', workflow: { id: 'custom-fork', version: '1' }, input: {} });
  let run = (await runtime.runUntilBlocked({ runId: 'cold', executorId: 'custom-local' })).run;
  for (const child of run.children)
    await runtime.runUntilBlocked({ runId: child.runId, executorId: 'custom-local' });
  run = (await runtime.runUntilBlocked({ runId: 'cold', executorId: 'custom-local' })).run;
  expect(run.waits.at(-1)?.stepId).toBe('approve');
  expect(run.children).toHaveLength(1);
  runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  const wait = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: 'cold',
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'actual-user',
    choice: 'approved',
  });
  run = (await runtime.runUntilBlocked({ runId: 'cold', executorId: 'custom-local' })).run;
  expect(run.status).toBe('completed');
});
