import { getCurrentVersion } from '../../../platform/version/version.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as engine from '../../../domains/engine/runtime.js';
import {
  createCreatorRuntime,
  creatorSummary,
  listCreatorRuns,
} from '../../../domains/workflow-creation/index.js';
import {
  compileWorkflowApplication,
  type WorkflowApplicationPlan,
} from '../../../domains/workflow-generation/index.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime.js';
import {
  exportWorkflowApplication,
  installWorkflowApplication,
  type ApplicationInstallPreview,
} from '../../../domains/workflow-application/index.js';

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
      runtimeVersion: getCurrentVersion(),
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    },
    composition: { kind: 'report' },
    modules: {},
    documents: {
      'SKILL.md':
        '---\nname: weekly-report\ndescription: Create a weekly report, review its sources, and publish the approved report.\n---\n\n# Weekly report\n\nUse this application for a weekly source-backed report. Read the supplied title, body and source list, draft the report, and ask the user to approve the current draft. Publish only the approved draft. Rejection keeps the draft; revisions require a new review. Verify report.md and published output before declaring completion.\n',
      'rules/workflow-guard.md':
        '# Weekly report rules\n\nUse only the supplied sources. Keep claims traceable to their source and retain a rejected draft. Report generation may write the draft; publication requires approval of that exact draft. Changed content requires another review.\n',
    },
  },
});
async function analyzed(
  prepare = true,
  installTarget = '.comet/creator/exports/weekly-report',
  host = 'codex',
) {
  const runtime = createCreatorRuntime(root);
  let run = await runtime.start({
    runId: 'creation-one',
    workflow: { id: 'comet-creator', version: '3' },
    input: {
      goal: '每周报告先审后发布',
      installTarget,
      host,
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

it.each(['documents', 'SKILL.md', 'rules/workflow-guard.md'])(
  'rejects analysis without Agent-authored %s',
  async (missing) => {
    const runtime = createCreatorRuntime(root);
    let run = await runtime.start({
      runId: 'missing-documents',
      workflow: { id: 'comet-creator', version: '3' },
      input: { goal: '报告审批', installTarget: 'export', host: 'codex' },
    });
    const action = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'creator-host',
      claimToken: 'author',
      capabilities: ['skill-load', 'handoff'],
    });
    const output = analysis();
    if (missing === 'documents') Reflect.deleteProperty(output.proposal, 'documents');
    else Reflect.deleteProperty(output.proposal.documents, missing);
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'author',
          outcomeId: 'missing',
          status: 'succeeded',
          output,
        },
      }),
    ).rejects.toThrow(/SKILL\.md|rules\/workflow-guard\.md|业务 Rule|documents/);
    expect((await runtime.inspect(run.runId)).outputs.prepare).toBeUndefined();
  },
);

async function choose(run: Awaited<ReturnType<typeof analyzed>>, choice: string) {
  const runtime = createCreatorRuntime(root);
  const wait = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: `${wait.id}-${choice}`,
    choice,
  });
  return (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
}

it('v3 previews and installs both the full export and the managed project application from one approval', async () => {
  let run = await analyzed(true, '.comet/creator/exports/report');
  expect(run.outputs.prepare.value).toMatchObject({
    plan: { manifest: { rule: 'rules/workflow-guard.md' } },
  });
  run = await choose(run, 'approved');
  expect(run.waits.at(-1)?.stepId).toBe('confirm-eval');
  run = await choose(run, 'skip');
  expect(run.waits.at(-1)?.stepId).toBe('confirm-install');
  expect(run.outputs.preview.value).toMatchObject({
    target: '.comet/creator/exports/report',
    distribution: {
      id: 'weekly-report',
      scope: 'project',
      noFilesWritten: true,
      hostSkills: [{ kind: 'entry', operation: 'create', platforms: ['codex'] }],
    },
  });
  expect(
    await fs.stat(path.join(root, '.comet/creator/exports/report')).catch(() => null),
  ).toBeNull();
  expect(
    await fs.stat(path.join(root, '.agents/skills/weekly-report')).catch(() => null),
  ).toBeNull();
  run = await choose(run, 'approved');
  expect(run.status).toBe('completed');
  expect(
    await fs.readFile(path.join(root, '.comet/creator/exports/report/application.json'), 'utf8'),
  ).toContain('weekly-report');
  expect(
    await fs.readFile(path.join(root, '.agents/skills/weekly-report/SKILL.md'), 'utf8'),
  ).toContain('weekly-report');
  expect(run.outputs.install.value).toMatchObject({
    installation: {
      id: 'weekly-report',
      contentHash: (run.outputs.preview.value as { packageHash: string }).packageHash,
    },
  });
  expect((await createCreatorRuntime(root).inspect(run.runId)).status).toBe('completed');
});

it('shows the complete authored documents and binds their contents in the actual plan confirmation', async () => {
  const run = await analyzed();
  const proposed = analysis().proposal.documents;
  expect(
    (run.outputs.prepare.value as unknown as { plan: { documents: unknown } }).plan.documents,
  ).toEqual(proposed);
  expect(run.waits.at(-1)?.proposal).toMatchObject({
    outputs: { prepare: { plan: { documents: proposed } } },
  });
  expect(creatorSummary(run).documents).toMatchObject({
    'SKILL.md': {
      content: proposed['SKILL.md'],
      contentHash: hashRuntimeValue(proposed['SKILL.md']),
    },
    'rules/workflow-guard.md': {
      content: proposed['rules/workflow-guard.md'],
      contentHash: hashRuntimeValue(proposed['rules/workflow-guard.md']),
    },
  });
});

it('requires a new plan approval after the authored business Rule changes', async () => {
  const runtime = createCreatorRuntime(root);
  let run = await analyzed();
  const old = run.waits.at(-1)!;
  run = await choose(run, 'revise');
  const action = run.actions.at(-1)!;
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'creator-host',
    claimToken: 'revised-docs',
    capabilities: ['skill-load', 'handoff'],
  });
  const output = analysis();
  output.proposal.documents['rules/workflow-guard.md'] +=
    'Every report must include a reviewed date.\n';
  await runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'revised-docs',
      outcomeId: 'revised-docs',
      status: 'succeeded',
      output,
    },
  });
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
  const current = run.waits.at(-1)!;
  expect(current.proposalHash).not.toBe(old.proposalHash);
  await expect(
    runtime.resolveWait({
      runId: run.runId,
      waitId: current.id,
      proposalHash: old.proposalHash,
      decisionId: 'stale-document-approval',
      choice: 'approved',
    }),
  ).rejects.toThrow(/STALE/);
  expect(creatorSummary(run).documents).toMatchObject({
    'rules/workflow-guard.md': { content: output.proposal.documents['rules/workflow-guard.md'] },
  });
});

it('allows revise and rejection of a current plan missing authored documents while refusing approval', async () => {
  const capture = vi.spyOn(engine, 'createRuntime');
  createCreatorRuntime(root);
  const handler = capture.mock.calls
    .at(-1)![0]
    .transitionHandlers!.find((item) => item.id === 'creator-decisions')!;
  capture.mockRestore();
  const run = structuredClone(await analyzed());
  const prepared = run.outputs.prepare.value as unknown as { plan: Record<string, unknown> };
  Reflect.deleteProperty(prepared.plan, 'documents');
  const event = {
    kind: 'wait-resolved' as const,
    stepId: 'confirm-plan',
    proposalHash: run.waits.at(-1)!.proposalHash,
    decisionId: 'current-user',
  };
  expect(handler.apply({ run, event: { ...event, choice: 'revise' } })).toEqual({
    state: {},
    next: ['analyze'],
  });
  expect(handler.apply({ run, event: { ...event, choice: 'rejected' } })).toEqual({
    state: {},
    next: ['stop'],
  });
  expect(() => handler.apply({ run, event: { ...event, choice: 'approved' } })).toThrow(
    /documents|SKILL\.md/,
  );
});

it('v3 rejects platform drift before accepting approval and before writing the export', async () => {
  let run = await choose(await analyzed(true, '.comet/creator/exports/report'), 'approved');
  run = await choose(run, 'skip');
  const runtime = createCreatorRuntime(root);
  const wait = run.waits.at(-1)!;
  await fs.mkdir(path.join(root, '.agents/skills/weekly-report'), { recursive: true });
  await fs.writeFile(path.join(root, '.agents/skills/weekly-report/keep.txt'), 'user content');
  await expect(
    runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'current-user',
      choice: 'approved',
    }),
  ).rejects.toThrow(/冲突|存在|变化/);
  expect((await runtime.inspect(run.runId)).waits.at(-1)?.status).toBe('pending');
  expect(
    await fs.stat(path.join(root, '.comet/creator/exports/report')).catch(() => null),
  ).toBeNull();
  expect(await fs.readFile(path.join(root, '.agents/skills/weekly-report/keep.txt'), 'utf8')).toBe(
    'user content',
  );
});

it.each(['revise', 'rejected'])(
  'v3 rejects an overlapping export and honors %s without writing files',
  async (choice) => {
    let run = await choose(await analyzed(true, '.agents/skills/weekly-report'), 'approved');
    run = await choose(run, 'skip');
    expect(run.waits.at(-1)?.stepId).toBe('review-install');
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'preview', status: 'failed' });
    expect(run.outputs.preview.value).toMatchObject({
      noFilesWritten: true,
      reason: expect.stringContaining('重叠'),
    });
    expect(
      await fs.stat(path.join(root, '.agents/skills/weekly-report')).catch(() => null),
    ).toBeNull();
    run = await choose(run, choice);
    if (choice === 'revise')
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'analyze', status: 'pending' });
    else {
      expect(run.status).toBe('completed');
      expect(run.outputs.stop.value).toMatchObject({ stopped: true });
    }
  },
);

it('v3 preserves a user-owned Rule conflict and can retry a corrected read-only preview', async () => {
  let run = await choose(
    await analyzed(true, '.comet/creator/exports/report', 'claude-code'),
    'approved',
  );
  const rule = path.join(root, '.claude/rules/comet-workflow-guard.md');
  await fs.mkdir(path.dirname(rule), { recursive: true });
  await fs.writeFile(rule, 'User rule');
  run = await choose(run, 'skip');
  expect(run.waits.at(-1)?.stepId).toBe('review-install');
  expect(run.outputs.preview.value).toMatchObject({
    noFilesWritten: true,
    reason: expect.stringMatching(/conflict|冲突/),
  });
  expect(await fs.readFile(rule, 'utf8')).toBe('User rule');
  expect(
    await fs.stat(path.join(root, '.comet/creator/exports/report')).catch(() => null),
  ).toBeNull();
  await fs.unlink(rule);
  run = await choose(run, 'retry');
  expect(run.waits.at(-1)?.stepId).toBe('confirm-install');
  expect(run.outputs.preview.value).toMatchObject({
    distribution: {
      hostIntegration: [{ rule: { status: 'available' }, hook: { status: 'available' } }],
    },
  });
  expect(await fs.stat(rule).catch(() => null)).toBeNull();
  expect(
    await fs.stat(path.join(root, '.comet/creator/exports/report')).catch(() => null),
  ).toBeNull();
});

it('v3 rechecks the platform preview after approval before exporting any files', async () => {
  let run = await choose(await analyzed(true, '.comet/creator/exports/report'), 'approved');
  run = await choose(run, 'skip');
  const runtime = createCreatorRuntime(root);
  const wait = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'current-user',
    choice: 'approved',
  });
  await fs.mkdir(path.join(root, '.agents/skills/weekly-report'), { recursive: true });
  await fs.writeFile(path.join(root, '.agents/skills/weekly-report/keep.txt'), 'user content');
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
  expect(run.actions.at(-1)).toMatchObject({ stepId: 'install', status: 'unknown' });
  expect(
    await fs.stat(path.join(root, '.comet/creator/exports/report')).catch(() => null),
  ).toBeNull();
});

it('v3 reconciles a lost install result only when both the export and actual managed installation match', async () => {
  let run = await choose(await analyzed(true, '.comet/creator/exports/report'), 'approved');
  run = await choose(run, 'skip');
  const runtime = createCreatorRuntime(root);
  const wait = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'approved-install',
    choice: 'approved',
  });
  run = await runtime.next({ runId: run.runId });
  const action = run.actions.at(-1)!;
  expect(action.stepId).toBe('install');
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'creator-local',
    claimToken: 'actual-install',
  });
  const preview = run.outputs.preview.value as unknown as {
    target: string;
    packageHash: string;
    distribution: ApplicationInstallPreview;
  };
  const file = (run.outputs.compile.value as { file: string }).file;
  await exportWorkflowApplication({
    file,
    projectRoot: root,
    destination: path.join(root, preview.target),
  });
  await runtime.markUnknown({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: 'lost after export',
  });
  const outcome = {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: 'actual-install',
    outcomeId: 'actual-result',
    status: 'succeeded' as const,
    output: {
      target: preview.target,
      contentHash: preview.packageHash,
      installation: { id: 'weekly-report' },
      recovered: true,
    },
  };
  await expect(
    createCreatorRuntime(root).recordOutcome({ runId: run.runId, outcome }),
  ).rejects.toThrow(/恢复|RECOVERY|结果|回报/);
  expect((await runtime.inspect(run.runId)).actions.at(-1)?.status).toBe('unknown');
  const installation = await installWorkflowApplication({
    file,
    projectRoot: root,
    scope: 'project',
    host: 'codex',
    confirmationHash: preview.distribution.confirmationHash,
  });
  await createCreatorRuntime(root).recordOutcome({
    runId: run.runId,
    outcome: {
      ...outcome,
      outcomeId: 'actual-complete-result',
      output: { ...outcome.output, installation },
    },
  });
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
  expect(run.status).toBe('completed');
  expect(run.actions.filter((entry) => entry.stepId === 'install')).toHaveLength(1);
  expect(run.actions.at(-1)?.attempt).toBe(1);
});
it('cold-resumes the same plan wait, compiles only after a current decision and previews without installing', async () => {
  let run = await analyzed();
  expect(
    (run.outputs.prepare.value as unknown as { plan: { manifest: { rule?: string } } }).plan
      .manifest.rule,
  ).toBe('rules/workflow-guard.md');
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
  expect(run.waits.at(-1)?.stepId).toBe('confirm-eval');
  run = await choose(run, 'skip');
  expect(run.waits.at(-1)?.stepId).toBe('confirm-install');
  expect(
    await fs.stat(path.join(root, '.agents/skills/weekly-report')).catch(() => null),
  ).toBeNull();
  expect(run.outputs.preview.value).toMatchObject({
    target: '.comet/creator/exports/weekly-report',
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
    await fs.readFile(
      path.join(root, '.comet/creator/exports/weekly-report/application.json'),
      'utf8',
    ),
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
  run = await choose(run, 'skip');
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
      output: { ...analysis(), installTarget: '.comet/creator/exports/new-target' },
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
  expect(run.outputs.prepare.value).toMatchObject({
    installTarget: '.comet/creator/exports/new-target',
  });
});

it('blocks hosts without required capabilities before analysis and rejects forged preparation', async () => {
  const runtime = createCreatorRuntime(root);
  let run = await runtime.start({
    runId: 'missing-host',
    workflow: { id: 'comet-creator', version: '3' },
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
  expect(run.waits.at(-1)?.stepId).toBe('confirm-eval');
  run = await choose(run, 'skip');
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
      workflow: { id: 'comet-creator', version: '3' },
      input: { goal: '报告', host: 'other-agent', installTarget: '.agents/skills/report' },
    }),
  ).toThrow(/仅支持/);
  expect(() =>
    runtime.start({
      runId: 'bad-target',
      workflow: { id: 'comet-creator', version: '3' },
      input: { goal: '报告', host: 'codex', installTarget: '../outside' },
    }),
  ).toThrow(/相对目录/);
});

it.each(['1', '2'])(
  'rejects unsupported Creator definition %s before creating a Run',
  async (version) => {
    const runtime = createCreatorRuntime(root);
    expect(() =>
      runtime.start({
        runId: 'unsupported',
        workflow: { id: 'comet-creator', version },
        input: { goal: '报告', host: 'codex', installTarget: 'export' },
      }),
    ).toThrow(/只支持新创作定义/);
    expect(await fs.stat(path.join(root, '.comet/runtime/creator')).catch(() => null)).toBeNull();
  },
);
