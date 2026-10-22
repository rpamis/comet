import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getCurrentVersion } from '../../../platform/version/version.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime.js';
import {
  prepareWorkflowApplicationPlan,
  compileWorkflowApplication,
  type WorkflowApplicationProposal,
} from '../../../domains/workflow-generation/index.js';
import {
  previewWorkflowApplicationInstall,
  installWorkflowApplication,
  inspectApplicationSkill,
} from '../../../domains/workflow-application/index.js';
import {
  collectDashboardApplicationRunPage,
  collectDashboardApplicationRunDetail,
} from '../../../domains/dashboard/application-collector.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-skill-invocation-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

export function invocationProposal(): WorkflowApplicationProposal {
  return {
    schema: 'comet.workflow.application.plan.v1',
    manifest: {
      schema: 'comet.workflow.application.v1',
      id: 'daily-editor',
      version: '1',
      base: 'standalone',
      runtimeVersion: getCurrentVersion(),
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    },
    documents: {
      'SKILL.md':
        '---\nname: daily-editor\ndescription: 整理本地文稿并请用户确认。\n---\n\n# 整理文稿\n读取 source.txt，写出 draft.md；等待用户确认后整理交付结果。\n',
      'rules/workflow-guard.md': '# 业务规则\n如实整理来源；用户确认在 Agent 对话中完成。\n',
    },
    presentation: {
      title: '日常文稿整理',
      steps: [
        { workflowId: 'daily-editor', stepId: 'draft', title: '整理草稿', phase: '整理' },
        { workflowId: 'daily-editor', stepId: 'review', title: '确认文稿', phase: '确认' },
        { workflowId: 'daily-editor', stepId: 'publish', title: '整理交付', phase: '交付' },
      ],
    },
    composition: {
      kind: 'standalone',
      executorIds: ['editor'],
      validatorRefs: [],
      transitionHandlers: [],
      workflows: [
        {
          id: 'daily-editor',
          version: '1',
          entry: 'draft',
          steps: {
            draft: {
              type: 'call_tool',
              ref: 'editor.work',
              outputSchema: {
                type: 'object',
                required: ['summary'],
                properties: { summary: { type: 'string', minLength: 1 } },
                additionalProperties: false,
              },
            },
            review: {
              type: 'ask_user',
              proposalFrom: ['draft'],
              choices: ['approved', 'rejected'],
            },
            publish: { type: 'call_tool', ref: 'editor.work' },
          },
          transitions: [
            { from: 'draft', to: 'review', on: 'succeeded' },
            { from: 'review', to: 'publish', on: 'approved' },
          ],
        },
      ],
    },
    modules: {
      'bindings.mjs': `import {createRuntimeExecutor,defineRuntimeHandler} from '@rpamis/comet/runtime';
export function createBindings(){return {executors:[createRuntimeExecutor({id:'editor',handlers:{'editor.work':defineRuntimeHandler({type:'call_tool',parseInput:value=>value,execute:async(_input,{context})=>({status:'succeeded',output:{summary:context?.environment?.COMET_TEST_SKILL_PORT ?? 'local work'}})})}})],validators:[]};}`,
    },
  };
}

async function install(value = invocationProposal(), suffix = '') {
  const plan = await prepareWorkflowApplicationPlan({
    proposal: value,
    projectRoot: root,
    packageRoot: path.join(root, 'preview' + suffix),
  });
  const compiled = await compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    projectRoot: root,
    packageRoot: path.join(root, 'compiled' + suffix),
  });
  const options = {
    file: compiled.file,
    projectRoot: root,
    scope: 'project' as const,
    platforms: ['codex'],
    userRoot: path.join(root, 'user'),
    ...(suffix ? { upgrade: true } : {}),
  };
  const preview = await previewWorkflowApplicationInstall(options);
  return installWorkflowApplication({ ...options, confirmationHash: preview.confirmationHash });
}

async function invoke(file: string, args: string[], json?: unknown, status = 0) {
  if (json !== undefined) {
    const input = path.join(root, 'request-input.json');
    await fs.writeFile(input, JSON.stringify(json));
    args = [...args, args[0] === 'record-outcome' ? '--result-file' : '--input-file', input];
  }
  const result = spawnSync(
    process.execPath,
    [path.join(path.dirname(file), 'scripts/comet-run.mjs'), ...args],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        COMET_TEST_SKILL_PORT: 'isolated-host-port',
        COMET_TEST_SKILL_CREDENTIAL: 'invocation-only-test-secret',
      },
    },
  );
  expect(result.status, result.stderr || result.stdout).toBe(status);
  return JSON.parse(result.stdout);
}

async function realSkillProposal(executors = ['local-skill'], authorized = true) {
  const value = invocationProposal();
  const skillRoot = path.join(root, 'writer');
  await fs.mkdir(skillRoot);
  await fs.writeFile(
    path.join(skillRoot, 'SKILL.md'),
    '# Writer\nRead text and return a summary. No writes or approvals.\n',
  );
  const skill = await inspectApplicationSkill(skillRoot);
  const outputSchema = {
    type: 'object',
    required: ['summary'],
    properties: { summary: { type: 'string' } },
    additionalProperties: false,
  };
  value.manifest.skills = [
    {
      id: 'writer',
      root: skillRoot,
      contentHash: skill.contentHash,
      adapter: {
        kind: 'action',
        inputSchema: { type: 'object' },
        outputSchema,
        scope: ['report'],
        requiredCapabilities: [],
        interaction: 'none',
        sideEffect: 'read',
        controlsApproval: false,
        completion: 'self-report',
        failure: 'repair',
        recovery: 'manual',
        review: {
          status: 'accepted',
          reviewedBy: 'fixture-review',
          contentHash: skill.contentHash,
          capabilities: [{ id: 'summary', file: 'SKILL.md', excerpt: 'return a summary' }],
          effects: [{ file: 'SKILL.md', excerpt: 'No writes or approvals.' }],
        },
      },
    },
  ];
  value.manifest.bindings = [
    {
      workflowId: 'daily-editor',
      stepId: 'draft',
      skillId: 'writer',
      capability: 'summary',
      usage: 'action',
    },
  ];
  delete value.presentation;
  value.composition = {
    kind: 'standalone',
    executorIds: executors,
    validatorRefs: [],
    transitionHandlers: [],
    workflows: [
      {
        id: 'daily-editor',
        version: '1',
        entry: 'draft',
        steps: { draft: { type: 'invoke_skill', ref: 'writer', outputSchema } },
      },
    ],
  };
  value.modules = {
    'fixture.json': JSON.stringify({ executors, authorized }),
    'bindings.mjs': `import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));
export function createBindings(context) {
  return {
    executors: fixture.executors.map(id => context.createSkillExecutor({
      id, capabilities: [], authorize: async () => fixture.authorized,
      invokeSkill: async () => { throw new Error('The Agent must execute the Skill'); },
    })),
    validators: [],
  };
}`,
  };
  return value;
}

it.each(['recommended', 'legacy', 'explicit'])(
  'claims an installed real Skill using its registered executor (%s)',
  async (mode) => {
    const explicit = mode === 'explicit';
    const installed = await install(
      await realSkillProposal(explicit ? ['first-host', 'selected-host'] : ['local-skill']),
    );
    const started = await invoke(installed.file, ['start'], {});
    const action = started.run.current.actions[0];
    const command = started.commands.actions[0].claim.slice(2);
    if (mode === 'legacy') command.splice(command.indexOf('--executor-id'), 2);
    if (explicit) {
      expect((await invoke(installed.file, command, undefined, 1)).error.code).toBe(
        'INVALID_REQUEST',
      );
      const index = command.indexOf('--executor-id');
      if (index >= 0) command.splice(index, 2);
      command.push('--executor-id', 'selected-host');
    }
    const claimed = await invoke(installed.file, command);
    expect(claimed.run.current.actions[0]).toMatchObject({ status: 'running' });
    const { readWorkflowApplicationRun } =
      await import('../../../domains/workflow-application/index.js');
    expect(
      (await readWorkflowApplicationRun(root, 'daily-editor', started.run.runId))?.actions[0].claim
        ?.executorId,
    ).toBe(explicit ? 'selected-host' : 'local-skill');
    const resumed = await invoke(installed.file, ['resume', '--run-id', started.run.runId]);
    expect(resumed.receipts.actions).toEqual(claimed.receipts.actions);
    const finished = await invoke(
      installed.file,
      ['record-outcome', '--receipt', resumed.receipts.actions[0]],
      { status: 'succeeded', output: { summary: 'Actual Agent result' } },
    );
    expect(finished.run.status).toBe('completed');
    expect(action.type).toBe('invoke_skill');
  },
);

it('keeps executor selection and authorization checks on installed Skill claims', async () => {
  const installed = await install(await realSkillProposal(['local-skill'], false));
  const started = await invoke(installed.file, ['start'], {});
  const command = [
    'claim',
    '--run-id',
    started.run.runId,
    '--action-id',
    started.run.current.actions[0].id,
  ];
  expect(
    (await invoke(installed.file, [...command, '--executor-id', 'unregistered'], undefined, 1))
      .error.code,
  ).toBe('EXECUTOR_UNAVAILABLE');
  const denied = await invoke(
    installed.file,
    [...command, '--executor-id', 'local-skill'],
    undefined,
    1,
  );
  expect(denied.error.code).toBe('COMMAND_REJECTED');
  expect(
    (await invoke(installed.file, ['inspect', '--run-id', started.run.runId])).run.current
      .actions[0].status,
  ).toBe('pending');
});

it('runs the installed Skill entry through work, conversation approval and cold recovery without Creator', async () => {
  const installed = await install();
  const started = await invoke(installed.file, ['start'], { topic: '文稿' });
  const runId = started.run.runId;
  expect(started.run.current.actions[0]).toMatchObject({ stepId: 'draft', status: 'pending' });
  const claimed = await invoke(installed.file, [
    'claim',
    '--run-id',
    runId,
    '--action-id',
    started.run.current.actions[0].id,
  ]);
  expect(claimed.run.current.actions[0].status).toBe('running');
  const list = await collectDashboardApplicationRunPage(root);
  expect(list.items).toHaveLength(1);
  const running = await collectDashboardApplicationRunDetail(root, list.items[0].locator);
  expect(running).toMatchObject({ sourceCreators: [], definition: { status: 'available' } });
  expect(running?.records.find((r) => r.stepId === 'draft')?.status).toBe('running');
  const waiting = await invoke(
    installed.file,
    ['record-outcome', '--receipt', claimed.receipts.actions[0]],
    { status: 'succeeded', output: { summary: '已整理实际文稿' } },
  );
  expect(waiting.run.current.waits[0]).toMatchObject({ stepId: 'review', status: 'pending' });
  const resumed = await invoke(installed.file, ['inspect', '--run-id', runId]);
  expect(resumed.run.runId).toBe(runId);
  expect(resumed.run.current.actions).toHaveLength(0);
  const approved = await invoke(installed.file, [
    'resolve-wait',
    '--receipt',
    resumed.receipts.waits[0],
    '--choice',
    'approved',
    '--decision-id',
    'test-user-message',
  ]);
  expect(approved.run.current.actions[0].stepId).toBe('publish');
  const publishing = await invoke(installed.file, [
    'claim',
    '--run-id',
    runId,
    '--action-id',
    approved.run.current.actions[0].id,
  ]);
  const finished = await invoke(
    installed.file,
    ['record-outcome', '--receipt', publishing.receipts.actions[0]],
    { status: 'succeeded', output: { summary: '已交付' } },
  );
  expect(finished.run.status).toBe('completed');
  expect((await collectDashboardApplicationRunPage(root)).items).toHaveLength(1);
  const second = await invoke(installed.file, ['start'], { topic: '另一次任务' });
  expect(second.run.runId).not.toBe(runId);
});

it('keeps rejected results and duplicate claims on the original attempt and accepts a repeated real result once', async () => {
  const installed = await install();
  const started = await invoke(installed.file, ['start'], {});
  const args = [
    'claim',
    '--run-id',
    started.run.runId,
    '--action-id',
    started.run.current.actions[0].id,
  ];
  const claimed = await invoke(installed.file, args);
  expect((await invoke(installed.file, args, undefined, 1)).error.code).toBe('INVALID_REQUEST');
  const receipt = claimed.receipts.actions[0];
  const invalid = await invoke(
    installed.file,
    ['record-outcome', '--receipt', receipt],
    { status: 'succeeded', output: {} },
    1,
  );
  expect(invalid.error.code).toBe('OUTPUT_INVALID');
  const unchanged = await invoke(installed.file, ['inspect', '--run-id', started.run.runId]);
  expect(unchanged.run.current.actions[0]).toMatchObject({ status: 'running', attempt: 1 });
  const forged = JSON.parse(Buffer.from(receipt, 'base64url').toString('utf8'));
  forged.inputHash = '0'.repeat(64);
  const stale = await invoke(
    installed.file,
    ['record-outcome', '--receipt', Buffer.from(JSON.stringify(forged)).toString('base64url')],
    { status: 'succeeded', output: { summary: '实际结果' } },
    1,
  );
  expect(stale.error.code).toBe('STALE_ACTION');
  const output = { status: 'succeeded', output: { summary: '实际结果' } };
  const waiting = await invoke(installed.file, ['record-outcome', '--receipt', receipt], output);
  const repeated = await invoke(installed.file, ['record-outcome', '--receipt', receipt], output);
  expect(repeated.run.revision).toBe(waiting.run.revision);
  expect(repeated.run.history.actions).toBe(1);
  expect(repeated.run.current.waits).toHaveLength(1);
});

it('preserves both original claims when parallel completions change the Run revision', async () => {
  const value = invocationProposal();
  if (value.composition.kind !== 'standalone') throw new Error('Expected standalone fixture');
  const workflow = value.composition.workflows[0];
  workflow.entry = ['draft', 'sources'];
  workflow.steps.sources = { type: 'call_tool', ref: 'editor.work' };
  workflow.steps.review = {
    type: 'ask_user',
    proposalFrom: ['draft', 'sources'],
    choices: ['approved'],
    join: ['draft', 'sources'],
  };
  workflow.transitions!.push({ from: 'sources', to: 'review', on: 'succeeded' });
  const installed = await install(value);
  const started = await invoke(installed.file, ['start'], {});
  const claims = [];
  for (const action of started.run.current.actions) {
    const current = await invoke(installed.file, [
      'claim',
      '--run-id',
      started.run.runId,
      '--action-id',
      action.id,
    ]);
    claims.push(
      current.receipts.actions.find(
        (receipt: string) =>
          JSON.parse(Buffer.from(receipt, 'base64url').toString('utf8')).actionId === action.id,
      ),
    );
  }
  await invoke(installed.file, ['record-outcome', '--receipt', claims[0]], {
    status: 'succeeded',
    output: { summary: '正文' },
  });
  const finished = await invoke(installed.file, ['record-outcome', '--receipt', claims[1]], {
    status: 'succeeded',
    output: { summary: '来源' },
  });
  expect(finished.run.current.waits).toHaveLength(1);
  expect(finished.run.current.actions).toHaveLength(0);
});

it('collects actual declared artifact hashes for a host result without asking the Agent to construct evidence', async () => {
  const proposal = invocationProposal();
  proposal.manifest.artifactContracts = [
    {
      workflowId: 'daily-editor',
      stepId: 'draft',
      artifacts: [{ ref: 'draft.md', nonEmpty: true, requiredHeadings: ['草稿'] }],
    },
    {
      workflowId: 'daily-editor',
      stepId: 'publish',
      artifacts: [],
      noArtifactsReason: '此样例只回报交付摘要。',
    },
  ];
  const installed = await install(proposal);
  const started = await invoke(installed.file, ['start'], {});
  const claimed = await invoke(installed.file, [
    'claim',
    '--run-id',
    started.run.runId,
    '--action-id',
    started.run.current.actions[0].id,
  ]);
  await fs.writeFile(path.join(root, 'draft.md'), '# 草稿\n\n实际文稿。\n');
  const result = await invoke(
    installed.file,
    ['record-outcome', '--receipt', claimed.receipts.actions[0]],
    { status: 'succeeded', output: { summary: '已整理' } },
  );
  expect(result.run.current.waits[0].stepId).toBe('review');
  const listed = await collectDashboardApplicationRunPage(root);
  const detail = await collectDashboardApplicationRunDetail(root, listed.items[0].locator);
  expect(detail?.artifacts.find((item) => item.uri === 'draft.md')?.sha256).toMatch(
    /^[a-f0-9]{64}$/,
  );
});

it('finds the sole unfinished task in a new Agent session and asks instead of guessing between concurrent Runs', async () => {
  const installed = await install();
  const first = await invoke(installed.file, ['start'], { topic: '第一项工作' });
  expect((await invoke(installed.file, ['inspect'])).run.runId).toBe(first.run.runId);
  const second = await invoke(installed.file, ['start'], { topic: '第二项工作' });
  const ambiguous = await invoke(installed.file, ['inspect'], undefined, 1);
  expect(ambiguous.error.message).toContain(first.run.runId);
  expect(ambiguous.error.message).toContain(second.run.runId);
  expect((await collectDashboardApplicationRunPage(root)).items).toHaveLength(2);
});

it('selects the actual parent entry and inspects its original child Run through the same installed entry', async () => {
  const value = invocationProposal();
  value.composition = { kind: 'report' };
  value.modules = {};
  delete value.presentation;
  const installed = await install(value);
  const started = await invoke(installed.file, ['start'], { title: '子流程样例', sources: [] });
  expect(started.run.workflow.id).toBe('report-publishing');
  const advanced = await invoke(installed.file, ['next', '--run-id', started.run.runId]);
  const childId = advanced.run.current.children[0].runId;
  const child = await invoke(installed.file, ['inspect', '--run-id', childId]);
  expect(child.run.workflow.id).toBe('report-drafting');
  expect(child.run.current.actions.length).toBeGreaterThan(0);
});

it('uses the original pinned application when a new installed Skill resumes a previously claimed Run', async () => {
  const original = await install();
  const started = await invoke(original.file, ['start'], {});
  const claimed = await invoke(original.file, [
    'claim',
    '--run-id',
    started.run.runId,
    '--action-id',
    started.run.current.actions[0].id,
  ]);
  const next = invocationProposal();
  next.manifest.version = '2';
  if (next.composition.kind !== 'standalone') throw new Error('Expected standalone');
  next.composition.workflows[0].steps.draft.outputSchema = {
    type: 'object',
    required: ['newValue'],
    properties: { newValue: { type: 'string' } },
    additionalProperties: false,
  };
  const upgraded = await install(next, '-v2');
  const resumed = await invoke(upgraded.file, ['inspect', '--run-id', started.run.runId]);
  expect(resumed.application.version).toBe('1');
  expect(resumed.run.current.actions[0]).toMatchObject({ status: 'running', attempt: 1 });
  const waiting = await invoke(
    upgraded.file,
    ['record-outcome', '--receipt', claimed.receipts.actions[0]],
    { status: 'succeeded', output: { summary: '原版本的真实结果' } },
  );
  expect(waiting.application.version).toBe('1');
  expect(waiting.run.current.waits[0].stepId).toBe('review');
  const fresh = await invoke(upgraded.file, ['start'], {});
  expect(fresh.application.version).toBe('2');
  expect(fresh.run.current.actions[0].outputSchema.required).toEqual(['newValue']);
});

it('passes the host environment to registered execution without storing credentials in the Run', async () => {
  const installed = await install();
  const started = await invoke(installed.file, ['start'], {});
  const waiting = await invoke(installed.file, [
    'execute',
    '--run-id',
    started.run.runId,
    '--action-id',
    started.run.current.actions[0].id,
    '--executor-id',
    'editor',
  ]);
  const list = await collectDashboardApplicationRunPage(root);
  const detail = await collectDashboardApplicationRunDetail(root, list.items[0].locator);
  expect(detail?.records.find((record) => record.stepId === 'draft')?.data.outcome.output).toEqual({
    summary: 'isolated-host-port',
  });
  const { readWorkflowApplicationRun } =
    await import('../../../domains/workflow-application/index.js');
  expect(
    JSON.stringify(await readWorkflowApplicationRun(root, 'daily-editor', waiting.run.runId)),
  ).not.toContain('invocation-only-test-secret');
});

it('resumes the original claim and Hook routing after another Skill became current', async () => {
  const original = await install();
  const started = await invoke(original.file, ['start'], {});
  const claimed = await invoke(original.file, [
    'claim',
    '--run-id',
    started.run.runId,
    '--action-id',
    started.run.current.actions[0].id,
  ]);
  const other = invocationProposal();
  other.manifest.id = 'other-editor';
  other.documents!['SKILL.md'] = other.documents!['SKILL.md'].replace(
    'name: daily-editor',
    'name: other-editor',
  );
  const installedOther = await install(other, '-other');
  const otherRun = await invoke(installedOther.file, ['start'], {});
  await invoke(original.file, ['inspect', '--run-id', started.run.runId]);
  expect(
    JSON.parse(await fs.readFile(path.join(root, '.comet/current-change.json'), 'utf8')).change,
  ).toBe(otherRun.run.runId);
  const resumed = await invoke(original.file, ['resume', '--run-id', started.run.runId]);
  expect(resumed.receipts.actions).toEqual(claimed.receipts.actions);
  expect(resumed.run.revision).toBe(claimed.run.revision);
  expect(
    JSON.parse(await fs.readFile(path.join(root, '.comet/current-change.json'), 'utf8')),
  ).toMatchObject({ applicationId: 'daily-editor', change: started.run.runId });
});

it('starts stateful applications with the declared initial state instead of inventing domain defaults', async () => {
  const value = invocationProposal();
  if (value.composition.kind !== 'standalone') throw new Error('Expected standalone fixture');
  value.composition.workflows[0].stateSchema = {
    type: 'object',
    required: ['counter'],
    properties: { counter: { type: 'integer' } },
    additionalProperties: false,
  };
  const installed = await install(value);
  const stateFile = path.join(root, 'initial.json');
  await fs.writeFile(stateFile, JSON.stringify({ counter: 7 }));
  const started = await invoke(installed.file, ['start', '--initial-state-file', stateFile], {});
  const { readWorkflowApplicationRun } =
    await import('../../../domains/workflow-application/index.js');
  expect(
    (await readWorkflowApplicationRun(root, 'daily-editor', started.run.runId))?.state,
  ).toEqual({ counter: 7 });
});
