import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createCreatorRuntime, listCreatorRuns } from '../../../domains/workflow-creation/index.js';
import {
  compileWorkflowApplication,
  type WorkflowApplicationPlan,
} from '../../../domains/workflow-generation/index.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-creator-sdk-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const analysis = () => ({
  summary: '生成报告，审批后在项目中发布。',
  limitations: ['本地发布；不会发送邮件。'],
  failurePaths: ['审批拒绝后保留草稿；内容变化重新审批。'],
  proposal: {
    schema: 'comet.workflow.application.plan.v1',
    manifest: {
      schema: 'comet.workflow.application.v1',
      id: 'weekly-report',
      version: '1',
      base: 'standalone',
      runtimeVersion: '0.4.5',
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    },
    composition: { kind: 'report' },
    modules: {},
  },
});
async function analyzed(prepare = true) {
  const runtime = createCreatorRuntime(root);
  let run = await runtime.start({
    runId: 'creation-one',
    workflow: { id: 'comet-creator', version: '1' },
    input: {
      goal: '每周报告先审后发布',
      installTarget: '.agents/skills/weekly-report',
      host: 'codex',
    },
  });
  const action = run.actions[0];
  run = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'creator-host',
    sessionId: 'actual-host',
    claimToken: 'analysis-claim',
    capabilities: ['skill-load', 'handoff'],
  });
  run = await runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'analysis-claim',
      outcomeId: 'analysis-one',
      status: 'succeeded',
      output: analysis(),
    },
  });
  return prepare
    ? (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run
    : run;
}
it('cold-resumes the same plan wait, compiles only after a current decision and previews without installing', async () => {
  let run = await analyzed();
  expect(run.waits.at(-1)?.stepId).toBe('confirm-plan');
  expect(
    await fs.stat(path.join(root, '.agents/skills/weekly-report')).catch(() => null),
  ).toBeNull();
  const runtime = createCreatorRuntime(root);
  const wait = run.waits.at(-1)!;
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'actual-user-approved-plan',
    choice: 'approved',
  });
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
  expect(run.waits.at(-1)?.stepId).toBe('confirm-install');
  expect(
    await fs.stat(path.join(root, '.agents/skills/weekly-report')).catch(() => null),
  ).toBeNull();
  expect(run.outputs.preview.value).toMatchObject({
    target: '.agents/skills/weekly-report',
    noFilesWritten: true,
  });
  const install = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: run.runId,
    waitId: install.id,
    proposalHash: install.proposalHash,
    decisionId: 'actual-user-approved-install',
    choice: 'approved',
  });
  run = (
    await createCreatorRuntime(root).runUntilBlocked({
      runId: run.runId,
      executorId: 'creator-local',
    })
  ).run;
  expect(run.status).toBe('completed');
  expect(
    await fs.readFile(path.join(root, '.agents/skills/weekly-report/application.json'), 'utf8'),
  ).toContain('weekly-report');
});
it('refuses installation after target drift and keeps the original approval wait', async () => {
  const runtime = createCreatorRuntime(root);
  let run = await analyzed();
  const wait = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'approved',
    choice: 'approved',
  });
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
  await fs.mkdir(path.join(root, '.agents/skills/weekly-report'), { recursive: true });
  await fs.writeFile(path.join(root, '.agents/skills/weekly-report/keep.txt'), 'unrelated');
  const install = run.waits.at(-1)!;
  await expect(
    runtime.resolveWait({
      runId: run.runId,
      waitId: install.id,
      proposalHash: install.proposalHash,
      decisionId: 'install',
      choice: 'approved',
    }),
  ).rejects.toThrow(/变化|漂移|冲突/);
  expect((await runtime.inspect(run.runId)).waits.at(-1)?.status).toBe('pending');
});

it('revise creates a new plan and installation decision and old approval cannot authorize the new target', async () => {
  const runtime = createCreatorRuntime(root);
  let run = await analyzed();
  const old = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: run.runId,
    waitId: old.id,
    proposalHash: old.proposalHash,
    decisionId: 'revise',
    choice: 'revise',
  });
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
  const action = run.actions.at(-1)!;
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'creator-host',
    claimToken: 'new-claim',
    capabilities: ['skill-load', 'handoff'],
  });
  await runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'new-claim',
      outcomeId: 'new-analysis',
      status: 'succeeded',
      output: { ...analysis(), installTarget: '.agents/skills/new-target' },
    },
  });
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
  expect(run.waits.at(-1)?.proposalHash).not.toBe(old.proposalHash);
  await expect(
    runtime.resolveWait({
      runId: run.runId,
      waitId: run.waits.at(-1)!.id,
      proposalHash: old.proposalHash,
      decisionId: 'stale',
      choice: 'approved',
    }),
  ).rejects.toThrow(/STALE/);
  expect(run.outputs.prepare.value).toMatchObject({ installTarget: '.agents/skills/new-target' });
});

it('blocks hosts without required capabilities before analysis and rejects forged preparation', async () => {
  const runtime = createCreatorRuntime(root);
  let run = await runtime.start({
    runId: 'missing-host',
    workflow: { id: 'comet-creator', version: '1' },
    input: { goal: '报告审批', installTarget: '.agents/skills/report', host: 'claude-code' },
  });
  const action = run.actions[0];
  await expect(
    runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'incapable',
      capabilities: [],
    }),
  ).rejects.toThrow(/CAPABILITY/);
  run = await analyzed(false);
  run = await runtime.next({ runId: run.runId });
  const prepare = run.actions.at(-1)!;
  await runtime.claim({
    runId: run.runId,
    actionId: prepare.id,
    attempt: prepare.attempt,
    inputHash: prepare.inputHash,
    executorId: 'fake',
    claimToken: 'fake',
  });
  await expect(
    runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: prepare.id,
        attempt: prepare.attempt,
        inputHash: prepare.inputHash,
        claimToken: 'fake',
        outcomeId: 'forged',
        status: 'succeeded',
        output: { completedChecks: ['all passed'] },
      },
    }),
  ).rejects.toThrow(/OUTCOME_REJECTED/);
  expect((await runtime.inspect(run.runId)).waits).toHaveLength(0);
});

it('reconciles a compiled package whose result was lost using the original Action without compiling again', async () => {
  const runtime = createCreatorRuntime(root);
  let run = await analyzed();
  const wait = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'actual-user',
    choice: 'approved',
  });
  run = await runtime.next({ runId: run.runId });
  const action = run.actions.at(-1)!;
  expect(action.stepId).toBe('compile');
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'creator-local',
    claimToken: 'actual-compilation',
  });
  const prepared = run.outputs.prepare.value as unknown as {
    plan: WorkflowApplicationPlan;
    planHash: string;
  };
  const target = path.join(
    root,
    '.comet/creator/packages',
    hashRuntimeValue([run.runId, prepared.planHash]),
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  const actual = await compileWorkflowApplication({
    plan: prepared.plan,
    confirmationHash: prepared.planHash,
    projectRoot: root,
    packageRoot: target,
  });
  const before = await fs.stat(actual.file);
  await runtime.markUnknown({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: 'transport lost after actual compilation',
  });
  await createCreatorRuntime(root).recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'actual-compilation',
      outcomeId: 'actual-reconciled',
      status: 'succeeded',
      output: actual as unknown as import('../../../domains/engine/runtime.js').RuntimeValue,
    },
  });
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
  expect(run.waits.at(-1)?.stepId).toBe('confirm-install');
  expect(run.actions.filter((a) => a.stepId === 'compile')).toHaveLength(1);
  expect(run.actions.find((a) => a.id === action.id)?.attempt).toBe(1);
  expect((await fs.stat(actual.file)).mtimeMs).toBe(before.mtimeMs);
});

it('discovers resumable Runs through SDK validation and rejects unsupported host or unsafe target before creating work', async () => {
  await analyzed();
  const listed = await listCreatorRuns(root);
  expect(listed.map((run) => run.runId)).toEqual(['creation-one']);
  expect(listed[0].waits[0].stepId).toBe('confirm-plan');
  const runtime = createCreatorRuntime(root);
  expect(() =>
    runtime.start({
      runId: 'bad-host',
      workflow: { id: 'comet-creator', version: '1' },
      input: { goal: '报告', host: 'other-agent', installTarget: '.agents/skills/report' },
    }),
  ).toThrow(/仅支持/);
  expect(() =>
    runtime.start({
      runId: 'bad-target',
      workflow: { id: 'comet-creator', version: '1' },
      input: { goal: '报告', host: 'codex', installTarget: '../outside' },
    }),
  ).toThrow(/相对目录/);
});
