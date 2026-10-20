import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectDashboardApplicationRunDetail,
  collectDashboardApplicationRunPage,
  collectDashboardApplicationRunRecords,
} from '../../../domains/dashboard/application-collector.js';
import { applicationObservationFixture } from '../../helpers/dashboard-application-fixture.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime.js';
import { projectDashboardApplicationDefinition } from '../../../domains/dashboard/application-definition.js';

let root: string;
let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-definition-'));
  root = path.join(directory, 'project');
  await fs.mkdir(root);
  vi.stubEnv('COMET_DATA_DIR', path.join(directory, 'data'));
  vi.stubEnv('LOCALAPPDATA', path.join(directory, 'cache'));
  vi.stubEnv('XDG_CACHE_HOME', path.join(directory, 'cache'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});
const presentation = {
  title: '发布审阅',
  description: '检查两个并行结果后批准发布',
  steps: [
    {
      workflowId: 'fixture',
      stepId: 'draft',
      title: '起草说明',
      phase: '准备',
      outputFields: [{ path: 'scope', label: '范围' }],
    },
    { workflowId: 'fixture', stepId: 'implement', title: '实现', phase: '执行' },
    { workflowId: 'fixture', stepId: 'regression', title: '回归检查', phase: '执行' },
  ],
};
async function detail() {
  const page = await collectDashboardApplicationRunPage(root);
  const item = page.items.find((item) => item.kind === 'application' && !item.isChild)!;
  return (await collectDashboardApplicationRunDetail(root, item.locator, { recordLimit: 1 }))!;
}

it('shows the complete pinned graph without loading application code or needing Creator history', async () => {
  const fixture = await applicationObservationFixture(root, {
    definition: true,
    presentation,
    parallel: true,
  });
  const before = await fixture.outer.read(fixture.run.runId);
  const result = await detail();
  expect(result.sourceCreators).toEqual([]);
  expect(result.definition).toMatchObject({
    status: 'available',
    title: '发布审阅',
    workflow: {
      entry: ['draft'],
      transitions: expect.arrayContaining([{ from: 'draft', to: 'approve', on: 'succeeded' }]),
    },
    steps: expect.arrayContaining([
      expect.objectContaining({ stepId: 'draft', title: '起草说明', recordCount: 1 }),
      expect.objectContaining({
        stepId: 'review',
        observation: 'subworkflow',
        recordCount: 0,
        latestStatus: null,
      }),
    ]),
  });
  expect(result.definition.steps?.filter((step) => step.activeRecordIds.length)).toHaveLength(3);
  expect(result.definition.steps?.find((step) => step.stepId === 'draft')?.outputFields).toEqual([
    { path: 'scope', label: '范围' },
  ]);
  expect(JSON.stringify(result)).not.toContain('private-fixture');
  expect(await fixture.outer.read(fixture.run.runId)).toEqual(before);
  const history = await collectDashboardApplicationRunRecords(root, result.locator, { limit: 1 });
  expect(history?.items[0]).toMatchObject({ title: '起草说明', phase: '准备' });
});

it('keeps completed and active activations visible even when their records are not on the first page', async () => {
  const fixture = await applicationObservationFixture(root, {
    definition: true,
    presentation,
    parallel: true,
    claimParallel: false,
  });
  await fixture.runtime.dispatchCommand({
    runId: fixture.run.runId,
    expectedRevision: fixture.run.revision,
    name: 'repeat',
    commandId: 'again',
    input: { scope: 'revised' },
  });
  const result = await detail();
  const step = result.definition.steps?.find((step) => step.stepId === 'draft');
  expect(step).toMatchObject({ recordCount: 2, latestStatus: 'pending' });
  expect(step?.activeRecordIds).toHaveLength(1);
  expect(result.records.find((record) => record.id === step?.latestRecordId)).toBeDefined();
});

it('keeps real records when fixed material is missing or changed instead of presenting a new graph as the old run', async () => {
  const fixture = await applicationObservationFixture(root, { definition: true, presentation });
  await fs.appendFile(path.join(fixture.identity.packageRoot, 'workflow.json'), ' ');
  expect((await detail()).definition.status).toBe('changed');
  await fs.rename(
    path.join(fixture.identity.packageRoot, 'workflow.json'),
    path.join(root, 'saved-workflow.json'),
  );
  const result = await detail();
  expect(result.definition.status).not.toBe('available');
  expect(result.records[0].stepId).toBe('draft');
});

it('uses observed records for packages without a definition', async () => {
  await applicationObservationFixture(root);
  const result = await detail();
  expect(result.definition).toEqual({ status: 'missing' });
  expect(result.records[0].stepId).toBe('draft');
});

it('checks the run and every pinned child definition before exposing a graph', async () => {
  const fixture = await applicationObservationFixture(root, { definition: true });
  const definition = JSON.parse(
    await fs.readFile(path.join(fixture.identity.packageRoot, 'workflow.json'), 'utf8'),
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(fixture.identity.packageRoot, 'application.json'), 'utf8'),
  );
  const run = structuredClone(fixture.run);
  run.definitionHashes[JSON.stringify(['review', '1'])] = hashRuntimeValue('different');
  expect(
    projectDashboardApplicationDefinition({
      run,
      records: [],
      material: { status: 'matched', definition, manifest },
    }),
  ).toMatchObject({ status: 'changed' });
});
