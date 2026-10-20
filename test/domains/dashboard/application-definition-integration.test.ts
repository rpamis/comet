import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getCurrentVersion } from '../../../platform/version/version.js';
import { createRuntime, hashRuntimeValue } from '../../../domains/engine/runtime.js';
import {
  compileWorkflowApplication,
  prepareWorkflowApplicationPlan,
  type WorkflowApplicationProposal,
} from '../../../domains/workflow-generation/index.js';
import {
  exportWorkflowApplication,
  installWorkflowApplication,
  loadWorkflowApplication,
  previewWorkflowApplicationInstall,
} from '../../../domains/workflow-application/index.js';
import {
  collectDashboardApplicationRunDetail,
  collectDashboardApplicationRunPage,
} from '../../../domains/dashboard/application-collector.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';

let root: string;
let author: string;
let consumer: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-installed-definition-'));
  author = path.join(root, 'author');
  consumer = path.join(root, 'consumer');
  await fs.mkdir(author);
  await fs.mkdir(consumer);
  for (const [name, directory] of [
    ['COMET_DATA_DIR', 'data'],
    ['XDG_CACHE_HOME', 'cache'],
    ['XDG_CONFIG_HOME', 'config'],
    ['HOME', 'user'],
    ['USERPROFILE', 'user'],
    ['APPDATA', 'appdata'],
    ['LOCALAPPDATA', 'localappdata'],
  ]) {
    const directoryPath = path.join(root, directory);
    await fs.mkdir(directoryPath, { recursive: true });
    vi.stubEnv(name, directoryPath);
  }
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

function proposal(): WorkflowApplicationProposal {
  return {
    schema: 'comet.workflow.application.plan.v1',
    manifest: {
      schema: 'comet.workflow.application.v1',
      id: 'editorial-review',
      version: '1',
      base: 'standalone',
      runtimeVersion: getCurrentVersion(),
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    },
    presentation: {
      title: '资料整理与发布',
      description: '整理正文和来源，确认后生成发布结果。',
      steps: [
        {
          workflowId: 'editorial-review',
          stepId: 'draft',
          title: '整理正文',
          phase: '准备',
          outputFields: [{ path: 'summary', label: '正文摘要' }],
        },
        {
          workflowId: 'editorial-review',
          stepId: 'sources',
          title: '核对来源',
          phase: '准备',
        },
        {
          workflowId: 'editorial-review',
          stepId: 'review',
          title: '确认发布',
          phase: '审核',
        },
        {
          workflowId: 'editorial-review',
          stepId: 'publish',
          title: '生成发布结果',
          phase: '交付',
        },
      ],
    },
    composition: {
      kind: 'standalone',
      executorIds: ['editorial-local'],
      validatorRefs: [],
      transitionHandlers: [],
      workflows: [
        {
          id: 'editorial-review',
          version: '1',
          entry: ['draft', 'sources'],
          steps: {
            draft: { type: 'call_tool', ref: 'editorial.work' },
            sources: { type: 'call_tool', ref: 'editorial.work' },
            review: {
              type: 'ask_user',
              proposalFrom: ['draft', 'sources'],
              choices: ['approved', 'rejected'],
              join: ['draft', 'sources'],
            },
            publish: { type: 'call_tool', ref: 'editorial.work' },
          },
          transitions: [
            { from: 'draft', to: 'review' },
            { from: 'sources', to: 'review' },
            { from: 'review', to: 'publish', on: 'approved' },
          ],
        },
      ],
    },
    modules: {
      'bindings.mjs': `import { createRuntimeExecutor, defineRuntimeHandler } from '@rpamis/comet/runtime';
export function createBindings() {
  const work = defineRuntimeHandler({
    type: 'call_tool',
    parseInput: value => value,
    execute: async (_input, { action }) => ({
      status: 'succeeded',
      output: { summary: '已执行 ' + action.stepId }
    })
  });
  return {
    executors: [createRuntimeExecutor({ id: 'editorial-local', handlers: { 'editorial.work': work } })],
    validators: []
  };
}
`,
    },
  };
}

it('displays an exported and installed custom workflow from real SDK progress without Creator records', async () => {
  const plan = await prepareWorkflowApplicationPlan({
    proposal: proposal(),
    packageRoot: path.join(author, 'preview'),
    projectRoot: author,
  });
  const compiled = await compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    packageRoot: path.join(author, 'compiled'),
    projectRoot: author,
  });
  const exported = await exportWorkflowApplication({
    file: compiled.file,
    projectRoot: author,
    destination: path.join(root, 'exported'),
  });
  const options = {
    file: exported.file,
    projectRoot: consumer,
    scope: 'project' as const,
    userRoot: path.join(root, 'user'),
    platforms: ['codex'],
  };
  const preview = await previewWorkflowApplicationInstall(options);
  const installed = await installWorkflowApplication({
    ...options,
    confirmationHash: preview.confirmationHash,
  });
  const loaded = await loadWorkflowApplication({ file: installed.file, projectRoot: consumer });
  expect(loaded.identity.projectRoot).toBe(await fs.realpath(consumer));
  expect(await fs.readFile(path.join(path.dirname(installed.file), 'workflow.json'), 'utf8')).toBe(
    await fs.readFile(path.join(author, 'compiled/workflow.json'), 'utf8'),
  );
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  const runId = 'installed-editorial';
  await runtime.start({
    runId,
    workflow: { id: 'editorial-review', version: '1' },
    input: { topic: '本地文档' },
  });
  const list = await collectDashboardApplicationRunPage(consumer);
  expect(list.items).toHaveLength(1);
  expect(list.items[0]).toMatchObject({ kind: 'application', runId });
  const locator = list.items[0].locator;
  const initial = await collectDashboardApplicationRunDetail(consumer, locator);
  expect(initial).toMatchObject({
    sourceCreators: [],
    material: { status: 'matched' },
    definition: {
      status: 'available',
      title: '资料整理与发布',
      workflow: {
        id: 'editorial-review',
        entry: ['draft', 'sources'],
        transitions: [
          { from: 'draft', to: 'review', on: 'succeeded' },
          { from: 'sources', to: 'review', on: 'succeeded' },
          { from: 'review', to: 'publish', on: 'approved' },
        ],
        steps: { review: { type: 'ask_user', join: ['draft', 'sources'] } },
      },
    },
  });
  expect(initial?.definition.steps).toHaveLength(4);
  expect(initial?.definition.steps?.find((step) => step.stepId === 'publish')).toMatchObject({
    title: '生成发布结果',
    phase: '交付',
    recordCount: 0,
    latestStatus: null,
    activeRecordIds: [],
  });
  expect(initial?.records.filter((record) => record.active).map((record) => record.title)).toEqual([
    '整理正文',
    '核对来源',
  ]);

  await runtime.runUntilBlocked({ runId, executorId: 'editorial-local', maxActions: 1 });
  const partial = await collectDashboardApplicationRunDetail(consumer, locator);
  expect(partial?.definition.steps?.find((step) => step.stepId === 'draft')).toMatchObject({
    title: '整理正文',
    phase: '准备',
    recordCount: 1,
    latestStatus: 'succeeded',
    outputFields: [{ path: 'summary', label: '正文摘要' }],
  });
  expect(partial?.definition.steps?.find((step) => step.stepId === 'sources')).toMatchObject({
    latestStatus: 'pending',
  });

  const waiting = await runtime.runUntilBlocked({ runId, executorId: 'editorial-local' });
  expect(waiting.reason).toBe('approval-required');
  const before = await loaded.store.read(runId);
  const approval = await collectDashboardApplicationRunDetail(consumer, locator);
  expect(approval?.sourceCreators).toEqual([]);
  expect(approval?.records.find((record) => record.stepId === 'review')).toMatchObject({
    kind: 'decision',
    title: '确认发布',
    phase: '审核',
    status: 'waiting',
    active: true,
  });
  expect(approval?.definition.steps?.find((step) => step.stepId === 'publish')?.recordCount).toBe(
    0,
  );
  expect(await loaded.store.read(runId)).toEqual(before);

  const wait = waiting.run.waits.find((item) => item.status === 'pending')!;
  await runtime.resolveWait({
    runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'integration-user-approval',
    choice: 'approved',
  });
  const complete = await runtime.runUntilBlocked({ runId, executorId: 'editorial-local' });
  expect(complete.run.status).toBe('completed');
  const finished = await collectDashboardApplicationRunDetail(consumer, locator);
  expect(finished).toMatchObject({
    status: 'completed',
    sourceCreators: [],
    definition: { status: 'available', title: '资料整理与发布' },
  });
  expect(finished?.definition.steps?.find((step) => step.stepId === 'publish')).toMatchObject({
    title: '生成发布结果',
    latestStatus: 'succeeded',
    recordCount: 1,
    activeRecordIds: [],
  });
  await expect(
    fs.stat(path.join(resolveWorkspaceRuntimeRootSync(consumer), 'creator')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});
