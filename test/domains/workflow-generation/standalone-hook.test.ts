import { getCurrentVersion } from '../../../platform/version/version.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRuntime, hashRuntimeValue } from '../../../domains/engine/runtime.js';
import { inspectCometHook } from '../../../domains/comet-entry/hook-router.js';
import {
  loadWorkflowApplication,
  selectWorkflowApplication,
} from '../../../domains/workflow-application/index.js';
import {
  compileWorkflowApplication,
  prepareWorkflowApplicationPlan,
  type WorkflowApplicationProposal,
} from '../../../domains/workflow-generation/index.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-standalone-hook-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function proposal(ports: string): WorkflowApplicationProposal {
  return {
    schema: 'comet.workflow.application.plan.v1',
    manifest: {
      schema: 'comet.workflow.application.v1',
      id: 'scope-hook',
      version: '1',
      base: 'standalone',
      runtimeVersion: getCurrentVersion(),
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    },
    composition: {
      kind: 'standalone',
      workflows: [
        {
          id: 'scope-work',
          version: '1',
          entry: 'prepare',
          steps: {
            prepare: { type: 'call_tool', ref: 'fixture.prepare' },
            authorize: {
              type: 'ask_user',
              choices: ['approved', 'rejected'],
              proposalFrom: 'prepare',
            },
          },
          transitions: [{ from: 'prepare', to: 'authorize' }],
        },
      ],
      transitionHandlers: [],
      executorIds: ['fixture-prepare'],
      validatorRefs: [],
    },
    modules: {
      'bindings.mjs': `import path from 'node:path';
import {createRuntimeExecutor,defineRuntimeHandler} from '@rpamis/comet/runtime';
export function createBindings(context) {const executor=createRuntimeExecutor({id:'fixture-prepare',handlers:{'fixture.prepare':defineRuntimeHandler({type:'call_tool',parseInput:value=>value,execute:()=>({status:'succeeded',output:{scope:'work.txt'}})})}}); return {executors:[executor],validators:[],${ports}}; }
`,
    },
  };
}
const prepare = (value: WorkflowApplicationProposal) =>
  prepareWorkflowApplicationPlan({
    proposal: value,
    packageRoot: path.join(root, 'preview'),
    projectRoot: root,
  });

it('passes a fixed standalone Hook to the Router without granting unrelated writes', async () => {
  const plan = await prepare(
    proposal(
      `inspectHook: (run,request) => ({allowed:request.targets.every(target=>target===path.join(context.projectRoot,'work.txt')),reason:'只允许固定工作文件'})`,
    ),
  );
  const result = await compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    packageRoot: path.join(root, 'compiled'),
    projectRoot: root,
  });
  const loaded = await loadWorkflowApplication({ file: result.file, projectRoot: root });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'hook-only',
    workflow: { id: 'scope-work', version: '1' },
    input: {},
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions[0].id,
    executorId: 'fixture-prepare',
  });
  await selectWorkflowApplication(loaded, run.runId);
  for (const [target, allowed] of [
    ['work.txt', true],
    ['other.txt', false],
    ['.comet/runtime/forged.json', false],
  ] as const) {
    expect(
      await inspectCometHook(root, {
        intent: 'write',
        targets: [path.join(root, target)],
        toolName: 'Write',
      }),
    ).toMatchObject({ allowed });
  }
  await fs.appendFile(path.join(root, 'compiled/bindings.mjs'), '\n// changed guard\n');
  await expect(runtime.inspect(run.runId)).rejects.toThrow();
});

it('rejects a nonfunction standalone Hook rather than generating an unusable guard', async () => {
  await expect(prepare(proposal('inspectHook:true'))).rejects.toThrow(/inspectHook/);
});

it('rejects other standalone implementation overrides', async () => {
  await expect(prepare(proposal('validateOutcome:()=>({accepted:true})'))).rejects.toThrow();
});

it.each(['native', 'classic'] as const)(
  'does not permit a %s binding to replace its domain Hook',
  async (kind) => {
    const value = proposal('inspectHook:()=>({allowed:true,reason:"override"})');
    value.manifest.base = kind === 'native' ? 'native' : 'classic-tweak';
    value.composition =
      kind === 'native'
        ? { kind, extensions: [] }
        : { kind, profile: 'tweak', replacements: [], extensions: [] };
    await expect(prepare(value)).rejects.toThrow(/实现集合不能覆盖/);
  },
);
