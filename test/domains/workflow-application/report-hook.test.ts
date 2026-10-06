import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  createRuntimeExecutor,
  defineRuntimeHandler,
  hashRuntimeValue,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { createReportApplication } from '../../../domains/workflow-application/index.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-report-hook-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// Guard-only fixture: one real material Action and Wait; no report generation/source/publishing work.
async function material(runId = 'guard-only') {
  const ref = `.comet/reports/local-report/drafts/${hashRuntimeValue(runId)}.md`;
  const markdown = '# Existing report\n\nPreviously recorded material.\n';
  const artifact = {
    ref,
    markdown,
    contentHash: createHash('sha256').update(markdown).digest('hex'),
  };
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'report-publishing',
        version: '1',
        transitionHandler: { id: 'guard-fixture-transition', version: '1' },
        entry: 'generate',
        steps: {
          generate: { type: 'call_tool', ref: 'fixture.material' },
          approve: {
            type: 'ask_user',
            choices: ['approved', 'rejected'],
            proposalFrom: 'generate',
          },
          publish: { type: 'call_tool', ref: 'fixture.publish' },
        },
        transitions: [
          { from: 'generate', to: 'approve' },
          { from: 'approve', on: 'approved', to: 'publish' },
        ],
      },
    ],
    transitionHandlers: [
      {
        id: 'guard-fixture-transition',
        version: '1',
        apply: ({ run, event }) => ({
          state: run.state ?? null,
          next:
            event.kind === 'action-outcome' && event.stepId === 'generate'
              ? ['approve']
              : event.kind === 'wait-resolved' && event.choice === 'approved'
                ? ['publish']
                : [],
        }),
      },
    ],
    executors: [
      createRuntimeExecutor({
        id: 'fixture-material',
        handlers: {
          'fixture.material': defineRuntimeHandler({
            type: 'call_tool',
            parseInput: (value) => value,
            async execute() {
              await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
              await fs.writeFile(path.join(root, ref), markdown);
              return { status: 'succeeded', output: { compose: artifact } };
            },
          }),
          'fixture.publish': defineRuntimeHandler({
            type: 'call_tool',
            parseInput: (value) => value,
            execute: () => ({ status: 'failed', output: {} }),
          }),
        },
      }),
    ],
  });
  let run = await runtime.start({
    runId,
    workflow: { id: 'report-publishing', version: '1' },
    input: {},
  });
  run = await runtime.execute({
    runId,
    actionId: run.actions[0].id,
    executorId: 'fixture-material',
  });
  const hook = createReportApplication({
    projectRoot: root,
    packageRoot: path.join(root, 'custom-fixed-package'),
    manifest: { id: 'local-report' },
  }).inspectHook!;
  const inspect = (state: WorkflowRun, target: string) =>
    hook(state, { intent: 'write', targets: [path.resolve(root, target)], toolName: 'Edit' });
  return { runtime, run, ref, inspect };
}

it('allows only the current unapproved report draft and denies editing after approval', async () => {
  const { runtime, run, ref, inspect } = await material();
  expect(await inspect(run, ref)).toMatchObject({ allowed: true });
  await fs.writeFile(path.join(root, ref), '# Updated\n\nNeeds a new approval.\n');
  expect(await inspect(run, ref)).toMatchObject({ allowed: true });
  expect(
    await inspect(run, `.comet/reports/local-report/drafts/${'f'.repeat(64)}.md`),
  ).toMatchObject({
    allowed: false,
  });
  const wait = run.waits[0];
  const approved = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    choice: 'approved',
    decisionId: 'fixture-approved',
  });
  expect(await inspect(approved, ref)).toMatchObject({ allowed: false });
});

it('protects fixed packages, SDK storage, published reports and outside paths', async () => {
  const { run, inspect } = await material();
  for (const target of [
    '.claude/skills/local-report/application.mjs',
    '.comet/creator/packages/fixed/application.mjs',
    '.comet/runtime/applications/local-report/run.json',
    '.comet/current-change.json',
    'node_modules/@rpamis/comet/package.json',
    '.comet/reports/local-report/published/output.md',
    '../outside.md',
  ]) {
    expect(await inspect(run, target)).toMatchObject({ allowed: false });
  }
});

it('denies a draft whose parent is replaced by a junction', async () => {
  const { run, ref, inspect } = await material();
  const drafts = path.dirname(path.join(root, ref));
  const actual = path.join(root, 'moved-drafts');
  await fs.rename(drafts, actual);
  await fs.symlink(actual, drafts, 'junction');
  expect(await inspect(run, ref)).toMatchObject({ allowed: false });
});

it('keeps report and package protection after a terminal decision', async () => {
  const { runtime, run, ref, inspect } = await material();
  const wait = run.waits[0];
  const completed = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    choice: 'rejected',
    decisionId: 'fixture-rejected',
  });
  expect(completed.status).toBe('completed');
  expect(await inspect(completed, ref)).toMatchObject({ allowed: false });
  expect(await inspect(completed, '.claude/skills/local-report/application.mjs')).toMatchObject({
    allowed: false,
  });
  expect(await inspect(completed, 'custom-fixed-package/application.mjs')).toMatchObject({
    allowed: false,
  });
  expect(await inspect(completed, 'unrelated.txt')).toMatchObject({ allowed: true });
});
