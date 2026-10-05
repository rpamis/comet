import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  hashRuntimeValue,
  type WorkflowRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { createReportApplication } from '../../../domains/workflow-application/index.js';

describe('standalone report application', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-report-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const input = { title: '季度报告', body: '本季度已完成三个项目。', sources: ['本地项目记录'] };
  async function capture(name: string, run: WorkflowRun, files: Record<string, unknown>) {
    const directory = process.env.COMET_REPORT_EVIDENCE_DIR;
    if (!directory) return;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, `${name}.json`),
      JSON.stringify({ run, files }, null, 2),
    );
  }
  function application() {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const reopen = () =>
      createRuntime({
        ...createReportApplication({ projectRoot: root, manifest: { id: 'local-report' } }),
        store,
      });
    return { store, reopen, runtime: reopen() };
  }
  async function generate(runtime: WorkflowRuntime, runId = 'quarterly-report') {
    let run = await runtime.start({
      runId,
      workflow: { id: 'report-publishing', version: '1' },
      input,
    });
    run = await runtime.next({ runId });
    const childId = run.children[0].runId;
    await runtime.runUntilBlocked({ runId: childId, executorId: 'report-local' });
    return runtime.next({ runId });
  }
  function artifact(run: WorkflowRun) {
    const proposal = run.waits.at(-1)!.proposal as {
      outputs: {
        generate?: { compose: { ref: string; contentHash: string; markdown: string } };
        revise?: { ref: string; contentHash: string; markdown: string };
      };
    };
    return proposal.outputs.revise ?? proposal.outputs.generate!.compose;
  }
  async function decide(runtime: WorkflowRuntime, run: WorkflowRun, choice: string) {
    const wait = run.waits.at(-1)!;
    return runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: `${wait.id}-${choice}`,
      choice,
    });
  }

  it('generates an actual report through a joined child workflow and waits before publishing', async () => {
    const runtime = createRuntime({
      ...createReportApplication({ projectRoot: root, manifest: { id: 'local-report' } }),
      store: createMemoryRuntimeStore<WorkflowRun>(),
    });
    let run = await runtime.start({
      runId: 'quarterly-report',
      workflow: { id: 'report-publishing', version: '1' },
      input,
    });
    run = await runtime.next({ runId: run.runId });
    const child = run.children[0];
    let childRun = await runtime.inspect(child.runId);
    expect(childRun.actions.map(({ stepId }) => stepId)).toEqual(['draft', 'sources']);
    for (const stepId of ['sources', 'draft', 'compose']) {
      const action = childRun.actions.find((action) => action.stepId === stepId)!;
      childRun = await runtime.execute({
        runId: childRun.runId,
        actionId: action.id,
        executorId: 'report-local',
      });
      if (stepId === 'sources') expect(childRun.actions).toHaveLength(2);
    }
    run = await runtime.next({ runId: run.runId });
    expect(run.status).toBe('waiting');
    expect(run.waits[0].choices).toEqual(['approved', 'rejected', 'revise']);
    const report = artifact(run);
    expect(await fs.readFile(path.join(root, report.ref), 'utf8')).toBe(report.markdown);
    expect(report.markdown).toContain('季度报告');
    expect(run.actions.some(({ stepId }) => stepId === 'publish')).toBe(false);
    await expect(
      fs.access(path.join(root, '.comet/reports/local-report/published')),
    ).rejects.toThrow();
  });

  it('rejects through its declared branch and preserves the unpublished draft', async () => {
    const { runtime } = application();
    let run = await generate(runtime);
    const draft = artifact(run);
    run = await decide(runtime, run, 'rejected');
    expect(run.actions.at(-1)!.stepId).toBe('rejected');
    const progress = await runtime.runUntilBlocked({
      runId: run.runId,
      executorId: 'report-local',
    });
    expect(progress.run.status).toBe('completed');
    expect(progress.run.outputs.rejected.value).toEqual({ status: 'rejected' });
    expect(await fs.readFile(path.join(root, draft.ref), 'utf8')).toBe(draft.markdown);
    await expect(
      fs.access(path.join(root, '.comet/reports/local-report/published')),
    ).rejects.toThrow();
  });

  it('separates same-named reports from different applications in the same project', async () => {
    const runtimeFor = (id: string) =>
      createRuntime({
        ...createReportApplication({ projectRoot: root, manifest: { id } }),
        store: createMemoryRuntimeStore<WorkflowRun>(),
      });
    const first = await generate(runtimeFor('first-report'));
    const second = await generate(runtimeFor('second-report'));
    expect(artifact(first).ref).not.toBe(artifact(second).ref);
    expect(await fs.readFile(path.join(root, artifact(second).ref), 'utf8')).toContain(input.body);
  });

  it('requires fresh approval of edited bytes and resumes the same Run with a fresh application', async () => {
    const { runtime, reopen } = application();
    let run = await generate(runtime);
    const original = artifact(run);
    const markdown = '# 季度报告（修订）\n\n本季度实际完成两个项目。\n';
    await fs.writeFile(path.join(root, original.ref), markdown);
    await expect(decide(runtime, run, 'approved')).rejects.toThrow('报告已变化');
    run = await decide(reopen(), run, 'revise');
    let progress = await reopen().runUntilBlocked({ runId: run.runId, executorId: 'report-local' });
    run = progress.run;
    expect(run.state).toEqual({ revisions: 1 });
    expect(artifact(run).markdown).toBe(markdown);
    expect(artifact(run).contentHash).not.toBe(original.contentHash);
    await expect(
      fs.access(path.join(root, '.comet/reports/local-report/published')),
    ).rejects.toThrow();
    const oldWait = run.waits[0];
    await expect(
      reopen().resolveWait({
        runId: run.runId,
        waitId: oldWait.id,
        proposalHash: oldWait.proposalHash,
        decisionId: 'old-approval',
        choice: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'DECISION_CONFLICT' });
    run = await decide(reopen(), run, 'approved');
    progress = await reopen().runUntilBlocked({ runId: run.runId, executorId: 'report-local' });
    expect(progress.reason).toBe('completed');
    const published = progress.run.outputs.publish.value as { ref: string };
    expect(await fs.readFile(path.join(root, published.ref), 'utf8')).toBe(markdown);
  });

  it('refuses an arbitrary revised approval proposal, then uses the actual draft in its revision path', async () => {
    const { runtime } = application();
    let run = await generate(runtime);
    const wait = run.waits.at(-1)!;
    run = await runtime.reviseWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      proposal: { text: 'approved without the report' },
    });
    await expect(decide(runtime, run, 'approved')).rejects.toMatchObject({
      code: 'STALE_PROPOSAL',
    });
    run = await decide(runtime, run, 'revise');
    run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'report-local' })).run;
    expect(artifact(run).markdown).toContain(input.body);
    expect(run.waits.at(-1)!.stepId).toBe('approve-revision');
  });

  it('recovers drift after approval through the revision command without publishing stale content', async () => {
    const { runtime } = application();
    let run = await generate(runtime);
    const draft = artifact(run);
    run = await decide(runtime, run, 'approved');
    const publish = run.actions.at(-1)!;
    await fs.writeFile(path.join(root, draft.ref), '# Changed\n\n新的正文。\n');
    await expect(
      runtime.execute({ runId: run.runId, actionId: publish.id, executorId: 'report-local' }),
    ).rejects.toThrow('报告已变化');
    expect((await runtime.inspect(run.runId)).actions.at(-1)!.status).toBe('pending');
    await capture('approval-drift', await runtime.inspect(run.runId), {
      draft: await fs.readFile(path.join(root, draft.ref), 'utf8'),
      approvedArtifact: draft,
    });
    run = await runtime.dispatchCommand({
      runId: run.runId,
      expectedRevision: run.revision,
      commandId: 'repair-drift',
      name: 'revise',
      input: null,
    });
    expect(run.actions.find(({ id }) => id === publish.id)!.status).toBe('cancelled');
    run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'report-local' })).run;
    expect(run.waits.at(-1)!.status).toBe('pending');
    expect(artifact(run).markdown).toContain('新的正文');
    await expect(
      fs.access(path.join(root, '.comet/reports/local-report/published')),
    ).rejects.toThrow();
  });

  it('bounds revisions and keeps the draft when the declared limit branch finishes', async () => {
    const { runtime } = application();
    let run = await generate(runtime);
    for (let attempt = 0; attempt < 3; attempt++) {
      run = await decide(runtime, run, 'revise');
      run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'report-local' })).run;
    }
    expect(run.state).toEqual({ revisions: 2 });
    expect(run.outputs.limit.value).toEqual({ status: 'revision-limit', maxRevisions: 2 });
    expect(run.status).toBe('completed');
    expect(run.actions.filter(({ stepId }) => stepId === 'revise')).toHaveLength(2);
    await expect(
      runtime.dispatchCommand({
        runId: run.runId,
        expectedRevision: run.revision,
        commandId: 'bypass-limit',
        name: 'revise',
        input: null,
      }),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(root, '.comet/reports/local-report/published')),
    ).rejects.toThrow();
  });

  it('rejects a fabricated publication result and leaves the action and draft inspectable', async () => {
    const { runtime } = application();
    let run = await generate(runtime);
    run = await decide(runtime, run, 'approved');
    const action = run.actions.at(-1)!;
    run = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'report-local',
      claimToken: 'manual-publish',
    });
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'manual-publish',
          outcomeId: 'fabricated',
          status: 'succeeded',
          output: 'done',
        },
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    run = await runtime.inspect(run.runId);
    expect(run.actions.at(-1)!.status).toBe('running');
    expect(run.actions.at(-1)!.rejectedOutcomes).toHaveLength(1);
    await expect(
      fs.access(path.join(root, '.comet/reports/local-report/published')),
    ).rejects.toThrow();
  });

  it('rejects a real report artifact owned by another Run instead of accepting the wrong candidate', async () => {
    const { runtime } = application();
    const first = await generate(runtime, 'first-candidate');
    const wrongCandidate = artifact(first);
    let run = await runtime.start({
      runId: 'second-candidate',
      workflow: { id: 'report-publishing', version: '1' },
      input,
    });
    run = await runtime.next({ runId: run.runId });
    const childId = run.children[0].runId;
    let child = await runtime.inspect(childId);
    for (const stepId of ['draft', 'sources']) {
      child = await runtime.execute({
        runId: childId,
        actionId: child.actions.find((action) => action.stepId === stepId)!.id,
        executorId: 'report-local',
      });
    }
    const action = child.actions.at(-1)!;
    child = await runtime.claim({
      runId: childId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'report-local',
      claimToken: 'wrong-candidate',
    });
    await expect(
      runtime.recordOutcome({
        runId: childId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'wrong-candidate',
          outcomeId: 'wrong-real-file',
          status: 'succeeded',
          output: wrongCandidate,
        },
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    child = await runtime.inspect(childId);
    expect(child.actions.at(-1)!.rejectedOutcomes![0].reason).toContain('当前 Run');
    expect(await fs.readFile(path.join(root, wrongCandidate.ref), 'utf8')).toBe(
      wrongCandidate.markdown,
    );
    expect((await runtime.inspect(run.runId)).waits).toEqual([]);
    await capture('wrong-candidate', child, {
      ref: wrongCandidate.ref,
      markdown: await fs.readFile(path.join(root, wrongCandidate.ref), 'utf8'),
    });
  });

  it('reconciles a lost publication result from the actual file without repeating the write', async () => {
    const { runtime, store, reopen } = application();
    let run = await generate(runtime);
    const draft = artifact(run);
    run = await decide(runtime, run, 'approved');
    const application_ = createReportApplication({
      projectRoot: root,
      manifest: { id: 'local-report' },
    });
    const originalExecutor = application_.executors![0];
    const interrupted = createRuntime({
      ...application_,
      store,
      executors: [
        {
          ...originalExecutor,
          async execute(action, context, run) {
            await originalExecutor.execute(action, context, run);
            throw new Error('response connection lost');
          },
        },
      ],
    });
    const action = run.actions.at(-1)!;
    await expect(
      interrupted.execute({ runId: run.runId, actionId: action.id, executorId: 'report-local' }),
    ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
    run = await reopen().inspect(run.runId);
    const unknown = run.actions.at(-1)!;
    expect(unknown.status).toBe('unknown');
    const ref = `.comet/reports/local-report/published/${hashRuntimeValue(run.runId)}.md`;
    const before = await fs.stat(path.join(root, ref));
    expect(await fs.readFile(path.join(root, ref), 'utf8')).toBe(draft.markdown);
    await capture('publication-unknown', run, {
      ref,
      approvedArtifact: draft,
      markdown: await fs.readFile(path.join(root, ref), 'utf8'),
      stat: { birthtimeMs: before.birthtimeMs, mtimeMs: before.mtimeMs },
    });
    const outcome = {
      actionId: unknown.id,
      attempt: unknown.attempt,
      inputHash: unknown.inputHash,
      claimToken: unknown.claim!.token,
      outcomeId: 'reconciled-publication',
      status: 'succeeded' as const,
      output: { ref, contentHash: draft.contentHash, report: draft },
    };
    run = await reopen().recordOutcome({ runId: run.runId, outcome });
    expect(run.status).toBe('completed');
    expect(await fs.stat(path.join(root, ref))).toMatchObject({
      mtimeMs: before.mtimeMs,
      birthtimeMs: before.birthtimeMs,
    });
    expect(await reopen().recordOutcome({ runId: run.runId, outcome })).toEqual(run);
    await capture('publication-reconciled', run, {
      ref,
      outcome,
      markdown: await fs.readFile(path.join(root, ref), 'utf8'),
      stat: { birthtimeMs: before.birthtimeMs, mtimeMs: before.mtimeMs },
    });
  });
});
