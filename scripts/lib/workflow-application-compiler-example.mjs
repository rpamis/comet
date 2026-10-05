#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { hashRuntimeValue, createRuntime } from '@rpamis/comet/runtime';
import { loadWorkflowApplication } from '@rpamis/comet/applications';
import {
  prepareWorkflowApplicationPlan,
  compileWorkflowApplication,
} from '@rpamis/comet/applications/compiler';

// 只在调用者选择的隔离目录生成本地报告；--approve 明确批准原 Run 的当前草稿。
const projectRoot = path.resolve(process.argv[2]);
await fs.mkdir(projectRoot, { recursive: true });
const packageRoot = path.join(projectRoot, 'compiled-application');
const file = path.join(packageRoot, 'application.json');
let existing = true;
try {
  await fs.access(file);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  existing = false;
}
if (!existing) {
  const proposal = {
    schema: 'comet.workflow.application.plan.v1',
    manifest: {
      schema: 'comet.workflow.application.v1',
      id: 'compiler-report',
      version: '1',
      base: 'standalone',
      runtimeVersion: JSON.parse(
        await fs.readFile(new URL(import.meta.resolve('@rpamis/comet/package.json')), 'utf8'),
      ).version,
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    },
    composition: { kind: 'report' },
    modules: {},
  };
  const plan = await prepareWorkflowApplicationPlan({ proposal, projectRoot, packageRoot });
  await compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    projectRoot,
    packageRoot,
  });
}
const loaded = await loadWorkflowApplication({
  file,
  projectRoot,
  ...(existing ? { runId: 'compiler-example' } : {}),
});
const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
let run;
if (existing) run = await runtime.inspect('compiler-example');
else {
  run = await runtime.start({
    runId: 'compiler-example',
    workflow: { id: 'report-publishing', version: '1' },
    input: {
      title: 'Compiler example',
      body: 'This report comes from a compiled application and actual local source.',
      sources: ['package consumer'],
    },
  });
  run = await runtime.next({ runId: run.runId });
  await runtime.runUntilBlocked({ runId: run.children[0].runId, executorId: 'report-local' });
  run = await runtime.next({ runId: run.runId });
}
if (process.argv.includes('--approve')) {
  const wait = run.waits.findLast((wait) => wait.status === 'pending');
  if (wait)
    await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'example-approval',
      choice: 'approved',
    });
  await runtime.runUntilBlocked({ runId: run.runId, executorId: 'report-local' });
  run = await runtime.inspect(run.runId);
}
process.stdout.write(
  JSON.stringify({
    status: run.status,
    runId: run.runId,
    published: run.actions.some(
      (action) => action.stepId === 'publish' && action.status === 'succeeded',
    ),
  }) + '\n',
);
