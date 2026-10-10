import { getCurrentVersion } from '../../../platform/version/version.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime.js';
import { inspectCometHook } from '../../../domains/comet-entry/hook-router.js';
import {
  loadWorkflowApplication,
  selectWorkflowApplication,
  type ApplicationBase,
} from '../../../domains/workflow-application/index.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-terminal-hook-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function terminal(base: ApplicationBase, cancelled: boolean, business = false) {
  const folder = path.join(root, 'fixed-application');
  await fs.mkdir(folder);
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
  await fs.writeFile(path.join(folder, 'SKILL.md'), '# Terminal Hook fixture\n');
  await fs.writeFile(
    path.join(folder, 'application.json'),
    JSON.stringify({
      schema: 'comet.workflow.application.v1',
      id: 'terminal-hook',
      version: '1',
      base,
      runtimeVersion: getCurrentVersion(),
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    }),
  );
  await fs.writeFile(
    path.join(folder, 'application.mjs'),
    `import {createRuntimeExecutor,defineRuntimeHandler} from '@rpamis/comet/runtime';
export function createApplication(){return {workflows:[{id:'terminal-contract',version:'1',entry:'prepare',steps:{prepare:{type:'call_tool',ref:'fixture.prepare'},decide:{type:'ask_user',choices:['rejected'],proposalFrom:'prepare'}},transitions:[{from:'prepare',to:'decide'}]}],executors:[createRuntimeExecutor({id:'fixture-prepare',handlers:{'fixture.prepare':defineRuntimeHandler({type:'call_tool',parseInput:value=>value,execute:()=>({status:'succeeded',output:{}})})}})],validators:[],inspectHook:()=>({allowed:false,reason:'固定包不得写入'})};}\n`,
  );
  const loaded = await loadWorkflowApplication({
    file: path.join(folder, 'application.json'),
    projectRoot: root,
  });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'terminal-contract',
    workflow: { id: 'terminal-contract', version: '1' },
    input: {},
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions[0].id,
    executorId: 'fixture-prepare',
  });
  if (cancelled) run = await runtime.cancel({ runId: run.runId, reason: 'Fixture cancellation' });
  else {
    const wait = run.waits[0];
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      choice: 'rejected',
      decisionId: 'fixture-terminal-decision',
    });
  }
  await selectWorkflowApplication(loaded, run.runId);
  return inspectCometHook(root, {
    intent: 'write',
    targets: [business ? path.join(root, 'report.md') : path.join(folder, 'SKILL.md')],
    toolName: 'Edit',
  });
}

it.each([false, true])(
  'protects the standalone fixed package after terminal cancellation=%s',
  async (cancelled) => {
    expect(await terminal('standalone', cancelled)).toMatchObject({
      allowed: false,
      reason: '固定应用、SDK 状态与宿主配置只能由正式 Runtime 或安装入口维护',
    });
  },
);

it.each([false, true])(
  'retains the standalone custom business Guard after terminal cancellation=%s',
  async (cancelled) => {
    expect(await terminal('standalone', cancelled, true)).toMatchObject({
      allowed: false,
      reason: '固定包不得写入',
    });
  },
);

it.each(['native', 'classic-tweak'] as const)(
  'retains the existing terminal behavior of %s applications',
  async (base) => {
    expect(await terminal(base, false)).toMatchObject({
      allowed: true,
      reason: '当前应用运行已结束',
    });
  },
);
